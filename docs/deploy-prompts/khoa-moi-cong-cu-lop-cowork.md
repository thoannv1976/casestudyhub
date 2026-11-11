# Prompt deploy cho Claude Cowork — Khoá mới, chuyển khoá Moodle, công cụ lớp

Bản này thêm: chuyển khoá Moodle sang lớp khác (kèm cảnh báo gắn nhầm lớp), mở
lớp khoá mới từ lớp cũ, nhắc nhóm còn thiếu bài, công cụ nhóm cho cả lớp, đường
dẫn hỏi–đáp ClassInteract, sửa dòng "Nhóm bạn đã nộp đủ" cho sinh viên chưa có
nhóm, và giữ sẵn 1 máy chủ (`--min-instances 1`). Không có biến môi trường,
secret hay index Firestore mới. Kế hoạch: `docs/ke-hoach/2026-11-11-khoa-moi-va-cong-cu-lop.md`.

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi.
- **KHÔNG đổi, KHÔNG xoá biến `LTI_*` hay secret nào.** Kết nối Moodle đang chạy.
- **KHÔNG bấm nút nào trong app** (chuyển khoá Moodle, tạo lớp, nhắc nhóm, xếp/gộp/khoá nhóm). Lớp ECOM1, ECOM2 là lớp thật.
- **KHÔNG dùng `SKIP_FIRESTORE=1`.**

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy dòng "Khoá mới từ lớp cũ, chuyển khoá Moodle..."
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy và revision Cloud Run mới.
2. Kết quả `/api/health` — `status: ok` kèm revision mới.
3. Danh sách biến môi trường: **vẫn phải có** `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_TENANTS`, `LTI_GAME_SECRET`.
4. `gcloud run services describe casestudyhub-web --region asia-southeast1 --format="value(spec.template.metadata.annotations)"` có `autoscaling.knative.dev/minScale: '1'`.
5. Bất cứ dòng đỏ hay cảnh báo nào, chép nguyên văn.

## Kiểm sau khi deploy (chỉ xem, không lưu gì)

Đăng nhập bằng tài khoản giảng viên, mở lớp **ECOM2**:

- Ô **Kết nối Moodle** hiện số sinh viên vào từ Moodle, cảnh báo đỏ "có thể đang gắn nhầm lớp", và khung **Chuyển khoá Moodle sang lớp khác**.
- Cuối trang có ô **Mở lớp cho khoá mới từ lớp này**.
- Ô **Nhóm** có **Công cụ cho cả lớp**.
- Trang **Tổng quan** có nút **Nhắc … nhóm còn thiếu bài** và dòng "Còn thiếu: …" dưới cột đã nộp.
