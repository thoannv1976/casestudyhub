import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

/**
 * Screenshots for the user guide, taken from the production build in
 * Vietnamese, on the data the smoke test created earlier in this run.
 *
 * Temporary: this file is deleted once the guide is written. It asserts
 * nothing, so it does not belong in CI.
 */

const SHOTS = 'guide-shots';
const DESKTOP = { width: 1280, height: 860 };

const ADMIN = { email: 'admin@e2e.test', password: 'e2eAdmin2026' };
const STUDENT = { email: 'student2@e2e.test', password: 'student2026' };

mkdirSync(SHOTS, { recursive: true });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/vi/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(dashboard|change-password)/);
}

/** Scrolls the named heading into view, then photographs the window. */
async function shot(page: Page, name: string, heading?: string) {
  try {
    if (heading) {
      const target = page.getByText(heading).first();
      await target.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    console.log(`SHOT ok ${name}`);
  } catch (error) {
    console.log(`SHOT FAILED ${name}: ${(error as Error).message.split('\n')[0]}`);
  }
}

test('screens a student sees', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);

  await page.goto('/vi/login');
  await shot(page, '01-dang-nhap');

  await page.goto('/vi/register');
  await shot(page, '02-dang-ky');

  await signIn(page, STUDENT.email, STUDENT.password);
  await shot(page, '03-trang-chu-sinh-vien');

  await page.goto('/vi/classes');
  await shot(page, '04-vao-lop-bang-ma');

  await page.getByRole('link').filter({ hasText: /E2E-/ }).first().click();
  await page.waitForURL(/\/classes\/.+/);
  await shot(page, '05-trang-lop-sinh-vien');
  await shot(page, '06-chon-nhom', 'Nhóm');
  await shot(page, '07-nop-bai', 'Bài làm của nhóm');
  await shot(page, '08-bai-tap-lon', 'Bài tập lớn của lớp');
});

test('the presentation room', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);
  await signIn(page, STUDENT.email, STUDENT.password);

  const live = page.getByTestId('dashboard-live').getByRole('link').first();
  if (await live.count()) {
    await live.click();
    await page.waitForURL(/\/sessions\/.+/);
    await shot(page, '09-phong-thuyet-trinh');
    await shot(page, '10-dat-cau-hoi', 'Câu hỏi của bạn');
  }

  await page.goto('/vi/portfolio');
  await shot(page, '11-the-ca-nhan');

  await page.goto('/vi/notifications');
  await shot(page, '24-thong-bao');

  await page.goto('/vi');
  await shot(page, '25-trang-gioi-thieu');
});

test('screens a lecturer sees', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);
  await signIn(page, ADMIN.email, ADMIN.password);

  await page.goto('/vi/teaching');
  await shot(page, '12-lop-giang-day');

  await page.getByRole('link').filter({ hasText: /E2E-/ }).first().click();
  await page.waitForURL(/\/teaching\/.+/);
  const classId = page.url().split('/teaching/')[1]?.split('/')[0] ?? '';
  await shot(page, '13-trang-lop-giang-vien');
  await shot(page, '14-danh-sach-sinh-vien', 'Danh sách sinh viên');
  await shot(page, '15-giao-bai', 'Giao Case Study');
  await shot(page, '16-bai-tap-lon-gv', 'Bài tập lớn của lớp');

  await page.goto(`/vi/teaching/${classId}/overview`);
  await shot(page, '17-bang-tong-hop');

  await page.goto(`/vi/teaching/${classId}/report`);
  await shot(page, '18-bao-cao-lop');

  // The marking screen, reached the way a lecturer reaches it.
  await page.goto(`/vi/teaching/${classId}`);
  const mark = page.getByRole('link', { name: 'Chấm điểm' }).first();
  if (await mark.count()) {
    await mark.click();
    await page.waitForURL(/\/grade\/.+/);
    await shot(page, '19-cham-diem');
    await shot(page, '20-ai-doc-bai', 'Mô hình đã đọc');
  }

  await page.goto(`/vi/teaching/${classId}`);
  const questions = page.getByRole('link', { name: 'Câu hỏi' }).first();
  if (await questions.count()) {
    await questions.click();
    await page.waitForURL(/\/questions$/);
    await shot(page, '21-bang-cau-hoi-gv');
  }

  await page.goto('/vi/framework');
  await shot(page, '22-khung-danh-gia');

  await page.goto('/vi/admin/system');
  await shot(page, '23-cai-dat-he-thong');
});
