#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CaseStudy Hub — bật tính năng AI (Vertex AI / Gemini)
#
# Chạy một lần cho mỗi project. Script này:
#   1. Bật Vertex AI API
#   2. Cấp quyền gọi mô hình cho service account của Cloud Run
#   3. Bật AI trên dịch vụ Cloud Run đang chạy
#
# Không có bí mật nào phải lưu: Cloud Run dùng chính service account của nó,
# nên không có API key để rò rỉ, xoay vòng hay quên.
#
#   bash scripts/enable-ai.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-casestudyhub-web}"
RUNTIME_SA_ID="${RUNTIME_SA_ID:-casestudyhub-runtime}"
# 'global' phục vụ Gemini ở mọi nơi và ít bị giới hạn theo vùng nhất.
AI_LOCATION="${AI_LOCATION:-global}"
AI_MODEL="${AI_MODEL:-gemini-2.5-flash}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "✗ Chưa đặt project. Chạy: gcloud config set project <PROJECT_ID>" >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════"
echo "  Project : $PROJECT_ID"
echo "  Dịch vụ : $SERVICE ($REGION)"
echo "  Mô hình : $AI_MODEL @ $AI_LOCATION"
echo "════════════════════════════════════════════════════════"
echo

echo "▶ [1/3] Bật Vertex AI API..."
gcloud services enable aiplatform.googleapis.com --project "$PROJECT_ID" --quiet
echo "  xong"

echo "▶ [2/3] Cấp quyền gọi mô hình cho service account..."
RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/aiplatform.user" --condition=None --quiet >/dev/null
echo "  $RUNTIME_SA"

echo "▶ [3/3] Bật AI trên dịch vụ đang chạy..."
gcloud run services update "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-env-vars "VERTEX_AI_ENABLED=true,VERTEX_AI_LOCATION=${AI_LOCATION},AI_MODEL=${AI_MODEL}" \
  --quiet

echo
echo "════════════════════════════════════════════════════════"
echo "  Đã bật AI."
echo
echo "  Kiểm tra: mở màn hình chấm điểm của một nhóm."
echo "  Thẻ \"Mô hình đã đọc được gì\" phải có nút yêu cầu đọc tài liệu"
echo "  thay vì dòng chữ báo chưa cấu hình."
echo
echo "  Tắt lại bất cứ lúc nào:"
echo "    gcloud run services update $SERVICE --region $REGION \\"
echo "      --update-env-vars VERTEX_AI_ENABLED=false"
echo "════════════════════════════════════════════════════════"
