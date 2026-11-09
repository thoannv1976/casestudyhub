#!/usr/bin/env bash
# Địa chỉ ngắn https://casestudyhub.web.app cho dịch vụ Cloud Run casestudyhub-web.
#
# Chạy MỘT LẦN trong Cloud Shell, sau khi deploy bình thường. Không đụng tới
# Firestore, Storage hay chính dịch vụ: Firebase Hosting chỉ chuyển mọi yêu cầu
# sang Cloud Run. Cookie đăng nhập tên `__session` - đúng cái tên duy nhất
# Hosting cho đi qua - nên đăng nhập hoạt động như ở địa chỉ Cloud Run.
#
# Cấu hình nằm riêng ở firebase/hosting.json để emulator và script deploy
# chính không bị ảnh hưởng.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-casestudy1-509414}"
SITE="${SITE:-casestudyhub}"
FB="npx --yes firebase-tools@latest"

cd "$(dirname "$0")/../firebase"

echo "==> Tạo site Hosting '${SITE}' (bỏ qua nếu đã có)"
if $FB hosting:sites:list --project "$PROJECT_ID" 2>/dev/null | grep -q "\b${SITE}\b"; then
  echo "  site đã có"
elif ! $FB hosting:sites:create "$SITE" --project "$PROJECT_ID" --non-interactive; then
  echo "✗ Không tạo được site '${SITE}' (tên có thể đã bị dự án khác dùng)." >&2
  echo "  Chạy lại với SITE=<tên-khác>, và sửa trường \"site\" trong firebase/hosting.json." >&2
  exit 1
fi

echo "==> Đẩy cấu hình Hosting (chỉ chuyển tiếp sang Cloud Run)"
$FB deploy --only "hosting:${SITE}" --config hosting.json --project "$PROJECT_ID" --non-interactive

echo "==> Kiểm tra"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://${SITE}.web.app/api/health")
echo "  https://${SITE}.web.app/api/health -> ${code} (mong đợi 200)"
