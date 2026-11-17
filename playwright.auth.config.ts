import { defineConfig } from "@playwright/test";
import { AUTH_TEST_PORT, originOf, SIMULATOR_OFF_PORT, SIMULATOR_PRODUCTION_PORT } from "./tests/auth/servers";

// Auth tests against the LOCAL Supabase stack (Step 2 plan §5.2, §5.3; Step 2 PR 2.5). Never part of
// the default suite (testDir tests/e2e). Run through tests/auth/run-local.mjs, which reads the local
// stack's values from `supabase status`, builds the app with the two public values and passes the
// secret key only to this process (global setup) and to the app server's runtime environment below;
// nothing is printed. Traces and artifacts are off: they would hold session cookies (docs/security.md
// §10).
const PORT = AUTH_TEST_PORT;
const ORIGIN = originOf(PORT);

// The app server's output goes to run-local.mjs's private temporary file, which the password-reset
// tests read to prove that no address, password or token reaches a log line (docs/security.md §8).
const SERVER_LOG = process.env.AUTH_TEST_SERVER_LOG ?? "";
const START = `npx next start -H 127.0.0.1 -p ${PORT}`;

// The office screens' simulator checks (D24, SIM-11; D60 (11)): the main server has the Outlook
// invitation simulator switched on (CALENDAR_SIMULATOR=1, a test environment); two more servers of
// the same build show that it is absent when the switch is off, and on Vercel Production even with
// the switch on. Same local Supabase stack; nothing else differs.
const extraServer = (port: number, env: Record<string, string>) => ({
  command: `npx next start -H 127.0.0.1 -p ${port}`,
  url: `${originOf(port)}/login`,
  env: { NEXT_TELEMETRY_DISABLED: "1", SUPABASE_SECRET_KEY: "", AUTH_TEST_SUPABASE_SECRET_KEY: "", ...env },
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: "tests/auth",
  globalSetup: "./tests/auth/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { baseURL: ORIGIN, locale: "he-IL", trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: SERVER_LOG ? `${START} >> ${JSON.stringify(SERVER_LOG)} 2>&1` : START,
      url: `${ORIGIN}/login`,
      // D65 (password reset): the secret key as SUPABASE_SECRET_KEY in the server's runtime only (the
      // Auth Admin `generateLink`; read at call time, never inlined, never printed), the mock email
      // delivery into run-local.mjs's temporary file, and the links' origin. The test variable itself
      // is emptied.
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        SUPABASE_SECRET_KEY: process.env.AUTH_TEST_SUPABASE_SECRET_KEY ?? "",
        AUTH_TEST_SUPABASE_SECRET_KEY: "",
        EMAIL_DELIVERY: "mock",
        MAIL_MOCK_FILE: process.env.AUTH_TEST_MAIL_FILE ?? "",
        APP_ORIGIN: ORIGIN,
        // The office screens (D60 (11)): the simulator is on in this test environment.
        CALENDAR_SIMULATOR: "1",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    extraServer(SIMULATOR_OFF_PORT, { CALENDAR_SIMULATOR: "" }),
    extraServer(SIMULATOR_PRODUCTION_PORT, { CALENDAR_SIMULATOR: "1", VERCEL_ENV: "production" }),
  ],
});
