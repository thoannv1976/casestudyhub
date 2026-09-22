# Hướng dẫn chuẩn bị Google Cloud (làm một lần)

Áp dụng cho project **`casestudy1-509414`** (tên hiển thị: Casestudy1, project
number `1089225172972`).

Toàn bộ phần này thầy làm trên trình duyệt hoặc trong Cloud Shell. Sau khi xong,
mỗi lần đẩy code lên nhánh `main` là GitHub Actions tự build và deploy.

> Có thể dùng **Cloud Shell** (biểu tượng `>_` góc phải trên Google Cloud
> Console) để chạy các lệnh dưới đây — không cần cài gì trên máy.

---

## Bước 0. Đặt biến dùng chung

```bash
export PROJECT_ID=casestudy1-509414
export PROJECT_NUMBER=1089225172972
export REGION=asia-southeast1          # Singapore, gần Việt Nam nhất
export GITHUB_REPO=thoannv1976/casestudyhub

gcloud config set project $PROJECT_ID
```

## Bước 1. Bật các API cần thiết

```bash
gcloud services enable \
  firebase.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  generativelanguage.googleapis.com
```

`generativelanguage.googleapis.com` phục vụ Gemini API ở Phase 3; bật sẵn cũng
không phát sinh chi phí khi chưa gọi.

## Bước 2. Thêm project vào Firebase

1. Mở <https://console.firebase.google.com/> → **Add project** → chọn
   **casestudy1-509414** (project đã có sẵn, không tạo mới).
2. Bỏ qua Google Analytics nếu không cần.

## Bước 3. Tạo Firestore

```bash
gcloud firestore databases create --location=$REGION --type=firestore-native
```

Hoặc trong Firebase Console → **Firestore Database** → **Create database** →
**Production mode** → location `asia-southeast1`.

> Chọn **Native mode**, không phải Datastore mode. Location không đổi được sau
> khi tạo.

## Bước 4. Bật Authentication

Firebase Console → **Authentication** → **Get started** → tab **Sign-in method**
→ bật **Email/Password**.

(Google Workspace/SSO có thể bổ sung sau; kiến trúc đã sẵn sàng.)

## Bước 5. Tạo Cloud Storage bucket

Firebase Console → **Storage** → **Get started** → location `asia-southeast1`.

Ghi lại tên bucket, thường là `casestudy1-509414.firebasestorage.app`.

## Bước 6. Lấy cấu hình Firebase cho web

Firebase Console → ⚙️ **Project settings** → **General** → mục _Your apps_ →
**Add app** → **Web** (`</>`) → đặt tên `casestudyhub-web` → **Register app**.

Màn hình hiện một đoạn cấu hình. Ghi lại 6 giá trị:

| Giá trị trong Firebase | Secret trên GitHub                         |
| ---------------------- | ------------------------------------------ |
| `apiKey`               | `NEXT_PUBLIC_FIREBASE_API_KEY`             |
| `authDomain`           | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         |
| `projectId`            | (dùng `GCP_PROJECT_ID`)                    |
| `storageBucket`        | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      |
| `messagingSenderId`    | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId`                | `NEXT_PUBLIC_FIREBASE_APP_ID`              |

> Các giá trị này **không phải bí mật** — chúng chỉ định danh project và luôn
> nằm trong mã nguồn trang web. Cái bảo vệ dữ liệu là Authentication và Security
> Rules. Dù vậy vẫn lưu dạng secret để tiện quản lý.

## Bước 7. Tạo Artifact Registry để chứa image

```bash
gcloud artifacts repositories create casestudyhub \
  --repository-format=docker \
  --location=$REGION \
  --description="CaseStudy Hub container images"
```

## Bước 8. Tạo hai service account

**8.1. Service account để GitHub Actions deploy**

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer"

DEPLOYER=github-deployer@$PROJECT_ID.iam.gserviceaccount.com

for ROLE in roles/run.admin roles/artifactregistry.writer \
            roles/iam.serviceAccountUser roles/firebaserules.admin \
            roles/datastore.indexAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$DEPLOYER" --role="$ROLE"
done
```

**8.2. Service account cho ứng dụng lúc chạy**

```bash
gcloud iam service-accounts create casestudyhub-runtime \
  --display-name="CaseStudy Hub Cloud Run runtime"

RUNTIME=casestudyhub-runtime@$PROJECT_ID.iam.gserviceaccount.com

for ROLE in roles/datastore.user roles/firebaseauth.admin \
            roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$RUNTIME" --role="$ROLE"
done

# Cho phép deployer gán runtime service account cho Cloud Run
gcloud iam service-accounts add-iam-policy-binding $RUNTIME \
  --member="serviceAccount:$DEPLOYER" --role="roles/iam.serviceAccountUser"
```

> Tách hai tài khoản là có chủ đích: tài khoản deploy không có quyền đọc dữ liệu
> sinh viên, tài khoản chạy ứng dụng không có quyền deploy.

## Bước 9. Workload Identity Federation (không dùng file key)

Cách này để GitHub Actions xác thực với Google mà **không cần tạo và lưu file
JSON key** — an toàn hơn hẳn.

```bash
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO'"

# Chỉ repo casestudyhub mới được mạo danh service account deployer
gcloud iam service-accounts add-iam-policy-binding $DEPLOYER \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"

# In ra giá trị cần dán vào GitHub
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider"
```

## Bước 10. Nạp secret vào GitHub

GitHub → repo **casestudyhub** → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**. Tạo đủ 8 secret:

| Tên secret                                 | Giá trị                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `GCP_PROJECT_ID`                           | `casestudy1-509414`                                              |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`           | chuỗi in ra ở bước 9                                             |
| `GCP_DEPLOY_SERVICE_ACCOUNT`               | `github-deployer@casestudy1-509414.iam.gserviceaccount.com`      |
| `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`        | `casestudyhub-runtime@casestudy1-509414.iam.gserviceaccount.com` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | từ bước 6                                                        |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | từ bước 6                                                        |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | từ bước 6                                                        |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | từ bước 6                                                        |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | từ bước 6                                                        |

## Bước 11. Đặt hạn mức chi phí

Cloud Console → **Billing** → **Budgets & alerts** → **Create budget**: đặt ngân
sách tháng và cảnh báo ở 50% / 90% / 100%.

Cấu hình Cloud Run trong `.github/workflows/deploy.yml` đã giới hạn
`--max-instances 4` và `--min-instances 0`, nên khi không ai dùng thì chi phí về
gần bằng 0.

## Bước 12. Deploy Security Rules lần đầu

Rules được deploy tự động khi thư mục `firebase/` thay đổi trên `main`. Lần đầu
có thể chạy tay:

```bash
cd firebase
npx firebase-tools deploy \
  --only firestore:rules,firestore:indexes,storage \
  --project $PROJECT_ID
```

---

## Kiểm tra lại

- [ ] 11 API đã bật
- [ ] Firestore Native mode, region `asia-southeast1`
- [ ] Authentication bật Email/Password
- [ ] Storage bucket đã tạo
- [ ] Artifact Registry `casestudyhub` đã tạo
- [ ] Hai service account đã tạo và gán quyền
- [ ] Workload Identity Pool + Provider đã tạo, giới hạn đúng repo
- [ ] 9 secret đã nạp vào GitHub
- [ ] Ngân sách và cảnh báo chi phí đã đặt

Xong bước này, báo lại để tôi bật deploy tự động và kiểm tra endpoint
`/api/health` trên Cloud Run.
