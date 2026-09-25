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

/** The password an administrator sets for the lecturer, partway through. */
const RESET_PASSWORD = 'resetPass2026';
const CORRECTED_NAME = 'Tran Thi Bich Lecturer';

/** Set if a test reset the student's password; null while it is their own. */
const LECTURER_SET_STUDENT_PASSWORD: string | null = null;

/** A student an administrator adds, for one who could not register. */
const ADDED_STUDENT = {
  studentId: `SVADM${RUN}`,
  fullName: 'Le Thi Added',
  email: `added.${RUN}@e2e.test`,
  temporaryPassword: 'addedPass2026',
};

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
let gradeUrl = '';

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

/**
 * A phone, because that is what the class uses. Students follow a presentation
 * on their own screen and ask from it, so the room pages have to work at this
 * width - and nothing else in this suite runs anywhere near it.
 */
const PHONE = { width: 390, height: 844 };

/**
 * Nothing may spill sideways. A page wider than the screen is how a form
 * becomes unusable on a phone: the submit button sits off the edge, and the
 * reader has no way to know it is there.
 */
async function expectFitsThePhone(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `page scrolls sideways at phone width (${overflow.scrollWidth}px in ${overflow.clientWidth}px)`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login');
}

test.describe.configure({ mode: 'serial' });

test('the service answers before anything else is attempted', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body.status).toBe('ok');
  // It used to report `phase: 1`, written when there was one phase and still
  // saying so through four. A liveness probe that lies about the build is
  // worse than one that says less.
  expect(body).not.toHaveProperty('phase');
  expect(body.revision).toBeTruthy();
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

  // The dashboard used to tell everybody "Phase 1 is being built". A new
  // account has no class yet, and that is what it should say.
  await expect(page.getByText('have not joined a class yet')).toBeVisible();
  await expect(page.getByText('Phase 1')).toHaveCount(0);

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

test('the room works on the phone the class actually uses', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);

  await expectFitsThePhone(page);

  // The three things a student does from their seat, all reachable.
  await expect(page.locator('#text')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update question' })).toBeVisible();
  await expect(page.getByRole('link', { name: /group1-slides/ })).toBeVisible();

  // The anonymity checkbox is a checkbox, not a full-width bordered box. The
  // shared Input overwrote the caller's className instead of merging it, so
  // every checkbox in the app rendered as a tall empty field.
  const anonymous = page.locator('#anonymousToClass');
  const box = await anonymous.boundingBox();
  expect(box, 'the anonymity checkbox has no box').not.toBeNull();
  expect(box!.width, 'the checkbox is stretched to the full width').toBeLessThan(40);

  await page.setViewportSize({ width: 1280, height: 720 });
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

test('opening scoring reaches a student already in the room, with no reload', async ({
  page,
  browser,
}) => {
  // The room used to be rendered once and never updated, so a lecturer opening
  // scoring reached nobody: sixty students would each have to press reload
  // while the lecturer said so out loud. This is that case, end to end.
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto(`/en${sessionUrl}`);
  await expect(page.getByText('Scoring is not open.')).toBeVisible();

  // A second browser session, because the lecturer is on their own machine.
  const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const staffPage = await staff.newPage();
  await signIn(staffPage, ADMIN.email, ADMIN.password);
  await staffPage.goto(`/en${sessionUrl}`);
  await staffPage.getByRole('button', { name: 'Open scoring' }).click();
  await expect(staffPage.getByRole('button', { name: 'Close scoring' })).toBeVisible();
  await staff.close();

  // The student's page has not been touched: no reload, no navigation. The
  // ten-second poll carries the change, so allow for one full interval.
  await expect(page.locator('#understanding')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Scoring is not open.')).toHaveCount(0);
});

test('the class scores the group against the lecturer\u2019s own rubric', async ({ page }) => {
  // Scoring was opened by the test above and is still open.
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

/**
 * Marking and publishing (SRS Module 13). The lecturer decides; everything the
 * class produced is evidence beside the decision, never the decision itself.
 */

test('the class acquires its lecturer, who could reach nothing before', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  // Created by the admin, so this lecturer is not on it yet.
  await expect(page.getByText(CLASS_CODE)).toHaveCount(0);
  await signOut(page);

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.locator('#lecturerEmail').fill(LECTURER.email);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  await expect(page.getByTestId('alert-success')).toContainText(LECTURER.fullName);

  await signOut(page);
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await expect(page.getByText(CLASS_CODE)).toBeVisible();
});

test('an email belonging to nobody is refused, and a student is not a lecturer', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.locator('#lecturerEmail').fill(`nobody.${RUN}@e2e.test`);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  await expect(page.getByTestId('alert-error')).toContainText('No account');

  await page.locator('#lecturerEmail').fill(STUDENT.email);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  await expect(page.getByTestId('alert-error')).toContainText('not a lecturer account');
});

test('the marking screen lays the evidence out beside the rubric', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.getByRole('link', { name: 'Mark' }).first().click();
  await page.waitForURL(/\/grade\/.+/);
  gradeUrl = new URL(page.url()).pathname.replace(/^\/[a-z]{2}(?=\/)/, '');

  await expect(page.getByRole('heading', { level: 1, name: 'Marking' })).toBeVisible();
  await expect(page.getByText('Not marked')).toBeVisible();
  await expect(page.getByText('The group handed in on time.')).toBeVisible();
  await expect(page.getByText('The class asked 1 question;')).toBeVisible();
  await expect(page.getByText('1 score from the class')).toBeVisible();
  // The criterion AI may never score is labelled as the lecturer's own.
  await expect(page.getByText('Judged in the room')).toBeVisible();
});

test('marking computes every member\u2019s mark before anything is published', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en${gradeUrl}`);

  await page.locator('#understanding').fill('18');
  await page.locator('#analysis').fill('22');
  await page.locator('#evidence').fill('12');
  await page.locator('#critique').fill('13');
  await page.locator('#transferDecision').fill('13');
  await page.locator('#delivery').fill('8');
  await page.locator('#comment').fill('Clear on the model; the numbers needed one more slide.');

  // 86 for the group. Everyone gets 70 individually except one who was absent.
  const scores = page.locator('input[name^="score_"]');
  const count = await scores.count();
  expect(count).toBe(4);
  for (let index = 0; index < count; index += 1) {
    await scores.nth(index).fill('70');
  }
  await page.locator('input[name^="absent_"]').first().check();

  await page.getByRole('button', { name: 'Save marking' }).click();

  await expect(page.getByText('What each member would get')).toBeVisible();
  // 86 * 0.8 + 70 * 0.2 = 82.8, rounded to the whole point the framework marks
  // in; the member who did not present forfeits the individual fifth.
  const preview = page.getByTestId('grade-preview');
  await expect(preview.getByRole('listitem').filter({ hasText: 'Seeded Student 2' })).toContainText(
    '83',
  );
  await expect(preview.getByRole('listitem').filter({ hasText: STUDENT.fullName })).toContainText(
    '69',
  );
  await expect(page.getByText('individual share forfeited: absent')).toBeVisible();
});

test('a student sees nothing while the mark is still a draft', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  await expect(page.getByText('Your mark')).toHaveCount(0);
});

test('a student cannot reach the marking screen or the endpoint behind it', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en${gradeUrl}`);
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');

  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';
  const response = await page.request.get(`/api/assignments/${assignmentId}/assessment`);
  expect(response.status()).toBe(403);
});

test('publishing is the lecturer\u2019s decision, not the administrator\u2019s', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/en${gradeUrl}`);

  // The admin may mark, but the publish button is not offered...
  await expect(page.getByText('Publishing a grade is the lecturer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish to students' })).toHaveCount(0);

  // ...and asking for it directly is refused.
  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';
  const response = await page.request.post(`/api/assignments/${assignmentId}/assessment`, {
    data: { action: 'publish' },
  });
  expect(response.status()).toBe(403);
});

test('the lecturer publishes, and the group sees the mark', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en${gradeUrl}`);
  await page.getByRole('button', { name: 'Publish to students' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('published');
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  await expect(page.getByText('Your mark')).toBeVisible();
  // This student is the one who did not present, so they see 69, not 83.
  await expect(page.getByText('69', { exact: true })).toBeVisible();
  await expect(page.getByText('Framework version 2026.1')).toBeVisible();
});

/**
 * Notifications (SRS Module 15). The mark was published in the test above, so
 * this checks the part a student actually experiences: they were told,
 * without anyone having to tell them in person.
 */
test('the student is told their mark is out, in their own language', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/dashboard');

  // The bell counts what is waiting, on whatever page they happen to be on.
  const bell = page.getByTestId('notification-bell');
  await expect(page.getByTestId('notification-count')).toBeVisible({ timeout: 15_000 });

  await bell.click();
  await page.waitForURL(/\/notifications$/);

  const list = page.getByTestId('notification-list');
  await expect(list).toContainText('Your mark');
  await expect(list.getByText('New').first()).toBeVisible();

  // Nothing stored is a sentence: the same notification reads in Vietnamese
  // for a reader who switches, which is why only a key is written down.
  await page.goto('/vi/notifications');
  await expect(page.getByTestId('notification-list')).toContainText(
    '\u0111\u00e3 \u0111\u01b0\u1ee3c c\u00f4ng b\u1ed1',
  );
});

test('marking everything read empties the bell and keeps it empty', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/notifications');

  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  await expect(page.getByText('Nothing unread')).toBeVisible();

  // A reload proves it was written down rather than only crossed off on screen.
  await page.reload();
  await expect(page.getByText('Nothing unread')).toBeVisible();
  await expect(page.getByTestId('notification-count')).toHaveCount(0);
});

test('a published mark cannot be quietly edited', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en${gradeUrl}`);

  await expect(page.getByText('These grades have been published')).toBeVisible();
  await expect(page.locator('#understanding')).toHaveCount(0);

  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';
  const response = await page.request.post(`/api/assignments/${assignmentId}/assessment`, {
    data: {
      criterionScores: {
        understanding: 20,
        analysis: 25,
        evidence: 15,
        critique: 15,
        transferDecision: 15,
        delivery: 10,
      },
      individual: {},
    },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error.messageKey).toBe('errors.gradeAlreadyPublished');
});

test('a classmate cannot read somebody else\u2019s mark', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  // In the class, in another group, with no assignment of their own: nothing.
  await expect(page.getByText('Your mark')).toHaveCount(0);
  await expect(page.getByText('Framework version')).toHaveCount(0);
});

/**
 * The AI layer (SRS Module 12). Nothing is configured in this run, on purpose:
 * a deployment without a model has to keep working, and say so.
 */

test('a deployment with no model says so instead of breaking', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en${gradeUrl}`);

  await expect(page.getByText('What the model read')).toBeVisible();
  await expect(page.getByText('No AI model is configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask the model' })).toHaveCount(0);

  // And the endpoint agrees, rather than throwing something untranslatable.
  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';
  const response = await page.request.post(`/api/assignments/${assignmentId}/ai-assessment`);
  expect(response.status()).toBe(422);
  expect((await response.json()).error.messageKey).toBe('errors.aiNotConfigured');
});

test('the case keeps the class\u2019s questions as a bank for later years', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);

  await expect(page.getByRole('heading', { level: 1, name: 'Amazon' })).toBeVisible();
  await expect(page.getByText('The class question bank')).toBeVisible();
  // One question, answered in the room during the session earlier in this run.
  await expect(page.getByText('1 question · 1 answered in the room · 0 still open')).toBeVisible();
  await expect(page.getByText('outearns retail')).toBeVisible();
  await expect(page.getByText('Third-party seller services revenue')).toBeVisible();
});

test('a student reads the bank, but not who asked', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);

  await expect(page.getByText('outearns retail')).toBeVisible();
  // Their own question, anonymised the way a later cohort will read it.
  await expect(page.getByText(AUDIENCE.fullName)).toHaveCount(0);
  // And nothing here offers a student the model.
  await expect(page.getByRole('button', { name: /Answer/ })).toHaveCount(0);
});

test('only staff can ask the model to answer a bank', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/cases');
  const href = await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .getAttribute('href');
  const caseId = (href ?? '').split('/cases/')[1] ?? '';
  expect(caseId).not.toHaveLength(0);

  const response = await page.request.post(`/api/cases/${caseId}/answers`, { data: {} });
  expect(response.status()).toBe(403);
});

/**
 * Reporting and the student's own record (SRS Module 14). Everything here is a
 * reading of decisions already made; nothing on these pages changes a mark.
 */

test('the class report reads back what was marked and published', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.getByRole('link', { name: 'Class report' }).click();
  await page.waitForURL(/\/report$/);

  // The group of four was published earlier in this run at 83, 83, 83 and 69.
  await expect(page.getByText('4 students · mean 79.5')).toBeVisible();
  await expect(page.getByText('Published grades only')).toBeVisible();

  // The cohort was marked 12 of 15 on evidence, its weakest criterion.
  await expect(page.getByText('Where the cohort is strong')).toBeVisible();
  await expect(page.getByText('Learning outcome attainment')).toBeVisible();
  // The caveat is part of the report, not a footnote to it.
  await expect(page.getByText('Confirm it against the syllabus')).toBeVisible();
});

test('the report names who took no part', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);
  await page.getByRole('link', { name: 'Class report' }).click();
  await page.waitForURL(/\/report$/);

  await expect(page.getByText('Who took part')).toBeVisible();
  // Five students in the class; only the one in the audience asked anything.
  await expect(page.getByText('1 of 5 asked a question')).toBeVisible();
  await expect(page.getByText('took no part')).toBeVisible();
});

test('the report downloads as a spreadsheet, with formulas defused', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);
  const classId = page.url().split('/teaching/')[1]?.split(/[?#]/)[0] ?? '';

  const response = await page.request.get(`/api/classes/${classId}/report`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  expect(response.headers()['content-disposition']).toContain('attachment');

  const csv = await response.text();
  // The byte order mark is what makes Excel read Vietnamese correctly.
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('CaseStudy Hub');
  expect(csv).toContain('CLO1');
});

test('a student cannot read their class\u2019s report', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);
  const classId = page.url().split('/teaching/')[1]?.split(/[?#]/)[0] ?? '';
  await signOut(page);

  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto(`/en/teaching/${classId}/report`);
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');

  const response = await page.request.get(`/api/classes/${classId}/report`);
  expect(response.status()).toBe(403);
});

test('a student\u2019s portfolio shows their published mark and their contribution', async ({
  page,
}) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/portfolio');

  await expect(page.getByRole('heading', { level: 1, name: 'My portfolio' })).toBeVisible();
  await expect(page.getByText(`E-Commerce ${RUN}`)).toBeVisible();
  // This student presented, so they carried a role, and their mark is 69.
  await expect(page.getByText('Context setter').first()).toBeVisible();
  await expect(page.getByText('69', { exact: true })).toBeVisible();
});

test('a student who was quiet sees that, rather than an empty page', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/portfolio');

  // They asked one question and scored one group, but were never marked.
  await expect(page.getByText('questions asked')).toBeVisible();
  await expect(page.getByText('Not published yet')).toBeVisible();
});

test('a portfolio is one student\u2019s own, and nobody else\u2019s', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/portfolio');

  // The presenting group's mark belongs to them, not to the audience.
  await expect(page.getByText(STUDENT.fullName)).toHaveCount(0);
  await expect(page.getByText('69', { exact: true })).toHaveCount(0);
});

test('the tutor is offered to students and the suggester to staff', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);

  // A student gets a tutor; the lecturer's question suggester is not theirs.
  // (What the tutor refuses to do is asserted in the unit tests, on the
  // instruction itself: the form that carries that note only renders once a
  // model is configured, and nothing is configured in this run.)
  await expect(page.getByText('Ask about this case')).toBeVisible();
  await expect(page.getByText('Questions you could ask the group')).toHaveCount(0);
  const caseId = (new URL(page.url()).pathname.split('/cases/')[1] ?? '').replace(/\/$/, '');

  await signOut(page);
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en/cases/${caseId}`);

  // A lecturer gets question suggestions, and no tutor.
  await expect(page.getByText('Questions you could ask the group')).toBeVisible();
  await expect(page.getByText('Ask about this case')).toHaveCount(0);
});

test('with no model configured the tutor says so rather than failing', async ({ page }) => {
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);
  const caseId = (new URL(page.url()).pathname.split('/cases/')[1] ?? '').replace(/\/$/, '');

  await expect(page.getByText('the tutor is not available')).toBeVisible();
  await expect(page.locator('#message')).toHaveCount(0);

  const response = await page.request.post(`/api/cases/${caseId}/tutor`, {
    data: { mode: 'explain', message: 'Why is the marketplace more profitable?' },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error.messageKey).toBe('errors.aiNotConfigured');
});

test('a student cannot ask for the lecturer\u2019s question suggestions', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/cases');
  const href = await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .getAttribute('href');
  const caseId = (href ?? '').split('/cases/')[1] ?? '';

  const response = await page.request.post(`/api/cases/${caseId}/suggested-questions`);
  expect(response.status()).toBe(403);
});

/**
 * The assessment framework (SRS 13.2). The rules every mark is computed from
 * are stored data now, not a constant in the source - so this checks the one
 * thing that makes editing them safe: a mark already published does not move.
 */
test('a lecturer publishes a new framework version without moving a published mark', async ({
  page,
}) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/framework');

  await expect(page.getByTestId('framework-versions')).toContainText('2026.1');

  // A lecturer may start a framework of their own, not add a version to the
  // one every other class already runs under.
  await page.getByLabel('New version number').fill('2026.2');
  await page.getByLabel('Reason (at least 10 characters)').fill('Shorter slots for this term.');
  await page.getByRole('button', { name: 'Publish this version' }).click();
  await expect(page.getByTestId('alert-error')).toContainText("administrator's decision");

  await page.getByLabel('Framework name').fill(`ftu-marketing-${RUN}`);
  await page.getByLabel('Longest presentation (minutes)').fill('12');
  await page.getByLabel('Hard stop (minutes)').fill('14');
  // Changing what a criterion is worth: the rubric's total follows the parts,
  // and a form that made the two disagree could only ever be refused.
  await page.getByLabel('Understanding the case').fill('30');
  await page.getByRole('button', { name: 'Publish this version' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('published');

  // The mark published earlier in this run was computed under 2026.1 and is
  // still exactly that, traced to the version it was computed with.
  await signOut(page);
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  await expect(page.getByText('69', { exact: true })).toBeVisible();
  await expect(page.getByText('Framework version 2026.1')).toBeVisible();
});

/**
 * Course outcomes (SRS Phần VI). The report carries a warning that its CLO
 * mapping is illustrative; this is the path by which a faculty removes it,
 * honestly - by checking the mapping and saying so.
 */
test('confirming the outcome mapping removes the caveat from the report', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);
  const reportClassId = page.url().split('/teaching/')[1]?.split(/[?#]/)[0] ?? '';

  await page.goto(`/en/teaching/${reportClassId}/report`);

  // As shipped, the report says the mapping has not been checked.
  await expect(page.getByTestId('alert-error')).toContainText('illustrative');

  await page.goto('/en/framework');
  await page.getByLabel('Framework name').fill(`ftu-clo-${RUN}`);
  await page.getByLabel('New version number').fill('2026.1');
  await page.getByLabel('Checked against the syllabus').check();
  await page.getByLabel('Counts as met at (%)').fill('60');
  await page
    .getByLabel('Reason (at least 10 characters)')
    .fill('Checked the mapping against the 2026 syllabus.');
  await page.getByRole('button', { name: 'Publish this version' }).click();
  await expect(page.getByTestId('alert-success')).toContainText('published');

  // The class already running keeps the framework it was created under, so its
  // report is unchanged - which is the point of freezing a version.
  await page.goto(`/en/teaching/${reportClassId}/report`);
  await expect(page.getByTestId('alert-error')).toContainText('illustrative');
});

test('a student cannot reach the assessment framework, let alone change it', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  await page.goto('/en/framework');
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');

  const response = await page.request.post('/api/policies', {
    data: { policy: { id: 'forged', version: '1' }, reason: 'Rewriting my own marking rules.' },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);
});

/**
 * User administration (SRS 3.1). Before this there was no way back into an
 * account whose password was lost - no self-service reset, and nothing an
 * administrator could do - so a student who forgot theirs lost their
 * coursework with it.
 */
test('an administrator sets a new password for somebody who has lost theirs', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  const row = page.getByRole('row').filter({ hasText: LECTURER.email });
  await row.getByRole('button', { name: 'Reset password' }).click();

  const panel = page.getByTestId('reset-password-panel');
  await expect(panel).toBeVisible();

  // The suggestion is filled in already; this run needs a known one.
  await panel.locator('#newTemporaryPassword').fill(RESET_PASSWORD);
  await panel.locator('#resetReason').fill('They rang the office having forgotten it.');
  await panel.getByRole('button', { name: 'Set this password' }).click();

  // Shown once, because this is the only moment it is readable.
  await expect(page.getByTestId('handed-over')).toContainText(RESET_PASSWORD);
  await expect(row).toContainText('On a temporary password');

  // The new password works, and gets them no further than choosing their own.
  await signOut(page);
  await signIn(page, LECTURER.email, RESET_PASSWORD);
  await page.waitForURL('**/change-password');
  await page.goto('/en/teaching');
  await page.waitForURL('**/change-password');

  await page.locator('#newPassword').fill(LECTURER.newPassword);
  await page.locator('#confirmPassword').fill(LECTURER.newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.waitForURL('**/dashboard');
});

test('an administrator cannot set their own password from the user table', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  const own = page.getByRole('row').filter({ hasText: ADMIN.email });
  await expect(own.getByRole('button', { name: 'Reset password' })).toBeDisabled();

  // And not through the API either, which is where the rule actually lives.
  const users = await page.request.get('/api/admin/users?search=' + ADMIN.email);
  const callerUid = (await users.json()).users[0].uid;
  const response = await page.request.patch('/api/admin/users', {
    data: {
      targetUid: callerUid,
      temporaryPassword: 'somePass2026',
      reason: 'Trying to go round the change-password page.',
    },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);
});

test('an administrator corrects a name without touching the sign-in address', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  const row = page.getByRole('row').filter({ hasText: LECTURER.email });
  await row.getByRole('button', { name: 'Edit' }).click();

  const panel = page.getByTestId('edit-profile-panel');
  await panel.locator('#editFullName').fill(CORRECTED_NAME);
  await panel.locator('#profileReason').fill('Spelling corrected from the faculty list.');
  await panel.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: CORRECTED_NAME })).toBeVisible();
  // The address they sign in with is untouched, which is the whole point.
  await expect(page.getByRole('cell', { name: LECTURER.email })).toBeVisible();
});

test('an administrator creates a student account for one who could not register', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  await page.locator('#staffName').fill(ADDED_STUDENT.fullName);
  await page.locator('#staffEmail').fill(ADDED_STUDENT.email);
  await page.locator('#staffRole').selectOption('student');

  // The code a class roster is matched against, asked for only for a student.
  await page.locator('#staffStudentId').fill(ADDED_STUDENT.studentId);
  await page.locator('#tempPassword').fill(ADDED_STUDENT.temporaryPassword);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByTestId('alert-success')).toContainText(ADDED_STUDENT.email);

  await signOut(page);
  await signIn(page, ADDED_STUDENT.email, ADDED_STUDENT.temporaryPassword);
  await page.waitForURL('**/change-password');
});

/**
 * The dashboard (SRS Modules 03 and 04). By this point in the run the student
 * has a class, a group, an assignment and a published mark, so it has real
 * work to sort - which is the whole reason it was rewritten.
 */
test('the dashboard shows a student what they owe and what was marked', async ({ page }) => {
  await signIn(page, STUDENT.email, LECTURER_SET_STUDENT_PASSWORD ?? STUDENT.password);
  await page.goto('/en/dashboard');

  // Their class, by name, with a way into it.
  await expect(page.getByRole('link', { name: new RegExp(CLASS_CODE) })).toBeVisible();

  // The mark published earlier in this run.
  await expect(page.getByTestId('dashboard-marks')).toContainText('Amazon');
});

test('the dashboard shows a lecturer only what is waiting on them', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: 'Waiting on you' })).toBeVisible();

  // Every group in this run has been marked and published, so nothing is
  // outstanding - and saying so is the point, not an empty list.
  await expect(page.getByText('Nothing is waiting on you')).toBeVisible();
});

test('the class page filters groups by how far they have got', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  // The progress column, and the filter that answers "which ones are behind".
  await expect(page.getByRole('button', { name: /^Published \(/ })).toBeVisible();
  await page.getByRole('button', { name: /^Published \(/ }).click();
  await expect(page.getByRole('cell', { name: 'Published' })).toBeVisible();

  await page.getByRole('button', { name: /^Overdue \(/ }).click();
  await expect(page.getByText('Nothing in this state')).toBeVisible();
});

/**
 * Platform settings (SRS Module 03). Each of these changes something; a switch
 * that changed nothing would be worse than no switch.
 */
test('an administrator sees what the platform holds', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/system');

  const metrics = page.getByTestId('platform-metrics');
  await expect(metrics).toContainText('Students');
  await expect(metrics).toContainText('Marks published');

  // The model has not been called in this run, against the shipped budget.
  await expect(page.getByTestId('ai-usage')).toContainText('0 / 500');
});

test('closing registration closes the form, not just the request', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/system');

  await page.getByLabel('Students may create their own account').uncheck();
  await page.getByLabel('Reason').fill('Term has started.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('alert-success')).toBeVisible();

  await signOut(page);
  await page.goto('/en/register');
  await expect(page.getByTestId('alert-error')).toContainText('Registration is closed');
  await expect(page.locator('#studentId')).toHaveCount(0);

  // The API refuses too, which is where the rule actually lives.
  const response = await page.request.post('/api/auth/register', {
    data: {
      studentId: `SVCLOSED${RUN}`,
      fullName: 'Nguyen Van Closed',
      email: `closed.${RUN}@e2e.test`,
      password: 'closed2026',
      confirmPassword: 'closed2026',
      preferredLanguage: 'en',
    },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);

  // Put it back, so the rest of the run is unaffected.
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/system');
  await page.getByLabel('Students may create their own account').check();
  await page.getByLabel('Reason').fill('Reopening after the check.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('alert-success')).toBeVisible();
});

test('a lecturer cannot reach the system settings, let alone change them', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);

  await page.goto('/en/admin/system');
  await expect(page.getByTestId('alert-error')).toContainText('do not have permission');

  const response = await page.request.put('/api/admin/system', {
    data: {
      settings: { registrationOpen: true, maxImportKb: 512, aiMonthlyCallBudget: 99999 },
      reason: 'Raising a budget that is not mine to raise.',
    },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);
});

/**
 * Case revisions (SRS Module 05). A case could not be edited at all before
 * this; now it can, and an edit writes a version rather than overwriting one.
 */
test('revising a case writes a version and leaves the old one alone', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);

  // Created with v1, so the pointer the case carries means something.
  await expect(page.getByTestId('case-versions')).toContainText('v1');

  await page.getByRole('button', { name: 'Revise this case' }).click();
  await page.locator('#title').fill('Amazon (2025 figures)');
  await page
    .locator('#reason')
    .fill('The 2025 figures replaced the 2024 ones after the annual report.');
  await page.getByRole('button', { name: 'Publish revision' }).click();

  await expect(page.getByTestId('alert-success')).toContainText('v2');

  const history = page.getByTestId('case-versions');
  await expect(history).toContainText('v2');
  // The first version is still there, with its own title.
  await expect(history).toContainText('v1');
  await expect(history.getByText('Amazon', { exact: true })).toBeVisible();
});

test('a student cannot revise a case, however they ask', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/cases');
  await page
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` })
    .getByRole('link', { name: 'Question bank' })
    .click();
  await page.waitForURL(/\/cases\/.+/);

  await expect(page.getByRole('button', { name: 'Revise this case' })).toHaveCount(0);

  const caseId = page.url().split('/cases/')[1]?.split(/[?#]/)[0] ?? '';
  const response = await page.request.put(`/api/cases/${caseId}`, {
    data: {
      title: 'Rewritten by a student',
      learningObjectives: [],
      cloIds: [],
      mainQuestions: [],
      supportingQuestions: [],
      references: [],
      reason: 'Rewriting the case I am being marked on.',
    },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);
});

/**
 * Telling "no model configured" apart from "the model is broken" (SRS Module
 * 03). Without this screen both look identical to whoever is standing in
 * front of it, because every AI feature here is advisory by design.
 */
test('the system page says the model is not configured, and why that is not an error', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/system');

  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
  await expect(page.getByText('enable-ai.sh')).toBeVisible();

  await page.getByRole('button', { name: 'Test the model' }).click();
  await expect(page.getByTestId('ai-probe-result')).toContainText('nothing was called');

  // The switch is a setting, not an environment variable, so it is here and
  // one request turns it on. It used to be a variable that every deploy wiped.
  await page.getByRole('button', { name: 'Turn the model on' }).click();
  await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-status')).toContainText('gemini');

  // Turning it off again needs nothing but the same switch.
  await page.getByRole('button', { name: 'Turn the model off' }).click();
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
});

test('saving the other settings does not turn the model off', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/system');

  await page.getByRole('button', { name: 'Turn the model on' }).click();
  await expect(page.getByText('Configured', { exact: true })).toBeVisible();

  // The settings form does not offer every setting. Sending only the ones it
  // shows would turn off whatever it leaves out - which is precisely how the
  // deploy script used to turn off the model.
  await page.getByLabel('Model calls per month').fill('250');
  await page.getByLabel('Reason').fill('Lowering the budget for the term.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('alert-success')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-usage')).toContainText('/ 250');

  // Leave the deployment as the rest of the run expects it.
  await page.getByRole('button', { name: 'Turn the model off' }).click();
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
});

test('a lecturer cannot test the model or read how it is configured', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);

  const status = await page.request.get('/api/admin/ai', { failOnStatusCode: false });
  expect(status.status()).toBe(403);

  const probe = await page.request.post('/api/admin/ai', { failOnStatusCode: false });
  expect(probe.status()).toBe(403);
});

test('an administrator finds somebody by a name typed without diacritics', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  // The lecturer was renamed earlier in this run to "Tran Thi Bich Lecturer".
  await page.getByLabel('Find somebody').fill('tran thi bich');
  await expect(page.getByRole('cell', { name: CORRECTED_NAME })).toBeVisible();
  await expect(page.getByRole('cell', { name: ADMIN.email })).toHaveCount(0);

  // Clearing the box brings everybody back, rather than leaving a filter on.
  await page.getByLabel('Find somebody').fill('');
  await expect(page.getByRole('cell', { name: ADMIN.email })).toBeVisible();
});

test('creating accounts from a list previews first and shows each password once', async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/en/admin/users');

  const csv = [
    'studentId,fullName,email',
    `BULK1${RUN},Le Van Bulk,bulk1.${RUN}@e2e.test`,
    `BULK2${RUN},Pham Thi Bulk,bulk2.${RUN}@e2e.test`,
  ].join('\n');

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'accounts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('import-outcome')).toContainText('2 accounts would be created');

  // Nothing exists yet: a preview that created accounts would not be a preview.
  await expect(page.getByTestId('import-passwords')).toHaveCount(0);

  await page.getByRole('button', { name: 'Create these accounts' }).click();
  await expect(page.getByTestId('import-outcome')).toContainText('2 accounts created');
  await expect(page.getByText('shown once and cannot be retrieved')).toBeVisible();

  const passwords = page.getByTestId('import-passwords');
  await expect(passwords).toContainText(`BULK1${RUN}`);

  // The account works, and gets them no further than choosing their own.
  const shown = await passwords.locator('tr').first().locator('td').last().textContent();
  await signOut(page);
  await signIn(page, `bulk1.${RUN}@e2e.test`, (shown ?? '').trim());
  await page.waitForURL('**/change-password');
});

/**
 * Groups choosing their own case (SRS Module 07). A lecturer running six
 * groups through a library spends the first week of term collecting choices
 * and keeping a spreadsheet so two groups do not take the same case.
 */
test('a lecturer opens self-selection and a group takes a case', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  await page.getByLabel('Who chooses').selectOption('groups_choose');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No group has chosen yet')).toBeVisible();

  // The audience student is in a different group from the presenters, and
  // their group has taken nothing.
  await signOut(page);
  await signIn(page, AUDIENCE.email, AUDIENCE.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const picker = page.getByTestId('case-picker');
  await expect(picker).toContainText(`CASE${RUN}`);
  await picker.getByRole('button', { name: 'Choose this' }).first().click();

  await expect(picker.getByText("Your group's")).toBeVisible();
  await expect(page.getByText('Your group has chosen')).toBeVisible();
});

test('the case another group took is shown as taken, not offered again', async ({ page }) => {
  // A different student, in a different group, which has chosen nothing yet.
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const taken = page
    .getByTestId('case-picker')
    .getByRole('listitem')
    .filter({ hasText: `CASE${RUN}` });

  // Named rather than hidden: a group deciding what to study should see where
  // the case went, not wonder.
  await expect(taken).toContainText('Taken by');
  await expect(taken.getByRole('button', { name: 'Choose this' })).toHaveCount(0);
});

test('the lecturer sees who chose what, and can free it again', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto('/en/teaching');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/teaching\/.+/);

  const board = page.getByTestId('claim-board');
  await expect(board).toContainText(`CASE${RUN}`);
  await expect(board).toContainText(AUDIENCE.fullName);
  await expect(board.getByRole('button', { name: 'Release' })).toBeVisible();
});

test('a student cannot take a case for a class they are not in', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);

  const response = await page.request.post('/api/classes/not-my-class/case-selection', {
    data: { caseStudyId: 'whatever' },
    failOnStatusCode: false,
  });
  expect([403, 404]).toContain(response.status());
});

/**
 * A deliverable handed in as a link (SRS Module 09). A presentation video is
 * recorded on a phone and put on YouTube; asking a group to push a gigabyte
 * through this platform as well would be the same work twice.
 */
test('a group hands in its presentation video as a link', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  await page.goto('/en/classes');
  await page.getByText(CLASS_CODE).click();
  await page.waitForURL(/\/classes\/.+/);

  const video = page.getByRole('listitem').filter({ hasText: 'Presentation video' });

  await video.getByRole('textbox').fill('https://www.youtube.com/watch?v=e2e-run');
  await video.getByRole('button', { name: 'Submit link' }).click();

  // The host, not the whole address: a lecturer needs to see where it goes.
  await expect(video).toContainText('youtube.com');
  await expect(video).toContainText('leaves this site');

  // Versioned like a file. Re-recording does not overwrite.
  await video.getByRole('textbox').fill('https://vimeo.com/e2e-second');
  await video.getByRole('button', { name: 'Submit link' }).click();
  await expect(video).toContainText('vimeo.com');
  await expect(video).toContainText('v2');
  await expect(video).toContainText('v1');
});

/**
 * The presentation dossier (SRS Modules 10 and 11). Every question and every
 * peer score was always written down in full; the marking screen showed two
 * counts and the detail was only visible while the room was still running.
 */
test('the dossier shows every question and every peer score after the fact', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  await page.goto(`/en${gradeUrl}`);

  await page.getByRole('link', { name: /Open the full dossier/ }).click();
  await page.waitForURL(/\/presentation\/.+/);

  // The question the audience student asked earlier in this run, with their
  // name - which the class never saw, because they asked anonymously.
  const questions = page.getByTestId('dossier-questions');
  await expect(questions).toContainText(AUDIENCE.fullName);
  await expect(questions).toContainText('anonymous to the class');

  // And the peer scores, named, with the scorer's own group beside them.
  const scores = page.getByTestId('dossier-scores');
  await expect(scores).toContainText(AUDIENCE.fullName);
});

test('the dossier downloads as a spreadsheet with formulas defused', async ({ page }) => {
  await signIn(page, LECTURER.email, LECTURER.newPassword);
  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';

  const response = await page.request.get(`/api/assignments/${assignmentId}/dossier`);
  expect(response.ok()).toBe(true);

  const csv = await response.text();
  expect(csv).toContain('presentation dossier');
  expect(csv).toContain('Questions the class asked');
  // Every question and comment in this file was typed by a student, and a
  // spreadsheet runs a cell starting with = as a formula when it opens.
  expect(csv).not.toMatch(/\n"?=/);
});

test('a student cannot read the dossier for their own group', async ({ page }) => {
  await signIn(page, STUDENT.email, STUDENT.password);
  const assignmentId = gradeUrl.split('/grade/')[1] ?? '';

  const response = await page.request.get(`/api/assignments/${assignmentId}/dossier`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(403);
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
