# Prompt deploy cho Claude Cowork — PR48 (giao diện)

Thay cho hai prompt cũ (`PR45-PR47-cowork.md`, `kiem-mau-cowork.md`): production
đang chạy `2dc5149`, tức là đang **thiếu** bản giao diện. Prompt này vừa deploy
vừa kiểm, nên không cần dán hai lần.

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
git log --oneline -5          # phải thấy a97b3e6 PR48 trong danh sách
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

Dự án GCP `casestudy1-509414`, vùng `asia-southeast1`.

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy (`git log --oneline -1`) và revision Cloud Run mới. Lần trước production chạy `2dc5149` / revision `casestudyhub-web-00023-fh8`, nên lần này phải là commit khác và revision số cao hơn. Nếu trong 5 commit gần nhất **không** thấy `a97b3e6 PR48` thì dừng và báo: như vậy là `git pull` chưa lấy về bản mới, và deploy tiếp cũng chỉ ra đúng bản cũ.
2. Kết quả `/api/health` — phải là `status: ok` kèm revision mới.
3. Danh sách biến môi trường Cloud Run in ra trong lúc deploy. Nếu vẫn còn `AI_MODEL` thì chỉ **báo là còn**, đừng xóa: code từ PR36 không đọc biến đó nữa, nhưng tôi muốn biết nó còn nằm đó.
4. Số index Firestore ở trạng thái READY. **PR48 không thêm index nào, nên con số vẫn phải là 17** — nếu tụt xuống thì báo, đó là chuyện lạ. Index xây mất vài phút; còn cái nào ở trạng thái CREATING thì chờ rồi kiểm lại, và báo con số cuối cùng.
5. Firestore rules đã release chưa. Nếu log ghi `already up to date, skipping upload` thì **kiểm rồi báo, đừng coi là thiếu**: chạy `git log --oneline -1 -- firebase/firestore.rules`. Nếu lần sửa cuối của file đó nằm ở một bản đã deploy trước rồi thì "already up to date" là đúng. (PR48 chỉ đổi CSS và giao diện, không chạm vào rules, nên lần này gần như chắc chắn sẽ thấy dòng đó.)
6. Storage rules: nếu vẫn bị bỏ qua vì Firebase Storage chưa bật thì cứ báo lại như lần trước, **đừng tự bật**.
7. Bất cứ dòng đỏ hay cảnh báo nào khác, chép nguyên văn.

## Kiểm sau khi deploy

Đăng nhập bằng tài khoản tôi đã có, **đừng tạo tài khoản mới**. Việc 1 và việc 2 là phần mới của PR48; việc 3 là món nợ từ đợt trước.

**1. Giao diện có chiều sâu chưa.** Tôi nhận xét "vẫn chỉ một màu" chính là vì bản trên production còn thiếu bản này. Sáu điểm dưới đây là những gì PR48 thêm vào — với mỗi điểm chỉ cần trả lời **thấy** hay **không thấy**:

- **Thẻ nổi lên khỏi trang**: các khối nội dung (thẻ Nhóm, thẻ Bài làm, bảng tổng hợp) có bóng đổ nhẹ, không còn là ô viền phẳng. Rê chuột lên thẻ thì bóng đậm hơn một chút.
- **Cột điều hướng bên trái là một bảng riêng** có nền và viền bao quanh, không còn là mấy dòng chữ trôi cạnh nội dung.
- **Dưới tiêu đề mỗi trang có một vạch nhấn ngắn** màu thương hiệu (vạch nằm ngay dưới dòng chữ to nhất của trang).
- **Hàng tiêu đề của bảng có nền nhạt**, khác hẳn hàng dữ liệu; rê chuột lên một hàng dữ liệu thì hàng đó sáng lên.
- **Nút bấm nhấc lên khi rê chuột và lún xuống khi bấm.**
- **Ô số ở Bảng tổng hợp to hơn**, và chỉ có màu khi con số khác 0: "còn thiếu 4" phải đỏ, "đã công bố 2" phải xanh, còn số 0 thì màu chữ thường. Nếu thấy một số **0 màu đỏ** thì báo — đó là lỗi.

Làm cả hai lần: **giao diện Sáng, rồi bật giao diện Tối** (nút hình mặt trời ở góc trên). Ở giao diện Tối, thẻ **không có bóng** là đúng — chiều sâu đến từ viền sáng hơn. Nếu nền tối mà chữ ở đâu đó đọc không nổi thì chép lại đúng chỗ đó cho tôi.

**2. Chứng minh CSS màu thật sự tới trình duyệt.** Việc này chỉ đọc, không lưu gì. Mở app, xem mã nguồn trang để lấy đường dẫn file CSS (dạng `/_next/static/chunks/<tên>.css`), rồi:

```bash
# thay <URL> bằng địa chỉ app, <CSS> bằng đường dẫn file css lấy từ mã nguồn trang
curl -s "<URL><CSS>" | grep -o 'tone-\(success\|warning\|danger\|info\)-bg[^;}]*' | head -20
curl -s "<URL><CSS>" | grep -o 'shadow-card[^;}]*' | head -10
```

Cần thấy **cả hai dạng** ở lệnh đầu: định nghĩa màu (`--tone-success-bg:#dcf0e4`) **và** class dùng nó (`.bg-\[var\(--tone-success-bg\)\]{...}`) — dấu `\` trong file CSS là bình thường, không phải lỗi. Lệnh thứ hai phải tìm ra `--shadow-card`, đó là bóng đổ của PR48. Chép lại nguyên văn dòng tìm được, hoặc báo là không có.

**3. Hạn nộp phải hiện đúng giờ Việt Nam — phần này vẫn CHƯA kiểm được.** Lần trước bộ kiểm soát an toàn chặn mọi thao tác ghi của bạn, nên bước "lưu lần nữa" chưa ai thử trên production. Nếu lần này bạn **được phép lưu** thì làm; nếu vẫn bị chặn thì **báo là bị chặn**, đừng tìm đường lách.

- Vào lớp với tư cách **giảng viên** → thẻ **Cách chọn case study**. Đặt hạn thành một mốc dễ nhớ, ví dụ **20/12/2026 10:10**, rồi bấm Lưu.
- **Tải lại trang.** Ô đó phải vẫn là **10:10**, không phải 03:10.
- **Bấm Lưu lần nữa mà không sửa gì, rồi tải lại.** Vẫn phải là 10:10. Nếu nó tụt xuống 03:10 thì báo ngay, đừng bấm tiếp — đó là lỗi làm hỏng dữ liệu thật.
- Đăng nhập bằng tài khoản **sinh viên** và xem thẻ chọn case: dòng hạn phải khớp 10:10.

**4. Ba chức năng của đợt trước vẫn còn nguyên** (chỉ cần nhìn thấy, không cần thử ghi nếu bị chặn): ô **Sức chứa** kèm nút **Lưu sức chứa** trên mỗi thẻ nhóm; nút **Rời nhóm** trên thẻ nhóm của chính sinh viên; bảng **Xếp và chuyển nhóm** dưới danh sách nhóm ở trang giảng viên.

Chỗ nào không chạy: chép nguyên văn màn hình hoặc thông báo lỗi, **đừng sửa**.

---
