-- Step 1 / PR 1.5 — Migration 3: service calls, visits and their history.
--
-- Sources: docs/database-schema.md (§1, §2, §3, §4 "Migration 3", §6, §7, §8.3, §9, §10),
-- docs/security.md (§5, §8, §9, §10), decisions D12, D14, D17, D19, D33, D36, D38, D39, D40, D41,
-- D42, D43, D44, D45, D46, D47, D51, D57, docs/demo-deviations.md (TE-06 to TE-11, TE-19, TE-21,
-- TE-25, TE-26, SE-06, SE-07, OF-06, OF-09, OF-17) and the PR 1.5 plan
-- (docs/review/step1-pr15/README.md lists the deviations DEV-1 to DEV-16 and the TEMPORARY
-- behaviours).
--
-- Content: seven tables (service_calls, visits, visit_reports, visit_signatures,
-- visit_time_reports, visit_events, entity_changes), ten trigger functions, four deferred
-- constraint triggers and their SECURITY DEFINER functions, the call-status functions (D38:
-- compute_call_status and recalc_call_status), the entity_changes writer, the visit-read helper
-- can_read_visit, three narrow read functions for Technicians (previous_visits D36,
-- visit_rep_contact D40, my_visit_details) with their SECURITY INVOKER wrappers, the view
-- visit_time_current (D45), ten SELECT policies, per-object grants, the census extension and a
-- read-only fail-closed hardening check (section 12).
--
-- Data: schema only. No reference, test or fictitious rows (D47). No write path for any API role
-- in PR 1.5: the writers arrive with Step 4 (field closure, times, summary, signature), Step 5
-- (cancellation, open decision 5), Step 6 (ingestion) and PR 1.6 (corrections, review). Each of
-- them locks the call, changes visits and their status history, and then recalculates the call
-- status in the same transaction (database-schema.md §6); the deferred constraint triggers reject
-- at COMMIT any transaction that does not.
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step1-pr15 §13; each
-- question is "PR 1.5 OQ-n" in the owner message):
--   OQ-1  D36 earlier visits only through previous_visits (number, scheduled start, status,
--         technician name and colour, reason label, next-visit notes, summary, is_test); direct
--         visits and visit_reports rows only for his own visits.
--   OQ-2  the four constraint-trigger functions are owned by postgres (no dedicated role).
--   OQ-3  resolved_at = closed_at of the visit that resolves the call; NULL when not resolved.
--   OQ-4  summaries and signatures need `card` and (`cal` or `calls`).
--   OQ-5  task number, representative name, city, street, call type and fault are NOT NULL.
--   OQ-6  formats and limits (request number, task number, visit numbers 1-999, text lengths).
--   OQ-7  warranty yes / no / NULL, month precision (first day stored), raw text kept only with a
--         parsed value (an unparseable value is not ingested).
--   OQ-8  the representative's phone only from an active office profile, else NULL.
--   OQ-9  no second customer phone for Technicians.
--   OQ-10 the narrow functions serve his open visits and his visits closed today
--         (Asia/Jerusalem); his visits rows stay readable in every status.
--   OQ-11 time flags: 2 minutes in the future, 5 minutes of skew, the current assignment only;
--         one device report per visit and kind; `signed` is not in the sequence check.
--   OQ-12 no Technician policy on service_calls (the call fields come from my_visit_details).
--   OQ-13 previous_visits, visit_rep_contact and my_visit_details return row data: narrow server
--         functions (docs/security.md §5), signed off by the independent review.
--   OQ-14 no outcome-correction writer; the schema allows done -> followup, not followup -> done
--         without a signature.
--   OQ-15 no signature version or signature media columns (Step 4 adds them nullable).
--   Open decision 2 (d05): no Technician read of time reports (table, view or function).
--   Open decision 3 (d06): a closed visit needs a treatment summary (c10 rule b).
--   Closed and cancelled visits: no return to an open status, a closed visit is never cancelled,
--   and their assignment, schedule, address, notes and pickup do not change (D14, D39, D44).
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53), after
-- PR 1.3 and PR 1.4 are applied and merged, and after the owner has answered OQ-13.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified. No function builds or runs SQL text.
--
-- Definer-writer invariant (restated from Migration 1, section 4): every writer of these tables is
-- a SECURITY DEFINER body owned by postgres, so the SECURITY INVOKER triggers read consistent data.
-- The marker, one-way and history triggers do not depend on it: they read each referenced row with
-- SELECT ... INTO and raise 23503 when it is missing or not visible to the caller (fail closed).
-- These do rely on it: Migration 1's tg_one_way_people (an EXISTS check, attached unchanged), the
-- visit-number guard (max() over the call's visits) and compute_call_status (it reads the call's
-- visits); c20 re-checks next_visit_number at COMMIT with its owner's rights, not creation order.
--
-- Error codes:
--   42501 "not authorized" (narrow functions; generic, also for unknown, cancelled, earlier-day or
--         other technicians' visits)
--   23503 a referenced row is missing or not visible (marker, one-way and history triggers fail
--         closed; recalc_call_status on an unknown call); foreign keys
--   23514 integrity rule: CHECKs, the D47 one-way rule, visit-number allocation, the reporter of a
--         device time, entity_changes fields, and the deferred constraint triggers at COMMIT
--   23505 unique (request number, visit number per call, one device report per visit and kind)
--   55000 wrong state: immutable fields, status changes of closed or cancelled visits, server
--         times, append-only and immutable rows, DELETE, TRUNCATE

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
--    for any API role (no grants), no DELETE or TRUNCATE for anyone (triggers). Text rules
--    (TEMPORARY, OQ-6), written out in each CHECK:
--    TEXT-SAFE     as in Migration 2, section 1 (NFC, trimmed, a length range, no control,
--                  format, default-ignorable, private-use or noncharacter code point, no leading
--                  or trailing space variant).
--    TEXT-SAFE-ML  TEXT-SAFE with U+000A (line feed) allowed inside the text, never first or last
--                  (multi-line notes, fault description, summary, approval text). U+000D is
--                  refused: clients send LF line breaks.
--    ASCII-ID      printable ASCII with single internal spaces (task number), as in Migration 2.
--    source_ref    Migration 2's opaque internal ingestion reference (simulator event id, test-run
--                  id, later an internal reference to the external_calendar_events row), never
--                  invitation text, PII or a raw Microsoft Graph event id.
--    Codes (status, kind, event, source, flag) are permanent once rows exist: later migrations
--    may only add codes (DEV-3). Columns added later are nullable without a default
--    (docs/review/step1-pr15 §2.11).
-- ---------------------------------------------------------------------------------------------

-- 1.1 service_calls (root table; D17, D19, D38, D39, D42, D57). One call has one or more visits
--     (checked at COMMIT by c20). The creating INSERT sets status 'open' (the call is created with
--     its first, open visit); every later status change comes from private.recalc_call_status
--     (DEV-13).
create table public.service_calls (
  id uuid primary key default gen_random_uuid(),
  -- Unique across test and real rows (go-live hand-off, PR 1.4 OQ-13). TEMPORARY format (OQ-6):
  -- the UI's record-key rule.
  request_number text not null
    constraint service_calls_request_number_key unique
    constraint service_calls_request_number_check check (request_number ~ '^[A-Za-z0-9-]{1,32}$'),
  -- D17 (customer number required), D19 (SKU and product name). Frozen until the PR 1.6 review
  -- (D39: a different customer or SKU goes to review).
  customer_id uuid not null,
  product_id uuid not null,
  -- NOT NULL: TEMPORARY (OQ-5).
  call_type_id uuid not null
    constraint service_calls_call_type_id_fkey references public.call_types (id) on delete restrict,
  fault_description text not null
    constraint service_calls_fault_description_check check (
      fault_description = btrim(fault_description) and char_length(fault_description) between 1 and 1000 and fault_description is nfc normalized
      and fault_description !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and fault_description !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- TEMPORARY (OQ-7): yes / no; NULL = "לא צוין". The month is stored as its first day.
  warranty_status text
    constraint service_calls_warranty_status_check check (warranty_status in ('yes', 'no')),
  warranty_until date
    constraint service_calls_warranty_until_check check (
      warranty_until is null
      or (warranty_status is not null and warranty_status = 'yes' and isfinite(warranty_until)
          and extract(day from warranty_until) = 1)),
  warranty_raw text
    constraint service_calls_warranty_raw_check check (
      warranty_raw = btrim(warranty_raw) and char_length(warranty_raw) between 1 and 60 and warranty_raw is nfc normalized
      and warranty_raw !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and warranty_raw !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  handling_rep_name text not null
    constraint service_calls_handling_rep_name_check check (
      handling_rep_name = btrim(handling_rep_name) and char_length(handling_rep_name) between 1 and 60 and handling_rep_name is nfc normalized
      and handling_rep_name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and handling_rep_name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  handling_rep_profile_id uuid
    constraint service_calls_handling_rep_profile_id_fkey references public.profiles (id) on delete restrict,
  -- D38: no cancelled call status (open decision 5). No default.
  status text not null
    constraint service_calls_status_check check (status in ('open', 'resolved', 'awaiting_followup', 'awaiting_scheduling')),
  -- Allocates visit numbers 1-999; a committed call has a visit, so the next number is at least 2.
  -- No default: the writer sets it with the first visit. Never decreases (t35).
  next_visit_number integer not null
    constraint service_calls_next_visit_number_check check (next_visit_number between 2 and 1000),
  -- Server time of creation (t35), never changed (D45, D57).
  opened_at timestamptz not null default now(),
  -- TEMPORARY (OQ-3): closed_at of the resolving visit.
  resolved_at timestamptz,
  -- Fails closed: 'microsoft_graph' is added only by an approved Step 11 migration.
  data_source text not null
    constraint service_calls_data_source_check check (data_source in ('simulator', 'automated_test')),
  source_ref text not null
    constraint service_calls_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  -- D47: every source except the explicitly real one counts as test.
  is_test boolean generated always as (data_source <> 'microsoft_graph') stored,
  created_at timestamptz not null default now(),
  created_by uuid constraint service_calls_created_by_fkey references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid constraint service_calls_updated_by_fkey references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint service_calls_version_check check (version >= 1),
  -- Parent of the composite foreign key (service_call_id, is_test) of visits.
  constraint service_calls_id_is_test_key unique (id, is_test),
  constraint service_calls_customer_id_fkey foreign key (customer_id, is_test)
    references public.customers (id, is_test) on delete restrict,
  constraint service_calls_product_id_fkey foreign key (product_id, is_test)
    references public.products (id, is_test) on delete restrict,
  -- TEMPORARY (OQ-7): the raw text is kept only together with a parsed value.
  constraint service_calls_warranty_raw_status_check check ((warranty_status is null) = (warranty_raw is null)),
  constraint service_calls_resolved_at_check check ((status = 'resolved') = (resolved_at is not null)),
  constraint service_calls_simulator_creator_check check (data_source <> 'simulator' or created_by is not null)
);
create index service_calls_customer_id_opened_at_idx on public.service_calls (customer_id, opened_at);
create index service_calls_product_id_opened_at_idx on public.service_calls (product_id, opened_at);
create index service_calls_call_type_id_idx on public.service_calls (call_type_id);
create index service_calls_handling_rep_profile_id_idx on public.service_calls (handling_rep_profile_id)
  where handling_rep_profile_id is not null;
create index service_calls_status_idx on public.service_calls (status);
create index service_calls_opened_at_idx on public.service_calls (opened_at);
create index service_calls_resolved_at_idx on public.service_calls (resolved_at) where resolved_at is not null;
comment on table public.service_calls is
  'Service calls (D17, D38). status and resolved_at change only through private.recalc_call_status (D38). No write path in PR 1.5 (Step 6 ingestion, Step 4/5 visit writers, PR 1.6 review). Never deleted.';
alter table public.service_calls enable row level security;

-- 1.2 visits (D36, D39, D41, D44, D45). Address per visit (D39). Visit numbers are allocated in
--     creation order and never reused (t35). Server times assigned_at, closed_at and cancelled_at
--     are set by t12 (D45).
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  service_call_id uuid not null,
  technician_id uuid not null
    constraint visits_technician_id_fkey references public.technicians (id) on delete restrict,
  visit_number integer not null
    constraint visits_visit_number_check check (visit_number between 1 and 999),
  -- D41: a plain index, no uniqueness. NOT NULL and format: TEMPORARY (OQ-5, OQ-6).
  task_number text not null
    constraint visits_task_number_check check (
      char_length(task_number) between 1 and 40 and task_number ~ '^[!-~]+( [!-~]+)*$'),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  -- The demo's six statuses (DEV-3: codes; the adapter maps new/go/work/done/cont/cancel).
  status text not null
    constraint visits_status_check check (status in ('scheduled', 'en_route', 'in_progress', 'done', 'followup', 'cancelled')),
  city text not null
    constraint visits_city_check check (
      city = btrim(city) and char_length(city) between 1 and 60 and city is nfc normalized
      and city !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and city !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  street text not null
    constraint visits_street_check check (
      street = btrim(street) and char_length(street) between 1 and 120 and street is nfc normalized
      and street !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and street !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  building text
    constraint visits_building_check check (
      building = btrim(building) and char_length(building) between 1 and 20 and building is nfc normalized
      and building !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and building !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  floor text
    constraint visits_floor_check check (
      floor = btrim(floor) and char_length(floor) between 1 and 20 and floor is nfc normalized
      and floor !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and floor !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  apartment text
    constraint visits_apartment_check check (
      apartment = btrim(apartment) and char_length(apartment) between 1 and 20 and apartment is nfc normalized
      and apartment !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and apartment !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  arrival_notes text
    constraint visits_arrival_notes_check check (
      arrival_notes = btrim(arrival_notes) and char_length(arrival_notes) between 1 and 1000 and arrival_notes is nfc normalized
      and arrival_notes !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and arrival_notes !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  tech_notes text
    constraint visits_tech_notes_check check (
      tech_notes = btrim(tech_notes) and char_length(tech_notes) between 1 and 1000 and tech_notes is nfc normalized
      and tech_notes !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and tech_notes !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  pickup_item text
    constraint visits_pickup_item_check check (
      pickup_item = btrim(pickup_item) and char_length(pickup_item) between 1 and 120 and pickup_item is nfc normalized
      and pickup_item !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and pickup_item !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  pickup_location_id uuid
    constraint visits_pickup_location_id_fkey references public.collection_locations (id) on delete restrict,
  -- Follow-up outcome (SE-07, TE-21): on the visit, not `card` content.
  followup_reason_id uuid
    constraint visits_followup_reason_id_fkey references public.followup_reasons (id) on delete restrict,
  next_visit_notes text
    constraint visits_next_visit_notes_check check (
      next_visit_notes = btrim(next_visit_notes) and char_length(next_visit_notes) between 1 and 1000 and next_visit_notes is nfc normalized
      and next_visit_notes !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and next_visit_notes !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- Server times (D45, t12).
  assigned_at timestamptz not null default now(),
  closed_at timestamptz,
  cancelled_at timestamptz,
  -- NULL when the cancellation has no actor (an Outlook deletion, open decision 5).
  cancelled_by uuid
    constraint visits_cancelled_by_fkey references public.profiles (id) on delete restrict,
  -- Opaque reference to the invitation event (not unique: Step 6 owns event identity).
  source_ref text not null
    constraint visits_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  -- D47: copied from the call by t15 (the client value is ignored), frozen by t10 and t20.
  is_test boolean not null,
  -- Raised by the PR 1.6 conflict machinery (database-schema.md §1); column only here.
  field_version integer not null default 1 constraint visits_field_version_check check (field_version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid constraint visits_created_by_fkey references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid constraint visits_updated_by_fkey references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint visits_version_check check (version >= 1),
  -- Parent of the composite foreign keys of every visit_* table.
  constraint visits_id_is_test_key unique (id, is_test),
  constraint visits_service_call_id_visit_number_key unique (service_call_id, visit_number),
  constraint visits_service_call_id_fkey foreign key (service_call_id, is_test)
    references public.service_calls (id, is_test) on delete restrict,
  constraint visits_schedule_check check (
    isfinite(scheduled_start) and isfinite(scheduled_end) and scheduled_end >= scheduled_start),
  -- "המשך טיפול" needs a reason and next-visit notes.
  constraint visits_followup_check check (
    status <> 'followup' or (followup_reason_id is not null and next_visit_notes is not null)),
  constraint visits_closed_at_check check ((status in ('done', 'followup')) = (closed_at is not null)),
  constraint visits_cancelled_at_check check (status <> 'cancelled' or cancelled_at is not null),
  constraint visits_cancelled_by_check check (cancelled_by is null or cancelled_at is not null),
  -- An open visit was never cancelled; a closure accepted after cancellation (D44) keeps both.
  constraint visits_open_not_cancelled_check check (
    status not in ('scheduled', 'en_route', 'in_progress') or cancelled_at is null)
);
create index visits_technician_id_scheduled_start_idx on public.visits (technician_id, scheduled_start);
create index visits_task_number_idx on public.visits (task_number);
create index visits_scheduled_start_idx on public.visits (scheduled_start);
create index visits_pickup_location_id_idx on public.visits (pickup_location_id) where pickup_location_id is not null;
create index visits_followup_reason_id_idx on public.visits (followup_reason_id) where followup_reason_id is not null;
comment on table public.visits is
  'Visits (D36, D39, D41, D45). Status changes recalculate the call through private.recalc_call_status in the same transaction (D38). No write path in PR 1.5 (Step 4/5/6, PR 1.6). Never deleted.';
alter table public.visits enable row level security;

-- 1.3 visit_reports: the treatment summary (`card` content; D12, D14). Written at closure (or at
--     a D44 acceptance), never as a server draft: drafts stay on the device (c40).
create table public.visit_reports (
  visit_id uuid primary key,
  summary_text text not null
    constraint visit_reports_summary_text_check check (
      summary_text = btrim(summary_text) and char_length(summary_text) between 1 and 4000 and summary_text is nfc normalized
      and summary_text !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and summary_text !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- A recording is never a summary until its transcription is approved (D12).
  summary_source text not null
    constraint visit_reports_summary_source_check check (summary_source in ('written', 'approved_transcription')),
  -- D47: copied from the visit by t15.
  is_test boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid constraint visit_reports_created_by_fkey references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid constraint visit_reports_updated_by_fkey references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint visit_reports_version_check check (version >= 1),
  constraint visit_reports_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict
);
comment on table public.visit_reports is
  'Treatment summaries (card content; D12, D14). Written at closure only; corrected by audited PR 1.6 corrections. No write path in PR 1.5. Never deleted.';
alter table public.visit_reports enable row level security;

-- 1.4 visit_signatures: the customer signature and the exact approval text shown (D43).
--     Immutable after insert for every role. TEMPORARY (OQ-15): no ack_text_version_id or
--     signature_media_id; Step 4 adds them as nullable columns (DEV-2).
create table public.visit_signatures (
  visit_id uuid primary key,
  signer_name text not null
    constraint visit_signatures_signer_name_check check (
      signer_name = btrim(signer_name) and char_length(signer_name) between 1 and 100 and signer_name is nfc normalized
      and signer_name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and signer_name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  signed_ack_text text not null
    constraint visit_signatures_signed_ack_text_check check (
      signed_ack_text = btrim(signed_ack_text) and char_length(signed_ack_text) between 1 and 2000 and signed_ack_text is nfc normalized
      and signed_ack_text !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and signed_ack_text !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- sha256 of the NFC text (its own CHECK) encoded as UTF-8 (D43).
  ack_text_sha256 text not null
    constraint visit_signatures_ack_text_sha256_check check (
      ack_text_sha256 ~ '^[0-9a-f]{64}$'
      and ack_text_sha256 = encode(sha256(convert_to(signed_ack_text, 'UTF8')), 'hex')),
  -- The device operation that carried the signature (D45).
  operation_id uuid not null,
  is_test boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid constraint visit_signatures_created_by_fkey references public.profiles (id) on delete restrict,
  constraint visit_signatures_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict
);
comment on table public.visit_signatures is
  'Customer signatures with the exact approval text (D43). Immutable for every role; never corrected. No write path in PR 1.5.';
alter table public.visit_signatures enable row level security;

-- 1.5 visit_time_reports: device-reported field times (D45). Append-only; never rejected for a
--     suspicious clock, only flagged (row_flags, computed by t35). Infinite timestamps are not
--     clock values and are refused as malformed input (23514).
create table public.visit_time_reports (
  id bigint generated always as identity primary key,
  visit_id uuid not null,
  reported_by_profile_id uuid not null
    constraint visit_time_reports_reported_by_profile_id_fkey references public.profiles (id) on delete restrict,
  -- Credited technician: for device rows the reporter's own technician record (t35), so after a
  -- re-assignment each report stays credited to the technician who made it.
  technician_id uuid not null
    constraint visit_time_reports_technician_id_fkey references public.technicians (id) on delete restrict,
  kind text not null
    constraint visit_time_reports_kind_check check (kind in ('departed', 'arrived', 'ended', 'signed')),
  reported_at timestamptz,
  device_tz text
    constraint visit_time_reports_device_tz_check check (
      char_length(device_tz) <= 64 and device_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  device_utc_offset_min integer
    constraint visit_time_reports_device_utc_offset_min_check check (device_utc_offset_min between -840 and 840),
  device_sent_at timestamptz,
  -- Server time (t35).
  received_at timestamptz not null default now(),
  -- device_sent_at - received_at in milliseconds (t35).
  clock_skew_ms bigint,
  -- DEV-2: PR 1.6 adds 'correction' with correction_id and accepted_review_id.
  source text not null
    constraint visit_time_reports_source_check check (source = 'device'),
  operation_id uuid,
  -- TEMPORARY thresholds (OQ-11), computed by t35.
  row_flags text[] not null default '{}'
    constraint visit_time_reports_row_flags_check check (
      row_flags <@ array['future_time', 'large_skew', 'before_assignment']::text[]),
  is_test boolean not null,
  constraint visit_time_reports_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict,
  constraint visit_time_reports_device_check check (
    source <> 'device'
    or (reported_at is not null and device_tz is not null and device_utc_offset_min is not null
        and device_sent_at is not null and operation_id is not null and clock_skew_ms is not null
        and isfinite(reported_at) and isfinite(device_sent_at)))
);
-- At most one device report per visit and kind (double tap or a second device: 23505; the
-- writer routes it to review, PR 1.6). TEMPORARY (OQ-11): kept as database-schema.md designs it.
create unique index visit_time_reports_device_once_key on public.visit_time_reports (visit_id, kind)
  where source = 'device';
create index visit_time_reports_visit_id_kind_id_idx on public.visit_time_reports (visit_id, kind, id);
create index visit_time_reports_technician_id_idx on public.visit_time_reports (technician_id);
comment on table public.visit_time_reports is
  'Device-reported field times (D45). Append-only; flagged, never rejected for clock values; current value in public.visit_time_current. No write path in PR 1.5 (Step 4, PR 1.6).';
alter table public.visit_time_reports enable row level security;

-- 1.6 visit_events: visit status history. Append-only. Every visit has a 'created' event and its
--     latest event matches its status (c10 rule d).
create table public.visit_events (
  id bigint generated always as identity primary key,
  visit_id uuid not null,
  version_after integer not null constraint visit_events_version_after_check check (version_after >= 1),
  event_type text not null
    constraint visit_events_event_type_check check (event_type in ('created', 'status_changed')),
  from_status text
    constraint visit_events_from_status_check check (
      from_status in ('scheduled', 'en_route', 'in_progress', 'done', 'followup', 'cancelled')),
  to_status text not null
    constraint visit_events_to_status_check check (
      to_status in ('scheduled', 'en_route', 'in_progress', 'done', 'followup', 'cancelled')),
  -- Server time (t16).
  recorded_at timestamptz not null default now(),
  actor_profile_id uuid
    constraint visit_events_actor_profile_id_fkey references public.profiles (id) on delete restrict,
  operation_id uuid,
  is_test boolean not null,
  constraint visit_events_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict,
  constraint visit_events_event_type_from_status_check check ((event_type = 'created') = (from_status is null)),
  constraint visit_events_status_change_check check (from_status is distinct from to_status)
);
create index visit_events_visit_id_id_idx on public.visit_events (visit_id, id);
comment on table public.visit_events is
  'Visit status history. Append-only. Written by the visit writers of Step 4/5/6 and PR 1.6; no writer in PR 1.5.';
alter table public.visit_events enable row level security;

-- 1.7 entity_changes: field-level history of customers, products, service_calls and visits
--     (database-schema.md §4, §6). Append-only, polymorphic (no foreign key to the target).
--     None of the four target tables holds `card` content, so the `card` rule of
--     database-schema.md §8.3 holds by construction (DEV-8). SQL NULL means "no value"; a JSON
--     null is refused.
create table public.entity_changes (
  id bigint generated always as identity primary key,
  entity_table text not null
    constraint entity_changes_entity_table_check check (entity_table in ('customers', 'products', 'service_calls', 'visits')),
  entity_id uuid not null,
  -- A column of the target table (t20).
  field text not null
    constraint entity_changes_field_check check (field ~ '^[a-z][a-z0-9_]{0,62}$'),
  old_value jsonb
    constraint entity_changes_old_value_check check (
      old_value is null or (jsonb_typeof(old_value) <> 'null' and pg_column_size(old_value) <= 16384)),
  new_value jsonb
    constraint entity_changes_new_value_check check (
      new_value is null or (jsonb_typeof(new_value) <> 'null' and pg_column_size(new_value) <= 16384)),
  source text not null
    constraint entity_changes_source_check check (
      source in ('invitation', 'edit', 'correction', 'system', 'merge', 'rejected_submission')),
  source_ref text
    constraint entity_changes_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  -- auth.uid() of the writer's session (NULL without one, for example a system recalculation).
  actor_profile_id uuid
    constraint entity_changes_actor_profile_id_fkey references public.profiles (id) on delete restrict,
  -- Server time (t20).
  changed_at timestamptz not null default now(),
  -- D47: from the target row (t20).
  is_test boolean not null,
  constraint entity_changes_value_check check (old_value is distinct from new_value)
);
create index entity_changes_entity_table_entity_id_id_idx on public.entity_changes (entity_table, entity_id, id);
comment on table public.entity_changes is
  'Field-level history (database-schema.md §4, §6). Append-only. Written only by private.write_entity_change (actor from the session).';
alter table public.entity_changes enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger functions (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants). None of them writes data: they set or check NEW only. A referenced row is read with
--    SELECT ... INTO; a missing or invisible row raises 23503 (fail closed). Messages are generic:
--    no value, id or field name of a row.
-- ---------------------------------------------------------------------------------------------

-- t15 on visits (BEFORE INSERT): is_test from the call (D47); the client value is ignored.
create function private.tg_visit_marker()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  select c.is_test into v_is_test from public.service_calls c where c.id = new.service_call_id;
  if not found then
    raise exception using errcode = '23503', message = 'visits: unknown service call';
  end if;
  new.is_test := v_is_test;
  return new;
end
$$;

-- t15 on visit_reports, visit_signatures, visit_time_reports and visit_events (BEFORE INSERT):
-- is_test from the visit (D47); the client value is ignored.
create function private.tg_visit_child_marker()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  select v.is_test into v_is_test from public.visits v where v.id = new.visit_id;
  if not found then
    raise exception using errcode = '23503', message = tg_table_name || ': unknown visit';
  end if;
  new.is_test := v_is_test;
  return new;
end
$$;

-- t16 on visit_events (BEFORE INSERT): the server records the time (D45).
create function private.tg_history_server_time()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.recorded_at := now();
  return new;
end
$$;

-- t20 on entity_changes (BEFORE INSERT): server time, the field must be a column of the target
-- table (static per table, no dynamic SQL), is_test from the target row (D47).
create function private.tg_entity_change_target()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_table regclass;
begin
  new.changed_at := now();
  v_table := case new.entity_table
    when 'customers' then 'public.customers'::regclass
    when 'products' then 'public.products'::regclass
    when 'service_calls' then 'public.service_calls'::regclass
    when 'visits' then 'public.visits'::regclass
  end;
  if v_table is null or new.field is null or not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = v_table and a.attnum > 0 and not a.attisdropped and a.attname = new.field) then
    raise exception using errcode = '23514', message = 'entity_changes: invalid change record';
  end if;
  new.is_test := case new.entity_table
    when 'customers' then (select x.is_test from public.customers x where x.id = new.entity_id)
    when 'products' then (select x.is_test from public.products x where x.id = new.entity_id)
    when 'service_calls' then (select x.is_test from public.service_calls x where x.id = new.entity_id)
    when 'visits' then (select x.is_test from public.visits x where x.id = new.entity_id)
  end;
  if new.is_test is null then
    raise exception using errcode = '23503', message = 'entity_changes: unknown target';
  end if;
  return new;
end
$$;

-- a31 on service_calls (AFTER INSERT OR UPDATE OF call_type_id, when the generated is_test is
-- set): a real call never references a test call type (D47).
create function private.tg_one_way_call_refs()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  if new.is_test is true then
    return new;
  end if;
  select t.is_test into v_is_test from public.call_types t where t.id = new.call_type_id;
  if not found then
    raise exception using errcode = '23503', message = 'service_calls: unknown call type';
  end if;
  if v_is_test then
    raise exception using errcode = '23514', message = 'service_calls: a real record cannot reference test data (D47)';
  end if;
  return new;
end
$$;

-- t31 on visits (BEFORE INSERT OR UPDATE, after t15): a real visit never references a test
-- technician, pickup place or continuation reason (D47).
create function private.tg_one_way_visit_refs()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  if new.is_test is true then
    return new;
  end if;
  select t.is_test into v_is_test from public.technicians t where t.id = new.technician_id;
  if not found then
    raise exception using errcode = '23503', message = 'visits: unknown technician';
  end if;
  if v_is_test then
    raise exception using errcode = '23514', message = 'visits: a real record cannot reference test data (D47)';
  end if;
  if new.pickup_location_id is not null then
    select l.is_test into v_is_test from public.collection_locations l where l.id = new.pickup_location_id;
    if not found then
      raise exception using errcode = '23503', message = 'visits: unknown pickup place';
    end if;
    if v_is_test then
      raise exception using errcode = '23514', message = 'visits: a real record cannot reference test data (D47)';
    end if;
  end if;
  if new.followup_reason_id is not null then
    select r.is_test into v_is_test from public.followup_reasons r where r.id = new.followup_reason_id;
    if not found then
      raise exception using errcode = '23503', message = 'visits: unknown continuation reason';
    end if;
    if v_is_test then
      raise exception using errcode = '23514', message = 'visits: a real record cannot reference test data (D47)';
    end if;
  end if;
  return new;
end
$$;

-- t35 on visits (BEFORE INSERT): visit numbers are allocated in creation order and never reused
-- (D36 "earlier" = lower number, D38 "latest by number"): above every number of the call and below
-- service_calls.next_visit_number, which the writer raises first.
create function private.tg_visit_number_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_next integer;
  v_max integer;
begin
  select c.next_visit_number into v_next from public.service_calls c where c.id = new.service_call_id;
  if not found then
    raise exception using errcode = '23503', message = 'visits: unknown service call';
  end if;
  select max(v.visit_number) into v_max from public.visits v where v.service_call_id = new.service_call_id;
  if new.visit_number is null or new.visit_number >= v_next or new.visit_number <= coalesce(v_max, 0) then
    raise exception using errcode = '23514', message = 'visits: visit numbers are allocated in order';
  end if;
  return new;
end
$$;

-- t35 on service_calls (BEFORE INSERT OR UPDATE): opened_at is the server's creation time (D45;
-- t10 freezes it); next_visit_number never decreases.
create function private.tg_service_call_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.opened_at := now();
  elsif new.next_visit_number < old.next_visit_number then
    raise exception using errcode = '23514', message = 'service_calls: next_visit_number never decreases';
  end if;
  return new;
end
$$;

-- t12 on visits (BEFORE INSERT OR UPDATE): server times and the state rules of closed and
-- cancelled visits (D14, D39, D44, D45).
--   INSERT: assigned_at = now(); closed_at = now() when inserted closed, else NULL; cancelled_at =
--   now() when inserted cancelled, else NULL.
--   UPDATE: assigned_at = now() when the technician changes, otherwise unchanged; closed_at = now()
--   on a change from an open status to done or followup, unchanged between done and followup; on a
--   closure accepted after cancellation (D44) the writer supplies the original receipt time,
--   between cancelled_at and now() (Step 1 plan v6 §7.2 C1); cancelled_at = now() on a change to
--   cancelled, otherwise unchanged. Any other change of these three columns: 55000.
--   TEMPORARY (deny by default): a closed visit stays closed (done <-> followup only); a cancelled
--   visit stays cancelled or is closed by an accepted closure; on a closed or cancelled visit the
--   assignment, schedule, address, notes and pickup do not change. Moves among the open statuses
--   are not restricted here: Step 4, Step 6 and PR 1.6 decide and may replace this function.
create function private.tg_visit_state_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_at := now();
    new.closed_at := case when new.status in ('done', 'followup') then now() end;
    new.cancelled_at := case when new.status = 'cancelled' then now() end;
    return new;
  end if;

  if (old.status in ('done', 'followup') and new.status not in ('done', 'followup'))
     or (old.status = 'cancelled' and new.status not in ('cancelled', 'done', 'followup')) then
    raise exception using errcode = '55000', message = 'visits: invalid status change';
  end if;
  if old.status in ('done', 'followup', 'cancelled')
     and (new.technician_id, new.task_number, new.scheduled_start, new.scheduled_end, new.city, new.street,
          new.building, new.floor, new.apartment, new.arrival_notes, new.tech_notes, new.pickup_item,
          new.pickup_location_id)
         is distinct from
         (old.technician_id, old.task_number, old.scheduled_start, old.scheduled_end, old.city, old.street,
          old.building, old.floor, old.apartment, old.arrival_notes, old.tech_notes, old.pickup_item,
          old.pickup_location_id) then
    raise exception using errcode = '55000', message = 'visits: a closed or cancelled visit keeps its assignment, schedule, address, notes and pickup';
  end if;

  if new.technician_id is distinct from old.technician_id then
    new.assigned_at := now();
  elsif new.assigned_at is distinct from old.assigned_at then
    raise exception using errcode = '55000', message = 'visits: assigned_at is set by the server';
  end if;

  if old.status in ('scheduled', 'en_route', 'in_progress') and new.status in ('done', 'followup') then
    new.closed_at := now();
  elsif old.status = 'cancelled' and new.status in ('done', 'followup') then
    if new.closed_at is null or new.closed_at < old.cancelled_at or new.closed_at > now() then
      raise exception using errcode = '55000', message = 'visits: closed_at is set by the server';
    end if;
  elsif new.closed_at is distinct from old.closed_at then
    raise exception using errcode = '55000', message = 'visits: closed_at is set by the server';
  end if;

  if old.status = 'cancelled' and new.cancelled_by is distinct from old.cancelled_by then
    raise exception using errcode = '55000', message = 'visits: cancelled_by is kept once the visit is cancelled';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
  elsif new.cancelled_at is distinct from old.cancelled_at then
    raise exception using errcode = '55000', message = 'visits: cancelled_at is set by the server';
  end if;
  return new;
end
$$;

-- t35 on visit_time_reports (BEFORE INSERT): received_at = now(); clock_skew_ms =
-- device_sent_at - received_at (ms); the credited technician (D47 one-way; for device rows the
-- reporter's own technician record); row_flags (TEMPORARY thresholds, OQ-11) on the skew-corrected
-- time reported_at - clock_skew_ms: future_time when it is more than 2 minutes after received_at,
-- large_skew when |clock_skew_ms| > 300000, before_assignment when the reporter is the visit's
-- current technician and it is before visits.assigned_at. Client values of received_at,
-- clock_skew_ms and row_flags are ignored. Infinite device times are not computed (the device CHECK
-- refuses the row with 23514); the arithmetic is done on intervals and numerics, so no finite
-- clock value overflows.
create function private.tg_time_report_derive()
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
-- 3. Read function shared by the call-status writer and the integrity checks (D38;
--    database-schema.md §6). SECURITY INVOKER, read-only, no grants. Rules in order: (1) any open
--    visit (scheduled, en route, in progress) -> open; (2) otherwise the closed visit (done or
--    followup) with the highest visit number decides (never sync or closure time) -> resolved or
--    awaiting_followup; (3) otherwise (every visit cancelled) -> awaiting_scheduling. resolved_at
--    is the resolving visit's closed_at when (2) gives resolved, else NULL (TEMPORARY, OQ-3).
--    Cancelled visits never cancel the call.
-- ---------------------------------------------------------------------------------------------
create function private.compute_call_status(p_call_id uuid)
returns table (status text, resolved_at timestamptz)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when o.has_open then 'open'
           when d.status = 'done' then 'resolved'
           when d.status = 'followup' then 'awaiting_followup'
           else 'awaiting_scheduling'
         end,
         case when not o.has_open and d.status = 'done' then d.closed_at end
  from (select exists (select 1 from public.visits v
                       where v.service_call_id = p_call_id
                         and v.status in ('scheduled', 'en_route', 'in_progress')) as has_open) o
  left join lateral (select v.status, v.closed_at
                     from public.visits v
                     where v.service_call_id = p_call_id and v.status in ('done', 'followup')
                     order by v.visit_number desc
                     limit 1) d on true
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Deferred constraint-trigger functions (database-schema.md §9; docs/security.md §5).
--    SECURITY DEFINER, so a check at COMMIT sees every row it needs whoever commits (a Technician,
--    a Manager with `card` off, service_role). Owner postgres (TEMPORARY, OQ-2; DEV-5). No grants:
--    a trigger function cannot be called directly. Each one first locks the call row FOR NO KEY
--    UPDATE, so two transactions that change visits of one call are checked one after the other,
--    then re-reads the current rows (never NEW) and raises 23514 with a generic message.
-- ---------------------------------------------------------------------------------------------

-- c10 on visits (AFTER INSERT OR UPDATE OF status, closed_at): (a) done needs a signature (D43);
-- (b) done or followup needs a treatment summary (TEMPORARY, open decision 3 / d06); (c) the call's
-- stored status and resolved_at equal compute_call_status (D38, same transaction); (d) the visit
-- has a 'created' event and its latest event (highest id) ends in its current status.
create function private.ct_visit_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_call public.service_calls;
  v_visit public.visits;
  v_status text;
  v_resolved_at timestamptz;
  v_last_status text;
begin
  select c.* into v_call from public.service_calls c where c.id = new.service_call_id for no key update;
  if not found then
    raise exception using errcode = '23514', message = 'visits: unknown service call';
  end if;
  select v.* into v_visit from public.visits v where v.id = new.id;
  if not found then
    raise exception using errcode = '23514', message = 'visits: unknown visit';
  end if;
  if v_visit.status = 'done'
     and not exists (select 1 from public.visit_signatures s where s.visit_id = v_visit.id) then
    raise exception using errcode = '23514', message = 'visits: a completed visit needs the customer signature';
  end if;
  if v_visit.status in ('done', 'followup')
     and not exists (select 1 from public.visit_reports r where r.visit_id = v_visit.id) then
    raise exception using errcode = '23514', message = 'visits: a closed visit needs its treatment summary';
  end if;
  select s.status, s.resolved_at into v_status, v_resolved_at from private.compute_call_status(v_call.id) s;
  if v_call.status is distinct from v_status or v_call.resolved_at is distinct from v_resolved_at then
    raise exception using errcode = '23514', message = 'service_calls: the stored call status does not match its visits (D38)';
  end if;
  select e.to_status into v_last_status
  from public.visit_events e where e.visit_id = v_visit.id order by e.id desc limit 1;
  if v_last_status is distinct from v_visit.status
     or not exists (select 1 from public.visit_events e where e.visit_id = v_visit.id and e.event_type = 'created') then
    raise exception using errcode = '23514', message = 'visits: the status history does not match the visit';
  end if;
  return null;
end
$$;

-- c20 on service_calls (AFTER INSERT OR UPDATE): (a) at least one visit; (b) the stored status and
-- resolved_at equal compute_call_status (D38); (c) next_visit_number is above every visit number.
create function private.ct_service_call_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_call public.service_calls;
  v_count bigint;
  v_max integer;
  v_status text;
  v_resolved_at timestamptz;
begin
  select c.* into v_call from public.service_calls c where c.id = new.id for no key update;
  if not found then
    raise exception using errcode = '23514', message = 'service_calls: unknown service call';
  end if;
  select count(*), max(v.visit_number) into v_count, v_max from public.visits v where v.service_call_id = v_call.id;
  if v_count = 0 then
    raise exception using errcode = '23514', message = 'service_calls: a call has at least one visit';
  end if;
  select s.status, s.resolved_at into v_status, v_resolved_at from private.compute_call_status(v_call.id) s;
  if v_call.status is distinct from v_status or v_call.resolved_at is distinct from v_resolved_at then
    raise exception using errcode = '23514', message = 'service_calls: the stored call status does not match its visits (D38)';
  end if;
  if v_call.next_visit_number <= v_max then
    raise exception using errcode = '23514', message = 'service_calls: next_visit_number must be above every visit number';
  end if;
  return null;
end
$$;

-- c30 on visit_signatures (AFTER INSERT): the visit is done at COMMIT (an immutable signature never
-- lands on an open, follow-up or cancelled visit). A later status change is caught by c10.
create function private.ct_signature_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_call_id uuid;
  v_status text;
begin
  select v.service_call_id into v_call_id from public.visits v where v.id = new.visit_id;
  perform 1 from public.service_calls c where c.id = v_call_id for no key update;
  select v.status into v_status from public.visits v where v.id = new.visit_id;
  if v_status is distinct from 'done' then
    raise exception using errcode = '23514', message = 'visit_signatures: a signature belongs to a completed visit';
  end if;
  return null;
end
$$;

-- c40 on visit_reports (AFTER INSERT): the visit is done or followup at COMMIT (a report that can
-- never be deleted is never a server draft). A later status change is caught by c10.
create function private.ct_report_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_call_id uuid;
  v_status text;
begin
  select v.service_call_id into v_call_id from public.visits v where v.id = new.visit_id;
  perform 1 from public.service_calls c where c.id = v_call_id for no key update;
  select v.status into v_status from public.visits v where v.id = new.visit_id;
  if v_status is null or v_status not in ('done', 'followup') then
    raise exception using errcode = '23514', message = 'visit_reports: a treatment summary belongs to a closed visit';
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Attach the triggers. Name prefixes fix the firing order (BEFORE triggers run by name): t10
--    immutability, t12 state and server times, t15 marker from the parent, t16 history server
--    time, t20 marker immutability (and the entity_changes target), t30 one-way (people), t31
--    one-way (references), t35 guards and derived values, t90 version, t95 delete, t99 truncate.
--    On service_calls is_test is a stored generated column, which BEFORE triggers read as NULL:
--    its one-way checks run AFTER the row is formed (a30, a31), and its markers are frozen by t10
--    (data_source) and generation (Migration 2, section 3). c10-c40 are the deferred constraint
--    triggers (checked at COMMIT, or at SET CONSTRAINTS ... IMMEDIATE).
-- ---------------------------------------------------------------------------------------------

-- service_calls: the request number, customer, product (D39: changed only by the PR 1.6 review,
-- which replaces this trigger with a wider list; DEV-12), opened_at, the source and the creation
-- fields never change. is_test is listed only because a BEFORE trigger reads it as NULL; it is
-- generated from the frozen data_source.
create trigger t10_immutable before update on public.service_calls
  for each row execute function private.tg_immutable_except(
    'call_type_id', 'fault_description', 'warranty_status', 'warranty_until', 'warranty_raw', 'handling_rep_name',
    'handling_rep_profile_id', 'status', 'next_visit_number', 'resolved_at', 'version', 'updated_at', 'updated_by',
    'is_test');
create trigger t35_call_guard before insert or update on public.service_calls
  for each row execute function private.tg_service_call_guard();
create trigger t90_bump_version before update on public.service_calls
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.service_calls
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.service_calls
  for each statement execute function private.tg_reject_truncate();
create trigger a30_one_way after insert or update on public.service_calls
  for each row execute function private.tg_one_way_people('created_by', 'updated_by', 'handling_rep_profile_id');
create trigger a31_one_way_refs after insert or update of call_type_id on public.service_calls
  for each row execute function private.tg_one_way_call_refs();
create constraint trigger c20_call_rules after insert or update on public.service_calls
  deferrable initially deferred
  for each row execute function private.ct_service_call_rules();

-- visits: the call, the visit number, the source, is_test and the creation fields never change.
create trigger t10_immutable before update on public.visits
  for each row execute function private.tg_immutable_except(
    'technician_id', 'task_number', 'scheduled_start', 'scheduled_end', 'status', 'city', 'street', 'building',
    'floor', 'apartment', 'arrival_notes', 'tech_notes', 'pickup_item', 'pickup_location_id', 'followup_reason_id',
    'next_visit_notes', 'assigned_at', 'closed_at', 'cancelled_at', 'cancelled_by', 'field_version', 'version',
    'updated_at', 'updated_by');
create trigger t12_visit_state before insert or update on public.visits
  for each row execute function private.tg_visit_state_guard();
create trigger t15_marker_from_call before insert on public.visits
  for each row execute function private.tg_visit_marker();
create trigger t20_immutable_markers before update on public.visits
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.visits
  for each row execute function private.tg_one_way_people('created_by', 'updated_by', 'cancelled_by');
create trigger t31_one_way_refs before insert or update on public.visits
  for each row execute function private.tg_one_way_visit_refs();
create trigger t35_visit_number before insert on public.visits
  for each row execute function private.tg_visit_number_guard();
create trigger t90_bump_version before update on public.visits
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.visits
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.visits
  for each statement execute function private.tg_reject_truncate();
create constraint trigger c10_visit_rules after insert or update of status, closed_at on public.visits
  deferrable initially deferred
  for each row execute function private.ct_visit_rules();

-- visit_reports: only the summary changes (PR 1.6 corrections).
create trigger t10_immutable before update on public.visit_reports
  for each row execute function private.tg_immutable_except('summary_text', 'summary_source', 'version', 'updated_at', 'updated_by');
create trigger t15_marker_from_visit before insert on public.visit_reports
  for each row execute function private.tg_visit_child_marker();
create trigger t20_immutable_markers before update on public.visit_reports
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.visit_reports
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.visit_reports
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.visit_reports
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.visit_reports
  for each statement execute function private.tg_reject_truncate();
create constraint trigger c40_report_rules after insert on public.visit_reports
  deferrable initially deferred
  for each row execute function private.ct_report_rules();

-- visit_signatures: immutable for every role (database-schema.md §1).
create trigger t10_reject_update_delete before update or delete on public.visit_signatures
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_visit before insert on public.visit_signatures
  for each row execute function private.tg_visit_child_marker();
create trigger t30_one_way before insert on public.visit_signatures
  for each row execute function private.tg_one_way_people('created_by');
create trigger t99_reject_truncate before truncate on public.visit_signatures
  for each statement execute function private.tg_reject_truncate();
create constraint trigger c30_signature_rules after insert on public.visit_signatures
  deferrable initially deferred
  for each row execute function private.ct_signature_rules();

-- visit_time_reports: append-only.
create trigger t10_reject_update_delete before update or delete on public.visit_time_reports
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_visit before insert on public.visit_time_reports
  for each row execute function private.tg_visit_child_marker();
create trigger t30_one_way before insert on public.visit_time_reports
  for each row execute function private.tg_one_way_people('reported_by_profile_id');
create trigger t35_time_report before insert on public.visit_time_reports
  for each row execute function private.tg_time_report_derive();
create trigger t99_reject_truncate before truncate on public.visit_time_reports
  for each statement execute function private.tg_reject_truncate();

-- visit_events: append-only.
create trigger t10_reject_update_delete before update or delete on public.visit_events
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_visit before insert on public.visit_events
  for each row execute function private.tg_visit_child_marker();
create trigger t16_event_time before insert on public.visit_events
  for each row execute function private.tg_history_server_time();
create trigger t30_one_way before insert on public.visit_events
  for each row execute function private.tg_one_way_people('actor_profile_id');
create trigger t99_reject_truncate before truncate on public.visit_events
  for each statement execute function private.tg_reject_truncate();

-- entity_changes: append-only; t20 derives is_test, which the one-way check (t30) reads.
create trigger t10_reject_update_delete before update or delete on public.entity_changes
  for each row execute function private.tg_reject_update_delete();
create trigger t20_entity_target before insert on public.entity_changes
  for each row execute function private.tg_entity_change_target();
create trigger t30_one_way before insert on public.entity_changes
  for each row execute function private.tg_one_way_people('actor_profile_id');
create trigger t99_reject_truncate before truncate on public.entity_changes
  for each statement execute function private.tg_reject_truncate();

-- ---------------------------------------------------------------------------------------------
-- 6. History writer and call-status writer (database-schema.md §4, §6; D38). SECURITY INVOKER:
--    their callers are the SECURITY DEFINER bodies of later steps. No grants, no public wrapper,
--    never named by a statement that runs (migration guard rule 4). The actor is always auth.uid()
--    of the session (NULL without one, for example Microsoft Graph ingestion), as in write_audit:
--    no parameter can attribute a change to someone else.
-- ---------------------------------------------------------------------------------------------

-- The only writer of entity_changes. Its triggers set changed_at and is_test and check the field.
create function private.write_entity_change(
  p_entity_table text, p_entity_id uuid, p_field text, p_old_value jsonb, p_new_value jsonb,
  p_source text, p_source_ref text)
returns bigint
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id bigint;
begin
  insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, source_ref, actor_profile_id)
  values (p_entity_table, p_entity_id, p_field, p_old_value, p_new_value, p_source, p_source_ref, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- D38: the only writer of changes to service_calls.status and resolved_at (the creating INSERT
-- sets the initial 'open', DEV-13). Locks the call FOR UPDATE (unknown id: 23503), then computes in
-- a later statement, so under READ COMMITTED it sees every visit change committed before the lock
-- was granted. No change: no write and no history row. Otherwise one UPDATE (updated_by =
-- auth.uid()) and one entity_changes row per changed field (source 'system'). Every writer that
-- changes a visit calls it after the last visit change of its transaction; c10 and c20 reject the
-- transaction at COMMIT otherwise.
create function private.recalc_call_status(p_call_id uuid)
returns text
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_call public.service_calls;
  v_status text;
  v_resolved_at timestamptz;
begin
  select c.* into v_call from public.service_calls c where c.id = p_call_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'service_calls: unknown service call';
  end if;
  select s.status, s.resolved_at into v_status, v_resolved_at from private.compute_call_status(p_call_id) s;
  if v_status is not distinct from v_call.status and v_resolved_at is not distinct from v_call.resolved_at then
    return v_status;
  end if;
  update public.service_calls c set status = v_status, resolved_at = v_resolved_at, updated_by = auth.uid()
  where c.id = p_call_id;
  if v_status is distinct from v_call.status then
    perform private.write_entity_change('service_calls', p_call_id, 'status',
      to_jsonb(v_call.status), to_jsonb(v_status), 'system', null);
  end if;
  if v_resolved_at is distinct from v_call.resolved_at then
    perform private.write_entity_change('service_calls', p_call_id, 'resolved_at',
      to_jsonb(v_call.resolved_at), to_jsonb(v_resolved_at), 'system', null);
  end if;
  return v_status;
end
$$;
comment on function private.recalc_call_status(uuid) is
  'D38: the only writer of service_calls.status and resolved_at changes. Called by visit writers after their last visit change; never by a migration.';
comment on function private.write_entity_change(text, uuid, text, jsonb, jsonb, text, text) is
  'The only writer of entity_changes; the actor is auth.uid() of the session. Called by SECURITY DEFINER writers; never by a migration.';

-- ---------------------------------------------------------------------------------------------
-- 7. Visit read helper and narrow read functions (D36, D40, D46; docs/security.md §5;
--    database-schema.md §8.3, §9). SECURITY DEFINER in private, STABLE, schema-qualified, no
--    dynamic SQL; each checks its caller from profiles and technicians through the Migration 1
--    helpers (an active profile is required) and raises the generic 42501 otherwise. They do not
--    call require_caller: its FOR SHARE lock is not allowed in a STABLE function.
--    can_read_visit returns a boolean (database-schema.md §9 helper) and has no grant and no
--    wrapper in PR 1.5 (DEV-16): only previous_visits calls it; Step 4 grants it when a
--    visit_media policy needs it. The three narrow functions return row data, limited to the
--    listed columns (TEMPORARY, OQ-13: "narrow server functions" of docs/security.md §5); their
--    SECURITY INVOKER wrappers in public are not a boundary (each body checks its caller).
-- ---------------------------------------------------------------------------------------------

-- True for an active office user with `cal` or `calls` (the Creator always), for the active
-- Technician's own visit (any status), and for a D36 earlier visit: done or followup, on the same
-- call, with a lower number than one of his visits that is scheduled, en route or in progress.
create function private.can_read_visit(p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.visits v
    where v.id = p_visit_id
      and ((select private.has_permission('cal')) or (select private.has_permission('calls'))
           or v.technician_id = (select private.my_technician_id())
           or (v.status in ('done', 'followup')
               and exists (select 1 from public.visits o
                           where o.service_call_id = v.service_call_id
                             and o.technician_id = (select private.my_technician_id())
                             and o.status in ('scheduled', 'en_route', 'in_progress')
                             and o.visit_number > v.visit_number))))
$$;

-- D36 (TEMPORARY, OQ-1): for the caller's own open visit, the earlier closed visits of the same
-- call, each through can_read_visit, ordered by number. Columns: number, scheduled start, status,
-- the technician's display name and colour, the continuation reason label (also when
-- deactivated), next-visit notes, the summary and its source, is_test (D47 label). Never the
-- technician id, scheduled end, signature, signer, time reports, server times, address, notes,
-- pickup or cancellation fields. 42501 for anyone else, and after closure, cancellation,
-- re-assignment or deactivation (D36 revocation). Step 4 adds parts, media and transcripts by
-- DROP and CREATE of this body and its wrapper.
create function private.previous_visits(p_visit_id uuid)
returns table (
  visit_number integer, scheduled_start timestamptz, status text, technician_name text, technician_color text,
  followup_reason_label text, next_visit_notes text, summary_text text, summary_source text, is_test boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_technician_id uuid := private.my_technician_id();
  v_visit public.visits;
begin
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or v_technician_id is null or v_visit.technician_id is distinct from v_technician_id
     or v_visit.status not in ('scheduled', 'en_route', 'in_progress') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select p.visit_number, p.scheduled_start, p.status, t.display_name, t.color, r.label_he, p.next_visit_notes,
           rep.summary_text, rep.summary_source, p.is_test
    from public.visits p
    join public.technicians t on t.id = p.technician_id
    left join public.followup_reasons r on r.id = p.followup_reason_id
    left join public.visit_reports rep on rep.visit_id = p.id
    where p.service_call_id = v_visit.service_call_id
      and p.visit_number < v_visit.visit_number
      and p.status in ('done', 'followup')
      and private.can_read_visit(p.id)
    order by p.visit_number;
end
$$;

-- D40 (TEMPORARY, OQ-8, OQ-10): the handling representative of the caller's own visit that is open
-- or was closed today (Asia/Jerusalem): the name from the invitation and the work phone of the
-- linked profile only while that profile is active with an office role, else NULL. 42501
-- otherwise (also for his own cancelled visits and visits closed before today).
create function private.visit_rep_contact(p_visit_id uuid)
returns table (rep_name text, work_phone text)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_technician_id uuid := private.my_technician_id();
  v_visit public.visits;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  v_day_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day') at time zone 'Asia/Jerusalem';
begin
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or v_technician_id is null or v_visit.technician_id is distinct from v_technician_id
     or not (v_visit.status in ('scheduled', 'en_route', 'in_progress')
             or (v_visit.status in ('done', 'followup')
                 and v_visit.closed_at >= v_day_start and v_visit.closed_at < v_day_end)) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select c.handling_rep_name,
           case when p.is_active and p.role in ('creator', 'manager', 'customer_service') then p.work_phone end
    from public.service_calls c
    left join public.profiles p on p.id = c.handling_rep_profile_id
    where c.id = v_visit.service_call_id;
end
$$;

-- The call, customer, product and label details of the caller's own visit that is open or was
-- closed today (Asia/Jerusalem) (TEMPORARY, OQ-10, OQ-12; PR 1.4 hand-off): request number, call
-- type label, fault, warranty status and month (the raw text is not returned), is_test (D47 label);
-- customer number, name and phone (no second phone, OQ-9); product SKU and name (no brand or
-- supplier, PR 1.4 OQ-12); pickup place name, type and address; continuation reason label. Labels
-- are returned also when deactivated. 42501 otherwise.
create function private.my_visit_details(p_visit_id uuid)
returns table (
  request_number text, call_type_label text, fault_description text, warranty_status text, warranty_until date,
  is_test boolean, customer_number text, customer_name text, customer_phone text, product_sku_display text,
  product_name text, pickup_location_name text, pickup_location_type text, pickup_location_address text,
  followup_reason_label text)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_technician_id uuid := private.my_technician_id();
  v_visit public.visits;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  v_day_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day') at time zone 'Asia/Jerusalem';
begin
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or v_technician_id is null or v_visit.technician_id is distinct from v_technician_id
     or not (v_visit.status in ('scheduled', 'en_route', 'in_progress')
             or (v_visit.status in ('done', 'followup')
                 and v_visit.closed_at >= v_day_start and v_visit.closed_at < v_day_end)) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select c.request_number, ct.label_he, c.fault_description, c.warranty_status, c.warranty_until, c.is_test,
           cu.customer_number, cu.name, cu.phone, pr.sku_display, pr.name,
           l.name, l.place_type, l.address, r.label_he
    from public.service_calls c
    join public.call_types ct on ct.id = c.call_type_id
    join public.customers cu on cu.id = c.customer_id
    join public.products pr on pr.id = c.product_id
    left join public.collection_locations l on l.id = v_visit.pickup_location_id
    left join public.followup_reasons r on r.id = v_visit.followup_reason_id
    where c.id = v_visit.service_call_id;
end
$$;

-- Public API: thin SECURITY INVOKER wrappers, same names and arguments as the bodies.
create function public.previous_visits(p_visit_id uuid)
returns table (
  visit_number integer, scheduled_start timestamptz, status text, technician_name text, technician_color text,
  followup_reason_label text, next_visit_notes text, summary_text text, summary_source text, is_test boolean)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$ select * from private.previous_visits(p_visit_id) $$;

create function public.visit_rep_contact(p_visit_id uuid)
returns table (rep_name text, work_phone text)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$ select * from private.visit_rep_contact(p_visit_id) $$;

create function public.my_visit_details(p_visit_id uuid)
returns table (
  request_number text, call_type_label text, fault_description text, warranty_status text, warranty_until date,
  is_test boolean, customer_number text, customer_name text, customer_phone text, product_sku_display text,
  product_name text, pickup_location_name text, pickup_location_type text, pickup_location_address text,
  followup_reason_label text)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$ select * from private.my_visit_details(p_visit_id) $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Current field times (D45; database-schema.md §7, §9 "views run with the caller's rights").
--    SECURITY INVOKER view: the policies of visit_time_reports apply to the caller (no Technician
--    reads, TEMPORARY, open decision 2). One row per visit and kind: the current report is the
--    newest (highest id) row whose source is not 'device' (corrections and, from PR 1.6, accepted
--    reports, which keep their original receipt time), otherwise the single device report.
--    sequence_flags (TEMPORARY, OQ-11), computed and never stored, so a correction clears them:
--    arrived before departed -> before_departed; ended before arrived -> before_arrived; ended
--    before departed -> before_departed. Missing kinds are not flagged; signed is not checked.
-- ---------------------------------------------------------------------------------------------
create view public.visit_time_current with (security_invoker = true) as
  with cur as (
    select distinct on (t.visit_id, t.kind)
           t.id, t.visit_id, t.kind, t.reported_at, t.received_at, t.source, t.technician_id,
           t.reported_by_profile_id, t.row_flags, t.is_test
    from public.visit_time_reports t
    order by t.visit_id, t.kind, (t.source = 'device'), t.id desc
  )
  select c.id as report_id, c.visit_id, c.kind, c.reported_at, c.received_at, c.source, c.technician_id,
         c.reported_by_profile_id, c.row_flags, c.is_test,
         array_remove(array[
           case when c.kind = 'arrived' and c.reported_at < d.reported_at then 'before_departed' end,
           case when c.kind = 'ended' and c.reported_at < a.reported_at then 'before_arrived' end,
           case when c.kind = 'ended' and c.reported_at < d.reported_at then 'before_departed' end
         ]::text[], null) as sequence_flags
  from cur c
  left join cur d on d.visit_id = c.visit_id and d.kind = 'departed'
  left join cur a on a.visit_id = c.visit_id and a.kind = 'arrived';
comment on view public.visit_time_current is
  'Current device or corrected time per visit and kind (D45), with computed sequence flags. Runs with the caller''s rights.';

-- ---------------------------------------------------------------------------------------------
-- 9. Test-data census (replaces the PR 1.4 function; same signature, ACL and caller rule).
--    service_calls is counted per source in fixed rows, as customers and products; the six child
--    and history tables in one 'all sources' row each.
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
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 10. RLS policies: SELECT only, TO authenticated only, every one requires an active profile
--     (through the helpers), every column qualified with its table. No write or anon policies.
--     Ten policies (database-schema.md §8.3, narrowed where marked):
--     service_calls       office `cal` or `calls`; no Technician policy (TEMPORARY, OQ-12, DEV-11)
--     visits              office `cal` or `calls`; Technician: his own visits, every status (OQ-10;
--                         D36 earlier visits only through previous_visits, OQ-1, DEV-6)
--     visit_reports       office `card` and (`cal` or `calls`) (OQ-4, DEV-10); Technician: his own
--                         visits only (OQ-1, DEV-6)
--     visit_signatures    office `card` and (`cal` or `calls`) (OQ-4); Technician: his own only (D36)
--     visit_time_reports  office `cal` or `calls`; no Technician policy (open decision 2, d05)
--     visit_events        office `calls`; no Technician policy
--     entity_changes      office `calls`; no Technician policy (no `card` content, DEV-8)
--     visit_time_current (view) follows visit_time_reports.
-- ---------------------------------------------------------------------------------------------
create policy service_calls_select_office on public.service_calls for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));

create policy visits_select_technician on public.visits for select to authenticated
  using (visits.technician_id = (select private.my_technician_id()));
create policy visits_select_office on public.visits for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));

create policy visit_reports_select_technician on public.visit_reports for select to authenticated
  using (exists (select 1 from public.visits v
                 where v.id = visit_reports.visit_id and v.technician_id = (select private.my_technician_id())));
create policy visit_reports_select_office on public.visit_reports for select to authenticated
  using ((select private.has_permission('card'))
         and ((select private.has_permission('cal')) or (select private.has_permission('calls'))));

create policy visit_signatures_select_technician on public.visit_signatures for select to authenticated
  using (exists (select 1 from public.visits v
                 where v.id = visit_signatures.visit_id and v.technician_id = (select private.my_technician_id())));
create policy visit_signatures_select_office on public.visit_signatures for select to authenticated
  using ((select private.has_permission('card'))
         and ((select private.has_permission('cal')) or (select private.has_permission('calls'))));

create policy visit_time_reports_select_office on public.visit_time_reports for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));

create policy visit_events_select_office on public.visit_events for select to authenticated
  using ((select private.has_permission('calls')));

create policy entity_changes_select_office on public.entity_changes for select to authenticated
  using ((select private.has_permission('calls')));

-- ---------------------------------------------------------------------------------------------
-- 11. Grants, per object (never PR 1.3's blanket revokes, which would strip its grants). Tables and
--     the view: SELECT for authenticated, nothing else for anyone. Identity sequences: none.
--     Functions: EXECUTE for authenticated on the three wrappers and the three narrow bodies they
--     call (each body checks its caller); none on can_read_visit, compute_call_status,
--     recalc_call_status, write_entity_change, the trigger functions or the constraint-trigger
--     functions. Nothing for anon, service_role or PUBLIC. test_data_census() keeps its ACL
--     (CREATE OR REPLACE keeps it).
-- ---------------------------------------------------------------------------------------------
revoke all on table public.service_calls from public, anon, authenticated, service_role;
revoke all on table public.visits from public, anon, authenticated, service_role;
revoke all on table public.visit_reports from public, anon, authenticated, service_role;
revoke all on table public.visit_signatures from public, anon, authenticated, service_role;
revoke all on table public.visit_time_reports from public, anon, authenticated, service_role;
revoke all on table public.visit_events from public, anon, authenticated, service_role;
revoke all on table public.entity_changes from public, anon, authenticated, service_role;
revoke all on table public.visit_time_current from public, anon, authenticated, service_role;
revoke all on sequence public.visit_time_reports_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.visit_events_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.entity_changes_id_seq from public, anon, authenticated, service_role;

grant select on public.service_calls, public.visits, public.visit_reports, public.visit_signatures,
  public.visit_time_reports, public.visit_events, public.entity_changes, public.visit_time_current to authenticated;

revoke all on function private.tg_visit_marker() from public, anon, authenticated, service_role;
revoke all on function private.tg_visit_child_marker() from public, anon, authenticated, service_role;
revoke all on function private.tg_history_server_time() from public, anon, authenticated, service_role;
revoke all on function private.tg_entity_change_target() from public, anon, authenticated, service_role;
revoke all on function private.tg_one_way_call_refs() from public, anon, authenticated, service_role;
revoke all on function private.tg_one_way_visit_refs() from public, anon, authenticated, service_role;
revoke all on function private.tg_visit_number_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_service_call_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_visit_state_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_time_report_derive() from public, anon, authenticated, service_role;
revoke all on function private.ct_visit_rules() from public, anon, authenticated, service_role;
revoke all on function private.ct_service_call_rules() from public, anon, authenticated, service_role;
revoke all on function private.ct_signature_rules() from public, anon, authenticated, service_role;
revoke all on function private.ct_report_rules() from public, anon, authenticated, service_role;
revoke all on function private.compute_call_status(uuid) from public, anon, authenticated, service_role;
revoke all on function private.recalc_call_status(uuid) from public, anon, authenticated, service_role;
revoke all on function private.write_entity_change(text, uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function private.can_read_visit(uuid) from public, anon, authenticated, service_role;
revoke all on function private.previous_visits(uuid) from public, anon, authenticated, service_role;
revoke all on function private.visit_rep_contact(uuid) from public, anon, authenticated, service_role;
revoke all on function private.my_visit_details(uuid) from public, anon, authenticated, service_role;
revoke all on function public.previous_visits(uuid) from public, anon, authenticated, service_role;
revoke all on function public.visit_rep_contact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_visit_details(uuid) from public, anon, authenticated, service_role;

grant execute on function
  private.previous_visits(uuid),
  private.visit_rep_contact(uuid),
  private.my_visit_details(uuid),
  public.previous_visits(uuid),
  public.visit_rep_contact(uuid),
  public.my_visit_details(uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 12. Fail closed when the hardening did not take effect (owner, 2026-11-11 and 2026-11-12: as
--     in the PR 1.4 migration, section 11). Read-only; any leftover raises, and the whole
--     migration then rolls back. The PR 1.4 section 11 checks, unchanged, except views: a view
--     without security_invoker (it would read the tables with its owner's rights) and any
--     materialized view are leftovers; an invoker-rights view such as visit_time_current passes.
--     tests/db/210 runs a copy of this block (kept identical by tests/ci/hardening-assertion.test.mjs)
--     against injected leaks.
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
