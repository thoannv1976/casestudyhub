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

## Unit test — 87 test

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

**Đọc file danh sách sinh viên** (`roster-import.test.ts`, PR 3)

Đây là chỗ dữ liệu thật của khoa đi vào hệ thống, nên bộ test bám sát những gì
Excel thực sự xuất ra:

- Dấu phẩy nằm trong tên được đặt trong ngoặc kép; ngoặc kép lồng nhau.
- **BOM của Excel, dòng kết thúc CRLF, và dấu chấm phẩy** của Excel bản tiếng Việt.
- Tiêu đề cột tiếng Việt (`Mã sinh viên`, `Họ và tên`, `MSSV`) hay tiếng Anh, thứ tự bất kỳ.
- Dòng trống bị bỏ qua, không bị báo lỗi.
- Dòng sai **được báo kèm số dòng**, các dòng đúng vẫn nhập được.
- Trùng mã sinh viên hoặc trùng email **ngay trong file**, có chỉ ra dòng đầu tiên.
- Thiếu cột bắt buộc thì từ chối và nói rõ thiếu cột nào.
- Mọi thông báo lỗi là khóa i18n.
- Mã sinh viên dạng `../admin` bị từ chối — không để chuỗi lạ chui vào document id.

**Hợp đồng đăng ký** (`auth-contracts.test.ts`, PR 2)

- Hai mật khẩu không khớp báo lỗi đúng ở ô xác nhận.
- Mật khẩu phải đủ 8 ký tự và có cả chữ lẫn số; thông báo lỗi là **khóa i18n**
  chứ không phải câu tiếng Anh cứng.
- Email sai định dạng, tên quá ngắn, ngôn ngữ ngoài danh sách đều bị từ chối.
- **Client không tự chọn được vai trò**: gửi kèm `globalRole: admin` thì trường
  đó bị loại bỏ khỏi dữ liệu đã kiểm duyệt.
- Mã sinh viên từ chối `.`, `..` và ký tự `/` — những giá trị có thể phá cấu
  trúc document id của Firestore.
- Hồ sơ cá nhân chỉ nhận tên và ngôn ngữ; `globalRole`, `status`, `studentId`
  gửi lên bị loại bỏ.
- Mã sinh viên khác nhau về hoa thường được coi là **cùng một mã**.

**Hạ tầng** (`packages/core/src/__tests__/`)

- `AppError` ánh xạ đúng mã lỗi sang HTTP status, trả payload có khóa i18n, không
  lộ thông tin nội bộ.
- Biến môi trường thiếu thì báo rõ tên biến thay vì lỗi mơ hồ.

## Kiểm thử đầu-cuối (E2E)

```bash
npm run test:e2e
```

Lệnh này build ứng dụng với cấu hình trỏ vào emulator, bật Firebase Emulator,
tạo sẵn một tài khoản quản trị, rồi cho Playwright điều khiển trình duyệt chạy
trọn một câu chuyện. Toàn bộ mất khoảng 15 giây.

**Vì sao phải chạy trên bản build production, không phải `next dev`:** lỗi 500
khi tạo tài khoản giảng viên chỉ xuất hiện khi Next.js chia mã server thành
nhiều chunk — điều `next dev` không làm. Toàn bộ 87 unit test và 30 rules test
đều xanh trong khi production hỏng. E2E là lớp duy nhất bắt được loại lỗi đó.

### 12 kịch bản

1. Dịch vụ trả lời `/api/health` trước khi thử bất cứ điều gì khác.
2. Sinh viên đăng ký và vào được trang làm việc của mình.
3. **Không đăng ký được hai lần cùng một mã sinh viên** — và lần hỏng không để
   lại tài khoản rác.
4. Quản trị viên tạo năm học → học kỳ → học phần → lớp.
5. **Quản trị viên tạo tài khoản giảng viên kèm mật khẩu tạm** — chính là thao
   tác đã trả về 500 trên production.
6. Mật khẩu tạm **không vào được trang nào khác**: gõ thẳng địa chỉ khác vẫn bị
   đẩy về trang đổi mật khẩu; đổi xong mới vào được.
7. Mật khẩu tạm cũ **hết tác dụng** ngay sau khi đổi.
8. Sinh viên nhập mã lớp và vào được lớp.
9. Sinh viên **không vào được cùng một lớp hai lần**.
10. Giảng viên thấy đúng sinh viên đó trong danh sách lớp.
11. Sinh viên gõ thẳng địa chỉ trang quản trị thì **bị từ chối** và không thấy
    dữ liệu người dùng nào.
12. Khách chưa đăng nhập bị đẩy về trang đăng nhập.

## Kiểm thử đồng thời (PR 5)

`firebase/tests/group-concurrency.test.ts` chạy code nghiệp vụ thật qua Admin
SDK trên emulator, vì Security Rules **không diễn đạt được** quy tắc "chỉ một
người lấy được chỗ cuối" — đó là việc của transaction, và cách kiểm chứng trung
thực duy nhất là cho nhiều sinh viên cùng với tay vào một chỗ.

- Hai sinh viên cùng lúc giành chỗ cuối → **đúng một người được**, `memberCount`
  bằng 1 (acceptance test 11).
- Sáu sinh viên cùng lúc vào nhóm 4 chỗ → **đúng 4 người được**.
- Một sinh viên bấm vào hai nhóm cùng lúc → chỉ một nhóm nhận (acceptance test 2).
- Vào nhóm thứ hai tuần tự cũng bị từ chối.
- Nhóm đã khóa không nhận thêm ai; nhóm do giảng viên xếp thì sinh viên không tự vào được.

## Kiểm thử Security Rules

```bash
npm run test:rules
```

Lệnh này tự khởi động Firestore Emulator, chạy test rồi tắt emulator — không
chạm vào dữ liệu thật. Cần Java 21 (`sudo apt install openjdk-21-jre` nếu máy
chưa có); CI đã cài sẵn.

Nguyên tắc: mỗi collection được mở trong rules phải có test chứng minh cả hai
chiều — người đúng quyền ghi được, người sai quyền bị chặn.

### Đã có — 30 test rules

**`users`** — sinh viên đọc được hồ sơ của chính mình nhưng **không** đọc được
hồ sơ người khác và không liệt kê được toàn bộ tài khoản; giảng viên đọc và liệt
kê được; khách vãng lai không đọc được gì. Sinh viên sửa được tên và ngôn ngữ
của mình, nhưng **không tự nâng mình lên lecturer hay admin**, không sửa được mã
sinh viên hay email, và **tài khoản đang bị khóa không tự mở khóa được**. Không
ai — kể cả admin — tạo hoặc xóa được hồ sơ từ phía client; việc đó chỉ đi qua
server để giữ tính duy nhất của mã sinh viên.

**`studentIdIndex`** — không ai đọc hay ghi được từ client, kể cả admin. Đây là
chỉ mục bảo đảm mã sinh viên duy nhất; nếu client ghi được thì có thể chiếm chỗ
mã của người khác.

**`auditLogs` và `systemSettings`** — đóng hoàn toàn với mọi client, kể cả
admin. Nhật ký mà người bị ghi nhật ký sửa được thì không còn là nhật ký.

**Các collection của phase sau** — `grades`, `submissions`, `peerReviews` đều bị
từ chối cho tới khi module của chúng ra đời cùng rules và test riêng.

**`classes`** — sinh viên đã đăng nhập đọc được, khách không đọc được, và không
ai ghi được từ client.

**`classEnrollments`** (PR 3) — sinh viên đọc được dòng ghi danh của chính mình
nhưng **không** đọc được của bạn cùng lớp và không liệt kê được cả danh sách;
giảng viên đọc được toàn bộ roster. Sinh viên **không tự ghi danh bằng cách tạo
document**, **không tự chuyển trạng thái chờ duyệt thành đã vào lớp**, và
**không tự gỡ lệnh loại khỏi lớp**. Ngay cả giảng viên cũng không ghi trực tiếp
được — mọi thay đổi đi qua transaction trên server để giữ đúng sĩ số lớp.

**`rateLimits`** (PR 3) — không client nào đọc hay ghi được. Đọc được thì biết
còn bao nhiêu lượt thử; ghi được thì tự xoá giới hạn.
