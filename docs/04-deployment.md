# Triển khai

## Hai đường deploy

### Từ Cloud Shell — đường đang dùng

```bash
bash scripts/setup-firebase.sh      # một lần cho mỗi project
bash scripts/deploy-cloudshell.sh   # mỗi lần ra bản mới
```

`deploy-cloudshell.sh` chạy bảy bước, và **bước 5 đẩy Security Rules cùng
Firestore index trước khi build image**. Đó là chủ ý: emulator phục vụ mọi truy
vấn mà không cần index, nên nếu rules và index không đi cùng bản code cần chúng
thì toàn bộ test vẫn xanh trong khi production hỏng. Index được đẩy trước để kịp
xây trong lúc image build.

Bước này cần `firebase-tools` đã đăng nhập:

```bash
npx --yes firebase-tools@latest login --no-localhost
```

Nếu chưa đăng nhập, script **dừng lại** thay vì deploy một ứng dụng có truy vấn
không chạy được. Khi biết chắc rules và index đã đúng, bỏ qua bằng
`SKIP_FIRESTORE=1 bash scripts/deploy-cloudshell.sh`.

### Từ GitHub Actions — chưa bật

```
push lên main
   └─► CI (format, lint, typecheck, test, build image, E2E)
   └─► Deploy            ← cần secret GCP_WORKLOAD_IDENTITY_PROVIDER
   └─► Deploy rules      ← cần secret GCP_DEPLOY_SERVICE_ACCOUNT
```

CI chạy trên mọi push. Hai workflow deploy chỉ chạy khi project đã thiết lập
Workload Identity Federation; chưa có thì deploy bằng Cloud Shell như trên.

Điều kiện: đã làm xong [`01-gcp-setup.md`](./01-gcp-setup.md).

## Cấu hình Cloud Run

| Thiết lập       | Giá trị                  | Lý do                              |
| --------------- | ------------------------ | ---------------------------------- |
| Region          | `asia-southeast1`        | Singapore, gần Việt Nam nhất       |
| Min instances   | 0                        | không ai dùng thì không tốn tiền   |
| Max instances   | 4                        | chặn chi phí bất ngờ               |
| Memory / CPU    | 1Gi / 1                  | đủ cho Next.js SSR                 |
| Service account | `casestudyhub-runtime@…` | không có quyền deploy              |
| Ingress         | công khai                | sinh viên truy cập từ ngoài trường |

## Biến môi trường

| Biến                      | Nguồn                       | Ghi chú                                 |
| ------------------------- | --------------------------- | --------------------------------------- |
| `GOOGLE_CLOUD_PROJECT`    | `--set-env-vars` khi deploy |                                         |
| `FIREBASE_STORAGE_BUCKET` | `--set-env-vars` khi deploy |                                         |
| `NEXT_PUBLIC_FIREBASE_*`  | build arg của Docker        | nhúng vào bundle trình duyệt lúc build  |
| `VERTEX_AI_ENABLED`       | `scripts/enable-ai.sh`      | bật AI, không cần bí mật nào            |
| `VERTEX_AI_LOCATION`      | `scripts/enable-ai.sh`      | mặc định `global`                       |
| `AI_MODEL`                | `scripts/enable-ai.sh`      | mặc định `gemini-2.5-flash`             |
| `GEMINI_API_KEY`          | Secret Manager              | cách thay thế; gắn bằng `--set-secrets` |
| Credentials               | không cần                   | Cloud Run cấp qua service account       |

`NEXT_PUBLIC_*` là giá trị công khai (chúng định danh project Firebase, không cấp
quyền truy cập). Thứ bảo vệ dữ liệu là Authentication và Security Rules.

## Image

`infra/Dockerfile` gồm ba stage: cài dependency → build (`output: 'standalone'`)
→ runtime chỉ chứa server đã đóng gói, chạy bằng user không phải root.

Build tay để kiểm tra:

```bash
docker build -f infra/Dockerfile -t casestudyhub-web:local .
docker run --rm -p 8080:8080 \
  -e GOOGLE_CLOUD_PROJECT=casestudy1-509414 \
  -e FIREBASE_STORAGE_BUCKET=casestudy1-509414.firebasestorage.app \
  casestudyhub-web:local
curl localhost:8080/api/health
```

## Rollback

```bash
gcloud run revisions list --service casestudyhub-web --region asia-southeast1

gcloud run services update-traffic casestudyhub-web \
  --region asia-southeast1 --to-revisions REVISION_NAME=100
```

Security Rules không tự rollback: revert commit trong `firebase/` rồi đẩy lên
`main`.

## Deploy tay từ Cloud Shell

Dùng khi chưa cấu hình xong GitHub Actions, hoặc cần đẩy nhanh một nhánh chưa
merge. Dockerfile nằm ở `infra/` nên phải build qua `cloudbuild.yaml`, không
dùng được `gcloud builds submit --tag`.

```bash
export PROJECT_ID=casestudy1-509414
export REGION=asia-southeast1
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/casestudyhub/casestudyhub-web

gcloud builds submit --config cloudbuild.yaml --substitutions=_IMAGE=$IMAGE

gcloud run deploy casestudyhub-web \
  --image "$IMAGE:latest" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 4 --memory 1Gi \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,FIREBASE_STORAGE_BUCKET=$PROJECT_ID.firebasestorage.app"
```

Script đầy đủ cho lần deploy đầu tiên (bật API, tạo Artifact Registry, cấp
quyền cho service account của Cloud Build) nằm ở
[`scripts/deploy-cloudshell.sh`](../scripts/deploy-cloudshell.sh).

## Kiểm tra sau khi deploy

- [ ] `GET /api/health` trả `{"status":"ok"}`
- [ ] `/` chuyển hướng sang `/vi`
- [ ] Chuyển ngôn ngữ vi ↔ en hoạt động
- [ ] Chế độ sáng/tối hoạt động, không nháy trắng khi tải lại
- [ ] Giao diện dùng được trên điện thoại
