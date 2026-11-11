# Kế hoạch 11/11/2026 — Khoá mới ECOM OCT, gắn lại Moodle, công cụ lớp

Chủ dự án duyệt qua tin nhắn: "Đồng ý các đề xuất. Lập kế hoạch rồi làm luôn."

## Vì sao

Kiểm tra ngày 11/11 cho thấy app chạy ổn (không có lỗi từ 09/11), nhưng:

- **Khoá Moodle 33 (ECOM-OCT, khoá đang học) gắn vào lớp ECOM2 — lớp của khoá
  trước** (thuyết trình 5–15/10). Đối chiếu danh sách với ClassInteract: chỉ 2
  tên trùng trên ~90. Sinh viên ECOM-OCT mở app từ Moodle sẽ rơi vào lớp cũ (đã
  có 1 sinh viên thật và tài khoản thử sinhvien001).
- App không có cách **chuyển** một khoá Moodle đã gắn sang lớp khác, và không có
  cách **mở lớp khoá mới từ lớp cũ**.
- Ở ECOM2: 20 nhóm chưa khoá, 3 nhóm trống, 3 nhóm 1 người; 2 nhóm chưa nộp gì,
  3 nhóm chỉ nộp slide PDF; chưa có điểm nào.
- Sinh viên chưa có nhóm thấy dòng "Nhóm bạn đã nộp đủ" (sai).
- Lần mở đầu sau một lúc không ai dùng mất ~5,5 giây (máy chủ khởi động lại).

Một nhánh: `feature/khoa-moi-va-cong-cu-lop`.

## Làm

1. **Chuyển khoá Moodle sang lớp khác.** Trong ô "Moodle" của lớp, mỗi khoá đã
   gắn có nút "Chuyển sang lớp khác" (chỉ hiện các lớp mình quản lý). Chuyển
   xong, mọi hoạt động Moodle của khoá đó (vào lớp, điểm case, điểm bài tập lớn,
   chuyên cần) trỏ sang lớp mới; ghi nhật ký. Không chuyển nếu lớp cũ đã gửi
   điểm sang Moodle cho khoá đó (tránh lẫn điểm hai khoá).
2. **Cảnh báo gắn nhầm.** Ô Moodle hiện: bao nhiêu sinh viên đã vào từ Moodle,
   bao nhiêu người trong đó _không có sẵn_ trong danh sách lớp. Nếu phần lớn là
   người mới → cảnh báo "khoá Moodle có thể đang gắn nhầm lớp". Trang chọn lớp
   khi gắn Moodle hiện số sinh viên, ngày tạo, hạn chọn case của từng lớp.
3. **Mở lớp khoá mới từ lớp cũ.** Nút "Tạo lớp khoá mới từ lớp này": nhập mã
   lớp, tên lớp, số nhóm, sĩ số tối đa/nhóm, hạn chọn case mới. Lớp mới chép:
   học phần, học kỳ, ngôn ngữ, cách vào lớp, giảng viên, cách chọn case, bộ case,
   số nhóm mỗi case, cài đặt hỏi–đáp và chuyên cần. Không chép sinh viên, nhóm
   cũ, bài giao, điểm.
4. **Sửa "Nhóm bạn đã nộp đủ"** khi sinh viên chưa có nhóm → hiện "Bạn chưa có
   nhóm" kèm đường vào lớp để tham gia nhóm.
5. **Bài còn thiếu và nhắc nhóm.** Bảng tổng quan liệt kê _tên_ các mục bắt buộc
   còn thiếu của từng nhóm. Nút "Nhắc các nhóm còn thiếu" gửi thông báo trong
   app tới thành viên các nhóm đó (mỗi bài tối đa một lần/12 giờ). Nhắc tự động
   48 giờ trước hạn đã có sẵn.
6. **Công cụ nhóm:** "Xếp ngẫu nhiên tất cả sinh viên chưa có nhóm", "Khoá tất
   cả nhóm / Mở khoá tất cả", "Gộp nhóm ít người": thành viên của các nhóm có
   ≤ N người (và chưa nhận case, chưa có bài) được chuyển vào nhóm khác còn chỗ.
7. **Hỏi–đáp trên ClassInteract.** Cài đặt lớp có ô "Đường dẫn hỏi–đáp trên lớp"
   (chỉ nhận https). Nếu có, phòng thuyết trình và trang lớp của sinh viên hiện
   nút "Đặt câu hỏi trên ClassInteract", để sinh viên chỉ dùng một nơi hỏi đáp.
8. **Giữ sẵn 1 máy chủ** (`--min-instances 1`) để bỏ 5 giây chờ. Chi phí ước
   tính vài trăm nghìn đồng/tháng.
9. **Dữ liệu (sau khi deploy):** tạo lớp "ECOM OCT 2026" từ ECOM2 bằng nút mới,
   chuyển khoá Moodle 33 sang lớp mới, gỡ sinh viên ECOM-OCT và tài khoản thử
   đã vào nhầm ECOM2 (lần mở Moodle sau họ tự vào lớp mới).

## Chấm nhanh — đã có, không làm thêm

Giảng viên đã chấm được mọi bài mà không cần mở buổi thuyết trình: bảng Tổng
quan → cột "Chấm" → chấm theo rubric → công bố → điểm tự sang Moodle. AI chấm
trước slide/báo cáo chỉ là gợi ý (đã có). Việc cần là _dùng_, không phải code.

## Không làm, vì sao

- _Email nhắc hạn, nhắc tự động theo giờ_: app chưa có máy gửi email và chưa có
  bộ hẹn giờ (Cloud Scheduler cần cấp quyền IAM mà Claude không được làm). Nhắc
  trong app + nút "Nhắc" là đủ cho học kỳ này.
- _Tự đổi trạng thái bài giao khi quá hạn_: trạng thái đó không được dùng ở đâu;
  tiến độ đã tự tính ("quá hạn") từ giờ nộp. Quy định hiện tại nhận bài muộn có
  trừ điểm — chặn nộp sẽ đổi quy định chấm.
- _Lấy nhóm từ nhóm Moodle_: Hub chỉ gửi người đang mở, không gửi danh sách lớp
  hay nhóm Moodle.
- _Chấm AI hàng loạt_: mỗi bài mất 30–60 giây và tốn phí; để giảng viên bấm từng
  bài khi chấm.
- _Dời ngày bài giao khi chép lớp_: bài giao gắn với từng nhóm cụ thể nên không
  chép; lớp mới chỉ cần hạn chọn case mới.
