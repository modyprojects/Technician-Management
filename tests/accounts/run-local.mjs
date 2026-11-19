// Runs the account-administration service tests against the LOCAL Supabase stack (D60 (7); Step 2
// plan §5.2):
//   node tests/accounts/run-local.mjs [--with-creator] [playwright args…]
// It reads the local stack's API URL, keys and Mailpit URL from `supabase status -o json`
// (SUPABASE_BIN, default "supabase") and passes them to the Playwright process only; nothing is
// printed. Refuses a non-loopback URL. No build and no browser: the tests run the server-side flows
// (features/accounts/supabase) with real local clients, playing the server's part, so the test
// process holds the local secret key (the local stack's own development key, never a remote one).
// --with-creator (TEMPORARY, Step 2 plan Q6, open): also bootstraps a fictional, real-marked
// Creator in the local database (the database refuses a test-marked Creator) and runs the
// Creator's cases; without it they are skipped.
import { execFileSync, spawnSync } from "node:child_process";

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;
const args = process.argv.slice(2);
const withCreator = args.includes("--with-creator");
const playwrightArgs = args.filter((a) => a !== "--with-creator");

let status;
try {
  const raw = execFileSync(process.env.SUPABASE_BIN || "supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  status = JSON.parse(raw.slice(raw.indexOf("{")));
} catch {
  console.error("account tests: the local Supabase stack is not running (supabase start)");
  process.exit(2);
}
const url = status.API_URL;
const mailpit = status.MAILPIT_URL ?? status.INBUCKET_URL ?? "";
if (!LOOPBACK.test(url ?? "") || !status.PUBLISHABLE_KEY || !status.SECRET_KEY || (mailpit && !LOOPBACK.test(mailpit))) {
  console.error("account tests: missing local values, or a URL is not a loopback address");
  process.exit(2);
}

const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.accounts.config.ts", ...playwrightArgs], {
  env: {
    ...process.env,
    ACCOUNTS_TEST_SUPABASE_URL: url,
    ACCOUNTS_TEST_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    ACCOUNTS_TEST_SECRET_KEY: status.SECRET_KEY,
    ACCOUNTS_TEST_MAILPIT_URL: mailpit,
    ACCOUNTS_TEST_LOCAL_CREATOR: withCreator ? "1" : "",
  },
  stdio: "inherit",
});
process.exit(run.status ?? 1);
