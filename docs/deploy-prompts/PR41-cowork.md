# Prompt deploy cho Claude Cowork — PR41

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này
là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì
  chép nguyên văn lỗi vào báo cáo cho tôi, để tôi chuyển về cho Claude Code sửa.
  Đừng "vá tạm" bất cứ thứ gì.
- **KHÔNG tự dán khóa API nào.** Khóa OpenAI/Gemini do tôi nhập trong trang Quản
  trị → Hệ thống, không nhập bằng biến môi trường, không nhập giúp tôi.
- **KHÔNG tự đặt hạn nộp, KHÔNG tự chấm điểm, KHÔNG tự tạo lớp hay nhóm.** Dữ
  liệu thật là của giảng viên.
- **Đừng tự tạo bucket, đừng chạy `scripts/setup-firebase.sh`.**
- **KHÔNG dùng `SKIP_FIRESTORE=1`.** Lần này Firestore rules có thay đổi, bỏ qua
  bước đó là deploy thiếu.

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -3          # commit trên cùng phải là a835128 (PR41)
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

Dự án GCP `casestudy1-509414`, vùng `asia-southeast1`.

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy (`git log --oneline -1`) và revision Cloud Run mới.
2. Kết quả `/api/health` (phải là `status: ok` kèm revision mới).
3. Danh sách biến môi trường Cloud Run in ra trong lúc deploy. Nếu vẫn còn
   `AI_MODEL` thì chỉ cần **báo là còn**, đừng xóa — code từ PR36 không còn đọc
   biến đó nữa, nhưng tôi muốn biết nó còn nằm đó.
4. Số index Firestore ở trạng thái READY. **Lần này không thêm index mới**, nên
   con số phải giữ nguyên 13; khác 13 thì báo lại.
5. Firestore rules: đã upload và release chưa. Rules lần này thêm hai collection
   (`projectVolunteers`, `questionClusters`).
6. Storage rules: nếu vẫn bị bỏ qua vì Firebase Storage chưa bật thì cứ báo lại
   như lần trước, đừng tự bật.
7. Bất cứ dòng đỏ / warning nào khác, chép nguyên văn.

**Sau khi deploy, mở app và kiểm 5 việc mới của PR41** (đăng nhập bằng tài khoản
tôi đã có, đừng tạo tài khoản mới):

1. Vào lớp với tư cách **giảng viên** → thẻ **Bài tập lớn của lớp**: có ô _Số
   nhóm được thuyết trình_ và _Hạn xung phong_ không.
2. Vào lớp với tư cách **sinh viên**: có thẻ **Xung phong thuyết trình bài tập
   lớn** không, và khi giảng viên chưa mở chỗ thì nó có nói "Giảng viên chưa mở
   phần này" không.
3. Kiểm trên **điện thoại** (hoặc thu hẹp cửa sổ xuống cỡ điện thoại): thẻ xung
   phong không được tràn ngang.
4. Trang chủ (dashboard) vẫn mở được bình thường — đây là chỗ PR41 sửa một lỗi
   làm sập trang khi có buổi thuyết trình bài tập lớn đang chạy.
5. Nếu tiện, nhờ một nhóm xung phong rồi mở buổi: cột **Thuyết trình** phải hiện
   _Số 1_, và có link **Câu hỏi** dẫn tới bảng tổng hợp câu hỏi.

Chỗ nào không chạy: chép nguyên văn màn hình / thông báo lỗi, đừng sửa.

---
