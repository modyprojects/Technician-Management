# Step 1 / PR 1.8: Migration 5 (accounts and permissions)

**Status (2026-11-16):** prepared and tested locally; **not applied**, not pushed. Branch `claude/step1-pr18-accounts-permissions`, created from PR 1.6's head `f53016a` (Migrations 1-4; Migration 4 is under review in PR #30 and not applied). Applying Migration 5 needs the owner's separate approval of the exact file, after Migration 4 is applied and merged (D52 rule 4, D55). Merging needs the owner's approval (D59). The one independent review (D58) has **not run yet** (section 12).

Sources: D60 (7) user administration, D60 (8) Manager settings, D60 (9) usage analytics; D33, D34 (as superseded by D60 (7)), D43, D47, D49, D51; `docs/qa-corrections-01-integration.md` §4 and §5 "Migration 5" (rows M-06, M-07, M-10, C-01, C-02, C-03 to C-06).

| File | sha256 |
|---|---|
| `supabase/migrations/20261108120000_accounts_permissions.sql` | `028f3beca9c78037742d60386f1f1ed77e61b3df2933afb7c2c57072b742f870` (903 lines, 50,809 bytes; no `\u` or `\U` escape) |
| `supabase/rollback/20261108120000_accounts_permissions.down.sql` | `437da2ab082bb473ba728d3425b92ee67d21f7832a7590e3deef1d0d1dcca573` (559 lines) |
| `tests/db-canary/20261108120000.sql` | `97a0f71723880df40ae4847b952d3bc53c15d3f19530ba5e4ffe717a25c2d6c5` |

## 1. Files
- Migration, rollback (down) script and canary-rows fixture (table above).
- New pgTAP files: `tests/db/270_hardening_assertion_m5`, `280_accounts_schema`, `290_account_admin`, `300_narrow_keys`.
- Updated pgTAP files: `010`, `015`, `020`, `030`, `040`, `050` (rewritten), `060`, `070`, `090`, `120`, `990`. Every expectation that changed because of D60 is listed in section 7.
- `tests/ci/check-migrations.test.mjs` (PR 1.8 guard cases; the pinned writer list is unchanged) and `tests/ci/hardening-assertion.test.mjs` (the section 14 copies).
- No application code changed: the screens and the Supabase adapters come with Step 2 (section 14).

## 2. Objects the migration creates or changes (for the apply approval)
- **`profiles` (no row changes):** two nullable columns without a default, `deleted_at timestamptz` and `deleted_by uuid`; the foreign key `profiles_deleted_by_fkey` (ON DELETE RESTRICT) and three CHECKs: `profiles_deleted_check` (set together), `profiles_deleted_inactive_check` (a deleted account is never active: the reactivation guard for every writer), `profiles_deleted_self_check`; the table comment.
- **Triggers (4, beside the PR 1.3 ones, DEV-6):** `profiles.t12_deleted_guard` (a deleted account never changes again; the deletion takes the server time), `profiles.t31_one_way_deleted` (the D47 one-way rule for `deleted_by`), `technicians.t11_deleted_profile` (the field profile of a deleted account is never created or changed), `account_requests.t05_requests_retired` (no new row but a creation intent, C-02).
- **Audit:** the action CHECK gains `profile.deleted` (the 30 actions of Migrations 1-4 unchanged, the request actions included, so earlier rows stay valid); the target tables are unchanged, so `private.tg_audit_target` and the anchor's functions are unchanged (section 9).
- **Matrix:** `permissions_key_check` and `permissions_enforcement_by_key` gain `reasons`, `callTypes`, `ackText` (data keys); 3 catalogue rows (sort order 14-16, TEMPORARY labels in the QA document's words: "סיבות המשך טיפול", "סוגי קריאה", "נוסח אישור ״טופל״") and 6 TEMPORARY values (Manager on, Customer Service off; D51); a comment on `role_permissions_pending_decisions` (the `usage` lock is now for good, DEV-5).
- **Functions (4 new, 10 replaced, 4 revoked):**
  - New: `private.admin_delete_user(uuid, integer, text)` (SECURITY DEFINER) and its SECURITY INVOKER wrapper `public.admin_delete_user`; trigger functions `private.tg_profile_deleted_guard`, `tg_technician_deleted_guard`, `tg_account_requests_retired` (SECURITY INVOKER, no grant).
  - Replaced (same signatures, ACLs, owner and options; CREATE OR REPLACE): `private.has_permission` (the Creator has `usage`; a matrix role never), `private.assert_can_change_credentials` (refuses a deleted account), `private.authorize_account_creation` (a Manager authorizes Customer Service too), `private.admin_create_profile` (a Manager binds Customer Service too; an approved Customer Service `create` request is no longer bound), `private.admin_set_user_active` (no Creator approval for a Manager's Customer Service activation; refuses a deleted account), and the five Migration 2 bodies `add_call_type`, `set_call_type_active` (key `callTypes`), `add_followup_reason`, `set_followup_reason_active`, `delete_followup_reason` (key `reasons`), byte for byte otherwise (`tests/ci` asserts it).
  - Revoked from every role, Creator included (bodies unchanged, commented as retired): `public.` and `private.request_account_change`, `public.` and `private.decide_account_request`.
- **Comments:** `profiles`, `account_requests`, `call_types`, `followup_reasons`, the two retired wrappers.
- **Grants:** EXECUTE to `authenticated` on the deletion wrapper and body; nothing for `anon`, `service_role` or `PUBLIC`; no table, column or sequence grant changes.
- **Section 14:** the fail-closed hardening check, a byte-identical copy of Migration 4 section 12, as the last statement.
- No new table, view, sequence, role, extension or Storage bucket; no test row (D47).

## 3. Relationships
- `profiles.deleted_by` → `profiles(id)` ON DELETE RESTRICT. Nothing is ever removed: every foreign key that names a deleted account (visits through `technicians`, `created_by`, `updated_by`, `requested_by`, audit actors and targets) keeps working, and the name stays (Option A).
- `account_requests` keeps its PR 1.3 keys and policies; only creation intents (`direct_create`) are added from now on.

## 4. Who can do what (TEMPORARY D51 matrix values)
| Caller | Accounts | Settings (`reasons`, `callTypes`, `settings`) | `usage` |
|---|---|---|---|
| `anon`, `service_role` | nothing (no grant) | nothing | no |
| Signed in without a profile, deactivated, **deleted** | nothing; reads nothing (every policy and function requires an active profile) | nothing | no |
| Technician | nothing | nothing (selects active reasons in his visit) | no |
| Customer Service | nothing | with the keys only (all off by default) | never |
| Manager | creates (phase 1 and 3), edits, activates and deactivates **Technician and Customer Service** accounts and Technician field profiles directly (D60 (7), M-06); never a Manager, the Creator or himself; **never deletes, never changes a role, never sets a password or an email**; a test Manager never touches a real account (D47) | `reasons`, `callTypes` (and `ackText`) on by default; `settings` (pickup places) off by default | never |
| Creator | every role but his own account; role changes (never to Creator, D49; never his own; a Technician with a field profile keeps his role); **deletion, Option A**, of every role but a Creator account (OQ-1); credential changes (D34 e) | every key; the only one who edits the matrix (D33) | **yes** (D60 (9)) |

A deleted account is never activated, edited, given a role or credentials again, and its field profile never changes (OQ-2). The request path (requests and decisions) runs for nobody (C-02); its history stays readable by the Creator (every row) and by each Manager (his own rows). Revocation is immediate: deactivation, deletion and matrix changes take effect at the next query.

## 5. Function pattern and the Step 2 contracts
- Writers follow Migration 1's order: the caller (`require_caller`, profile locked FOR SHARE), the input (22023), the target locked FOR UPDATE (unknown, out of scope or a test caller with a real target: generic 42501), the state (55000 `the account is deleted`), the version (PT409), no change (current version, no audit row), the write, the audit row (`private.write_audit`) in the same transaction.
- `admin_delete_user(p_profile_id, p_expected_version, p_reason)` returns the new version. Refusals: the caller is not an active real Creator, the target is himself, unknown or a Creator account (42501); null id or version, or a reason over 300 characters (22023); already deleted (55000); stale version (PT409). Effect: `is_active = false`, `deleted_at = now()`, `deleted_by = caller`, audit `profile.deleted` `{role, was_active, reason}`.
- **Creation (Step 2):** `authorize_account_creation` (phase 1, under the caller's session; audited intent) → the Auth user with `app_metadata.account_request_id` = the intent id (secret key) → `admin_create_profile` (phase 3, under the caller's session) → for a Technician `admin_create_technician`. A Manager now does this for Customer Service accounts too.
- **Deletion (Step 2):** `admin_delete_user` under the Creator's session first; only after it commits does the server revoke the Auth side with the secret key (ban the Auth user, or soft-delete it, and end its sessions). A hard delete of the Auth user cannot succeed (`profiles.id` references `auth.users` ON DELETE RESTRICT). Until the Auth step runs, the database already refuses the account everything. A retry of the Auth step first re-reads the profile under the Creator's session (`deleted_at` set).
- **Fit with the data-access ports** (`features/accounts/data/ports.ts`, `features/settings/data/ports.ts`; deviations for Step 2, DEV-7):
  - `createAccount` (Creator only in the port): the Manager may now create Customer Service accounts too (`authorize_account_creation('customer_service', …)`).
  - `requestAccount`, `decideAccountRequest`: no database function any more (retired); `cancelAccountRequest` → `cancel_account_request` (unchanged; needed for creation intents).
  - `activateAccount`: a Manager's Customer Service activation now succeeds; `requires the Creator's approval` is no longer raised; `deactivateAccount` unchanged.
  - `completeCreation`: only the requester's own intent; the Creator's completion of a Manager's `create` request (Variant B, PR 1.3 Q14) is gone (OQ-4).
  - A new command is needed: `deleteAccount({ accountId, expectedVersion, reason? })` → `admin_delete_user`, then the Auth step; a `VersionedResult`, as the other edits.
  - `list` must leave out deleted accounts (`deleted_at`), and `creatorNotices` no longer meets pending requests.
  - Settings: `addReason`, `setReasonActive`, `deleteReason` need `reasons`; `addCallType`, `setCallTypeActive` need `callTypes`; places keep `settings`; `setFixedText` will need `ackText` (Step 4). `PERMISSION_KEYS` (`features/reference/data/types.ts`) lacks the three keys, and the Creator's `usage` is no longer a pending cell.
  - New 55000 texts for `features/data-access/supabase-errors.ts`: `the account is deleted`, `profiles: a deleted account never changes (D60 (7))`, `technicians: the account is deleted (D60 (7))`, `account_requests: account requests are retired (D60 (7))`.

## 6. Hardening evidence (local database built from the migrations)
- `000`, `010` and `015` pass: no privilege for `anon` or `PUBLIC`; the exact EXECUTE list (the deletion writer in, the four request functions out); every SECURITY DEFINER function pinned and in `private`; the trigger functions have no grant; the new and replaced writers run correctly with `text`, `uuid`, `jsonb` and `timestamptz` shadowed in the caller's `pg_temp`.
- Section 14 passes on the migrated database; `270` shows it fails closed on 22 injected leaks on the Migration 5 objects (the deletion writer, the new trigger functions, the retired request path granted to `anon` or `PUBLIC`, column and table privileges on `profiles`, `permissions`, `role_permissions` and `account_requests`, RLS, policies, `search_path`, owners, a definer view, a materialized view, default privileges). Known limit, shown in `270`: the check allows EXECUTE for `authenticated` by design, so re-granting the retired path to `authenticated` passes it; `010` (exact list) and `050` (every caller refused) catch that.

## 7. Tests (local, 2026-11-16: pinned Supabase CLI 2.122.0, Postgres 17)
| File | Assertions | What it proves |
|---|---|---|
| `270_hardening_assertion_m5` | 26 | the section 14 copy against 22 injected leaks; an invoker view passes; the known limit; two clean runs |
| `280_accounts_schema` | 39 | columns, constraints, trigger order, the deletion CHECKs and server time, the frozen deleted account and field profile as the owner's role, the D47 one-way rule for `deleted_by`, the audit action CHECK, the unchanged anchor, the narrow keys' CHECK and values, the replaced functions' ACLs and options, the Settings bodies' keys, the comments |
| `290_account_admin` | 45 | every account function for Customer Service, a Technician, a deactivated Manager, a user without a profile, `anon`, `service_role` (all refused); what a test and a real Manager never do (16 actions); the Manager's direct Customer Service and Technician creation (both phases) and his edits, activations and deactivations, with exact audit rows; the Creator's role changes (the new role's capabilities exactly); deletion (refusals, effects, audit); after deletion: no reactivation, edit, role or credential change, the deleted users read and run nothing, history and attribution kept, the Manager's view of deleted accounts and their audit rows |
| `300_narrow_keys` | 28 | each key opens exactly its RPCs, per caller and per key change (revocation at the next call); `settings` alone no longer opens call types or reasons; the narrow keys never open pickup places; only the Creator changes them, audited; `ackText` unused; `usage` for the Creator only, never through the matrix, refused by `has_permission` even with a relaxed CHECK |
| Updated `010` / `015` / `020` / `030` / `040` / `050` / `060` / `070` / `090` / `120` / `990` | 45 / 24 / 48 / 60 / 143 / 34 / 61 / 28 / 42 / 87 / 99 | as below |

Full local run: **35 files, 1,486 assertions, all pass** (before: 31 files, 1,390). Node (`npm run test:ci`): **205/205**. Migration guard: passed (no `ALLOWED_WRITERS` change). Canary-rows check: **PASS**, 5 migrations, 5 fixtures, coverage 23 tables / 303 columns, the 3 existing exceptions, no new one. `npm run lint` and `npm run typecheck`: clean. `git diff --check`: clean. No mutation testing (D58).

Rollback round trip (local): the down script, run in a rolled-back transaction, leaves a catalog equal to a database built from Migrations 1-4 alone on 11 fingerprints (functions, function ACLs, function and column comments, constraints, triggers, columns, relations with ACL, RLS and comments, indexes, policies, the anchor's functions); `990` asserts nine of them and the anchor's functions, the ten restored function texts, the 26 matrix values and the history, then runs the PR 1.6 to PR 1.3 scripts as before.

**Expectations changed because of D60 (none weakened; each now asserts the D60 rule):**
- `040` (D60 (7) supersedes D34 a): "a Manager cannot authorize a Customer Service creation" → he authorizes it directly; "a Manager cannot activate a Customer Service account (request needed)" → he activates it immediately; the Creator's direct Customer Service activation follows (one more assertion: the Creator deactivates, then activates it). The description of the Manager's refused role change now cites D60 (7).
- `050` (C-02): its 98 assertions tested the D34 (a) request path, which no role can run any more. It now has 34: the four request and decision entry points refused for nine kinds of caller (Creator included), nothing changed by a refusal, the unchanged bodies (md5), no new request row even as postgres, the history readable by the Creator and each requester only, an approved legacy `create` no longer bound (OQ-4), cancellation unchanged, a pending legacy creation still holding its email until cancelled, then the Manager's direct Customer Service intent. The D34 behaviour stays tested at `f53016a` (PR 1.6's head), and the rollback restores its catalog byte for byte (`990`).
- `030` (D60 (8), (9)): 16 keys, 32 values, labels and the CHECK text; "Creator: every key (usage denied until d13)" → the Creator has `usage`; the two `usage` refusals now cite D60 (9) (same codes).
- `120` (D60 (8)): wherever PR 1.4 turned `settings` on or off, the three Settings keys are turned on or off together, and the Manager's narrow keys (on by default) are turned off before section B, so every asserted outcome is unchanged; the per-key gates are in `300`.
- `015`: the Manager's Customer Service request → his direct Customer Service intent (plus his direct activation and the Creator's deletion under the shadow domains; the reads also show `callTypes`).
- `060`: the Manager's audited request (`account_request.created`) → his direct Customer Service intent (`account_creation.authorized`); counts unchanged.
- `020`: the request rows are history written before Migration 5, so `t05_requests_retired` is disabled for that file (rolled back); Migration 1's CHECKs and guard on those rows are still asserted.
- `010`, `070`, `090`, `990`: lists and counts (the deletion writer, the retired functions, 16 keys and 32 values, the PR 1.8 down script first).

## 8. Protected-file changes (need the owner's approval; merge gate)
- **A1, `tests/db-canary/20261108120000.sql` (D54):** a new fixture that only adds rows (a deleted Customer Service account created through a Manager's intent, and its deletion audit row); it covers the two new columns. `tests/db-canary/coverage-exceptions.json` is **unchanged**.
- **`scripts/check-migrations.mjs` (D55): unchanged.** No `ALLOWED_WRITERS` entry was added, removed or changed: the four replaced inserting writers keep their exact signatures (`private.authorize_account_creation(text,text,text)`, `private.admin_create_profile(uuid,text,text,text,text,uuid)`, `private.add_call_type(text)`, `private.add_followup_reason(text)`), and the new `admin_delete_user` only updates. `private.request_account_change(text,uuid,text,text,text)` keeps its entry: Migration 1's file still defines it.
- No other protected file changed (`CLAUDE.md`, `docs/security.md`, `.github/workflows/**`, `vercel.json`, `proxy.ts`, `app/dev/_gate.ts`, `config/release.json`, `scripts/db-canary.mjs`, `tests/db-canary-selftest/**`).
- **Follow-up that needs approval (not done here):** `docs/security.md` §4a, §5 and §10 still describe the D34 (a) request path and the `usage`/`settings` defaults before D60; aligning them with D60 (7)-(9) is a protected-file change for its own PR.

## 9. Audit anchoring
Migration 5 changes none of the anchor's functions (`private.tg_audit_target` included: no new target table), so `functions_md5` stays `9c962b84a36e6218412e234d9042eb44` (the Migrations 1-4 value, `280` and `990` assert it). Only the action CHECK changes. `md5(prosrc)` of the new and replaced functions (post-apply check): `has_permission` `63b26d0d9312727c1db8d5086d6c2f96`, `assert_can_change_credentials` `e39f70103142dec922f2539545e65a1c`, `authorize_account_creation` `ef8b2cdb3c6f1da9c1500c6aacfb7d80`, `admin_create_profile` `38fcfbf8c366109da0b014f21e33aeeb`, `admin_set_user_active` `6acefa75bfaf32e283f8de58ab6027bf`, `private.admin_delete_user` `340606b7515a52c474a9c613b4bf2b61`, `public.admin_delete_user` `8c19d643de5a4cafd6a1566c98ba67d1`, `add_call_type` `59a0015be72d2ab56dcbef58128a2493`, `set_call_type_active` `31bef7f190b1474ddd18d3c8f85defa4`, `add_followup_reason` `28887d72d12ede3c67c23f9d99cfa687`, `set_followup_reason_active` `6ade73485d3b52ee594de37e4b28e180`, `delete_followup_reason` `d3a059e090bd10a2aecab0039bf1d3da`, `tg_profile_deleted_guard` `ed456991dabcf73701fb4eb29b60b383`, `tg_technician_deleted_guard` `098f4333b12373e845fb60503a7a32d5`, `tg_account_requests_retired` `28818ca6ef1593660f64b3b4d8911597`.

## 10. Rollout risks and rollback plan
- **Order:** Migration 4 applied and merged first, then Migration 5 with a separate approval of the exact file. The file has no `\u` escape, but the Hebrew labels and the "״" in a string make a self-verifying apply wrapper (as for Migrations 2-4) the safer delivery.
- **Remote data assumption:** no profile exists on the remote project until the D49 bootstrap (Step 2), so no request row exists there, and none can be stranded by the retirement. The pre-apply read-only check should confirm `account_requests` is empty.
- **Rollback:** `supabase/rollback/20261108120000_accounts_permissions.down.sql`, as `postgres`, before the PR 1.6 down script, only before any PR 1.8 data exists. One DO block; it refuses first (55000) when a later migration is recorded, when a profile is marked deleted, when an audit row records a deletion or names a narrow key, when a narrow-key value was changed or approved, or without a history row (version `20261108120000` or name `accounts_permissions`). It restores the ten replaced functions byte for byte, grants the four request functions again (`GRANT ALL` on a function is EXECUTE; a down script may not contain the `execute` token), restores the comments, drops the new functions and triggers, the four constraints and the two columns, deletes the six values and three keys (the reject-delete triggers are disabled only around those two deletes, which must remove exactly 6 and 3 rows), restores the two permissions CHECKs and the audit CHECK, and deletes the history rows. No CASCADE, no dynamic SQL. Rows written under the D60 rules that Migration 1 refused (a Manager's Customer Service intent, profile or activation, a call type or reason added with a narrow key) are valid rows of the earlier schema and do not block it. No remote rollback runs without the owner's explicit authorization (D55 (7)).

## 11. Deviations from `docs/database-schema.md` "Planned changes from D60" (recorded, not asked)
- **DEV-1** `assert_can_manage` and `admin_set_user_role` are not replaced: they already implement D60 (7) (the Creator manages every role, a Manager Technician and Customer Service accounts; role changes are Creator-only). `admin_update_profile`, `admin_create_technician`, `admin_update_technician` and `cancel_account_request` are unchanged too.
- **DEV-2** The phase-1 creation intents stay in `account_requests` (`direct_create`, §8.5 two-phase creation): only the request types are retired, so the table is "read-only as history" for those rows and still receives intents.
- **DEV-3** The request path is retired by revoking EXECUTE from every role (the Creator included) plus an insert trigger; the bodies keep Migration 1's text (so the rollback only grants them again).
- **DEV-4** The deletion freeze is enforced by triggers for every writer (`t12_deleted_guard`, `t11_deleted_profile`) and by the CHECK `profiles_deleted_inactive_check`; `admin_set_user_active`, `assert_can_change_credentials` and `admin_delete_user` also refuse with `the account is deleted`. That `deleted_by` is a Creator is checked by `admin_delete_user`, not by a CHECK (the owner's role could write any profile).
- **DEV-5** `usage` stays locked for the matrix roles by Migration 1's CHECK `role_permissions_pending_decisions` (its name is historical; a constraint comment now says the lock is for good) and by `admin_set_role_permission`'s unchanged 55000 text "value locked until an open owner decision"; `has_permission` refuses it to a matrix role in any case.
- **DEV-6** The four triggers are added beside Migration 1's instead of replacing `t10_profile_guard` or `t30_one_way`: a down script cannot recreate a trigger (no `execute` token), so replacing them could not be rolled back exactly.
- **DEV-7** The account and Settings ports still describe D34 (requests, the Creator-only `createAccount`, no `deleteAccount`) and the 13-key catalogue; the database functions follow D60. The mapping and the changes for Step 2 are in section 5.
- **DEV-8** The narrow keys take sort order 14-16 (after the D33 keys; existing rows never change), not a place next to `settings`; the Step 10 matrix screen decides the display order.
- **DEV-9** No column comments on `deleted_at` and `deleted_by`: the migration guard refuses three-part names (`table.column`); the table comment describes them.

## 12. Independent review (D58)
Not run yet. This PR changes authorization, roles, the matrix and account administration, so one review by an agent that did not write the code is required before the merge (D53, D58), on the exact head; the record goes here and in the PR.

## 13. TEMPORARY behaviours (deny by default) and open owner questions
Each has a TEMPORARY behaviour that the tests assert; none is decided. The owner is asked only when one blocks the apply or creates a material security risk (owner, 2026-11-11).

| # | Question | TEMPORARY behaviour |
|---|---|---|
| OQ-1 | May the Creator delete another Creator account? | no (42501): one Creator exists and nothing creates another (D49, PR 1.3 Q11) |
| OQ-2 | What may still change on a deleted account? | nothing, for every writer: no reactivation, edit, rename, role change, credential change or undelete; its field profile is frozen too; its unique Outlook email and invitation alias stay taken |
| OQ-3 | Who reads deleted accounts? | as deactivated ones: the Creator all, the Manager Technician and Customer Service accounts (attribution); lists and pickers leave them out (Step 2 queries) |
| OQ-4 | What happens to the request history? | no new request rows; earlier rows stay readable; `cancel_account_request` unchanged (a requester cancels his own pending request, the Creator an approved, unfulfilled creation); an approved Customer Service `create` request is no longer bound (the Creator cancels it and authorizes a direct creation); a requester who left cannot be replaced to cancel a pending one (none can exist remotely, section 10) |
| OQ-5 | Should `settings` be locked off for the Manager and Customer Service, as `usage` is? | no: it stays an editable TEMPORARY value (off for both, D51) and gates pickup places only; D60 (8) "the Manager does not get the global `settings` key" holds by the default |
| OQ-6 | Narrow-key defaults, labels, order | Manager on, Customer Service off; labels from the QA document; sort order 14-16; all TEMPORARY until Step 10 (D51, SE-02) |
| OQ-7 | `ackText` before Step 4 | a data key with no table or function; `ack_text_versions` and its writer come with Step 4 (D43) |
| OQ-8 | The Manager's audit view | unchanged: he reads `profile.deleted` rows of Technician and Customer Service accounts (actor: the Creator) |
| OQ-9 | Side effects of a deletion | none beyond the account: open visits, open creation intents and the technician's "פעיל" stay as they were (as for a deactivation; the office reassigns) |
| OQ-10 | A confirmation token for deletion | none in the database: the explicit confirmation is the screen's, and the expected version makes a stale screen fail (PT409) |

## 14. Hand-offs
- **Step 2 (Auth admin actions and screens):** the creation and deletion contracts of section 5 (ban or soft-delete the Auth user and end its sessions after `admin_delete_user` commits); the port changes and new error texts of section 5; the unified user-management screen with "הוסף משתמש", no "בקשות לאישור", deletion by the Creator only and no role change by the Manager (M-06, C-01, C-02); deleted accounts hidden from lists and pickers; the Creator's in-app notices from the audit rows (the Manager's Customer Service creations and activations are now direct actions; whether they are notices is a Step 2 question).
- **Step 3 (telemetry, C-03 to C-06):** the telemetry migration adds `usage_events` and its Creator-only functions, gated by `private.is_creator()` or `has_permission('usage')`, which only the Creator has.
- **Step 4:** `ack_text_versions` (D43) and its writer, gated by `ackText`.
- **Step 6:** the ingestion assigns visits only to technicians whose profile is active and not deleted.
- **Step 10:** the matrix screen shows the 16 keys (the Creator's `usage` fixed and granted) and the owner approves the final values (pre-pilot gate, D51).
- **Owner:** the `docs/security.md` alignment (section 8); OQ-1 to OQ-10.
