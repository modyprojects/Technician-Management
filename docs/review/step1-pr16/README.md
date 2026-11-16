# Step 1 / PR 1.6: Migration 4 (integrity and offline)

**Status (2026-11-16):** prepared and tested locally; **not applied**, not pushed. Branch `claude/step1-pr16-integrity-offline`, stacked on PR 1.5's head `5b2d2be` (Migrations 1-3; Migration 3 is approved but not applied yet). Applying Migration 4 needs the owner's separate approval of the exact file, after Migration 3 is applied and merged (D52 rule 4, D55). Merging needs the owner's approval (D59) and one independent review (D58), which has **not** run yet (section 12).

| File | sha256 |
|---|---|
| `supabase/migrations/20261107120000_integrity_offline.sql` | `2052f4de452b1ae7f64835b9acdcbbdaef57b09714ffa1f8dd900dc810ab2ffd` (1,349 lines, 81,525 bytes; 228 `\u` and 52 `\U` escapes) |
| `supabase/rollback/20261107120000_integrity_offline.down.sql` | `bfc38a8350e99b979d68a343d27ee1ecae413f8fe532df842008c1f391a47bf0` |
| `tests/db-canary/20261107120000.sql` | `93a5ab2c927e4151897f26122b744c260b46a2260ebd9318fab25778e0fbe989` |

## 1. Files
- Migration, rollback (down) script and canary-rows fixture (table above).
- New pgTAP files: `tests/db/220_hardening_assertion_m4`, `230_integrity_schema`, `240_integrity_writers`, `250_integrity_rls`, `260_offline_idempotency`.
- Updated tests for the new objects: `010` (allow-lists and three new checks), `015` (the two writers under `pg_temp` type shadowing), `060`, `100` and `150` (TRUNCATE sets: the new tables reference `service_calls`, `visits` and `profiles`), `070` (census), `140` (the four Migration 3 objects that Migration 4 changes, in their final form), `990` (the PR 1.6 down script runs first); `tests/ci/check-migrations.test.mjs` (pinned writer list, PR 1.6 guard cases) and `tests/ci/hardening-assertion.test.mjs` (section 12 copies).
- `scripts/check-migrations.mjs`: four `ALLOWED_WRITERS` entries (section 8). Protected file (D55): merge gate.

## 2. Objects the migration creates or changes (for the apply approval)
- **Tables (3):** `review_items`, `visit_corrections`, `offline_operations`. RLS on each; a test marker on each (D47), copied from the parent (`review_items` from the call, the other two from the visit) and frozen.
- **Changes to Migration 3 tables (no row changes):**
  - `visit_time_reports`: two nullable columns `correction_id`, `accepted_review_id` without a default; the source CHECK widened to `device` or `correction` (exactly one of the two ids for a correction); two CHECKs for the value shapes; two composite foreign keys `(…, is_test)`; two partial indexes; the table comment.
  - `visits`: `UNIQUE (id, service_call_id)` (the parent key of `review_items`) and the trigger `t13_field_version`.
- **Audit:** `audit_logs` CHECKs gain the actions `visit.corrected`, `review_item.resolved` and the targets `visits`, `review_items` (the 28 actions and 7 targets of Migrations 1-2 unchanged); `private.tg_audit_target` replaced (two more target branches).
- **Functions (12 new, 3 replaced):**
  - Trigger functions (SECURITY INVOKER, no grant): `tg_call_child_marker`, `tg_review_item_state`, `tg_visit_correction_guard`, `tg_offline_operation_derive`, `tg_visit_field_version`; replaced: `tg_time_report_derive` (the PR 1.5 rules unchanged plus the two kinds of correction rows), `tg_audit_target`.
  - Internal helpers for the Step 4 and Step 6 writers (SECURITY INVOKER, no grant, no wrapper): `private.create_review_item`, `private.offline_operation_replay`, `private.record_offline_operation`.
  - Writers (SECURITY DEFINER in `private`, each checks its caller) with SECURITY INVOKER wrappers in `public`: `correct_visit` (D14) and `resolve_review_item` (D44).
  - `public.test_data_census` replaced (same signature and ACL; three more rows).
- **Policies (4):** all `SELECT`, `TO authenticated` (section 4).
- **Grants:** `SELECT` on the 3 tables to `authenticated`; `EXECUTE` to `authenticated` on the 2 wrappers and their 2 bodies. Nothing for `anon`, `service_role` or `PUBLIC`; no sequences (uuid keys).
- **Section 12:** the fail-closed hardening check, a byte-identical copy of Migration 3 section 12, as the last statement.
- No extension, role, view, Storage bucket or data row (D47).

## 3. Relationships
- `review_items` → `service_calls (id, is_test)`; `(visit_id, service_call_id)` → `visits (id, service_call_id)`, so an item's visit belongs to its call; `submitted_by_profile_id`, `resolved_by`, `updated_by` → `profiles`. `dedupe_key` unique.
- `visit_corrections` → `visits (id, is_test)`, `corrected_by` → `profiles`; unique `(visit_id, version_after)`.
- `offline_operations` → `visits (id, is_test)`, `actor_profile_id` → `profiles`, `(review_item_id, is_test)` → `review_items`.
- `visit_time_reports (correction_id, is_test)` → `visit_corrections`, `(accepted_review_id, is_test)` → `review_items`.
- Every foreign key `ON DELETE RESTRICT`; no row of the three tables is ever deleted.

## 4. Who can do what (TEMPORARY D51 matrix values)
| Caller | Reads | Writes |
|---|---|---|
| `anon`, `service_role` | nothing (no grant) | nothing |
| Signed in without a profile, inactive profile | nothing; writers 42501 | nothing |
| Technician (active) | his own `offline_operations` rows (also after a re-assignment); no review item, no correction (OQ-11) | nothing directly; the Step 4 device writers will record his operations |
| Customer Service | with `card` and (`cal` or `calls`): review items, corrections; with `conflicts` (off by default): operations | `resolve_review_item` with `conflicts` (off by default), never an item about a server-closed or cancelled visit (D14); never `correct_visit` |
| Manager | as Customer Service by key (defaults: all three tables) | `correct_visit` (fixed D14 capability; TEMPORARY also `card` and `cal` or `calls`, OQ-1); `resolve_review_item` with `conflicts` (D14 items too, with a note) |
| Creator | everything | both writers (a real Creator may touch test rows; a test caller never a real row, D47) |

Revocation is immediate (the helpers read the current rows): deactivation and matrix changes take effect at the next query (250).

## 5. Function pattern
- **Writers** (`correct_visit`, `resolve_review_item`): SECURITY DEFINER in `private`, `search_path = pg_catalog, pg_temp`, schema-qualified names, no dynamic SQL. Order: the caller (`require_caller`, profile locked FOR SHARE), the keys (OQ-1), the input (22023), the target locked FOR UPDATE (unknown, or a test caller with a real target: generic 42501), the state (55000), the version (PT409), the target's rule, the write, field history (`write_entity_change`) and the audit row (`write_audit`) in the same transaction. Errors from a write are mapped to 22023 without DETAIL. `resolve_review_item` locks the call, the visit and the item in that order (as `recalc_call_status`).
- **Helpers** (`create_review_item`, `offline_operation_replay`, `record_offline_operation`): SECURITY INVOKER, no grant; the submitter and the actor are always `auth.uid()` of the session (never a parameter), as in `write_audit` and `write_entity_change`. `offline_operation_replay` serializes the operation id with a transaction advisory lock.
- **Step 4 device-writer contract:** `offline_operation_replay` → (a replay returns the stored result) → apply, or store for review with `create_review_item` → `record_offline_operation`, all in one transaction. `260` runs a scratch writer of exactly this shape.

## 6. Hardening evidence (local database built from the migrations)
- `000`, `010` and `015` pass with the new objects: no privilege for `anon` or `PUBLIC`; RLS on every table; the exact grant and EXECUTE lists; every SECURITY DEFINER function pinned and in `private`; the helpers have no grant and no wrapper; the two writers run correctly with `text`, `uuid`, `jsonb` and `timestamptz` shadowed in the caller's `pg_temp`, and the shadow domains never ran as `postgres`.
- Section 12 passes on the migrated database; `220` shows it fails closed on 22 injected leaks on the new objects (table, column and function privileges, RLS, policies, `search_path`, owners, a definer view, a materialized view, default privileges).

## 7. Tests (local, 2026-11-16: pinned Supabase CLI 2.122.0, Postgres 17)
| File | Assertions | What it proves |
|---|---|---|
| `220_hardening_assertion_m4` | 25 | the section 12 copy against 22 injected leaks, an invoker view passes, two clean runs |
| `230_integrity_schema` | 25 (table-driven: 11 marker, 25 item, 24 correction, 16 time-report, 21 field_version, 10 go-live cases) | columns, keys, CHECKs, indexes, triggers, RLS, comments; D47 markers, composite keys, one-way rule; review-item state machine; the D14 correction guard and value rules; the two correction-row kinds (an accepted report keeps its original receipt time); `field_version`; `visit_time_current` precedence and flags |
| `240_integrity_writers` | 23 (table-driven: 10 + 2 + 24 correction cases, 16 + 2 + 16 resolution cases, 4 go-live cases) | both writers per caller and key, input, state, version; effects (append-only rows, versions, entity history, audit, the accepted report), call status unchanged, deferred checks and audit chain valid; D47 test caller vs real rows |
| `250_integrity_rls` | 9 (17 caller cases) | exact policies and grants; reads per role and key (`calls` without `card` reads no item or correction); Technician isolation; revocation; no direct write, also with a temporary grant |
| `260_offline_idempotency` | 16 | applied once, replay returns the stored result, another payload, visit or user refused, a second report routed to review, the advisory lock, helper value rules, immutable rows, review dedupe |
| Updated `010` / `015` / `060` / `070` / `100` / `140` / `150` / `990` | 42 / 22 / 61 / 28 / 67 / 72 / 34 / 83 | as section 1 |

Full local run: **31 files, 1,387 assertions, all pass.** Node (`npm run test:ci`): **190/190**. Migration guard: passed. Canary-rows check: **PASS**, 4 migrations, 4 fixtures, no new coverage exception. `npm run lint` and `npm run typecheck`: clean. `git diff --check`: clean. No mutation testing (D58).

Rollback round trip (local): the down script, run in a rolled-back transaction, leaves a catalog equal to a database built from Migrations 1-3 alone on 13 fingerprints (functions, function ACLs, constraints, triggers, columns, relations with ACL, RLS and comments, indexes, policies, the three restored functions, the audit anchor fingerprint, the history); `990` asserts the eight catalog fingerprints and the restored function texts.

## 8. Protected-file changes (need the owner's approval; merge gate)
- **A1, `scripts/check-migrations.mjs` (D55 (8)):** four `ALLOWED_WRITERS` entries, each pinned to its exact signature and tables; nothing else in the guard changed:
  - `private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb)` → `public.review_items` (the one store of review items, D44; dedupe; the submitter is `auth.uid()`).
  - `private.record_offline_operation(uuid,uuid,text,text,integer,timestamptz,text,integer,text,integer,uuid)` → `public.offline_operations` (the one store of device-operation outcomes, D46; the actor is `auth.uid()`).
  - `private.correct_visit(uuid,text,text,text,integer)` → `public.visit_corrections`, `public.visit_time_reports` (D14 corrections; a corrected field time is a new time report, D45).
  - `private.resolve_review_item(uuid,integer,text,jsonb,text)` → `public.visit_time_reports` (the accepted second device report, PR 1.5 OQ-11).
  - `offline_operation_replay` only reads and locks: no entry. Without the four entries the guard fails exactly at the five INSERTs (`tests/ci`).
- **A2, `tests/db-canary/20261107120000.sql` (D54):** a new fixture (adds rows only; it makes the check cover the new tables and columns). `tests/db-canary/coverage-exceptions.json` is **unchanged**.
- No other protected file changed.

## 9. Audit anchoring
Replacing `private.tg_audit_target` changes the anchor's `functions_md5` (as in PR 1.4):

| Value | Migrations 1-3 | Migrations 1-4 |
|---|---|---|
| anchor `functions_md5` | `d30c54fba69e0689cd53735e46f99404` | `9c962b84a36e6218412e234d9042eb44` |
| `md5(prosrc)` of `private.tg_audit_target` | `d25cf9e179600a75b7812b9a04c23d29` | `175c9ba2bc2afd655f122bbb288b0605` |
| `md5(prosrc)` of `public.test_data_census` | `4a651f5edf43d06916c45ebc7654ae05` | `145bc11b6ba6d9d5572b0b4b7408a550` |
| `md5(prosrc)` of `private.tg_time_report_derive` | `5a07fe647a2d760096b6b8f1091f6b01` | `e04c1a723b66114fb4689d08df614141` |

`md5(prosrc)` of the new functions (post-apply check; independent of the server version): `correct_visit` `6fd20268a60afa096e126fde11ef7a0a`, `resolve_review_item` `e17beb28b82e49470b1828494021515f`, `create_review_item` `bb87689ae0e3dd072bac9af1aefb5d8a`, `offline_operation_replay` `93623d6b2a6e8870d3476d985d30b0ca`, `record_offline_operation` `577a254f5ac99324b93f08be20c15767`, `tg_call_child_marker` `1366f6828f3da5553c15704dc13add1d`, `tg_review_item_state` `6152ce511848d03bf4bbb070f1183d9c`, `tg_visit_correction_guard` `43770c3344582667f5c6f973f857fa36`, `tg_offline_operation_derive` `498c517ec9edef31c924fdc4f9124ef2`, `tg_visit_field_version` `8b7732d86c2265b725c6b4045e8a41f6`, `public.correct_visit` `ec5007ae4a9665080371e79bbf16e2cf`, `public.resolve_review_item` `ffc8f44e57ca869e2a91895f855f64f8`.

Procedure (each step needs its own approval): verify the latest recorded anchor before the apply (or compare `functions_md5` with the Migrations 1-3 value if the remote audit log is empty); after the apply, compare the values above; only then record a new anchor.

## 10. Rollout risks and rollback plan
- **Order:** Migration 3 applied and merged first (Migration 4 changes its tables and replaces one of its functions), then Migration 4 with a separate approval of the exact file.
- **Apply delivery:** the file has 228 `\u` and 52 `\U` escapes, so the apply should use the self-verifying wrapper of Migrations 2 and 3 (the tool layer turns a typed `\uXXXX` into the literal character; it happened once while this file was written and was corrected: `tests/ci/source-text.test.mjs` caught it).
- **Rollback:** `supabase/rollback/20261107120000_integrity_offline.down.sql`, as `postgres`, before the PR 1.5 down script, only before any PR 1.6 data exists. One DO block; it refuses first (55000) when a later migration is recorded, when any review item, correction or offline operation exists, when a time report is a correction, when an audit row records a PR 1.6 action or target, or without a history row (version `20261107120000` or name `integrity_offline`). It restores the three replaced functions byte for byte and the two audit CHECKs, the `visit_time_reports` source CHECK and comment, drops the new objects and the two columns, and deletes the history rows. No CASCADE, no dynamic SQL. No remote rollback runs without the owner's explicit authorization (D55 (7)).
- **Audit anchor:** changes by design (section 9).

## 11. Deviations from `docs/database-schema.md` (recorded, not asked)
- **DEV-1** `review_items` columns beyond the ER sketch: `source` and `source_ref` (where the submission came from), `base_version` (D44 per-field base values; the screen's `base`), `resolution_choices` and `resolution_note` (per-field choices; the D14 note), and the bookkeeping `updated_at`, `updated_by`, `version` (the resolution's `expectedVersion`).
- **DEV-2** `visit_corrections` stores one field per row (`field`, `old_value`, `new_value`) instead of a free `changes` set: the `visits.correct` port corrects one field at a time, and typed per-field CHECKs validate the value (TEXT-SAFE-ML, a reason id, a time with its offset); the server time is `recorded_at`.
- **DEV-3** `offline_operations`: `visit_id` NOT NULL (every work-queue kind of `features/sync` is visit-scoped); `review_item_id` added (the result of an operation stored for review); only final results are stored (OQ-10); no `clock_skew_ms` column (the skew of a field time stays on its time report).
- **DEV-4** Corrections are append-only (OQ-7): `visit_reports` and the visit row keep the as-closed values. Migration 3's `t10` on `visit_reports` still allows `summary_text` to change; no writer changes it (hand-off: a later migration may freeze it).
- **DEV-5** `field_version` is raised by a trigger, as §1 designs it (Migration 3's DEV-15 said "in PR 1.6 RPC bodies"); only the call-level D39 changes (customer, SKU) raise it in their Step 6 writer (+1 allowed, nothing else).
- **DEV-6** A stale `expectedVersion` of a correction is refused (PT409) instead of §1's merge / `edit_conflict` path (OQ-8).
- **DEV-7** For the non-card visit fields (continuation reason, next-visit notes) a correction also writes `entity_changes` (source `correction`), although the stored column keeps the as-closed value: `entity_changes` records the history of the field's current value, so users with `calls` (without `card`) see it. Summaries and times are not entity fields (card content, time reports).
- **DEV-8** Accepted second device reports and office corrections share the source `correction` (§3: "device or correction"), told apart by `accepted_review_id` vs `correction_id`; an accepted report keeps its original receipt time (Migration 3 section 8's comment; OQ-13).
- **DEV-9** `review_items` and `visit_corrections` are read with `card` and (`cal` or `calls`) (OQ-2), narrower than §8.3's `card` alone, as PR 1.5 OQ-4 did for summaries.
- **DEV-10** No Technician access to `review_items` (§8.3: "only through a function"); OQ-11.
- **DEV-11** The three helpers are created without a caller in this migration (as Migration 3's `write_entity_change`); their first callers are the Step 4 and Step 6 writers.
- **DEV-12** `visits` gains `UNIQUE (id, service_call_id)` (the parent key the §4 composite foreign key needs).

## 12. Independent review (D58: one review)
**Not run yet.** This PR changes database authorization (two SECURITY DEFINER writers, four policies, grants) and a protected file, so D53 (4) and D58 (1) require one review by an agent that did not write the code, recorded in the PR, before the merge. Suggested focus: the caller checks and their order in both writers, the D14 rule in `resolve_review_item` (the visit's status read under the lock), the D47 test/real rule, `tg_time_report_derive`'s new branches, the down script, and the four guard entries.

## 13. TEMPORARY behaviours (deny by default) and open owner questions
Each has a TEMPORARY behaviour that the tests assert; none is decided. The owner is asked only when one blocks the apply or creates a material security risk (owner, 2026-11-11).

| # | Question | TEMPORARY behaviour |
|---|---|---|
| OQ-1 | Do corrections and review decisions need the screen's keys? | yes: `card` and (`cal` or `calls`) besides their own rule (the demo's screens need both; `docs/architecture-data-access.md` G-04) |
| OQ-2 | Who reads review items and corrections | `card` and (`cal` or `calls`); operations: `conflicts` or the Technician's own |
| OQ-3 | Does a D14 review item need `conflicts` too? | yes: Manager or Creator **and** `conflicts`, with a note; Customer Service never |
| OQ-4 | Which decisions PR 1.6 applies | `keep_current` for every type; `apply_incoming` for `duplicate_time_report` only; `per_field` for none; the others come with their writers (55000 until then) |
| OQ-5 | Correctable fields | summary, continuation reason, next-visit notes, departed, arrived, ended; no parts before Step 4; never the signature, signer or approval text (D43) |
| OQ-6 | Correcting a closed visit's outcome (PR 1.5 OQ-14) | not offered; status and outcome never change through a correction |
| OQ-7 | In-place or append-only corrections | append-only: the as-closed values stay, the newest correction is current; Technicians keep seeing the as-closed values (the phase G question in `docs/architecture-data-access.md`) |
| OQ-8 | A stale correction | refused (PT409); no merge, no `edit_conflict` item for office corrections |
| OQ-9 | Value sets | review types (9), sources (`invitation`, `device`), decisions (3), operation types (7, from `features/sync`), results (`applied`, `review`); codes only grow |
| OQ-10 | Is a refused device operation stored? | no: only final results; a refused operation leaves no row, so the device may retry it with the same id (D46, TE-24) |
| OQ-11 | The Technician's view of his review items | none yet (deny); his own operation rows show applied or waiting for review |
| OQ-12 | Dedupe-key and reference format | the opaque reference format of Migration 2 (`^[A-Za-z0-9._:-]{1,200}$`) |
| OQ-13 | Receipt time of an accepted second report | the review item's creation time (when the server received it), credited to its reporter |
| OQ-14 | Which changes raise `field_version` | status, technician, city, street, building, floor, apartment; the call's customer and SKU through their Step 6 writer |

## 14. Hand-offs
- **Step 4:** the device writers follow the contract of section 5 (T-01, T-09, X-06); the apply paths of `closure_of_cancelled_visit` (status from cancelled, D09 completion email exactly once with Step 7, `recalc_call_status`), `approval_text_mismatch` (with `ack_text_versions`, D43) and `edit_conflict` (`per_field`); the `c50` constraint trigger on `visit_events` (PR 1.5 review S3) with the first writer that inserts events; parts corrections with `visit_parts`; a narrow function for the Technician's submissions (OQ-11); open decision 25.
- **Step 6:** the D39 apply paths (`reassignment`, `cancellation` with open decision 5, `address_change`, `customer_change`, `sku_change`), which widen `service_calls`' `t10` for `customer_id` and `product_id` only then and raise the call's visits' `field_version` by one; the dedupe key per invitation event.
- **Step 5:** the call card's current values: the newest correction per field over the as-closed value (`visit_time_current` for times).
- **PR 1.8 (Migration 5):** a further `tg_audit_target` replacement changes the anchor again.
- **Owner:** PR 1.5 OQ-14 (outcome correction) and DEV-18 (reason and notes on a cancelled visit) stay open.
