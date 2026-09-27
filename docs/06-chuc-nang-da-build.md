# CaseStudy Hub — các chức năng đã build

Cập nhật: PR41 (`ea35993`, 27/09/2026). Bốn job CI xanh: 329 unit test, 373
emulator test, 133 E2E test, build container.

Tài liệu này liệt kê những gì **đã chạy được**, kèm chỗ nhìn thấy nó trong app.
Phần cuối nói rõ cái gì chưa làm.

---

## 1. Tài khoản, vai trò, phân quyền

| Chức năng                                                                            | Ai dùng               |
| ------------------------------------------------------------------------------------ | --------------------- |
| Đăng ký bằng email + mã sinh viên, đăng nhập, đổi mật khẩu                           | Sinh viên             |
| Buộc đổi mật khẩu lần đầu với tài khoản do admin tạo                                 | Giảng viên, sinh viên |
| Tạo tài khoản giảng viên / sinh viên, đặt lại mật khẩu hộ                            | Admin                 |
| Tạo hàng loạt từ danh sách dán vào, xem trước rồi mới tạo, mật khẩu hiện **một lần** | Admin                 |
| Sửa tên mà không đổi địa chỉ đăng nhập                                               | Admin                 |
| Tìm người bằng tên gõ không dấu                                                      | Admin                 |
| Đóng / mở cổng đăng ký                                                               | Admin                 |

Ba vai trò với bảng quyền cố định (21 quyền). Điều đáng nói: **admin cố ý không
có quyền `grade.draft` và `grade.publish`** — admin chạy được đồng hồ buổi thuyết
trình để hỗ trợ lớp, nhưng chấm điểm là việc của giảng viên. Mọi kiểm tra quyền
chạy hai lớp: server (`requirePermission`) và Firestore Security Rules. Nút bị ẩn
không phải là một quyền.

Trang: `/register`, `/login`, `/change-password`, `/profile`, `/admin/users`.

## 2. Cấu trúc học vụ

- Khoa / ngành / môn học / lớp học phần, nhiều giảng viên một lớp.
- Sinh viên vào lớp bằng **mã lớp**; giảng viên duyệt hoặc gỡ khỏi danh sách.
- Nhập danh sách lớp từ file, có giới hạn dung lượng đặt trong Quản trị.
- Lưu trữ lớp đã xong.

Trang: `/admin/academic`, `/classes`, `/teaching/[classId]`.

## 3. Nhóm và phân vai

- Tạo nhóm, chia nhóm ngẫu nhiên, chuyển thành viên, khoá nhóm, **đổi tên nhóm**.
- Sinh viên tự chọn nhóm khi nhóm chưa khoá.
- Sáu vai thuyết trình (R1–R6) theo Guide, gán cho từng thành viên; bản đồ 16
  slide ↔ vai nào nói slide nào nằm trong khung đánh giá.

Trang: `/classes/[classId]`, `/teaching/[classId]`.

## 4. Tình huống (case study)

- Tải case lên, xuất bản, **sửa case thành phiên bản mới** — phiên bản cũ không
  bị ghi đè, vì bài đã giao phải giữ nguyên bản case nó được giao.
- File kèm theo case (đề bài, số liệu, phụ lục), tải xuống qua route đã kiểm
  quyền.
- **Sinh viên tự chọn case**: giảng viên mở cổng chọn, nhóm nào nhận trước được
  trước, case đã có người nhận hiện là đã nhận chứ không mời lần nữa; giảng viên
  xem ai chọn gì và thu hồi được.

Trang: `/cases`, `/cases/[caseId]`, `/classes/[classId]`.

## 5. Giao bài và nộp bài — bài case study

- Giao case cho nhóm kèm **ngày thuyết trình**; hạn nộp **tính từ khung đánh
  giá** ("24 giờ trước buổi") chứ không gõ tay.
- **Đổi ngày thuyết trình** đã giao: hạn nộp tính lại theo đúng phiên bản khung
  bài đó đã đóng băng, nhóm được thông báo cả hai mốc. Không cho đổi khi điểm đã
  công bố hoặc buổi đã mở.
- Gia hạn riêng cho một nhóm, kèm lý do, ghi vào sổ kiểm toán.
- Nộp bài theo từng loại tài liệu, **có phiên bản**: nộp lại là phiên bản mới,
  bản cũ vẫn còn. Muộn hay không do **đồng hồ server** quyết, không phải đồng hồ
  máy sinh viên.
- Bảy loại tài liệu của bài case study (slide PDF, file nguồn, phiếu phân vai,
  danh mục tài liệu, phiếu khai báo dùng AI — bắt buộc; video, báo cáo phân tích
  — tuỳ chọn). Video nộp bằng **link**.
- Nhóm được giao hai case thì có hai khu làm việc riêng, sắp theo ngày thuyết
  trình.

Trang: `/classes/[classId]`, `/teaching/[classId]`.

## 6. Bài tập lớn của lớp (group project)

Một bài cho cả lớp, một hạn cho mọi nhóm, nộp tuần cuối học phần — khác hẳn bài
case study giao rải trong kỳ.

- Ba tài liệu: **PPT pitch deck, báo cáo, link video** trình bày.
- Một hạn duy nhất cho cả lớp; đổi hạn có lý do và ghi sổ.
- Rubric riêng **10 thành phần** (không phải 6 tiêu chí của bài thuyết trình),
  cộng **điểm thưởng** MVP (10) và video (5), cộng xong mới cắt trần 100.
- Giảng viên chấm trên trang riêng, mở được từng file nhóm đã nộp.

Trang: `/classes/[classId]`, `/teaching/[classId]`, `/teaching/[classId]/project/[groupId]`.

## 7. Xung phong thuyết trình bài tập lớn (PR41)

- Giảng viên đặt **số nhóm được thuyết trình** và **hạn xung phong**; để 0 là
  chưa mở.
- Nhóm bấm xung phong, nhận số thứ tự (Số 1, Số 2…). Một nhóm không thể xung
  phong hai lần, **kể cả hai thành viên bấm cùng một giây**; chỗ cuối cùng chỉ
  về đúng một nhóm.
- Giảng viên không cắt số chỗ xuống dưới số nhóm đã xung phong; rút tên nhóm chỉ
  được trước khi buổi mở.
- Mở buổi thuyết trình cho nhóm đã xung phong — và **chỉ** nhóm đã xung phong.
- Thẻ xung phong chạy được ở cỡ màn hình điện thoại.

Trang: `/classes/[classId]` (sinh viên), `/teaching/[classId]` (giảng viên).

## 8. Buổi thuyết trình

Dùng chung một cỗ máy cho cả case study và bài tập lớn: đồng hồ, bảng câu hỏi,
upvote, điểm chéo.

- Đồng hồ theo vai, tạm dừng, chuyển vai, giới hạn thời gian lấy từ khung.
- **Slide PDF (hoặc pitch deck của bài tập lớn) mở cho cả lớp từ lúc buổi bắt
  đầu** — đúng một tài liệu đó, và chỉ từ lúc đó. Báo cáo phân tích, phiếu phân
  vai, phiếu khai báo AI vẫn là của nhóm.
- **Mỗi sinh viên một câu hỏi**, sửa được khi cổng còn mở; nhóm đang thuyết trình
  không đặt câu hỏi cho chính mình.
- Ẩn danh **làm ở server**: trình duyệt của bạn cùng lớp không nhận được tên
  người hỏi; giảng viên vẫn thấy.
- Nhóm chọn câu để trả lời tại lớp và ghi lại câu trả lời.
- Danh sách kiểm Q&A của Guide: đủ số câu hỏi chưa, thành viên nào chưa trả lời
  câu nào.
- Điểm chéo giữa các nhóm, sinh viên chỉ đọc lại điểm của chính mình.

Trang: `/sessions/[sessionId]`.

## 9. Tổng hợp câu hỏi (PR41)

- Bảng theo dõi **ai đã đặt câu hỏi, ai chưa** — nêu tên người còn thiếu chứ
  không chỉ đếm; nhóm đang thuyết trình được loại khỏi mẫu số.
- AI **xếp câu hỏi thành 3–6 chủ đề**, câu nào mô hình không xếp được thì nói rõ.
- AI **trả lời những câu lớp chưa kịp trả lời**, đọc từ chính tài liệu nhóm đã
  nộp. Câu nào sinh viên đã trả lời tại lớp thì không bị ghi đè.
- Với case study: cả ngân hàng câu hỏi của case được trả lời và giữ lại cho khoá
  sau, tên người hỏi đã bóc đi.

Trang: `/teaching/[classId]/project/[groupId]/questions`, `/cases/[caseId]`.

## 10. Chấm điểm

- Chấm theo rubric của **đúng phiên bản khung** bài đó đã đóng băng.
- Điểm nhóm 80% + điểm cá nhân 20%; trừ điểm nộp muộn; **cộng thưởng trước khi
  cắt trần**.
- Nháp → công bố. Điểm đã công bố không đổi được bằng cách sửa khung.
- Ghi đè điểm có lý do, miễn trừ trừ muộn có lý do — vào sổ kiểm toán.
- Sinh viên xem điểm và nhận xét ở thẻ cá nhân.

Trang: `/teaching/[classId]/grade/[assignmentId]`, `/teaching/[classId]/project/[groupId]`, `/portfolio`.

## 11. Bảng tổng hợp và báo cáo

- **Bảng tổng hợp cả lớp**: mỗi dòng một việc một nhóm phải làm, cả hai loại bài
  — nộp mấy trên mấy, có muộn không, chấm tới đâu, điểm nhóm, điểm trung bình đã
  công bố. Tải CSV. Tốn **8 truy vấn database cho lớp bao nhiêu nhóm cũng vậy**,
  và có test ghim con số đó.
- **Báo cáo lớp**: chỉ điểm đã công bố, phân bố điểm, tiêu chí cả lớp yếu nhất,
  mức đạt chuẩn đầu ra (kèm câu nhắc phải đối chiếu với đề cương), ai không tham
  gia gì.
- **Hồ sơ buổi thuyết trình**: mọi câu hỏi và mọi điểm chéo sau khi buổi kết thúc.
- Tải xuống dạng bảng tính, công thức bị vô hiệu hoá (không để file CSV chạy được
  công thức trên máy người mở).
- Trang chủ theo vai: sinh viên thấy việc còn nợ và điểm mới, giảng viên thấy
  việc đang chờ mình, cả hai thấy buổi đang diễn ra.

Trang: `/teaching/[classId]/overview`, `/teaching/[classId]/report`, `/teaching/[classId]/presentation/[assignmentId]`, `/dashboard`.

## 12. AI

Một cửa duy nhất (`getAiProvider`) có đếm hạn mức tháng. **AI đề xuất, con người
quyết định — không đường code nào cho điểm AI chạm vào `grades`.**

| Việc                                                   | Cho ai     |
| ------------------------------------------------------ | ---------- |
| Đọc bài nộp và đề xuất điểm theo rubric, kèm dẫn chứng | Giảng viên |
| Gợi ý câu hỏi để chất vấn nhóm                         | Giảng viên |
| Xếp câu hỏi thành chủ đề                               | Giảng viên |
| Trả lời câu hỏi còn lại                                | Giảng viên |
| Gia sư hỏi đáp về case (không làm bài hộ)              | Sinh viên  |

- Chọn **OpenAI hoặc Gemini** trong Quản trị, nhập khóa API ngay trên web, không
  cần deploy lại. Gemini chạy được cả đường Vertex AI (không cần khóa).
- Nút **Thử gọi mô hình** để biết khóa có tới được nhà cung cấp hay không.
- Hạn mức lượt gọi mỗi tháng, đếm và chặn.
- Đọc được PDF, ảnh, văn bản — và **.pptx**: file zip, mỗi slide một phần XML,
  nên biết chắc câu trích nằm ở slide nào. Biểu đồ và số nằm trong ảnh thì không
  đọc được, và mô hình nói thẳng là thiếu bằng chứng chứ không đoán.
- Tiêu chí _Pitch + Q&A + làm việc nhóm_ **không bao giờ** được gửi cho mô hình —
  nó chỉ đề xuất được 95 trên 100 điểm.

Trang: `/admin/system`, `/cases/[caseId]`, các trang chấm bài.

## 13. Khung đánh giá là dữ liệu có phiên bản

- Thời lượng, sáu vai, bản đồ 16 slide, danh sách tài liệu phải nộp, rubric
  (6 tiêu chí / 100 điểm), rubric bài tập lớn (10 thành phần), điểm thưởng, mức
  trừ muộn, chuẩn đầu ra CLO — tất cả nằm trong **một phiên bản khung**, ghi bằng
  `create` và **không bao giờ ghi đè**.
- Xuất bản phiên bản mới **không làm động điểm đã công bố**.
- Xác nhận bản đồ chuẩn đầu ra thì câu nhắc trong báo cáo lớp biến mất.

Trang: `/framework`.

## 14. Thông báo, sổ kiểm toán, cài đặt hệ thống

- Thông báo trong app: được giao bài, đổi ngày, sắp tới hạn, được duyệt vào lớp,
  câu hỏi được chọn, điểm công bố (case study và bài tập lớn riêng). **Mọi thông
  báo lưu bằng khoá i18n**, không lưu câu đã dịch.
- Sổ kiểm toán ~40 loại hành động: ai làm gì, lúc nào, lý do gì.
- Cài đặt hệ thống: đóng/mở đăng ký, giới hạn dung lượng nhập, hạn mức AI, cấu
  hình mô hình — mọi thay đổi có lý do và vào sổ.

Trang: `/notifications`, `/admin`, `/admin/system`.

## 15. Nền tảng

- **Song ngữ Việt / Anh** toàn bộ, chuyển ngôn ngữ tức thì.
- Chạy được trên điện thoại — lớp học dùng điện thoại để theo buổi thuyết trình
  và đặt câu hỏi.
- Bàn phím đi hết được, mỗi trang khai báo ngôn ngữ cho trình đọc màn hình.
- **File không bao giờ công khai**: mọi byte đi qua route handler đã kiểm tư cách.
  Cố ý không dùng signed URL.
- Deploy lên Cloud Run, vùng `asia-southeast1`, dự án `casestudy1-509414`.

---

## Chưa làm

Chưa duyệt, hoặc còn vướng:

- **Live Polling** trong buổi thuyết trình.
- **So sánh nhận xét AI với nhận xét giảng viên**.
- **Tập duyệt thuyết trình** (rehearsal).
- **Theo dõi mức đóng góp** của từng thành viên trong nhóm.
- **Moodle / LTI** — chờ mã client và khoá của trường.
- **Chính sách vòng đời file** trên Cloud Storage (file cũ tự chuyển lớp lưu trữ).
- File kèm theo case **chưa đánh phiên bản theo từng phiên bản case**.
- Trình soạn khung đánh giá **chưa thêm / bớt được tiêu chí rubric** và chưa sửa
  được danh sách tài liệu phải nộp. Danh sách tài liệu mô hình được đọc đang cố
  định trong mã, chờ đúng cái cờ này.
- **Hồ sơ buổi thuyết trình chưa có bản cho bài tập lớn** — bảng tổng hợp câu hỏi
  ở mục 9 đang làm việc đó.

## Còn phải thử thật trên production

Ba việc code không tự chứng minh được, phải có người làm thật một lần:

1. **Mô hình AI chưa một lần trả lời thật.** Dán khóa OpenAI ở Quản trị → Hệ
   thống, **bấm Bật mô hình** (lưu khóa không tự bật), rồi _Thử gọi mô hình_.
2. **Chưa có file thật nào được tải lên production.** Bucket
   `casestudy1-509414-files` có thể chưa tồn tại — chỉ một lần nộp bài thật mới
   biết.
3. **Chấm bài tập lớn bằng tài khoản giảng viên**, không phải admin: admin cố ý
   không có quyền chấm.
