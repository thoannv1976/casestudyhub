# CaseStudy Hub — Bản đặc tả sản phẩm

> **Tên đầy đủ:** AI-Powered Case Study Presentation & Assessment Platform
> **Nguồn:** SRS v1.0 (`docs/source/NEW_AI9-AI23_Case_study_HUB.pdf`, 45 trang),
> Case Study Presentation Guide và case mẫu Amazon trong `docs/source/`.
> **Trạng thái:** Phase 1 đã hoàn thành (PR 1–8). Phase 2 chưa bắt đầu.

Tài liệu này là nguồn tham chiếu duy nhất cho mọi module. Trước khi viết một
module, phải xác định: mô hình dữ liệu, quy tắc nghiệp vụ, hợp đồng API, phân
quyền và acceptance test của module đó.

---

## Phần I. Tầm nhìn và mục tiêu

CaseStudy Hub không chỉ quản lý việc giao và nộp bài. Mục tiêu là tổ chức toàn
bộ hoạt động học tập theo phương pháp Case Study: từ khi giảng viên giao tình
huống đến khi sinh viên phân tích, thuyết trình, phản biện, được đánh giá và
nhận phản hồi.

Năm mục tiêu giáo dục:

1. **Active Learning** — sinh viên chủ động nghiên cứu tình huống thực tế.
2. **Collaborative Learning** — mỗi thành viên có vai trò rõ ràng; hệ thống ghi
   nhận đóng góp cá nhân trong kết quả chung.
3. **Critical Thinking** — sinh viên phản biện, đánh giá minh chứng, bảo vệ
   quyết định.
4. **AI-Assisted Learning & Assessment** — AI hỗ trợ nghiên cứu, phản hồi slide,
   phân tích báo cáo và giúp giảng viên chấm theo rubric.
5. **Evidence-Based Assessment** — điểm dựa trên bài nộp, vai trò, câu hỏi, câu
   trả lời, phản hồi của lớp và quyết định cuối cùng của giảng viên.

**Yêu cầu nền tảng:** mọi quy định học thuật trong Presentation Guide phải là
**cấu hình của học phần**, không viết cố định vào mã nguồn. Học phần khác phải
đổi được quy mô nhóm, thời lượng, rubric và cách tính điểm.

Hệ thống vận hành đồng thời nhiều năm học, nhiều học kỳ, nhiều học phần, nhiều
lớp và nhiều giảng viên.

---

## Phần II. Ba vai trò và luồng hoạt động

```
ADMIN      Quản lý nền tảng – người dùng – cấu hình – học phần
GIẢNG VIÊN Tạo lớp – giao case – tạo nhóm – phân công – chấm điểm
SINH VIÊN  Đăng ký – tham gia nhóm – phân tích – nộp bài – thuyết trình
           ↓
LIVE PRESENTATION   Đặt câu hỏi – phản biện – bình chọn – Q&A
AI + PEER + LECTURER ASSESSMENT
LEARNING ANALYTICS  Điểm nhóm – điểm cá nhân – CLO – báo cáo lớp
```

---

## Phần III. Đặc tả chức năng

### Module 01. Tài khoản và xác thực

**1.1 Đăng ký sinh viên** — Student ID (duy nhất), họ tên, email, mật khẩu, xác
nhận mật khẩu, lớp, học phần, ngôn ngữ ưu tiên.

Dùng Firebase Authentication cho đăng nhập và mật khẩu. **Không bao giờ lưu mật
khẩu dạng văn bản trong Firestore.** Kiến trúc phải cho phép bổ sung Google
Workspace/SSO về sau.

**1.2 Tham gia lớp** — hai phương thức:

| Phương thức   | Mô tả                                                   |
| ------------- | ------------------------------------------------------- |
| A. Chọn lớp   | Sinh viên đăng ký lớp có sẵn và chờ giảng viên xác nhận |
| B. Class Code | Nhập mã lớp, ví dụ `ECOM-2026-A01`                      |

Sinh viên có thể thuộc nhiều lớp và nhiều học phần, nhưng vai trò và kết quả
học tập phải tách biệt theo từng lớp.

**1.3 Hồ sơ cá nhân** — mã sinh viên, lớp, nhóm, vai trò trong từng case, lịch
thuyết trình, bài đã nộp, câu hỏi đã đặt, điểm đã công bố, nhận xét.

### Module 02. Phân quyền

| Chức năng                | Admin      | Giảng viên | Sinh viên   |
| ------------------------ | ---------- | ---------- | ----------- |
| Quản lý tài khoản        | ✓          | Trong lớp  | Cá nhân     |
| Tạo học phần             | ✓          | Theo quyền | –           |
| Tạo lớp                  | ✓          | ✓          | –           |
| Tạo nhóm                 | ✓          | ✓          | –           |
| Tham gia nhóm            | –          | –          | ✓           |
| Upload case              | ✓          | ✓          | –           |
| Nộp slide/báo cáo        | –          | –          | ✓           |
| Đặt câu hỏi              | ✓          | ✓          | ✓           |
| Chấm bài thuyết trình    | Theo quyền | ✓          | Peer review |
| Phê duyệt điểm cuối cùng | –          | ✓          | –           |
| Xem điểm toàn trường     | ✓          | –          | –           |
| Xem điểm lớp             | ✓          | ✓          | Theo quyền  |
| Cấu hình AI              | ✓          | Giới hạn   | –           |

> **Nguyên tắc bảo mật:** phân quyền phải được kiểm tra tại backend **và**
> Firestore Security Rules. Ẩn nút trên giao diện không phải là bảo mật.

### Module 03. Admin Dashboard

- **Quản lý người dùng:** tạo, khóa/mở, đổi vai trò, import CSV/XLSX, tìm kiếm,
  xử lý trùng. Mọi thay đổi vai trò Admin/Giảng viên phải ghi audit log.
- **Quản lý đào tạo:** `University → Academic Year → Semester → Course → Class →
{Lecturer, Students, Groups, Case Studies, Presentation Sessions}`.
- **Quản lý hệ thống:** ngôn ngữ, chính sách upload, dung lượng file, dịch vụ
  AI, hạn mức chi phí AI, thời gian lưu trữ, thông báo, sao lưu, nhật ký.
- **Chỉ số dashboard:** người dùng hoạt động, lớp đang triển khai, buổi thuyết
  trình, số bài nộp, số lượt đánh giá AI, chi phí AI ước tính.

### Module 04. Lecturer Dashboard

- **Tạo lớp:** tên lớp, học phần, năm học, học kỳ, số SV dự kiến, ngôn ngữ mặc
  định, cấu hình đánh giá. Mỗi lớp có Class Code và trang quản trị riêng.
- **Quản lý tiến độ:** trạng thái từng nhóm (Case / Slides / AI Review /
  Lecturer), lọc theo chưa nộp, nộp muộn, chờ AI, chờ chấm điểm.

### Module 05. Case Study Library

**5.1 Upload:** PDF, DOCX (case và hướng dẫn), PPTX (slide mẫu), URL, video link.

**5.2 Metadata:** Case ID, tiêu đề, công ty, ngành, học phần, chương/buổi, mô tả,
mục tiêu học tập, CLO mapping, câu hỏi chính, câu hỏi phụ, deliverables bắt buộc,
presentation guide, rubric, tài liệu tham khảo, ngày phát hành, hạn nộp, ngày
thuyết trình, nhóm được giao, trạng thái.

> Phân biệt **Case Study Template** (nội dung gốc, tái sử dụng nhiều lớp, nhiều
> học kỳ) và **Case Assignment** (một lần giao bài cụ thể).

**5.3 Phân tích tài liệu bằng AI:** đề xuất tóm tắt, central problem, vấn đề quản
trị, key facts, khái niệm liên quan, discussion questions, CLO mapping, câu hỏi
phản biện. **Nội dung AI chỉ là bản nháp**, giảng viên phải duyệt trước khi công
bố. Lưu cả tài liệu gốc và dữ liệu AI trích xuất; không coi diễn giải của AI là
tài liệu gốc.

### Module 06. Presentation Guide (khung thuyết trình)

Template mặc định: **E-Commerce 2026 – Standard Case Study Presentation
Framework**, cài đặt trong `packages/shared/src/policy/presentation-policy.ts`.

**6.1 Quy định chung**

| Nội dung          | Giá trị mặc định                      |
| ----------------- | ------------------------------------- |
| Số sinh viên/nhóm | 4–6                                   |
| Thuyết trình      | 18–20 phút (3–4 phút mỗi vai trò)     |
| Q&A               | 8–10 phút                             |
| Slide nội dung    | 14–18 (không tính bìa và trang nguồn) |
| Thời hạn nộp      | 24 giờ trước buổi thuyết trình        |
| Điểm nhóm         | 80%                                   |
| Điểm cá nhân      | 20%                                   |
| Dừng thuyết trình | quá 22 phút                           |
| Phạt nộp muộn     | −10 điểm/100                          |

**6.2 Sáu vai trò thuyết trình** — chuỗi lập luận:
`Context → Mechanism → Numbers → Critique → Transfer → Decision`

| Vai trò           | Trình bày                                                   | Phút | Phải trả lời được                             |
| ----------------- | ----------------------------------------------------------- | ---- | --------------------------------------------- |
| R1 Context Setter | Bối cảnh doanh nghiệp, vấn đề trung tâm, liên hệ chương học | 3    | Nếu bỏ case này khỏi chương, lớp mất gì?      |
| R2 Model Analyst  | Mô hình kinh doanh: tạo – cung cấp – thu nhận giá trị       | 4    | Doanh nghiệp thực sự kiếm tiền ở đâu?         |
| R3 Data Analyst   | Số liệu, KPI, unit economics, tối thiểu một phép tính       | 4    | Con số nào chứng minh điều vừa nói?           |
| R4 Critic         | Rủi ro, giả định sai, điều kiện thất bại                    | 3    | Điều gì phải đúng thì kết luận mới đứng vững? |
| R5 Transfer Lead  | Điều kiện áp dụng tại Việt Nam                              | 3    | Phần nào doanh nghiệp Việt Nam copy được?     |
| R6 Decision Lead  | Ba bài học, quyết định quản trị, điều phối Q&A              | 3    | Ở vị trí CEO, nhóm quyết định thế nào?        |

**6.3 Auto Assign Roles** — bảng gộp vai theo quy mô nhóm:

| Vai trò | Nhóm 6 | Nhóm 5 | Nhóm 4        |
| ------- | ------ | ------ | ------------- |
| R1      | SV1    | SV1    | SV1 (kiêm R5) |
| R2      | SV2    | SV2    | SV2           |
| R3      | SV3    | SV3    | SV3           |
| R4      | SV4    | SV4    | SV4 (kiêm R6) |
| R5      | SV5    | SV1    | SV1           |
| R6      | SV6    | SV5    | SV4           |

**R3 và R4 không bao giờ được bỏ** — đây là hai vai trò đo năng lực phân tích và
phản biện. Giảng viên hoặc trưởng nhóm có thể chỉnh sửa phân vai nếu được cấp
quyền.

**6.4 Khung 16 slide** — bìa; vấn đề trung tâm; bối cảnh; liên hệ chương; mô hình
kinh doanh; cơ chế vận hành; lợi thế cạnh tranh; chỉ số chính; một phép tính từng
bước; điều các con số không nói; rủi ro; giả định dễ sai nhất; điều kiện áp dụng
tại Việt Nam; cái gì dùng được; ba bài học; quyết định quản trị. Số slide phải
điều chỉnh được cho học phần khác.

### Module 07. Nhóm và phân công

**7.1 Ba chế độ tạo nhóm:** Lecturer Assignment, Student Self-Join, Random
Grouping. Random Grouping không được vượt số thành viên tối đa và không bỏ sót
sinh viên.

**7.2 Điều kiện join nhóm:** sinh viên phải thuộc lớp; không tham gia hai nhóm
đồng thời trong cùng một cấu hình nhóm học phần; không vượt số thành viên; nhóm
đã khóa chỉ giảng viên đổi được.

> Kiểm tra số lượng thành viên **bắt buộc dùng Firestore Transaction** để tránh
> hai sinh viên cùng chiếm chỗ cuối cùng.

**7.3 Group Workspace:** phân vai, tải tài liệu, nộp bài, xem deadline, theo dõi
phản hồi, xem điểm sau khi công bố.

### Module 08. Presentation Scheduler

Mỗi buổi thuyết trình: ngày, giờ, lớp, nhóm, case, phòng, hạn nộp, trạng thái.

Trạng thái: `Scheduled → Submission Open → Ready → Live Presentation → Under
Review → Completed`.

Thông báo trước hạn nộp, khi có bài mới, khi AI xong, khi công bố điểm.

> Deadline và thời gian nộp thực tế xác định bằng **thời gian server**, không phụ
> thuộc đồng hồ thiết bị sinh viên. Gia hạn, cho nộp lại, miễn phạt do giảng viên
> quyết định và phải có lịch sử thay đổi.

### Module 09. Bài nộp

| Deliverable           | Định dạng                    | Bắt buộc              |
| --------------------- | ---------------------------- | --------------------- |
| Presentation Slides   | PDF                          | ✓                     |
| Source Slides         | PPTX hoặc link Google Slides | ✓                     |
| Role Allocation Sheet | PDF/ảnh                      | ✓                     |
| Reference List        | trong slide hoặc file        | ✓                     |
| AI Usage Disclosure   | form theo mẫu học phần       | ✓                     |
| Case Analysis Report  | PDF/DOCX                     | Giảng viên quyết định |

**Submission History** lưu: submission ID, group, case, assignment, người nộp,
thời điểm, tên file, loại file, dung lượng, storage path, version number,
`isLate`, trạng thái. **Không được ghi đè làm mất bản nộp trước.**

Hệ thống tự kiểm tra deliverable bắt buộc, định dạng, dung lượng, thời điểm nộp
và trạng thái xử lý file; báo rõ khi thiếu file.

---

## Phần IV. Tương tác trong buổi thuyết trình (Phase 2)

### Module 10. Live Presentation Room

- **Timer:** Pause/Resume, ghi thời gian thực tế, chuyển sang Q&A, chuyển người
  thuyết trình R1 → R6, ghi thời gian theo vai trò kể cả khi một SV kiêm hai vai.
- **Đặt câu hỏi:** mọi sinh viên đặt câu hỏi trên điện thoại. Form gồm nhóm đích,
  vai trò liên quan, loại câu hỏi, nội dung. Loại câu hỏi: Clarification,
  Evidence, Critical Question, Application, Management Decision.
- **Question Wall:** realtime, trạng thái `Submitted → Selected for Q&A →
Answered → Closed`; upvote một lần mỗi người mỗi câu; cho phép ẩn tên trước lớp
  nhưng giảng viên vẫn xác định được người gửi.
- **Q&A theo vai trò:** chọn câu hỏi thuộc R3 thì hệ thống hiển thị SV phụ trách
  R3 và ghi nhận người trả lời thực tế.
- **Q&A Completion Checklist:** tối thiểu 2 câu hỏi của lớp; tối thiểu 1 phản
  biện từ nhóm ghép cặp; mọi thành viên đã trả lời ít nhất một câu; đã thuyết
  trình xong; đã đóng cửa sổ peer review.

### Module 11. Peer Assessment

- Sinh viên không được đánh giá nhóm mình.
- Chỉ sinh viên thuộc lớp và được giảng viên cho phép mới được chấm.
- Mỗi sinh viên chỉ có **một phiếu hợp lệ** cho mỗi phiên.
- Giảng viên quy định thời gian mở/đóng bình chọn.
- Phiếu 5 tiêu chí thang 1–5: hiểu case, chất lượng phân tích, minh chứng và số
  liệu, tư duy phản biện, chất lượng trình bày + nhận xét bắt buộc.
- **Mặc định: peer assessment là phản hồi học tập, không tự động thành điểm
  chính thức.** Giảng viên quyết định có đưa vào điểm hay không.

---

## Phần V. AI Assessment (Phase 3)

### Module 12. AI Slide & Report Evaluation

AI đọc **case gốc + presentation guide + rubric + bài nộp** để tạo phản hồi có
cấu trúc cho giảng viên. Không chấm slide theo mức độ "đẹp".

| Nội dung                               | AI có thể thực hiện         |
| -------------------------------------- | --------------------------- |
| Đọc và phân tích slide                 | Có                          |
| Phân tích báo cáo                      | Có                          |
| Đối chiếu với case study               | Có                          |
| Kiểm tra sự xuất hiện của minh chứng   | Có                          |
| Kiểm tra logic và phép tính trích xuất | Có, có giới hạn             |
| Đánh giá bố cục hình ảnh               | Có, nếu xử lý được hình ảnh |
| Đánh giá kỹ năng thuyết trình thực tế  | **Không** (chỉ từ file)     |
| Đánh giá câu trả lời Q&A               | Khi có dữ liệu câu trả lời  |
| Quyết định điểm cuối cùng              | **Giảng viên**              |

**Pipeline:** Input → Document Processing → Case-Grounded Analysis → Rubric
Evaluation → Lecturer Review (Accept/Modify/Reject) → Final Feedback & Grade.

**Rubric chuẩn (100 điểm):**

| Tiêu chí                  | Điểm | AI chấm nháp   | CLO (minh họa)   |
| ------------------------- | ---- | -------------- | ---------------- |
| Understanding the Case    | 20   | ✓              | CLO1             |
| Quality of Analysis       | 25   | ✓              | CLO1, CLO2       |
| Evidence and Figures      | 15   | ✓              | CLO1, CLO2       |
| Critique                  | 15   | ✓              | CLO6             |
| Transfer and Decision     | 15   | ✓              | CLO2, CLO4, CLO6 |
| Delivery and Coordination | 10   | **Giảng viên** | –                |

Mỗi nhận xét quan trọng phải dẫn được đến slide, trang báo cáo hoặc đoạn tài liệu
gốc. Nếu file không đọc được hoặc thiếu minh chứng, AI phải báo rõ tình trạng
thay vì tự tạo nội dung hoặc mặc định cho 0 điểm.

**AI Question Generator** và **AI Learning Feedback** (What you did well → What
needs improvement → Why it matters → How to improve), kèm Compare Versions.

### Module 13. Lecturer Assessment & Grade Finalization

Màn hình chấm hiển thị cùng lúc: bài nộp, rubric, nhận xét AI, kết quả peer
assessment, thông tin Q&A. Giảng viên nhập điểm theo tiêu chí, tham khảo hoặc bỏ
qua điểm AI, viết nhận xét và công bố.

```
Final = 0.8 × GroupScore + 0.2 × IndividualScore
```

**Academic Assessment Policy Engine** — các quy tắc phải có version để điểm đã
công bố không thay đổi khi giảng viên sửa chính sách cho buổi sau. Giảng viên
được ghi đè hình phạt nhưng phải có lý do và lịch sử thay đổi.

Quy tắc mặc định: SV không thuyết trình hoặc không trả lời được câu hỏi thuộc vai
trò của mình mất toàn bộ 20% điểm cá nhân; nộp muộn trừ 10/100; thuyết trình quá
22 phút bị dừng.

---

## Phần VI. Bảng điểm và Learning Analytics (Phase 4)

- **Bảng điểm nhóm và cá nhân** — thành viên cùng nhóm có thể có điểm khác nhau.
- **Class Analytics** — điểm trung bình lớp/nhóm, phân phối theo rubric, tỷ lệ
  nộp đúng hạn, tỷ lệ tham gia Q&A, số SV chưa đặt câu hỏi, mức đạt CLO, năng lực
  còn yếu của lớp.
- **CLO Analytics** — mỗi criterion liên kết một hoặc nhiều CLO; tính mức đạt CLO
  dựa trên điểm rubric **đã được giảng viên phê duyệt**.
- **Learning Evidence Portfolio** — case đã hoàn thành, vai trò đã đảm nhiệm, bài
  nộp và các phiên bản, câu hỏi đã đặt, câu trả lời, điểm và nhận xét, CLO
  attainment.

**Chức năng nâng cao:** AI Case Study Tutor (4 chế độ: Guided Learning, Research
Assistant, Submission Review, Lecturer Assessment), AI Question Generator, Group
Contribution Tracker, Presentation Rehearsal, Peer Assessment, Live Polling, AI
Feedback Comparison, CLO Analytics, Student Portfolio, LMS Integration.

---

## Phần VII. Giao diện và ngôn ngữ

- Song ngữ Việt/Anh qua cơ chế i18n tập trung, **không viết hai phiên bản giao
  diện tách biệt**.
- **Ngôn ngữ giao diện độc lập với ngôn ngữ học liệu.** AI nhận cấu hình ngôn ngữ
  phản hồi riêng.
- Phong cách hiện đại, tối giản, phù hợp môi trường đại học và MBA. Màu: xanh lá
  đậm, trắng, xám nhạt, xanh dương phụ trợ.
- Sidebar trên desktop, điều hướng phù hợp mobile, dashboard dạng card, bảng dữ
  liệu có bộ lọc, PDF viewer, chế độ sáng/tối, thông báo toast.
- **Live Presentation Room phải tối ưu cho điện thoại.**
- Hỗ trợ bàn phím, nhãn cho screen reader, độ tương phản tốt, trạng thái focus rõ.

---

## Phần VIII. Kiến trúc công nghệ

| Thành phần        | Công nghệ                                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| Frontend          | Next.js + React + TypeScript + Tailwind CSS                                |
| Backend           | Google Cloud Run (modular monolith)                                        |
| Authentication    | Firebase Authentication                                                    |
| Database          | Cloud Firestore                                                            |
| File Storage      | Cloud Storage for Firebase                                                 |
| AI                | Gemini API (Secret Manager), lớp provider tách riêng để đổi sang Vertex AI |
| Xử lý bất đồng bộ | Cloud Tasks + Cloud Run Worker (Phase 3)                                   |
| Secrets           | Google Secret Manager                                                      |

**13 module logic** (không tách microservice ở giai đoạn đầu): Auth, Class,
Group, Case, Submission, Presentation, Question, Peer Review, AI Assessment,
Grade, Analytics, Notification, Audit.

---

## Phần IX. Mô hình dữ liệu Firestore

Xem `docs/03-data-model.md`. Danh sách collection được khai báo tập trung tại
`packages/shared/src/collections.ts`.

Nguyên tắc: **Firebase UID là định danh xác thực**; Student ID chỉ là mã nghiệp
vụ và phải được kiểm tra tính duy nhất.

---

## Phần X. Bảo mật và chất lượng AI

**Bảo mật:**

- Mọi chức năng quản lý lớp và bài tập yêu cầu đăng nhập.
- Sinh viên chỉ xem dữ liệu lớp mình và tài liệu đã công bố.
- Thành viên không sửa được bài nộp của nhóm khác.
- Sinh viên chỉ xem điểm cá nhân của mình; bảng điểm lớp công bố theo phạm vi
  giảng viên cho phép.
- Thao tác quản trị phải xác thực và ghi nhật ký.
- File học liệu, file nộp, báo cáo đánh giá **không bao giờ public**.
- Chỉ gửi dữ liệu cần thiết đến dịch vụ AI; API key quản lý bằng Secret Manager.
- Audit log: sửa điểm, xóa bài, đổi deadline, đổi phân quyền.

**Độ tin cậy của AI:** mỗi nhận xét phân biệt Observation / Reference /
Assessment / Improvement. Với số liệu, phân biệt số liệu công bố trong case và
giả định dùng cho bài tập. Kiểm tra file đầu vào, giới hạn dung lượng, **chống
prompt injection trong tài liệu upload**; nội dung tài liệu không được thay đổi
quy tắc chấm điểm. Không dùng "phát hiện văn bản do AI viết" làm bằng chứng chắc
chắn về vi phạm học thuật.

---

## Phần XI. Lộ trình phát triển

| Phase                           | Nội dung                                                                                               | Kết quả                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **1. Core Platform**            | Auth, roles, classes, groups, case library, presentation guide, assignments, submissions, i18n         | Tổ chức được một học phần Case Study thực tế       |
| **2. Interactive Presentation** | Live room, question wall, Q&A, timer, peer assessment, realtime notification                           | Cả lớp tương tác bằng điện thoại                   |
| **3. AI Assessment**            | Document processing, AI slide/report evaluation, question generator, lecturer assessment, grade engine | Giảng viên tham khảo AI, tự chấm và công bố điểm   |
| **4. Analytics & Integration**  | CLO analytics, portfolio, contribution tracker, LMS integration                                        | Thành phần trong hệ sinh thái AI Learning Platform |

Không xây dựng chức năng nâng cao trước khi luồng lõi được kiểm thử thành công.

---

## Phần XII. Yêu cầu kỹ thuật bắt buộc

| Hạng mục   | Yêu cầu                      |
| ---------- | ---------------------------- |
| Language   | TypeScript (strict)          |
| Frontend   | Next.js + React              |
| UI         | Tailwind CSS                 |
| Auth       | Firebase Auth                |
| Database   | Cloud Firestore              |
| Storage    | Cloud Storage for Firebase   |
| Backend    | Cloud Run                    |
| Validation | Zod                          |
| Forms      | React Hook Form              |
| i18n       | Cơ chế bản địa hóa tập trung |
| Testing    | Unit + Integration + E2E     |
| Deployment | Docker + GCP                 |
| Secrets    | Secret Manager               |

Bắt buộc có: file cấu hình môi trường, Firebase Security Rules, Firestore
Indexes, Dockerfile, README. Dùng Firebase Emulator Suite để kiểm thử nghiệp vụ
và bảo mật trước khi triển khai production.

### Acceptance test bắt buộc

1. Sinh viên đăng ký, đăng nhập và join đúng lớp.
2. Sinh viên không join hai nhóm trái chính sách lớp.
3. Giảng viên tạo case và phân công nhóm thành công.
4. Bài nộp lưu đúng người, nhóm, deadline và phiên bản.
5. Sinh viên không chấm điểm được nhóm mình.
6. Mỗi sinh viên chỉ có một peer review hợp lệ.
7. Sinh viên không tự sửa được điểm.
8. AI Assessment thất bại không làm mất bài nộp.
9. Điểm cuối cùng chỉ công bố sau khi giảng viên phê duyệt.
10. Hai ngôn ngữ hoạt động xuyên suốt giao diện.
11. Hệ thống xử lý đúng hai sinh viên cùng join nhóm gần đầy.
12. Thay đổi rubric không làm sai lệch điểm đã công bố.

Ngoài ra: unit test cho trọng số điểm, làm tròn, phạt nộp muộn và quyền ghi đè
của giảng viên.

Tình trạng hiện tại xem `docs/05-testing.md`.

---

## Phần XIII. Ba giá trị cốt lõi

1. **Case Study Management** — quản lý hệ thống toàn bộ tình huống, tài liệu,
   hướng dẫn, nhóm, lịch trình, bài nộp và kết quả.
2. **Interactive Classroom** — biến buổi thuyết trình từ "một nhóm nói, các nhóm
   nghe" thành hoạt động có tham gia, đặt câu hỏi, phản biện và đánh giá.
3. **AI-Powered Evidence-Based Assessment** — kết hợp phân tích AI, đánh giá của
   sinh viên và quyết định của giảng viên, lưu giữ minh chứng để đánh giá sự phát
   triển năng lực qua nhiều case study.

**Định hướng dài hạn:** ứng dụng độc lập nhưng kiến trúc sẵn sàng tích hợp
Moodle và nền tảng hồ sơ năng lực sinh viên.
