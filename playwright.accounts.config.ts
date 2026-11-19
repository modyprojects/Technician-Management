import { defineConfig } from "@playwright/test";

// Account-administration service tests against the LOCAL Supabase stack (D60 (7); Step 2 plan
// §5.2). Never part of the default suite (testDir tests/e2e). Run through
// tests/accounts/run-local.mjs, which reads the local stack's values from `supabase status` without
// printing them. No browser and no app server: the tests run the server-side flows
// (features/accounts/supabase) with real local clients. Serial, one worker: the cases share seeded
// accounts and the local Auth rate limits (supabase/config.toml).
export default defineConfig({
  testDir: "tests/accounts",
  globalSetup: "./tests/accounts/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "service" }],
});
