# Prompt deploy cho Claude Cowork — Kết nối Moodle qua UniGame Hub

Bản này thêm phần kết nối Moodle nhưng **để tắt** (`LTI_ENABLED` chưa đặt): sau
deploy, app phải chạy y như trước. Việc bật kết nối do chủ dự án chạy script
`finish-casestudyhub-lti.sh` trên máy mình, **không phải việc của Cowork**.

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi, để tôi chuyển về cho Claude Code sửa. Đừng "vá tạm" bất cứ thứ gì.
- **KHÔNG tự đặt biến `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_GAME_SECRET`** hay bất kỳ biến `LTI_*` nào, và **KHÔNG tạo secret, KHÔNG cấp quyền IAM**. Phần bật kết nối Moodle tôi tự làm sau bằng script riêng.
- **KHÔNG tự dán khóa API nào. KHÔNG tự chấm điểm, KHÔNG tự tạo lớp hay nhóm.** Dữ liệu thật là của giảng viên.
- **KHÔNG dùng `SKIP_FIRESTORE=1`.** Bản này thêm Firestore rules mới (khoá các bảng `lti*`), bỏ qua là deploy thiếu.

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy dòng "Kết nối Moodle qua UniGame Hub (LTI 1.3)..."
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

Dự án GCP `casestudy1-509414`, vùng `asia-southeast1`.

**Sau khi deploy xong, chạy thêm MỘT lần (địa chỉ ngắn):**

```bash
bash scripts/setup-short-url.sh
```

Script này chỉ tạo site Firebase Hosting `casestudyhub` và chuyển mọi đường
dẫn sang dịch vụ Cloud Run; không đụng Firestore, Storage hay dịch vụ. Nếu nó
báo **không tạo được site** (tên đã bị dùng) thì **dừng phần này và báo lại**,
đừng tự đổi tên.

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy (`git log --oneline -1`) và revision Cloud Run mới.
2. Kết quả `/api/health` — phải là `status: ok` kèm revision mới.
3. Danh sách biến môi trường Cloud Run in ra lúc deploy. **Không được có biến `LTI_*` nào** ở lần deploy này; nếu thấy thì báo.
4. Firestore rules đã release chưa (lần này **phải** có upload rules mới, không phải "already up to date"), và số index READY — **bản này không thêm index**, con số phải giữ nguyên như lần trước.
5. Kết quả `scripts/setup-short-url.sh`: dòng cuối `https://casestudyhub.web.app/api/health -> ...` (mong đợi 200), hoặc nguyên văn lỗi.
6. Bất cứ dòng đỏ hay cảnh báo nào khác, chép nguyên văn.

## Kiểm sau khi deploy (chỉ đọc, không lưu gì)

**1. Kết nối Moodle đang tắt đúng như ý.** Chạy:

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"ticket":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' \
  https://casestudyhub-web-iv27nu35ta-as.a.run.app/api/lti/launch
```

Phải trả về JSON có `"messageKey":"errors.ltiNotEnabled"`. Nếu trả về trang HTML 404 thì bản mới **chưa** lên — báo lại.

**2. Trang mở từ Moodle hiện đúng thông báo.** Mở
`https://casestudyhub-web-iv27nu35ta-as.a.run.app/vi/lti-launch` trên trình duyệt: phải thấy tiêu đề **"Mở từ Moodle"** và dòng **"Phiên mở từ Moodle đã hết hạn hoặc không hợp lệ."** (vì không có vé). Đó là đúng.

**3. Mọi thứ cũ vẫn chạy.** Đăng nhập bằng tài khoản tôi đã có (**đừng tạo tài khoản mới**), mở Trang chủ, một lớp, Bảng tổng hợp. Trang lớp của giảng viên **không** được có khung "Kết nối Moodle" (vì kết nối đang tắt). Nếu có thì báo.

**4. Nếu bước địa chỉ ngắn thành công:** mở `https://casestudyhub.web.app/vi/login`, đăng nhập bằng tài khoản của tôi, phải vào được Trang chủ — tức là cookie đăng nhập đi qua Firebase Hosting được. Nếu đăng nhập xong mà bị đẩy về trang đăng nhập thì báo nguyên văn.
