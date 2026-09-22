# Triển khai

## Quy trình

```
push lên main
   └─► GitHub Actions: CI (format, lint, typecheck, test, build)
   └─► GitHub Actions: Deploy
          ├─ xác thực Google qua Workload Identity Federation (không dùng file key)
          ├─ docker build -f infra/Dockerfile
          ├─ push image lên Artifact Registry (asia-southeast1)
          ├─ gcloud run deploy casestudyhub-web
          └─ kiểm tra GET /api/health trên revision mới
   └─► GitHub Actions: Deploy rules (khi thư mục firebase/ đổi)
```

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

| Biến                      | Nguồn                       | Ghi chú                                |
| ------------------------- | --------------------------- | -------------------------------------- |
| `GOOGLE_CLOUD_PROJECT`    | `--set-env-vars` khi deploy |                                        |
| `FIREBASE_STORAGE_BUCKET` | `--set-env-vars` khi deploy |                                        |
| `NEXT_PUBLIC_FIREBASE_*`  | build arg của Docker        | nhúng vào bundle trình duyệt lúc build |
| `GEMINI_API_KEY`          | Secret Manager (Phase 3)    | gắn bằng `--set-secrets`               |
| Credentials               | không cần                   | Cloud Run cấp qua service account      |

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

## Deploy tay (khi cần)

```bash
gcloud auth login
gcloud config set project casestudy1-509414
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/casestudy1-509414/casestudyhub/casestudyhub-web
gcloud run deploy casestudyhub-web \
  --image asia-southeast1-docker.pkg.dev/casestudy1-509414/casestudyhub/casestudyhub-web \
  --region asia-southeast1 --allow-unauthenticated
```

## Kiểm tra sau khi deploy

- [ ] `GET /api/health` trả `{"status":"ok"}`
- [ ] `/` chuyển hướng sang `/vi`
- [ ] Chuyển ngôn ngữ vi ↔ en hoạt động
- [ ] Chế độ sáng/tối hoạt động, không nháy trắng khi tải lại
- [ ] Giao diện dùng được trên điện thoại
