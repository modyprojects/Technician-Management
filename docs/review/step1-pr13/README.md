# Step 1 / PR 1.3 — Migration 1 (access and permissions): test report

**Status (2026-11-04): prepared and tested locally only. Not applied to any Supabase project.** Nothing contacted the remote project (no MCP Supabase tool, no `link`, no `--linked`/`--project-ref`); `supabase/config.toml` is unchanged. Two independent reviews (security, and design conformance; D53) were done on the first version; their findings and what the fix pass did with each are in section 12. An independent re-review (security, and the migration guard) of that fix pass (`e843e1e`) found no privilege escalation for an API role but six security findings (R-S1 to R-S6) and eleven guard findings (R-G1 to R-G11); the second fix pass and its disposition of each finding are in section 14. **The second fix pass (binding nonce, guard rewrite, single-statement rollback, self-contained anchor check) and fix round 1 (guard rules N1–N3, documentation N4; section 14) have not been reviewed independently yet; D53 requires that before merge.** Applying the migration needs, in this order: the owner's D50 Auth settings change, an owner-approved read-only check of the remote (Q9), then the owner's separate migration approval (D52 rule 4, D53).

## 1. Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261104120000_access_and_permissions.sql` | The migration (one file) |
| `supabase/rollback/20261104120000_access_and_permissions.down.sql` | Down script (never applied by the CLI); refuses to run once data exists |
| `tests/db/000_smoke.test.sql` | Edited: census exemptions `permissions`, `role_permissions` |
| `tests/db/010_hardening.test.sql` … `090_helpers_rls.test.sql`, `990_rollback.test.sql` | New pgTAP tests |
| `tests/db/065_audit_anchor.test.sql` | New (re-review R-S4): the self-contained anchor check detects tampering after the in-database verification functions were replaced |
| `scripts/check-migrations.mjs`, `tests/ci/check-migrations.test.mjs` | Migration guard: a PostgreSQL-aligned tokenizer and rules 1–8 (section 8) |
| `tests/ci/rollback.test.mjs` | Every migration has a down script that is one DO block refusing first; `tests/db` runs byte-identical copies |
| `docs/review/step1-pr13/audit-anchor-check.sql`, `tests/ci/audit-anchor-check.test.mjs` | Self-contained audit anchor check (section 9); `065` runs a byte-identical copy; the node test proves it names nothing in `private` |

## 2. Objects the migration creates (for the apply approval)

Applied as `postgres` in one transaction; it refuses any other role.

- **Privilege changes (first statements, and again at the end):** revoke ALL on all tables, sequences and functions in `public` from `PUBLIC`, `anon`, `authenticated`, `service_role`; revoke `CREATE` on schema `public` from the same; `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` revoke ALL on tables, sequences and functions from the same; `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` (global) revoke EXECUTE on functions from `PUBLIC`. At the end: revoke ALL on all tables, sequences and functions in `public` and `private` again, then the explicit grants below.
- **Schema:** `private` (owner `postgres`; USAGE for `authenticated` only).
- **Tables (6), RLS enabled on each:** `public.profiles`, `public.technicians`, `public.permissions`, `public.role_permissions`, `public.account_requests`, `public.audit_logs` (identity sequence `public.audit_logs_id_seq`). 68 constraints (keys, foreign keys all `ON DELETE RESTRICT`, `CHECK`s) and 21 indexes, among them the partial unique indexes `account_requests_one_pending_per_target` and `account_requests_one_open_create_per_email`.
- **Trigger functions (11, `private`, SECURITY INVOKER, no grants):** `tg_bump_version`, `tg_immutable_markers`, `tg_reject_update_delete`, `tg_reject_delete`, `tg_reject_truncate`, `tg_one_way_people`, `tg_profile_guard`, `tg_technician_guard`, `tg_account_request_guard`, `tg_audit_target`, `tg_audit_chain`; **29 triggers** on the six tables (version, immutable markers, one-way rule, no DELETE, append-only, BEFORE TRUNCATE on all six, guards, audit target and chain).
- **Internal functions (`private`, no grants):** `audit_row_hash`, `write_audit`, `audit_chain_verify(anchor_id, anchor_row_hash)` (owner only), `require_caller`, `bootstrap_first_creator(uid, full_name)` (owner only, never run, D49).
- **Helpers (`private`, SECURITY DEFINER, EXECUTE for `authenticated`):** `is_active_user`, `has_role`, `is_creator`, `is_office_user`, `has_permission`, `my_technician_id`.
- **RPC bodies (`private`, SECURITY DEFINER, 14):** `admin_set_role_permission`, `admin_approve_role_permission` (**no grant**, TEMPORARY, Q6), `assert_can_manage`, `assert_can_change_credentials`, `authorize_account_creation`, `admin_create_profile`, `admin_set_user_role`, `admin_set_user_active`, `admin_update_profile`, `admin_create_technician`, `admin_update_technician`, `request_account_change`, `decide_account_request`, `cancel_account_request`.
- **Public API (`public`, SECURITY INVOKER, 18):** a thin wrapper with the same name and arguments for each of the 14 bodies, `has_permission`, `is_creator`, `my_technician_id`, and `test_data_census()`.
- **RLS policies (12, all SELECT, all `TO authenticated`):** `profiles_select_own`, `profiles_select_creator`, `profiles_select_manager`, `technicians_select_own`, `technicians_select_office`, `permissions_select_office`, `role_permissions_select_creator`, `role_permissions_select_own_role`, `account_requests_select_creator`, `account_requests_select_requester`, `audit_logs_select_creator`, `audit_logs_select_manager`.
- **Grants:** SELECT on the six tables to `authenticated`; EXECUTE to `authenticated` on 36 functions (17 public wrappers, `test_data_census`, the 6 helpers and 12 private RPC bodies; not `admin_approve_role_permission`). Nothing for `anon`, `service_role` or `PUBLIC`.
- **Rows:** the 13 D33 permission keys and the 26 D33 default values, all `value_status = 'temporary'` (D51). No other rows: no test data, no user, no Creator.

## 3. ER diagram (actual columns)

```mermaid
erDiagram
  AUTH_USERS ||--o| PROFILES : "id (RESTRICT)"
  PROFILES ||--o| TECHNICIANS : "profile_id, is_test (RESTRICT)"
  PROFILES ||--o{ ACCOUNT_REQUESTS : "requested_by, decided_by; target (target_profile_id, is_test)"
  PROFILES ||--o{ AUDIT_LOGS : "actor_profile_id"
  PROFILES ||--o{ ROLE_PERMISSIONS : "updated_by, approved_by"
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : "permission_key"
  PROFILES {
    uuid id PK "= auth.users.id"
    text role "technician | customer_service | manager | creator"
    text full_name "1-60, trimmed"
    text work_phone "nullable, pattern"
    text invitation_rep_name "nullable, UNIQUE"
    boolean is_active "default false"
    boolean is_test "default true; immutable; no test creator"
    timestamptz created_at
    uuid created_by "FK profiles"
    timestamptz updated_at
    uuid updated_by "FK profiles"
    integer version ">= 1, trigger"
  }
  TECHNICIANS {
    uuid id PK
    uuid profile_id "UNIQUE; Technician profile only"
    boolean is_test "= profile (composite FK)"
    text display_name "1-60"
    text color "pattern"
    text outlook_email "UNIQUE, lower-case; example.test if test"
    text device_label "nullable"
    boolean accepts_invitations "SE-05, never access"
    timestamptz created_at
    uuid created_by
    timestamptz updated_at
    uuid updated_by
    integer version
  }
  PERMISSIONS {
    text key PK "closed set of 13 (D33)"
    text label_he "TEMPORARY labels (SE-02)"
    text enforcement "data | screen, fixed per key"
    smallint sort_order "UNIQUE"
  }
  ROLE_PERMISSIONS {
    text role PK "manager | customer_service"
    text permission_key PK "FK permissions"
    boolean allowed "default false"
    text value_status "temporary | approved (D51)"
    uuid approved_by
    timestamptz approved_at
    timestamptz updated_at
    uuid updated_by
    integer version
  }
  ACCOUNT_REQUESTS {
    uuid id PK
    text request_type "create | activate | reactivate | role_change | direct_create"
    uuid target_profile_id "nullable"
    integer target_version "target's version at request time"
    text requested_role "customer_service | technician | manager (direct_create only)"
    text email "create kinds; example.test if test"
    text full_name
    uuid requested_by "FK profiles"
    timestamptz created_at
    text status "pending | approved | rejected | cancelled"
    uuid decided_by
    timestamptz decided_at
    text rejection_reason "required when rejected"
    boolean is_test "set by the server; immutable"
    timestamptz updated_at
    integer version
  }
  AUDIT_LOGS {
    bigint id PK "identity"
    timestamptz occurred_at "server time (trigger)"
    uuid actor_profile_id "NULL only for creator.bootstrapped"
    text action "closed set"
    text target_table "closed set"
    uuid target_id "NULL only for role_permissions"
    boolean target_is_test "from the target (trigger)"
    jsonb details "object, no emails"
    text prev_hash "UNIQUE"
    text row_hash "UNIQUE"
  }
```

## 4. Who can do what (PR 1.3 objects)

"RPC" = only through the named function; there is no direct INSERT, UPDATE or DELETE for any API role. Every row requires an active profile.

| Object / action | Creator | Manager | Customer Service | Technician | anon | service_role |
|---|---|---|---|---|---|---|
| `profiles` read | all | Technician and Customer Service profiles and his own | his own | his own | ✗ (no grant) | ✗ (no grant) |
| `technicians` read | all | all | with `cal` or `calls` | his own row | ✗ | ✗ |
| `permissions` read | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `role_permissions` read | all | Manager values | Customer Service values | ✗ | ✗ | ✗ |
| `account_requests` read | all | his own requests and creation intents | ✗ | ✗ | ✗ | ✗ |
| `audit_logs` read | all | his own actions; Technician and Customer Service accounts; technicians; his requests; never matrix rows | ✗ | ✗ | ✗ | ✗ |
| Change a matrix value | RPC (real Creator; CS `cancel` and `usage` locked) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Mark a matrix value approved | ✗ through the API (TEMPORARY, Q6; owner's database role only) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `has_permission(key)` | every key except `usage` (TEMPORARY, d13) | matrix | matrix | none | ✗ | ✗ |
| `assert_can_manage(role)` (pre-check, no audit) | any role | Technician, Customer Service | ✗ | ✗ | ✗ | ✗ |
| Authorize a creation (phase 1, audited) | Technician, Customer Service, Manager; never Creator | Technician only | ✗ | ✗ | ✗ | ✗ |
| Create the profile (phase 3) | against his own intent, or an approved Customer Service request | against his own intent | ✗ | ✗ | ✗ | ✗ |
| Change a role | RPC (not his own; never to Creator) | request only (CS ↔ Technician) | ✗ | ✗ | ✗ | ✗ |
| Deactivate | anyone but himself (last Creator locked) | Technician, Customer Service, immediately | ✗ | ✗ | ✗ | ✗ |
| Activate / reactivate | anyone but himself | Technician immediately; Customer Service by request | ✗ | ✗ | ✗ | ✗ |
| Update name, phone, alias | any account | Technician and Customer Service (not himself) | ✗ | ✗ | ✗ | ✗ |
| Create / update technician field profile | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Request a Customer Service change | ✗ (acts directly) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Decide a request | ✓ (refused when stale, Q17) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Cancel a request | his own pending ones; any approved creation not yet fulfilled | his own pending ones and his unfulfilled creations | his own (none exist) | his own (none exist) | ✗ | ✗ |
| Authorize a password or email change | ✓ (audited) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `test_data_census()` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `bootstrap_first_creator`, `audit_chain_verify`, `write_audit` | ✗ (owner's database role only) | ✗ | ✗ | ✗ | ✗ | ✗ |

A test user manages only test targets. Until go-live every new user is a test user (TEMPORARY); the first Creator is the only real-marked account.

**Supabase-managed readers (re-review R-S6).** Outside the API roles in this table, the Supabase-managed login roles `supabase_read_only_user` and `supabase_etl_admin` have `BYPASSRLS` and are members of `pg_read_all_data`: they can read all six tables, including `profiles` and `audit_logs`. They belong to the platform (read-only replicas, ETL) and sit inside the accepted owner-level boundary, like `postgres` and `supabase_admin`; nobody in the app can use them. `pg_write_all_data` has no members locally.

## 5. Two-phase account creation (§8.5, security.md §5, D34)

1. **Phase 1, under the caller's session, before any Auth Admin call, audited:**
   - Manager → Technician, Creator → Technician, Customer Service or Manager: `authorize_account_creation(role, email, full_name)` stores an approved `direct_create` row in `account_requests` (requested and decided by the caller) and writes `account_creation.authorized`.
   - Manager → Customer Service: `request_account_change('create', …)`, then the Creator's `decide_account_request(…, 'approve', …)` (both audited).
2. **Phase 2 (Step 2 server):** the Auth Admin API creates the Auth user with the secret key. It never inserts a profile.
2a. **The binding nonce (re-review R-S1):** the Step 2 server creates the Auth user with `app_metadata.account_request_id` set to the intent id that phase 1 returned (lower-case canonical UUID). Only the secret key can write `app_metadata`; a sign-up, another intent's Auth user or an Auth user made for a cancelled intent never carries the right value. **This is a Step 2 server requirement.**
3. **Phase 3, under the caller's session:** `admin_create_profile(uid, role, full_name, phone, alias, request_id)` binds the Auth user to the open intent: approved, not fulfilled, same role, same email, the same caller for a `direct_create` (the Creator for a Customer Service request, Q14), the Auth user's `app_metadata.account_request_id` equal to the intent id, the Auth user created after the authorization (no clock tolerance: a false refusal fails closed, and the intent is cancelled and authorized again), and the Auth user neither anonymous, SSO nor soft-deleted. Every binding failure returns the same `42501 not authorized`, so the call reveals nothing about Auth users or profiles.

An Auth user can be bound only through the intent it was created for: cancelling that intent and authorizing a new one for the same email (by anyone, the requester included) does not make it bindable (`040` and `050` test both orders the re-review found, R-S1 a and b). Only one creation per email can be open at a time (partial unique index; `020` proves the index alone refuses a second one, R-S5). An unfulfilled approved creation can be cancelled by its requester or the Creator, never by another Manager (`050`), so a failed Auth call never blocks the email for good. The binding no longer depends on D50 sign-up being off. No upper time limit on an intent is enforced (an Auth user still needs the nonce, which only the server sets); an intent lifetime would be a product rule (owner question Q16).

## 6. Hardening evidence (local database built from the migration)

Catalog queries run as `postgres` on the local stack after `supabase db reset --local --no-seed`:

```
-- Q1 relations in public and private: owner, ACL, RLS
public | account_requests  | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t
public | audit_logs        | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t
public | audit_logs_id_seq | S | postgres | {postgres=rwU/postgres}                               |
public | permissions       | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t
public | profiles          | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t
public | role_permissions  | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t
public | technicians       | r | postgres | {postgres=arwdDxtm/postgres,authenticated=r/postgres} | t

-- Q2 default privileges of postgres (pg_default_acl)
(global) | f | {postgres=X/postgres}
public   | f | {postgres=X/postgres}
public   | r | {postgres=arwdDxtm/postgres}
public   | S | {postgres=rwU/postgres}
storage  | f, r, S | unchanged Supabase defaults (Supabase-managed; Storage is Step 4, review S10)

-- Q3 schema ACLs
public  | owner pg_database_owner | USAGE for PUBLIC, anon, authenticated, service_role (kept for PostgREST); CREATE for the owner only
private | owner postgres          | {postgres=UC/postgres,authenticated=U/postgres}

-- Q4 functions in public and private (54: 18 public, 36 private) that each role can execute
anon 0 | authenticated 36 | service_role 0

-- Q5 SECURITY DEFINER functions: 20, all in private, owner postgres, search_path=""
-- Q6 policies: 12, all SELECT, all TO authenticated
-- Q7 test_data_census() on the fresh database: every count 0
profiles 0 | technicians 0 | account_requests 0 | audit_logs 0 | permissions exempt | role_permissions exempt | storage none
```

Before this migration the local database showed the PR 1.2 finding: `postgres` default privileges in `public` granted `anon`, `authenticated` and `service_role` full access to new tables (`arwdDxtm`), sequences (`rwU`) and functions (`X`). Q2 shows them revoked; `tests/db/010` creates a probe table, sequence, view and function in `public` and `private` and proves no API role gets any privilege. The default privileges of `supabase_admin` in `public` are still permissive; `postgres` cannot change them (section 10).

## 7. Tests (local, 2026-11-04, after fix round 1)

Commands: `node scripts/check-migrations.mjs`, `npm run test:ci`, `npm run lint`, `supabase db reset --local --no-seed`, `supabase test db tests/db`.

| File | Tests | Covers |
|---|---|---|
| `000_smoke` | 7 | PR 1.2 catalog checks (two census exemptions added) |
| `010_hardening` | 31 | Exact table grants, no write/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grants, no column grants, sequences, exact EXECUTE list for `authenticated`, nothing for `anon`/`service_role`/`PUBLIC`, approval function not executable (Q6), SECURITY DEFINER rules, empty `search_path` everywhere, no dynamic SQL, ownership, default privileges, schema USAGE/CREATE, policies, `ON DELETE RESTRICT`, no views, probe objects |
| `020_markers` | 48 | Defaults, immutable markers (also as `postgres`), composite foreign keys, `example.test`, no test Creator, the manager-role and direct-creation `CHECK`s, technician link, immutable creation fields, no promotion to Creator, last Creator, one-way rule (profiles, requests, matrix, technicians, audit), audit actor `CHECK`, request transitions (no cancel after an approved reactivation, cancel of an unfulfilled creation, no re-link, no cancel or unlink of a fulfilled one), the two partial unique indexes alone refuse a second open creation per email and a second pending request per account (R-S5), no deletes, Auth user delete restricted |
| `030_matrix` | 49 | Catalogue, 26 defaults all temporary, role `CHECK`, pending-decision locks, `has_permission` per role / deactivated / no profile / anon, Creator-only change with audit and immediate effect, version conflict, approval not executable through the API (Q6) and its rules as the owner's role, reset to temporary, a later key is denied, direct writes denied for authenticated, `service_role`, anon |
| `040_accounts` | 126 | `assert_can_manage` matrix; two-phase creation (audited intent before the Auth user, one open intent per email, generic errors, other caller's intent, role must match, nothing creates a Creator); the binding nonce (R-S1: missing, naming another intent, right nonce but wrong email, anonymous, SSO, soft-deleted, created an hour or 30 seconds before the authorization, an Auth user of a cancelled intent through a new intent and through the cancelled one); Customer Service and Technician callers of every account RPC; role change; (de)activation rules of D34 b/c; immediate revocation; credentials; direct writes denied for every role; profile and technician updates; generic duplicate-alias error; test Manager vs real Technician targets; Outlook-email audit (D34 f) |
| `050_account_requests` | 84 | Nothing changes while pending, forbidden requests, request stores the target version, RLS per role, Creator-only decisions, rejection reason, fulfilment of an approved create (nonce, email, role, request kind, once), pending create not fulfillable, stale approvals refused (account changed, requester left) but rejectable, cancellation by the requester, cancellation of an approved unfulfilled creation by the Creator, re-request afterwards; another Manager cannot cancel a Manager's or the Creator's approved creation (R-S5); an Auth user created for an approved request that the requester cancelled is not bound through his new intent (R-S1 b) |
| `060_audit` | 42 | Hash chain verifies; UPDATE/DELETE/TRUNCATE denied for authenticated and `service_role`, rejected by trigger even with grants and for `postgres`; truncate triggers on all six tables; naive tamper detected and restored; forged server fields overwritten; ids follow the chain; fork refused by `UNIQUE (prev_hash)`; anchoring: recomputed rewrite and deleted newest rows undetected without an anchor, detected with one; deleted middle row detected; who reads the audit |
| `065_audit_anchor` | 10 | The self-contained anchor check (section 9): it records the anchor and fingerprint; accepts the intact chain and a later row; after `private.audit_row_hash` is replaced and the chain rewritten, and after `private.audit_chain_verify` is replaced and every row deleted (R-S4), the in-database function is fooled and the self-contained check is not; a disabled append-only trigger is reported |
| `070_census` | 14 | Census 0; on the fresh database no rows in any table of `public`/`private` except 13 keys and 26 values, no Auth user, no Storage bucket; coverage equals the catalogue; exemptions; positive control; who may run it |
| `080_bootstrap` | 16 | Not run by the migration; no EXECUTE for API roles; refuses JWT claims; unknown user; existing profile; one real active Creator with audit; second run fails |
| `090_helpers_rls` | 39 | Helpers and reads per role (Creator, Manager, Customer Service, Technician A and B, inactive, no profile), forged JWT and metadata claims ignored, anon and `service_role`, data key enforcement on `technicians`, role change revokes immediately |
| `990_rollback` | 13 | The down script refuses to run with a profile present and drops nothing; then runs on the empty tables and leaves a clean catalogue with the hardening kept |
| **Total pgTAP** | **479** | All pass |
| `tests/ci` (node) | 45 | Migration guard 38 (4 added in fix round 1: N1 twice, N2, N3), rollback copies and structure 4, audit anchor check copy and structure 3 |

**Negative controls.** First version: granting `anon` SELECT on `profiles`, re-adding an `anon` default privilege on sequences, replacing `has_permission` with `true` and disabling the audit append-only trigger made 32 tests fail across 7 files. First fix pass: a committed one-row table in `public` made `070` fail; the first reviews' guard bypasses fail the guard (node tests). Second fix pass, each change applied inside the test file's transaction (pgTAP) or to a copy of the guard (node):
- R-S1: removing the nonce condition made 5 tests in `040` and 1 in `050` fail; restoring the one-minute tolerance made 1 fail (`040`); removing the anonymous, SSO and deleted checks made 3 fail (`040`).
- R-S5: dropping both partial unique indexes made 3 tests in `020` fail; letting anyone cancel an approved request made 4 fail in `050`; letting the request guard cancel or unlink a fulfilled creation made 2 or 3 fail in `020`. The fourth control the review named (the Creator-only condition for binding a `create` request) cannot be reached: the earlier `p_role` check already refuses a Manager; it stays as defense in depth, as S7 item 1 did.
- Guard: 22 mutants, one per control (EXECUTE, COPY, U&, RENAME, UPDATE forms, marker defaults, dollar quotes only as bodies, nested DO/definitions, string continuation, `\r` line ends, `b''`/`x''` strings, PostgreSQL whitespace, table pinning, signature pinning, BEFORE INSERT triggers, identifier truncation, header references, writer-body markers, bare-name references, ALLOWED_WRITERS names as writers, plain VALUES, `pg_temp`): each makes at least one node test fail.
- Fix round 1 (guard only, the database is unchanged): 21 mutants, one per new control (each rewrite kind on an existing table: DROP COLUMN, TYPE, SET EXPRESSION, ADD COLUMN with a DEFAULT, `default null::int`, GENERATED, serial; CREATE CAST; ALTER/DROP ATTRIBUTE; RENAME TO only; the `*` in a rule's UPDATE; ALTER TABLE only at the start of a statement; the new-table rules: INSERT, IF NOT EXISTS, top level only, per file, unqualified ALTER, unqualified CREATE, function bodies), each fail a node test. On the local database (rolled back) a bare `rename x to y`, drop and re-add with a default (every row became `manager`), a built-in `numeric(10,2)` → `numeric(10,0)` type change (rounded every row) and a rule `do update t * set` all ran, so each is a real path.
- The first fix pass's multi-statement down script fails the new single-DO-block node test; an anchor check that calls a `private` function fails its node test.
- All 65 probe cases of the guard re-review (O1–O17, A1–A27, B1–B4, C1–C17) and the 7 probes g1–g8 of the security re-review are rejected (a scratchpad harness, not committed; each kind is also a node test).

**Rollback round trip (manual, local, second fix pass).** With a committed bootstrapped Creator and its audit row, plain `psql -U postgres -f <down script>` (no `ON_ERROR_STOP`, no `--single-transaction`, the R-S3 case) printed the refusal and dropped nothing (`private` present, 18 functions in `public`, the audit row and the history row present); with the recommended flags it was refused too (exit 3). After `supabase db reset`, plain `psql -f` ran it on the empty tables: no `private` schema, no relation or function in `public`, no history row, the `postgres` default privileges still hardened (`public` r/S/f and global f: owner only). Re-applying the migration with `psql --single-transaction` and restoring the history row: 479/479 pass; a final `supabase db reset` restored the CLI-managed state (0 Auth users, 0 profiles, 0 audit rows).

**Not run:** anything remote; the GitHub Actions workflows (they run on the PR); the HTTP/PostgREST level with the local publishable key (not read, by rule); an independent review of the second fix pass and of fix round 1 (D53).

## 8. Migration guard change (needs the owner's acceptance, Q1)

`scripts/check-migrations.mjs` was rewritten in the second fix pass (re-review R-S2, R-G1 to R-G11): the first fix pass matched regular expressions over text with the strings blanked out, and both re-reviews showed forms it misread. It now reads SQL with a tokenizer that follows the PostgreSQL lexer and matches every rule on tokens.
- **Tokenizer (R-G4, R-G7):** nested comments; `--` comments end at a newline or a carriage return (as in PostgreSQL); standard strings, `E''` strings (backslash escapes), `b''`/`x''` strings (no `''` escape), quoted identifiers, dollar quotes with tags of any length; PostgreSQL's whitespace only; unquoted identifiers lower-cased and truncated to 63 bytes. Fails closed on: an unterminated quote or comment, an unexpected character, any non-ASCII character outside a string or comment (identifiers, dollar tags, a no-break space), `U&''`/`U&""` escapes, a string continued across a newline (PostgreSQL joins it, and an `E''` string keeps its escapes there), and any lexer error inside a body.
- **Code is always read as code:** a function definition or a DO block is recognised wherever it starts in a statement (in PL/pgSQL after `BEGIN`, `THEN`, `LOOP` …), and a dollar quote is allowed only as such a body; dollar-quoted data fails, so nothing can hide in one. Bodies must be dollar-quoted `LANGUAGE sql` or `plpgsql`.
- **Rule 1–2 (statements that run):** INSERT only as `insert into public.<reference table> (columns) values (constants), …` with an approved reference table named exactly `public.<name>`, no marker column (`is_test`, `data_source`, `target_is_test`), plain `'…'` strings, numbers, `true`, `false`, `null`, nothing after the VALUES list, and no test marker in the strings. No default on a marker column other than exactly `false`, no generated marker, no domain default, and a BEFORE INSERT trigger on a reference table must use a function defined in the migrations that never assigns to `NEW`. As on `main`, a string that reads as an INSERT into a business table fails anywhere.
- **Rule 3:** no `COPY` anywhere (also in bodies), no `EXPLAIN`, no `LOAD`.
- **Rule 4 (writers):** an INSERT in a function body is allowed only in an `ALLOWED_WRITERS` entry, pinned to its exact signature and its tables (`private.write_audit(text,text,uuid,jsonb)` → `public.audit_logs`, `private.authorize_account_creation(text,text,text)` and `private.request_account_change(text,uuid,text,text,text)` → `public.account_requests`, `private.admin_create_profile(uuid,text,text,text,text,uuid)` and `private.bootstrap_first_creator(uuid,text)` → `public.profiles`, `private.admin_create_technician(uuid,text,text,text,text,boolean)` → `public.technicians`), and its strings carry no test marker. A function whose body or header (parameter defaults, options) inserts, updates, deletes, merges or truncates, or names a writer, is a writer; every `ALLOWED_WRITERS` name is a writer even without a definition in the files. A statement that runs may not name a writer at all, with or without `(` (call, `CALL`, trigger, operator, aggregate, cast, default, policy, view, index); only GRANT, REVOKE, COMMENT ON and DROP FUNCTION/PROCEDURE/ROUTINE may.
- **Rule 5 (D49):** `bootstrap_first_creator` only in its own definition header, REVOKE and COMMENT ON FUNCTION.
- **Rule 6:** no `EXECUTE` anywhere, function bodies included (except privilege lists and `EXECUTE FUNCTION/PROCEDURE` in CREATE [EVENT] TRIGGER); no built-in that runs SQL text or writes outside the schema (`query_to_xml` and relatives, `dblink*`, `http*`, `set_config`, `lo_*`, file functions, and the `cron`, `vault`, `net`, `pgsodium`, `realtime`, `supabase_functions` schemas); CREATE EXTENSION only for `ALLOWED_EXTENSIONS` (empty); no ALTER EXTENSION, subscriptions, foreign servers or tables; `standard_conforming_strings`, `backslash_quote` and `session_replication_role` may not be named.
- **Rule 7:** no UPDATE in any form (`ONLY`, parentheses, `*`, aliases, in a CTE, after `THEN` or in a rule action after `DO`), DELETE, MERGE, TRUNCATE, CREATE TABLE … AS in any form, SELECT/WITH … INTO, materialized views (create or refresh), ALTER COLUMN … TYPE … USING. **Schema changes that rewrite existing rows (fix round 1, N1):** ALTER TABLE is read wherever it starts (also after `BEGIN`/`THEN` in a DO block and in a function body; before round 1 its marker-default and `TYPE … USING` checks ran only when ALTER TABLE started the statement). On an *existing* table it may not DROP COLUMN, change a type (`TYPE`, `SET DATA TYPE`, even without `USING`: a built-in conversion such as `numeric(10,2)` → `numeric(10,0)` rounds every row), `SET EXPRESSION`, or ADD COLUMN with a `DEFAULT` other than exactly `null`, `GENERATED` (identity or stored) or a serial type. A table is *new* only when the same file created it earlier with a plain top-level `CREATE [UNLOGGED] TABLE <schema>.<name> (…)` (not `IF NOT EXISTS`, not temporary, not inside a DO block, which may not have run) and no INSERT in the file has targeted it yet; every other table, a table from an earlier file, an unqualified name and every table in a function body is existing. `CREATE CAST` (an assignment cast turns a type change and back into a rewrite) and `ALTER TYPE … ALTER/DROP ATTRIBUTE` (it changes typed tables) fail everywhere.
- **Rule 8:** no RENAME of any kind (`RENAME TO`, `RENAME COLUMN`, a bare `RENAME x TO y`, `RENAME CONSTRAINT`, `RENAME VALUE`, `RENAME ATTRIBUTE`; fix round 1, N2: a marker column renamed away let a reference INSERT set it, and a renamed enum value changes every row), no SET SCHEMA, no INHERIT/INHERITS, ATTACH PARTITION or PARTITION OF, nothing in `pg_temp`, and a reference table name only as a table in `public` (no view or table of that name elsewhere).
- **Compensating runtime control:** `070_census` (census 0; no rows anywhere except the listed reference data; no Auth user; no bucket).

Compared with `main`: every probe the re-review used to show what `main` rejected is still rejected, and so are all the bypasses it found against `main` and the first fix pass; `select $$example.test$$` (which `main` passed) now fails because dollar-quoted data is not allowed. The second fix pass also found and closed a bypass shared by `main` and the first fix pass: a `--` comment ended by a carriage return hid the next statement from the guard while PostgreSQL ran it (confirmed locally).

**What the guard cannot catch (fix round 1; the human and independent review of every migration checks these instead).** A static check cannot prove that arbitrary SQL changes no data. The guard is fail-closed: it rejects every construct it knows can insert or rewrite data outside the reviewed allowlist, and anything it cannot read. It does not judge:
- **Values the allowlist permits:** the values of an owner-approved reference row (S14: an INSERT into `role_permissions` with `allowed = true` in a later migration is caught only by the exact-defaults test in `030`), and what an `ALLOWED_WRITERS` function does with its arguments at run time (it is never called by a migration; the review reads its body).
- **Removing data:** `DROP TABLE`, `DROP TYPE/DOMAIN … CASCADE` (which drops dependent columns) and DROP COLUMN on a table created in the same file. They delete data but cannot write new values; re-adding a column with a default to an existing table is rejected. The review checks every DROP; a later migration's DROP of a populated table is a destructive operation that needs the owner's approval anyway.
- **Future rows:** `ALTER COLUMN … SET DEFAULT` on a non-marker column, CHECK constraints, triggers and functions decide what later application writes store; they do not touch existing rows. Marker defaults stay limited to exactly `false`.
- **Security weakening that writes no data:** disabling a trigger or RLS, a policy, a grant, a role or database setting. `000_smoke` and `010_hardening` catch the catalogue-wide ones on every database built from the migrations; the review checks the rest.
- **State outside table rows:** sequence values (`setval`, `nextval`) and comments.
- **New ways PostgreSQL may add** to rewrite rows in a later version (the guard follows PostgreSQL 17); a new construct must be reviewed and, if it can write data, added to the guard.

The narrower N1 rule has a cost: a migration cannot add a backfilled column (a `NOT NULL … DEFAULT` column, a generated or serial column) to an existing table, or change a column type, without a reviewed change of this mandatory check (or a new table created in the same file). Such a guard change is itself a reviewed change of this mandatory check (Q1). The guard is stricter than PostgreSQL needs (for example a column named like a writer or named `rename`, or a table partitioned later), which fails closed and needs a reviewed guard change. There is no exemption comment or escape hatch.

## 9. Audit anchoring (review S3, re-review R-S4)

The hash has no secret key. Someone with owner-level access who rewrites a row and recomputes every later hash, or deletes the newest rows, leaves a chain that `private.audit_chain_verify()` accepts (`060` proves both); the same access can also replace `audit_chain_verify` or `audit_row_hash` themselves (R-S4: a replaced `audit_chain_verify` reported an emptied audit as intact). Detection therefore needs an **anchor recorded outside the database and a check that trusts nothing inside it**: `docs/review/step1-pr13/audit-anchor-check.sql`. It defines three functions in `pg_temp` (gone with the session), pins `search_path` to `pg_catalog`, recomputes every row hash inline with `pg_catalog` functions, and never calls a `private` function (`tests/ci/audit-anchor-check.test.mjs` checks this; `065` runs a byte-identical copy against both attacks).
1. At each milestone (end of each Step, before and after every approved remote operation, before go-live), with the owner's approval for that read-only operation, run the file as the owner's database role and record `select * from pg_temp.tm_audit_anchor_record();`: `anchor_id`, `anchor_row_hash`, `anchor_row_count` (rows with `id <= anchor_id`) and `functions_md5` (a fingerprint of the audit functions' definitions).
2. Keep the four values outside the database (the Step report or WORKLOG entry, owner-held copy).
3. To verify later, run the file again and `select * from pg_temp.tm_audit_anchor_check(<anchor_id>, '<anchor_row_hash>', <anchor_row_count>, '<functions_md5>');`. Every `ok` must be true: `chain` (every hash recomputes), `anchor_row` (the anchored row exists unchanged), `anchor_count` (no row up to the anchor was deleted; later rows do not matter), `table` (an ordinary table with its five triggers enabled and no rules), `functions` (no audit function was replaced).

`private.audit_chain_verify(anchor_id, anchor_row_hash)` stays as a convenience for the owner inside the database; the authoritative check is the file. Optionally the Creator could see the latest anchor in the app (Q10).

## 10. Rollout risks and rollback plan

- **Apply role:** the migration must run as `postgres` (it refuses any other role) in one transaction, so a failure leaves nothing behind. The remote `public` schema must be empty (Q9).
- **Global default privilege:** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` affects every schema, not only `public`; functions `postgres` creates later anywhere need explicit grants. The down script keeps it (Q2).
- **`supabase_admin` default privileges in `public` stay permissive** (`anon`, `authenticated`, `service_role` get full rights on tables, sequences and functions it creates; `postgres` cannot change them). The hardening holds only while every object in `public` is created by `postgres`. Operating rules: never install an extension into `public`; after the apply, run the `010` catalog assertions against the remote as an owner-approved read-only check (S9).
- **`storage` defaults are unchanged** (`anon` and `authenticated` get full rights on new objects that `postgres` creates there); Step 4 must harden them before creating anything in Storage (S10).
- **`profiles.id` → `auth.users` ON DELETE RESTRICT:** deleting an Auth user that has a profile fails, from the dashboard or the Admin API. Accounts are deactivated, never deleted.
- **One advisory lock serializes every audited action** (the audit chain). Fine at this scale; noted for later volume.
- **Rollback:** `supabase/rollback/20261104120000_access_and_permissions.down.sql`, as `postgres`, only before Step 2. It is a single DO block (R-S3): it refuses to run once any profile, technician, request or audit row exists, and a refusal or any error cancels every DROP whatever the client flags (plain `psql -f` included). It keeps the privilege hardening. A remote run needs the owner's separate approval.
- **Supabase-managed readers (R-S6):** `supabase_read_only_user` and `supabase_etl_admin` (BYPASSRLS, `pg_read_all_data`) can read every table, including `profiles` and `audit_logs`; they are platform roles inside the owner-level boundary (section 4).

## 11. Deviations from `docs/database-schema.md` and `docs/security.md` (not edited here)

1. §8.5: the user RPCs do not write `entity_changes` (created in PR 1.5, and its `entity_table` CHECK excludes profiles). `audit_logs.details` records the changed field names and, for roles and active state, from/to.
2. §9 helper `can_read_visit` is deferred to PR 1.5 (no `visits` table yet).
3. §8.2 "The Creator always has every capability": `has_permission('usage')` is false for the Creator too until d13 (TEMPORARY, deny by default, as in the UI demo).
4. §8.5 `bootstrap_first_creator(uid)` takes `(uid, full_name)`.
5. Additions: `permissions.sort_order`; `account_requests.version`, `updated_at` and `target_version`; `created_at`, `created_by`, `updated_at`, `updated_by` on `profiles` and `technicians`; `updated_at` on `role_permissions`; `UNIQUE (prev_hash)` on `audit_logs`; helpers `is_active_user`, `has_role`, `is_office_user`; RPCs `authorize_account_creation`, `admin_approve_role_permission` (no grant), `admin_update_profile`, `admin_create_technician`, `admin_update_technician`; `CHECK`s that lock Customer Service `cancel` (d08) and `usage` (d13) and tie a null audit actor to the bootstrap row.
6. §2 "A test user's Outlook email must be in example.test" is also applied to the sign-in email of every test account request and creation intent, so to every new user (TEMPORARY, Q12).
7. §1/D44: edit RPCs compare the whole-row `expected_version` and reject a mismatch with `PT409`; there is no per-field `{base, new}` merge and no stored rejected submission (`review_items` comes in PR 1.6). Deny by default.
8. ERD `account_requests`: `target_profile_id` is filled when an approved create is fulfilled (not "empty on create" forever); `decided_by` stores the requester for a cancelled pending request and the requester for a `direct_create`; a new `request_type` `direct_create` holds the audited phase-1 intent of every direct creation (Q16), and `requested_role` allows `manager` only there.
9. `audit_logs.target_id` is NULL for `role_permissions` rows (composite key; role and key are in `details`); the `action` and `target_table` value sets are closed `CHECK`s.
10. §9 says Supabase's permissive default privileges in `public` are "revoked globally": only those of `postgres` are; `supabase_admin`'s cannot be changed by `postgres` (section 10).
11. security.md §5 / §9: SECURITY DEFINER is described for helpers that return a boolean or the caller's own id. The admin RPC bodies are SECURITY DEFINER in `private` and return row versions and created ids (§9 allows admin bodies there). `authenticated` must hold EXECUTE on the private bodies, so the public SECURITY INVOKER wrappers are not a security boundary; each body checks its caller itself.
12. security.md §8 and database-schema.md §1/§11 ("evidence of tampering even with owner-level access"): the hash chain alone detects naive edits and deletions in the middle, not a recomputed rewrite or deleted newest rows; that needs the external anchor of section 9.
13. §8.5 lists `assert_can_manage(target_role)` as the authorization step; it stays a non-audited pre-check, and the audited phase 1 of a creation is `authorize_account_creation` or an approved request (section 5).

## 12. Independent review findings and the fix pass

| Finding | Disposition |
|---|---|
| S1 / D1 (must) guard skipped single-quoted and `BEGIN ATOMIC` bodies | **Fixed:** bodies must be dollar-quoted (also `E''` and `RETURN` forms), inserts allowed only in `ALLOWED_WRITERS`, node tests for every form and a later call |
| D2 (must) untracked `node_modules` symlink | **Process:** stage explicit paths only; see the session's return note |
| S2 census covered 4 named tables | **Fixed:** generic check over every table in `public`/`private` with exact reference counts; Auth users and buckets 0; negative control done |
| S3 hash chain vs owner-level rewrite | **Fixed in part:** documented limitation (deviation 12), anchored `audit_chain_verify(id, row_hash)`, anchoring procedure (section 9), tests for recomputed rewrite, newest-row deletion, middle deletion and fork |
| S4 rollback had no precondition | **Fixed:** first statement refuses when data exists; refused-run test and manual check |
| S5 / D3 phase 1 not audited; Auth-user takeover | **Fixed (TEMPORARY design, Q16):** `authorize_account_creation` audited intent; `admin_create_profile` binds caller, role, email, creation order; one open creation per email; generic error |
| S6 stale approvals | **Fixed (TEMPORARY, Q17):** `target_version` check; requester must still be an active Manager; the Creator can still reject |
| S7 missing negative tests | **Fixed:** items 2–8 added. Item 1 ("no longer applies" state re-check) is now preceded by the version check, which any state change trips first; the re-check stays as defense in depth and cannot be reached without disabling the version trigger |
| S8 unqualified policy columns | **Fixed:** `audit_logs.target_id` etc. |
| S9 `supabase_admin` defaults | **Documented** (section 10, deviation 10); remote check needs approval (Q9) |
| S10 `storage` defaults | **Deferred to Step 4** (documented) |
| S11 admin bodies vs §5 wording | **Documented** (deviation 11, SQL comment) |
| S12 information leaks | **Fixed:** one generic error for every binding failure; duplicate alias returns `23505 the value is already in use` without the detail |
| S13 chain trigger ordering | **Fixed:** `t20_audit_target` derives the target marker, `t90_audit_chain` hashes last |
| S14 guard misses other data changes | **Fixed in part:** rule 7 (UPDATE, DELETE, MERGE, TRUNCATE, CTAS, SELECT INTO, materialized views) and rule 6 (dynamic SQL); a later `role_permissions` insert with `allowed = true` is not checked statically (needs an approved value list) |
| S15 owner-level edits not audited | **Deferred** (optional; inside the accepted owner-level boundary) |
| S16 MFA (`aal2`) | **Deferred to Step 2** (Q15) |
| S17 / D5 test sign-in email rule | **Fixed:** every creation now passes through an `account_requests` row, so the `example.test` rule applies to every new user (Q12) |
| D4 approval function live before Q6 | **Fixed:** no grant; TEMPORARY; tests run its rules as the owner's role |
| D6 deviation list incomplete | **Fixed:** section 11 items 5–13 |
| D7 ERD and rollout risks missing | **Fixed:** sections 3 and 10 |
| D8 README wording | **Fixed:** calls that change nothing return without an audit row; `assert_can_manage` is a pre-check |
| D9 Manager audit view by current role | **Documented** in Q8 and the policy comment |
| D10 null actor | **Fixed:** `CHECK ((actor_profile_id is null) = (action = 'creator.bootstrapped'))` |
| D11 labels need a migration to change | **Documented** in Q13 |
| D12 doc accuracy | **Fixed:** PROJECT-MAP guard row; ROADMAP "Smoke test 3" |

Calls that change nothing (same value, same role, same state, no changed field) return the current version without an audit row; every call that changes data writes its audit row in the same transaction.

## 13. Open owner questions

1. **Guard change (section 8):** rewritten in the second fix pass as a tokenizer that follows PostgreSQL, with an allowlist of writer functions pinned to signature and tables (each later migration PR extends it), an extension allowlist (empty), and stricter rules than `main` (for example dollar-quoted data, every `RENAME`, `EXPLAIN` and non-ASCII identifiers fail). Fix round 1 added: no DROP COLUMN, type change, `SET EXPRESSION` or ADD COLUMN with a default on an existing table, no `CREATE CAST`, no RENAME of any kind. A static guard cannot prove that a migration changes no data: section 8 lists what it cannot catch, and the review of every migration must check those points. One cost: adding a backfilled column to an existing table or changing a column type will need a reviewed guard change. It still needs an independent review (D53). Do you accept it as a reviewed change of a mandatory check, with these limits and this cost?
2. **Rollback:** the down script keeps the hardening, is valid only before Step 2 and now refuses to run once data exists. A rollback step in `.github/workflows/db.yml` would be a protected-path change; for now `tests/db/990` plus the byte-identical check cover it in CI. OK?
3. **D49 in local tests:** the tests run `bootstrap_first_creator` and create real-marked fixtures, only inside rolled-back local transactions. We read D49 as "never by a migration and never against the remote project without your approval". Correct?
4. **Field history for accounts:** profiles and technicians changes keep field names in the audit, not old/new values (no `entity_changes` for them). Enough, or add a history table?
5. **Technician role change:** a Technician with a field profile can never change role (technicians rows are never deleted, §8.4 rule 5). Should a future path exist?
6. **Who approves matrix values (D51):** until you decide, no API role can mark a value approved (the function exists without a grant). Should the Creator approve values in the app, and only in Step 10?
7. **Creator `usage`:** denied until d13 (deny by default) although §8.2 says the Creator has every key. Keep?
8. **Read scope:** Manager and Customer Service read only their own role's matrix values; a Technician cannot read the key catalogue; the Manager's audit view is his actions plus the accounts he manages, judged by the account's current role (so it includes rows from before a role change, for example the Creator's earlier credential authorizations for that account). Customer Service reads only its own profile (the "narrow function" comes later). OK?
9. **Remote check before apply:** the migration runs only as `postgres`. Before applying, a read-only check of the remote (the apply role, that `public` is empty, `supabase_admin`'s default privileges in `public`) needs your approval for that operation, and after the apply the `010` catalog assertions should run against the remote (also approval).
10. **Audit chain verification:** `audit_chain_verify()` is owner-only. Should the Creator be able to run it, or see the latest anchor, in the app?
11. **Creating Creators:** nothing creates a Creator (D49; every new user is a test user until go-live and a test Creator is impossible). D34 lets the Creator manage Creator accounts; is "bootstrap only" right until go-live?
12. **Test sign-in emails:** every new user is a test user until go-live, so every sign-in email must be in `example.test` (as test Outlook emails are). OK?
13. **Hebrew labels in the database:** `permissions.label_he` holds the labels (the ERD has it; §1 says labels belong to the UI); the `products`, `conflicts`, `recordings` and `card` labels are TEMPORARY until SE-02 approval, and changing them later needs a migration (no RPC edits them).
14. **Fulfilling an approved Customer Service creation:** only the Creator completes it (after the Auth user is created in Step 2). OK, or may the requesting Manager complete it?
15. **MFA:** no `aal2` check yet (Step 2, open decision 19): add it for Creator and Manager in the shared caller check, plus the restrictive policy of §8.4 rule 8.
16. **Creation intents:** phase 1 of every direct creation is stored as an approved `direct_create` row in `account_requests` (no new table), one open creation per email, cancellable by its requester or the Creator. Since the second fix pass the Auth user must carry the intent id in `app_metadata.account_request_id` (set by the Step 2 server with the secret key) and be created after the authorization, with no clock tolerance. Accept this model, or prefer a separate intents table? Should an intent expire after some time (today it has no lifetime)?
17. **Stale approvals (new):** the Creator cannot approve a request when the account changed after it was made (any profile change, even a name) or the requesting Manager is no longer an active Manager; he can still reject it or act directly. OK?
18. **Audit anchors:** who holds the four anchor values of section 9 (id, row hash, row count, functions fingerprint), and at which milestones?

## 14. Re-review of the fix pass (`e843e1e`) and the second fix pass

An independent security re-review and an independent guard re-review (D53) examined the fix pass on the local stack only. No path gives an API role a privilege escalation. Their findings and what the second fix pass did:

| Finding | Disposition |
|---|---|
| R-S1 (should) an Auth user could be bound through another intent after its own was cancelled; no upper time limit; no confirmed-email check | **Fixed:** binding nonce `app_metadata.account_request_id` (only the secret key writes it; a Step 2 server requirement), `created_at >= decided_at` without tolerance, not anonymous, SSO or soft-deleted; tests for both rebind orders, missing and other nonce, a later or earlier Auth user (section 5). **Not added:** an intent lifetime (a product rule, Q16) and a confirmed-email check (a Step 2 invitation may confirm the email after the profile exists); the nonce makes a later Auth user unbindable unless the server sets it |
| R-S2 (should) guard let `update t *`, `update only (t)`, operators, parameter defaults, renames, body `update … *` and `pg_temp` dynamic SQL through | **Fixed:** guard rewrite (section 8); g1–g8 are node tests |
| R-S3 (should) the rollback refusal worked only with `ON_ERROR_STOP` / `--single-transaction` | **Fixed:** the down script is one DO block (static DDL); the node test requires a single statement with the refusal before the first DROP; manual run with plain `psql -f` and a committed Creator dropped nothing (section 7) |
| R-S4 (should) owner-level access could replace `audit_chain_verify` / `audit_row_hash` | **Fixed:** self-contained check in the repository (`audit-anchor-check.sql`), anchor records rows up to the anchor and a functions fingerprint; `065` proves it against both attacks (section 9) |
| R-S5 (should) no failing-path tests for the unique indexes, cancel authorization and the approved → cancelled transition | **Fixed:** `020` (indexes alone refuse 23505; fulfilled creation cannot be cancelled or unlinked, 55000), `050` (another Manager cannot cancel a Manager's or the Creator's approved creation, 42501); negative controls in section 7. **Not testable:** the Creator-only condition for binding a `create` request is unreachable behind the earlier role check (defense in depth) |
| R-S6 (note) Supabase-managed roles read every table | **Documented** in sections 4 and 10 |
| R-G1 (high) allowlist by name; escaped names, rename, operator, aggregate calls | **Fixed:** signature and table pinning, writer named anywhere is a call, `U&` rejected, RENAME/SET SCHEMA rejected, identifier truncation modelled; markers still checked in writer bodies |
| R-G2 (medium) markers inside `$$` values | **Fixed:** reference INSERT values are plain constants only; dollar-quoted data fails |
| R-G3 (high) dynamic SQL in bodies; `execute function` variable | **Fixed:** `EXECUTE` fails anywhere except privilege lists and trigger headers |
| R-G4 (high) dollar tags over 62 characters, non-ASCII tags and names | **Fixed:** exact dollar-tag lexing, non-ASCII outside strings and comments fails, body lexer errors fail |
| R-G5 (medium) schema-blind targets, name prefixes, INHERIT | **Fixed:** only `public.<reference>`; INHERIT/INHERITS, ATTACH PARTITION, PARTITION OF, RENAME TO, SET SCHEMA, views of a reference name rejected |
| R-G6 (medium) markers through SET DEFAULT, positional VALUES, split strings | **Fixed:** explicit column list without markers, plain constants, no marker default other than exactly `false` |
| R-G7 (medium/low) UPDATE and CTAS forms, `with … into`, `explain`, E-string misalignment | **Fixed:** token-based rules for every form listed; `EXPLAIN` fails |
| R-G8 (medium) D49 function through `U&` or `EXECUTE` | **Fixed** by R-G1 and R-G3 |
| R-G9 (low) COPY only at statement start | **Fixed:** `COPY` fails anywhere |
| R-G10 (low) writing built-ins, CREATE EXTENSION | **Fixed:** denylist of schemas and functions; `ALLOWED_EXTENSIONS` (empty) |
| R-G11 (info) `standard_conforming_strings` | **Fixed:** naming it (or `backslash_quote`, `session_replication_role`) fails |
| Found in this pass (beyond the re-review) | **Fixed:** a `--` comment ended by a carriage return hid the next statement from `main` and the first fix pass (PostgreSQL ran it); PostgreSQL whitespace, `b''`/`x''` strings and string continuation are now modelled or fail closed; DO blocks and definitions nested after `BEGIN`/`THEN` are read as code; generated markers, domain defaults and reference-table BEFORE INSERT triggers that change `NEW` fail |

**Fix round 1 (after the final verification of the second fix pass; guard and documentation only, the migration and the database tests are unchanged):**

| Item | Disposition |
|---|---|
| N1 (should) dropping and re-adding a column with a default, or a type change through `CREATE CAST … AS ASSIGNMENT` and back, rewrote every existing row and passed | **Fixed:** on an existing table no DROP COLUMN, `TYPE`/`SET DATA TYPE`, `SET EXPRESSION`, or ADD COLUMN with a non-null default, `GENERATED` or serial; `CREATE CAST` and `ALTER TYPE … ALTER/DROP ATTRIBUTE` fail everywhere; ALTER TABLE is read wherever it starts. Also found and fixed: a marker default or `TYPE … USING` after `BEGIN` in a DO block or in a function body passed. Limits: section 8 and Q1 |
| N2 (medium) only `RENAME TO` was checked; a renamed marker column let a reference INSERT set it | **Fixed:** every `RENAME` fails (column, bare column, constraint, value, attribute, in any context) |
| N3 (low) no node test for `*` in a rule's `DO UPDATE t * SET` | **Fixed:** node test (with `ONLY`, alias and `DO INSTEAD` variants); removing the `*` handling fails it |
| N4 (doc) `065_audit_anchor`, the anchor check file and its node test missing from `PROJECT-MAP.md` and `testing.md` | **Fixed** |

Counts after round 1: guard passes; `npm run test:ci` 45/45; `npm run lint` passes; `supabase db reset --local --no-seed` then `supabase test db tests/db`: 479/479 (section 7).

Remaining before merge (D53): an independent review of the second fix pass and of fix round 1 (binding nonce, guard rewrite and round 1 rules, down script, anchor check), then the steps listed at the top of this report.
