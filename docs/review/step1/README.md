# Step 1 / PR 1.7: report and close (database, Migrations 1–4)

**Status (2026-11-16):** documentation only; prepared on branch `claude/step1-pr17-report` (from PR 1.6's head `f53016a`), **not merged**. No migration, test, script, workflow or protected file changes. Nothing remote was accessed: every result below comes from a fresh local run (Docker, Supabase CLI 2.122.0, PostgreSQL 17).

This folder is Step 1's visible output for the owner (`CLAUDE.md` "Visual approval": "Step 1 an ER diagram and a Hebrew test report (who can see what)"). Step 1 has no UI change, so there are no screenshots.

## Files

| File | Language | Content |
|---|---|---|
| [`erd.md`](erd.md) | English | Mermaid ER diagram of all 23 tables in `public` (keys, the composite `(…, is_test)` foreign keys, test-data markers), the people references, every column of every table, the view, and the server functions by migration. Generated from the local catalog |
| [`who-can-see-what.he.md`](who-can-see-what.he.md) | Hebrew (RTL) | The owner's report: per data area, what each role (Creator, Manager, Customer Service, Technician, a deactivated user, anonymous) can read and do, with the matrix keys, the fixed capabilities, the TEMPORARY behaviours and the open decisions |
| [`test-report.he.md`](test-report.he.md) | Hebrew (RTL) | The fresh local run: pgTAP per file, the negative security tests, the fail-closed hardening checks, the migration guard, the canary-rows check, the census, the rollback round trip, the audit fingerprint, known gaps and hand-offs, and the commands to repeat it |

Sources: the four migration files, `tests/db/*.test.sql`, and the per-PR reports `docs/review/step1-pr13/README.md` (Migration 1), `step1-pr14` (Migration 2), `step1-pr15` (Migration 3) and `step1-pr16` (Migration 4).

## Step 1 status

| Migration | PR | Applied to the remote project? | Remote version (file version) | sha256 of the migration file |
|---|---|---|---|---|
| 1 `access_and_permissions` | PR 1.3, #12, merged (`fe370df`) | yes, 2026-11-11 | `20261111125920` (`20261104120000`) | `30e0c8b0e8638bfe38fa1d49b9eae6f7d07046aaaa436549c084b8746ebb89f7` |
| 2 `reference_customers_products` | PR 1.4, #14, merged (`4509c6e`) | yes, 2026-11-12, inside the self-verifying wrapper `04810116…0a92` | `20261112093516` (`20261105120000`) | `874742381f39711f5039a5f3933c432c22a113249fd9db148c7c766fc841b363` |
| 3 `service_calls_visits` | PR 1.5, #25, merged (`1ed6e65`) | yes, 2026-11-16, inside the self-verifying wrapper `8b9decd8…313d` | `20261116094444` (`20261106120000`) | `37b803dbae1636bc65baec7feaf3c7723b7c3448d7b8ab27d43b5706f5c8eecb` |
| 4 `integrity_offline` | PR 1.6, #30, **draft, not merged** | **no** | — (`20261107120000`) | `ad0eb31499715b40de63137b6a0730f9b73d51f3e3a69a650d3037d553e88715` |

- The sha256 values are the ones pinned in the per-PR reports (PR 1.3 §17, PR 1.4 §15.5, PR 1.5 §17, PR 1.6 header). The files in this branch hash to the same values (checked with `sha256sum` on 2026-11-16).
- **Version discrepancy (documented, not repaired):** MCP `apply_migration` records a server-assigned version, so the remote history differs from the file names. Each down script also finds its row by name. Aligning the history is a remote write and needs the owner's approval.
- **Migration 4 is not live.** Applying it needs the owner's separate approval of the exact file (D52 rule 4, D55), the same self-verifying wrapper (the file has `\u` escapes, PR 1.6 §10), and then the merge of PR #30 with the owner's approval (D59). Whether its post-review fixes need another review is D58 (9), open.

## Fresh local run (2026-11-16)

| Check | Result |
|---|---|
| `supabase db reset --local --no-seed`, then `supabase test db tests/db` | pgTAP **1,390/1,390** in 31 files |
| `npm run -s test:ci` | Node **190/190** (guard 74, canary logic 44, source text 40, rollback 13, audit anchor files 10, hardening copies 9) |
| `node scripts/check-migrations.mjs` | passed |
| `node scripts/db-canary.mjs` (database container alone) | **PASS**: 4 migrations, 4 fixtures, coverage 23 tables and 301 columns, the 3 approved `role_permissions` exceptions (D56 (1)) |
| `public.test_data_census()` on the migrations-only database | 30 rows, every count 0 |
| Rollback round trip (down scripts newest first, then rebuild) | refusal when out of order; each step back to the earlier migration's counts; clean catalog with the `postgres` default privileges still hardened; rebuild and pgTAP 1,390/1,390 again |
| Audit-function fingerprint | `9c962b84a36e6218412e234d9042eb44`, equal to PR 1.6 §9 (Migrations 1–4) |
| `npm run -s lint`, `git diff --check` | clean |

## Step 1 owner check (`docs/ROADMAP.md`) and the evidence

| ROADMAP item | Evidence | State |
|---|---|---|
| ERD and Hebrew who-can-see-what report approved | `erd.md`, `who-can-see-what.he.md` | Waiting for the owner's review |
| Technician A cannot see Technician B's visits, except earlier closed visits of a shared call (D36) | `090`, `180`, `190`, `250` | Pass |
| Escalation and account-approval tests pass | `020`, `030`, `040`, `050` | Pass |
| Duplicate SKU impossible | `products_sku_normalized_key` (unique), `100` | Pass |

**What still remains in the Step 1 sequence:** the apply and merge of Migration 4 (PR 1.6), the owner's review of these reports, and PR 1.8 (Migration 5, accounts and permissions per D60 (7)–(9)), which D60 added to the Step 1 PR sequence after this PR and before the Step 2 user-administration PRs. `docs/ROADMAP.md` still labels PR 1.7 "end of Step 1"; with PR 1.8 added, the owner decides whether Step 1 closes with PR 1.7 or PR 1.8.
