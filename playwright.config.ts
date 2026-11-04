import { defineConfig } from "@playwright/test";
import { CLOSED_URL, OPEN_URL } from "./tests/e2e/helpers";

export default defineConfig({
  testDir: "tests/e2e",
  // Screenshots are produced on demand (npm run screenshots), never in CI.
  testIgnore: process.env.SCREENSHOTS ? [] : ["**/screenshots.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // GitHub's runner for this private repository has 2 vCPUs, where Playwright's default (half the
  // cores) is a single worker; the suite (~1,400 tests at three widths) then needs about 15 minutes.
  // Two workers halve that. The global timeout only guards against a hung run, so it is sized well
  // above the expected duration rather than at it.
  workers: process.env.CI ? 2 : undefined,
  globalTimeout: process.env.CI ? 30 * 60_000 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: OPEN_URL,
    locale: "he-IL",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 820, height: 1180 } } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "npx next start -H 127.0.0.1 -p 3100",
      url: OPEN_URL,
      env: { ENABLE_DEV_ROUTES: "1", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx next start -H 127.0.0.1 -p 3101",
      url: CLOSED_URL,
      env: { ENABLE_DEV_ROUTES: "", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
