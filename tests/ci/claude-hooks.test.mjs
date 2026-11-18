// Claude Code guard hooks (.claude/settings.json, owner decisions 2026-11-18). Each hook is run as
// Claude Code runs it: a separate node process with the tool call as JSON on stdin, answering with
// one PreToolUse decision on stdout (or nothing). The tables cover every rule of both guards, the
// allowed examples, fail-closed behaviour and the wrong-project case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPABASE_GUARD = join(root, ".claude", "hooks", "supabase-guard.mjs");
const PUSH_GUARD = join(root, ".claude", "hooks", "git-push-guard.mjs");
const PROJECT = "ooxozvvrljjkyfduuiks";

/** Runs a hook with raw stdin; returns the decision ("allow" | "deny" | "ask" | null) and reason. */
function runHook(script, stdin) {
  const result = spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, `hook exited with ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, "", "hooks write nothing to stderr");
  const out = result.stdout.trim();
  if (out === "") return { decision: null, reason: "" };
  const parsed = JSON.parse(out);
  const specific = parsed.hookSpecificOutput;
  assert.equal(specific.hookEventName, "PreToolUse");
  assert.ok(["allow", "deny", "ask"].includes(specific.permissionDecision));
  assert.equal(typeof specific.permissionDecisionReason, "string");
  assert.ok(specific.permissionDecisionReason.length > 0);
  return { decision: specific.permissionDecision, reason: specific.permissionDecisionReason };
}

function supabase(tool, toolInput) {
  return runHook(
    SUPABASE_GUARD,
    JSON.stringify({ tool_name: `mcp__Supabase__${tool}`, tool_input: toolInput, cwd: root, hook_event_name: "PreToolUse" }),
  );
}

function sql(query) {
  return supabase("execute_sql", { project_id: PROJECT, query });
}

function bash(command) {
  return runHook(PUSH_GUARD, JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: root }));
}

function github(tool, toolInput) {
  return runHook(PUSH_GUARD, JSON.stringify({ tool_name: `mcp__github__${tool}`, tool_input: toolInput, cwd: root }));
}

// ---------------------------------------------------------------------------------------------
// settings.json
// ---------------------------------------------------------------------------------------------

test("settings.json is valid JSON with the owner's deny and ask rules and the two hooks", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  const deny = settings.permissions.deny;
  for (const rule of [
    "Read(./docs/review/**/*.png)",
    "Read(./docs/review/**/*.webp)",
    "Read(./docs/history/**)",
    "Read(./package-lock.json)",
    "Read(./playwright-report/**)",
    "Read(./test-results/**)",
    "Read(./.env*)",
    "mcp__Supabase__list_projects",
    "mcp__Supabase__get_organization",
    "mcp__Supabase__list_organizations",
    "mcp__Supabase__create_project",
    "mcp__Supabase__pause_project",
    "mcp__Supabase__restore_project",
    "mcp__Supabase__create_branch",
    "mcp__Supabase__delete_branch",
    "mcp__Supabase__merge_branch",
    "mcp__Supabase__reset_branch",
    "mcp__Supabase__rebase_branch",
    "mcp__Supabase__create_edge_function_secret",
  ]) {
    assert.ok(deny.includes(rule), `deny list misses ${rule}`);
  }
  assert.deepEqual(settings.permissions.ask, ["mcp__Supabase__apply_migration"]);
  const allRules = [...deny, ...settings.permissions.ask, ...(settings.permissions.allow ?? [])];
  assert.ok(!allRules.some((rule) => rule.includes("execute_sql")), "execute_sql is decided by the hook only");

  const hooks = settings.hooks.PreToolUse;
  const byMatcher = Object.fromEntries(hooks.map((entry) => [entry.matcher, entry.hooks.map((hook) => hook.command)]));
  assert.deepEqual(byMatcher["mcp__Supabase__.*"], ['node "$CLAUDE_PROJECT_DIR/.claude/hooks/supabase-guard.mjs"']);
  assert.deepEqual(byMatcher.Bash, ['node "$CLAUDE_PROJECT_DIR/.claude/hooks/git-push-guard.mjs"']);
  assert.deepEqual(byMatcher["mcp__github__.*"], ['node "$CLAUDE_PROJECT_DIR/.claude/hooks/git-push-guard.mjs"']);
  assert.ok(existsSync(SUPABASE_GUARD) && existsSync(PUSH_GUARD));
});

test("the hook's banned list matches the settings deny list", async () => {
  const { BANNED_TOOLS } = await import(SUPABASE_GUARD);
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  const denied = settings.permissions.deny
    .filter((rule) => rule.startsWith("mcp__Supabase__"))
    .map((rule) => rule.slice("mcp__Supabase__".length))
    .sort();
  assert.deepEqual([...BANNED_TOOLS].sort(), denied);
});

// ---------------------------------------------------------------------------------------------
// supabase-guard.mjs
// ---------------------------------------------------------------------------------------------

const SQL_ALLOWED = [
  "set transaction read only; select 1",
  "SET TRANSACTION READ ONLY ; SELECT * FROM public.visits LIMIT 5",
  "  -- leading comment\n/* block */ set   transaction\n\tread  only;select 1",
  "/* outer /* nested */ still comment */ set transaction read only; select 1",
  "set transaction read only; select 'commit; drop table x' as text",
  'set transaction read only; select 1 as "end", case when true then 1 else 2 end',
  "set transaction read only; select current_setting('transaction_read_only')",
  "set transaction read only; select $$ text $$ as body",
];

for (const query of SQL_ALLOWED) {
  test(`supabase: execute_sql allowed: ${JSON.stringify(query)}`, () => {
    assert.equal(sql(query).decision, "allow");
  });
}

const SQL_ASK = [
  ["no read-only prefix", "select 1"],
  ["prefix without semicolon", "set transaction read only select 1"],
  ["prefix not first", "select 1; set transaction read only; select 2"],
  ["read write in the same statement", "set transaction read only, read write; delete from t"],
  ["nested comment hides the prefix", "/* /* */ set transaction read only; */ commit; delete from t"],
  ["line comment ends at CR", "-- x\rcommit; delete from t;\n set transaction read only; select 1"],
  ["commit", "set transaction read only; commit; delete from t"],
  ["rollback after a comment holding a semicolon", "set transaction read only; select 1; /* ; */ rollback; drop table t"],
  ["end after a string holding a semicolon", "set transaction read only; select ';'; end; insert into t values (1)"],
  ["E-string backslash trick", "set transaction read only; select 'a\\'; commit; --'"],
  ["uppercase COMMIT", "SET TRANSACTION READ ONLY; COMMIT; DELETE FROM T"],
  ["quoted setting name", 'set transaction read only; set "transaction_read_only" = off'],
  ["unicode-escaped function name", 'set transaction read only; select U&"set\\005fconfig"(\'a\', \'b\', true)'],
  ["read/**/write split by a comment", "set transaction read only; set session characteristics as transaction read/**/write"],
  ["query is not a string", 42],
];

for (const [label, query] of SQL_ASK) {
  test(`supabase: execute_sql asks: ${label}`, () => {
    assert.equal(sql(query).decision, "ask");
  });
}

const STATEMENTS = [
  "commit", "rollback", "abort", "end", "begin", "start transaction", "savepoint s", "release s",
  "prepare transaction 'x'", "set session characteristics as transaction isolation level serializable",
  "set local statement_timeout = 0", "reset all", "discard all", "copy t to stdout", "call p()",
  "do $$ begin perform 1; end $$", "listen c", "notify c", "unlisten c", "vacuum", "analyze t", "analyse t",
  "checkpoint", "cluster t", "reindex table t", "lock table t", "load 'x'", "set role postgres",
  "set session authorization postgres", "alter system set work_mem = '1MB'",
];

test("supabase: every escaping statement after the prefix asks", () => {
  for (const statement of STATEMENTS) {
    const result = sql(`set transaction read only; select 1;\n  ${statement};`);
    assert.equal(result.decision, "ask", statement);
  }
});

const ANYWHERE = [
  "select 1 from t where x = 'read write'", "select dblink_exec('x', 'y')", "select set_config('a', 'b', false)",
  "select pg_terminate_backend(1)", "select pg_cancel_backend(1)", "select pg_reload_conf()",
  "select pg_rotate_logfile()", "select pg_switch_wal()", "select pg_promote()", "select pg_sleep(10)",
  "select lo_import('/etc/passwd')", "select lo_export(1, '/tmp/x')", "select pg_read_file('x')",
  "select pg_read_binary_file('x')", "select pg_ls_dir('.')", "select pg_stat_file('x')",
  "select pg_file_write('x', 'y', false)", "show default_transaction_read_only",
  "set transaction_read_only = off", "set transaction_read_only to off",
];

test("supabase: every forbidden function or setting anywhere asks", () => {
  for (const fragment of ANYWHERE) {
    const result = sql(`set transaction read only; ${fragment}`);
    assert.equal(result.decision, "ask", fragment);
  }
});

test("supabase: execute_sql on another project is denied", () => {
  const result = supabase("execute_sql", { project_id: "abcdefghijklmnopqrst", query: "set transaction read only; select 1" });
  assert.equal(result.decision, "deny");
});

test("supabase: execute_sql without project_id asks", () => {
  assert.equal(supabase("execute_sql", { query: "set transaction read only; select 1" }).decision, "ask");
});

test("supabase: apply_migration asks on the project and is denied elsewhere", () => {
  assert.equal(supabase("apply_migration", { project_id: PROJECT, name: "x", query: "select 1" }).decision, "ask");
  assert.equal(supabase("apply_migration", { project_id: "other", name: "x", query: "select 1" }).decision, "deny");
});

test("supabase: every banned tool is denied", () => {
  for (const tool of [
    "list_projects", "get_organization", "list_organizations", "create_project", "pause_project",
    "restore_project", "create_branch", "delete_branch", "merge_branch", "reset_branch", "rebase_branch",
    "create_edge_function_secret",
  ]) {
    assert.equal(supabase(tool, { project_id: PROJECT }).decision, "deny", tool);
  }
});

test("supabase: an organization-wide call is denied", () => {
  assert.equal(supabase("get_cost", { organization_id: "org", type: "project" }).decision, "deny");
});

test("supabase: write-capable tools ask", () => {
  for (const tool of ["deploy_edge_function", "create_notebook", "update_storage_config", "delete_notebook", "run_notebook"]) {
    assert.equal(supabase(tool, { project_id: PROJECT }).decision, "ask", tool);
  }
});

test("supabase: a key-listing tool asks", () => {
  assert.equal(supabase("get_publishable_keys", { project_id: PROJECT }).decision, "ask");
});

test("supabase: read tools on the project get no decision", () => {
  for (const tool of ["list_tables", "list_migrations", "get_advisors", "get_project", "list_extensions", "get_logs", "list_edge_functions"]) {
    assert.equal(supabase(tool, { project_id: PROJECT }).decision, null, tool);
  }
  assert.equal(supabase("search_docs", { graphql_query: "{ x }" }).decision, null);
});

test("supabase: fail closed on invalid input", () => {
  assert.equal(runHook(SUPABASE_GUARD, "{not json").decision, "ask");
  assert.equal(runHook(SUPABASE_GUARD, "").decision, "ask");
  assert.equal(runHook(SUPABASE_GUARD, "[]").decision, "ask");
  assert.equal(runHook(SUPABASE_GUARD, JSON.stringify({ tool_input: {} })).decision, "ask");
});

// ---------------------------------------------------------------------------------------------
// git-push-guard.mjs: Bash
// ---------------------------------------------------------------------------------------------

const BASH_NONE = [
  "git push -u origin claude/x",
  "git push origin claude/a:refs/heads/claude/b",
  "git -C /home/user/tm-x push -q origin claude/y",
  "git status",
  "npm test",
  "git stash push -m wip",
  'git commit -m "harden the git push guard for main"',
  "git push --set-upstream origin claude/x",
  "git push origin HEAD:claude/x",
  "git push -o ci.skip origin claude/x",
  "git push origin --delete claude/old",
  "git push origin :claude/old",
  "timeout 60 git push origin claude/x 2>&1 | tail -5",
  "cd /home/user/tm-pra && git add -A && git commit -m x && git push -u origin claude/efficiency-pr-a",
  'git commit -m "$(cat <<\'EOF\'\nIt\'s fine: never git push origin main (\nEOF\n)"',
  'gh pr create --title t --body "$(cat <<\'EOF\'\nUse git push origin main? Never.\nEOF\n)"',
  'echo "git push origin main"',
  "git log --oneline | head -5",
  "gh api repos/o/r/pulls",
  "gh pr create --title t --body 'Adds a git push guard; never git push origin main'",
  "npx eslint .claude/hooks/git-push-guard.mjs",
  "node .claude/hooks/git-push-guard.mjs < input.json",
  "git push origin claude/x # main",
  "git push --recurse-submodules check origin claude/x",
  "git push --no-force origin claude/x",
];

for (const command of BASH_NONE) {
  test(`push guard: no decision: ${JSON.stringify(command)}`, () => {
    assert.deepEqual(bash(command), { decision: null, reason: "" });
  });
}

const BASH_DENY = [
  "git push origin main",
  "git push origin HEAD:main",
  "git push origin claude/x:refs/heads/main",
  "git push origin refs/heads/main",
  "git push origin claude/x:MAIN",
  "git push origin claude/x main",
  "git push -f origin claude/x",
  "git push --force origin claude/x",
  "git push origin claude/x --force",
  "git push -uf origin claude/x",
  "git push --forc origin claude/x",
  "git push --force-with-lease origin claude/x",
  "git push --force-with-lease=claude/x:abc123 origin claude/x",
  "git push --force-if-includes origin claude/x",
  "git push --mirror origin",
  "git push --mirr origin",
  "git push --all origin",
  "git push --branches origin",
  "git push --prune origin claude/x",
  "git push origin +claude/x",
  "git push origin --delete main",
  "git push -d origin main",
  "git push origin :main",
  "git push",
  "git push origin",
  "git push -u origin",
  "git -C /tmp/x push origin main",
  "git --git-dir=/x/.git push origin main",
  "git --git-dir /x/.git --work-tree /x push origin main",
  "git -c user.name=x push origin main",
  "git --no-pager push origin main",
  "FOO=1 GIT_TRACE=1 git push origin main",
  "command git push origin main",
  "env GIT_TRACE=1 git push origin main",
  "/usr/bin/git push origin main",
  "echo ok; git push origin main",
  "true && git push origin main",
  "false || git push origin main",
  "echo x | git push origin main",
  "sleep 1 & git push origin main",
  "echo ok\ngit push origin main",
  "(cd /x && git push origin main)",
  "if true; then git push origin main; fi",
  'bash -c "git push origin main"',
  "sh -c 'git push --force origin claude/x'",
  "bash -lc 'cd /x && git push origin HEAD:main'",
  'eval "git push origin main"',
  'echo "$(git push origin main)"',
  "echo `git push origin main`",
  "cat <(git push origin main)",
  "git push origin ma\"\"in",
  "printf 'claude/x\\n' | xargs git push origin",
  "find . -name x -exec git push origin main \\;",
  "git -c alias.p=push p origin main",
  "bash <<'EOF'\ngit push origin main\nEOF",
  "bash <<< 'git push origin main'",
  'echo "git push origin main" | sh',
  "echo Z2l0IHB1c2ggb3JpZ2luIG1haW4= | base64 -d | sh",
  '$GIT push origin claude/x',
  'git push origin "main',
  "gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc",
  `python3 -c "import os; os.system('git push origin main')"`,
  "git push $(echo origin) main",
  "nice -n 10 git push origin main",
  "sudo -u bob git push origin main",
  "busybox sh -c 'git push origin main'",
  "git push origin -- main",
  "git push --repo=origin main",
  "git push origin @:main",
  "git push origin heads/main",
  "git push origin claude/x:refs//heads/main",
  "cat <<EOF\n$(git push origin main)\nEOF",
  "x=$(git push origin main)",
  "git push origin claude/x\r\ngit push origin main",
  "{ git push origin main; }",
];

for (const command of BASH_DENY) {
  test(`push guard: deny: ${JSON.stringify(command)}`, () => {
    assert.equal(bash(command).decision, "deny");
  });
}

const BASH_ASK = [
  'git push origin "$BRANCH"',
  "git push origin `cat branch.txt`",
  "git push $REMOTE claude/x",
  "git push origin 'refs/heads/*:refs/heads/*'",
  "git push origin claude/{x,y}",
  "git push origin HEAD",
  "git push -u origin @",
  "for b in a b; do git push origin $b; done",
  "git $(echo status) origin claude/x",
  "git send-pack origin claude/x",
  "gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=Yg== -f branch=claude/x",
];

for (const command of BASH_ASK) {
  test(`push guard: ask: ${JSON.stringify(command)}`, () => {
    assert.equal(bash(command).decision, "ask");
  });
}

// ---------------------------------------------------------------------------------------------
// git-push-guard.mjs: GitHub MCP and fail-closed behaviour
// ---------------------------------------------------------------------------------------------

test("push guard: GitHub file writes to main or without a branch are denied", () => {
  const files = [{ path: "a.txt", content: "a" }];
  assert.equal(github("push_files", { owner: "o", repo: "r", branch: "main", files, message: "m" }).decision, "deny");
  assert.equal(github("push_files", { owner: "o", repo: "r", branch: "refs/heads/main", files, message: "m" }).decision, "deny");
  assert.equal(github("push_files", { owner: "o", repo: "r", files, message: "m" }).decision, "deny");
  assert.equal(github("push_files", { owner: "o", repo: "r", branch: " ", files, message: "m" }).decision, "deny");
  assert.equal(github("create_or_update_file", { owner: "o", repo: "r", path: "a", content: "a", message: "m", branch: "main" }).decision, "deny");
  assert.equal(github("delete_file", { owner: "o", repo: "r", path: "a", message: "m" }).decision, "deny");
});

test("push guard: GitHub file writes to a feature branch and other GitHub tools get no decision", () => {
  const files = [{ path: "a.txt", content: "a" }];
  assert.equal(github("push_files", { owner: "o", repo: "r", branch: "claude/x", files, message: "m" }).decision, null);
  assert.equal(github("create_or_update_file", { owner: "o", repo: "r", path: "a", content: "a", message: "m", branch: "claude/x" }).decision, null);
  assert.equal(github("delete_file", { owner: "o", repo: "r", path: "a", message: "m", branch: "claude/x" }).decision, null);
  assert.equal(github("merge_pull_request", { owner: "o", repo: "r", pullNumber: 1, merge_method: "squash" }).decision, null);
  assert.equal(github("create_pull_request", { owner: "o", repo: "r", head: "claude/x", base: "main", title: "t" }).decision, null);
});

test("push guard: other tools get no decision", () => {
  assert.equal(runHook(PUSH_GUARD, JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } })).decision, null);
});

test("push guard: fail closed on invalid input", () => {
  assert.equal(runHook(PUSH_GUARD, '{"tool_name":"Bash","tool_input":{"command":"git push origin main"').decision, "deny");
  assert.equal(runHook(PUSH_GUARD, "{not json").decision, null);
  assert.equal(runHook(PUSH_GUARD, JSON.stringify({ tool_name: "Bash", tool_input: { command: 1 }, note: "push" })).decision, "deny");
  assert.equal(runHook(PUSH_GUARD, JSON.stringify({ tool_name: "Bash", tool_input: {} })).decision, null);
});
