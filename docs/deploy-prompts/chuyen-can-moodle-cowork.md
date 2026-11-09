# Prompt deploy cho Claude Cowork — Gửi điểm chuyên cần sang Moodle

Bản này thêm loại hoạt động Moodle thứ tư, **Điểm chuyên cần**: giảng viên bấm
gửi ở trang Tham gia & chuyên cần, điểm chuyên cần (thang 10) đi vào cột Moodle
(thang 100). Không có biến môi trường, secret hay index Firestore mới. Cần UniGame
Hub có danh mục mới (hoạt động `attendance`) — đã deploy cùng lúc.

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi.
- **KHÔNG đổi, KHÔNG xoá biến `LTI_*` hay secret nào.** Kết nối Moodle đang chạy.
- **KHÔNG bấm "Gửi điểm" nào, KHÔNG đổi cài đặt lớp.** Lớp ECOM1, ECOM2 là lớp thật.
- **KHÔNG dùng `SKIP_FIRESTORE=1`.**

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy dòng "Điểm chuyên cần sang Moodle..."
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy và revision Cloud Run mới.
2. Kết quả `/api/health` — `status: ok` kèm revision mới.
3. Danh sách biến môi trường: **vẫn phải có** `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_TENANTS`, `LTI_GAME_SECRET`.
4. Bất cứ dòng đỏ hay cảnh báo nào, chép nguyên văn.

## Kiểm sau khi deploy (chỉ xem, không lưu gì)

Đăng nhập bằng tài khoản giảng viên, mở lớp **ECOM2** → **Tham gia & chuyên cần**:
trên bảng có khung **"Gửi điểm chuyên cần sang Moodle"**. Lớp chưa có cột
chuyên cần thì khung hướng dẫn thêm hoạt động trong Moodle. Không bấm gì.
