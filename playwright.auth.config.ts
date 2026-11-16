import { defineConfig } from "@playwright/test";

// Auth tests against the LOCAL Supabase stack (Step 2 plan §5.2, §5.3; Step 2 PR 2.5). Never part of
// the default suite (testDir tests/e2e). Run through tests/auth/run-local.mjs, which reads the local
// stack's values from `supabase status`, builds the app with the two public values and passes the
// secret key only to this process (global setup); nothing is printed. Traces and artifacts are off:
// they would hold session cookies (docs/security.md §10).
const PORT = 3120;

export default defineConfig({
  testDir: "tests/auth",
  globalSetup: "./tests/auth/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "he-IL", trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    // The app server never gets the secret key (it has no use for it in this PR).
    env: { NEXT_TELEMETRY_DISABLED: "1", AUTH_TEST_SUPABASE_SECRET_KEY: "" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
