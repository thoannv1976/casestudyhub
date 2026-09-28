# Prompt cho Claude Cowork — thử nộp file bằng tài khoản student1

Dán tiếp vào **phiên Cowork đang mở** (nơi đã đăng nhập student1), không cần mở phiên mới.

---

Bạn đang mở tab CaseStudy Hub và đã đăng nhập bằng tài khoản **student1**. Phiên này chỉ có **một việc chính**: chứng minh một file thật tải lên được. Chưa ai từng làm việc này trên bản production, và nếu nó hỏng thì cả lớp không nộp được bài — nên kết quả của nó quyết định việc tôi có mở app cho sinh viên dùng hay không.

**Giới hạn — vẫn như mọi phiên:**

- **KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn cho tôi.
- **KHÔNG tự tạo bucket**, không chạy `scripts/setup-firebase.sh`.
- **KHÔNG dán khóa API, KHÔNG đặt hạn nộp, KHÔNG chấm điểm, KHÔNG tạo lớp, KHÔNG tạo nhóm mới.**
- Được phép: **tham gia một nhóm có sẵn** bằng tài khoản student1, vì đó chính là việc sinh viên làm và là bước bắt buộc để nộp bài. Tham gia nhóm nào thì báo lại.

## Việc 1 — nộp thử một file (quan trọng nhất)

1. Vào **Lớp của tôi**, mở lớp student1 đang tham gia. Nếu student1 chưa ở trong lớp nào thì **dừng lại và báo** — tôi sẽ thêm vào lớp.
2. Trên trang lớp, xem student1 đã ở trong nhóm nào chưa. Nếu thẻ **Nhóm** hiện _Nhóm của bạn_ thì đi tiếp. Nếu chưa, bấm **Tham gia nhóm này** ở một nhóm chưa đầy, rồi báo tên nhóm đã chọn.
3. Tìm thẻ **Bài làm của nhóm** (hoặc **Bài tập lớn của lớp**) và một mục tài liệu nhận file — ví dụ _Slide thuyết trình (PDF)_ hoặc _Pitch deck (12–15 slide, PDF hoặc PPTX)_. Nếu không thấy thẻ nào, **chụp lại hoặc chép lại toàn bộ những gì có trên trang** rồi báo; đừng tự xoay xở.
4. Chọn một file **PDF nhỏ có sẵn trên máy** — ví dụ `01_-_Group_Project_Report_sample.pdf` nếu còn trong Downloads; không có thì lấy PDF bất kỳ dưới 5 MB. **Đừng tạo file mới trong Cloud Shell**: trình duyệt trên máy không mở được file nằm trong Cloud Shell.
5. Tải lên và cho tôi biết:
   - Có hiện dòng **"Đã nộp, phiên bản 1."** không (hoặc phiên bản mấy).
   - Sau khi nộp, bấm vào **tên file** vừa hiện ra: nó có mở đúng file PDF không, hay ra trang lỗi. Đây là phần thứ hai của phép thử — nộp được mà không mở lại được thì vẫn là hỏng.

**Nếu bước 5 lỗi** — làm đủ ba việc sau rồi mới báo:

1. Chép **nguyên văn** thông báo lỗi trên màn hình.
2. Mở Công cụ dành cho nhà phát triển (F12) → tab **Console** và tab **Network**, tìm yêu cầu bị đỏ, chép nguyên văn mã lỗi và phần trả về.
3. Chạy trong Cloud Shell và chép nguyên văn kết quả, kể cả khi nó báo không tìm thấy:

```bash
gcloud storage buckets describe gs://casestudy1-509414-files --project casestudy1-509414
```

Rồi **dừng lại**. Đừng tạo bucket, đừng sửa gì.

## Việc 2 — thẻ xung phong, nhìn từ phía sinh viên

Vẫn ở tài khoản student1, trên trang lớp:

- Có thẻ **Xung phong thuyết trình bài tập lớn** không.
- Vì giảng viên đang để số suất bằng 0, thẻ đó phải nói **"Giảng viên chưa mở đăng ký."** và **không** có nút _Nhóm tôi xung phong_.
- Nếu thấy khác, chép lại đúng chữ hiện trên màn hình.

## Việc 3 — thẻ bài tập lớn, nhìn từ phía sinh viên

- Có thẻ **Bài tập lớn của lớp** không, và nó có hiện hạn nộp không.
- Nếu hiện dòng _"Giảng viên chưa đặt hạn"_ hoặc không có thẻ nào thì cứ báo đúng như vậy — đó là do tôi chưa đặt hạn, không phải lỗi.

## Báo cáo

Trả lời theo đúng ba việc trên, mỗi việc một dòng kết luận **chạy được / không chạy được / chưa thử được**, kèm nguyên văn bất cứ thông báo lỗi nào. Việc 1 quan trọng hơn hai việc kia cộng lại — nếu chỉ kịp làm một việc, hãy làm việc 1.

---
