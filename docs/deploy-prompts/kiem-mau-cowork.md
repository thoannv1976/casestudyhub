# Prompt cho Claude Cowork — kiểm màu trên production

Dán vào phiên Cowork. Việc này **chỉ đọc**, không lưu gì, nên không vướng bộ kiểm soát an toàn.

---

Bản trên production hiện đã cũ hơn `main`: cần deploy lại để có `a97b3e6 PR48` (giao diện). Sau khi deploy xong thì kiểm phần dưới. Tôi cần biết màu đã tới trình duyệt chưa, và nếu rồi thì vì sao nhìn vẫn thấy một màu.

**Việc 1 — chứng minh CSS màu có trên production.** Mở app, xem mã nguồn trang để lấy đường dẫn file CSS (dạng `/_next/static/chunks/<tên>.css`), rồi tải nó về và tìm bốn class sau. Chép lại nguyên văn dòng tìm được, hoặc báo là không có:

```bash
# thay <URL> bằng địa chỉ app, <CSS> bằng đường dẫn file css lấy từ mã nguồn trang
curl -s "<URL><CSS>" | grep -o 'tone-\(success\|warning\|danger\|info\)-bg[^;}]*' | head -20
```

Cần thấy **cả hai dạng**: định nghĩa màu (`--tone-success-bg:#dcf0e4`) **và** class dùng nó (`.bg-\[var\(--tone-success-bg\)\]{background-color:var(--tone-success-bg)}`). Thiếu dạng thứ hai mới là hỏng.

**Việc 2 — tìm chỗ màu phải khác nhau.** Màu chỉ xuất hiện ở thẻ trạng thái, và chỉ khác nhau khi dữ liệu khác nhau. Lớp **ECOM2** có bài đã nộp, nên đó là chỗ dễ thấy nhất:

- Đăng nhập **student1** → vào lớp ECOM2 → thẻ **Bài làm của nhóm**. Mục nào đã nộp phải có thẻ **xanh lá** ghi "Phiên bản 1"; mục chưa nộp là chữ xám "Chưa nộp". Báo tôi thấy màu gì.
- Vào **Bảng tổng hợp** của ECOM2 (tài khoản giảng viên): cột **Tiến độ** và cột **Chấm**. Báo từng dòng thấy thẻ màu gì.

**Việc 3 — liệt kê giúp tôi.** Trên Bảng tổng hợp của cả hai lớp, có bao nhiêu **giá trị khác nhau** ở cột Tiến độ và cột Chấm? Nếu mọi dòng cùng một chữ thì mọi dòng cùng một màu — đó là dữ liệu, không phải lỗi.

Đừng sửa gì, đừng lưu gì. Chỉ đọc và báo lại.

---
