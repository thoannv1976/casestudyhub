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

echo "▶ Project : $PROJECT_ID"
echo "▶ Region  : $REGION"
echo "▶ Service : $SERVICE"
echo

gcloud config set project "$PROJECT_ID" --quiet

echo "▶ [1/5] Bật API cần thiết (lần đầu mất 1–2 phút)..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

echo "▶ [2/5] Tạo kho chứa image..."
if gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="CaseStudy Hub container images" \
    --quiet
fi

echo "▶ [3/5] Cấp quyền cho service account của Cloud Build..."
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

echo "▶ [4/5] Build image (khoảng 4–6 phút)..."
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" \
  --quiet

echo "▶ [5/5] Deploy lên Cloud Run..."
gcloud run deploy "$SERVICE" \
  --image "${IMAGE}:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 4 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},FIREBASE_STORAGE_BUCKET=${PROJECT_ID}.firebasestorage.app,NODE_ENV=production" \
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
