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

/** Seeded by e2e/seed.mjs, so a group can reach the required four members. */
const SEEDED_STUDENTS = [2, 3, 4].map((index) => ({
  email: `student${index}@e2e.test`,
  password: 'student2026',
  fullName: `Seeded Student ${index}`,
}));

/**
 * The student sitting in the audience: in the class, in another group. The
 * question wall is written by people in exactly this position.
 */
const AUDIENCE = {
  email: 'student5@e2e.test',
  password: 'student2026',
  fullName: 'Seeded Student 5',
};

/** Carried between tests, because they are stages of one presentation. */
let slidesHref = '';
let reportHref = '';
let sessionUrl = '';

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

test('a lecturer creates groups the class can join', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.locator('#count').fill('2');
  await page.locator('#maxMembers').fill('4');
  await page.locator('#formationMode').selectOption('student_self_join');
  await page.getByRole('button', { name: 'Create groups' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('Created 2');
  await expect(page.getByRole('heading', { name: 'Group 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Group 2' })).toBeVisible();
});

test('a student joins a group', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  await page
    .getByRole('listitem')
    .filter({ hasText: 'Group 1' })
    .getByRole('button', { name: 'Join this group' })
    .click();

  await expect(page.getByText('Your group')).toBeVisible();
  await expect(page.getByText(STUDENT.fullName)).toBeVisible();
});

test('a student cannot hold two groups in one class', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  // The second group offers no join button at all once a student has one.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Group 2' }).getByRole('button', {
      name: 'Join this group',
    }),
  ).toHaveCount(0);
});

test('three more students fill the group to the four the framework requires', async ({ page }) => {
  for (const student of SEEDED_STUDENTS) {
    await signIn(page, student.email, student.password);

    await page.goto('/en/classes');
    await page.locator('#classCode').fill(CLASS_CODE);
    await page.getByRole('button', { name: 'Join class' }).click();
    await expect(page.getByTestId('alert-success')).toContainText('You joined');

    await page.getByText(CLASS_CODE).click();
    await page.waitForURL(/\/classes\/.+/);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Group 1' })
      .getByRole('button', { name: 'Join this group' })
      .click();
    await expect(page.getByText('Your group')).toBeVisible();

    await signOut(page);
  }
});

test('the fifth student is refused a group of four that is already full', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  // The seat count is what the transaction protects; the interface must show
  // the same truth.
  await expect(page.getByRole('listitem').filter({ hasText: 'Group 1' })).toContainText('4/4');
});

test('the lecturer assigns the presentation roles automatically', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  const groupOne = page.getByRole('listitem').filter({ hasText: 'Group 1' });
  await groupOne.getByRole('button', { name: 'Auto assign roles' }).click();

  // The merge table for a team of four: member 1 also takes R5, member 4 also
  // takes R6, and R3 and R4 are never dropped.
  await expect(groupOne.getByText('R1 + R5')).toBeVisible();
  await expect(groupOne.getByText('R2', { exact: true })).toBeVisible();
  await expect(groupOne.getByText('R3', { exact: true })).toBeVisible();
  await expect(groupOne.getByText('R4 + R6')).toBeVisible();
});

test('roles cannot be allocated to a group below the required size', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  // Group 2 is empty, so the button the framework protects stays unavailable.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Group 2' }).getByRole('button', {
      name: 'Auto assign roles',
    }),
  ).toBeDisabled();
});

test('the student sees the role they now own', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  await expect(page.getByText('Context setter')).toBeVisible();
});

/** The smallest thing a PDF reader will still call a PDF. */
const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);

test('a lecturer adds a case study and uploads its material', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/cases');

  await page.locator('#caseCode').fill(`CASE${RUN}`);
  await page.locator('#title').fill('Amazon');
  await page.locator('#company').fill('Amazon.com, Inc.');
  await page.locator('#cloIds').fill('CLO1, CLO2');
  await page.getByRole('button', { name: 'Add case study' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Case study created');

  const study = page.getByRole('listitem').filter({ hasText: `CASE${RUN}` });
  await expect(study).toContainText('Draft');

  await study.locator('input[type="file"]').setInputFiles({
    name: 'amazon-case.pdf',
    mimeType: 'application/pdf',
    buffer: TINY_PDF,
  });
  await expect(page.getByTestId('alert-success')).toContainText('amazon-case.pdf');
});

test('a file wearing the wrong type is refused', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/cases');

  const study = page.getByRole('listitem').filter({ hasText: `CASE${RUN}` });
  await study.locator('input[type="file"]').setInputFiles({
    name: 'payload.pdf',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('MZ not a pdf at all', 'utf8'),
  });

  await expect(page.getByTestId('alert-error')).toContainText('not accepted');
});

test('a draft case stays invisible to students until it is published', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/cases');
  await expect(page.getByText(`CASE${RUN}`)).toHaveCount(0);
});

test('publishing the case makes it readable by the class', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/cases');

  const study = page.getByRole('listitem').filter({ hasText: `CASE${RUN}` });
  await study.getByRole('button', { name: 'Publish to students' }).click();
  await expect(study).toContainText('Published');

  await signOut(page);
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/cases');

  const studentView = page.getByRole('listitem').filter({ hasText: `CASE${RUN}` });
  await expect(studentView).toContainText('Amazon');

  // The download goes through the server, which is what makes the check above
  // impossible to walk around with a shared link.
  const link = studentView.getByRole('link', { name: 'amazon-case.pdf' });
  const href = await link.getAttribute('href');
  const response = await page.request.get(href ?? '');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(response.headers()['content-disposition']).toContain('attachment');
});

test('a lecturer sets the case for the group', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  // Far enough ahead that the submission window is open.
  const presentation = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const localValue = new Date(presentation.getTime() - presentation.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  await page.locator('#assignGroupId').selectOption({ label: 'Group 1' });
  await page.locator('#presentationDate').fill(localValue);
  await page.getByRole('button', { name: 'Set this case' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('Case set');
  await expect(page.getByRole('row').filter({ hasText: 'Group 1' })).toContainText('Nothing yet');
});

test('the group sees what it owes and hands in the slides', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const slides = page.getByRole('listitem').filter({ hasText: 'Presentation slides' });
  await expect(slides).toContainText('Not handed in');

  await slides.locator('input[type="file"]').setInputFiles({
    name: 'group1-slides.pdf',
    mimeType: 'application/pdf',
    buffer: TINY_PDF,
  });

  await expect(page.getByTestId('alert-success')).toContainText('version 1');
  await expect(slides).toContainText('v1 · group1-slides.pdf');
});

test('handing in again creates a version rather than overwriting', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const slides = page.getByRole('listitem').filter({ hasText: 'Presentation slides' });
  await slides.locator('input[type="file"]').setInputFiles({
    name: 'group1-slides-v2.pdf',
    mimeType: 'application/pdf',
    buffer: TINY_PDF,
  });

  await expect(page.getByTestId('alert-success')).toContainText('version 2');
  // The first version is still listed: a lecturer must be able to see what
  // was in place before.
  await expect(slides).toContainText('v1 · group1-slides.pdf');
  await expect(slides).toContainText('v2 · group1-slides-v2.pdf');
});

test('a deliverable refuses a file the framework does not allow', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  // The slides deliverable takes a PDF; a Word file is not one.
  const slides = page.getByRole('listitem').filter({ hasText: 'Presentation slides' });
  await slides.locator('input[type="file"]').setInputFiles({
    name: 'slides.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK not really a docx', 'utf8'),
  });

  await expect(page.getByTestId('alert-error')).toContainText('not accepted');
});

test('a student from another group cannot read the submitted file', async ({ page, request }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const href = await page.getByRole('link', { name: /group1-slides-v2\.pdf/ }).getAttribute('href');
  expect(href).toBeTruthy();
  // Kept for the session tests: the same address is what the class will be
  // allowed to open once this group takes the floor, and no other.
  slidesHref = href ?? '';

  // The same address, fetched without this student's session, gives nothing.
  const anonymous = await request.get(href ?? '');
  expect(anonymous.status()).toBe(401);
});

test('the lecturer sees the group has handed something in', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await expect(page.getByRole('row').filter({ hasText: 'Group 1' })).toContainText('1 item');
});

/**
 * The classroom itself (SRS Module 10). A group presents, the rest of the
 * class watches on their own screens and asks; the group answers two or three
 * aloud and the rest of the questions stay with the case study.
 */

test('the group also hands in the analysis report, which stays private', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const report = page.getByRole('listitem').filter({ hasText: 'Case analysis report' });
  await report.locator('input[type="file"]').setInputFiles({
    name: 'group1-report.pdf',
    mimeType: 'application/pdf',
    buffer: TINY_PDF,
  });
  await expect(page.getByTestId('alert-success')).toContainText('version 1');

  reportHref =
    (await page.getByRole('link', { name: /group1-report\.pdf/ }).getAttribute('href')) ?? '';
  expect(reportHref).not.toHaveLength(0);
});

test('the student in the audience joins the class and a different group', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);

  await page.goto('/en/classes');
  await page.locator('#classCode').fill(CLASS_CODE);
  await page.getByRole('button', { name: 'Join class' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('You joined');

  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Group 2' })
    .getByRole('button', { name: 'Join this group' })
    .click();
  await expect(page.getByText('Your group')).toBeVisible();
});

test('before the session starts the slides belong to the group alone', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);

  const response = await page.request.get(slidesHref);
  expect(response.status()).toBe(403);
});

test('the lecturer starts the session and the clock appears', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page
    .getByRole('listitem')
    .filter({ hasText: 'Group 1' })
    .getByRole('button', { name: 'Start session' })
    .click();

  await page.waitForURL(/\/sessions\/.+/);
  // Without the locale prefix: the tests build both page and API addresses
  // from it, and only the page carries a locale.
  sessionUrl = new URL(page.url()).pathname.replace(/^\/[a-z]{2}(?=\/)/, '');
  expect(sessionUrl).toMatch(/^\/sessions\/.+/);

  await expect(page.getByText('Presenting', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  // The role that speaks first, named rather than numbered.
  // It appears twice: on the clock, and beside the member who owns it.
  await expect(page.getByText('R1 · Context setter').first()).toBeVisible();
});

test('once the session starts the class can open the slides, and nothing else', async ({
  page,
}) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);

  const slides = await page.request.get(slidesHref);
  expect(slides.status()).toBe(200);
  expect(slides.headers()['content-type']).toContain('application/pdf');

  // The gap is the slide deck. The analysis report of the same group, of the
  // same assignment, in the same live session, is still refused.
  const report = await page.request.get(reportHref);
  expect(report.status()).toBe(403);
});

test('a student in the audience asks their one question', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  await page.locator('#text').fill('Which figure shows the marketplace is more profitable?');
  await page.locator('#category').selectOption('evidence');
  await page.locator('#roleId').selectOption('R3');
  await page.getByRole('button', { name: 'Send question' }).click();

  await expect(page.getByText('1 question', { exact: true })).toBeVisible();
  // Scoped to the wall: the same words are sitting in the edit form above it.
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Which figure shows the marketplace' }),
  ).toBeVisible();
});

test('sending again edits the same question rather than adding a second', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  // Their own question comes back in the form, which is how they know they
  // already asked one.
  await expect(page.locator('#text')).toHaveValue(/Which figure/);

  await page.locator('#text').fill('Which figure shows the marketplace outearns retail?');
  await page.getByRole('button', { name: 'Update question' }).click();

  await expect(page.getByText('1 question', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'outearns retail' })).toBeVisible();
});

test('the presenting group is not offered a question to ask itself', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByText('Question wall')).toBeVisible();
  await expect(page.locator('#text')).toHaveCount(0);

  // And typing the request directly is refused too: the form is not the rule.
  const response = await page.request.post(`/api${sessionUrl}/questions`, {
    data: {
      action: 'ask',
      category: 'evidence',
      text: 'A question the presenting group asked itself.',
    },
  });
  expect(response.status()).toBe(422);
});

test('an anonymous question does not carry its asker to the browser', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${sessionUrl}`);

  // Not merely hidden in the markup: the name never leaves the server.
  await expect(page.getByText(AUDIENCE.fullName)).toHaveCount(0);

  const response = await page.request.get(`/api${sessionUrl}/questions`);
  const body = await response.text();
  expect(body).toContain('outearns retail');
  expect(body).not.toContain(AUDIENCE.fullName);
  expect(body).toContain('Anonymous');
});

test('the lecturer does see who asked, because it counts toward the mark', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);

  const response = await page.request.get(`/api${sessionUrl}/questions`);
  expect(await response.text()).toContain(AUDIENCE.fullName);
});

test('the group chooses the question it will answer, and records the answer', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${sessionUrl}`);

  const question = page.getByRole('listitem').filter({ hasText: 'outearns retail' });
  await question.getByRole('button', { name: 'Choose to answer' }).click();
  await expect(page.getByText('1 of 3 chosen')).toBeVisible();

  await question.getByRole('button', { name: 'Record the answer' }).click();
  await question
    .getByRole('textbox', { name: 'Record the answer' })
    .fill('Third-party seller services revenue, shown on slide 9.');
  await question.getByRole('button', { name: 'Save answer' }).click();

  await expect(question.getByText('Answered')).toBeVisible();
  await expect(question).toContainText('Third-party seller services revenue');
});

test('the lecturer sees the Q&A checklist the Guide asks for', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByText('Q&A checklist')).toBeVisible();
  // One question so far, and the framework wants at least two.
  await expect(page.getByText('1 question from the class (at least 2)')).toBeVisible();
  await expect(page.getByText('of 4 members have answered')).toBeVisible();
});

test('a student cannot run the clock or close the questions', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);

  const response = await page.request.post(`/api${sessionUrl}`, {
    data: { action: 'pause' },
  });
  expect(response.status()).toBe(403);
});

test('closing the window stops new questions without hiding the ones asked', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);
  await page.getByRole('button', { name: 'Close questions' }).click();
  await expect(page.getByRole('button', { name: 'Open questions' })).toBeVisible();

  await signOut(page);
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByText('The question window is closed.')).toBeVisible();
  // Closing the window stops new questions; it does not take away the bank.
  await expect(page.getByRole('listitem').filter({ hasText: 'outearns retail' })).toBeVisible();
});

test('scoring is shut until the lecturer opens it', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByText('Scoring is not open.')).toBeVisible();

  // And the form is not what enforces it.
  const response = await page.request.post(`/api${sessionUrl}/peer-review`, {
    data: {
      scores: {
        understanding: 20,
        analysis: 25,
        evidence: 15,
        critique: 15,
        transferDecision: 15,
        delivery: 10,
      },
    },
  });
  expect(response.status()).toBe(422);
});

test('the class scores the group against the lecturer\u2019s own rubric', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);
  await page.getByRole('button', { name: 'Open scoring' }).click();
  await expect(page.getByRole('button', { name: 'Close scoring' })).toBeVisible();
  await signOut(page);

  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  await page.locator('#understanding').fill('18');
  await page.locator('#analysis').fill('20');
  await page.locator('#evidence').fill('11');
  await page.locator('#critique').fill('12');
  await page.locator('#transferDecision').fill('13');
  await page.locator('#delivery').fill('8');
  await page.locator('#comment').fill('Strong on the model, thin on the numbers.');
  await page.getByRole('button', { name: 'Send score' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('82');
});

test('a score above what a criterion is worth is refused', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  // The browser stops it at the input, so the check that matters is the one
  // behind it.
  const response = await page.request.post(`/api${sessionUrl}/peer-review`, {
    data: {
      scores: {
        understanding: 20,
        analysis: 25,
        evidence: 15,
        critique: 15,
        transferDecision: 15,
        delivery: 40,
      },
    },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error.messageKey).toBe('errors.peerScoreOutOfRange');
});

test('the presenting group is not asked to score itself', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.locator('#understanding')).toHaveCount(0);

  const response = await page.request.post(`/api${sessionUrl}/peer-review`, {
    data: {
      scores: {
        understanding: 20,
        analysis: 25,
        evidence: 15,
        critique: 15,
        transferDecision: 15,
        delivery: 10,
      },
    },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error.messageKey).toBe('errors.cannotReviewOwnGroup');
});

test('a classmate cannot read what somebody else gave', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  const response = await page.request.get(`/api${sessionUrl}/peer-review`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  // Their own row, which is null here, and no sight of anyone else's.
  expect(body.own).toBeNull();
  expect(body.reviews).toBeUndefined();
  expect(body.summary).toBeUndefined();
});

test('the lecturer reads the distribution, not a number to paste into a grade', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);

  await expect(page.getByText('What the class gave')).toBeVisible();
  await expect(page.getByText('1 scores · mean 82.0 · median 82.0')).toBeVisible();
  await expect(
    page.getByText('never added to a final grade automatically', { exact: false }),
  ).toBeVisible();
});

test('the slides stay open after the presentation ends', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Finished')).toBeVisible();

  await signOut(page);
  await signIn(page, AUDIENCE.email, AUDIENCE.password);

  // The class keeps the slides to revise from; the report is still not theirs.
  expect((await page.request.get(slidesHref)).status()).toBe(200);
  expect((await page.request.get(reportHref)).status()).toBe(403);
});

test('a student from another class cannot reach the room at all', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${sessionUrl}`);
  await signOut(page);

  // Every other account in this run belongs to the class by now, so the
  // outsider has to be a fresh one.
  await page.goto('/en/register');
  await page.locator('#studentId').fill(`SVOUT${RUN}`);
  await page.locator('#fullName').fill('Outsider Student');
  await page.locator('#email').fill(`outsider.${RUN}@e2e.test`);
  await page.locator('#password').fill('outsider2026');
  await page.locator('#confirmPassword').fill('outsider2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard');

  await page.goto(`/en${sessionUrl}`);
  await expect(page.getByTestId('alert-error')).toContainText('not enrolled');

  const questions = await page.request.get(`/api${sessionUrl}/questions`);
  expect(questions.status()).toBe(403);
  expect((await page.request.get(slidesHref)).status()).toBe(403);
});

test('a student is refused the administration pages', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  // Typing the address must not be enough: the refusal comes from the server.
  await page.goto('/en/admin/users');
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');
  await expect(page.getByRole('cell', { name: ADMIN.email })).toHaveCount(0);
});

test('a student cannot read another class the platform happens to hold', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  // A second class this student never joined.
  await signOut(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.locator('#classCode').fill(`OTHER-${RUN}`);
  await page.locator('#className').fill('Another cohort');
  await page.getByRole('button', { name: 'Create a class' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('Class created');

  await page.getByText(`OTHER-${RUN}`).click();
  await page.waitForURL(/\/teaching\/.+/);
  const otherClassId = page.url().split('/teaching/')[1]?.split(/[?#]/)[0] ?? '';
  expect(otherClassId).not.toHaveLength(0);

  await signOut(page);
  await signIn(page, STUDENT.email, STUDENT.password);

  // Signed in is not the same as belonging: the group list of a class this
  // student is not in carries other students' names.
  // page.request carries this student's session; the bare request fixture
  // would only prove that an anonymous caller is refused.
  const groups = await page.request.get(`/api/classes/${otherClassId}/groups`);
  expect(groups.status()).toBe(403);

  const assignments = await page.request.get(`/api/classes/${otherClassId}/assignments`);
  expect(assignments.status()).toBe(403);

  await page.goto(`/en/classes/${otherClassId}`);
  await expect(page.getByTestId('alert-error')).toContainText('not enrolled');
});

test('a keyboard user can skip the header and reach the content', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  // A fresh navigation, so focus starts at the top of the document rather than
  // wherever the sign-in form left it.
  await page.goto('/en/dashboard');

  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeAttached();

  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeVisible();
});

test('every page declares its language, so a screen reader reads it correctly', async ({
  page,
}) => {
  await page.goto('/en/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.goto('/vi/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  // The interface language is what changes; the documents keep their own.
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('an anonymous visitor is sent to the sign-in page', async ({ page }) => {
  await page.goto('/en/dashboard');
  await page.waitForURL('**/login');
});
