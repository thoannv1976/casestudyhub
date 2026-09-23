# CaseStudy Hub

**AI-Powered Case Study Presentation & Assessment Platform** — nền tảng song ngữ
quản lý trọn vẹn chu trình học bằng case study: giao case → lập nhóm → phân vai →
nộp bài → thuyết trình trực tiếp → hỏi đáp → đánh giá chéo → phản hồi AI → giảng
viên chấm và công bố điểm.

Đặc tả đầy đủ: [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md).
Lộ trình: [`docs/00-roadmap.md`](./docs/00-roadmap.md).

## Trạng thái

| Phase | Nội dung                 | Trạng thái                                            |
| ----- | ------------------------ | ----------------------------------------------------- |
| 1     | Core Platform            | 🟡 Đang làm (PR 1/7 — scaffold, policy engine, CI/CD) |
| 2     | Interactive Presentation | ⚪ Chưa bắt đầu                                       |
| 3     | AI Assessment            | ⚪ Chưa bắt đầu                                       |
| 4     | Analytics & Integration  | ⚪ Chưa bắt đầu                                       |

## Công nghệ

Next.js 16 · React 19 · TypeScript (strict) · Tailwind CSS 4 · next-intl · Zod ·
Firebase Authentication · Cloud Firestore · Cloud Storage · Cloud Run · Gemini
API (Phase 3) · Vitest · Firebase Emulator Suite.

## Cấu trúc thư mục

```
casestudyhub/
├── PRODUCT_SPEC.md          Đặc tả sản phẩm (nguồn tham chiếu duy nhất)
├── apps/
│   └── web/                 Ứng dụng Next.js (UI + route handlers)
├── packages/
│   ├── shared/              Domain types, Zod schemas, policy engine
│   │   ├── domain/          identity, academic, roles, rubric, case study
│   │   └── policy/          presentation policy, role allocation, grading
│   └── core/                Firebase Admin, env, errors, audit log
├── firebase/                Security rules, indexes, cấu hình emulator
├── infra/                   Dockerfile cho Cloud Run
├── docs/                    Hướng dẫn GCP, kiến trúc, dữ liệu, deploy, test
│   └── source/              Tài liệu gốc của học phần
└── .github/workflows/       CI và deploy
```

## Chạy ở máy cá nhân

```bash
nvm use                      # Node 22
npm install
cp .env.example .env.local   # điền giá trị Firebase (xem docs/01-gcp-setup.md)
npm run dev                  # http://localhost:3000 → chuyển hướng sang /vi
```

### Các lệnh

| Lệnh                 | Việc                                                   |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Chạy Next.js ở chế độ phát triển                       |
| `npm run build`      | Build production (output standalone cho Cloud Run)     |
| `npm test`           | Chạy toàn bộ unit test                                 |
| `npm run test:watch` | Test ở chế độ watch                                    |
| `npm run typecheck`  | Kiểm tra kiểu toàn bộ workspace                        |
| `npm run lint`       | ESLint                                                 |
| `npm run format`     | Prettier                                               |
| `npm run emulators`  | Firebase Emulator Suite (Auth, Firestore, Storage, UI) |

### Emulator

```bash
npm install -g firebase-tools     # một lần
cp firebase/.firebaserc.example firebase/.firebaserc
npm run emulators                 # UI tại http://localhost:4000
```

Bỏ chú thích các biến `*_EMULATOR_HOST` trong `.env.local` để ứng dụng trỏ vào
emulator thay vì Firestore thật.

## Triển khai

Đẩy lên `main` là GitHub Actions tự build image và deploy lên Cloud Run.
Chuẩn bị một lần theo [`docs/01-gcp-setup.md`](./docs/01-gcp-setup.md); chi tiết
quy trình trong [`docs/04-deployment.md`](./docs/04-deployment.md).

Deploy ngay từ Google Cloud Shell, không cần cấu hình GitHub Actions trước:

```bash
git clone --branch claude/zealous-franklin-e428p0 \
  https://github.com/thoannv1976/casestudyhub.git
cd casestudyhub
bash scripts/deploy-cloudshell.sh
```

## Nguyên tắc bắt buộc khi viết code

1. **Phân quyền kiểm tra hai lớp** — server-side và Firestore Security Rules.
   Ẩn nút trên giao diện không phải là bảo mật.
2. **Quy định học thuật là cấu hình, không phải hằng số trong code** — tất cả nằm
   trong policy engine (`packages/shared/src/policy/`) và có version.
3. **Thời gian chính thức lấy từ server**, không tin đồng hồ thiết bị người dùng.
4. **Dùng transaction** ở mọi chỗ thao tác đồng thời có thể phá vỡ quy tắc nghiệp
   vụ (join nhóm, peer review, upvote).
5. **Bài nộp không bao giờ bị ghi đè** — mỗi lần nộp là một version mới.
6. **AI chỉ tạo bản nháp** — chỉ giảng viên mới công bố được điểm.
7. **Không lưu mật khẩu trong Firestore**; mọi API key qua Secret Manager.
8. Trước khi viết một module: xác định mô hình dữ liệu, quy tắc nghiệp vụ, hợp
   đồng API, phân quyền và acceptance test.
