# Lộ trình phát triển

Mỗi milestone là một PR riêng, có test xanh trước khi đẩy lên.

## Phase 1 — Core Platform (đang làm)

| PR  | Milestone                | Nội dung                                                                                                                                                                                                                                              | Trạng thái |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Scaffold & policy engine | Monorepo, Next.js, Tailwind, i18n vi/en, policy engine + rubric + phân vai, Firebase rules nền, Dockerfile, CI/CD, tài liệu                                                                                                                           | ✅         |
| 2   | Auth & phân quyền        | Đăng ký sinh viên, đăng nhập bằng session cookie, custom claims 3 vai trò, hồ sơ cá nhân, khung giao diện theo vai trò, Security Rules cho `users` + 20 test emulator, audit log                                                                      | ✅         |
| 3   | Cấu trúc đào tạo         | CI dựng và chạy image thật; năm học → học kỳ → học phần → lớp; admin tạo tài khoản cán bộ kèm mật khẩu tạm bắt buộc đổi; import danh sách CSV có xem trước; sinh viên vào lớp bằng Class Code; giới hạn tần suất; Security Rules cho classEnrollments | ✅         |
| 4   | Duyệt ghi danh + E2E     | Giảng viên duyệt/từ chối sinh viên đang chờ; bộ E2E Playwright chạy trên bản build production + Firebase Emulator trong CI                                                                                                                            | ✅         |
| 5   | Case Study Library       | Upload qua signed URL, metadata đầy đủ, template vs assignment, guide/rubric có version                                                                                                                                                               | ⏳         |
| 6   | Giao bài & nộp bài       | Assignment + deadline theo giờ server, nộp nhiều deliverable, version, `isLate`, kiểm tra thiếu file, dashboard tiến độ                                                                                                                               | ⏳         |
| 7   | Hoàn thiện & deploy      | Accessibility, seed dữ liệu demo (lớp ECOM-A01 + case Amazon), bộ acceptance test, deploy Cloud Run                                                                                                                                                   | ⏳         |

**Kết quả Phase 1:** giảng viên và sinh viên dùng được để tổ chức một học phần
Case Study thực tế, từ đăng ký đến nộp bài.

## Phase 2 — Interactive Presentation

Live Presentation Room (realtime), Presentation Timer, chuyển người thuyết trình
R1→R6, Question Wall (5 loại câu hỏi, upvote, ẩn danh trước lớp), Q&A theo vai
trò, Q&A Completion Checklist, Peer Assessment, Live Polling, thông báo realtime.
Tối ưu mobile-first.

## Phase 3 — AI Assessment

Cloud Run worker + Cloud Tasks, trích xuất PDF/DOCX/PPTX, pipeline chấm theo
rubric có trích dẫn nguồn, AI Question Generator, AI Tutor 4 chế độ, màn hình
chấm hợp nhất, Grade Engine, quy trình phê duyệt và công bố điểm.

## Phase 4 — Analytics & Integration

CLO Analytics, Class Analytics, Student Learning Portfolio, Contribution Tracker,
AI Feedback Comparison, báo cáo quản lý, tích hợp Moodle/LTI.
