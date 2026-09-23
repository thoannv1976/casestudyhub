import { expect, test, type Page } from '@playwright/test';

/**
 * One story, end to end, on the production build: the path that broke in
 * production and that no unit or rules test can reach.
 *
 * Runs in English so the selectors read as the interface does; the Vietnamese
 * side is covered by the message catalogue tests.
 */

const ADMIN = { email: 'admin@e2e.test', password: 'e2eAdmin2026' };

const RUN = Date.now().toString().slice(-6);
const STUDENT = {
  studentId: `SV${RUN}`,
  fullName: 'Nguyen Van Student',
  email: `student.${RUN}@e2e.test`,
  password: 'student2026',
};
const LECTURER = {
  fullName: 'Tran Thi Lecturer',
  email: `lecturer.${RUN}@e2e.test`,
  temporaryPassword: 'tempPass2026',
  newPassword: 'lecturerOwn2026',
};
const CLASS_CODE = `E2E-${RUN}`;

/**
 * Signing in ends with a navigation. Without waiting for it, the next step
 * opens a page before the session cookie is set and lands back on sign-in -
 * a failure that looks like a broken feature but is a broken test.
 */
async function signIn(
  page: Page,
  email: string,
  password: string,
  options: { expectFailure?: boolean } = {},
) {
  await page.goto('/en/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  if (!options.expectFailure) {
    await page.waitForURL(/\/(dashboard|change-password)/);
  }
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
}

test.describe.configure({ mode: 'serial' });

test('the service answers before anything else is attempted', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect((await response.json()).status).toBe('ok');
});

test('a student registers and reaches their dashboard', async ({ page }) => {
  await page.goto('/en/register');

  await page.locator('#studentId').fill(STUDENT.studentId);
  await page.locator('#fullName').fill(STUDENT.fullName);
  await page.locator('#email').fill(STUDENT.email);
  await page.locator('#password').fill(STUDENT.password);
  await page.locator('#confirmPassword').fill(STUDENT.password);
  await page.locator('#preferredLanguage').selectOption('en');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(STUDENT.fullName);
  await signOut(page);
});

test('the same student ID cannot be registered twice', async ({ page }) => {
  await page.goto('/en/register');

  await page.locator('#studentId').fill(STUDENT.studentId);
  await page.locator('#fullName').fill('Somebody Else');
  await page.locator('#email').fill(`other.${RUN}@e2e.test`);
  await page.locator('#password').fill('another2026');
  await page.locator('#confirmPassword').fill('another2026');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByTestId('alert-error')).toContainText('student ID is already registered');
  // The failed attempt must not have left an account behind, so the address is
  // still free to register with.
  await expect(page).toHaveURL(/\/register/);
});

test('an admin builds the academic structure and a class', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.waitForURL('**/dashboard');

  await page.goto('/en/admin/academic');
  await page.locator('#yearName').fill(`2026-2027 #${RUN}`);
  await page.locator('#startDate').fill('2026-09-01');
  await page.locator('#endDate').fill('2027-06-30');
  await page.getByRole('button', { name: 'Add year' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Academic year created');

  await page.locator('#semesterName').fill(`Fall ${RUN}`);
  await page.getByRole('button', { name: 'Add semester' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Semester created');

  await page.locator('#courseCode').fill(`ECOM${RUN}`);
  await page.locator('#courseName').fill('E-Commerce 2026');
  await page.locator('#cloIds').fill('CLO1, CLO2');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Course created');

  await page.goto('/en/teaching');
  await page.locator('#classCode').fill(CLASS_CODE);
  await page.locator('#className').fill(`E-Commerce ${RUN}`);
  await page.locator('#joinMode').selectOption('code');
  await page.getByRole('button', { name: 'Create a class' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Class created');
  await expect(page.getByText(CLASS_CODE)).toBeVisible();
});

test('an admin creates a lecturer account with a temporary password', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  await page.locator('#staffName').fill(LECTURER.fullName);
  await page.locator('#staffEmail').fill(LECTURER.email);
  await page.locator('#staffRole').selectOption('lecturer');
  await page.locator('#tempPassword').fill(LECTURER.temporaryPassword);
  await page.getByRole('button', { name: 'Create account' }).click();

  // The regression this whole test exists for: this returned 500 in production.
  await expect(page.getByTestId('alert-success')).toContainText(LECTURER.email);
  await expect(page.getByRole('cell', { name: LECTURER.email })).toBeVisible();
});

test('a temporary password gets the lecturer nowhere until it is replaced', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.temporaryPassword);
  await page.waitForURL('**/change-password');

  // Even asking for another page directly comes straight back here.
  await page.goto('/en/teaching');
  await page.waitForURL('**/change-password');

  await page.locator('#newPassword').fill(LECTURER.newPassword);
  await page.locator('#confirmPassword').fill(LECTURER.newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();

  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(LECTURER.fullName);
});

test('the old temporary password no longer works', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.temporaryPassword, { expectFailure: true });
  await expect(page.getByTestId('alert-error')).toContainText('incorrect');
});

test('a student joins the class with its code', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');

  await page.locator('#classCode').fill(CLASS_CODE);
  await page.getByRole('button', { name: 'Join class' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('You joined');
  await expect(page.getByText(CLASS_CODE)).toBeVisible();
});

test('a student cannot join the same class twice', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');

  await page.locator('#classCode').fill(CLASS_CODE);
  await page.getByRole('button', { name: 'Join class' }).click();

  await expect(page.getByTestId('alert-error')).toContainText('already in this class');
});

test('the lecturer sees the student on the class roster', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');

  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  // Scoped to the student's own row: the heading badge also counts sign-ups.
  const row = page.getByRole('row').filter({ hasText: STUDENT.studentId });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Signed up')).toBeVisible();
  await expect(row).toContainText(STUDENT.fullName);
});

test('a student is refused the administration pages', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  // Typing the address must not be enough: the refusal comes from the server.
  await page.goto('/en/admin/users');
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');
  await expect(page.getByRole('cell', { name: ADMIN.email })).toHaveCount(0);
});

test('an anonymous visitor is sent to the sign-in page', async ({ page }) => {
  await page.goto('/en/dashboard');
  await page.waitForURL('**/login');
});
