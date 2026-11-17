# Step 4 (Version 1) — Migration 7: the technician's field writers and visit media

Branch `claude/step4-migration7`, stacked on `claude/tech-today`. **Local only: not applied to the
remote project** (that needs the owner's separate approval, D52 rule 4). Nothing pushed, no PR.
Fictional data only (D47). Written because Migrations 1–6 have no technician write path: Migration 3
says "the writers arrive with Step 4 (field closure, times, summary, signature)", and Migration 4's
`offline_operation_replay` / `record_offline_operation` are "called by the Step 4 writers".

## 1. Files

| File | sha256 |
|---|---|
| `supabase/migrations/20261110120000_field_visit_writers.sql` | `e4a92876201579a3cd765bb1fc6e03df9bc4b1075c3e7ba96ef46b3c6608e1ac` |
| `supabase/rollback/20261110120000_field_visit_writers.down.sql` | `84e72085dc6531fb606f1a7515c5d1ea3f074a71c3403b4108a8e25c222f9c53` |
| `docs/review/step4-migration7/proposed-guard-change.diff` (protected `scripts/check-migrations.mjs` + its CI test; **stacked on** `docs/review/step6-ingestion/proposed-guard-change.diff`, sha256 `aa7546e9…3fceba`) | `2ee2b4080b75f1b0ce55b1c4febe538ea8b31baa0c19e437b1cb8579e03c97a4` |
| `docs/review/step4-migration7/proposed-canary-fixture-20261110120000.sql` (protected `tests/db-canary/`; copy unchanged to `tests/db-canary/20261110120000.sql`) | `6d85f6a71a176765cbf547f7679881fdf31331407eb0526680c8c915fd725415` |
| `docs/review/step4-migration7/storage-bucket.sql` (a separate remote write: the private bucket) | `a3f7b93c89c3350a07f19ec31408c350096d52e76632266de1b8a1aaf4db8ae2` |

## 2. Objects

- **Table `public.visit_media`** (photos and the signature image; D13, D43, OF-06, SIM-19): kind
  `photo` (phase before/after) or `signature` (PNG); JPEG/PNG/WebP; 1 byte–10 MiB; state `pending` →
  `stored` once; D45 device columns; `operation_id` unique; `created_by`; `is_test` from the visit
  (t15); `storage_path` `<test|live>/<visit id>/<media id>.<ext>` with the D47 prefix CHECK;
  composite FK `(visit_id, is_test)`; triggers t10 (only state/stored_at change), t12 (state and
  server times), t15, t30, t95, t99; RLS with two SELECT policies (the visit's technician; office
  with `card` and (`cal` or `calls`)); SELECT for `authenticated` only.
- **Column `visit_signatures.signature_media_id`** (nullable, no default; composite FK to
  `visit_media (id, is_test)`; unique partial index) — Migration 3 OQ-15 / DEV-2.
- **Writers** (SECURITY DEFINER, postgres-owned, `search_path = pg_catalog, pg_temp`) with thin
  SECURITY INVOKER wrappers in `public`, EXECUTE for `authenticated` only:
  `depart_visit` (scheduled → en_route, `departed`), `arrive_visit` (en_route → in_progress,
  `arrived`), `close_visit` (in_progress → done | followup: summary, signature with the fixed V1
  text and its hash and image, `ended` (+`signed`), the call status per D38), `add_visit_media`
  (pending row + object path), `confirm_visit_media` (stored once the object exists with the
  declared size and type). Every writer: `require_caller(['technician'])` + `my_technician_id()`
  ownership (generic 42501), input 22023, `offline_operation_replay` / `record_offline_operation`
  idempotency, call then visit locked, allowed transition only (55000), `field_version` (PT409),
  status event + device time report + `recalc_call_status` in one transaction, so the Migration 3
  deferred constraint triggers pass at COMMIT.
- **Helpers**: `field_payload_sha256(jsonb)`, `field_device_ok(...)` (no grants);
  `visit_media_object_writable(text)`, `visit_media_object_readable(text)` (STABLE SECURITY DEFINER,
  EXECUTE for `authenticated`, used by the Storage policies).
- **Storage policies on `storage.objects`** for bucket `visit-media`: INSERT only for the visit's
  current technician at his own pending path while the visit is in progress; SELECT for him and for
  office users with `card` and (`cal` or `calls`); no UPDATE or DELETE policy.
- **Census**: a `visit_media` row; the Storage row (marker `none`) names the bucket.
- **Section 11**: the fail-closed hardening check, Migration 6 section 11 byte for byte (CI test).
- **Not in the migration**: the bucket row (`storage-bucket.sql`), because the canary-rows check
  refuses any row outside `public`/`private` by design (D54 (2)); without the bucket nothing can be
  stored, so a "טופל" closure (it needs a stored signature) fails closed.

## 3. TEMPORARY behaviours (M7 OQ-1 to OQ-9; in the migration header)

OQ-1 allowed transitions only (no skip, no return; a closed visit is read-only to the technician).
OQ-2 the fixed Version 1 "טופל" text `קריאת השירות טופלה לשביעות רצון הלקוח` (the demo's), its sha256
sent by the device and checked (mismatch refused; Version 2: versioned texts and review, D43).
OQ-3 "טופל" needs signer + stored signature image; "המשך טיפול" an active reason + next-visit notes;
both the written summary (open decision 3). OQ-4 media caps (10 MiB, JPEG/PNG/WebP, 30 rows per
visit, in progress only; open decision 4). OQ-5 the path scheme and the pending → stored step. OQ-6
the Storage access rules. OQ-7 no audit rows (visit_events and offline_operations are the record).
OQ-8 operation types (`time_report`, `close`, `media`). OQ-9 open decision 2 unchanged (no time
reports for the technician).

## 4. Verification (isolated local stack `tm-tech`, ports 557xx; the shared stack untouched)

| Check | Result |
|---|---|
| pgTAP, all files (`supabase test db tests/db`) | **PASS: 41 files, 1669 tests** (new `350_hardening_assertion_m7` 19, `360_field_visit_writers` 25; `010`, `060`, `070`, `100`, `140`, `150`, `280`, `990` extended for the new table and column, nothing removed) |
| `360`: ownership per caller (Technician B, Manager, CS, Creator, deactivated, no JWT, anon, service_role), re-assignment, transitions, PT409, 22023 inputs, replay, 23505, double submission (55000), closed visit read-only, "טופל" effects + D38 resolved, "המשך טיפול" + awaiting_followup, media rules and cap, Storage INSERT/UPDATE/DELETE/SELECT per role, deferred checks | PASS |
| `990`: the down script refuses on Step 4 data, a later migration, a missing history row; runs on empty tables; restores the Step 6 census byte for byte | PASS |
| `tests/ci` on this branch | 227/229 (the two guard tests, as on the Step 6 branch, until the protected guard change is applied) |
| Scratch copy + Step 6 guard diff + this guard diff: `node scripts/check-migrations.mjs` | PASS |
| Same scratch copy: `npm run test:ci` | **231/231** |
| `scripts/db-canary.mjs`, database-only isolated stack, fixtures = `tests/db-canary/` + Step 6 proposal + this proposal | **PASS** (section 5) |

## 5. Canary

`node scripts/db-canary.mjs --workdir <isolated copy> --migrations <its migrations> --fixtures <scratch copy of tests/db-canary + the Step 6 proposal as 20261109120000.sql + this proposal as 20261110120000.sql>`, the database only (no other service running): **PASS — 7 migrations checked (7 fixture files)**; coverage (R6) 27 tables, 370 columns, the 3 existing exceptions; masked volatile columns only the earlier ones (role_permissions.updated_at, call_types and followup_reasons ids and times); R1–R7 clean. The bucket row is deliberately not in the migration (R4 would refuse it by design, D54 (2)). Without a fixture at `tests/db-canary/20261110120000.sql` the CI canary check fails R6 after Migration 7.

## 6. What the owner approves (separately, D52 rule 6)

1. The guard entries (protected `scripts/check-migrations.mjs`, D55 (8)) — after the Step 6 diff.
2. The canary fixture (protected `tests/db-canary/`, D54).
3. Applying Migration 7 (D52 rule 4), after Migrations 3–6.
4. Creating the private bucket `visit-media` (`storage-bucket.sql`), a remote write outside the
   migration.
5. The TEMPORARY behaviours OQ-1 to OQ-9 (especially OQ-2, the fixed V1 text, and OQ-4, the caps).
