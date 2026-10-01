import { defineConfig } from '@playwright/test';
const baseURL = process.env.LOCAL_RPG_BASE_URL || 'http://127.0.0.1:5174';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    ...(process.env.LOCAL_BROWSER_PATH
      ? { launchOptions: { executablePath: process.env.LOCAL_BROWSER_PATH } }
      : {}),
  },
  webServer: process.env.LOCAL_RPG_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
});
