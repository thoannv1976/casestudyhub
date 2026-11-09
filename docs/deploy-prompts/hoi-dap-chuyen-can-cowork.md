# Prompt deploy cho Claude Cowork — Hỏi–đáp sau thuyết trình, AI gợi ý, chuyên cần

Bản này thêm: hỏi thêm sau buổi, nhóm trả lời trong app, AI gợi ý câu trả lời
(OpenAI, Gemini hoặc **Claude**) để giảng viên chốt, câu hỏi hay / câu trả lời
tốt, báo cáo CSV, trang Tham gia & chuyên cần. Không có biến môi trường, secret
hay index Firestore mới. Có một thư viện mới (`@anthropic-ai/sdk`), cài tự động
khi build image.

**Thay đổi hành vi cần biết:** từ bản này, nút AI trong Kho câu hỏi chỉ viết
**gợi ý** (sinh viên không thấy) — không còn ghi thẳng thành câu trả lời. Câu
trả lời AI viết từ trước vẫn hiện như cũ.

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi.
- **KHÔNG đổi, KHÔNG xoá biến `LTI_*` hay secret nào.** Kết nối Moodle đang chạy.
- **KHÔNG dán khóa API AI nào, KHÔNG bấm "AI gợi ý", KHÔNG chốt câu trả lời, KHÔNG đổi cài đặt lớp.** Lớp ECOM1, ECOM2 là lớp thật.
- **KHÔNG dùng `SKIP_FIRESTORE=1`.**

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy dòng "Hỏi–đáp sau thuyết trình..."
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy và revision Cloud Run mới.
2. Kết quả `/api/health` — `status: ok` kèm revision mới.
3. Danh sách biến môi trường: **vẫn phải có** `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_TENANTS`, `LTI_GAME_SECRET`.
4. Bất cứ dòng đỏ hay cảnh báo nào, chép nguyên văn.

## Kiểm sau khi deploy (chỉ xem, không lưu gì)

Đăng nhập bằng tài khoản giảng viên tôi đã có, mở lớp **ECOM2**:

1. Đầu trang lớp có hai liên kết mới **"Hỏi–đáp"** và **"Tham gia & chuyên cần"**.
2. **Hỏi–đáp**: thấy các buổi thuyết trình đã diễn ra và câu hỏi của từng buổi; có khung "Sau buổi thuyết trình" với hai ô số ngày (đang là 0). Chỉ xem.
3. **Tham gia & chuyên cần**: bảng có đủ sinh viên, cột chuyên cần có số. Chỉ xem.
4. Vào **Quản trị → Hệ thống**: ô chọn nhà cung cấp AI có thêm **Anthropic Claude**. Không đổi gì.
