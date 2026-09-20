import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: process.env.KONVERSON_PRODUCTION ? '**/production.spec.ts' : '**/game.spec.ts',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.KONVERSON_TEST_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: {width:1440,height:1000} } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: {width:1440,height:1000}, launchOptions: { executablePath: process.env.KONVERSON_FIREFOX_EXECUTABLE } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: {width:1440,height:1000} } },
  ],
  webServer: process.env.KONVERSON_TEST_URL ? undefined : {
    command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI,
  },
});
