// Runs the auth tests against the LOCAL Supabase stack (Step 2 PR 2.5):
//   node tests/auth/run-local.mjs [--no-build] [playwright args…]
// It reads the local stack's API URL and keys from `supabase status -o json` (SUPABASE_BIN, default
// "supabase"), builds the app with only the two public values (NEXT_PUBLIC_* are inlined at build
// time), and gives the secret key only to the Playwright process for the global setup, which removes
// it from the environment before any test worker or the app server sees it. Nothing is printed.
// Refuses a non-loopback URL. The default build (`npm run build`, no values) must be rebuilt after.
import { execFileSync, spawnSync } from "node:child_process";

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;
const args = process.argv.slice(2);
const noBuild = args[0] === "--no-build";
const playwrightArgs = noBuild ? args.slice(1) : args;

let status;
try {
  const raw = execFileSync(process.env.SUPABASE_BIN || "supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  status = JSON.parse(raw.slice(raw.indexOf("{")));
} catch {
  console.error("auth tests: the local Supabase stack is not running (supabase start)");
  process.exit(2);
}
const url = status.API_URL;
const publishableKey = status.PUBLISHABLE_KEY;
const secretKey = status.SECRET_KEY;
if (!LOOPBACK.test(url ?? "") || !publishableKey || !secretKey) {
  console.error("auth tests: missing local values, or the API URL is not a loopback address");
  process.exit(2);
}

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  NEXT_TELEMETRY_DISABLED: "1",
};
if (!noBuild) {
  const build = spawnSync("npx", ["next", "build"], { env, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) {
    console.error("auth tests: the build failed");
    process.exit(build.status ?? 1);
  }
}
const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.auth.config.ts", ...playwrightArgs], {
  env: { ...env, AUTH_TEST_SUPABASE_SECRET_KEY: secretKey },
  stdio: "inherit",
});
process.exit(run.status ?? 1);
