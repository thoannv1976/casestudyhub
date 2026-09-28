import { expect, test, type Page } from '@playwright/test';

/**
 * The app at the size of a phone.
 *
 * Runs last (hence the name) so it walks pages the smoke test has already
 * filled with classes, groups, submissions and marks: an empty page fits any
 * screen, and would prove nothing.
 *
 * What it asserts is one thing, on every page: the document must not scroll
 * sideways. A page that does is how a phone reader loses the right-hand column
 * of a table, or swipes into blank space and thinks the app is broken. Tables
 * themselves are allowed to be wider than the screen - they sit in their own
 * scroller, and swiping the table is the intended way to read one.
 */

const PHONE = { width: 390, height: 844 };
/** The narrowest screen still common in a Vietnamese lecture hall. */
const SMALL_ANDROID = { width: 360, height: 740 };

const ADMIN = { email: 'admin@e2e.test', password: 'e2eAdmin2026' };
const STUDENT = { email: 'student2@e2e.test', password: 'student2026' };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/en/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|change-password)/);
}

/**
 * Nothing may spill sideways.
 *
 * Measured by swiping rather than by reading a width: `scrollWidth` alone once
 * said a page was fine while a screen-reader-only label, absolutely positioned
 * inside a table wider than the screen, had quietly made the page swipeable
 * into 470 empty pixels.
 */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    window.scrollTo(9999, window.scrollY);
    const swipedTo = window.scrollX;
    window.scrollTo(0, window.scrollY);
    return { swipedTo, overflow: root.scrollWidth - root.clientWidth };
  });

  expect(
    result.swipedTo,
    `${where} scrolls sideways: the reader can swipe ${result.swipedTo}px into it`,
  ).toBe(0);
  expect(
    result.overflow,
    `${where} is ${result.overflow}px wider than the screen`,
  ).toBeLessThanOrEqual(0);
}

/**
 * Two things a finger needs, checked together because they have the same cause:
 * a layout drawn for a mouse.
 *
 * A field under 16px makes Safari on iOS zoom the page in on focus and leave it
 * there, which is how a student ends up filling in a sign-in form at 150%. And
 * a target under 24x24 is below the floor WCAG 2.2 sets for a reason: a
 * fingertip is about 9mm across.
 */
async function expectThumbFriendly(page: Page, where: string) {
  const bad = await page.evaluate(() => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute('class') ?? '').slice(0, 40)}] "${(el.textContent ?? '').trim().slice(0, 25)}"`;

    const zoomers: string[] = [];
    const tiny: string[] = [];

    for (const el of Array.from(document.querySelectorAll('input, select, textarea, button'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el as HTMLInputElement).type : '';
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;

      // A file picker has no caret to zoom towards, and a checkbox has no text.
      const typed = tag !== 'button' && !['file', 'checkbox', 'radio', 'hidden'].includes(type);
      if (typed && Number.parseFloat(style.fontSize) < 16) {
        zoomers.push(`${style.fontSize}: ${describe(el)}`);
      }

      const isTarget = tag === 'button' || type === 'checkbox' || type === 'radio';
      if (isTarget && (box.width < 24 || box.height < 24)) {
        tiny.push(`${Math.round(box.width)}x${Math.round(box.height)}: ${describe(el)}`);
      }
    }

    return { zoomers, tiny };
  });

  expect(
    bad.zoomers,
    `${where} has fields iOS would zoom into: ${bad.zoomers.join(' · ')}`,
  ).toEqual([]);
  expect(bad.tiny, `${where} has targets under 24x24: ${bad.tiny.join(' · ')}`).toEqual([]);
}

test('every page a student opens fits their phone', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await signIn(page, STUDENT.email, STUDENT.password);

  await expectNoSidewaysScroll(page, 'the dashboard');

  await page.goto('/en/classes');
  await page.getByRole('link').filter({ hasText: /E2E-/ }).first().click();
  await page.waitForURL(/\/classes\/.+/);
  await expectNoSidewaysScroll(page, 'the class page');
  await expectThumbFriendly(page, 'the class page');

  for (const [path, name] of [
    ['/en/portfolio', 'the portfolio'],
    ['/en/cases', 'the case library'],
    ['/en/notifications', 'the notifications'],
    ['/en/profile', 'the profile'],
  ] as const) {
    await page.goto(path);
    await expectNoSidewaysScroll(page, name);
  }

  await expectThumbFriendly(page, 'the profile form');
});

test('every page a lecturer opens fits their phone', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await signIn(page, ADMIN.email, ADMIN.password);

  await page.goto('/en/teaching');
  await expectNoSidewaysScroll(page, 'the teaching list');

  await page.getByRole('link').filter({ hasText: /E2E-/ }).first().click();
  await page.waitForURL(/\/teaching\/.+/);
  const classId = page.url().split('/teaching/')[1]?.split('/')[0] ?? '';
  // Four wide tables on one page: the roster, the assignments, the project and
  // the groups. This is where the sideways scroll was found.
  await expectNoSidewaysScroll(page, 'the class page');
  await expectThumbFriendly(page, 'the class page');

  for (const [path, name] of [
    [`/en/teaching/${classId}/overview`, 'the class overview'],
    [`/en/teaching/${classId}/report`, 'the class report'],
    ['/en/framework', 'the assessment framework'],
    ['/en/admin/users', 'the user table'],
    ['/en/admin/system', 'the system settings'],
    ['/en/admin/academic', 'the academic structure'],
  ] as const) {
    await page.goto(path);
    await expectNoSidewaysScroll(page, name);
    if (path.endsWith('/framework') || path.endsWith('/system')) {
      // Both carry checkboxes, which were 16px square until they were measured.
      await expectThumbFriendly(page, name);
    }
  }
});

test('the room and the question board fit the phone they are read on', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(PHONE);
  await signIn(page, ADMIN.email, ADMIN.password);

  // The project room opened earlier in this run is still live, and the
  // dashboard is where anyone in the class finds it.
  const live = page.getByTestId('dashboard-live').getByRole('link').first();
  await expect(live).toBeVisible();
  await live.click();
  await page.waitForURL(/\/sessions\/.+/);
  await expectNoSidewaysScroll(page, 'the presentation room');
  await expectThumbFriendly(page, 'the presentation room');

  await page.goto('/en/teaching');
  await page.getByRole('link').filter({ hasText: /E2E-/ }).first().click();
  await page.waitForURL(/\/teaching\/.+/);
  await page.getByRole('link', { name: 'Questions' }).first().click();
  await page.waitForURL(/\/questions$/);
  await expectNoSidewaysScroll(page, 'the question board');
});

test('signing in works on the narrowest phone in the room', async ({ page }) => {
  await page.setViewportSize(SMALL_ANDROID);

  await page.goto('/en/login');
  await expectNoSidewaysScroll(page, 'the sign-in page at 360px');
  await expectThumbFriendly(page, 'the sign-in page');

  await page.goto('/en/register');
  await expectNoSidewaysScroll(page, 'the registration page at 360px');
  await expectThumbFriendly(page, 'the registration page');

  await page.goto('/en');
  await expectNoSidewaysScroll(page, 'the front page at 360px');
});
