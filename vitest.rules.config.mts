import { defineConfig } from 'vitest/config';

/**
 * Security Rules tests. They need the Firebase Emulator, so they run through
 * `npm run test:rules` rather than with the unit tests.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firebase/tests/**/*.test.ts'],
    // Rules tests share one emulator and clear the database between cases.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
