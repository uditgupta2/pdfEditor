import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests in real browsers, against e2e/harness.html served by Vite.
 * WebKit needs system libraries on Linux: `sudo npx playwright install-deps webkit`.
 */
const PORT = 5179;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/e2e/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
