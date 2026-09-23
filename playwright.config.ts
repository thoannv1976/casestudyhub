import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke test.
 *
 * It runs against the production build, not the dev server, on purpose: the
 * bug that took down staff account creation only appeared once Next.js split
 * the server code into chunks, which `next dev` never does. Unit tests and
 * rules tests both missed it.
 *
 * `npm run test:e2e` starts the Firebase Emulator around this.
 */
const PORT = Number(process.env.E2E_PORT ?? 3399);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  // The flow is one story: each step depends on what the previous one created.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI installs the browser Playwright expects. A sandbox that already
        // ships one points at it through this variable instead of downloading
        // a second copy.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: {
    // The standalone output is what the Cloud Run image runs.
    command: `node apps/web/.next/standalone/apps/web/server.js`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-casestudyhub',
      FIREBASE_STORAGE_BUCKET: 'demo-casestudyhub.appspot.com',
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
    },
  },
});
