# Kiểm thử

## Chạy

```bash
npm test              # toàn bộ unit test
npm run test:watch    # chế độ watch
npm test -- grading   # lọc theo tên file
```

## Ba tầng

| Tầng        | Công cụ                    | Phạm vi                                                | Trạng thái     |
| ----------- | -------------------------- | ------------------------------------------------------ | -------------- |
| Unit        | Vitest                     | Policy engine, tính điểm, phân vai, phân quyền, schema | ✅ PR 1        |
| Integration | Vitest + Firebase Emulator | Security Rules, transaction, luồng nghiệp vụ           | ⏳ PR 2 trở đi |
| E2E         | Playwright                 | Luồng người dùng thật qua trình duyệt                  | ⏳ PR 7        |

## 12 acceptance test bắt buộc (SRS Phần XIV.23)

| #   | Kịch bản                                          | Tầng                      | PR           | Trạng thái |
| --- | ------------------------------------------------- | ------------------------- | ------------ | ---------- |
| 1   | Sinh viên đăng ký, đăng nhập và join đúng lớp     | Integration + E2E         | 2–3          | ⏳         |
| 2   | Sinh viên không join hai nhóm trái chính sách lớp | Integration               | 4            | ⏳         |
| 3   | Giảng viên tạo case và phân công nhóm thành công  | Integration               | 5–6          | ⏳         |
| 4   | Bài nộp lưu đúng người, nhóm, deadline, phiên bản | Integration               | 6            | ⏳         |
| 5   | Sinh viên không chấm được nhóm mình               | Rules + Integration       | Phase 2      | ⏳         |
| 6   | Mỗi sinh viên chỉ có một peer review hợp lệ       | Integration               | Phase 2      | ⏳         |
| 7   | Sinh viên không tự sửa được điểm                  | Rules                     | 2 (nền)      | ⏳         |
| 8   | AI Assessment thất bại không làm mất bài nộp      | Integration               | Phase 3      | ⏳         |
| 9   | Điểm chỉ công bố sau khi giảng viên phê duyệt     | Integration               | Phase 3      | ⏳         |
| 10  | Hai ngôn ngữ hoạt động xuyên suốt giao diện       | Unit + E2E                | 1 (một phần) | 🟡         |
| 11  | Hai sinh viên cùng join nhóm gần đầy              | Integration (transaction) | 4            | ⏳         |
| 12  | Đổi rubric không làm sai lệch điểm đã công bố     | Unit                      | 1            | ✅         |

## Đã có (PR 1) — 49 test

**Policy engine & tính điểm** (`packages/shared/src/__tests__/grading.test.ts`)

- Policy mặc định khớp đúng Presentation Guide: nhóm 4–6, 18–20 phút, Q&A 8–10
  phút, 14–18 slide, hạn nộp 24 giờ, 80/20, phạt muộn 10 điểm.
- Rubric 6 tiêu chí cộng đúng 100 điểm, đúng thứ tự 20/25/15/15/15/10.
- Tiêu chí _Delivery and Coordination_ dành riêng cho giảng viên, AI không chấm.
- Từ chối policy có trọng số không cộng thành 1, rubric không cộng đủ tổng điểm.
- Công thức `0.8 × nhóm + 0.2 × cá nhân` đúng với ví dụ 85/90 → 86.
- Thành viên cùng nhóm có điểm cuối khác nhau.
- Phạt nộp muộn trừ vào điểm nhóm trước khi nhân trọng số; giảng viên miễn phạt
  được và mức miễn có hiệu lực.
- Mất toàn bộ 20% khi không thuyết trình hoặc không trả lời được câu hỏi thuộc
  vai trò của mình.
- Điểm luôn nằm trong 0..100; làm tròn nửa lên đúng kể cả `1.005`.
- **Đổi policy tạo version mới, điểm đã công bố không đổi** (test số 12).
- Rubric từ chối tiêu chí lạ và điểm vượt trần của tiêu chí.
- Deadline tính từ giờ server, cờ nộp muộn đúng ở ranh giới.

**Phân vai** (`role-allocation.test.ts`)

- Nhóm 6/5/4 khớp đúng bảng gộp vai của Guide.
- **R3 và R4 không bao giờ bị bỏ**, mọi vai đều có người, không ai không có vai.
- Thứ tự chuỗi lập luận R1→R6 được giữ.
- Từ chối nhóm nhỏ hơn hoặc lớn hơn quy định, kèm mã lỗi phân biệt được.
- Khung 16 slide phủ đủ 6 vai trò và nằm trong giới hạn số slide.
- Danh mục deliverable bắt buộc khớp checklist của Guide.

**Phân quyền** (`permissions.test.ts`)

- Chỉ giảng viên công bố được điểm; admin thì không.
- Sinh viên không quản lý user, không cấu hình hệ thống, không cấu hình AI.
- Chỉ admin xem được điểm toàn trường.
- Mã sinh viên và class code được validate đúng định dạng.

**Hạ tầng** (`packages/core/src/__tests__/`)

- `AppError` ánh xạ đúng mã lỗi sang HTTP status, trả payload có khóa i18n, không
  lộ thông tin nội bộ.
- Biến môi trường thiếu thì báo rõ tên biến thay vì lỗi mơ hồ.

## Kiểm thử Security Rules (từ PR 2)

```bash
npm run emulators                        # terminal 1
npm test -- rules                        # terminal 2
```

Rules test chạy trên Firebase Emulator, không chạm vào dữ liệu thật. Mỗi
collection được mở trong rules phải có test chứng minh: người đúng quyền ghi
được, người sai quyền bị chặn.
