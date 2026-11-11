# Step 1 / PR 1.5: Migration 3 (service calls, visits and their history)

**Status (2026-11-11):** prepared and tested locally only. **Not applied** to any remote database. Draft PR stacked on PR #14 (Migration 2), which is stacked on PR #12 (Migration 1). Applying it needs the owner's separate approval of the exact file (D52 rule 4, D55); merging needs the owner's acceptance of approval item A1 (section 8). Process per D58: one independent review, no mutation testing, tests prioritise RLS, permissions, role isolation, data integrity and migration safety.

| File | sha256 |
|---|---|
| `supabase/migrations/20261106120000_service_calls_visits.sql` | `e8b8414b59a7799eef4e43c84e6006cc21dbf81589b2f34b9add7d55598acaef` |
| `supabase/rollback/20261106120000_service_calls_visits.down.sql` | `2074a4ad3bc99fab8b82b5be62afcdd64354e625857cbc951ebeebc0ca7dcb41` |
| `tests/db-canary/20261106120000.sql` | `91f8cab78d5e24c23e77aadd4a57e64db678657b1d32d3c0d169e0536733ef85` |

## 1. Files
- Migration, rollback (down) script and canary-rows fixture (table above).
- New pgTAP files: `tests/db/140_calls_visits_schema`, `150_calls_visits_markers`, `160_call_status`, `170_visit_integrity`, `180_calls_visits_rls`, `190_visit_functions`, `200_time_reports`.
- Updated tests for the new objects: `010` (grants, EXECUTE list, policy and SECURITY DEFINER counts, the view allow-list), `015`, `060`, `070` (census rows), `100`, `120` (Settings deletes of a row in use), `130`, `990` (rollback round trip and refusals); `tests/ci/check-migrations.test.mjs` (pinned writer list).
- `scripts/check-migrations.mjs`: one `ALLOWED_WRITERS` entry (section 8). Protected file (D55): merge gate.

## 2. Objects the migration creates (for the apply approval)
- **Tables (7):** `service_calls`, `visits`, `visit_reports`, `visit_signatures`, `visit_time_reports`, `visit_events`, `entity_changes`. RLS on every table; a test-data marker on every table (D47): `service_calls.is_test` is generated from `data_source`, the children copy it from their parent and refuse a client value.
- **View (1):** `visit_time_current` (`security_invoker = true`): the current time per visit and kind with computed sequence flags.
- **Policies (10):** all `SELECT`, `TO authenticated` (section 4). No write policy.
- **Functions:** `private.can_read_visit`, `private.previous_visits`, `private.visit_rep_contact`, `private.my_visit_details` (SECURITY DEFINER, each checks its caller) and their three `public` SECURITY INVOKER wrappers; `private.compute_call_status`, `private.recalc_call_status` (D38, the only writer of call status changes), `private.write_entity_change` (the only writer of `entity_changes`); trigger functions for markers, server times, one-way references (D47), visit numbers, state rules and time-report derivation; four deferred constraint triggers (`c10` visits, `c20` service calls, `c30` signatures, `c40` reports). `public.test_data_census` is replaced (same signature and ACL) to count the new tables.
- **Grants:** `SELECT` on the 7 tables and the view to `authenticated`; `EXECUTE` to `authenticated` only on the 3 wrappers and their 3 bodies. Nothing for `anon`, `service_role` or `PUBLIC`; no sequence grants. No write path for any API role: writers come in Step 4, Step 6 and PR 1.6 as SECURITY DEFINER bodies.
- **Indexes:** 17, including the partial unique `visit_time_reports_device_once_key` (one device report per visit and kind) and the card-list and dashboard indexes (`opened_at`, `resolved_at`, `visits (technician_id, scheduled_start)`).
- No extension, no role, no Storage bucket, no data rows (migrations never contain fictitious data, D47).

## 3. Relationships
- `service_calls` → `customers`, `products` (composite `(id, is_test)` foreign keys), `call_types`, `profiles` (handling representative). Request number unique across test and real rows.
- `visits` → `service_calls` `(id, is_test)`, `technicians`, `collection_locations`, `followup_reasons`, `profiles` (`cancelled_by`). Visit numbers per call in creation order (`next_visit_number`).
- `visit_reports`, `visit_signatures` (one each per visit, PK = `visit_id`), `visit_time_reports`, `visit_events` → `visits (id, is_test)`.
- `entity_changes` → a row of `customers`, `products`, `service_calls` or `visits` (checked by trigger; summaries and signatures can never be recorded there, so `card` content cannot leak through history).
- Every foreign key is `ON DELETE RESTRICT`; the new foreign keys to `followup_reasons` and `collection_locations` make the PR 1.4 Settings deletes answer "in use" (D55 (1)).

## 4. Who can do what (TEMPORARY D51 matrix values)
| Caller | Reads | Writes |
|---|---|---|
| `anon`, `service_role` | nothing (no grant) | nothing |
| Signed in without a profile, inactive profile | nothing; narrow functions 42501 | nothing |
| Technician (active) | his own `visits` rows (every status), his own `visit_reports` and `visit_signatures`; through the narrow functions, for his own open visits and own visits closed today (Asia/Jerusalem): call, customer, product, pickup and reason details (`my_visit_details`), representative name and phone (`visit_rep_contact`); for his own open visit, the earlier closed visits of the same call (`previous_visits`, D36). Never a `service_calls` row, another technician's reports, signatures or times, or later/concurrent visits of others | nothing |
| Customer Service, Manager | by key: `cal` or `calls` → calls, visits, time reports; plus `card` → summaries and signatures; `calls` → events and change history | nothing |
| Creator | everything | nothing |

Revocation is immediate (helpers read the current rows): re-assignment, closure, cancellation and deactivation end access at once (180, 190).

## 5. Function pattern
SECURITY DEFINER bodies in `private` with `search_path = pg_catalog, pg_temp`, schema-qualified names, no dynamic SQL; each body checks its caller and answers 42501 with a generic message. The `public` wrappers are SECURITY INVOKER and are not a boundary (PR 1.3 pattern). `can_read_visit` has no grant and no wrapper in PR 1.5 (DEV-16).

## 6. Hardening evidence (local database built from the migrations)
`010` and `000` pass with the new objects: no table, sequence or function privilege for `anon` or `PUBLIC` in `public` or `private`; RLS on every table; the exact grant and EXECUTE lists; SECURITY DEFINER functions pinned; the only view is `visit_time_current`, `security_invoker`. `015`: the wrappers resolve correctly under shadowed types in `pg_temp`.

## 7. Tests (local, 2026-11-11: pinned Supabase CLI 2.122.0, Postgres 17)
| File | Assertions | What it proves |
|---|---|---|
| `140_calls_visits_schema` | 72 | columns, types, CHECK sets, keys, RESTRICT, indexes, trigger order, deferred constraint triggers, view options |
| `150_calls_visits_markers` | 34 | D47 markers copied and immutable; one-way rules; append-only and delete/truncate refusals for every role |
| `160_call_status` | 47 | D38 status computation and recalculation, locking, history rows |
| `170_visit_integrity` | 89 | visit CHECKs, number allocation, server times, closed/cancelled rules, `c10`-`c40` run by a Technician, a Manager without `card` and `service_role`, signature immutability and hash, who cancelled a visit is kept, Settings deletes of a row in use |
| `180_calls_visits_rls` | 43 | policies and grants; every caller of section 4; Technician isolation (summaries and signatures named without a join through `visits`, plus direct counts); matrix keys turned off in turn; revocation; no direct write |
| `190_visit_functions` | 22 | result columns, EXECUTE privileges, `can_read_visit` per branch, the three narrow functions and their 42501 cases, revocation (all three functions) and the Asia/Jerusalem day boundary |
| `200_time_reports` | 16 | server-derived fields, one device report per visit and kind, reporter consistency, finite times, TEMPORARY flags, view precedence and sequence flags |

Full local run: 24 files, 1202 assertions, all pass. Canary-rows check (D54): PASS, 3 migrations, 3 fixtures, no coverage exception for PR 1.5. Migration guard: passed. `tests/ci`: 166 pass. **MIG-1** (found during the build, fixed in `e9d1d9e`): the warranty CHECK accepted a month while the warranty status was NULL; 140 case 7 now fails as intended. The review fixes of section 12 (S1, N1) close the same class of hole for infinite dates. No mutation testing (D58).

## 8. Migration guard change (needs the owner's acceptance; merge gate)
**A1:** `ALLOWED_WRITERS` gains `private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)` → `public.entity_changes` (the field-history writer of `docs/database-schema.md` §6; the actor is always `auth.uid()`). `scripts/check-migrations.mjs` is protected (D55 (8)): this PR is not merged before the owner accepts it.

## 9. Audit
No change to the PR 1.3 audit tables or their anchoring; field history goes to `entity_changes` (append-only, server time, actor = `auth.uid()`).

## 10. Rollout risks and rollback plan
- Apply order: Migration 1 (PR #12) → Migration 2 (PR #14) → Migration 3, each separately approved and verified (D55 (5)).
- Rollback: the down script runs only while the seven tables are empty, refuses when a later migration is recorded, and is one DO block (all or nothing); `990` runs it and every refusal. No remote rollback runs without the owner's explicit authorization (D55 (7) B6).
- Go-live: a `request_number` held by a leftover test call blocks a real invitation with the same number until the approved cleanup (PR 1.4 OQ-13).

## 11. Deviations (recorded, not asked)
DEV-1 bookkeeping columns; DEV-2 later columns moved to PR 1.6 / Step 4 (corrections, signature version and media); DEV-3 status and code values; DEV-4 deferred consistency checks beyond the schema example; DEV-7 the `010` view allow-list; DEV-8 `card` safe by construction; DEV-9 forced server times; DEV-12 extra integrity rules; DEV-13 the creating INSERT sets status `open`, `recalc_call_status` writes every change; DEV-14 constraint triggers on signatures and reports; DEV-15 `field_version` raised in PR 1.6 RPC bodies; DEV-16 `can_read_visit` private, no grant; DEV-17 `c10` rule (d) runs when a visit is inserted or its status or closure time changes, not when only a `visit_events` row is inserted (review S3; hand-off to the Step 4 and Step 6 writers, section 14); DEV-18 on a cancelled visit the continuation reason and next-visit notes can still be set (a D44 accepted closure needs them; review N2, PR 1.6 decides). DEV-5, DEV-6, DEV-10 and DEV-11 are the TEMPORARY answers of OQ-2, OQ-1, OQ-4 and OQ-12.

## 12. Independent review (D58: one review)
One review by an agent that did not write the code, on head `eba7971` (2026-11-11), read-only, with probes on the local database only. **Verdict: APPROVE WITH SHOULD-FIXES; no must finding.** No way was found for `anon`, `authenticated` (any role or profile state) or `service_role` to read a row it should not, or to write anything.

| Finding | Disposition |
|---|---|
| S1 (should): the warranty CHECK passed for `warranty_until = ±infinity` (`extract(day …)` is NULL) | Fixed: `isfinite(warranty_until)`; 140 cases 12 and 13 |
| S2 (should): 180 named summaries and signatures through a join with `visits`, so RLS on `visits` hid rows for the wrong reason | Fixed: names come from a postgres-owned `pg_temp` table; direct counts added (A on B's P1 signature, B on A's Q1 summary and signature, a `card`-only Manager) |
| S3 (should): `c10` rule (d) is not run when only an event row is inserted | Recorded as DEV-17 and a writer hand-off (section 14); a `c50` constraint trigger on `visit_events` is proposed for the first writer PR |
| N1: `visits_schedule_check` accepted infinite times | Fixed: `isfinite` on both columns; 140 cases |
| N2: `cancelled_by` could be rewritten on a cancelled visit; reason and notes can be set | `cancelled_by` frozen (170); reason and notes recorded as DEV-18 |
| N3: the header comment overstated which triggers fail closed | Fixed |
| N4: 190 did not test the Asia/Jerusalem day boundary or re-assignment for two functions | Fixed: visits closed at 00:30 local today and 23:30 local yesterday; re-assignment cases |
| N5: OQ-14 row said `done` → `followup` only | Fixed (section 13) |
| N6: `can_read_visit`'s office branch has no `card` | Hand-off: a Step 4 `visit_media` policy adds `card` itself (section 14) |

**OQ-13 (reviewer's answer): yes**, the three column-limited SECURITY DEFINER read functions fit `docs/security.md` §5 "narrow server functions": each checks the caller before reading, returns a fixed minimal column set, is STABLE and read-only, pins `search_path`, uses schema-qualified names and no dynamic SQL, and only `authenticated` may execute it. Conditions: the body is the whole control, so any later change (Step 4 adds parts, media and transcripts to `previous_visits`) needs the same review and an update of 190's exact-columns assertion; the reviewer recommends naming this category in `docs/security.md` §5 and `docs/database-schema.md` §9 (`docs/security.md` is protected: the owner decides). OQ-13 stays open for the owner. Fixes made after the review are on a later head; whether they need another review is D58 (9), open; this PR is not merged now.

## 13. Temporary behaviours (deny by default) and open owner questions
Each has a TEMPORARY behaviour that the tests assert; none is decided. The owner is asked only when one blocks the apply or creates a material security risk (owner, 2026-11-11).
| # | Question | TEMPORARY behaviour |
|---|---|---|
| OQ-1 | Which data of an earlier closed visit (D36) a Technician reads | only through `previous_visits`: number, scheduled start, status, technician name and colour, reason label, next-visit notes, summary and source, `is_test` |
| OQ-2 | Owner of the constraint-trigger functions | `postgres` (a dedicated non-login role would need a role in the project's instance, A4) |
| OQ-3 | What `resolved_at` holds | the resolving visit's `closed_at`; NULL when not resolved |
| OQ-4 | Does `card` alone open summaries and signatures | `card` and (`cal` or `calls`) |
| OQ-5 | Required invitation fields | task number, representative name, city, street, call type and fault are NOT NULL |
| OQ-6 | Formats and length limits | the plan's values (request 1-32 ASCII, task 1-40, notes 1000, summary 4000, signer 100, approval text 2000) |
| OQ-7 | Warranty values | `yes` / `no` / NULL; month stored as its first day; raw text only with a parsed value |
| OQ-8 | Representative phone | invitation name; phone only from an active office profile, else NULL |
| OQ-9 | Second customer phone for Technicians | excluded |
| OQ-10 | Technician access to own cancelled visits and visits closed before today | the bare `visits` row stays readable; the narrow functions serve only open visits and visits closed today |
| OQ-11 | Time-flag thresholds; a second technician's report after re-assignment | 2 min future, 5 min offset, current assignment only; one device report per visit and kind (23505, PR 1.6 routes it to review) |
| OQ-12 | Technician reads of whole `service_calls` rows | none; call fields only through `my_visit_details` |
| OQ-13 | The narrow SECURITY DEFINER read functions as `docs/security.md` §5 "narrow server functions" | as built; to be confirmed by the independent review; **the migration is not applied before the owner answers** |
| OQ-14 | Correcting a closed visit's outcome | no writer; the schema allows `done` → `followup` (reason and notes required, the signature stays) and `followup` → `done` only with a signature inserted in the same transaction |
| OQ-15 | Signature version and media columns | added in Step 4 as nullable columns required for new signatures |

Carried: open decision 3 (d06): `c10` rule (b) requires a summary for a closed visit. Approval items: **A1** (section 8), **A2** apply only after Migrations 1 and 2 are applied and merged and OQ-13 is answered, **A3** remote checks approved one by one, **A4** only if OQ-2 option 1 is chosen.

## 14. Limits and hand-offs
- **Step 4:** the closure writer (status, summary, signature, events, recalculation; `c10`-`c40`); signature columns (OQ-15); `previous_visits` grows with parts, media and transcripts (same independent review; update 190's exact-columns assertion); a `visit_media` policy adds `card` itself (`can_read_visit` has no `card`, review N6).
- **First writer PR (Step 4 or Step 6), review S3:** add `c50`, a deferred AFTER INSERT constraint trigger on `visit_events` (SECURITY DEFINER, the `c10` pattern) that re-runs rule (d) for the event's visit and requires `from_status` = the previous `to_status`; until then every writer inserts events only together with the visit change they record.
- **Step 5:** office phone numbers through a narrow function; cancellation (open decision 5).
- **Step 6 (now before Step 3, owner 2026-11-11):** the ingestion contract: create calls with status `open`, visits with their `created` event and the recalculation in one transaction; refuse to link a real invitation to a test call or product (D47); which call fields a later invitation updates.
- **PR 1.6:** corrections (`source = 'correction'`), review items, accepted reports, `field_version`, outcome correction (OQ-14), a second technician's reports (OQ-11).
- **Step 9:** filter Asia/Jerusalem days and months as half-open `timestamptz` ranges so the indexes are used.
