# Lộ trình phát triển

Mỗi milestone là một PR riêng, có test xanh trước khi đẩy lên.

## Phase 1 — Core Platform ✅ hoàn thành

| PR  | Milestone                | Nội dung                                                                                                                                                                                                                                              | Trạng thái |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Scaffold & policy engine | Monorepo, Next.js, Tailwind, i18n vi/en, policy engine + rubric + phân vai, Firebase rules nền, Dockerfile, CI/CD, tài liệu                                                                                                                           | ✅         |
| 2   | Auth & phân quyền        | Đăng ký sinh viên, đăng nhập bằng session cookie, custom claims 3 vai trò, hồ sơ cá nhân, khung giao diện theo vai trò, Security Rules cho `users` + 20 test emulator, audit log                                                                      | ✅         |
| 3   | Cấu trúc đào tạo         | CI dựng và chạy image thật; năm học → học kỳ → học phần → lớp; admin tạo tài khoản cán bộ kèm mật khẩu tạm bắt buộc đổi; import danh sách CSV có xem trước; sinh viên vào lớp bằng Class Code; giới hạn tần suất; Security Rules cho classEnrollments | ✅         |
| 4   | Duyệt ghi danh + E2E     | Giảng viên duyệt/từ chối sinh viên đang chờ; bộ E2E Playwright chạy trên bản build production + Firebase Emulator trong CI                                                                                                                            | ✅         |
| 5   | Nhóm và phân vai         | Ba chế độ tạo nhóm, join bằng transaction, khóa nhóm, Auto Assign Roles theo bảng gộp vai của Guide; test đồng thời chứng minh acceptance test 2 và 11                                                                                                | ✅         |
| 6   | Thư viện Case Study      | Tạo case, upload PDF/DOCX/PPTX/ảnh qua server, công bố cho sinh viên; file không bao giờ public, mọi lượt tải đều qua kiểm tra quyền                                                                                                                  | ✅         |
| 7   | Giao bài và nộp bài      | Giao case cho nhóm, hạn nộp suy ra từ policy theo giờ server; mỗi lần nộp là một phiên bản mới, không ghi đè; cờ nộp muộn; bảng theo dõi tiến độ                                                                                                      | ✅         |

**Kết quả Phase 1:** giảng viên và sinh viên dùng được để tổ chức một học phần
Case Study thực tế, từ đăng ký đến nộp bài.

## Phase 2 — Buổi thuyết trình trên lớp

Nhóm trình bày trên lớp; sinh viên ngồi dưới theo dõi slide trên điện thoại hoặc
laptop, đặt câu hỏi và chấm điểm ngay trên app; giảng viên chốt điểm cuối cùng.

| PR  | Milestone               | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                       | Trạng thái |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 9   | Phòng thuyết trình      | Mở phiên cho từng nhóm, đồng hồ đếm theo mốc 18–20 phút và giới hạn cứng 22 phút, chuyển vai R1→R6 có ghi thời lượng từng vai; cả lớp mở được slide PDF của nhóm đang trình bày (chỉ slide, chỉ đúng lớp, chỉ từ khi phiên bắt đầu)                                                                                                                                                                                            | ✅         |
| 10  | Tường câu hỏi           | Mỗi sinh viên một câu hỏi (sửa được khi cửa sổ còn mở), 5 loại câu hỏi, hỏi theo vai, upvote, ẩn danh trước lớp nhưng giảng viên vẫn thấy; nhóm chọn 2–3 câu trả lời trực tiếp, phần còn lại thành kho câu hỏi của case; bảng kiểm Q&A theo Guide                                                                                                                                                                              | ✅         |
| 11  | Chấm chéo giữa các nhóm | Sinh viên chấm nhóm thuyết trình theo đúng rubric của giảng viên; mỗi sinh viên một phiếu, gửi lại là sửa chứ không cộng thêm; giảng viên đọc phân phối điểm (trung bình **và** trung vị, khoảng thấp–cao, tách theo tiêu chí); điểm chấm chéo là bằng chứng, không bao giờ tự cộng vào điểm cuối                                                                                                                              | ✅         |
| 12  | Giảng viên chốt điểm    | Màn hình chấm hợp nhất: đồng hồ, bảng kiểm hỏi đáp và điểm chấm chéo nằm cạnh rubric như bằng chứng; điểm nhóm 80% + điểm cá nhân 20%, phạt nộp muộn (miễn được nhưng phải có lý do), mất phần điểm cá nhân nếu vắng mặt hoặc không trả lời được câu hỏi của vai mình; xem trước điểm từng thành viên rồi mới công bố; công bố là toàn nhóm hoặc không ai, và sau đó không sửa lặng lẽ. Kèm theo: gán giảng viên phụ trách lớp | ✅         |

**Kết quả Phase 2:** một buổi thuyết trình chạy trọn vẹn trên app, từ lúc nhóm
lên trình bày đến lúc sinh viên nhìn thấy điểm đã công bố.

### Ghi chú thiết kế cho PR 9 và 10

- Slide được nộp trước buổi học. Thời gian không cần đồng bộ từng giây: đồng hồ
  lưu mốc bắt đầu do server cấp cộng số mili giây đã tích lũy, máy nào cũng tính
  ra cùng một con số mà không phải ghi mỗi giây.
- Tường câu hỏi làm mới mỗi 10 giây thay vì lắng nghe Firestore trực tiếp, để mọi
  lượt đọc vẫn đi qua kiểm tra quyền ở server.
- Ẩn danh được thực hiện ở server: tên người hỏi không bao giờ rời máy chủ với
  câu hỏi ẩn danh, kể cả trong dữ liệu gửi xuống trình duyệt.
- Câu hỏi gắn với **case study**, không chỉ với phiên: đó là điều cho phép Phase 3
  dùng AI trả lời toàn bộ kho câu hỏi và để lại tài liệu cho các khóa sau.

## Phase 3 — AI Assessment

| PR  | Milestone                  | Nội dung                                                                                                                                                                                                                                                             | Trạng thái |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 13  | Lớp AI + chấm có dẫn nguồn | Một cổng duy nhất tới Gemini (Vertex AI bằng service account, hoặc API key); mọi câu trả lời phải khớp schema; mô hình đọc case + slide + báo cáo rồi đề xuất điểm kèm trích dẫn (tài liệu, slide/trang, nguyên văn); không bao giờ chấm tiêu chí đánh giá trực tiếp | ✅         |
| 14  | Kho tri thức của case      | AI trả lời toàn bộ câu hỏi lớp để ngỏ, theo lô; không bao giờ ghi đè câu trả lời sinh viên đã nói trên lớp; trang kho câu hỏi để các khóa sau đọc, đã ẩn danh người hỏi                                                                                              | ✅         |
| 15  | AI Tutor + sinh câu hỏi    | Bốn chế độ hỗ trợ sinh viên, gợi ý câu hỏi cho giảng viên                                                                                                                                                                                                            | ⏳         |

**Ghi chú thiết kế Phase 3**

- Nền tảng chạy hoàn chỉnh khi **không** cấu hình mô hình nào: AI ở đâu cũng chỉ
  là tư vấn (`aiScoreIsAdvisoryOnly`), nên "chưa cấu hình" là một trạng thái
  giao diện báo, không phải lỗi. Bật bằng `scripts/enable-ai.sh`.
- PDF được gửi thẳng cho mô hình. Không tự bóc chữ từ PPTX/DOCX: một trích dẫn
  chỉ vào slide 9 mà slide 9 không nói như vậy thì tệ hơn là không có trích dẫn.
  Tài liệu không đọc được sẽ hiện ra như một khoảng trống, không im lặng.
- Mọi đề xuất đều đi qua `reconcileWithRubric`: bỏ tiêu chí lạ, bỏ tiêu chí
  giảng viên phải tự chấm, và cắt điểm về đúng thang của tiêu chí.
- Test dùng provider giả và không chạm mạng.

## Phase 4 — Analytics & Integration

CLO Analytics, Class Analytics, Student Learning Portfolio, Contribution Tracker,
AI Feedback Comparison, báo cáo quản lý, tích hợp Moodle/LTI.
