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

echo "▶ [1/6] Bật API cần thiết (lần đầu mất 1–2 phút)..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

echo "▶ [2/6] Tạo kho chứa image..."
if gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="CaseStudy Hub container images" \
    --quiet
fi

echo "▶ [3/6] Cấp quyền cho service account của Cloud Build..."
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

echo "▶ [4/6] Đọc cấu hình Firebase..."
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

echo "▶ [5/6] Build image (khoảng 4–6 phút)..."
# Chạy build ở phạm vi global: nộp build kèm --region trên project này bị
# PERMISSION_DENIED. Image vẫn được đẩy vào Artifact Registry ở $REGION.
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}${FB_SUBS:+,$FB_SUBS}" \
  --quiet

echo "▶ [6/6] Deploy lên Cloud Run..."
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
