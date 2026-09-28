/**
 * Builds the CaseStudy Hub user guide as a .docx.
 *
 * The screenshots are real: `scripts/guide/screenshots.spec.ts` is copied into
 * `e2e/tests/` and captured against the production build in Vietnamese, on the
 * data the end-to-end suite creates. A guide drawn from memory goes stale the
 * first time a button is renamed; one taken from the running app cannot.
 *
 * Usage (the `docx` package is not a dependency of this repo, so install it
 * wherever you run this from):
 *
 *   npm install docx
 *   node scripts/guide/build-docx.mjs <shots-dir> <output.docx>
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { writeFileSync } from 'node:fs';

const SHOTS = process.argv[2] ?? 'guide-shots';
const OUT = process.argv[3] ?? 'CaseStudy-Hub-Huong-dan-su-dung.docx';

/** A4 with the default one-inch margins leaves this much room for a picture. */
const IMAGE_WIDTH = 600;
const IMAGE_HEIGHT = Math.round((860 / 1280) * IMAGE_WIDTH);

const BRAND = '1E6F45';
const MUTED = '5B6670';

function text(value, options = {}) {
  return new TextRun({ text: value, ...options });
}

function para(value, options = {}) {
  const { spacing, ...rest } = options;
  return new Paragraph({
    children: [text(value, rest)],
    spacing: spacing ?? { after: 120 },
  });
}

function h1(value) {
  return new Paragraph({
    text: value,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
  });
}

function h2(value) {
  return new Paragraph({
    text: value,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
  });
}

function h3(value) {
  return new Paragraph({
    text: value,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 100 },
  });
}

function bullets(items) {
  return items.map(
    (item) =>
      new Paragraph({
        children: [text(item)],
        numbering: { reference: 'dots', level: 0 },
        spacing: { after: 80 },
      }),
  );
}

/** A screenshot, with its caption underneath. */
function picture(file, caption) {
  const path = join(SHOTS, `${file}.png`);
  if (!existsSync(path)) {
    console.warn(`  (thiếu ảnh ${file}.png)`);
    return [para(`[Thiếu ảnh: ${file}]`, { italics: true, color: MUTED })];
  }
  return [
    new Paragraph({
      children: [
        new ImageRun({
          type: 'png',
          data: readFileSync(path),
          transformation: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        }),
      ],
      spacing: { before: 120, after: 60 },
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [text(caption, { italics: true, color: MUTED, size: 18 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  ];
}

/** The "Ghi chú" line under a step: the thing that is not obvious from looking. */
function note(value) {
  return new Paragraph({
    children: [text('Ghi chú. ', { bold: true, color: BRAND }), text(value)],
    spacing: { before: 60, after: 200 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 12 },
    },
    indent: { left: 180 },
  });
}

function rule() {
  return new Paragraph({
    text: '',
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DCE0', space: 6 } },
  });
}

/** Two-column table. Widths are in DXA and must add up to the table width. */
function table(headers, rows, widths) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  const cell = (value, { bold = false, shaded = false, width }) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: shaded ? { type: ShadingType.CLEAR, fill: 'F2F5F3' } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({ children: [text(value, { bold, size: 20 })], spacing: { after: 0 } }),
      ],
    });

  return new Table({
    columnWidths: widths,
    width: { size: total, type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((value, index) =>
          cell(value, { bold: true, shaded: true, width: widths[index] }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map((value, index) => cell(value, { width: widths[index] })),
          }),
      ),
    ],
  });
}

const children = [];
const add = (...items) => children.push(...items.flat());

// ─────────────────────────────── Bìa ───────────────────────────────
add(
  new Paragraph({
    children: [text('CaseStudy Hub', { bold: true, size: 56, color: BRAND })],
    spacing: { before: 1200, after: 120 },
    alignment: AlignmentType.CENTER,
  }),
  new Paragraph({
    children: [text('Giới thiệu và hướng dẫn sử dụng', { size: 32 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }),
  new Paragraph({
    children: [
      text('Nền tảng quản lý và đánh giá thuyết trình Case Study ứng dụng AI', {
        italics: true,
        color: MUTED,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 960 },
  }),
  new Paragraph({
    children: [text('Tài liệu dành cho sinh viên và giảng viên', { color: MUTED })],
    alignment: AlignmentType.CENTER,
  }),
  new Paragraph({
    children: [
      text('Ảnh màn hình chụp từ chính bản đang chạy, giao diện tiếng Việt.', {
        color: MUTED,
        size: 20,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }),
  new Paragraph({ children: [text('')], pageBreakBefore: true }),
);

// ─────────────────────────── Mục lục ───────────────────────────
add(h1('Mục lục'));
add(
  ...bullets([
    '1. CaseStudy Hub là gì',
    '2. Các chức năng chính',
    '3. Dành cho sinh viên — 9 bước',
    '4. Dành cho giảng viên — 8 việc',
    '5. Dành cho quản trị viên',
    '6. Những điều nên biết trước khi dùng',
  ]),
);

// ─────────────────── 1. Giới thiệu ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('1. CaseStudy Hub là gì'));

add(
  para(
    'CaseStudy Hub tổ chức trọn vẹn một chu trình case study trên cùng một nơi: giao tình huống cho nhóm, nhóm nộp bài có phiên bản, cả lớp theo dõi buổi thuyết trình trên điện thoại và đặt câu hỏi, chấm chéo giữa các nhóm, AI đọc bài và đề xuất, rồi giảng viên chấm và công bố điểm.',
  ),
  para(
    'Nền tảng song ngữ Việt – Anh. Mỗi người tự chọn ngôn ngữ giao diện bằng nút VI / EN ở góc trên bên phải, không ảnh hưởng tới người khác.',
  ),
);

add(...picture('25-trang-gioi-thieu', 'Trang giới thiệu, mở được khi chưa đăng nhập.'));

add(h2('Năm nguyên tắc nên biết'));
add(
  ...bullets([
    'AI đề xuất, con người quyết định. Mô hình có thể đọc bài và đề xuất điểm kèm dẫn chứng, nhưng không có đường nào để điểm của AI tự thành điểm của sinh viên. Điểm cuối cùng luôn do giảng viên nhập và công bố.',
    'Hạn nộp do đồng hồ máy chủ quyết. Đồng hồ trên máy hay điện thoại của sinh viên không tham gia vào việc xác định nộp đúng hạn hay muộn.',
    'File không bao giờ công khai. Mọi file đi qua một cửa có kiểm tra tư cách người tải; không có đường link nào mở được file mà không đăng nhập.',
    'Ẩn danh được thực hiện ở máy chủ. Khi sinh viên chọn ẩn tên, trình duyệt của bạn cùng lớp không hề nhận được tên người hỏi — không phải chỉ giấu trên màn hình.',
    'Bài đã nộp không mất. Nộp lại là tạo phiên bản mới; các phiên bản cũ vẫn còn nguyên và mở lại được.',
  ]),
);

// ─────────────────── 2. Chức năng chính ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('2. Các chức năng chính'));

add(h2('Sinh viên làm được gì'));
add(
  table(
    ['Chức năng', 'Mô tả ngắn'],
    [
      ['Vào lớp bằng mã', 'Nhập mã lớp giảng viên cung cấp để tham gia.'],
      ['Chọn nhóm', 'Tự chọn nhóm khi giảng viên chưa khoá nhóm.'],
      ['Chọn case study', 'Khi giảng viên mở, nhóm nào chọn trước được trước.'],
      [
        'Nộp bài có phiên bản',
        'Nộp từng loại tài liệu; nộp lại thành phiên bản mới, bản cũ vẫn còn.',
      ],
      ['Nộp bài tập lớn', 'PPT pitch deck, báo cáo và link video, cho cả học phần.'],
      ['Xung phong thuyết trình', 'Nhóm đăng ký suất trình bày bài tập lớn.'],
      ['Đặt câu hỏi trong buổi học', 'Mỗi sinh viên một câu hỏi, có thể ẩn tên với bạn cùng lớp.'],
      ['Chấm chéo', 'Chấm nhóm vừa thuyết trình theo đúng rubric của giảng viên.'],
      ['Trợ giảng AI', 'Hỏi về case: giải thích, hỏi ngược, phản biện hoặc ra bài luyện tập.'],
      ['Xem điểm và hồ sơ', 'Điểm đã công bố, vai trò đã đảm nhận, câu hỏi đã đặt.'],
    ],
    [2600, 6426],
  ),
);

add(new Paragraph({ children: [text('')], spacing: { after: 200 } }));
add(h2('Giảng viên làm được gì'));
add(
  table(
    ['Chức năng', 'Mô tả ngắn'],
    [
      ['Tạo lớp, nhập danh sách', 'Tạo lớp, nhập sinh viên từ file CSV, duyệt người vào lớp.'],
      ['Quản lý nhóm', 'Tạo nhóm, chia ngẫu nhiên, đổi tên, khoá nhóm, phân sáu vai trò.'],
      ['Thư viện case study', 'Tải case lên, xuất bản, sửa thành phiên bản mới.'],
      ['Giao bài và hạn nộp', 'Giao case kèm ngày thuyết trình; hạn nộp tự suy ra từ khung.'],
      ['Điều hành buổi thuyết trình', 'Đồng hồ theo vai, mở/đóng câu hỏi, mở chấm chéo.'],
      ['Tổng hợp câu hỏi', 'Xem ai đã hỏi, ai chưa; nhờ AI xếp chủ đề và trả lời câu còn lại.'],
      ['Chấm điểm', 'Chấm theo rubric, xem bằng chứng buổi học, lưu nháp rồi công bố.'],
      ['AI đọc bài', 'Mô hình đọc bài nộp và đề xuất điểm kèm trích dẫn nguồn.'],
      ['Bảng tổng hợp và báo cáo', 'Cả lớp trong một bảng; báo cáo mức đạt chuẩn đầu ra; tải CSV.'],
      ['Khung đánh giá', 'Sửa rubric, thời lượng, tài liệu phải nộp — thành phiên bản mới.'],
    ],
    [2600, 6426],
  ),
);

// ─────────────────── 3. Sinh viên ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('3. Dành cho sinh viên — 9 bước'));
add(
  para(
    'Phần này đi theo đúng thứ tự một sinh viên gặp trong học phần. Mỗi bước có ảnh màn hình thật và một ghi chú cho điều dễ nhầm.',
  ),
);

add(h2('Bước 1. Tạo tài khoản'));
add(
  ...bullets([
    'Mở trang web của lớp, bấm Đăng ký.',
    'Nhập mã sinh viên, họ tên, email và mật khẩu.',
    'Bấm Tạo tài khoản.',
  ]),
);
add(...picture('02-dang-ky', 'Màn hình Tạo tài khoản sinh viên.'));
add(
  note(
    'Mã sinh viên phải trùng với mã trong danh sách của khoa — hệ thống dùng nó để đối chiếu bạn với danh sách lớp. Nhập sai mã thì giảng viên sẽ không tìm thấy bạn trong lớp. Mật khẩu tối thiểu 8 ký tự, có cả chữ và số.',
  ),
);

add(h2('Bước 2. Đăng nhập'));
add(...picture('01-dang-nhap', 'Màn hình Đăng nhập.'));
add(
  note(
    'Nếu tài khoản do giảng viên hoặc quản trị viên tạo hộ, lần đầu đăng nhập hệ thống sẽ bắt bạn đổi mật khẩu tạm sang mật khẩu riêng trước khi vào được.',
  ),
);

add(h2('Bước 3. Trang làm việc'));
add(
  para(
    'Sau khi đăng nhập bạn vào Trang làm việc: nơi gom những việc còn nợ, điểm mới được công bố, và buổi thuyết trình đang diễn ra trên lớp.',
  ),
);
add(...picture('03-trang-chu-sinh-vien', 'Trang làm việc của sinh viên.'));
add(
  note(
    'Khi một nhóm đang thuyết trình, mục Đang diễn ra trên lớp sẽ hiện ra ở đầu trang. Bấm vào đó là vào thẳng phòng thuyết trình để xem slide và đặt câu hỏi.',
  ),
);

add(h2('Bước 4. Vào lớp bằng mã'));
add(
  ...bullets([
    'Vào mục Lớp của tôi ở cột bên trái.',
    'Nhập mã lớp giảng viên cung cấp, ví dụ ECOM-2026-A01.',
    'Bấm Tham gia.',
  ]),
);
add(...picture('04-vao-lop-bang-ma', 'Ô nhập mã lớp ở trang Lớp của tôi.'));
add(
  note(
    'Tuỳ cách giảng viên đặt, có lớp vào thẳng, có lớp phải chờ duyệt. Nếu thấy trạng thái Chờ duyệt thì bạn đã gửi yêu cầu thành công, chỉ cần đợi giảng viên.',
  ),
);

add(h2('Bước 5. Chọn nhóm'));
add(...picture('06-chon-nhom', 'Danh sách nhóm trong lớp, với nút Tham gia nhóm này.'));
add(
  note(
    'Nhóm đã đủ người hiện Đã đủ, nhóm bị khoá hiện Đã khóa — cả hai đều không vào được nữa. Chọn nhầm nhóm thì báo giảng viên chuyển, sinh viên không tự chuyển được sau khi nhóm bị khoá.',
  ),
);

add(h2('Bước 6. Chọn case study và nộp bài'));
add(
  para(
    'Nếu giảng viên mở cho nhóm tự chọn, thẻ Chọn case study cho nhóm sẽ hiện danh sách case còn trống. Ai chọn trước được trước. Bên dưới là thẻ Bài làm của nhóm, nơi nộp từng loại tài liệu.',
  ),
);
add(...picture('07-nop-bai', 'Chọn case, và thẻ Bài làm của nhóm với các mục phải nộp.'));
add(
  note(
    'Mỗi mục có dấu sao đỏ là bắt buộc. Nộp lại cùng một mục sẽ tạo Phiên bản 2, 3… và bản cũ vẫn mở lại được — nên không sợ nộp nhầm. Mục nào nhận link (ví dụ video) thì dán link thay vì chọn file. Hạn nộp hiện ngay trên thẻ; quá hạn vẫn nộp được nhưng bài sẽ bị ghi nhận là nộp muộn và bị trừ điểm theo khung đánh giá.',
  ),
);

add(h2('Bước 7. Bài tập lớn của lớp'));
add(
  para(
    'Bài tập lớn là việc riêng, khác với case study nhóm bạn thuyết trình: cả lớp cùng một đề, cùng một hạn, nộp vào tuần cuối học phần. Gồm ba phần: pitch deck, báo cáo và link video của nhóm.',
  ),
);
add(
  ...picture(
    '08-bai-tap-lon',
    'Thẻ Bài tập lớn của lớp, phía dưới là thẻ xung phong thuyết trình.',
  ),
);
add(
  note(
    'Nếu nộp pitch deck dạng .pptx, AI chỉ đọc được phần chữ của từng slide — mất hình, biểu đồ và số nằm trong ảnh. Nộp thêm bản PDF thì AI đọc được đầy đủ. Khi giảng viên mở đăng ký thuyết trình, thẻ Xung phong thuyết trình bài tập lớn sẽ hiện số suất còn lại và nút Nhóm tôi xung phong; nhóm nào bấm trước được trước, và một nhóm chỉ xung phong được một lần.',
  ),
);

add(h2('Bước 8. Trong buổi thuyết trình'));
add(
  para(
    'Khi giảng viên mở buổi, cả lớp mở được slide của nhóm đang trình bày và thấy đồng hồ chạy theo từng vai.',
  ),
);
add(...picture('09-phong-thuyet-trinh', 'Phòng thuyết trình: nhóm trình bày, slide và đồng hồ.'));
add(
  para(
    'Kéo xuống dưới là Tường câu hỏi. Mỗi sinh viên đặt đúng một câu hỏi, và sửa được chừng nào cửa sổ còn mở.',
  ),
);
add(
  ...picture('10-dat-cau-hoi', 'Khung đặt câu hỏi, với ô chọn loại câu hỏi và vai trò muốn hỏi.'),
);
add(
  note(
    'Ô Ẩn tên tôi với các bạn trong lớp được tick sẵn: bạn cùng lớp sẽ không biết ai hỏi, nhưng giảng viên vẫn thấy tên bạn. Nhóm đang thuyết trình không đặt câu hỏi cho chính mình. Khi nhóm đã chọn câu hỏi của bạn để trả lời trực tiếp thì câu đó không sửa được nữa.',
  ),
);

add(h2('Bước 9. Chấm chéo và xem điểm'));
add(
  para(
    'Cuối buổi, nếu giảng viên mở chấm chéo, bạn chấm nhóm vừa theo dõi theo đúng rubric mà giảng viên dùng. Điểm chấm chéo là bằng chứng để giảng viên tham khảo, không bao giờ tự cộng vào điểm cuối cùng.',
  ),
);
add(...picture('11-the-ca-nhan', 'Hồ sơ của tôi: điểm đã công bố và đóng góp của bạn.'));
add(
  note(
    'Hồ sơ của tôi gom mọi lớp: vai trò đã đảm nhận, số câu hỏi đã đặt, số câu đã trả lời trực tiếp và các điểm đã công bố. Điểm chưa công bố sẽ không hiện ở đây — thấy Chưa công bố nghĩa là giảng viên còn đang chấm.',
  ),
);

add(...picture('24-thong-bao', 'Trang Thông báo.'));
add(
  note(
    'Thông báo báo các việc đã diễn ra trên lớp của bạn: được giao case, đổi ngày thuyết trình, sắp tới hạn, điểm được công bố. Nhắc hạn nộp chỉ hiện khi nhóm còn thiếu sản phẩm và tự biến mất khi đã nộp đủ.',
  ),
);

// ─────────────────── 4. Giảng viên ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('4. Dành cho giảng viên — 8 việc'));

add(h2('4.1. Lớp giảng dạy'));
add(...picture('12-lop-giang-day', 'Danh sách lớp bạn phụ trách, và form tạo lớp mới.'));
add(
  note(
    'Phải có học phần và học kỳ trước khi tạo lớp — cả hai nằm trong mục Quản trị. Mã lớp là thứ bạn đưa cho sinh viên để họ tự vào.',
  ),
);

add(h2('4.2. Danh sách sinh viên'));
add(
  ...picture('14-danh-sach-sinh-vien', 'Danh sách sinh viên của lớp, kèm ô nhập danh sách từ CSV.'),
);
add(
  note(
    'File CSV cần ba cột: mã sinh viên, họ tên, email — tiêu đề cột tiếng Việt hay tiếng Anh đều được. Hệ thống hiện bản xem trước và chưa ghi gì cho tới khi bạn bấm xác nhận.',
  ),
);

add(h2('4.3. Giao case study'));
add(...picture('15-giao-bai', 'Form giao case cho nhóm, với ngày giờ thuyết trình.'));
add(
  note(
    'Bạn chỉ nhập ngày giờ thuyết trình; hạn nộp tự suy ra từ khung đánh giá (mặc định là 24 giờ trước buổi). Đổi ngày thuyết trình thì hạn nộp tự dời theo, và nhóm được thông báo cả hai mốc. Không đổi được nữa khi điểm đã công bố hoặc buổi đã mở.',
  ),
);

add(h2('4.4. Bài tập lớn và suất thuyết trình'));
add(...picture('16-bai-tap-lon-gv', 'Thẻ Bài tập lớn của lớp từ phía giảng viên.'));
add(
  note(
    'Một hạn cho cả lớp, không phải mỗi nhóm một hạn. Ô Số nhóm được thuyết trình để 0 nghĩa là chưa mở đăng ký; đặt thành 2 là cho hai nhóm xung phong. Không hạ được số suất xuống dưới số nhóm đã xung phong. Cột Thuyết trình hiện nhóm nào giữ suất nào, kèm nút mở buổi và link tới bảng câu hỏi.',
  ),
);

add(h2('4.5. Tổng hợp câu hỏi của lớp'));
add(...picture('21-bang-cau-hoi-gv', 'Bảng câu hỏi: ai đã hỏi, ai chưa, và các nút nhờ AI.'));
add(
  note(
    'Bảng theo dõi nêu tên những sinh viên còn chưa đặt câu hỏi, chứ không chỉ đếm — đọc được ngay trên lớp. Nhóm đang thuyết trình không nằm trong số phải đặt câu hỏi. Hai nút AI: xếp câu hỏi thành chủ đề, và trả lời những câu lớp chưa kịp trả lời. AI không bao giờ ghi đè câu đã được sinh viên trả lời trực tiếp.',
  ),
);

add(h2('4.6. Chấm điểm'));
add(...picture('19-cham-diem', 'Màn hình chấm điểm theo rubric, kèm bằng chứng buổi học.'));
add(
  note(
    'Phần Những gì buổi học ghi lại là bằng chứng, không phải điểm: nộp đúng hạn hay muộn, lớp đặt bao nhiêu câu hỏi, điểm chấm chéo. Điểm cuối cùng là điểm bạn nhập. Lưu nháp bao nhiêu lần cũng được; chỉ khi bấm công bố sinh viên mới thấy. Quản trị viên cố ý không có quyền chấm và công bố điểm — việc đó thuộc về giảng viên của lớp.',
  ),
);

add(...picture('20-ai-doc-bai', 'Khối AI đọc bài nộp và đề xuất theo từng tiêu chí.'));
add(
  note(
    'Mô hình đọc chính file nhóm đã nộp và đề xuất điểm kèm trích dẫn nguồn. Đây là đề xuất để bạn đọc, không tự thành điểm. Riêng tiêu chí về trình bày và phối hợp nhóm không bao giờ được gửi cho mô hình — đó là phần chỉ người ngồi trong phòng mới đánh giá được.',
  ),
);

add(h2('4.7. Bảng tổng hợp và báo cáo lớp'));
add(...picture('17-bang-tong-hop', 'Bảng tổng hợp: mỗi dòng là một việc một nhóm phải làm.'));
add(
  note(
    'Gộp cả case study lẫn bài tập lớn vào một bảng: nộp mấy trên mấy, có muộn không, chấm tới đâu, điểm nhóm và điểm trung bình đã công bố. Dãy nút lọc ở trên trả lời nhanh câu hỏi "nhóm nào còn thiếu". Nút Tải CSV để khỏi gõ tay vào hệ thống của trường.',
  ),
);

add(...picture('18-bao-cao-lop', 'Báo cáo lớp: phân bố điểm và mức đạt chuẩn đầu ra.'));
add(
  note(
    'Báo cáo chỉ tính điểm đã công bố. Phần mức đạt chuẩn đầu ra kèm sẵn câu nhắc phải đối chiếu với đề cương học phần — hệ thống ánh xạ tiêu chí sang chuẩn đầu ra theo khung, và việc xác nhận ánh xạ đó là của bạn.',
  ),
);

add(h2('4.8. Khung đánh giá'));
add(...picture('22-khung-danh-gia', 'Khung đánh giá: rubric, thời lượng, tài liệu phải nộp.'));
add(
  note(
    'Mọi con số dùng để tính điểm nằm ở đây: nhóm được nói bao lâu, lớp phải đặt tối thiểu bao nhiêu câu hỏi, mỗi tiêu chí bao nhiêu điểm, trừ bao nhiêu khi nộp muộn. Sửa một quy tắc sẽ tạo ra một phiên bản mới; lớp cũ vẫn giữ phiên bản lúc nó được tạo, nên không điểm nào đã chấm bị thay đổi.',
  ),
);

// ─────────────────── 5. Quản trị ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('5. Dành cho quản trị viên'));
add(
  para(
    'Quản trị viên lo phần nền: tài khoản, cấu trúc đào tạo và cấu hình hệ thống. Quản trị viên cố ý không có quyền chấm và công bố điểm.',
  ),
);
add(...picture('23-cai-dat-he-thong', 'Quản trị → Hệ thống: số liệu nền tảng và cấu hình AI.'));
add(
  note(
    'Khóa API của OpenAI hoặc Gemini nhập ngay tại đây, không cần deploy lại. Lưu khóa xong vẫn phải bật công tắc mô hình — đó là hai việc riêng. Nút Thử gọi mô hình cho biết khóa có thật sự tới được nhà cung cấp hay không. Hạn mức lượt gọi mỗi tháng cũng đặt ở trang này.',
  ),
);

// ─────────────────── 6. Nên biết ───────────────────
add(new Paragraph({ children: [text('')], pageBreakBefore: true }));
add(h1('6. Những điều nên biết trước khi dùng'));

add(h2('Trên điện thoại'));
add(
  para(
    'Cả ứng dụng chạy được trên điện thoại, vì lớp học theo buổi thuyết trình và đặt câu hỏi bằng điện thoại là chính. Riêng các bảng rộng của giảng viên thì vuốt ngang trên chính bảng để xem hết cột.',
  ),
);

add(h2('Bài nộp và quyền xem'));
add(
  ...bullets([
    'Trước khi buổi thuyết trình bắt đầu, bài nộp là của riêng nhóm.',
    'Từ lúc buổi bắt đầu, cả lớp mở được đúng một tài liệu: file slide của nhóm đang trình bày (với bài tập lớn là pitch deck). Báo cáo phân tích, phiếu phân vai và phiếu khai báo AI vẫn là của riêng nhóm.',
    'Bấm vào tên file thì trình duyệt tải file về máy — đó là cố ý, để không có đường link nào sống ngoài hệ thống.',
  ]),
);

add(h2('Khi trợ giảng AI báo chưa dùng được'));
add(
  para(
    'Nếu thẻ trợ giảng AI báo "Bản triển khai này chưa cấu hình mô hình AI", nghĩa là quản trị viên chưa bật mô hình. Đây là một trạng thái bình thường, không phải lỗi — mọi chức năng còn lại vẫn chạy.',
  ),
);

add(h2('Ảnh trong tài liệu này'));
add(
  para(
    'Toàn bộ ảnh màn hình được chụp tự động từ chính bản đang chạy, với dữ liệu minh hoạ (tên lớp, tên nhóm và tên sinh viên trong ảnh là dữ liệu thử). Vì vậy khi giao diện đổi, ảnh trong tài liệu chụp lại được chứ không phải vẽ lại.',
  ),
);

add(rule());
add(
  new Paragraph({
    children: [text('CaseStudy Hub — tài liệu hướng dẫn sử dụng.', { color: MUTED, size: 18 })],
    alignment: AlignmentType.CENTER,
  }),
);

const doc = new Document({
  creator: 'CaseStudy Hub',
  title: 'CaseStudy Hub — Giới thiệu và hướng dẫn sử dụng',
  description: 'Giới thiệu, chức năng chính và hướng dẫn từng bước, kèm ảnh màn hình.',
  numbering: {
    config: [
      {
        reference: 'dots',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 220 } } },
          },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
      heading1: { run: { font: 'Calibri', size: 34, bold: true, color: BRAND } },
      heading2: { run: { font: 'Calibri', size: 27, bold: true, color: '113A26' } },
      heading3: { run: { font: 'Calibri', size: 24, bold: true, color: '113A26' } },
    },
  },
  sections: [{ children }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(OUT, buffer);
console.log(`Đã ghi ${OUT} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
