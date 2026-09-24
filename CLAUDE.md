# CaseStudy Hub — quy ước làm việc

Nền tảng thuyết trình và đánh giá tình huống, dựng từ SRS tiếng Việt 45 trang.
Chủ dự án là giảng viên, không phải lập trình viên.

## Cách làm việc

**Lập kế hoạch → chủ dự án duyệt → mới code.** Áp dụng cho mọi việc lớn hơn
một lần sửa lỗi. Kế hoạch viết bằng tiếng Việt, nêu rõ cái gì không làm và vì
sao.

**Sau khi code xong, mỗi lần:**

1. Chạy `npm run check` (đúng thứ tự CI chạy: format → lint → typecheck →
   unit test), rồi `npm run test:rules` và `npm run test:e2e`.
2. Commit và push.
3. Đưa code lên `main` — Cowork deploy từ `main`, nên code còn nằm trên nhánh
   thì bản deploy không có nó.
4. **Viết sẵn prompt deploy để chủ dự án dán cho Claude Cowork**, kèm những
   gì cần kiểm tra sau khi deploy.

Không tự ý mở pull request trừ khi được yêu cầu.

## Claude Cowork

Chạy trên máy của chủ dự án, có Cloud Shell. **Cowork chỉ deploy và báo lỗi —
không sửa code.** Lỗi Cowork báo thì chuyển về đây để sửa.

Prompt deploy luôn nhắc lại giới hạn đó, vì Cowork không nhớ giữa các phiên.

## Deploy

Đường deploy thật là Cloud Shell:

```bash
cd ~/casestudyhub && git checkout main && git pull
npx --yes firebase-tools@latest login --no-localhost   # bước 5 cần đăng nhập
bash scripts/deploy-cloudshell.sh                      # KHÔNG dùng SKIP_FIRESTORE=1
```

GitHub Actions `deploy.yml` **không chạy được**: secret Workload Identity
Federation chưa cấu hình, nên nó fail sau 10 giây trên mọi lần push vào
`main`. Dấu X đỏ đó là tình trạng có sẵn, không phải lỗi của code mới. Bốn job
CI thật (`ci.yml`) mới là thứ phải xanh.

Dự án GCP: `casestudy1-509414`. Vùng: `asia-southeast1`.

## Bốn lớp kiểm chứng

Ba lỗi từng lọt tới production, nên mỗi thay đổi đi qua cả bốn lớp:

| Lớp | Lệnh | Bắt được gì |
|---|---|---|
| Unit | `npm test` | Logic thuần, đối chiếu khoá song ngữ |
| Emulator | `npm run test:rules` | Security Rules, đồng thời, Auth + Firestore cùng lúc |
| Image | job CI `Container image` | Bản build standalone chạy được trong container |
| E2E | `npm run test:e2e` | Luồng thật trên bản build production |

**Emulator không kiểm tra composite index.** Thêm truy vấn nhiều điều kiện thì
phải tự thêm vào `firebase/firestore.indexes.json` — đây là loại lỗi tới
production trong khi mọi test vẫn xanh.

## Nguyên tắc không thương lượng

- **Khung đánh giá là dữ liệu có phiên bản**, không phải hằng số trong mã. Một
  phiên bản ghi bằng `create`, không bao giờ ghi đè: đó là thứ khiến điểm đã
  công bố không thể đổi.
- **Mọi thông báo đều là khoá i18n**, không bao giờ lưu câu đã dịch. Nền tảng
  song ngữ; câu tiếng Việt lưu vào database tháng Ba vẫn là tiếng Việt với
  người đọc tiếng Anh tháng Sáu.
- **File không bao giờ công khai.** Mọi byte đi qua route handler đã kiểm tra
  tư cách. Cố ý không dùng signed URL: một signed URL rời khỏi trang là một
  giấy phép truy cập.
- **Ẩn danh thực hiện ở server**, không phải giấu trong markup.
- **AI đề xuất, con người quyết định.** Không đường code nào cho điểm AI chạm
  vào `grades`.
