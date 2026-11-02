// Post-build check of what the browser receives (docs/deployment.md: "browser bundle secret scan").
// 1. Secret patterns in .next/static and in prerendered HTML/RSC output: always.
// 2. Fixture sentinel anywhere in .next: only after the go-live gate (config/release.json).
// Matches are reported by file and rule name only; secret values are never printed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const release = JSON.parse(readFileSync(join(root, "config/release.json"), "utf8"));
const FIXTURE_SENTINEL = "FIXTURE-SENTINEL-TM-STEP0";

const SECRET_RULES = [
  ["supabase-secret-key", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["server-only-env-name", /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|EMAIL_PROVIDER_API_KEY|TRANSCRIPTION_PROVIDER_API_KEY|VERCEL_AUTOMATION_BYPASS_SECRET|VERCEL_OIDC_TOKEN/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];

const TEXT_FILE = /\.(?:js|mjs|cjs|css|html|json|rsc|txt|map|body|meta|svg|webmanifest|xml)$/;

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (TEXT_FILE.test(name)) files.push(path);
  }
  return files;
}

const browserFiles = [
  ...walk(join(root, ".next/static")),
  ...walk(join(root, ".next/server/app")).filter((f) => /\.(?:html|rsc|body|meta)$/.test(f)),
  ...walk(join(root, ".next/server/pages")).filter((f) => f.endsWith(".html")),
  ...walk(join(root, "public")),
];
if (browserFiles.length === 0) {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(2);
}

const problems = [];
for (const file of browserFiles) {
  const text = readFileSync(file, "utf8");
  for (const [rule, pattern] of SECRET_RULES) {
    if (pattern.test(text)) problems.push(`${relative(root, file)}: matches rule "${rule}"`);
  }
}

if (release.testingPeriod === true) {
  console.log("Testing period (D31): fixture check is off; /dev may be served behind Vercel Authentication.");
} else {
  for (const file of walk(join(root, ".next"))) {
    if (readFileSync(file, "utf8").includes(FIXTURE_SENTINEL)) {
      problems.push(`${relative(root, file)}: contains fictitious showcase data (go-live gate)`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Bundle check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Bundle check passed: ${browserFiles.length} browser-delivered files scanned.`);
