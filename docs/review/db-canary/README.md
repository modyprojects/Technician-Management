# Canary-rows check for migrations: design, measurements and results

Branch `claude/db-canary-rows`, based on `main` `bcaa885`. A dedicated PR, because it touches the protected workflow `.github/workflows/db.yml`; it only adds protection (two steps, three path filters, a longer job timeout). No remote Supabase project is touched: everything runs against the local Docker database, with fictional, test-marked rows only (D47). Rules in short: `docs/testing.md`, "Canary rows check". How to write fixtures: `tests/db-canary/README.md`. Three independent reviewers (bypass, CI and correctness lenses) reviewed the first version; their findings and what was done about each are in section 11, and the sections below describe the version after that round.

**What the check is:** a tripwire that makes accidental or careless data writes in a migration fail CI. It is not proof against a migration written to evade it (section 8): the static guard and independent review stay the defence against that.

## 1. Why

The static migration guard (`scripts/check-migrations.mjs`) reads the SQL text. Three adversarial review rounds on PR 1.3 kept finding ways to write data that the text check could not see (dynamic SQL, functions, copies through new tables ...). The owner was told the recommended direction: keep the guard as the first line and add a runtime check in CI. This check runs the migrations and compares data, so the way a write is spelled does not matter.

## 2. What runs in CI

`Database tests` (`.github/workflows/db.yml`), after the pgTAP step and before "Stop the local database":

1. **Canary-rows check self-test:** `node scripts/db-canary.mjs --selftest tests/db-canary-selftest` (49 cases, each with an expected outcome and rule).
2. **Canary-rows check:** `node scripts/db-canary.mjs` on the repository's `supabase/migrations` (zero today) with the fixtures in `tests/db-canary/`.

Both use the Node that `ubuntu-latest` provides (standard library only: no `setup-node`, no `npm install`), no secrets, no new actions and no permission changes. The path filters gained `scripts/db-canary.mjs`, `tests/db-canary/**` and `tests/db-canary-selftest/**`. The job timeout went from 15 to 20 minutes; the self-test step has 15 minutes and the check step 10 (section 5).

## 3. Design

### 3.1 Empty database
Every run starts from a database equal to a fresh local project with **zero** migrations: `supabase --workdir <temporary folder> db reset --local --no-seed`, where the temporary folder holds the same `config.toml` (so the same `project_id` and container) and an empty `supabase/migrations`. The reset recreates the database volume, so roles and other cluster-wide state are fresh too. The script then checks that `public` and `private` hold no relation, `private` does not exist and the migration history is empty.

Methods measured (local Docker, Supabase CLI 2.122.0, Postgres 17.11):

| Method | Time | Used |
|---|---|---|
| `supabase db reset --local --no-seed` from a temporary folder | 18.3 to 19.0 s | the check (every run); the self-test (first run and fallbacks) |
| `supabase db stop` plus `supabase db start` (fresh volume) | about 20 s (start 18.6 s, stop 1.2 s) | no: slower and leaves the CI stack stopped in between |
| `supabase db start` from a temporary folder | 0.8 s | no: it does nothing when the container already runs ("already running"; 28 relations from the previous run were still there) |
| `CREATE DATABASE ... TEMPLATE` of a pristine zero-migration copy | 0.25 to 0.4 s per run | the self-test only, between resets |

The clone keeps the database's owner, privileges, settings and comment (copied and compared by hash). A clone cannot undo cluster-wide changes (roles, passwords, replication slots), so the self-test compares a cluster fingerprint (cluster-wide state plus the within-run hash of passwords, slots and origins) before each run. When it differs, the self-test first drops the run's database and every role, replication slot and replication origin that the pristine state did not have, and compares again (about 0.25 s); only if the fingerprint still differs, or a drop fails, does it fall back to a full reset. `postgres` itself is never dropped (the `pg_net` worker crashes the server if it restarts while `postgres` is missing). The check itself never uses clones.

### 3.2 Applying a migration
In file-name order, each file exactly as one transaction, as role `postgres`: `docker exec -i <container> psql -X -q -A -t -v ON_ERROR_STOP=1 -1 -U postgres -d <db> -f -`, with the file on standard input. **Deviation:** the file is not piped as raw text; it is sent base64-encoded and executed with `\gexec`, so `psql` never interprets backslash commands in a migration or a fixture (a `\!` line would otherwise run a shell command in the container; the Supabase CLI does not interpret them either). File names are data: every command is an argv array (`spawnSync`), never a shell string, and only `<digits>_<name>.sql` files are accepted (anything else in the folder fails the check).

### 3.3 Snapshot
Taken as `supabase_admin` in one read-only repeatable-read transaction, plus one `pg_dump`:

- every ordinary table, partitioned table and materialized view in every schema except `pg_catalog`, `information_schema`, `pg_toast` and temporary schemas, **plus** `pg_catalog.pg_largeobject` and `pg_largeobject_metadata` (user data stored in the catalog);
- per relation: its column list and the multiset of rows, each value as the text of its type's **output function** (`format('%s', column)`), per column (so a new column can be checked for JSON null and volatile columns can be masked). Not `to_jsonb`: it applies a cast to json when one exists for a user-defined type, and a migration owns the types it creates, so it could make the snapshot show anything (review round 1, F1); `to_jsonb` also drops array lower bounds and normalizes `json` text. The JSON category of built-in types is kept (numbers bare, booleans `true`/`false`, the rest JSON strings), so a type change such as `integer` to `text` still changes the value text; null is tested with `num_nulls` (a composite whose fields are all null `IS NULL` without being null);
- every sequence's `last_value`, `is_called` and start value, read from the sequence itself (`pg_sequences.last_value` is null both for an unused sequence and after `setval(..., false)`, review round 1, F3); an unused sequence is recorded as null, `is_called = false` with another value as `<value> (not called)`;
- the schema: `pg_dump --schema-only --binary-upgrade`, run inside the container so client and server versions match. Binary-upgrade mode also dumps every member of an extension and its comment (a postgres-owned extension built with `pg_tle` could otherwise hide a function body or comment from a plain dump, F2) and the stored default of an added column (`binary_upgrade_set_missing_value`, F4). The random `\restrict` lines of pg_dump 17.6 and later are dropped; object ids, TOAST and extension-configuration ids, `relfrozenxid`/`relminmxid` and sequence states (compared by the sequence rules) become placeholders;
- hashes of cluster-wide state (roles and their attributes, memberships, role settings, tablespaces, databases, shared comments, parameter privileges, subscriptions) and of the database's own properties (owner, privileges, connection limit, settings, comment). Setting values never leave the database: only hashes do;
- a **within-run** hash of role passwords (each hashed inside the database first), replication slots and replication origins: passwords carry random salts, so they differ between two resets and are compared only before and after each migration of the same run (F4);
- the list of event triggers, without those that belong to an extension owned by a superuser (the image's vetted scripts; `pg_tle` adds one), and the list of base types not owned by a superuser (only `pg_tle`'s `create_base_type` makes those; their output function is ordinary code that could hide part of a value).

**Bookkeeping tables** (excluded tables that change on their own): **none**. Measured: a freshly reset, idle database (54 relations, 286 rows, 3 sequences) was snapshotted three times over 180 seconds: no row, sequence, schema or fingerprint changed. Migrations are applied with `psql`, so `supabase_migrations.schema_migrations` is never written. Every within-run comparison in the self-test and the PR 1.3 runs also found nothing changing on its own. The exclusion mechanism stays in the script (`BOOKKEEPING_TABLES`), empty, and an entry needs a measured reason here. Other services of the project (Auth, Storage, Realtime) do write on their own, so the script refuses to run while any other container of the project runs (CI starts the database only).

### 3.4 Runs
- **Reference runs A1 and A2:** empty database, no canary rows, migrations 1..N, a snapshot before and after each.
- **Canary run B:** empty database (its schema must equal A1's empty schema), `tests/db-canary/000_base.sql` (canary rows outside `public` and `private`: two Auth users, an identity, a Storage bucket and object; fictional, `example.test`), then for each migration k: apply k, snapshot, compare with A1, insert the fixture `tests/db-canary/<version>.sql` if present (version = the migration file's numeric prefix), snapshot, check the fixture, check coverage.

### 3.5 Rules (fail closed; non-zero exit; the message names the rule, the migration and the table, and prints at most two shortened rows)
- **R1** In `public` and `private`, no row of a table that existed before migration k may be removed or changed, in run B and in run A1 (reference rows included). A column added by k may appear on existing rows only with JSON null; a dropped column, a renamed column (treated as dropped: a rename can change what values mean, for example renaming another column to `is_test`) or a changed value is a change. A dropped table with rows and a materialized view emptied by `WITH NO DATA` are changes too.
- **R2** Rows added by k to a pre-existing table must be the same multiset in A1 and B, after masking. Extra signal: every sequence in `public` and `private` must be in the same state (value and `is_called`) in A1 and B before and after k (a data-dependent `nextval` or `setval` with no row change).
- **R3** A table or materialized view created by k must hold the same rows in A1 and B (after masking). The schema after k must be the same in both runs: the same tables and columns, the same `pg_dump` text, the same cluster and database hashes. This catches data written into the schema: a comment, a function body, a default, a view definition, an extension member, a stored column default (`attmissingval`) or a role built from rows, or DDL that runs only when rows exist.
- **R4** Outside `public` and `private`, migration k may add, change or remove no row (Auth users, Storage, Vault secrets, cron jobs, `pg_net` requests, large objects ...), may change no sequence (`nextval`, `setval`, `RESTART`), and may set no role password and create no replication slot or origin (within each run), in A1 and in B. No bookkeeping exceptions are needed today.
- **R5** Volatile columns are found by running the reference chain twice (A1, A2). Masks are computed **per migration step**: for a table that existed before migration k, only the columns that differ between the rows k adds in A1 and in A2; for a table k creates, the columns that differ in its rows. A column that is volatile in earlier rows (PR 1.3's `role_permissions.updated_at`, a `now()` default of the reference rows) therefore never hides data in rows a later migration adds (F5). Within a step, masks are refined per group of rows that agree on every other column, and a masked column's values that are equal in A1 and A2 must also appear in B: a deterministic row added next to a `now()` row (the reviewers' `a06`) is compared exactly. The determinism check uses per-point masks over whole tables. Null stays null and a masked value keeps its **shape** (every run of hexadecimal characters becomes one `0`): a random UUID or a timestamp still matches another, while text copied into the column does not. The masked columns are printed with their migration. Fixtures must never consume or set a sequence: every sequence's state must be unchanged by each fixture.
- **R6** After each step (after the fixture), every table in `public` and `private` has at least one row and every column is non-null in at least one row, except entries in `tests/db-canary/coverage-exceptions.json` (each with a reason of 10 characters or more; empty in this PR). The file is global: an entry applies to every step in which its table or column exists, and an entry that matches no step is stale and fails (an entry for a table that a later migration drops stays valid, C5). A missing fixture fails with the file to add.
- **R7** Any `psql` error (including a migration that fails only with canary rows present), Docker or CLI failure, unparsable or incomplete snapshot output, an empty snapshot, a fresh database that is not empty, nondeterminism between A1 and A2 (row counts, unmasked rows, sequences or schema), another service of the project running, a migration that adds, changes or removes an event trigger (a login or DDL trigger runs code later, which the check cannot see, F6), a base type not owned by a superuser, or a fixture hygiene problem (a fixture only adds rows and never changes the schema, a password, slot or event trigger; rows in tables with `is_test` are test-marked; every e-mail address uses `example.test`) fails the run. Zero migrations is a pass ("0 migration(s) checked"). Every failure exits 1, a usage error 2 (tested through the command line, also through a symlinked path).

The script prints a summary: migrations and fixtures checked, tables and rows in the final canary snapshot, masked columns, coverage and the elapsed time split into resets, SQL, row snapshots and schema dumps.

## 4. Choices and deviations from the plan, with reasons

| Plan | Built | Why |
|---|---|---|
| Fixtures in `tests/db/canary/`, self-tests in `tests/db/canary-selftest/` | `tests/db-canary/` and `tests/db-canary-selftest/` | `supabase test db tests/db` runs every `.sql` file below `tests/db/`, subfolders included, as a pgTAP test. Verified: a plain SQL file in `tests/db/canary/` failed the pgTAP step with "No plan found in TAP output". Both folders are in the workflow's path filters. |
| Migration file on `psql`'s standard input | Same command, but the file is sent base64-encoded and run with `\gexec` | `psql` must not interpret backslash commands from a migration or fixture (section 3.2). Still one transaction per file, `ON_ERROR_STOP`, role `postgres`. |
| Rows as one `to_jsonb(row)` text | Output-function text per column, with the JSON category of built-in types | Per column: needed for the JSON-null rule on added columns and for per-column masking. Output functions instead of `to_jsonb` since review round 1 (F1, F9, C7): a user-defined cast to json made `to_jsonb` show any value. |
| Sequences: `last_value` | `last_value`, `is_called` and the start value, read from each sequence | `pg_sequences.last_value` hides `setval(..., false)` (F3, C2). |
| R3: same rows in new tables | Also the same schema in both runs (tables, `pg_dump --schema-only --binary-upgrade`, cluster and database hashes) | Data copied into the schema (a comment, a role, a function, an extension member, a stored column default) changes no table row, so a rows-only comparison misses it. Binary-upgrade mode since review round 1 (F2, F4). Cost: about 0.35 s per snapshot point. |
| R4: rows outside `public`/`private` | Also large objects, sequences, role passwords, replication slots and origins | All can carry data copied from rows without changing an ordinary table (passwords, slots and origins since review round 1, F4). |
| R5: masks per table | Masks per migration step, and masked values keep their shape | A column volatile in earlier reference rows hid data in rows a later migration added; a column made volatile with `coalesce(<data>, gen_random_uuid())` hid copied text (F5). |
| (none) | R7 for event triggers and for base types not owned by a superuser | Both run or hide code beyond what a snapshot sees (F6, and the `pg_tle` base types found while fixing F1). |
| A2 only for masking | A2 is also a determinism check (rows, sequences, schema) | A difference beyond masked columns means the chain is not reproducible, so A1 against B would not prove anything (R7). |
| Fixture checks: no sequence use | Also: only added rows, no schema change, test-marked, `example.test` addresses (R7) | D47 and the "fixtures only add rows" rule from the plan's fixture README, enforced instead of trusted. |
| Self-test: one reset per run | One reset, then a template clone per run; after a run that changed cluster-wide state, the added roles, slots and origins are dropped and the fingerprint compared again, with a full reset as the fallback | 49 cases × 3 runs × 20 s would take about 49 minutes; the clone path takes 7.0 minutes and is checked by the same rules (fresh-state comparison, property hashes, cluster fingerprint). Dropping added roles instead of resetting (review round 1) removed the 4 fallback resets of the first version. The check itself always uses full resets. |
| Other services | The check refuses to run while another container of the project runs | Auth, Storage and Realtime write to the database on their own; CI starts the database only. |

## 5. Measured runtimes (local Docker, 2026-11-05, after review round 1)

CI-equivalent sequence on this branch, zero migrations, from a stopped stack (another project's database ran on the same machine at the same time):

| Step | Time |
|---|---|
| Stop the local stack | 1.6 s |
| Migration guard | 0.1 s |
| `supabase db start` (fresh volume, images present) | 20.1 s |
| pgTAP (`tests/db`) | 1.4 s |
| Canary self-test (49 cases) | 419.4 s (script: 419.1 s; supabase db reset 1x: 21.5 s; pristine copy 0.8 s; 145 database clone(s) 57.4 s; 16 cluster restore(s) 4.0 s; 0 fallback reset(s); SQL 40.1 s; 489 snapshot(s): rows 82.4 s, schema 179.5 s) |
| Canary check (0 migrations) | 66.5 s (script: 66.4 s; supabase db reset 3x: 21.9 s, 21.1 s, 21.0 s; SQL 0.1 s; 4 snapshot(s): rows 0.6 s, schema 1.4 s) |
| **Total of the database steps** | **about 8.5 minutes** |

With PR 1.3's migration and fixture the check took 75.5 s (supabase db reset 3x: 21.4 s, 22.3 s, 25.7 s; SQL 0.9 s; 8 snapshot(s): rows 1.5 s, schema 3.2 s): the resets dominate, and each further migration adds about a second. The binary-upgrade dump costs about 0.35 s per snapshot point (the plain dump of the first version about 0.18 s), which is most of the self-test's growth from the first version (35 cases, 264 s), together with the 14 new cases; dropping added roles instead of resetting saved the 4 fallback resets (about 80 s). Hosted runners are slower and pull the images first: the job limit is 20 minutes, the self-test step's 15 minutes (about a 2x margin), the check step's 10 minutes. The hosted-runner times are to be recorded here from the PR's first CI run (review C10).

## 6. Self-test results

`node scripts/db-canary.mjs --selftest tests/db-canary-selftest` (from the CI-equivalent sequence above): **49/49 cases as expected** (expected outcome and the rule that fired; some cases also check a message fragment). Each case is self-contained (its own tiny migrations and fixtures; the shared base canary rows come from `tests/db-canary/000_base.sql`). The 14 cases added in review round 1 were also run with the first version of the script: 13 give a mismatch there (every bypass passed, or failed for an unrelated reason); `fail_r7_base_fixture_hygiene` matches with both, because it guards an existing check against removal (review C3).

| Case | What it does | Expected | Got | Time |
|---|---|---|---|---|
| `fail_r1_backfill` | add column, then `update` it from another column | fail R1 | fail R1 | 31.0 s |
| `fail_r1_cast_to_json` | column turned into a range type with a cast to json that shows only the old text; the stored value gains the item name (F1) | fail R1 | fail R1 | 8.5 s |
| `fail_r1_default_fill` | add a `not null default false` column | fail R1 | fail R1 | 8.3 s |
| `fail_r1_delete` | delete the canary rows | fail R1 | fail R1 | 8.2 s |
| `fail_r1_drop_column` | drop a column | fail R1 | fail R1 | 8.2 s |
| `fail_r1_drop_table` | drop a table with rows | fail R1 | fail R1 | 8.6 s |
| `fail_r1_json_rewrite` | rewrite a `json` value's text and an array's lower bound (F9, C7) | fail R1 | fail R1 | 9.0 s |
| `fail_r1_reference_update` | update a reference row present in both runs | fail R1 | fail R1 | 7.5 s |
| `fail_r1_rename_column` | rename a column (fail closed) | fail R1 | fail R1 | 8.1 s |
| `fail_r1_truncate` | truncate | fail R1 | fail R1 | 8.2 s |
| `fail_r1_type_change` | `integer` to `text` (value text changes) | fail R1 | fail R1 | 9.2 s |
| `fail_r1_update` | update canary rows | fail R1 | fail R1 | 8.9 s |
| `fail_r2_copy_existing` | insert-select copy into an existing table | fail R2 | fail R2 | 8.8 s |
| `fail_r2_masked_existing_table` | a reference row whose timestamp encodes data, next to a `now()` row, in a table whose earlier rows have a volatile timestamp (F5) | fail R2 | fail R2 | 9.0 s |
| `fail_r2_sequence_setval_false` | `setval(..., false)` with a value derived from data (F3) | fail R2 | fail R2 | 8.7 s |
| `fail_r2_sequence_signal` | `nextval` once per canary row, no row change | fail R2 | fail R2 | 8.9 s |
| `fail_r3_comment_from_data` | table comment built from rows | fail R3 | fail R3 | 8.8 s |
| `fail_r3_copy_new_table` | `create table ... as select` | fail R3 | fail R3 | 9.1 s |
| `fail_r3_ddl_depends_on_data` | create a table only if rows exist | fail R3 | fail R3 | 9.2 s |
| `fail_r3_extension_member` | a function body built from data, made a member of a `pg_tle` extension (F2) | fail R3 | fail R3 | 9.4 s |
| `fail_r3_masked_copy_new_table` | `coalesce(<names>, gen_random_uuid())` into a new table (F5) | fail R3 | fail R3 | 9.4 s |
| `fail_r3_matview` | materialized view over canary rows | fail R3 | fail R3 | 9.0 s |
| `fail_r3_missing_value` | `add column ... default <data>`, then `drop default` (`attmissingval`, F4) | fail R3 | fail R3 | 8.9 s |
| `fail_r3_role_from_data` | create a role only if rows exist | fail R3 | fail R3 | 8.6 s |
| `fail_r4_auth_user_update` | update the Auth canary users | fail R4 | fail R4 | 6.2 s |
| `fail_r4_large_object` | copy rows into a large object | fail R4 | fail R4 | 8.1 s |
| `fail_r4_replication_slot` | a physical replication slot named from data (F4) | fail R4 | fail R4 | 9.4 s |
| `fail_r4_role_password` | a role whose md5 verifier carries data (F4) | fail R4 | fail R4 | 9.2 s |
| `fail_r4_sequence_outside` | `nextval` on a sequence outside `public`/`private` per row | fail R4 | fail R4 | 8.9 s |
| `fail_r4_sequence_setval_outside` | `setval(..., false)` outside `public`/`private` (F3) | fail R4 | fail R4 | 9.6 s |
| `fail_r4_storage_bucket` | create a Storage bucket | fail R4 | fail R4 | 6.2 s |
| `fail_r5_fixture_sequence` | fixture without explicit identity value | fail R5 | fail R5 | 6.8 s |
| `fail_r6_missing_fixture` | new table, no fixture | fail R6 | fail R6 | 6.1 s |
| `fail_r6_null_column` | a column null in every row | fail R6 | fail R6 | 6.6 s |
| `fail_r7_base_fixture_hygiene` | a base fixture with an address outside `example.test` (C3) | fail R7 | fail R7 | 4.1 s |
| `fail_r7_canary_only_error` | a check constraint that only canary rows violate | fail R7 | fail R7 | 7.8 s |
| `fail_r7_event_trigger` | a login event trigger (F6) | fail R7 | fail R7 | 8.2 s |
| `fail_r7_fixture_changes_schema` | a fixture that creates a function | fail R7 | fail R7 | 6.5 s |
| `fail_r7_fixture_not_test_marked` | a fixture row with `is_test = false` | fail R7 | fail R7 | 6.8 s |
| `fail_r7_sql_error` | a syntax error | fail R7 | fail R7 | 1.2 s |
| `fail_r7_untrusted_base_type` | a `pg_tle` base type whose output function hides part of the value (found while fixing) | fail R7 | fail R7 | 9.8 s |
| `pass_add_nullable_column` | nullable column plus a fixture row that fills it | pass | pass | 10.4 s |
| `pass_exception_dropped_table` | a table with a coverage exception that the next migration drops (C5) | pass | pass | 8.2 s |
| `pass_index_policy_function` | index, policy, function, trigger, comment, grant | pass | pass | 8.2 s |
| `pass_new_table` | identity table, explicit fixture ids, a reasoned coverage exception | pass | pass | 6.6 s |
| `pass_reference_rows` | more reference rows (random ids and timestamps masked), an identity reference table | pass | pass | 8.4 s |
| `pass_role_fallback` | a migration that creates a role (dropped again between runs instead of a reset) | pass | pass | 7.2 s |
| `pass_value_preserving_changes` | wider type, satisfied constraint, enum, new schema with an empty table, sequence, column comment | pass | pass | 8.6 s |
| `pass_view` | a view and a materialized view of constants | pass | pass | 8.5 s |

Unit tests of the pure logic (`tests/ci/db-canary.test.mjs`, `node:test`, no Docker; part of `npm run test:ci`): 44 tests, all passing (option and input parsing, version parsing, snapshot parsing and fail-closed cases, sequence states, multiset diff, JSON-null handling, masks per step and per group with shapes, every rule evaluator, within-run state, schema comparison and dump normalization, coverage and exceptions, the command line's exit codes, helpers). Reverting each review-round fix in a scratch copy of the script makes at least one of them fail (18 of 18 such mutants killed).

## 7. Real-world run: PR 1.3's first migration

In a scratch copy (not in the PR 1.3 worktree): this branch's script and base rows, PR 1.3's `20261104120000_access_and_permissions.sql` unchanged (at PR 1.3's commit `9229949`, newer than the copy the first version used; the draft fixture needed no change), and a **draft fixture** `tests/db-canary/20261104120000.sql` for its six tables (three Auth users behind three profiles: an active Manager, an active Technician and a deactivated Customer Service account; a technician profile; a pending role change and a rejected creation request; two chained audit rows with explicit identity values). All rows fictional, `is_test = true`, `example.test`. The fixture is to be added to PR 1.3 together with three coverage exceptions for `public.role_permissions` (`approved_by`, `approved_at`, `updated_by`): every (role, key) pair is a reference row of the migration, the primary key leaves no room for a canary row, and the one-way rule (D47) forbids a reference row to name a test profile.

**Result: PASS** (75.5 s, reset mode as in CI): 1 migration, 1 fixture; 60 relations and 341 rows in the final canary snapshot (6 tables and 47 rows in `public`/`private`); masked volatile column `public.role_permissions(updated_at)` at migration 1; coverage 6 tables, 64 columns, 3 exceptions.

Mutant second migrations, each added after PR 1.3's migration, run in reset mode with the final script (15 of 15 fail with the expected rule; exit code 1 each; 68 to 70 s per run). The last five are the review round's bypasses rebuilt on PR 1.3; with the first version of the script each of them passed (reviewer logs).

| Mutant | Expected | Result | Time |
|---|---|---|---|
| `update public.profiles set full_name = ... where is_test` | R1 | fail R1: canary run, public.profiles: 3 existing row(s) changed or removed | 68.5 s |
| `delete from public.audit_logs where target_is_test` | R7 | fail R7: canary run (it passed in the reference runs, so it fails only with canary rows present): SQL error: psql:<stdin>:2: ERROR: audit_logs is append-only \|… | 67.7 s |
| the same delete with the trigger disabled around it | R1 | fail R1: canary run, public.audit_logs: 2 existing row(s) changed or removed | 69.7 s |
| `create table public.profile_copy as select ... from public.profiles` | R3 | fail R3: public.profile_copy: new table holds different rows in the runs (reference run 0, canary run 3) | 70.2 s |
| drop the role check, insert a `role_permissions` row derived from profiles | R2 | fail R2: public.role_permissions: rows added differ between the runs (reference run added 0, canary run added 1) | 68.2 s |
| `add column display_label`, then `update ... set display_label = full_name` | R1 | fail R1: canary run, public.profiles: 3 existing row(s) changed or removed (or a new column display_label was filled on it) | 69.8 s |
| audit rows derived from profiles (identity ids) | R7 | fail R7: canary run (it passed in the reference runs, so it fails only with canary rows present): SQL error: psql:<stdin>:2: ERROR: audit_logs: ids must follow… | 68.2 s |
| audit rows derived from profiles (explicit ids) | R2 | fail R2: public.audit_logs: rows added differ between the runs (reference run added 0, canary run added 1) | 67.7 s |
| `update auth.users set raw_app_meta_data = ... \|\| '{"role": "creator"}'` | R4 | fail R4: canary run, auth.users: 5 row(s) added or changed, 5 row(s) removed or changed | 70.0 s |
| a comment on `public.profiles` built from the profiles' names | R3 | fail R3: schema after the migration differs between the runs (data written into the schema): the schema dump differs at line 2761: reference run "COMMENT ON … | 69.7 s |
| review F1: cast to json on a new range type, `technicians.device_label` rewritten with Auth e-mails and password hashes | R1 | fail R1: canary run, public.technicians: 1 existing row(s) changed or removed | 70.0 s |
| review F5: `role_permissions` row whose `updated_at` encodes profile names, next to a `now()` row | R2 | fail R2: public.role_permissions: rows added differ between the runs (reference run added 2, canary run added 2) | 69.8 s |
| review F2: function body from Auth e-mails as a member of a `pg_tle` extension | R3 | fail R3: schema after the migration differs between the runs (data written into the schema): the schema dump differs at line 4063: reference run " AS $$selec… | 68.8 s |
| review F4: role password verifier built from Auth e-mails | R4 | fail R4: reference run: a role password, replication slot or replication origin was set, changed or removed (a migration never carries a password; a slot keeps… | 67.9 s |
| review F3: `setval(audit_logs_id_seq, 1000 + count(profiles), false)` | R2 | fail R2: sequence(s) changed differently in the runs (data-dependent nextval or setval): public.audit_logs_id_seq (reference run unused -> 1000 (not called),… | 69.1 s |

## 8. Limits (stated honestly)

- **Environment detection (the main limit):** a migration can tell the harness apart and write only outside it: the `psql` application name, the missing `supabase_migrations.schema_migrations` table (the harness applies migrations with `psql`, the CLI records them there), the fixed canary ids and `example.test` addresses, an otherwise empty database, the time. Reviewers showed passing examples of each (`a26`, `p06`, the CI lens's history-table probe). Applying migrations through `supabase migration up` would remove the history-table and application-name signals but not the canary rows themselves, so it was not adopted; the check is documented as a tripwire for accidental writes, and the guard plus independent review remain the defence against a migration written to evade it.
- **Predicates that exclude the canary rows:** a write limited to rows the fixtures never contain (a real company domain, a specific id, `is_test = false`) is invisible. The guard forbids UPDATE and DELETE in migrations, and review covers the rest. See owner question 1.
- **Deferred effects:** a function, trigger, rule, policy or default created by a migration that changes data later, when the application calls or fires it, is not executed by the migration. pgTAP tests and review cover those. Event triggers, which fire on logins or DDL without any application call, are refused (R7).
- **Masked volatile columns:** a value of the same shape (hexadecimal and digit runs, for example a timestamp or UUID computed from data while the reference runs produce random ones) written into a column that is volatile in the same row group of the same migration step is hidden, as long as row counts and null-ness stay the same. Masks are per migration step and row group, and printed on every run so a reviewer sees them.
- **Bookkeeping tables:** anything in an excluded table would be invisible; the list is empty today.
- **The first migration** has no earlier tables in `public` or `private` to protect; R4 still covers Auth, Storage and the other schemas from the first migration on, and R2/R3 compare its reference rows across runs.
- **Not compared:** effects outside the database (network calls made through extensions, files), planner statistics and object ids (OIDs: a migration could make later OIDs depend on data by creating objects in a loop; nothing stores them as data). Role passwords, replication slots and origins are compared within each run only (they differ between resets on their own), which catches any change a migration makes to them.
- **Types with hiding output functions:** values are read through output functions. A base type whose output function hides part of the stored value can only be created by a superuser, or by `pg_tle`'s `create_base_type`; the second fails the check (R7) as soon as such a type exists.
- **Legitimate changes that fail by design:** a non-null default or a generated column on an existing table, a column rename, a materialized view populated from existing rows (create it `WITH NO DATA` instead), a Storage bucket or a cron job created by a migration, an extension that ships reference rows (`postgis` fills `extensions.spatial_ref_sys`: R4, reviewer case `l17_postgis`), an event trigger, a role password. They need an explicit, owner-approved way forward when one is needed (owner question 2).
- **Fixture and harness discipline:** fixtures are trusted to be written against their own migration and never edited after merge; the check enforces that they only add test-marked rows and do not change the schema, not when they were written. The script, the fixtures, the exceptions file and the self-test are the PR's own copies, and none of them is a protected file today: a PR that adds a migration could also weaken them (owner question 4).

## 9. Owner questions (temporary behaviour until answered)

1. **Real-marked fictional rows in the throwaway CI database?** The canary fixtures contain test-marked rows only, so a write filtered on `is_test = false` is invisible to the canary (the guard forbids UPDATE and DELETE anyway). Should the fixtures also contain fictional rows marked as real, in the throwaway CI database only (the same question as PR 1.3 Q3 on D49/D47)? **Default until answered: test-marked only** (the fixture check rejects `is_test = false`).
2. **When a legitimate migration fails by design** (for example a new column with a non-null default on a table with rows, a Storage bucket, `postgis`, an event trigger): should it go through (a) a per-migration exception file that you approve, or (b) a split into a nullable column plus a separately approved backfill? **Default: the check fails; decide when the first case comes.**
3. **CI minutes:** the self-test adds about 7.0 minutes to every run of the `Database tests` workflow (which runs only when database files change). **Default: run it every time** (it also proves that the CLI, image and runner still behave as measured).
4. **Protect the check's own files?** (review round 1, F8 and the CI lens's F3) Today a PR that adds a migration may, in the same PR and without owner approval, edit `scripts/db-canary.mjs`, `tests/db-canary/` (base rows, earlier fixtures, `coverage-exceptions.json`), `tests/db-canary-selftest/` and `scripts/check-migrations.mjs`, and so turn a failing migration into a pass (the CI lens showed it with a trimmed `000_base.sql`). Proposal: add these paths to the files whose weakening needs your approval (`CLAUDE.md` D53 list and `docs/security.md`), and later add a CI step that fails when an already-merged fixture or `000_base.sql` changes or `coverage-exceptions.json` gains an entry (it needs the base commit, which the database workflow does not fetch today). Changing `CLAUDE.md` is your decision, so this PR does not do it. **Default until answered: treat any change to these paths in a migration PR as needing an independent review that names it.**

## 10. Reproduce locally

```bash
supabase stop                     # if other services of the project run
supabase db start                 # the database only
node scripts/db-canary.mjs --selftest tests/db-canary-selftest
node scripts/db-canary.mjs
supabase db reset                 # afterwards: your migrations back
npm run test:ci                   # unit tests, no Docker
```

## 11. Review round 1

Three independent reviewers looked at the first version through three lenses: **bypass** (adversarial migrations, 27 attacks and 18 legitimate migrations on top of PR 1.3), **CI** (workflow, protection, secrets) and **correctness** (claims, determinism, 50 code mutants). Each must and should finding was reproduced first: the reviewers' cases were run with the first version of the script (`22` cases, `5` as expected, every bypass passed) and again after the fixes (section 6 and below). Ids are the reviewers' own; the bypass and CI lenses both used `F` numbers.

"Self-test" names a case in `tests/db-canary-selftest/`; "unit" names a test in `tests/ci/db-canary.test.mjs`. Every unit test listed fails when its fix is reverted (one scratch mutant per fix, all 18 killed); every new self-test case listed gives a mismatch with the first version of the script (13 of the 14; `fail_r7_base_fixture_hygiene` guards an existing check and matches with both, section 6).

| Id | Lens | Severity | Outcome | Test |
|---|---|---|---|---|
| F1 | bypass | must | **Fixed.** Values are read through each type's output function (`format('%s')`), not `to_jsonb`, so a user-defined cast to json changes nothing; the JSON category of built-in types is kept. | Self-test `fail_r1_cast_to_json`; unit "the snapshot reads values through output functions, never to_jsonb or a cast"; reviewer cases `a01` (now R3) and `a02` (now R1); PR 1.3 mutant `m9` (R1, reset mode). |
| F2 | bypass | must | **Fixed.** The schema dump is `pg_dump --schema-only --binary-upgrade` (extension members and their comments, stored column defaults), with object ids, transaction ids and sequence states normalized. Event triggers of superuser-owned extensions are not counted by the new event-trigger rule, so creating `pg_tle` itself does not fail; base types made with `pg_tle` do (see "Found while fixing"). | Self-test `fail_r3_extension_member`, `fail_r3_missing_value`; unit "binary-upgrade object ids, transaction ids and sequence states become placeholders"; reviewer cases `a07`, `a24` (now R3); PR 1.3 mutant `m11` (R3). |
| F3 | bypass | should | **Fixed.** Each sequence's `last_value`, `is_called` and start value are read from the sequence itself; `setval(..., false)` and `RESTART` are visible to R2, R4 and R5. | Self-test `fail_r2_sequence_setval_false`, `fail_r4_sequence_setval_outside`; unit "sequence state: unused is null; setval(..., false) and RESTART stay visible"; reviewer cases `a03`, `a04`; PR 1.3 mutant `m13` (R2). |
| F4 | bypass | should | **Fixed.** `attmissingval` is in the binary-upgrade dump (R3); role passwords, replication slots and origins are hashed and compared within each run (R4); the docs no longer say passwords cannot carry data. | Self-test `fail_r3_missing_value`, `fail_r4_role_password`, `fail_r4_replication_slot`; unit "within one run: a password, slot or origin change is R4"; reviewer cases `a15`, `a16`, `a17`; PR 1.3 mutant `m12` (R4). |
| F5 | bypass | should | **Fixed.** Masks are computed per migration step from the rows that step adds (per snapshot point for the determinism check), refined per group of rows, values equal in A1 and A2 must reappear in B, and a masked value keeps its shape. Writing same-shape data (a timestamp or UUID computed from data) into a column that is volatile in the same row group remains a documented limit. A first fix with per-step masks only still passed `a06` (its data row is added next to a `now()` row); the row groups close that. | Self-test `fail_r2_masked_existing_table`, `fail_r3_masked_copy_new_table`; unit "masks are per migration step", "masks are per group of rows", "masking keeps the value's shape"; reviewer cases `a05` (now R3), `a06` (now R2); PR 1.3 mutant `m10` (R2). |
| F6 | bypass | should | **Fixed in part, rest documented.** The docs call the check a tripwire and name environment detection as the main limit (testing.md, section 8). A migration that adds, changes or removes an event trigger now fails (R7). `application_name` was left as is: the canary rows themselves remain detectable, so hiding one signal would not close the class. | Self-test `fail_r7_event_trigger`; unit "an event trigger change R7"; reviewer case `a28` (now R7); `a26` still passes (documented limit). |
| F7 | bypass | must | **Deferred to the owner / orchestrator (git history).** The pushed checkpoint commit `a9e7980` holds a fictional JWT-shaped test literal; the working tree no longer does (the test builds it at run time). The branch has to be rebuilt without that commit (for example one commit on `bcaa885`) and the feature branch force-pushed or deleted; this fix pass changes no git state. The WORKLOG no longer names the commit. | Read-only check: `git branch -a --contains a9e7980` lists the local and remote feature branch; the working tree has no token-shaped string (Gitleaks `dir` scan, section 6). |
| F8 | bypass | should | **Deferred: owner decision** (owner question 4). Making the check's files protected means changing the D53 list in `CLAUDE.md` and `docs/security.md`, which is the owner's call; an immutability step for merged fixtures needs the base commit in the database workflow. | None (governance). |
| F9 | bypass | nit | **Fixed** by F1: output text keeps array lower bounds and `json` text. | Self-test `fail_r1_json_rewrite` (array bound and json text); reviewer case `a08` (now R4). |
| F10 | bypass | nit | **Documented** as a by-design failure (an extension that ships reference rows, `postgis`). No exemption: rows added by `CREATE EXTENSION` outside `public` and `private` are exactly what R4 watches. | Reviewer case `l17_postgis` (R4, as documented). |
| F11 | bypass | nit | **Fixed.** The untracked `node_modules` symlink was removed from the worktree after the last local test run (recreate it locally if needed; never stage it). `.gitignore` is outside this task's files. | `git status --short` shows no `node_modules`. |
| F1 | CI | must | **Deferred** (same as bypass F7). The CI lens adds that `ci.yml` fetches every branch (`fetch-depth: 0`) and scans all refs, so the Secret scan fails on every branch's CI while any remote branch contains `a9e7980`. Fix: rebuild the branch, force-push or delete it (never `main`), `git fetch --prune`, re-run the full-history scan. No `.gitleaksignore` entry. | As bypass F7. |
| F2 | CI | should | **Documented** (same class as bypass F6 and C4). Applying migrations through `supabase migration up` was considered and not adopted (section 8). | Reviewer probe (history-table detection) still passes: documented limit. |
| F3 | CI | should | **Deferred: owner decision** (owner question 4, same as bypass F8). | None (governance). |
| F4 | CI | nit | **Measured and adjusted.** The self-test now has 49 cases and took 419.1 s locally; its step limit was raised from 10 to 15 minutes (comment in the workflow) to keep about a 2x margin; the job limit stays 20 minutes. The hosted-runner time is still to be read from the PR's first CI run (C10). | Section 5. |
| F5 | CI | nit | **Fixed** (same as bypass F11). | As bypass F11. |
| F6 | CI | nit | **Fixed.** Row samples in violation messages go through `redact()`. | Unit "violation samples are redacted like every other message". |
| C1 | correctness | must | **Deferred** (same as bypass F7). | As bypass F7. |
| C2 | correctness | should | **Fixed** (same as bypass F3). | Self-test `fail_r2_sequence_setval_false`, `fail_r4_sequence_setval_outside`; reviewer probes `p01` (now R2), `p02` (now R4). |
| C3 | correctness | should | **Fixed for the exit code and the self-test comparison; the rest covered or explained.** The command line is tested as a child process (failure exits 1, usage error 2); the self-test's comparison is `caseMatches` (unit-tested); the empty-state check is `emptyStateProblem` (unit-tested); the base-fixture check has a self-test case; the materialized-view and "before" sequence branches are kept with a comment and a unit test each. Not test-covered: the call sites of the fresh A1-against-B schema comparison, the clone's property comparison and the server-version check across a reset: they guard against a broken environment and would need a fault-injection hook in the script, which it deliberately does not have. | Unit "CLI: a failing check exits 1 and a usage error 2, also through a symlinked path" (kills m44), "self-test cases match on outcome, rule and message fragment" (m45), "empty database state" (m36 logic), "a materialized view emptied WITH NO DATA" (m06), "sequences that differ already before the migration" (m49); self-test `fail_r7_base_fixture_hygiene` (m40). |
| C4 | correctness | should | **Documented** (same class as bypass F6): testing.md, section 8 and the WORKLOG name environment-dependent migrations as a limit. | Reviewer probe `p06` still passes: documented limit. |
| C5 | correctness | should | **Fixed.** The exceptions file is global; an entry is stale only when it matches no step (`unusedExceptions`). Documented in `tests/db-canary/README.md`. | Self-test `pass_exception_dropped_table`; unit "coverage exceptions are global"; reviewer probes `p04` (now pass), `p04b` (still R6). |
| C6 | correctness | should | **Fixed.** The script compares real paths, so a symlinked path runs `main()`. | Unit "CLI: ... also through a symlinked path". |
| C7 | correctness | nit | **Fixed** by F1. | Self-test `fail_r1_json_rewrite`; reviewer probe `p03` (now R1). |
| C8 | correctness | nit | **Fixed.** Schema differences skip comment and blank lines and report a line present on one side only as such. | Unit "the difference names the changed statement, not an unrelated comment header". |
| C9 | correctness | nit | **Fixed.** Removed `planFixtures`' `allowReadme` option, `CanaryError.violations` and `coverageStats().gaps`; the materialized-view branch and the "before" half of the R2 sequence check stay on purpose, each with a comment and a unit test (C3). | Unit tests named under C3. |
| C10 | correctness | nit | **Deferred to the first CI run** (cannot be measured from here): record the hosted-runner step times in this file. A timeout fails closed. | None yet. |
| C11 | correctness | nit | **Fixed** (same as bypass F11). | As bypass F11. |
| C12 | correctness | nit | **Fixed.** The fixture README and PROJECT-MAP describe when a fixture is needed by rule R6, the exceptions file as global, and the self-test fixtures now use identity values from 1000000 up like the README asks. | Self-test `pass_new_table` (ids 1000001, 1000002). |

**Found while fixing (not in the reviews):**
- `pg_tle` (preloaded in the image) lets `postgres` create a base type with `pgtle.create_base_type`, whose output function is ordinary code: a type that shows only part of a stored value would hide data from the output-function snapshot. Any base type not owned by a superuser now fails (R7). Self-test `fail_r7_untrusted_base_type`; unit "within one run ... base type".
- Creating `pg_tle` adds an event trigger that belongs to the (superuser-owned) extension; event triggers of superuser-owned extensions are not counted, so the event-trigger rule does not block `pg_tle` itself.
- The binary-upgrade dump also holds each sequence's `setval`; it is normalized there and compared by the sequence rules, so a data-dependent sequence keeps failing R2/R4 (not R3).

**Reviewer cases, before and after** (clone mode; their own migrations on top of the PR 1.3 migration they used, with the draft fixture; logs under the scratchpad): 5/22 as expected with the first version, 22/22 after the fixes. "Expected now" is the outcome the fixed check should give; `a26` and `p06` are the documented environment-detection limit and still pass.

| Case | Finding | What it does | First version | After the fixes | Expected now |
|---|---|---|---|---|---|
| `a01_cast_new_table` | bypass F1 | cast to json, copy into a new table | pass | fail R3 | fail R3 |
| `a02_cast_update_existing` | bypass F1 | cast to json, existing technician row rewritten | pass | fail R1 | fail R1 |
| `a03_sequence_setval_false` | bypass F3 | `setval(..., false)` on `audit_logs_id_seq` | pass | fail R2 | fail R2 |
| `a04_sequence_outside_setval_false` | bypass F3 | `setval(..., false)` on `auth.refresh_tokens_id_seq` | pass | fail R4 | fail R4 |
| `a05_masked_volatile_new_table` | bypass F5 | `coalesce(<emails>, gen_random_uuid())` into a new table | pass | fail R3 | fail R3 |
| `a06_masked_existing_table` | bypass F5 | `role_permissions` row whose `updated_at` encodes data, next to a `now()` row | pass | fail R2 | fail R2 |
| `a07_pgtle_extension_member` | bypass F2 | function body from data as a `pg_tle` extension member | pass | fail R3 | fail R3 |
| `a08_array_bounds_bucket` | bypass F9 | array lower bound on the canary bucket | pass | fail R4 | fail R4 |
| `a15_role_password_data` | bypass F4 | role password verifier from data | pass | fail R4 | fail R4 |
| `a16_replication_slot` | bypass F4 | replication slot named from data | pass | fail R4 | fail R4 |
| `a17_attmissingval` | bypass F4 | `attmissingval` holding the emails | pass | fail R3 | fail R3 |
| `a24_pgtle_member_comment` | bypass F2 | comment from data on an extension member | pass | fail R3 | fail R3 |
| `a26_env_detect_application_name` | bypass F6 | writes only when `application_name` is not `psql` | pass | pass | pass |
| `a28_login_event_trigger` | bypass F6 | login event trigger | pass | fail R7 | fail R7 |
| `l17_postgis` | bypass F10 | `create extension postgis` (legitimate) | fail R4 | fail R4 | fail R4 |
| `p01_setval_false_public` | correctness C2 | `setval(..., false)` in `public` | pass | fail R2 | fail R2 |
| `p02_setval_false_outside` | correctness C2 | `setval(..., false)` outside `public`/`private` | pass | fail R4 | fail R4 |
| `p03_json_rewrite` | correctness C7 | `json` text rewritten | pass | fail R1 | fail R1 |
| `p04_stale_exception_after_drop` | correctness C5 | exception for a table dropped later | fail R6 | pass | pass |
| `p04b_no_exception_table_dropped` | correctness C5 | the same without the exception | fail R6 | fail R6 | fail R6 |
| `p05_matview_no_data` | correctness C9 | materialized view emptied | fail R1 | fail R1 | fail R1 |
| `p06_env_detect` | correctness C4 | deletes only when no `example.test` users exist | pass | pass | pass |
