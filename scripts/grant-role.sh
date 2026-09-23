#!/usr/bin/env bash
#
# Cấp vai trò admin hoặc lecturer cho một tài khoản đã đăng ký.
#
#   bash scripts/grant-role.sh hoanganh.goldenlight@gmail.com admin
#
# Dùng cho tài khoản quản trị đầu tiên. Sau đó admin đổi vai trò được ngay
# trong ứng dụng, và mọi lần đổi đều được ghi vào nhật ký hoạt động.
#
# Tài khoản phải đăng ký trên ứng dụng TRƯỚC, vì script chỉ nâng quyền chứ
# không tạo người dùng mới.
#
set -euo pipefail

EMAIL="${1:-}"
ROLE="${2:-admin}"
PROJECT_ID="${PROJECT_ID:-casestudy1-509414}"

if [[ -z "$EMAIL" ]]; then
  echo "Cách dùng: bash scripts/grant-role.sh <email> [admin|lecturer|student]" >&2
  exit 1
fi
if [[ "$ROLE" != "admin" && "$ROLE" != "lecturer" && "$ROLE" != "student" ]]; then
  echo "Vai trò không hợp lệ: $ROLE (chỉ nhận admin, lecturer hoặc student)" >&2
  exit 1
fi

echo "▶ Project : $PROJECT_ID"
echo "▶ Email   : $EMAIL"
echo "▶ Vai trò : $ROLE"
echo

TOKEN="$(gcloud auth print-access-token)"
IDENTITY_API="https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}"

LOOKUP="$(curl -sS -X POST "${IDENTITY_API}/accounts:lookup" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"email\":[\"${EMAIL}\"]}")"

UID_VALUE="$(printf '%s' "$LOOKUP" | python3 -c '
import json, sys
try:
    users = json.load(sys.stdin).get("users", [])
except Exception:
    users = []
print(users[0]["localId"] if users else "")
')"

if [[ -z "$UID_VALUE" ]]; then
  echo "✖ Chưa có tài khoản nào dùng email này." >&2
  echo "  Hãy đăng ký trên ứng dụng trước, rồi chạy lại lệnh này." >&2
  exit 1
fi
echo "  UID: $UID_VALUE"

# 1) Custom claim -> quyết định quyền ở backend và Security Rules
curl -sS -X POST "${IDENTITY_API}/accounts:update" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"localId\":\"${UID_VALUE}\",\"customAttributes\":\"{\\\"role\\\":\\\"${ROLE}\\\"}\"}" \
  >/dev/null
echo "  đã đặt custom claim role=$ROLE"

# 2) Hồ sơ Firestore -> để giao diện và danh sách người dùng hiển thị đúng
FIRESTORE_API="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents"
curl -sS -X PATCH \
  "${FIRESTORE_API}/users/${UID_VALUE}?updateMask.fieldPaths=globalRole" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"fields\":{\"globalRole\":{\"stringValue\":\"${ROLE}\"}}}" \
  >/dev/null
echo "  đã cập nhật hồ sơ trong Firestore"

echo
echo "════════════════════════════════════════════════════════"
echo "  Xong. Vai trò nằm trong phiên đăng nhập, nên hãy"
echo "  ĐĂNG XUẤT rồi ĐĂNG NHẬP LẠI để quyền mới có hiệu lực."
echo "════════════════════════════════════════════════════════"
