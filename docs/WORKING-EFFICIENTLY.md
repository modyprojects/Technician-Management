# Working Efficiently — Context, Agents and CI Rules

Status: **Approved by the owner on 2026-11-18 (with the changes below).** Changes to `CLAUDE.md`, `.claude/**` and `.github/workflows/**` are protected and need the owner's approval (PR C and PR D).
Goal: cut token use and CI time without removing any security gate, approval rule or mandatory check that matters while only fictional data exists.

---

## 0. Why this is needed

Baseline, measured on `main` on 2026-11-18:

| Item | Measurement |
|---|---|
| Startup reading (mandatory reading list) | ~430 KB (~110K tokens) |
| `CLAUDE.md` (loaded by every agent) | 21.0 KB |
| `docs/decisions.md` | 83.3 KB |
| `docs/WORKLOG.md` | 217.8 KB, 55 entries |
| Test files over 40 KB | 9 (`990_rollback` 359 KB, `demo.spec` 268 KB, `check-migrations.test` 120 KB, DB tests 60-116 KB) |
| `docs/review/` | 526 files, 47.4 MB |
| CI, docs-only PR | 15.8 min |
| CI, code PR | ~20 min (Database tests 3-7 min) |

Targets: startup context under 25K tokens after PR C; docs-only CI under 2 min and full CI ~10-12 min after PR D. The owner measures `/context` in a fresh session (a cloud session cannot measure it for itself).

Root causes of the 2026-11-17 token burn:
1. Three agents hit the usage limit at the same time and stopped with uncommitted work.
2. The orchestrator session stayed open across many tasks.
3. Full local test runs and repeated screenshot runs.
4. Long PR and review write-ups.
5. Very large tool inputs (a 117 KB migration wrapper).

---

## 1. Context loading rules (replaces `CLAUDE.md` rule 1)

### 1.1 Always loaded
- `CLAUDE.md` only (target under 6 KB, after PR C): binary rules, stop gates, approvals, how to test and merge. No history or rationale.
- At session start also read `docs/STATUS.md` (see §6).

### 1.2 Loaded on demand, by task type

| Task | Read | Do NOT read |
|---|---|---|
| UI screen | `docs/screens/<screen>.md` if it exists, the matching section of `demo-deviations.md` (grep), `design-system.md` | All of `demo.html`, `database-schema.md`, `mfa-design.md` |
| DB / migration / RLS | `database-schema.md` (relevant section), `security.md`, `testing.md` (database) | `demo.html`, `demo-deviations.md` |
| Auth / proxy / env / deploy | `security.md`, `deployment.md`, `architecture-data-access.md` (relevant section) | `demo.html` |
| Calendar / simulator | `integrations.md`, `outlook-template.md`, `spec.md` (calendar) | `demo.html` |
| Docs-only change | The file being changed | Everything else |
| Any task | `docs/STATUS.md`, the decisions file (`decisions-current.md` once PR B lands), top 3 `WORKLOG.md` entries (use `limit`) | `docs/history/**`, `docs/review/**`, `decisions-archive.md` |

`docs/screens/<screen>.md` is written only when that screen is built, by the agent building it (structure, fields, states, Hebrew strings). There is no up-front split of `demo.html`; it stays the visual reference.

### 1.3 Reading discipline
1. Never read a file over 20 KB in full: `grep -n`, then `Read` with `offset`/`limit`.
2. Read each file once per session; re-read only if it changed.
3. Search before reading (`grep`/`glob` or an Explore subagent).
4. Never read bulky outputs in full: test reports, build logs, `package-lock.json`, images, Playwright traces. Use `tail`, `grep` or the failure section.
5. Conflicting documents with no resolution: stop and ask the owner in Hebrew (unchanged).

---

## 2. Documentation hygiene: one source of truth per fact

| File | Rule |
|---|---|
| Decisions | PR B: `decisions-current.md` (under 10 KB, one line per decision in force) plus `decisions-archive.md` (full text). The owner confirms `decisions-current.md` is faithful before merge. |
| `docs/WORKLOG.md` | Keep the last 10 entries; older entries go to `docs/history/worklog-YYYY-MM.md`. One entry is at most 5 short bullets: what changed, PR number, what is next. Rationale goes in the PR. |
| `docs/STATUS.md` | The only status and handoff file (§6). |
| `docs/PROJECT-MAP.md` | Describes structure only; updated when structure changes. Status is not repeated here. |
| README, START-HERE, ROADMAP | Link to STATUS.md; do not repeat status. |
| Rules | Written in full where used ("migrations need owner approval"), not "per D52 rule 6". |

Documentation part of Definition of Done: every PR one WORKLOG entry; `STATUS.md` updated at the end of every task; `PROJECT-MAP.md` only if structure changed; decisions file only if the owner decided something; Hebrew guides when a feature is completed. Never update the same fact in two files.

---

## 3. Working with agents

### 3.1 Roles (at most 3 active agents, the reviewer included)

| Role | Model | Responsibility |
|---|---|---|
| Orchestrator (main session) | Opus | Splits work, writes briefs, owns shared files (`package.json`, `components/ui`, layouts, shared types, test config, `CLAUDE.md`, docs), merges |
| DB / logic agent | Opus | Migrations, RLS, server logic, DB tests |
| UI agent 1 and UI agent 2 | Sonnet | Screens and components on their own files |
| Reviewer | Opus | Gets the diff plus the relevant rules only. Only for RLS, auth, security, DB or deploy changes. Takes one of the 3 slots |

Rules:
- Explicit file ownership; two agents never touch the same file.
- The DB is a single lane: never two migrations in parallel. A screen that depends on an unapproved migration is built on fake data and wired later.
- Each agent has its own branch and worktree.
- Merge one PR at a time; update the branch from `main` before each merge.
- Subagents receive a brief (§3.2) and never run the reading list.
- After 2 failed attempts at the same problem, stop and report.
- No CI polling loops (§3.4). Reports are at most 10 lines.
- Use a subagent only for independent work on separate files, a broad search (Explore), or a required review. Do not use one for small tasks or for work that needs the orchestrator's full context.

### 3.2 Brief template

```
TASK: <one deliverable, one sentence>
BRANCH / WORKTREE: <name>
FILES YOU OWN: <paths>   FILES YOU MUST NOT TOUCH: <paths>
RELEVANT RULES (inline, not D-numbers): <3-8 bullets copied from CLAUDE.md / decisions>
READ ONLY: <exact files and sections>
DONE WHEN: <tests to pass, output expected>
REPORT: <=10 lines: changed files, tests run with results, open issues. No narration.
```

### 3.3 Reviews
- The reviewer gets `git diff main...HEAD -- <paths>` and the 3-8 relevant rules.
- One review per PR where required (auth, RLS, proxy, env, deploy, DB, hooks). None for docs, copy or UI-only styling PRs.

### 3.4 No polling loops
Do not poll CI or a deployment. Use `gh run watch <id> --exit-status` once, or continue with independent work and check once later. After a failure read only the failed part: `gh run view <id> --log-failed | tail -150`.

### 3.5 Commit and push at every checkpoint (permanent rule)
Every agent commits and pushes at every checkpoint, at least every ~30 minutes, so a usage-limit stop never loses work. Clean up worktrees of merged branches only; never delete unmerged work.

---

## 4. Testing and CI

### 4.1 Locally vs CI
| Where | What runs |
|---|---|
| Locally, during work | Only what the change touches (one spec, one DB test file, lint/typecheck of changed files) |
| Locally, before push | lint + typecheck + build + affected specs; not the full e2e suite at 3 widths |
| CI | The full suite; the agent does not repeat it locally |

### 4.2 Docs-only PRs (PR D, protected)
Keep a single `checks` job so "never merge with missing checks" still sees one green check. Detect docs-only changes (`docs/`, `README.md`, `START-HERE.md`, `prompts/`) and skip the heavy steps with `if: steps.changes.outputs.code == 'true'`. The secret scan always runs. A change to `CLAUDE.md` or `.claude/**` is outside `docs/` and still triggers the full run.

### 4.3 E2E widths (PR D)
Tag layout tests `@responsive`. The `phone` and `tablet` projects run only `@responsive` (`grep: /@responsive/`); `desktop` runs everything. Every-screen-at-3-widths stays covered by the `@responsive` tests and the screenshot set.

### 4.4 Oversized tests
- PR E1: split `tests/e2e/demo.spec.ts` per screen; reduce oversized DB tests to the permission matrix plus business logic; include a table of what was deleted and why. Never delete RLS tests for user administration, password reset or export, or business-rule tests. After Migrations 6 and 7 are merged.
- PR E2 (after 2026-11-24, separate owner decision, item by item): canary self-tests, byte-identical rollback copies, `tests/ci/rollback.test.mjs`. List exactly what would be removed; the owner approves each item. Removing any protected test or check (canary self-tests, rollback checks) always needs that item-by-item approval.
- Target: no test file over ~40 KB.

### 4.5 Database CI
`db.yml` stays path-filtered; the canary self-test runs only when its own files change.

---

## 5. Screenshots

1. `npm run screenshots` for the changed screens only.
2. Keep only the latest set per screen under `docs/review/<step>/`, compressed WebP.
3. Do not re-open screenshots to check them unless investigating a specific visual defect.
4. Send them to the owner (unchanged). Note: old PNGs stay in git history (no history rewrite), so the saving applies from now on.

---

## 6. Session hygiene and handoff

1. One task per session; `/clear` between unrelated tasks. Use `/compact <focus>` instead of relying on auto-compact.
2. **One handoff file only: `docs/STATUS.md` (at most 40 lines).** Read at session start; update at the end of every task. There is no `NEXT.md`. Headings: Where we are / Done / In progress / Next / Waiting for the owner.
3. Always limit shell output (`| tail -50`, `--reporter=line`, `-q`).
4. Turn off MCP servers the current step does not use.

---

## 7. Settings and guard hooks (`.claude/**`, protected after PR C)

**Read deny rules** (context hygiene only; Bash can still read files, so the real control stays "no secrets in the repository"): `docs/review` images only (`*.png`, `*.webp`; review text files such as migration proposals stay readable), `docs/history/**`, `package-lock.json`, `playwright-report/**`, `test-results/**`, `.env*`.

**Supabase hook (PreToolUse):** auto-allows only `execute_sql` queries that start with `set transaction read only;` and contain no transaction-control or admin functions. Anything else asks the owner. `apply_migration` always asks. Other projects and org-wide tools are denied.

**Main-branch hook (PreToolUse):** denies any push to `main` and any force-push, for Bash and for GitHub MCP file writes.

**Skills:** only official Supabase and Anthropic sources; no third-party skills. Installed now: `supabase-postgres-best-practices` only (pinned commit, recorded in `.claude/skills/README.md`). `skill-creator` and `webapp-testing` are not installed (Playwright already covers testing).

---

## 8. Security scope while only fictional data exists (until Microsoft 365)

KEEP: RLS on every table; server-side role checks; secret key server-only; secret scan in CI; Vercel Authentication on Preview; owner approval for migrations; no push to main; one role×table×read/write permission-matrix test per migration (~20-50 tests).

DROP: byte-identical rollback copies and canary self-tests (one simple rollback test per migration instead); exhaustive negative-test permutations (keep only for user admin, password reset, export); long security write-ups in PRs (one line: "Security impact: none / <what changed>").

DEFER to one pre-go-live hardening pass (before real data): rate limits, CSRF/replay hardening, MFA, leaked-password protection, rotate the vercel-preview key.

Removing any protected test or check (canary self-tests, rollback checks) still needs the owner's item-by-item approval (PR E2).

---

## 9. Rollout

| PR | Content | Approval |
|---|---|---|
| A | This document, `STATUS.md`, settings, hooks, skill | Autonomous + independent hook review |
| B | `decisions-current.md` (<10 KB, one line per decision in force) + `decisions-archive.md`; WORKLOG keeps the last 10 entries, older to `docs/history/`; no duplicated status in README/START-HERE/ROADMAP | Autonomous; the owner confirms `decisions-current.md` is faithful before merge |
| C | Lean `CLAUDE.md` (<6 KB) from the advisor's draft; `.claude/**` added to the protected list; the two hooks described | Owner approval (protected) |
| D | CI: docs-only detection (secret scan always runs); E2E `@responsive` tagging, phone/tablet run only `@responsive` | Owner approval (protected) |
| E1 | Split `demo.spec.ts` per screen; reduce oversized DB tests; table of what was deleted and why | Autonomous + reviewer, after Migrations 6 and 7 are merged |
| E2 | Canary self-tests, byte-identical rollback copies, `tests/ci/rollback.test.mjs` | After 2026-11-24, separate owner decision, item by item |

Success check after PR C: `/context` at startup under ~25K tokens (measured by the owner); after PR D: docs-only CI under 2 min, full CI ~10-12 min.
