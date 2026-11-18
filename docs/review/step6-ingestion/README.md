# Step 6 — calendar ingestion and the Outlook invitation simulator (server side)

**Status (2026-11-17):** branch `claude/step6-calendar-ingestion` (from `claude/step2-pr25-login`). Server side only: no screen (the simulator button inside "זימונים שלא נקלטו" and the list itself come with their screens, D60 (11), D62). **Migration 6 is local only: not applied to the remote project** (that needs the owner's separate approval, D52 rule 4). Two protected-file items wait for the owner (section 10): the migration guard's writer entry and the canary fixture. The independent review (APPROVE WITH FIXES) is answered in section 13; one TEMPORARY behaviour needs the owner's answer before the apply approval (OQ-13, the Hebrew question in section 14). Fictional data only (D47).

## 1. Sources

`docs/decisions.md` D08, D17, D19, D23, D24, D25, D38, D39, D41, D42, D44, D45, D47, D60 (3), (4) and (11), D61; `docs/demo-deviations.md` IN-01 to IN-06, PR-01 to PR-07, SIM-01 to SIM-19, QA-08, QA-17; `docs/spec.md` "Invitation intake"; `docs/outlook-template.md` (draft, owner task O2); `docs/database-schema.md` §2, §5, §10; `docs/qa-corrections-01-integration.md` X-01, X-03, S-05 and §3 step 5; `docs/ROADMAP.md` Step 6; `docs/security.md` §5, §7, §9; Migrations 3–5 (`service_calls`, `visits`, `review_items`, `create_review_item`, `recalc_call_status`, the Migration 5 hand-off on technician eligibility).

## 2. Design: one ingestion service

```
adapter (simulator now, Graph later)
  └─ InvitationEvent (normalized, Zod)            features/calendar/ingestion/event.ts
       └─ planIngestion: ignored | rejected | one command   plan.ts, parse.ts, template.ts, text.ts
            └─ IngestionStore.apply(command)       lib/calendar/supabase-ingestion-store.ts (RPC, caller's session)
                 └─ public.ingest_calendar_event → private.ingest_calendar_event   Migration 6 (one transaction)
```

- **Pure core** (`features/calendar/ingestion/`): no I/O and no clock. The same event always gives the same database command (timestamps canonicalized to UTC milliseconds), so a redelivery is a byte-identical replay the database recognises.
- **Simulator adapter** (`features/calendar/adapters/simulator/`): builds events for create, update, reschedule, reassign, cancel, invalid and duplicate (the full snapshot under the same event id for every new version, as a Graph update; duplicate = the same event delivered again). Its switch: `CALENDAR_SIMULATOR=1`, and always off when `VERCEL_ENV=production` (D24, SIM-11; open decision 21 is not decided, so off there). The name is in `.env.example`; no value is read or printed anywhere except by `lib/calendar/simulator-env.ts`, which returns a boolean. The switch holds at the server action only: the database cannot see it (TEMPORARY OQ-13, section 9).
- **Graph adapter** (`features/calendar/adapters/graph/`): types and an interface only, no network code (`GRAPH_ADAPTER_AVAILABLE = false`).
- **Server action** (`lib/actions/calendar-simulator.ts`, `runInvitationSimulator`): switch → Zod request → session (active Manager, Creator or Customer Service) → the service with the Supabase store under the caller's session. When the switch is off it answers `not-found` and does nothing. It returns the delivered event (so a screen can deliver it again) and the outcome; logs carry an event name and a code only. Nothing sends email (the Step 7 outbox never delivers test data, D24, SIM-09).
- **Database** (Migration 6): idempotency, ordering, Settings lookups, D19/D38/D39/D44 rules, every value's column rule and test marking happen in one transaction. The database is the boundary for **who** may write (it checks the caller again: an active Manager, Creator or Customer Service user) and for **what** is stored, but not for **whether the simulator is on**: Preview and Production share one Supabase project, so `public.ingest_calendar_event` answers any such session through the Data API whatever `CALENDAR_SIMULATOR` says. `docs/security.md` §9 ("disabled simulator endpoints return 404", "no public simulator API") and SIM-10 therefore hold at the server action only. TEMPORARY OQ-13 (open decision 21), with a go-live hand-off (section 9) and an owner question (section 14).

## 3. Migration 6 (`supabase/migrations/20261109120000_calendar_ingestion.sql`)

| Object | Why |
|---|---|
| `external_calendar_events` | Event identity (database-schema.md §5): unique `(data_source, calendar_id, event_id)`; the one visit the event created (`service_call_id`, `visit_id`, set once; one event per visit); `status` (deleted never comes back); the newest processed change (`last_change_key`, `last_changed_at`, never older). Root table: `data_source` fails closed (`simulator`, `automated_test`), `is_test` generated |
| `calendar_event_changes` | The ingestion log the task asked for: one append-only row per `(event, change key)` — the unique key that makes replays idempotent; `payload_sha256` (a replay must match), the source's change time (ordering), the server receipt time, the caller (`received_by`), the outcome (`applied`, `review`, `unparsed`, `stale`, `no_effect`), what it touched (call, visit, customer), the fields it applied and the parsed fields of a processed version (`snapshot`, the D39 base). The id is drawn before the change is applied, so field history and review items name it (`cal-change:<id>`) |
| `calendar_ingestion_errors` | The unparsed invitations (database-schema.md §5; S-05): machine-readable problems, the sanitized values that recognise the invitation (subject, organizer, attendees, times, request number, customer name), one open row per event, resolved once (`ingested`, `superseded`, `deleted`) by a later change of the same event |
| `tg_calendar_child_marker`, `tg_calendar_event_guard`, `tg_ingestion_error_state` | `is_test` of the two child tables from the event (D47); the event's state rules; an error's created-open / resolved-once rule |
| Shared triggers reused | `tg_immutable_except`, `tg_immutable_markers`, `tg_one_way_people`, `tg_bump_version`, `tg_reject_*`, `tg_history_server_time` |
| `ingest_text`, `ingest_timestamp` | Strict reading of the JSON command (a wrong type is 22023) |
| `ingest_safe_text`, `ingest_ascii_id`, `ingest_email` | The column text rules as predicates (TEXT-SAFE / TEXT-SAFE-ML and ASCII-ID of Migrations 2 and 3, written with the same code-point classes; the `technicians.outlook_email` form plus NFC, no forbidden code point or space variant): the writer applies them to every value before anything is read or written (review S1) |
| `ingest_field_source_at` | The D39 source time of a contact or call field: the newest change that applied it (derived from the log, no extra table) |
| `ingest_answer` | The writer's answer for a stored change (also for a replay) |
| `ingest_apply_visit`, `ingest_apply_call` | The visit-level and call-level rules of a new version (UPDATEs, `write_entity_change` and `create_review_item` only; they insert nothing) |
| `private.ingest_calendar_event` (SECURITY DEFINER) + `public.ingest_calendar_event` (SECURITY INVOKER wrapper) | The writer: the only path into the three tables, and the Step 6 writer of customers, products, service calls, visits and visit events |
| Census (`public.test_data_census`) | The three tables (events per source) |
| Policies | `calendar_ingestion_errors`: SELECT for every active Creator, Manager and Customer Service user (`private.is_office_user()`; the unparsed list, D60 (4), (11)); `external_calendar_events` and `calendar_event_changes`: the Creator only (TEMPORARY, OQ-1, open decision 15) |
| Grants | SELECT on the tables for `authenticated`; EXECUTE on the wrapper and the body only; nothing for `anon`, `service_role`, `PUBLIC` |
| Section 11 | The fail-closed hardening check, Migration 5's byte for byte |
| Down script | `supabase/rollback/20261109120000_calendar_ingestion.down.sql`: refuses once any Step 6 row exists, a later migration is recorded or the history row is missing; restores the census to its Migration 4 text; drops the Step 6 objects (no CASCADE, no dynamic SQL) |

No change to Migrations 1–5. No reference, test or fictitious row. `review_items`, `entity_changes`, `recalc_call_status` are used as built.

## 4. Idempotency and ordering

| Delivery | Result |
|---|---|
| Same event, same change key, same payload | **Replay**: the stored outcome, `replay: true`, nothing written |
| Same event, same change key, other payload | Refused, 23505, nothing written |
| New change key, change time not after the newest processed one (out of order, or equal time) | Recorded as `stale`, never applied |
| Any change after the event was deleted | Recorded as `no_effect` (OQ-2) |
| New, newer change | Processed |

Deliveries of one event are serialized (`pg_advisory_xact_lock` on the identity), new calls on one request number too, and customers and products are created with `ON CONFLICT DO NOTHING`, so concurrent invitations never create duplicates. The same rule is stated in TypeScript (`decideDelivery`, unit-tested). The change time comes from the source (Graph `lastModifiedDateTime`; the simulator's clock); more than 5 minutes ahead of the server is refused (OQ-9). At most 30 changes per user per minute (PT429, OQ-8); the limit is a count of the caller's recent change rows, not a lock (review N2, section 13). Concurrency is tested on the local stack (`tests/auth/calendar-ingestion-concurrency.spec.ts`, review S2).

## 5. Parsing rules (`docs/outlook-template.md`; examples fictional)

- **Recognition:** the subject must start with `[קריאת שירות]` (configurable prefix); any other meeting is **ignored** before the database (SE-13). Date and times come from the event, never the body. The technician is the attendee whose Outlook email matches `technicians.outlook_email` (case-insensitive; exactly one).
- **Body:** `label: value` lines, by label, not line order (IN-01); free text, indentation and CRLF are ignored; "טלפון נוסף" is never read as "טלפון"; a gershayim ״ in `מק״ט` reads as `"`; `—`, `–`, `-` or an empty value mean no value. A label repeated with another value is a problem (`duplicate_label`).
- **Labels from configuration:** `DEFAULT_INVITATION_TEMPLATE` (the draft's 21 labels) is a parameter; a configured label replaces it without code changes. "מספר פנייה" and "מספר לקוח" (D17, D35) and every field the database needs (NOT NULL: task, representative, customer name, phone, city, street, call type, product, SKU, fault) stay required whatever a configuration says.
- **Values** are checked against their columns' rules (TEXT-SAFE, ASCII-ID, the request-number and phone formats, lengths), so the database never refuses what the parser accepted. The writer checks every value again with the same rules (review S1), so a caller that bypasses the parser cannot store text a column would refuse, also where no CHECK reads it (review items, snapshots, problems). Attendee and organizer addresses: NFC, trimmed, lower case, no forbidden code point and no space variant on both sides (`isNormalizedEmail`, `private.ingest_email`).
- **Warranty** (D17, D42): `כן`, `לא`, `כן · עד MM/YYYY` (first day of the month stored with the raw text); anything else is `warranty_format`.
- **SKU** (D19, PR-07): trimmed and upper-cased for matching (`kt-2041 ` = `KT-2041`); an unknown SKU is never a problem.

Example (the template's fictional sample): `מספר פנייה: 48213`, `מק"ט: KT-2041`, `באחריות: כן`, `לאסוף מ: מרלוג`, attendee `tech-a@example.test` → one upsert command; a missing `מספר לקוח:` line → an unparsed command with `{"kind": "missing", "field": "customerNo"}` and the recognised request number 48213.

**Problem kinds** (S-05; `features/calendar/ingestion/types.ts`): `missing`, `invalid` (rules `format`, `length`, `duplicate_label`, `warranty_format`, `unknown_call_type`, `end_before_start`, `too_many_attendees`), `unknown_place` (IN-03), `unknown_technician`, `inactive_technician`, `ambiguous_technician`, `conflict` (rules `request_number_changed`, `real_service_call`, `real_customer`, `real_product`). Each has the field (template key, or `subject`, `attendee`, `organizer`, `schedule`, `body`) and the sanitized value read (at most 120 characters, invisible characters replaced by `?`). The database accepts a problem only with the members `kind`, `field`, `rule`, `value`: a rule only for `invalid` and `conflict`, from their closed lists, and a value null or TEXT-SAFE of at most 120 characters (writer and CHECK, review S1).

## 6. What an ingested change does

| Situation | Behaviour | Source |
|---|---|---|
| First valid version, new request number | Customer (by customer number) and product (by normalized SKU) found or created; call created open with visit 1; `visit_events` "created"; all `simulator` test data with `created_by` and `source_ref = cal-event:<id>` | D17, D19, D47, X-01 |
| First valid version, existing request number | The next visit of that call (`next_visit_number`); a resolved or awaiting-follow-up call reopens (`recalc_call_status`) | X-03, D38 |
| New version, scheduled visit | Re-assignment (new `assigned_at`, `field_version` +1), reschedule, address, notes, task number, pickup applied, each with an `entity_changes` row (source `invitation`) | SIM-03 |
| New version, visit en route or in progress | Re-assignment and address change → review items `reassignment`, `address_change`, only when the technician or the address changed in this version (compared with the event's previous processed version; a version that keeps them opens nothing, also after a `keep_current` decision; review M1); schedule, notes, task number, pickup applied | D39, OQ-5 |
| New version, closed or cancelled visit | No effect; an open unparsed row of the event is resolved `superseded`, not `ingested` (review N5) | D39 |
| Different customer number, customer name or SKU than the call | Review item `customer_change` / `sku_change` (once, when it changed in this invitation); the visit is still created or updated; nothing of the identity is applied or created | D39, OQ-4 |
| Contact details (phone, second phone) and call fields (type, fault, warranty, representative) | Applied field by field when not empty, different, changed in this invitation and newer than the field's source | D39, OQ-3 |
| Deleted invitation | Open visit → review item `cancellation`, the visit stays; closed visit or no visit → no effect; an open unparsed row → resolved `deleted` | open decision 5, OQ-2 |
| A problem (parse, lookup, conflict) | Not ingested; one open row on the unparsed list; an earlier version of an ingested invitation keeps its visit | S-05, IN-03, IN-04 |

## 7. Tests and results (this branch, local; after the review fixes, section 13)

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run test:ci` | 219 tests: **217 pass, 2 fail** — `the repository's migrations pass` and `V1-9 / rule 9`, both only because the guard has no entry for the new writer (section 10). With the proposed guard change applied to a fresh clone of this branch: 220/220 pass (one test added by the proposal) |
| `npm run check:migrations` | **fails** on exactly the writer's eleven INSERTs ("not allowed (only the reviewed writer functions in ALLOWED_WRITERS ...)"); with the proposed change (scratch copy): passes |
| `supabase test db tests/db` (isolated stack: a scratch copy of `supabase/` with its own `project_id` and ports, after `db reset`; the shared stack untouched) | 39 files, 1615 tests, PASS. The new `340` cases also ran against the previous migration text: 9 assertions fail there (M1, N3, N5, S1/N1, the office read) |
| `node scripts/db-canary.mjs` (isolated stack, database only, the proposed fixture copied into a scratch fixtures folder) | PASS: 6 migrations, 6 fixture files, R6 coverage 26 tables / 352 columns / 3 exceptions |
| Unit specs `tests/e2e/calendar-ingestion.spec.ts` | 32 passed |
| Local-stack `tests/auth` (`node tests/auth/run-local.mjs` against the isolated stack: `SUPABASE_BIN` wrapper, `AUTH_TEST_DB_CONTAINER`), incl. `calendar-ingestion.spec.ts` and `calendar-ingestion-concurrency.spec.ts` | 15 passed, 3 skipped (screenshots on demand) |
| `npm run build` (no environment values) | pass (after the known Next.js 16.4.3 upgrade nudge, retried; Next.js not upgraded) |
| `npm run scan:bundle`, `npm run scan:secrets` | pass (7,948 browser-delivered files; no leaks) |
| Default e2e (`npx playwright test`, three widths) | 2,767 passed, 0 failed, 2,996 skipped by project rules |

**pgTAP files:** `320_hardening_assertion_m6` (27: the section 11 copy against injected leaks on the new objects), `330_calendar_ingestion_schema` (23: columns, triggers, markers and the one-way rule, keys and value rules incl. the tightened address and problem CHECKs, state guards as postgres and service_role, grants, function classification, RLS per role incl. inactive office users, direct writes refused, census, comments, RESTRICT), `340_calendar_ingestion_writer` (47: callers, malformed commands, create, replay, conflict, stale, re-assignment and reschedule with history, follow-up and D39 ordering, reopening a resolved call, closed visit, unparsed rows and their resolution, every lookup problem, a changed request number, real records, a visit en route, deletion, identity reviews, call fields, D19 name and SKU, M1 and keep_current, N3, N5, every column rule and the stale and after-deletion content checks (S1, N1), rate limit, test marking, census, visibility per role, the bounded open list). Updated for the new objects (nothing removed or weakened): `010` (exact grant, EXECUTE and policy lists), `060` and `100` and `150` (truncate lists and temporary grants include the tables that reference service calls and visits), `070` (census rows), `130` (the writer is the allowed writer of customers and products, as that file foresaw), `280` (the PR 1.8 relation count leaves the three Step 6 tables out), `990` (the Step 6 down script runs first: 4 refusals, the run, the census restored to its Migration 4 text by md5).

## 8. Proposed canary fixture

`proposed-canary-fixture-20261109120000.sql` (this folder): two events, four changes, two resolved errors, every column of the three tables non-null at least once. Its header is written as the final file's (ready to copy to `tests/db-canary/20261109120000.sql` unchanged once the owner approves; review canary nit). **Run through `scripts/db-canary.mjs`** on an isolated local stack (a scratch copy of `supabase/` with its own `project_id` and ports, the database only; the shared stack was not touched), with a scratch copy of `tests/db-canary/` plus this file as `20261109120000.sql`: **PASS** — 6 migrations checked, 6 fixture files, coverage 26 tables and 352 columns with the 3 existing exceptions, R1–R7 clean. Without a fixture at `tests/db-canary/20261109120000.sql`, the CI canary check fails rule R6 after Migration 6.

## 9. TEMPORARY behaviours and open questions for the owner

Deny by default, labelled in the migration header; each is "Step 6 OQ-n".

| # | Temporary behaviour | Owner question |
|---|---|---|
| OQ-1 | "זימונים שלא נקלטו" (`calendar_ingestion_errors`) is readable by every active Creator, Manager and Customer Service user (a fixed capability, `private.is_office_user()`; D60 (4) gives Customer Service the item, D60 (11) the simulator button, Version 1 office scope); the event identity and the change log (snapshots with customer contact data) by the Creator only; a Technician, an inactive user, anon and service_role read nothing. The screen reads the open rows newest first, one bounded page, through RLS and the `(status, created_at)` index; the source label comes from `is_test` | Which matrix key gates "זימונים שלא נקלטו" (open decision 15)? |
| OQ-2 | A deleted invitation never cancels a visit: open visit → `cancellation` review item | Open decision 5: what deleting an invitation does to a scheduled visit |
| OQ-3 | Call type, fault description, warranty and representative follow the newest invitation field by field (like contact details); an empty optional field never clears a value | Confirm; or should the call keep the first invitation's values? |
| OQ-4 | A different customer number, name or SKU on an existing call opens a review item, the visit is still created, the incoming customer or product is not created | Confirm |
| OQ-5 | Visit en route: re-assignment and address → review; time, notes, task number and pickup applied | Pickup and task number are not named by D39; confirm |
| OQ-6 | A new visit or a re-assignment needs an eligible technician; an update that keeps him does not re-check | Confirm |
| OQ-7 | A changed request number on an ingested invitation is not ingested (conflict) | Confirm |
| OQ-8 | 30 changes per user per minute | Value |
| OQ-9 | Ordering by the source's change time; equal time with another key = stale; 5 minutes of future skew | Confirm |
| OQ-10 | Only the simulator source; `received_by` required | Step 11 |
| OQ-11 | No apply path for the invitation review types (resolve_review_item keeps `keep_current` only, PR 1.6 OQ-4) | The D44 apply paths come with the review screen |
| OQ-12 | The parsed fields of every processed version are kept (`snapshot`, customer contact data included; Creator-only read) | Retention: open decision 12 |
| OQ-13 | The simulator's switch (`CALENDAR_SIMULATOR`, off on Vercel Production) holds at the server action only: `public.ingest_calendar_event` stays callable through the Data API by any active Manager, Creator or Customer Service session on Preview and Production alike (one Supabase project), so `docs/security.md` §9 ("disabled simulator endpoints return 404", "no public simulator API") and SIM-10 hold at the action, not in the database. Bounded meanwhile by the caller check, fictional test-marked data only, no email, owner-only addresses (D29, D31). **Go-live hand-off (before any real use, D23):** a reviewed migration revokes EXECUTE on `public.ingest_calendar_event(jsonb)` and `private.ingest_calendar_event(jsonb)` from `authenticated`, or makes the body refuse unless an owner-set database flag allows the simulator (Graph gets its own session-less entry point, OQ-10) | Open decision 21; the question in section 14, to be asked before the apply approval |

Also open, not decided here: open decision 6 (email to the representative, pending; nothing is sent), open decision 13/14 (Microsoft 365 rollout, calendar), open decision 21 (simulator on the testing-period Production address: off at the action; OQ-13), the final template labels (owner task O2), real Outlook bodies with bidi marks before a label (not read as that label today; validate with real examples), a subject that loses the prefix on an ingested invitation (ignored today).

## 10. Protected files: what needs the owner

1. **Migration guard** (`scripts/check-migrations.mjs`, protected, D55 (8)): the writer inserts into eight tables, which rule 4 allows only to a reviewed `ALLOWED_WRITERS` entry, and its body holds the data_source value `'simulator'` once, which rule 4 forbids in a writer body. Proposed change, **not applied**: `proposed-guard-change.diff` (sha256 `aa7546e96cf0bd3f1f3141290eab85ad7d78bdea8939a72ebfa5e3034b3fceba`, made with `git diff` against this branch's files): one entry `private.ingest_calendar_event(jsonb)` → the eight tables, with `markers: ["simulator"]` (only that exact string, only in that writer); the pinned-list test now pins the markers too (`... markers=simulator`, review guard Fix 2); one new test: other marker text in the writer still fails, and the same string in another allowed writer, `private.write_audit(text,text,uuid,jsonb)` with its exact signature inserting into its own `public.audit_logs`, fails with exactly one problem, a test marker (the body without the string passes; review guard Fix 1). It only adds an entry and an exact-string exception; every other rule is unchanged. Re-verified in a scratch clone of this branch with the working changes: `git apply --check` clean, `npm run check:migrations` passes, `npm run test:ci` 220/220.
2. **Canary fixture** (`tests/db-canary/`, protected, D54): section 8.

## 11. Deviations from the planned design (database-schema.md §5)

- A third table, `calendar_event_changes`, holds the per-change identity, ordering and snapshot ("a snapshot per invitation" is kept per processed version, not on the event row).
- "The source of each contact field (D39)" is derived from that log (`applied_fields`, `ingest_field_source_at`) instead of a column per field.
- The identity column is named `data_source` (the D47 marker convention) instead of `source`.
- `calendar_ingestion_errors` has `status`/`resolution` instead of a resolved flag, and stores the reasons as structured problems (S-05).

## 12. Not verified here

- The CI canary-rows check (it ran locally on an isolated stack, section 8); the GitHub workflows (nothing pushed).
- A re-review of these fixes by an agent that did not write them (D53, D58).
- Any remote state: nothing remote was read or written.
- The Graph adapter (boundary only) and real Outlook bodies.
- The concurrency spec (S2) shows the outcome of simultaneous calls; whether the two transactions really overlapped in a given run is not observable from the outside (three rounds per case give them several chances).

## 13. Review fixes (independent review, APPROVE WITH FIXES)

Migration 6 is local only and unapplied, so it and its down script were changed in place (no new migration). Every fix has a test that fails on the previous migration (checked: `340` run against the previous text, 9 assertions fail).

| Finding | Resolution |
|---|---|
| **M1** (must): every later version re-opened `reassignment` and `address_change` items for a visit en route | **Fixed.** `ingest_apply_visit` takes the event's previous processed version (`p_base`, the snapshot `ingest_apply_call` already used) and opens an item only when this version's technician or address differs from the base (an empty optional address part is no change, OQ-3); a NULL base keeps the earlier behaviour; scheduled visits unchanged. `340` 9b: v2 (technician B, another city) opens 2 items; v3 (a note) and v4 (a time) open 0 and apply their change; after `keep_current` on both, v5 (arrival notes) opens 0; v6 (a third city) opens one `address_change` only |
| **M2** (must): the RPC is callable through the Data API whatever the simulator switch says | **Documented, TEMPORARY OQ-13** (linked to open decision 21) in the migration header, the section 5 and 6 comments (the misleading "the switch is on the server" lines replaced), the wrapper's comment and the section 10 hand-offs; README sections 2, 9 and 12. Go-live hand-off: revoke EXECUTE on the wrapper and the body, or gate the body on an owner-set flag, before real use. Owner question in Hebrew: section 14. `docs/security.md` not changed (protected) |
| **S1** (should): caller text stored without the column rules where no CHECK reads it | **Fixed.** Three predicates (`ingest_safe_text`, `ingest_ascii_id`, `ingest_email`) with the exact code-point classes of Migrations 2 and 3; the writer checks every field of an upsert (request number, task, representative, customer number and name, phones, address, notes, call type, product, SKU, fault, warranty, pickup), the subject, organizer and attendees, an unparsed change's recognised values, and each problem (members only `kind`, `field`, `rule`, `value`; a rule only for `invalid` / `conflict` from their closed lists; a value null or TEXT-SAFE of at most 120 characters) before anything is read or written (22023). CHECKs tightened too: `organizer_email` (NFC, no forbidden code point or space variant), `attendee_emails` (the same code points as jsonpath escapes), `problems` (closed members and rules, value type, length, code points, edge spaces). Writer-built problem values are trimmed after the 120-character cut. The TypeScript address rule now matches (`normalizeEmail` applies NFC; `isNormalizedEmail` refuses space variants). Tests: `340` 9c (39 refusals and a positive control at the limits), `330` (8 new CHECK cases), a unit spec |
| **S2** (should): no automated concurrency test | **Added** `tests/auth/calendar-ingestion-concurrency.spec.ts` (local stack): two signed-in office users call the RPC at once (`Promise.all`), three rounds: the same event twice → one processed, the other a replay of the same change; two events with one new request number → one call, visits 1 and 2; two new calls with one new customer number and SKU → one customer, one product, both calls linked to them. The auth harness accepts `AUTH_TEST_DB_CONTAINER` (default the project's container), so it can run against an isolated stack |
| **N1**: the stale and after-deletion paths recorded a change without checking its content | **Fixed.** The content is checked (step 2) before the rate limit, the lock, the replay, stale and deletion paths; a deletion's `problems` and `recognised` must be null too, an upsert's `recognised` too. `340` 9c cases 34–39 |
| **N2**: the rate limit is an unlocked count (parallel calls for different events can pass 30; replays and refused calls are not counted) | **Accepted, documented** for the TEMPORARY value OQ-8 (comment at the check, section 4). A locked or token-bucket limit comes with the owner's value |
| **N3**: `ingest_answer` counted items by reference only | **Fixed**: also `r.service_call_id = c.service_call_id`. `340`: an item on another call with the same reference is not counted in the replay answer |
| **N4**: a 23505 or a replay answer to another office user reveals that a change key exists for that event | **Accepted, documented**: office roles only (the caller check runs first), change keys are opaque and not secrets, a replay needs the identical command (so its answer tells the caller nothing new beyond the stored outcome) and the 23505 message carries no content |
| **N5**: a version for a closed visit resolved the open unparsed row as `ingested` | **Fixed**: `superseded` when the visit is closed or cancelled (nothing of the version applies), `ingested` when it reached an open visit. `340` N5 |
| **N6**: the size CHECKs can refuse the whole call (23514) | **Accepted, documented** (not trivial to turn into a problem: the unparsed row's own attendee CHECK has the same 8 KB limit). Limits: command 64 KB, snapshot 16 KB, attendee list 8 KB (20 addresses), problems 16 KB. With the field rules a snapshot stays well under 16 KB except with many long non-ASCII attendee addresses next to three full 1,000-character notes; such an invitation is refused with 23514 instead of being listed. Real invitations carry one to three attendees; the Graph adapter (Step 11) should keep only the addresses it needs |
| **N7**: deletions are planned whatever the subject (no subject on a deletion) | **Hand-off** (migration section 10): with Graph every deleted ordinary meeting would create an event row and a change; the Graph adapter must deliver deletions only for events `external_calendar_events` already knows (the simulator only deletes its own events) |
| Guard **Fix 1**: the new test's last assertion used `write_audit(jsonb)`, not an allowed signature | **Fixed in the proposal**: the exact `private.write_audit(text,text,uuid,jsonb)` into `public.audit_logs`, asserting one problem matching `/test marker/` and that the body without the string passes (section 10) |
| Guard **Fix 2**: the pinned-list test ignored `markers` | **Fixed in the proposal**: the pinned string includes `markers=simulator` (section 10) |
| Canary nit: the fixture header said "PROPOSED / not run" | **Fixed**: the header is the final file's; the fixture ran through `scripts/db-canary.mjs` on an isolated stack: PASS (section 8) |
| Coordinator addition (2026-11-17): the Creator-only read is too narrow for Version 1 (D60 (4), (11)) | **Changed**: `calendar_ingestion_errors_select_office` (active Creator, Manager, Customer Service); the events and the change log stay Creator-only (TEMPORARY OQ-1). Tests: `330` (each role, inactive Manager and Customer Service, no session; anon and service_role have no grant), `340` (visibility per role and the bounded open list newest first). The canary fixture and the guard proposal needed no change for it |

## 14. Owner question before the apply approval (OQ-13, Hebrew)

> **שאלה לפני אישור החלת מיגרציה 6 (התנהגות זמנית OQ-13, קשורה להחלטה הפתוחה 21):** בתקופת הבדיקות, כתובת ה-Preview וכתובת ה-Production משתמשות באותו פרויקט Supabase. הסימולטור כבוי ב-Production רק דרך הגדרת סביבה בשרת האפליקציה, ומסד הנתונים עצמו לא יודע עליה. לכן כל מנהל, יוצר או נציג/ת שירות פעילים ומחוברים יכולים, עם ידע טכני, להפעיל את קליטת הזימונים ישירות מול מסד הנתונים גם כשהסימולטור כבוי. כל מה שנוצר כך מסומן "נתוני בדיקה", לא נשלח שום מייל, ושתי הכתובות פתוחות רק לך.
> האם אתה מאשר להשאיר את זה כך באופן זמני עד ההחלטה 21, בתנאי שלפני שימוש אמיתי תוחל (באישורך) מיגרציה נפרדת שחוסמת את הקריאה הישירה או מתנה אותה בדגל שרק אתה מפעיל? או שאתה מעדיף שנוסיף את החסימה כבר עכשיו, לפני ההחלה?
