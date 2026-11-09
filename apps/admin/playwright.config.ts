import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4502);

/**
 * The admin's browser suite (D382 step 4): builds the app with the fixture config, serves it under
 * /admin with a static server and drives it in Chromium at a phone and a desktop size, as the
 * reader's suite does. Untagged tests run on the phone; `@desktop` runs on the desktop only and
 * `@both` on both. Run `pnpm exec playwright install chromium` once.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      grepInvert: /@desktop/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop",
      grep: /@desktop|@both/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "node e2e/run.mjs",
    url: `http://127.0.0.1:${PORT}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { PORT: String(PORT) },
  },
});
