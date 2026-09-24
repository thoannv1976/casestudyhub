#!/usr/bin/env bash
#
# Chuẩn bị Firebase cho CaseStudy Hub (chạy một lần, trong Google Cloud Shell).
#
#   bash scripts/setup-firebase.sh
#
# Script làm 6 việc:
#   1. Bật các API của Firebase / Identity Platform / Firestore / Secret Manager
#   2. Thêm project GCP vào Firebase
#   3. Tạo Cloud Firestore (Native mode)
#   4. Bật đăng nhập bằng Email/Password
#   5. Tạo Firebase Web App và lưu cấu hình vào Secret Manager
#   6. Tạo service account cho Cloud Run và cấp quyền
#
# Chạy lại được nhiều lần: việc nào đã làm rồi thì bỏ qua.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-casestudy1-509414}"
REGION="${REGION:-asia-southeast1}"
WEB_APP_NAME="${WEB_APP_NAME:-CaseStudy Hub Web}"
SECRET_NAME="${SECRET_NAME:-firebase-web-config}"
# A bucket name with dots would be treated as a domain and need verification,
# so the platform uses a plain name. Nothing depends on the Firebase default
# bucket: the code takes the name from FIREBASE_STORAGE_BUCKET.
BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-files}"
RUNTIME_SA_ID="${RUNTIME_SA_ID:-casestudyhub-runtime}"

FIREBASE_API="https://firebase.googleapis.com/v1beta1"
IDENTITY_API="https://identitytoolkit.googleapis.com/v2"

echo "▶ Project: $PROJECT_ID   Region: $REGION"
echo

gcloud config set project "$PROJECT_ID" --quiet

api_call() {
  # api_call METHOD URL [BODY] -> in ra body phản hồi, không làm dừng script khi lỗi
  # x-goog-user-project: Identity Toolkit từ chối (403) token của người dùng
  # nếu không chỉ rõ project dùng để tính quota.
  local method="$1" url="$2" body="${3:-}"
  local token
  token="$(gcloud auth print-access-token)"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$url" \
      -H "Authorization: Bearer $token" \
      -H "x-goog-user-project: $PROJECT_ID" \
      -H "Content-Type: application/json" \
      -d "$body" || true
  else
    curl -sS -X "$method" "$url" \
      -H "Authorization: Bearer $token" \
      -H "x-goog-user-project: $PROJECT_ID" || true
  fi
}

json_get() {
  # json_get '<json>' 'khóa.lồng.nhau'  -> in ra giá trị, rỗng nếu không có
  python3 -c '
import json, sys
data = sys.argv[1]
path = sys.argv[2].split(".")
try:
    node = json.loads(data)
except Exception:
    sys.exit(0)
for key in path:
    if isinstance(node, list):
        if not node:
            sys.exit(0)
        node = node[0]
    if not isinstance(node, dict) or key not in node:
        sys.exit(0)
    node = node[key]
print(node if not isinstance(node, (dict, list)) else json.dumps(node))
' "$1" "$2"
}

# ---------------------------------------------------------------------------
echo "▶ [1/7] Bật API (lần đầu mất 1–2 phút)..."
gcloud services enable \
  firebase.googleapis.com \
  identitytoolkit.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --quiet

# ---------------------------------------------------------------------------
echo "▶ [2/7] Thêm project vào Firebase..."
EXISTING_FIREBASE="$(api_call GET "${FIREBASE_API}/projects/${PROJECT_ID}")"
if [[ -n "$(json_get "$EXISTING_FIREBASE" projectId)" ]]; then
  echo "  (đã là Firebase project, bỏ qua)"
else
  api_call POST "${FIREBASE_API}/projects/${PROJECT_ID}:addFirebase" '{}' >/dev/null
  echo "  đã thêm"
  sleep 10
fi

# ---------------------------------------------------------------------------
echo "▶ [3/7] Tạo Cloud Firestore (Native mode, $REGION)..."
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud firestore databases create \
    --location="$REGION" \
    --type=firestore-native \
    --quiet
fi

# ---------------------------------------------------------------------------
echo "▶ [4/7] Bật đăng nhập Email/Password..."
api_call POST "${IDENTITY_API}/projects/${PROJECT_ID}/identityPlatform:initializeAuth" '{}' >/dev/null
AUTH_CONFIG="$(api_call PATCH \
  "${IDENTITY_API}/projects/${PROJECT_ID}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired" \
  '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}')"
if [[ "$(json_get "$AUTH_CONFIG" signIn.email.enabled)" == "True" ]]; then
  echo "  đã bật"
else
  echo "  ⚠ Không xác nhận được trạng thái. Phản hồi:"
  echo "$AUTH_CONFIG" | head -20
  echo "  Nếu lỗi, bật tay tại: https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
fi

# ---------------------------------------------------------------------------
echo "▶ [5/7] Tạo Firebase Web App và lưu cấu hình..."
WEB_APPS="$(api_call GET "${FIREBASE_API}/projects/${PROJECT_ID}/webApps")"
APP_ID="$(json_get "$WEB_APPS" apps.appId)"

if [[ -z "$APP_ID" ]]; then
  api_call POST "${FIREBASE_API}/projects/${PROJECT_ID}/webApps" \
    "{\"displayName\":\"${WEB_APP_NAME}\"}" >/dev/null
  for _ in $(seq 1 20); do
    sleep 5
    WEB_APPS="$(api_call GET "${FIREBASE_API}/projects/${PROJECT_ID}/webApps")"
    APP_ID="$(json_get "$WEB_APPS" apps.appId)"
    [[ -n "$APP_ID" ]] && break
  done
fi

if [[ -z "$APP_ID" ]]; then
  echo "  ✖ Không tạo được Web App. Phản hồi gần nhất:"
  echo "$WEB_APPS" | head -20
  exit 1
fi
echo "  App ID: $APP_ID"

WEB_CONFIG="$(api_call GET "${FIREBASE_API}/projects/${PROJECT_ID}/webApps/${APP_ID}/config")"
if [[ -z "$(json_get "$WEB_CONFIG" apiKey)" ]]; then
  echo "  ✖ Không đọc được cấu hình Web App:"
  echo "$WEB_CONFIG" | head -20
  exit 1
fi

if gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  printf '%s' "$WEB_CONFIG" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --quiet >/dev/null
  echo "  cấu hình đã cập nhật vào secret '$SECRET_NAME'"
else
  printf '%s' "$WEB_CONFIG" | gcloud secrets create "$SECRET_NAME" \
    --data-file=- --replication-policy=automatic --quiet >/dev/null
  echo "  cấu hình đã lưu vào secret '$SECRET_NAME'"
fi

# ---------------------------------------------------------------------------
echo "▶ [6/7] Tạo kho lưu tài liệu (Cloud Storage)..."
if gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --quiet
fi
echo "  gs://${BUCKET_NAME}"

# ---------------------------------------------------------------------------
echo "▶ [7/7] Tạo service account cho Cloud Run..."
RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1; then
  echo "  (đã có, bỏ qua)"
else
  gcloud iam service-accounts create "$RUNTIME_SA_ID" \
    --display-name="CaseStudy Hub Cloud Run runtime" --quiet
fi

for ROLE in roles/datastore.user roles/firebaseauth.admin roles/secretmanager.secretAccessor \
            roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="$ROLE" --condition=None --quiet >/dev/null
done
echo "  $RUNTIME_SA"

echo
echo "════════════════════════════════════════════════════════"
echo "  Firebase đã sẵn sàng."
echo
echo "  Kho tài liệu: gs://${BUCKET_NAME}"
echo
echo "  Bước tiếp theo — deploy bản mới:"
echo "    bash scripts/deploy-cloudshell.sh"
echo "════════════════════════════════════════════════════════"
