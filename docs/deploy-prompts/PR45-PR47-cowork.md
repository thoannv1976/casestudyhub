# Prompt deploy cho Claude Cowork — PR45 → PR47

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi, để tôi chuyển về cho Claude Code sửa. Đừng "vá tạm" bất cứ thứ gì.
- **KHÔNG tự dán khóa API nào.** Khóa OpenAI/Gemini do tôi nhập trong trang Quản trị → Hệ thống, không nhập bằng biến môi trường, không nhập giúp tôi.
- **KHÔNG tự đặt hạn nộp, KHÔNG tự chấm điểm, KHÔNG tự tạo lớp hay nhóm.** Dữ liệu thật là của giảng viên.
- **Đừng tự tạo bucket, đừng chạy `scripts/setup-firebase.sh`.**
- **KHÔNG dùng `SKIP_FIRESTORE=1`.** Bước đó đẩy Firestore rules và index; bỏ qua là deploy thiếu.

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy PR47 (5c9fa60) trong danh sách
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

Dự án GCP `casestudy1-509414`, vùng `asia-southeast1`.

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy (`git log --oneline -1`) và revision Cloud Run mới. Chỉ cần chép lại cho tôi; nếu trong 5 commit gần nhất **không** thấy PR47 thì dừng và báo, vì như vậy là `git pull` chưa lấy về bản mới.
2. Kết quả `/api/health` — phải là `status: ok` kèm revision mới.
3. Danh sách biến môi trường Cloud Run in ra trong lúc deploy. Nếu vẫn còn `AI_MODEL` thì chỉ **báo là còn**, đừng xóa: code từ PR36 không đọc biến đó nữa, nhưng tôi muốn biết nó còn nằm đó.
4. Số index Firestore ở trạng thái READY — hiện phải là **17**. Index xây mất vài phút; còn cái nào ở trạng thái CREATING thì chờ rồi kiểm lại, và báo con số cuối cùng. Thiếu index thì có màn hình sẽ lỗi trước mặt sinh viên.
5. Firestore rules đã release chưa. Nếu log ghi `already up to date, skipping upload` thì **kiểm rồi báo, đừng coi là thiếu**: chạy `git log --oneline -1 -- firebase/firestore.rules`. Nếu lần sửa cuối của file đó nằm ở một bản đã deploy trước rồi thì "already up to date" là đúng. (Đây là chỗ tôi từng viết sai trong prompt và bạn phải đi kiểm giúp — nên giờ tôi để cách kiểm ở đây thay vì khẳng định.)
6. Storage rules: nếu vẫn bị bỏ qua vì Firebase Storage chưa bật thì cứ báo lại như lần trước, **đừng tự bật**.
7. Bất cứ dòng đỏ hay cảnh báo nào khác, chép nguyên văn.

## Kiểm sau khi deploy

Đăng nhập bằng tài khoản tôi đã có, **đừng tạo tài khoản mới**. Bốn việc, việc 1 quan trọng nhất.

**1. Hạn nộp phải hiện đúng giờ Việt Nam.** Đây là lỗi đợt trước: hạn hiện sớm 7 tiếng, và lưu lại một lần nữa thì hạn thật lùi thêm 7 tiếng.

- Vào lớp với tư cách **giảng viên** → thẻ **Cách chọn case study**. Đặt hạn thành một mốc dễ nhớ, ví dụ **20/12/2026 10:10**, rồi bấm Lưu.
- **Tải lại trang.** Ô đó phải vẫn là **10:10**, không phải 03:10.
- **Bấm Lưu lần nữa mà không sửa gì, rồi tải lại.** Vẫn phải là 10:10. Nếu nó tụt xuống 03:10 thì báo ngay, đừng bấm tiếp.
- Đăng nhập bằng tài khoản **sinh viên** và xem thẻ chọn case: dòng hạn phải khớp 10:10.

**2. Đổi số thành viên một nhóm.** Ở thẻ **Nhóm**, mỗi nhóm giờ có ô **Sức chứa** và nút **Lưu sức chứa**. Thử nâng một nhóm từ 6 lên 8 — phải được. Rồi thử hạ xuống thấp hơn số người đang có trong nhóm — phải bị từ chối kèm thông báo rõ ràng.

**3. Sinh viên rời nhóm, giảng viên chuyển nhóm.**

- Bằng tài khoản **sinh viên**: trên thẻ nhóm của chính mình có nút **Rời nhóm**, bấm thì hỏi lại trước. Rời xong vào nhóm khác được. Nếu nhóm đó đã được giao case thì app phải **từ chối** và nói lý do — đó là cố ý.
- Bằng tài khoản **giảng viên**: dưới danh sách nhóm có bảng **Xếp và chuyển nhóm** liệt kê cả lớp kèm nhóm hiện tại. Chọn nhóm trong ô bên phải để xếp hoặc chuyển một sinh viên. Kiểm rằng người đó biến khỏi nhóm cũ và hiện ở nhóm mới.

**4. Màu sắc.** Bảng tổng hợp cả lớp giờ có thẻ màu: xanh lá là đã xong, hổ phách là còn treo, đỏ là có chuyện, xanh dương là đang diễn ra. Chỉ cần nhìn xem có đọc được không, kể cả khi **bật giao diện Tối** (nút hình mặt trời ở góc trên).

Chỗ nào không chạy: chép nguyên văn màn hình hoặc thông báo lỗi, **đừng sửa**.

---
