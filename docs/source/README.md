# Tài liệu gốc

Đây là các tài liệu do giảng viên cung cấp, giữ nguyên bản. Mọi quy định học
thuật trong ứng dụng đều bắt nguồn từ đây — khi có tranh chấp về một con số hay
một quy tắc, các file này là nguồn đúng.

| File | Vai trò |
|---|---|
| `NEW_AI9-AI23_Case_study_HUB.pdf` | Bản đặc tả SRS v1.0, 45 trang. Nguồn của `PRODUCT_SPEC.md` |
| `Case_Study_Presentation_Guide_EN.docx` | Khung thuyết trình: 6 vai trò, bảng gộp vai, khung 16 slide, rubric 100 điểm, ngưỡng điểm. Nguồn của policy mặc định trong `packages/shared/src/policy/` |
| `G1_Case_01_Amazon_EN.docx` | Case study mẫu (Amazon). Dùng làm dữ liệu seed và dữ liệu kiểm thử cho upload, trích xuất và đánh giá AI |
| `Mo_ta_Case_study_HUB.docx` | Master Build Instruction (trùng Phần XV của SRS) |

## Case mẫu Amazon — metadata dùng để seed

| Trường | Giá trị |
|---|---|
| Case code | `CASE01` |
| Title | Amazon |
| Subtitle | From an online bookstore to the infrastructure of global commerce |
| Company / Industry | Amazon.com, Inc. / Marketplace, logistics, advertising, cloud computing |
| Course | E-Commerce 2026 |
| Chapter | Session 1 — from online selling to Digital Commerce and AI Commerce |
| CLO mapping | CLO1 (chính), CLO2, CLO4, CLO6 |
| Central question | Câu hỏi đúng không phải "Amazon bán gì" mà "Amazon kiểm soát những phần nào của hành trình khách hàng" |
| Discussion questions | 3 câu (Analyze / Evaluate / Create theo thang Bloom) |
| Paired group case | Walmart (Group 2) — nhóm thứ hai phản biện nhóm thứ nhất |

Case có sẵn các bảng số liệu (doanh thu theo mảng, lợi nhuận theo segment, bảng
rủi ro, so sánh điều kiện Mỹ – Việt Nam) và một phép tính từng bước về chi phí
thực của người bán trên marketplace — rất hợp để kiểm thử yêu cầu "R3 phải trình
bày tối thiểu một phép tính" và khả năng đối chiếu số liệu của AI ở Phase 3.
