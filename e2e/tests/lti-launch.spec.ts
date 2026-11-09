import { expect, test } from '@playwright/test';

/**
 * The page UniGame Hub opens when someone comes from Moodle, on the
 * production build. The full sign-in needs a ticket signed by the Hub, which
 * the emulator tests stand in for; what a browser must get right here is that
 * a missing or refused ticket ends in a sentence a person can act on, never a
 * blank page or a spinner that turns forever.
 */

test('opening from Moodle without a ticket says what to do', async ({ page }) => {
  await page.goto('/en/lti-launch');
  await expect(page.getByRole('heading', { name: 'Opening from Moodle' })).toBeVisible();
  await expect(page.getByText('The Moodle launch has expired or is not valid.')).toBeVisible();
  await expect(page.getByText('Go back to Moodle and open the activity again.')).toBeVisible();
});

test('a ticket is taken off the address bar and refused while the connection is off', async ({
  page,
}) => {
  await page.goto(`/en/lti-launch#ticket=${'x'.repeat(40)}`);
  await expect(page.getByText('The Moodle connection is not switched on.')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('the lecturer link page without a pending course does not leak anything', async ({ page }) => {
  // Signed out: the app layout sends the visitor to sign in first.
  await page.goto('/en/lti/link?key=0000000000000000000000000000000000000000');
  await expect(page).toHaveURL(/\/en\/login$/);
});
