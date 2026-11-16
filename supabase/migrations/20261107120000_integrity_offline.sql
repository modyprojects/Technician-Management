-- Step 1 / PR 1.6 — Migration 4: integrity and offline.
--
-- Sources: docs/database-schema.md (§1 "Concurrency" and "visits.field_version", §2, §3, §4
-- "Migration 4", §6, §7, §8.1, §8.3, §9, §10), docs/security.md (§5, §8), decisions D06, D14,
-- D33, D36, D38, D39, D43, D44, D45, D46, D47, D51, D60 (2) (T-01, T-09, X-06 of
-- docs/qa-corrections-01-integration.md), docs/architecture-data-access.md (visits.correct,
-- review.resolve), the PR 1.5 hand-offs (docs/review/step1-pr15/README.md section 14) and the
-- PR 1.6 plan (docs/review/step1-pr16/README.md lists the deviations DEV-1 to DEV-12 and the
-- TEMPORARY behaviours OQ-1 to OQ-14).
--
-- Content: three tables (review_items, visit_corrections, offline_operations); two columns, two
-- composite foreign keys and three CHECKs on visit_time_reports (corrections and accepted device
-- reports, D45); a unique key and a field_version trigger on visits (database-schema.md §1); the
-- audit extension (two actions, two target tables); five new trigger functions and the
-- replacement of tg_time_report_derive; three internal helpers (create_review_item,
-- offline_operation_replay, record_offline_operation: no grants, called by the Step 4 and Step 6
-- writers); two SECURITY DEFINER writers (correct_visit D14, resolve_review_item D44) with their
-- SECURITY INVOKER wrappers; four SELECT policies; per-object grants; the census extension; and
-- the fail-closed hardening check (section 12, a copy of Migration 3 section 12).
--
-- Data: schema only. No reference, test or fictitious rows (D47).
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step1-pr16 section 13;
-- each question is "PR 1.6 OQ-n"):
--   OQ-1  corrections and review resolutions need `card` and (`cal` or `calls`) besides their own
--         rule (the screens need both keys, docs/architecture-data-access.md G-04).
--   OQ-2  review_items and visit_corrections are read with `card` and (`cal` or `calls`), as PR 1.5
--         OQ-4; offline_operations with `conflicts` (office) and by their own Technician.
--   OQ-3  a review item about a server-closed or cancelled visit is resolved by a Manager or the
--         Creator (fixed, D14) who also has `conflicts`; every other item with `conflicts`.
--   OQ-4  resolution: keep_current for every type; apply_incoming only for duplicate_time_report
--         (OQ-11 of PR 1.5); per_field for none. The other apply paths come with their writers
--         (Step 4: closure of a cancelled visit, approval text, edit conflicts; Step 6: D39).
--   OQ-5  correctable fields: summary, follow-up reason, next-visit notes, departed, arrived, ended
--         (no parts until Step 4 creates visit_parts; never the signature, D43).
--   OQ-6  no outcome correction (PR 1.5 OQ-14 stays open): done <-> followup is not offered.
--   OQ-7  corrections are append-only: visit_reports and the visit row keep the values as the
--         Technician closed the visit; the current value is the newest correction.
--   OQ-8  a stale version is refused (PT409): the visits.correct port sends no per-field base, so
--         the D44 merge and edit_conflict path apply to device submissions (Step 4), not here.
--   OQ-9  review types, sources and the device-operation types (codes are permanent once rows
--         exist; later migrations only add codes).
--   OQ-10 offline_operations keep the final result only ('applied' or 'review'); a refused
--         operation is not stored and the device may retry it with the same id (D46 TE-24).
--   OQ-11 no Technician access to review_items (the "status of what he submitted" function of
--         database-schema.md §8.3 comes with the Step 4 sync screens).
--   OQ-12 dedupe keys and source_ref use the opaque reference format of Migration 2.
--   OQ-13 an accepted second device report keeps its original receipt time (the review item's
--         creation time) and stays credited to its reporter.
--   OQ-14 field_version: status, technician and address (city, street, building, floor,
--         apartment) raise it by trigger; the call-level D39 changes (customer, SKU) raise it in
--         their Step 6 writer.
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53), after
-- Migration 3 is applied and merged.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified. No function builds or runs SQL text.
--
-- Definer-writer invariant (restated from Migration 1, section 4): every writer of these tables is
-- a SECURITY DEFINER body owned by postgres (correct_visit, resolve_review_item, and the Step 4 and
-- Step 6 writers that call the three helpers), so the SECURITY INVOKER triggers read consistent
-- data. The marker and reference triggers read each referenced row with SELECT ... INTO and raise
-- 23503 when it is missing or not visible to the caller (fail closed).
--
-- Error codes (as in Migrations 1 to 3):
--   42501 "not authorized" (generic, also for unknown targets and a test caller with a real target)
--   22023 "invalid input" (also a value refused by a CHECK inside a writer: no DETAIL is shown)
--   55000 wrong state (a visit that is not closed, a resolved item, a decision not available yet)
--   PT409 version conflict (PostgREST answers HTTP 409)
--   23503 a referenced row is missing (triggers)
--   23505 an operation id or dedupe key already used for something else
--   23514 integrity rule (CHECKs, the D47 one-way rule, the reference rules of the triggers)

-- ---------------------------------------------------------------------------------------------
-- 0. Apply as postgres (see the PR 1.3 migration, section 0).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'apply this migration as postgres (current role: %)', current_user;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tables. RLS on every table (no FORCE), every foreign key ON DELETE RESTRICT, no direct writes
--    for any API role (no grants), no DELETE or TRUNCATE for anyone (triggers). Text rules as in
--    Migration 3 section 1 (TEXT-SAFE-ML for the notes and reasons, written out in each CHECK).
--    Codes are permanent once rows exist: later migrations may only add codes (OQ-9).
-- ---------------------------------------------------------------------------------------------

-- 1.0 visits: the parent key of review_items (visit_id, service_call_id), so a review item's visit
--     belongs to its call (database-schema.md §4). No row changes; the index is built once.
alter table public.visits add constraint visits_id_service_call_id_key unique (id, service_call_id);

-- 1.1 review_items (D39, D43, D44, D45): everything that waits for a person's decision. Both
--     versions of a change are kept as stored when the item was created (submitted_version =
--     version A, current_version = version B, base_version = the per-field base values of D44);
--     only the decision columns change, once (open -> resolved). The writers of Step 4 and Step 6
--     create items through private.create_review_item; PR 1.6 resolves them
--     (private.resolve_review_item). Never deleted.
create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  -- TEMPORARY value set (OQ-9), from D39 (invitation changes of a visit en route or in progress,
  -- and call-level identity changes), D44 (edit conflicts, a closure of a cancelled visit), D43
  -- (approval-text mismatch) and D45 (a second device report, PR 1.5 OQ-11).
  review_type text not null
    constraint review_items_review_type_check check (review_type in (
      'reassignment', 'cancellation', 'address_change', 'customer_change', 'sku_change', 'edit_conflict',
      'closure_of_cancelled_visit', 'approval_text_mismatch', 'duplicate_time_report')),
  -- Unique across test and real rows. Format TEMPORARY (OQ-12): an opaque reference built by the
  -- writer (for example the operation id of a device submission).
  dedupe_key text not null
    constraint review_items_dedupe_key_key unique
    constraint review_items_dedupe_key_check check (dedupe_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  service_call_id uuid not null,
  -- NULL for the call-level items (customer_change, sku_change).
  visit_id uuid,
  -- Where the submission came from: an invitation (its opaque ingestion reference) or a
  -- Technician's device (its operation id and the submitting profile).
  source text not null
    constraint review_items_source_check check (source in ('invitation', 'device')),
  source_ref text
    constraint review_items_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  -- auth.uid() of the device session that submitted it (create_review_item); NULL for invitations.
  submitted_by_profile_id uuid
    constraint review_items_submitted_by_profile_id_fkey references public.profiles (id) on delete restrict,
  operation_id uuid,
  -- Version A, version B and the base (D44). JSON objects keyed by field; SQL NULL means "none".
  submitted_version jsonb not null
    constraint review_items_submitted_version_check check (
      jsonb_typeof(submitted_version) = 'object' and pg_column_size(submitted_version) <= 16384),
  current_version jsonb not null
    constraint review_items_current_version_check check (
      jsonb_typeof(current_version) = 'object' and pg_column_size(current_version) <= 16384),
  base_version jsonb
    constraint review_items_base_version_check check (
      jsonb_typeof(base_version) = 'object' and pg_column_size(base_version) <= 16384),
  status text not null default 'open'
    constraint review_items_status_check check (status in ('open', 'resolved')),
  -- Server receipt time (t12).
  created_at timestamptz not null default now(),
  -- Server time of the decision (t12).
  resolved_at timestamptz,
  resolved_by uuid
    constraint review_items_resolved_by_fkey references public.profiles (id) on delete restrict,
  resolution text
    constraint review_items_resolution_check check (resolution in ('apply_incoming', 'keep_current', 'per_field')),
  -- Per-field choices of a per_field decision: field -> 'current' or 'incoming'.
  resolution_choices jsonb
    constraint review_items_resolution_choices_check check (
      jsonb_typeof(resolution_choices) = 'object' and resolution_choices <> '{}'::jsonb
      and pg_column_size(resolution_choices) <= 16384
      and not jsonb_path_exists(resolution_choices,
        '$.keyvalue() ? (!(@.key like_regex "^[A-Za-z][A-Za-z0-9_]{0,62}$") || @.value.type() != "string" || (@.value != "current" && @.value != "incoming"))')),
  -- TEXT-SAFE-ML, 1-500 (D14: required where the decision changes a server-closed or cancelled
  -- visit; the writer checks it).
  resolution_note text
    constraint review_items_resolution_note_check check (
      resolution_note = btrim(resolution_note) and char_length(resolution_note) between 1 and 500 and resolution_note is nfc normalized
      and resolution_note !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and resolution_note !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- D47: copied from the call by t15 (the client value is ignored), frozen by t10 and t20.
  is_test boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid constraint review_items_updated_by_fkey references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint review_items_version_check check (version >= 1),
  -- Parent of the composite foreign keys of visit_time_reports and offline_operations.
  constraint review_items_id_is_test_key unique (id, is_test),
  constraint review_items_service_call_id_fkey foreign key (service_call_id, is_test)
    references public.service_calls (id, is_test) on delete restrict,
  -- The visit belongs to the item's call (database-schema.md §4).
  constraint review_items_visit_id_fkey foreign key (visit_id, service_call_id)
    references public.visits (id, service_call_id) on delete restrict,
  -- TEMPORARY (OQ-9): the D39 types come from invitations, the others from devices.
  constraint review_items_type_source_check check (
    (review_type in ('reassignment', 'cancellation', 'address_change', 'customer_change', 'sku_change') and source = 'invitation')
    or (review_type in ('edit_conflict', 'closure_of_cancelled_visit', 'approval_text_mismatch', 'duplicate_time_report')
        and source = 'device')),
  constraint review_items_visit_check check ((visit_id is null) = (review_type in ('customer_change', 'sku_change'))),
  constraint review_items_device_check check (
    source <> 'device' or (operation_id is not null and submitted_by_profile_id is not null and source_ref is null)),
  constraint review_items_invitation_check check (
    source <> 'invitation' or (source_ref is not null and operation_id is null and submitted_by_profile_id is null)),
  constraint review_items_resolution_state_check check (
    (status = 'open' and resolved_at is null and resolved_by is null and resolution is null and resolution_choices is null
     and resolution_note is null)
    or (status = 'resolved' and resolved_at is not null and resolved_by is not null and resolution is not null
        and (resolution = 'per_field') = (resolution_choices is not null))),
  -- The contract of a second device report (PR 1.5 OQ-11): the device values that an acceptance
  -- turns into a time report (private.resolve_review_item).
  constraint review_items_time_report_check check (
    review_type <> 'duplicate_time_report'
    or submitted_version ?& array['kind', 'reported_at', 'device_tz', 'device_utc_offset_min', 'device_sent_at'])
);
create index review_items_service_call_id_idx on public.review_items (service_call_id);
create index review_items_visit_id_idx on public.review_items (visit_id) where visit_id is not null;
create index review_items_status_created_at_idx on public.review_items (status, created_at);
create index review_items_operation_id_idx on public.review_items (operation_id) where operation_id is not null;
comment on table public.review_items is
  'Review items (D39, D43, D44, D45): both versions kept as stored; only the decision changes, once. Created by private.create_review_item (Step 4, Step 6 writers); resolved by private.resolve_review_item. Never deleted.';
alter table public.review_items enable row level security;

-- 1.2 visit_corrections (D14; OF-10): audited Manager/Creator corrections of a server-closed visit.
--     Append-only, one field per row (the visits.correct port corrects one field at a time).
--     Original values are never overwritten (OQ-7): visit_reports and the visit row keep the
--     values as the Technician closed the visit; the current value of a field is the newest row
--     (highest version_after); a corrected field time is also a new visit_time_reports row
--     (source 'correction', correction_id), which visit_time_current prefers (D45).
create table public.visit_corrections (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  -- TEMPORARY (OQ-5): the correctable fields of docs/architecture-data-access.md that exist in
  -- Step 1 (parts: Step 4); never the signature, the signer or the approval text (D43).
  field text not null
    constraint visit_corrections_field_check check (
      field in ('summary', 'followup_reason', 'next_visit_notes', 'departed', 'arrived', 'ended')),
  -- The current value before the correction (the as-closed value or the previous correction);
  -- SQL NULL when the field had none (for example a time never reported). JSON strings only.
  old_value jsonb
    constraint visit_corrections_old_value_check check (
      jsonb_typeof(old_value) = 'string' and pg_column_size(old_value) <= 16384),
  -- The corrected value, by field: the summary (TEXT-SAFE-ML, 1-4000) and next-visit notes
  -- (TEXT-SAFE-ML, 1-1000) as in Migration 3, a continuation reason id, a field time with its
  -- UTC offset.
  new_value jsonb not null
    constraint visit_corrections_new_value_check check (
      jsonb_typeof(new_value) = 'string'
      and case field
        when 'summary' then
          (new_value #>> '{}') = btrim(new_value #>> '{}') and char_length(new_value #>> '{}') between 1 and 4000
          and (new_value #>> '{}') is nfc normalized
          and (new_value #>> '{}') !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
          and (new_value #>> '{}') !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
        when 'next_visit_notes' then
          (new_value #>> '{}') = btrim(new_value #>> '{}') and char_length(new_value #>> '{}') between 1 and 1000
          and (new_value #>> '{}') is nfc normalized
          and (new_value #>> '{}') !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
          and (new_value #>> '{}') !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
        when 'followup_reason' then
          (new_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        else
          (new_value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}(:[0-9]{2}){0,2}$'
      end),
  -- TEXT-SAFE-ML, 1-500 (OF-10: a mandatory reason).
  reason text not null
    constraint visit_corrections_reason_check check (
      reason = btrim(reason) and char_length(reason) between 1 and 500 and reason is nfc normalized
      and reason !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and reason !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- visits.version before and after the correction (the writer raises it by one).
  version_before integer not null constraint visit_corrections_version_before_check check (version_before >= 1),
  version_after integer not null,
  corrected_by uuid not null
    constraint visit_corrections_corrected_by_fkey references public.profiles (id) on delete restrict,
  -- Server time (t16).
  recorded_at timestamptz not null default now(),
  -- D47: copied from the visit by t15.
  is_test boolean not null,
  -- Parent of the composite foreign key (correction_id, is_test) of visit_time_reports.
  constraint visit_corrections_id_is_test_key unique (id, is_test),
  constraint visit_corrections_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict,
  constraint visit_corrections_version_check check (version_after = version_before + 1),
  -- One correction per visit version (two concurrent corrections cannot both claim it).
  constraint visit_corrections_visit_id_version_after_key unique (visit_id, version_after),
  constraint visit_corrections_value_check check (old_value is distinct from new_value)
);
create index visit_corrections_visit_id_field_version_after_idx on public.visit_corrections (visit_id, field, version_after);
create index visit_corrections_corrected_by_idx on public.visit_corrections (corrected_by);
comment on table public.visit_corrections is
  'Audited corrections of server-closed visits (D14, OF-10). Append-only; the originals stay in visit_reports and visits. Written only by private.correct_visit. Never deleted.';
alter table public.visit_corrections enable row level security;

-- 1.3 offline_operations (D06, D45, D46; T-01, T-09, X-06): the server's idempotency record of
--     device sync. The primary key is the device's operation id. A row is the final, stored
--     outcome of one operation; it never changes. A replay with the same id and payload returns
--     it (private.offline_operation_replay); the same id with another payload or another user is
--     refused. Written by the Step 4 device writers through private.record_offline_operation.
create table public.offline_operations (
  operation_id uuid primary key,
  -- auth.uid() of the device session (record_offline_operation).
  actor_profile_id uuid not null
    constraint offline_operations_actor_profile_id_fkey references public.profiles (id) on delete restrict,
  visit_id uuid not null,
  -- TEMPORARY (OQ-9): the work-queue kinds of features/sync (D46).
  op_type text not null
    constraint offline_operations_op_type_check check (
      op_type in ('time_report', 'pickup', 'summary', 'parts', 'media', 'recording', 'close')),
  -- sha256 of the canonical payload, computed by the server (Step 4).
  payload_sha256 text not null
    constraint offline_operations_payload_sha256_check check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- visits.field_version the device based the operation on (database-schema.md §1).
  expected_field_version integer not null
    constraint offline_operations_expected_field_version_check check (expected_field_version >= 1),
  -- Device values (D45: reported, not proof).
  device_sent_at timestamptz not null
    constraint offline_operations_device_sent_at_check check (isfinite(device_sent_at)),
  device_tz text not null
    constraint offline_operations_device_tz_check check (
      char_length(device_tz) <= 64 and device_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  device_utc_offset_min integer not null
    constraint offline_operations_device_utc_offset_min_check check (device_utc_offset_min between -840 and 840),
  -- Server time (t35).
  received_at timestamptz not null default now(),
  -- TEMPORARY (OQ-10): 'applied' (also an automatic D44 merge) or 'review' (stored as a review
  -- item, D44: a rejected submission is stored, not lost).
  result text not null
    constraint offline_operations_result_check check (result in ('applied', 'review')),
  -- visits.field_version after the operation (unchanged for 'review').
  resulting_field_version integer not null
    constraint offline_operations_resulting_field_version_check check (resulting_field_version >= 1),
  review_item_id uuid,
  -- D47: copied from the visit by t15.
  is_test boolean not null,
  constraint offline_operations_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict,
  constraint offline_operations_review_item_id_fkey foreign key (review_item_id, is_test)
    references public.review_items (id, is_test) on delete restrict,
  constraint offline_operations_review_check check ((result = 'review') = (review_item_id is not null))
);
create index offline_operations_actor_profile_id_received_at_idx on public.offline_operations (actor_profile_id, received_at);
create index offline_operations_visit_id_idx on public.offline_operations (visit_id);
create index offline_operations_review_item_id_idx on public.offline_operations (review_item_id) where review_item_id is not null;
comment on table public.offline_operations is
  'Server idempotency record of device sync (D06, D45, D46). Final outcome per operation id; immutable. Written only by private.record_offline_operation (Step 4 writers). Never deleted.';
alter table public.offline_operations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. visit_time_reports (D45; DEV-2 of PR 1.5): the source 'correction', with exactly one of
--    correction_id (a D14 correction by the office) and accepted_review_id (a second device report
--    accepted in review, PR 1.5 OQ-11). Columns are added nullable without a default (no row
--    changes); the CHECKs only re-validate the existing device rows. Composite foreign keys keep
--    the test marking consistent (D47).
-- ---------------------------------------------------------------------------------------------
alter table public.visit_time_reports
  add column correction_id uuid,
  add column accepted_review_id uuid;
alter table public.visit_time_reports
  drop constraint visit_time_reports_source_check,
  add constraint visit_time_reports_source_check check (
    (source = 'device' and correction_id is null and accepted_review_id is null)
    or (source = 'correction' and num_nonnulls(correction_id, accepted_review_id) = 1)),
  -- An office correction carries only the corrected time of a field time (no device values).
  add constraint visit_time_reports_correction_check check (
    correction_id is null
    or (kind in ('departed', 'arrived', 'ended') and reported_at is not null and isfinite(reported_at)
        and device_tz is null and device_utc_offset_min is null and device_sent_at is null and operation_id is null)),
  -- An accepted report keeps every device value of the original submission (D45).
  add constraint visit_time_reports_accepted_check check (
    accepted_review_id is null
    or (reported_at is not null and device_tz is not null and device_utc_offset_min is not null
        and device_sent_at is not null and operation_id is not null and clock_skew_ms is not null
        and isfinite(reported_at) and isfinite(device_sent_at))),
  add constraint visit_time_reports_correction_id_fkey foreign key (correction_id, is_test)
    references public.visit_corrections (id, is_test) on delete restrict,
  add constraint visit_time_reports_accepted_review_id_fkey foreign key (accepted_review_id, is_test)
    references public.review_items (id, is_test) on delete restrict;
create index visit_time_reports_correction_id_idx on public.visit_time_reports (correction_id) where correction_id is not null;
create index visit_time_reports_accepted_review_id_idx on public.visit_time_reports (accepted_review_id)
  where accepted_review_id is not null;
comment on table public.visit_time_reports is
  'Device-reported field times (D45) and their corrections (source correction: a D14 correction or an accepted second report). Append-only; flagged, never rejected for clock values; current value in public.visit_time_current.';

-- ---------------------------------------------------------------------------------------------
-- 3. Trigger functions (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants). None of them writes data: they set or check NEW only. A referenced row is read with
--    SELECT ... INTO; a missing or invisible row raises 23503 (fail closed). Messages are generic.
-- ---------------------------------------------------------------------------------------------

-- t15 on review_items (BEFORE INSERT): is_test from the call (D47); the client value is ignored.
create function private.tg_call_child_marker()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  select c.is_test into v_is_test from public.service_calls c where c.id = new.service_call_id;
  if not found then
    raise exception using errcode = '23503', message = tg_table_name || ': unknown service call';
  end if;
  new.is_test := v_is_test;
  return new;
end
$$;

-- t12 on review_items (BEFORE INSERT OR UPDATE): an item is created open with the server's
-- receipt time; it is decided once (open -> resolved, resolved_at = now()); a resolved item never
-- changes again. Every other column is frozen by t10 (both versions stay as stored, D44).
create function private.tg_review_item_state()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'open' then
      raise exception using errcode = '55000', message = 'review_items: an item is created open';
    end if;
    new.created_at := now();
    return new;
  end if;
  if old.status = 'resolved' then
    raise exception using errcode = '55000', message = 'review_items: a resolved item never changes';
  end if;
  if new.status = 'resolved' then
    new.resolved_at := now();
  end if;
  return new;
end
$$;

-- t31 on visit_corrections (BEFORE INSERT, after t15): a correction belongs to a server-closed
-- visit (D14); the follow-up fields only to a visit closed as followup; a corrected continuation
-- reason exists, and a real correction never names a test reason (D47). A reason value that is not
-- an id is left to the CHECK visit_corrections_new_value_check (it runs after this trigger).
create function private.tg_visit_correction_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_is_test boolean;
begin
  select v.status into v_status from public.visits v where v.id = new.visit_id;
  if not found then
    raise exception using errcode = '23503', message = 'visit_corrections: unknown visit';
  end if;
  if v_status not in ('done', 'followup')
     or (new.field in ('followup_reason', 'next_visit_notes') and v_status <> 'followup') then
    raise exception using errcode = '23514', message = 'visit_corrections: this field of this visit cannot be corrected';
  end if;
  if new.field = 'followup_reason' and jsonb_typeof(new.new_value) = 'string'
     and (new.new_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.is_test into v_is_test from public.followup_reasons r where r.id = (new.new_value #>> '{}')::uuid;
    if not found then
      raise exception using errcode = '23503', message = 'visit_corrections: unknown continuation reason';
    end if;
    if new.is_test is not true and v_is_test then
      raise exception using errcode = '23514', message = 'visit_corrections: a real record cannot reference test data (D47)';
    end if;
  end if;
  return new;
end
$$;

-- t35 on offline_operations (BEFORE INSERT): the server's receipt time (D45); an operation stored
-- for review names the review item of the same visit and operation.
create function private.tg_offline_operation_derive()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_visit_id uuid;
  v_operation_id uuid;
begin
  new.received_at := now();
  if new.review_item_id is not null then
    select r.visit_id, r.operation_id into v_visit_id, v_operation_id
    from public.review_items r where r.id = new.review_item_id;
    if not found then
      raise exception using errcode = '23503', message = 'offline_operations: unknown review item';
    end if;
    if v_visit_id is distinct from new.visit_id or v_operation_id is distinct from new.operation_id then
      raise exception using errcode = '23514', message = 'offline_operations: the review item belongs to another operation';
    end if;
  end if;
  return new;
end
$$;

-- t13 on visits (BEFORE INSERT OR UPDATE): field_version (database-schema.md §1; OQ-14). It starts
-- at 1 and rises by one with every change that matters to a device: status (closure,
-- cancellation), assignment and the visit's address. Non-critical changes (times, notes, pickup,
-- task number, bookkeeping) leave it. A writer may raise it by one itself for the call-level D39
-- changes (customer, SKU; Step 6); any other value is refused.
create function private.tg_visit_field_version()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.field_version := 1;
    return new;
  end if;
  if new.field_version is distinct from old.field_version and new.field_version is distinct from old.field_version + 1 then
    raise exception using errcode = '55000', message = 'visits: field_version is set by the server';
  end if;
  if (new.status, new.technician_id, new.city, new.street, new.building, new.floor, new.apartment)
     is distinct from (old.status, old.technician_id, old.city, old.street, old.building, old.floor, old.apartment) then
    new.field_version := old.field_version + 1;
  end if;
  return new;
end
$$;

-- t35 on visit_time_reports (BEFORE INSERT), replacing the PR 1.5 body (same trigger, same ACL):
-- the PR 1.5 rules unchanged, plus the two kinds of correction rows (D45, OQ-13):
--   - an accepted second device report (accepted_review_id) names a resolved and accepted
--     duplicate_time_report item of the same visit, is reported by the item's submitter with the
--     item's operation id, is credited to the reporter's own technician record, and keeps its
--     original receipt time (the item's creation time); its skew and flags are computed on it;
--   - an office correction (correction_id) names a visit_corrections row of the same visit and
--     field, recorded by the same user, with the same corrected time.
create or replace function private.tg_time_report_derive()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tech_profile_id uuid;
  v_tech_is_test boolean;
  v_visit_technician_id uuid;
  v_assigned_at timestamptz;
  v_flags text[] := '{}';
  v_item public.review_items;
  v_correction public.visit_corrections;
begin
  new.received_at := now();
  new.clock_skew_ms := null;
  select t.profile_id, t.is_test into v_tech_profile_id, v_tech_is_test
  from public.technicians t where t.id = new.technician_id;
  if not found then
    raise exception using errcode = '23503', message = 'visit_time_reports: unknown technician';
  end if;
  if new.is_test is not true and v_tech_is_test then
    raise exception using errcode = '23514', message = 'visit_time_reports: a real record cannot reference test data (D47)';
  end if;
  if new.source = 'device' and v_tech_profile_id is distinct from new.reported_by_profile_id then
    raise exception using errcode = '23514', message = 'visit_time_reports: a device report is credited to the technician who reported it';
  end if;
  if new.accepted_review_id is not null then
    select r.* into v_item from public.review_items r where r.id = new.accepted_review_id;
    if not found then
      raise exception using errcode = '23503', message = 'visit_time_reports: unknown review item';
    end if;
    if v_item.visit_id is distinct from new.visit_id or v_item.review_type <> 'duplicate_time_report'
       or v_item.status <> 'resolved' or v_item.resolution not in ('apply_incoming', 'per_field')
       or v_item.submitted_by_profile_id is distinct from new.reported_by_profile_id
       or v_item.operation_id is distinct from new.operation_id
       or v_tech_profile_id is distinct from new.reported_by_profile_id then
      raise exception using errcode = '23514', message = 'visit_time_reports: an accepted report matches its review item';
    end if;
    new.received_at := v_item.created_at;
  end if;
  if new.correction_id is not null then
    select c.* into v_correction from public.visit_corrections c where c.id = new.correction_id;
    if not found then
      raise exception using errcode = '23503', message = 'visit_time_reports: unknown correction';
    end if;
    if v_correction.visit_id is distinct from new.visit_id or v_correction.field is distinct from new.kind
       or v_correction.corrected_by is distinct from new.reported_by_profile_id
       or (v_correction.new_value #>> '{}')::timestamptz is distinct from new.reported_at then
      raise exception using errcode = '23514', message = 'visit_time_reports: a corrected time matches its correction';
    end if;
  end if;
  select v.technician_id, v.assigned_at into v_visit_technician_id, v_assigned_at
  from public.visits v where v.id = new.visit_id;
  if not found then
    raise exception using errcode = '23503', message = 'visit_time_reports: unknown visit';
  end if;
  if new.device_sent_at is not null and isfinite(new.device_sent_at) then
    new.clock_skew_ms := round(extract(epoch from (new.device_sent_at - new.received_at)) * 1000)::bigint;
    if new.reported_at is not null and isfinite(new.reported_at)
       and extract(epoch from (new.reported_at - new.received_at)) * 1000 - new.clock_skew_ms > 120000 then
      v_flags := v_flags || 'future_time'::text;
    end if;
    if abs(new.clock_skew_ms) > 300000 then
      v_flags := v_flags || 'large_skew'::text;
    end if;
    if new.reported_at is not null and isfinite(new.reported_at)
       and new.technician_id = v_visit_technician_id
       and extract(epoch from (new.reported_at - v_assigned_at)) * 1000 - new.clock_skew_ms < 0 then
      v_flags := v_flags || 'before_assignment'::text;
    end if;
  end if;
  new.row_flags := v_flags;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Attach the triggers. Name prefixes fix the firing order (BEFORE triggers run by name), as in
--    Migration 3 section 5: t10 immutability, t12 state and server times, t13 field_version, t15
--    marker from the parent, t16 history server time, t20 marker immutability, t30 one-way
--    (people), t31 references, t35 derived values, t90 version, t95 delete, t99 truncate.
-- ---------------------------------------------------------------------------------------------

-- review_items: only the decision columns change (both versions stay as stored, D44).
create trigger t10_immutable before update on public.review_items
  for each row execute function private.tg_immutable_except(
    'status', 'resolved_at', 'resolved_by', 'resolution', 'resolution_choices', 'resolution_note', 'version',
    'updated_at', 'updated_by');
create trigger t12_review_state before insert or update on public.review_items
  for each row execute function private.tg_review_item_state();
create trigger t15_marker_from_call before insert on public.review_items
  for each row execute function private.tg_call_child_marker();
create trigger t20_immutable_markers before update on public.review_items
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.review_items
  for each row execute function private.tg_one_way_people('submitted_by_profile_id', 'resolved_by', 'updated_by');
create trigger t90_bump_version before update on public.review_items
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.review_items
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.review_items
  for each statement execute function private.tg_reject_truncate();

-- visit_corrections: append-only.
create trigger t10_reject_update_delete before update or delete on public.visit_corrections
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_visit before insert on public.visit_corrections
  for each row execute function private.tg_visit_child_marker();
create trigger t16_correction_time before insert on public.visit_corrections
  for each row execute function private.tg_history_server_time();
create trigger t30_one_way before insert on public.visit_corrections
  for each row execute function private.tg_one_way_people('corrected_by');
create trigger t31_correction_guard before insert on public.visit_corrections
  for each row execute function private.tg_visit_correction_guard();
create trigger t99_reject_truncate before truncate on public.visit_corrections
  for each statement execute function private.tg_reject_truncate();

-- offline_operations: immutable after insert (the final outcome of one operation).
create trigger t10_reject_update_delete before update or delete on public.offline_operations
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_visit before insert on public.offline_operations
  for each row execute function private.tg_visit_child_marker();
create trigger t30_one_way before insert on public.offline_operations
  for each row execute function private.tg_one_way_people('actor_profile_id');
create trigger t35_offline_operation before insert on public.offline_operations
  for each row execute function private.tg_offline_operation_derive();
create trigger t99_reject_truncate before truncate on public.offline_operations
  for each statement execute function private.tg_reject_truncate();

-- visits: field_version (after t12, which sets the server times).
create trigger t13_field_version before insert or update on public.visits
  for each row execute function private.tg_visit_field_version();

-- ---------------------------------------------------------------------------------------------
-- 5. Audit extension: the D14 correction and the review decision. Both CHECKs keep the 28
--    actions and 7 target tables of Migrations 1 and 2 unchanged; existing rows are only
--    re-validated, never rewritten.
-- ---------------------------------------------------------------------------------------------
alter table public.audit_logs
  drop constraint audit_logs_action_check,
  add constraint audit_logs_action_check check (action in (
    'matrix.value_set', 'matrix.value_approved',
    'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
    'account_creation.authorized',
    'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
    'technician.created', 'technician.updated', 'technician.outlook_email_changed',
    'credentials.change_authorized', 'creator.bootstrapped',
    'call_type.created', 'call_type.activated', 'call_type.deactivated',
    'followup_reason.created', 'followup_reason.activated', 'followup_reason.deactivated', 'followup_reason.deleted',
    'collection_location.created', 'collection_location.activated', 'collection_location.deactivated',
    'collection_location.deleted',
    'visit.corrected', 'review_item.resolved'));
alter table public.audit_logs
  drop constraint audit_logs_target_table_check,
  add constraint audit_logs_target_table_check check (target_table in (
    'profiles', 'technicians', 'account_requests', 'role_permissions',
    'call_types', 'followup_reasons', 'collection_locations',
    'visits', 'review_items'));

-- BEFORE INSERT on audit_logs, first (replaces the PR 1.4 function; the triggers and the ACL are
-- kept): server time and target_is_test from the target row.
create or replace function private.tg_audit_target()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
    when 'call_types' then (select x.is_test from public.call_types x where x.id = new.target_id)
    when 'followup_reasons' then (select x.is_test from public.followup_reasons x where x.id = new.target_id)
    when 'collection_locations' then (select x.is_test from public.collection_locations x where x.id = new.target_id)
    when 'visits' then (select x.is_test from public.visits x where x.id = new.target_id)
    when 'review_items' then (select x.is_test from public.review_items x where x.id = new.target_id)
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Internal helpers for the Step 4 and Step 6 writers (database-schema.md §4, §10; D44, D46).
--    SECURITY INVOKER: their callers are postgres-owned SECURITY DEFINER bodies that have already
--    checked their caller. No grants, no public wrapper, never named by a statement that runs
--    (migration guard rule 4). The actor is always auth.uid() of the session, as in write_audit:
--    no parameter can attribute a submission or an operation to someone else.
-- ---------------------------------------------------------------------------------------------

-- Stores a review item once per dedupe key (D44: both versions as received). A second call with
-- the same key returns the stored item's id when it is the same item (type, call, visit, source),
-- so a retried submission is never stored twice; the same key for another item is refused (23505).
create function private.create_review_item(
  p_review_type text, p_dedupe_key text, p_service_call_id uuid, p_visit_id uuid, p_source text, p_source_ref text,
  p_operation_id uuid, p_submitted_version jsonb, p_current_version jsonb, p_base_version jsonb)
returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_existing public.review_items;
begin
  insert into public.review_items as r (review_type, dedupe_key, service_call_id, visit_id, source, source_ref,
                                        submitted_by_profile_id, operation_id, submitted_version, current_version, base_version)
  values (p_review_type, p_dedupe_key, p_service_call_id, p_visit_id, p_source, p_source_ref,
          case when p_source = 'device' then auth.uid() end, p_operation_id, p_submitted_version, p_current_version,
          p_base_version)
  on conflict (dedupe_key) do nothing
  returning r.id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  select r.* into v_existing from public.review_items r where r.dedupe_key = p_dedupe_key;
  if not found
     or (v_existing.review_type, v_existing.service_call_id, v_existing.visit_id, v_existing.source)
        is distinct from (p_review_type, p_service_call_id, p_visit_id, p_source) then
    raise exception using errcode = '23505', message = 'review_items: the dedupe key belongs to another item';
  end if;
  return v_existing.id;
end
$$;

-- The stored outcome of an operation the caller already sent with the same payload (a replay), or
-- NULL for a new operation. It serializes the operation id for the rest of the transaction, so
-- two deliveries of one operation never both apply. The same id from another user (42501, generic)
-- or with another visit, type or payload (23505) is refused.
create function private.offline_operation_replay(
  p_operation_id uuid, p_visit_id uuid, p_op_type text, p_payload_sha256 text)
returns public.offline_operations
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_op public.offline_operations;
begin
  if p_operation_id is null or p_visit_id is null or p_op_type is null or p_payload_sha256 is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.offline_operations:' || p_operation_id::text, 0));
  select o.* into v_op from public.offline_operations o where o.operation_id = p_operation_id;
  if not found then
    return null;
  end if;
  if v_op.actor_profile_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if (v_op.visit_id, v_op.op_type, v_op.payload_sha256) is distinct from (p_visit_id, p_op_type, p_payload_sha256) then
    raise exception using errcode = '23505', message = 'offline_operations: the operation id was already used for another payload';
  end if;
  return v_op;
end
$$;

-- Stores the final outcome of a new operation (after offline_operation_replay returned NULL and
-- the writer applied it or stored it for review). The actor is the session's user.
create function private.record_offline_operation(
  p_operation_id uuid, p_visit_id uuid, p_op_type text, p_payload_sha256 text, p_expected_field_version integer,
  p_device_sent_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_result text,
  p_resulting_field_version integer, p_review_item_id uuid)
returns public.offline_operations
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_op public.offline_operations;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  insert into public.offline_operations as o (operation_id, actor_profile_id, visit_id, op_type, payload_sha256,
                                              expected_field_version, device_sent_at, device_tz, device_utc_offset_min,
                                              result, resulting_field_version, review_item_id)
  values (p_operation_id, auth.uid(), p_visit_id, p_op_type, p_payload_sha256, p_expected_field_version, p_device_sent_at,
          p_device_tz, p_device_utc_offset_min, p_result, p_resulting_field_version, p_review_item_id)
  returning o.* into v_op;
  return v_op;
end
$$;

comment on function private.create_review_item(text, text, uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb) is
  'D44: stores a review item once per dedupe key; the submitter is auth.uid() of a device session. Called by the Step 4 and Step 6 writers; never by a migration.';
comment on function private.offline_operation_replay(uuid, uuid, text, text) is
  'D46: the stored outcome of a replayed operation of the caller, or NULL for a new one; serializes the operation id. Called by the Step 4 writers.';
comment on function private.record_offline_operation(uuid, uuid, text, text, integer, timestamptz, text, integer, text, integer, uuid) is
  'D46: stores the final outcome of a device operation; the actor is auth.uid(). Called by the Step 4 writers; never by a migration.';

-- ---------------------------------------------------------------------------------------------
-- 7. Writers (D14, D44; docs/architecture-data-access.md visits.correct and review.resolve).
--    SECURITY DEFINER plpgsql in private, every reference schema-qualified, no dynamic SQL. Order
--    in each body: the caller (require_caller, profile locked FOR SHARE; a role outside the rule:
--    42501), the keys (OQ-1), the input (22023), the target locked FOR UPDATE (unknown, or a test
--    caller with a real target: the generic 42501), the state (55000), the version (PT409), the
--    rule of this target, the write, field history and the audit row in the same transaction.
--    Errors from a write carry no DETAIL (the statement runs as the owner).
-- ---------------------------------------------------------------------------------------------

-- D14 (OF-10): an audited correction of one field of a server-closed visit, by a Manager or the
-- Creator (a fixed capability, never a matrix key alone). p_new_value: the summary or next-visit
-- notes text, a continuation reason id (an active reason), or a field time with an explicit UTC
-- offset. The visit's version (visits.version) is the concurrency token: the correction raises it
-- by one (updated_by), and a stale p_expected_version is refused (PT409, OQ-8). Append-only (OQ-7):
-- a visit_corrections row, plus a visit_time_reports row for a field time (D45) and an
-- entity_changes row (source 'correction') for the non-card visit fields, so users with `calls`
-- see the current follow-up reason and notes. The visit's status and outcome never change here
-- (OQ-6), so the call status needs no recalculation. Returns the correction id and the visit's
-- version after it.
create function private.correct_visit(
  p_visit_id uuid, p_field text, p_new_value text, p_reason text, p_expected_version integer)
returns table (out_correction_id uuid, out_version_after integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_visit public.visits;
  v_reason text := btrim(p_reason);
  v_old jsonb;
  v_new jsonb;
  v_ts timestamptz;
  v_old_ts timestamptz;
  v_reason_id uuid;
  v_tech uuid;
  v_version integer;
  v_correction_id uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if not (private.has_permission('card') and (private.has_permission('cal') or private.has_permission('calls'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_visit_id is null or p_field is null or p_new_value is null or p_expected_version is null
     or p_field not in ('summary', 'followup_reason', 'next_visit_notes', 'departed', 'arrived', 'ended')
     or coalesce(v_reason, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_visit.status not in ('done', 'followup') then
    raise exception using errcode = '55000', message = 'the visit is not closed';
  end if;
  if v_visit.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if p_field in ('followup_reason', 'next_visit_notes') and v_visit.status <> 'followup' then
    raise exception using errcode = '55000', message = 'the field cannot be corrected for this visit';
  end if;

  if p_field in ('summary', 'followup_reason', 'next_visit_notes') then
    select c.new_value into v_old from public.visit_corrections c
    where c.visit_id = v_visit.id and c.field = p_field
    order by c.version_after desc limit 1;
    if v_old is null then
      v_old := case p_field
        when 'summary' then (select to_jsonb(r.summary_text) from public.visit_reports r where r.visit_id = v_visit.id)
        when 'followup_reason' then to_jsonb(v_visit.followup_reason_id)
        else to_jsonb(v_visit.next_visit_notes)
      end;
    end if;
    if p_field = 'followup_reason' then
      begin
        v_reason_id := p_new_value::uuid;
      exception when data_exception then
        raise exception using errcode = '22023', message = 'invalid input';
      end;
      if not exists (select 1 from public.followup_reasons r where r.id = v_reason_id and r.is_active) then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      v_new := to_jsonb(v_reason_id);
    else
      v_new := to_jsonb(btrim(p_new_value));
    end if;
    if v_new is not distinct from v_old then
      raise exception using errcode = '22023', message = 'no change';
    end if;
  else
    if p_new_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?([+-][0-9]{2}(:?[0-9]{2})?|Z)$' then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
    begin
      v_ts := p_new_value::timestamptz;
    exception when data_exception then
      raise exception using errcode = '22023', message = 'invalid input';
    end;
    if not isfinite(v_ts) then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
    select c.reported_at, c.technician_id into v_old_ts, v_tech
    from public.visit_time_current c where c.visit_id = v_visit.id and c.kind = p_field;
    if v_old_ts is not distinct from v_ts then
      raise exception using errcode = '22023', message = 'no change';
    end if;
    v_old := to_jsonb(v_old_ts);
    v_new := to_jsonb(v_ts);
    v_tech := coalesce(v_tech, v_visit.technician_id);
  end if;

  update public.visits v set updated_by = v_caller.id where v.id = v_visit.id
  returning v.version into v_version;
  begin
    insert into public.visit_corrections as c (visit_id, field, old_value, new_value, reason, version_before, version_after,
                                               corrected_by)
    values (v_visit.id, p_field, v_old, v_new, v_reason, v_visit.version, v_version, v_caller.id)
    returning c.id into v_correction_id;
  exception
    when check_violation or not_null_violation or foreign_key_violation or data_exception then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  if p_field in ('departed', 'arrived', 'ended') then
    insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source,
                                           correction_id)
    values (v_visit.id, v_caller.id, v_tech, p_field, v_ts, 'correction', v_correction_id);
  elsif p_field in ('followup_reason', 'next_visit_notes') then
    perform private.write_entity_change('visits', v_visit.id,
      case p_field when 'followup_reason' then 'followup_reason_id' else 'next_visit_notes' end,
      v_old, v_new, 'correction', null);
  end if;
  perform private.write_audit('visit.corrected', 'visits', v_visit.id,
    jsonb_build_object('correction_id', v_correction_id, 'field', p_field, 'version_before', v_visit.version,
                       'version_after', v_version));
  out_correction_id := v_correction_id;
  out_version_after := v_version;
  return next;
end
$$;

-- D44 (review.resolve): one decision on an open review item. Who (OQ-3; database-schema.md §8.1,
-- §8.3): an item whose visit is server-closed or cancelled now (done, followup or cancelled) is
-- decided by a Manager or the Creator (D14, fixed), with a note; every other item with `conflicts`
-- (the Creator always); TEMPORARY, the closed-visit rule also needs `conflicts`, and every
-- decision needs `card` and (`cal` or `calls`) (OQ-1). Decisions (OQ-4): keep_current for every
-- type (nothing changes; both versions stay stored); apply_incoming for duplicate_time_report (the
-- submitted device report becomes a visit_time_reports row, source 'correction',
-- accepted_review_id, which visit_time_current prefers; the visit's version rises); per_field for
-- none yet. An invitation never changes a closed visit (D39): only keep_current there. No decision
-- of PR 1.6 changes a visit's status or outcome, so the call status needs no recalculation. Locks
-- the call, the visit and the item in that order (as recalc_call_status and the deferred checks).
-- Returns the item's version after the decision.
create function private.resolve_review_item(
  p_review_item_id uuid, p_expected_version integer, p_decision text, p_field_choices jsonb, p_note text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_item public.review_items;
  v_visit public.visits;
  v_closed boolean := false;
  v_note text := nullif(btrim(p_note), '');
  v_version integer;
  v_tech uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not (private.has_permission('card') and (private.has_permission('cal') or private.has_permission('calls'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_review_item_id is null or p_expected_version is null or p_decision is null
     or p_decision not in ('apply_incoming', 'keep_current', 'per_field')
     or (p_decision = 'per_field') <> (p_field_choices is not null) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select r.* into v_item from public.review_items r where r.id = p_review_item_id;
  if not found or (v_caller.is_test and not v_item.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  perform 1 from public.service_calls c where c.id = v_item.service_call_id for update;
  if v_item.visit_id is not null then
    select v.* into v_visit from public.visits v where v.id = v_item.visit_id for update;
    v_closed := v_visit.status in ('done', 'followup', 'cancelled');
  end if;
  select r.* into v_item from public.review_items r where r.id = p_review_item_id for update;
  if not private.has_permission('conflicts') or (v_closed and v_caller.role not in ('creator', 'manager')) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_item.status <> 'open' then
    raise exception using errcode = '55000', message = 'the item is already decided';
  end if;
  if v_item.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if p_decision = 'per_field'
     or (p_decision = 'apply_incoming' and v_item.review_type <> 'duplicate_time_report')
     or (p_decision <> 'keep_current' and v_item.source = 'invitation' and v_closed) then
    raise exception using errcode = '55000', message = 'the decision is not available for this item';
  end if;
  if v_closed and v_note is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;

  begin
    update public.review_items r
    set status = 'resolved', resolved_by = v_caller.id, resolution = p_decision, resolution_choices = p_field_choices,
        resolution_note = v_note, updated_by = v_caller.id
    where r.id = v_item.id
    returning r.version into v_version;
  exception
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  if p_decision = 'apply_incoming' then
    select t.id into v_tech from public.technicians t where t.profile_id = v_item.submitted_by_profile_id;
    begin
      insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                             device_utc_offset_min, device_sent_at, source, operation_id,
                                             accepted_review_id)
      values (v_item.visit_id, v_item.submitted_by_profile_id, v_tech, v_item.submitted_version ->> 'kind',
              (v_item.submitted_version ->> 'reported_at')::timestamptz, v_item.submitted_version ->> 'device_tz',
              (v_item.submitted_version ->> 'device_utc_offset_min')::integer,
              (v_item.submitted_version ->> 'device_sent_at')::timestamptz, 'correction', v_item.operation_id, v_item.id);
    exception
      when check_violation or not_null_violation or foreign_key_violation or unique_violation or data_exception then
        raise exception using errcode = '22023', message = 'invalid input';
    end;
    update public.visits v set updated_by = v_caller.id where v.id = v_item.visit_id;
  end if;
  perform private.write_audit('review_item.resolved', 'review_items', v_item.id,
    jsonb_build_object('review_type', v_item.review_type, 'decision', p_decision, 'closed_visit', v_closed));
  return v_version;
end
$$;

-- Public API: thin SECURITY INVOKER wrappers, same names and arguments as the bodies.
create function public.correct_visit(
  p_visit_id uuid, p_field text, p_new_value text, p_reason text, p_expected_version integer)
returns table (correction_id uuid, version_after integer)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select b.out_correction_id, b.out_version_after
  from private.correct_visit(p_visit_id, p_field, p_new_value, p_reason, p_expected_version) b
$$;

create function public.resolve_review_item(
  p_review_item_id uuid, p_expected_version integer, p_decision text, p_field_choices jsonb, p_note text)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.resolve_review_item(p_review_item_id, p_expected_version, p_decision, p_field_choices, p_note) $$;

comment on function private.correct_visit(uuid, text, text, text, integer) is
  'D14: audited correction of one field of a server-closed visit (Manager or Creator); append-only; versioned (PT409).';
comment on function private.resolve_review_item(uuid, integer, text, jsonb, text) is
  'D44: one decision on an open review item; D14 items by a Manager or the Creator with a note, others with conflicts; versioned (PT409).';

-- ---------------------------------------------------------------------------------------------
-- 8. Test-data census (replaces the PR 1.5 function; same signature, ACL and caller rule). The
--    three new tables in one 'all sources' row each.
-- ---------------------------------------------------------------------------------------------
create or replace function public.test_data_census()
returns table (table_name text, marker text, bucket text, test_rows bigint)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'brands', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.brands x
    union all
    select 'suppliers', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.suppliers x
    union all
    select 'products', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.products x
    union all
    select 'products', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.products x
    union all
    select 'products', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.products x
    union all
    select 'customers', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.customers x
    union all
    select 'customers', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.customers x
    union all
    select 'customers', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.customers x
    union all
    select 'call_types', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.call_types x
    union all
    select 'followup_reasons', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.followup_reasons x
    union all
    select 'collection_locations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.collection_locations x
    union all
    select 'service_calls', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.service_calls x
    union all
    select 'service_calls', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.service_calls x
    union all
    select 'service_calls', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.service_calls x
    union all
    select 'visits', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visits x
    union all
    select 'visit_reports', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_reports x
    union all
    select 'visit_signatures', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_signatures x
    union all
    select 'visit_time_reports', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_time_reports x
    union all
    select 'visit_events', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_events x
    union all
    select 'entity_changes', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.entity_changes x
    union all
    select 'review_items', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.review_items x
    union all
    select 'visit_corrections', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_corrections x
    union all
    select 'offline_operations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.offline_operations x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. RLS policies: SELECT only, TO authenticated only, every one requires an active profile
--    (through the helpers), every column qualified with its table. No write or anon policies.
--    Four policies (database-schema.md §8.3, narrowed where marked):
--    review_items        office `card` and (`cal` or `calls`) (OQ-2); no Technician policy (OQ-11)
--    visit_corrections   office `card` and (`cal` or `calls`) (OQ-2); no Technician policy
--    offline_operations  office `conflicts`; the Technician his own operations (D46)
-- ---------------------------------------------------------------------------------------------
create policy review_items_select_office on public.review_items for select to authenticated
  using ((select private.has_permission('card'))
         and ((select private.has_permission('cal')) or (select private.has_permission('calls'))));

create policy visit_corrections_select_office on public.visit_corrections for select to authenticated
  using ((select private.has_permission('card'))
         and ((select private.has_permission('cal')) or (select private.has_permission('calls'))));

create policy offline_operations_select_technician on public.offline_operations for select to authenticated
  using (offline_operations.actor_profile_id = (select auth.uid()) and (select private.has_role('technician')));
create policy offline_operations_select_office on public.offline_operations for select to authenticated
  using ((select private.has_permission('conflicts')));

-- ---------------------------------------------------------------------------------------------
-- 10. Grants, per object (never PR 1.3's blanket revokes, which would strip its grants). Tables:
--     SELECT for authenticated, nothing else for anyone; no sequences. Functions: EXECUTE for
--     authenticated on the two wrappers and the two bodies they call (each body checks its
--     caller); none on the three helpers or the trigger functions. Nothing for anon, service_role
--     or PUBLIC. test_data_census(), tg_audit_target() and tg_time_report_derive() keep their ACLs
--     (CREATE OR REPLACE keeps them).
-- ---------------------------------------------------------------------------------------------
revoke all on table public.review_items from public, anon, authenticated, service_role;
revoke all on table public.visit_corrections from public, anon, authenticated, service_role;
revoke all on table public.offline_operations from public, anon, authenticated, service_role;

grant select on public.review_items, public.visit_corrections, public.offline_operations to authenticated;

revoke all on function private.tg_call_child_marker() from public, anon, authenticated, service_role;
revoke all on function private.tg_review_item_state() from public, anon, authenticated, service_role;
revoke all on function private.tg_visit_correction_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_offline_operation_derive() from public, anon, authenticated, service_role;
revoke all on function private.tg_visit_field_version() from public, anon, authenticated, service_role;
revoke all on function private.create_review_item(text, text, uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.offline_operation_replay(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.record_offline_operation(uuid, uuid, text, text, integer, timestamptz, text, integer, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.correct_visit(uuid, text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.resolve_review_item(uuid, integer, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.correct_visit(uuid, text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.resolve_review_item(uuid, integer, text, jsonb, text) from public, anon, authenticated, service_role;

grant execute on function
  private.correct_visit(uuid, text, text, text, integer),
  private.resolve_review_item(uuid, integer, text, jsonb, text),
  public.correct_visit(uuid, text, text, text, integer),
  public.resolve_review_item(uuid, integer, text, jsonb, text)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 11. Hand-offs (no statement): the Step 4 device writers call offline_operation_replay, apply
--     or store for review (create_review_item), then record_offline_operation, all in one
--     transaction; the Step 4 and Step 6 writers extend resolve_review_item with their apply paths
--     and call private.recalc_call_status when a decision changes a visit's status (D38).
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- 12. Fail closed when the hardening did not take effect (owner, 2026-11-11 and 2026-11-12: as
--     in Migration 3, section 12, byte for byte). Read-only; any leftover raises, and the whole
--     migration then rolls back. tests/db/220 runs a copy of this block (kept identical by
--     tests/ci/hardening-assertion.test.mjs) against injected leaks on the new objects.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_api oid[];
  v_authenticated oid;
  v_leaks text;
begin
  select pg_catalog.array_agg(r.oid) into v_api
  from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
  select r.oid into v_authenticated from pg_catalog.pg_roles r where r.rolname = 'authenticated';

  select pg_catalog.string_agg(x.leak, '; ' order by x.leak) into v_leaks
  from (
    select 'schema ' || n.nspname || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text as leak
    from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a
    where n.nspname in ('public', 'private') and a.privilege_type = 'CREATE'
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'relation ' || c.oid::regclass::text || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated)
           or (a.grantee = v_authenticated and (c.relkind = 'S' or a.privilege_type <> 'SELECT')))
    union all
    select 'column ' || c.oid::regclass::text || '.' || t.attname || ' ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_attribute t
    join pg_catalog.pg_class c on c.oid = t.attrelid
    cross join lateral pg_catalog.aclexplode(t.attacl) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and t.attacl is not null
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'function ' || p.oid::regprocedure::text || ' EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))) a
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated))
    union all
    select 'default privileges of postgres (' || d.defaclobjtype::text || ') ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    -- No global entry means the built-in default (EXECUTE for PUBLIC), so a missing row is a leak.
    select 'global default privileges of postgres (f) EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.aclexplode(coalesce(
      (select d.defaclacl from pg_catalog.pg_default_acl d
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'),
      pg_catalog.acldefault('f'::"char", 'postgres'::regrole))) a
    where a.grantee = 0 or a.grantee = any (v_api)
    union all
    select 'table ' || c.oid::regclass::text || ' without row level security'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    select 'relation ' || c.oid::regclass::text || ' owned by ' || c.relowner::regrole::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.relowner <> 'postgres'::regrole
    union all
    select 'function ' || p.oid::regprocedure::text || ' owned by ' || p.proowner::regrole::text
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proowner <> 'postgres'::regrole
    union all
    select 'policy ' || o.polname || ' on ' || o.polrelid::regclass::text || ' for a role other than authenticated'
    from pg_catalog.pg_policy o
    join pg_catalog.pg_class c on c.oid = o.polrelid
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and o.polroles is distinct from array[v_authenticated]::oid[]
    union all
    select 'function ' || p.oid::regprocedure::text || ' without search_path pg_catalog, pg_temp'
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
    union all
    -- A view runs with its owner's rights unless security_invoker is on; a materialized view
    -- has no such option. Only invoker-rights views (the RLS of the reader applies) pass.
    select 'view ' || c.oid::regclass::text || ' without security_invoker'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'v'
      and not coalesce((select o.option_value::boolean from pg_catalog.pg_options_to_table(c.reloptions) o
                        where o.option_name = 'security_invoker'), false)
    union all
    select 'materialized view ' || c.oid::regclass::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'm'
  ) x;

  if v_leaks is not null then
    raise exception 'hardening check failed, nothing is applied: %', v_leaks;
  end if;
end
$$;
