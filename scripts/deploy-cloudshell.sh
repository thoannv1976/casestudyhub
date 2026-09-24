#!/usr/bin/env bash
#
# Deploy CaseStudy Hub lên Cloud Run từ Google Cloud Shell.
#
# Chạy được nhiều lần: các bước đã làm rồi sẽ tự bỏ qua.
#
#   bash scripts/deploy-cloudshell.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-casestudy1-509414}"
REGION="${REGION:-asia-southeast1}"
REPO="${REPO:-casestudyhub}"
SERVICE="${SERVICE:-casestudyhub-web}"
BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-files}"

echo "▶ Project : $PROJECT_ID"
echo "▶ Region  : $REGION"
echo "▶ Service : $SERVICE"
echo

gcloud config set project "$PROJECT_ID" --quiet

echo "▶ [1/7] Bật API cần thiết (lần đầu mất 1–2 phút)..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

echo "▶ [2/7] Tạo kho chứa image..."
if gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="CaseStudy Hub container images" \
    --quiet
fi

echo "▶ [3/7] Cấp quyền cho service account của Cloud Build..."
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for ROLE in roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE" \
    --condition=None --quiet >/dev/null
done
echo "  $BUILD_SA"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

echo "▶ [4/7] Đọc cấu hình Firebase..."
SECRET_NAME="${SECRET_NAME:-firebase-web-config}"
FB_SUBS=""
if gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  FB_SUBS="$(gcloud secrets versions access latest --secret="$SECRET_NAME" | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
pairs = {
    "_FB_API_KEY": cfg.get("apiKey", ""),
    "_FB_AUTH_DOMAIN": cfg.get("authDomain", ""),
    "_FB_PROJECT_ID": cfg.get("projectId", ""),
    "_FB_STORAGE_BUCKET": cfg.get("storageBucket", ""),
    "_FB_MESSAGING_SENDER_ID": cfg.get("messagingSenderId", ""),
    "_FB_APP_ID": cfg.get("appId", ""),
}
print(",".join(f"{k}={v}" for k, v in pairs.items() if v))
')"
  echo "  đã lấy từ secret $SECRET_NAME"
else
  echo "  (chưa có secret $SECRET_NAME — bỏ qua."
  echo "   Đăng nhập chưa hoạt động cho tới khi chạy scripts/setup-firebase.sh)"
fi

echo "▶ [5/7] Deploy Security Rules và Firestore index..."
# Rules và index phải đi cùng bản code cần chúng. Emulator phục vụ mọi truy vấn
# mà không cần index, nên nếu bước này bị bỏ qua thì test vẫn xanh còn production
# thì hỏng — đúng kiểu lệch pha đã từng xảy ra với dự án này.
#
# Index được đẩy trước khi build image để nó kịp xây trong lúc build chạy.
if [[ "${SKIP_FIRESTORE:-}" == "1" ]]; then
  echo "  (bỏ qua theo yêu cầu SKIP_FIRESTORE=1)"
elif npx --yes firebase-tools@latest projects:list >/dev/null 2>&1; then
  (cd firebase && npx --yes firebase-tools@latest deploy \
    --only firestore:rules,firestore:indexes \
    --project "$PROJECT_ID" --non-interactive)
  echo "  đã đẩy Firestore rules và index"

  # storage.rules chỉ có hiệu lực với bucket được gắn vào Firebase Storage.
  # Project này dùng một bucket GCS thường, và mọi byte đều đi qua Admin SDK
  # phía sau route handler — Admin SDK bỏ qua rules, nên file này không chi
  # phối gì ở production. Deploy được thì tốt (phòng khi sau này bucket được
  # gắn vào Firebase Storage); không được thì không phải lý do chặn bản phát
  # hành, nên chỉ báo rồi đi tiếp.
  if (cd firebase && npx --yes firebase-tools@latest deploy \
        --only storage --project "$PROJECT_ID" --non-interactive) >/dev/null 2>&1; then
    echo "  đã đẩy Storage rules"
  else
    echo "  (bỏ qua Storage rules: project chưa bật Firebase Storage."
    echo "   Ứng dụng không cần — file nằm ở bucket ${BUCKET_NAME} và chỉ"
    echo "   đọc được qua route handler đã kiểm tra quyền.)"
  fi
else
  echo
  echo "✗ firebase-tools chưa đăng nhập, nên không đẩy được rules và index." >&2
  echo "  Dừng ở đây có chủ đích: deploy ứng dụng mà thiếu index thì màn hình" >&2
  echo "  chấm điểm, hồ sơ sinh viên và việc giao case sẽ lỗi trên production." >&2
  echo >&2
  echo "  Đăng nhập rồi chạy lại:" >&2
  echo "    npx --yes firebase-tools@latest login --no-localhost" >&2
  echo "    bash scripts/deploy-cloudshell.sh" >&2
  exit 1
fi

echo "▶ [6/7] Build image (khoảng 4–6 phút)..."
# Chạy build ở phạm vi global: nộp build kèm --region trên project này bị
# PERMISSION_DENIED. Image vẫn được đẩy vào Artifact Registry ở $REGION.
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}${FB_SUBS:+,$FB_SUBS}" \
  --quiet

echo "▶ [7/7] Deploy lên Cloud Run..."
RUNTIME_SA="${RUNTIME_SA_ID:-casestudyhub-runtime}@${PROJECT_ID}.iam.gserviceaccount.com"
SA_FLAG=()
if gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1; then
  SA_FLAG=(--service-account "$RUNTIME_SA")
  echo "  chạy bằng $RUNTIME_SA"
fi

gcloud run deploy "$SERVICE" \
  --image "${IMAGE}:latest" \
  --region "$REGION" \
  --platform managed \
  "${SA_FLAG[@]}" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 4 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},FIREBASE_STORAGE_BUCKET=${BUCKET_NAME},NODE_ENV=production" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"

echo
echo "▶ Kiểm tra sức khỏe dịch vụ:"
curl --fail --silent --show-error --retry 5 --retry-delay 3 --retry-connrefused "${URL}/api/health"
echo
echo
echo "════════════════════════════════════════════════════════"
echo "  Ứng dụng đã chạy:"
echo "    $URL          → tự chuyển sang tiếng Việt"
echo "    $URL/en       → giao diện tiếng Anh"
echo "    $URL/api/health"
echo "════════════════════════════════════════════════════════"
