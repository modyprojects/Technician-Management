// Tests for scripts/vercel-ignore.sh (Vercel "Ignored Build Step").
// Exit 1 = build, exit 0 = skip. Each case runs the script inside a temporary git repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/vercel-ignore.sh");

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  write("app/page.tsx", "export default function Page() { return null; }\n");
  write("docs/WORKLOG.md", "# Work Log\n");
  write("README.md", "# Readme\n");
  write("vercel.json", "{}\n");
  const base = commit("base");
  return { dir, git, write, commit, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(dir, env) {
  const result = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return result.status;
}

const production = (previous, current) => ({
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_PREVIOUS_SHA: previous,
  VERCEL_GIT_COMMIT_SHA: current,
});

test("Preview deployments always build", () => {
  const repo = makeRepo();
  try {
    assert.equal(run(repo.dir, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature" }), 1);
  } finally {
    repo.cleanup();
  }
});

test("Production from a branch other than main is skipped", () => {
  const repo = makeRepo();
  try {
    assert.equal(run(repo.dir, { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature" }), 0);
  } finally {
    repo.cleanup();
  }
});

test("unknown environment is skipped", () => {
  const repo = makeRepo();
  try {
    assert.equal(run(repo.dir, {}), 0);
  } finally {
    repo.cleanup();
  }
});

test("main with documentation-only changes is skipped", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/WORKLOG.md", "# Work Log\n\n- entry\n");
    repo.write("README.md", "# Readme\n\nmore\n");
    repo.write("prompts/STEP-1.md", "nested markdown\n");
    repo.write(".github/pull_request_template.md", "template\n");
    repo.write("docs/review/step-1/shot.png", "binary-ish\n");
    const head = repo.commit("docs only");
    assert.equal(run(repo.dir, production(repo.base, head)), 0);
  } finally {
    repo.cleanup();
  }
});

test("main with an application change builds", () => {
  const repo = makeRepo();
  try {
    repo.write("app/page.tsx", "export default function Page() { return 1; }\n");
    const head = repo.commit("code");
    assert.equal(run(repo.dir, production(repo.base, head)), 1);
  } finally {
    repo.cleanup();
  }
});

test("main with documentation and code changes builds", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/WORKLOG.md", "# Work Log\n\n- entry\n");
    repo.write("vercel.json", "{\"a\":1}\n");
    const head = repo.commit("mixed");
    assert.equal(run(repo.dir, production(repo.base, head)), 1);
  } finally {
    repo.cleanup();
  }
});

test("code changes earlier in a series are not lost by a later docs-only commit", () => {
  const repo = makeRepo();
  try {
    repo.write("app/page.tsx", "export default function Page() { return 2; }\n");
    repo.commit("code");
    repo.write("docs/WORKLOG.md", "# Work Log\n\n- entry\n");
    const head = repo.commit("docs");
    // VERCEL_GIT_PREVIOUS_SHA is the last successful deployment, so the diff covers both commits.
    assert.equal(run(repo.dir, production(repo.base, head)), 1);
  } finally {
    repo.cleanup();
  }
});

test("deleting an application file builds", () => {
  const repo = makeRepo();
  try {
    repo.git("rm", "-q", "app/page.tsx");
    const head = repo.commit("delete code");
    assert.equal(run(repo.dir, production(repo.base, head)), 1);
  } finally {
    repo.cleanup();
  }
});

test("missing previous deployment builds", () => {
  const repo = makeRepo();
  try {
    assert.equal(run(repo.dir, production("", repo.base)), 1);
  } finally {
    repo.cleanup();
  }
});

test("a commit missing from the clone builds (fail safe)", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/WORKLOG.md", "# Work Log\n\n- entry\n");
    const head = repo.commit("docs only");
    assert.equal(run(repo.dir, production("0123456789abcdef0123456789abcdef01234567", head)), 1);
  } finally {
    repo.cleanup();
  }
});
