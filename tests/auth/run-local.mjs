// Runs the auth tests against the LOCAL Supabase stack (Step 2 PR 2.5; D65 password reset):
//   node tests/auth/run-local.mjs [--no-build] [playwright args…]
// It reads the local stack's API URL and keys from `supabase status -o json` (SUPABASE_BIN, default
// "supabase"), builds the app with only the two public values (NEXT_PUBLIC_* are inlined at build
// time), and gives the secret key only to the Playwright process: its global setup removes it from
// the environment before any test worker starts, and playwright.auth.config.ts hands it to the app
// server's RUNTIME environment as SUPABASE_SECRET_KEY (the password reset's Auth Admin call), never
// to the build and never as NEXT_PUBLIC_. The app server also gets the mock email delivery writing to
// a private temporary file (AUTH_TEST_MAIL_FILE) and its output in a second one (AUTH_TEST_SERVER_LOG,
// checked for leaked values); both are deleted afterwards. Nothing is printed.
// Refuses a non-loopback URL. The default build (`npm run build`, no values) must be rebuilt after.
// Another local stack (an isolated copy with its own project_id and ports): point SUPABASE_BIN at a
// wrapper that runs the CLI with `--workdir <copy>`, and set AUTH_TEST_DB_CONTAINER to that stack's
// database container (supabase_db_<project_id>) so the seeding writes into the same stack.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  // Never in the build.
  SUPABASE_SECRET_KEY: "",
};
if (!noBuild) {
  const build = spawnSync("npx", ["next", "build"], { env, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) {
    console.error("auth tests: the build failed");
    process.exit(build.status ?? 1);
  }
}
// Private temporary files (mode 0600 in a 0700 folder): the mock deliveries hold reset links.
const dir = mkdtempSync(join(tmpdir(), "tm-auth-"));
const mailFile = join(dir, "mail.jsonl");
const serverLog = join(dir, "server.log");
writeFileSync(mailFile, "", { mode: 0o600 });
writeFileSync(serverLog, "", { mode: 0o600 });
let exitCode = 1;
try {
  const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.auth.config.ts", ...playwrightArgs], {
    env: { ...env, AUTH_TEST_SUPABASE_SECRET_KEY: secretKey, AUTH_TEST_MAIL_FILE: mailFile, AUTH_TEST_SERVER_LOG: serverLog },
    stdio: "inherit",
  });
  exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
