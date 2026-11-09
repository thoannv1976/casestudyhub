# Kế hoạch nâng cấp đêm 09/11/2026 — Thư viện case, hỏi–đáp sau thuyết trình, chuyên cần

Chủ dự án duyệt trước qua tin nhắn: "bạn làm xong, tự làm tiếp nhóm 2, nhóm 3 …
lập kế hoạch cho phần này và tự làm tiếp. Tôi cấp bạn toàn bộ các quyền."

Thứ tự làm, mỗi phần một nhánh, qua đủ 4 lớp kiểm chứng, CI xanh rồi mới gộp
`main` và deploy.

## Phần 1 — Nhóm 2 + 3: quản lý thư viện case (nhánh `feature/case-library-tools`)

**Làm:**

- Trang Thư viện: ô tìm (mã, tên, doanh nghiệp), lọc theo học phần và trạng
  thái (đã công bố / nháp / đã lưu trữ), mặc định ẩn case đã lưu trữ.
- Mỗi case hiện **"Đang dùng: N lớp · M bài giao"** để biết case nào xoá/lưu
  trữ được.
- **Lưu trữ / khôi phục** case (trạng thái `archived` đã có trong dữ liệu, chỉ
  thiếu nút). Case lưu trữ không còn được mời chọn, nhưng nhóm đang giữ vẫn mở
  được tài liệu.
- Tải lên **nhiều file một lần**, **chọn loại file** (đề bài, hướng dẫn, mẫu
  slide, tài liệu tham khảo), **gỡ file** (nút có sẵn ở server, thiếu ở giao
  diện). File đã có bài giao thì gỡ là ẩn chứ không xoá — giữ đúng quy tắc cũ.
- **Tạo case hàng loạt** (nhóm 3): chọn nhiều PDF → mỗi file thành một case nháp,
  mã tự đánh số tiếp theo (CASE28, CASE29…), tên lấy từ tên file, rồi sửa nhanh
  và công bố.

**Không làm, vì sao:**

- _Gộp case trùng_: gộp sẽ phải chuyển bài giao, lượt nhận, kho câu hỏi giữa
  hai case — dễ hỏng dữ liệu đã chấm. Lưu trữ bản trùng là đủ.
- _Tài liệu chung của học phần_: cần một loại hồ sơ mới và quy tắc quyền mới;
  lợi ích nhỏ (một file hướng dẫn). Để sau.
- _Chia sẻ case giữa giảng viên_: thư viện vốn đã dùng chung cho mọi giảng viên.
- _Câu hỏi các khóa trước_: đã có (trang Kho câu hỏi của case, ẩn tên người hỏi).
- _Dọn CASE01_ (25 file của case khác): đụng vào lớp thật đang học, để chủ dự án
  tự bấm "Gỡ" bằng nút mới.

## Phần 2 — Hỏi–đáp sau thuyết trình, AI gợi ý, giảng viên chốt (nhánh `feature/qa-after-class`)

Hiện trạng: đã có tường câu hỏi trong buổi (mỗi sinh viên 1 câu, ẩn danh với
bạn cùng lớp), nhóm chọn 2–3 câu trả lời tại lớp, AI trả lời phần còn lại **và
ghi thẳng thành câu trả lời** (chưa có bước giảng viên duyệt), chỉ hỗ trợ
OpenAI/Gemini.

**Làm:**

1. **Cổng câu hỏi mở sau buổi**: giảng viên đặt "Hạn đặt câu hỏi" và "Hạn nhóm
   trả lời trong app" cho từng buổi; server tự đóng khi tới hạn.
2. **Nhóm trả lời trong app**: thành viên nhóm thuyết trình trả lời mọi câu còn
   lại (không chỉ 2–3 câu đã chọn). Mỗi câu trả lời ghi rõ _trả lời tại lớp_
   hay _trả lời trong app_.
3. **AI gợi ý, không ghi đè**: lượt AI chỉ lưu _gợi ý_ bên cạnh câu hỏi. Giảng
   viên xem câu trả lời của nhóm + gợi ý AI, sửa, bấm **Chốt** → thành câu trả
   lời chính thức. Đánh dấu **Câu hỏi hay** / **Câu trả lời tốt**.
4. **Thêm Claude (Anthropic)** bên cạnh OpenAI và Gemini: quản trị viên nhập khóa
   từng hãng, chọn hãng mặc định; giảng viên chọn hãng khi bấm gợi ý (trong số
   hãng đã có khóa).

**Không làm:** AI tự chấm hay tự công bố câu trả lời — trái nguyên tắc "AI đề
xuất, con người quyết định".

## Phần 3 — Thống kê tham gia, điểm chuyên cần, báo cáo câu hỏi (cùng nhánh hoặc nhánh tiếp)

1. **Bảng tham gia từng sinh viên** (mỗi lớp): số buổi đủ điều kiện (không tính
   buổi nhóm mình thuyết trình), số buổi có đặt câu hỏi, có chấm chéo, số câu
   hỏi, câu được chọn trả lời tại lớp, câu hỏi hay, lượt upvote nhận được, số câu
   đã trả lời (khi là nhóm thuyết trình), câu trả lời tốt.
2. **Điểm chuyên cần (thang 10)**: mỗi buổi đủ điều kiện, sinh viên được
   `trọng số câu hỏi` nếu đã hỏi + `trọng số chấm chéo` nếu đã chấm (mặc định
   0,5 + 0,5); điểm = 10 × tổng / số buổi; cộng thưởng mỗi câu hỏi hay (mặc định
   0,5), tối đa 10. Giảng viên chỉnh trọng số theo lớp. Tải CSV.
3. **Báo cáo tổng hợp câu hỏi**: trang lọc theo buổi/nhóm; mục "Câu hỏi hay",
   "Câu trả lời tốt", toàn bộ hỏi–đáp kèm trạng thái (tại lớp / trong app / AI
   gợi ý chưa chốt / đã chốt). Tải CSV.

**Làm nếu kịp:** gửi điểm chuyên cần sang Moodle như một hoạt động mới của UniGame
Hub (cần sửa catalogue Hub và deploy lại Hub).

## Phần 4 — Gửi điểm chuyên cần sang Moodle (làm sáng 10/11/2026, chủ dự án bảo "làm tiếp")

1. **UniGame Hub**: danh mục CaseStudy Hub thêm hoạt động thứ tư `attendance`
   — "Điểm chuyên cần". Chỉ sửa `config/games.json`; deploy lại Hub với đúng
   các biến đang chạy (8 game, 5 địa chỉ). Có thể quay về revision cũ ngay.
2. **CaseStudy Hub**: loại hoạt động `attendance`. Điểm gửi = điểm chuyên cần
   × 10 (thang 100). **Chỉ gửi khi giảng viên bấm**: nút trên trang Tham gia &
   chuyên cần (chỉ cột chuyên cần) và nút Gửi điểm cả lớp (mọi cột). Công bố
   điểm bài không bao giờ chạm cột chuyên cần. Chưa có buổi nào → ô trống.
3. Giảng viên mở hoạt động chuyên cần từ Moodle → vào trang Tham gia & chuyên cần.

**Không làm:** tự gửi định kỳ hoặc sau mỗi buổi — con số trong Sổ điểm phải là
con số giảng viên đã xem. Không tự thêm hoạt động vào khoá Moodle 33 (khoá
thật): giảng viên tự thêm.

## Kiểm chứng và deploy

Mỗi phần: `npm run check`, `test:rules`, `test:e2e` trên máy, CI 4 job xanh, gộp
`main`, deploy, kiểm tra trang thật bằng tài khoản giảng viên (chỉ xem, không
lưu gì vào lớp thật).
