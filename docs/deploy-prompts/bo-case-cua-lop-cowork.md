# Prompt deploy cho Claude Cowork — Bộ case của lớp, nhiều nhóm cùng một case

Bản này thêm mục **"Bộ case của lớp"** ở trang quản lý lớp, cho phép **nhiều nhóm
cùng nhận một case**, và sửa quyền đọc case (nhóm luôn mở được case mình đã nhận,
kể cả case thuộc học phần khác). Không có biến môi trường hay secret mới.
Kết nối Moodle đang **bật** từ trước và phải **giữ nguyên bật** sau deploy.

Copy toàn bộ phần trong khung dưới đây, dán vào Claude Cowork.

---

Bạn đang chạy trên máy của tôi và có Cloud Shell. Việc của bạn trong phiên này là **deploy và báo cáo** bản mới nhất của CaseStudy Hub.

**Giới hạn — đọc trước khi làm gì:**

- **Bạn KHÔNG sửa code, KHÔNG sửa script, KHÔNG sửa file cấu hình.** Gặp lỗi thì chép nguyên văn vào báo cáo cho tôi, để tôi chuyển về cho Claude Code sửa. Đừng "vá tạm" bất cứ thứ gì.
- **KHÔNG đổi, KHÔNG xoá biến `LTI_*` hay secret nào** trên Cloud Run. Kết nối Moodle đang chạy; script deploy giữ nguyên các biến đó.
- **KHÔNG bấm Lưu ở mục "Bộ case của lớp", KHÔNG chọn case, KHÔNG thu hồi lựa chọn của nhóm nào.** Lớp ECOM1, ECOM2 là lớp thật đang học.
- **KHÔNG dùng `SKIP_FIRESTORE=1`.** Bản này thêm **một index Firestore mới** (`caseClaims`: `classId` + `caseStudyId`); bỏ qua là trang chọn case báo lỗi trên production.

**Các lệnh cần chạy, đúng thứ tự:**

```bash
cd ~/casestudyhub && git checkout main && git pull
git log --oneline -5          # phải thấy dòng "Bộ case của lớp..."
npx --yes firebase-tools@latest login --no-localhost
bash scripts/deploy-cloudshell.sh
```

Dự án GCP `casestudy1-509414`, vùng `asia-southeast1`.

**Báo cáo lại cho tôi, nguyên văn:**

1. Commit đang deploy (`git log --oneline -1`) và revision Cloud Run mới.
2. Kết quả `/api/health` — phải là `status: ok` kèm revision mới.
3. Danh sách biến môi trường Cloud Run in ra lúc deploy. **Phải vẫn có** `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_TENANTS` (và secret `LTI_GAME_SECRET`). Thiếu cái nào thì báo ngay.
4. Firestore: rules "already up to date" là bình thường (bản này không đổi rules). **Index phải tăng thêm 1** so với lần trước; index mới có thể mất vài phút mới READY — chạy
   `gcloud firestore indexes composite list --project casestudy1-509414 --format="table(name.basename(),state)"` và báo số index READY / CREATING.
5. Bất cứ dòng đỏ hay cảnh báo nào khác, chép nguyên văn.

## Kiểm sau khi deploy (chỉ đọc, không lưu gì)

**1. Kết nối Moodle vẫn bật.** Chạy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"ticket":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' \
  https://casestudyhub-web-iv27nu35ta-as.a.run.app/api/lti/launch
```

Phải ra **401** (vé giả bị từ chối). Nếu ra JSON có `errors.ltiNotEnabled` thì kết nối Moodle đã bị tắt mất — báo ngay.

**2. Mục mới hiện đúng.** Đăng nhập bằng tài khoản giảng viên tôi đã có (**đừng tạo tài khoản mới**), mở lớp **ECOM2** trong phần Giảng dạy. Phải thấy khung **"Bộ case của lớp"** với dòng:
"Lớp này chưa có bộ case riêng, nên đang dùng **26** case đã công bố của học phần ECOM AUG 2026 …". Các case đã có nhóm chọn có nhãn **"Đã có nhóm chọn"**. Chỉ nhìn, **không bấm Lưu**.

**3. Danh sách chọn case của lớp không đổi.** Ở cùng trang, khung "Cách chọn case" vẫn ghi **15 trong 20 nhóm đã chọn**, danh sách nhóm–case như trước.

**4. Mọi thứ cũ vẫn chạy.** Mở Trang chủ, Thư viện case study, Bảng tổng hợp của ECOM2. Báo nguyên văn nếu trang nào lỗi.
