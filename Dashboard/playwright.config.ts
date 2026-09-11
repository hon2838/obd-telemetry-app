import { defineConfig, devices } from '@playwright/test';

// Browser suite for the OBD dashboard (Next.js on :3001 proxying /api to the
// backend on :3000). Credentials are NEVER hardcoded here: provision a
// disposable backend account and export E2E_USERNAME / E2E_PASSWORD (and
// E2E_NEW_PASSWORD for the forced-reset test) before running. Tests skip
// with a clear message when the backend or credentials are unavailable.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    baseURL: 'http://127.0.0.1:3001',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
