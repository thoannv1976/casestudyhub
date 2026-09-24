# Kiến trúc

## Tổng thể

```
Trình duyệt (desktop + mobile)
        │  HTTPS
        ▼
Cloud Run: casestudyhub-web
  Next.js App Router
   ├── Server Components   render dữ liệu đã kiểm tra quyền
   ├── Route Handlers      API nghiệp vụ (BFF), kiểm tra quyền lần 1
   └── Client Components   tương tác realtime (Phase 2)
        │
        ├── Firebase Authentication      danh tính + custom claims (role)
        ├── Cloud Firestore              dữ liệu nghiệp vụ, kiểm tra quyền lần 2
        ├── Cloud Storage                học liệu và bài nộp (đi qua server)
        └── Secret Manager               API key
        │
        ▼ (Phase 3)
Cloud Tasks ──► Cloud Run: casestudyhub-worker
                 ├── trích xuất PDF/DOCX/PPTX
                 └── Gemini API: chấm rubric, sinh câu hỏi
```

## Vì sao là modular monolith

SRS yêu cầu 13 "service" nghiệp vụ. Ở giai đoạn đầu chúng là **module logic độc
lập trong một tiến trình**, không phải 13 microservice: ít hạ tầng phải vận hành,
transaction đơn giản, kiểm thử và sửa lỗi nhanh. Ranh giới module được giữ rõ
ràng để sau này tách ra khi thực sự cần.

Chỉ có worker AI được tách riêng ở Phase 3, vì đó là loại việc chạy lâu, cần
retry và hạn mức riêng — hoàn toàn khác với một request web.

## Phân lớp

| Lớp       | Vị trí                                 | Trách nhiệm                                                       |
| --------- | -------------------------------------- | ----------------------------------------------------------------- |
| UI        | `apps/web/src/app`, `components`       | Hiển thị, i18n, accessibility                                     |
| API       | `apps/web/src/app/api/**/route.ts`     | Xác thực, kiểm tra quyền, validate bằng Zod, gọi module nghiệp vụ |
| Nghiệp vụ | `packages/core/src/<module>`           | Quy tắc nghiệp vụ, transaction, audit log                         |
| Miền      | `packages/shared/src/domain`, `policy` | Kiểu dữ liệu, schema, quy tắc học thuật — không phụ thuộc hạ tầng |
| Hạ tầng   | `packages/core/src/firebase`           | Firebase Admin, Firestore, Storage                                |

`packages/shared` **không được** import `firebase-admin` hay bất cứ thứ gì phụ
thuộc runtime: nhờ vậy policy engine chạy được cả trên server, trên trình duyệt
và trong unit test không cần emulator.

## Bảo mật hai lớp

Mỗi thao tác ghi đi qua:

1. **Route handler** — kiểm tra ID token, đọc custom claims, kiểm tra quyền, kiểm
   tra ràng buộc nghiệp vụ, chạy transaction, ghi audit log.
2. **Firestore Security Rules** — chặn mọi đường ghi trực tiếp từ client không
   thỏa điều kiện.

Rules mặc định là **deny-all**. Một collection chỉ được mở khi module tương ứng
đã có đủ kiểm tra phía server và test trên emulator.

## Policy engine

Toàn bộ quy định học thuật (quy mô nhóm, thời lượng, số slide, hạn nộp, trọng số
điểm, mức phạt, rubric, sáu vai trò, khung slide, danh mục deliverable) nằm trong
`packages/shared/src/policy/presentation-policy.ts` dưới dạng **dữ liệu có
version**.

Hệ quả:

- Học phần khác chỉ cần một policy khác, không phải sửa code.
- Sửa quy định tạo **version mới**; điểm đã công bố giữ nguyên version cũ nên
  không bao giờ bị tính lại sai (acceptance test số 12).
- Mọi điểm đều giải thích được: `ScoreBreakdown` ghi rõ điểm thô, mức phạt, phần
  bị mất, trọng số và version policy đã dùng.

## File không bao giờ public

Học liệu và bài nộp nằm trong một bucket bật `public-access-prevention`, và
**mọi lượt tải đều đi qua một route handler** kiểm tra quyền trước khi trả byte
đầu tiên: sinh viên chỉ đọc được case đã công bố.

Cách còn lại là phát signed URL. Nhanh hơn và đỡ tốn băng thông Cloud Run, nhưng
một khi đã phát ra thì đường link đó tự nó là quyền truy cập — ai có link cũng
đọc được, kể cả người ngoài học phần. Với tài liệu học thuật và bài nộp của sinh
viên, đánh đổi đó không đáng. Khi băng thông thành vấn đề thì đổi sang signed URL
có thời hạn ngắn, và chỗ phải sửa chỉ nằm trong `packages/core/src/cases/`.

Hệ quả kỹ thuật: file được nạp vào bộ nhớ của request handler, nên nền tảng đặt
trần **32 MB** cho mỗi file, thấp hơn mức chính sách học phần cho phép. Muốn
nâng trần thì phải chuyển sang resumable upload trước.

## i18n

`next-intl` với tiền tố locale trong URL (`/vi`, `/en`). Ngôn ngữ giao diện độc
lập với ngôn ngữ học liệu: một sinh viên có thể dùng giao diện tiếng Việt nhưng
đọc case tiếng Anh. Hai file thông điệp `apps/web/messages/{vi,en}.json` phải
luôn có cùng bộ khóa.

## Thời gian

Deadline, thời điểm nộp và trạng thái nộp muộn luôn lấy từ **đồng hồ server**
(`FieldValue.serverTimestamp()`), không bao giờ từ thiết bị người dùng.

## Đồng thời

Mọi thao tác có thể phá vỡ ràng buộc khi chạy song song đều dùng Firestore
Transaction: join nhóm (không vượt sĩ số), peer review (một phiếu mỗi người mỗi
phiên), upvote (một lần mỗi câu hỏi), tạo version bài nộp.
