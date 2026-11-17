-- Step 6 — Migration 6: calendar ingestion and the Outlook invitation simulator.
--
-- Sources: docs/database-schema.md (§1, §2, §5 "external_calendar_events" and
-- "calendar_ingestion_errors", §6, §9, §10), docs/security.md (§5, §7, §9), decisions D08, D17,
-- D19, D23, D24, D38, D39, D41, D42, D44, D47, D60 (3) and (11), docs/demo-deviations.md (IN-01 to
-- IN-06, PR-01 to PR-07, SIM-01 to SIM-19), docs/outlook-template.md, docs/qa-corrections-01-
-- integration.md (X-01, X-03, S-05), the Migration 5 hand-off (section 13: the eligibility rule) and
-- the Step 6 record (docs/review/step6-ingestion/README.md lists the TEMPORARY behaviours).
--
-- Content: three tables (external_calendar_events: the identity of every invitation event;
-- calendar_event_changes: the append-only log of every change received, the idempotency and
-- ordering record; calendar_ingestion_errors: the invitations that were not ingested, which feed
-- "זימונים שלא נקלטו", S-05), three trigger functions, four read helpers, three text-rule helpers
-- and two apply helpers of the writer, the ingestion writer private.ingest_calendar_event
-- (SECURITY DEFINER) with its SECURITY INVOKER wrapper, three SELECT policies, per-object grants,
-- the census extension and the fail-closed hardening check.
--
-- The writer is the database side of the single ingestion service (features/calendar/ingestion):
-- the TypeScript core parses and validates one invitation event and sends one command; this
-- function runs it in one transaction: idempotency (a change key received again changes nothing),
-- ordering (an older change is recorded and never applied), the Settings lookups (technician by
-- Outlook email, call type, pickup place), customers and products built from invitations (D19:
-- normalized unique SKU, an existing name never overwritten), service calls keyed by "מס׳ פנייה"
-- (D60 (3), X-01) with follow-up invitations as the next visit of the same call (X-03, D38: a new
-- visit reopens a resolved call), the D39 rules (field-by-field contact updates, review items for
-- identity changes and for changes of a visit already en route or in progress, a closed visit
-- never changed) and test marking (D47: every row it creates is 'simulator' test data).
--
-- Data: schema only. No reference, test or fictitious rows (D47).
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step6-ingestion section
-- 9; each question is "Step 6 OQ-n"):
--   OQ-1  "זימונים שלא נקלטו" (D60 (4) and (11); Version 1 office scope): calendar_ingestion_errors
--         is readable by every active Creator, Manager and Customer Service user (a fixed
--         capability, private.is_office_user(), until open decision 15 names the matrix key); its
--         rows carry everything the list shows (the sanitized subject, organizer, attendees and
--         times, the request number and customer name read, the problems, the test marker). The
--         event identity and the change log (external_calendar_events, calendar_event_changes:
--         snapshots with customer contact data, OQ-12) stay readable by the Creator only. A
--         Technician, an inactive user, anon and service_role read nothing. A simulator user also
--         sees the outcome of his own change in the function's answer.
--   OQ-2  a deleted invitation (open decision 5, SIM-04) never cancels a visit: an open visit gets
--         a 'cancellation' review item, a closed or cancelled one is not changed (D39), an
--         unparsed invitation's open error is resolved as 'deleted'; later changes of a deleted
--         event have no effect.
--   OQ-3  call type, fault description, warranty and the handling representative follow the
--         latest valid invitation field by field, by change time, as the contact details do
--         (D39); for every optional field an empty value means no change.
--   OQ-4  a different customer number, customer name or SKU on an existing call opens a review
--         item (customer_change, sku_change) and the visit is still created or updated; the
--         incoming customer or product is not created until a review applies it.
--   OQ-5  for a visit en route or in progress, re-assignment and address changes open review
--         items; schedule, arrival notes, technician notes, task number and pickup are applied.
--         The D39 notification waits for the notifications table (Step 3 / Step 7).
--   OQ-6  a new visit or a re-assignment needs an eligible technician (Migration 5 hand-off:
--         accepts_invitations, an active and not deleted Technician profile); an update that keeps
--         the technician does not check it again.
--   OQ-7  a changed request number on an ingested invitation is not ingested (conflict
--         request_number_changed): a visit never moves to another call.
--   OQ-8  at most 30 changes per user per minute (PT429).
--   OQ-9  changes are ordered by the source's change time; a change that is not after the newest
--         one processed is recorded as 'stale'; a change time more than 5 minutes ahead of the
--         server is refused.
--   OQ-10 only the simulator source reaches the writer (the Microsoft Graph source and its
--         session-less writer come with an approved Step 11 migration); received_by is required.
--   OQ-11 the apply_incoming decisions of the invitation review types are not built:
--         resolve_review_item keeps keep_current only for them (PR 1.6 OQ-4).
--   OQ-12 the parsed fields of every processed version are kept (calendar_event_changes.snapshot,
--         customer contact data included) as the base of D39 comparisons; retention follows open
--         decision 12.
--   OQ-13 (open decision 21) the simulator's environment switch (CALENDAR_SIMULATOR, always off when
--         VERCEL_ENV is production) exists only in the server action (lib/actions/calendar-
--         simulator.ts). The database cannot see it, and Preview and Production share this one
--         Supabase project, so public.ingest_calendar_event is callable through the Data API by
--         any active Manager, Creator or Customer Service session whatever the switch says.
--         docs/security.md section 9 ("disabled simulator endpoints return 404", "no public
--         simulator API") and SIM-10 therefore hold at the server action only, not in the database.
--         Accepted only for the testing period: fictional data only (D23, D47), owner-only Preview
--         and Production (D29, D31), every row the writer creates is 'simulator' test data, and the
--         caller check below still applies. Go-live hand-off (before any real use, D23): a reviewed
--         migration revokes EXECUTE on public.ingest_calendar_event(jsonb) and
--         private.ingest_calendar_event(jsonb) from authenticated, or makes the body refuse unless
--         an owner-set database flag allows the simulator; the Microsoft Graph source gets its own
--         session-less entry point (OQ-10, Step 11).
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53). It is
-- prepared and tested locally only. Its writer needs the owner's acceptance in the migration guard
-- (scripts/check-migrations.mjs ALLOWED_WRITERS; protected, D55 (8)): see the Step 6 record.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified. No function builds or runs SQL text.
--
-- Definer-writer invariant (as in Migrations 1 to 5): the only writer of the new tables is the
-- SECURITY DEFINER body private.ingest_calendar_event, owned by postgres, so the SECURITY INVOKER
-- triggers read consistent data; they read each referenced row with SELECT ... INTO and raise
-- 23503 when it is missing (fail closed).
--
-- Error codes:
--   42501 "not authorized" (the caller is not an active Manager, Creator or Customer Service user)
--   22023 "invalid input" (a malformed command, or a value that breaks its column's text rule; no
--         detail)
--   23505 a change key received before with other content
--   PT429 too many changes in a minute (PostgREST answers HTTP 429)
--   55000 wrong state (a call without a free visit number; triggers)
--   23503 a referenced row is missing (triggers)
--   23514 integrity rule (CHECKs, the D47 one-way rule)

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
--    Migration 3 section 1 (TEXT-SAFE, written out in each CHECK). Codes are permanent once rows
--    exist: later migrations may only add codes.
-- ---------------------------------------------------------------------------------------------

-- 1.1 external_calendar_events (root table; D08, D24, D47): one row per invitation event of a
--     calendar source. The identity (source, calendar, event id) is unique: every change of the
--     same invitation finds the same row. It links the one visit the event created (service_call_id
--     and visit_id are set once) and keeps the newest processed change (ordering, OQ-9).
create table public.external_calendar_events (
  id uuid primary key default gen_random_uuid(),
  -- Fails closed: 'microsoft_graph' is added only by an approved Step 11 migration (D23).
  data_source text not null
    constraint external_calendar_events_data_source_check check (data_source in ('simulator', 'automated_test')),
  -- Opaque identifiers of the source (printable ASCII); never shown to users.
  calendar_id text not null
    constraint external_calendar_events_calendar_id_check check (char_length(calendar_id) between 1 and 256 and calendar_id ~ '^[!-~]+$'),
  event_id text not null
    constraint external_calendar_events_event_id_check check (char_length(event_id) between 1 and 512 and event_id ~ '^[!-~]+$'),
  -- 'deleted' once the source deleted the event (never back, t35).
  status text not null default 'active'
    constraint external_calendar_events_status_check check (status in ('active', 'deleted')),
  -- The visit this event created (set once, t35).
  service_call_id uuid,
  visit_id uuid,
  -- The newest change processed (never older, t35).
  last_change_key text
    constraint external_calendar_events_last_change_key_check check (
      char_length(last_change_key) between 1 and 512 and last_change_key ~ '^[!-~]+$'),
  last_changed_at timestamptz
    constraint external_calendar_events_last_changed_at_check check (isfinite(last_changed_at)),
  -- D47: every source except the explicitly real one counts as test.
  is_test boolean generated always as (data_source <> 'microsoft_graph') stored,
  created_at timestamptz not null default now(),
  created_by uuid constraint external_calendar_events_created_by_fkey references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid constraint external_calendar_events_updated_by_fkey references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint external_calendar_events_version_check check (version >= 1),
  constraint external_calendar_events_identity_key unique (data_source, calendar_id, event_id),
  -- Parent of the composite foreign keys of the two child tables.
  constraint external_calendar_events_id_is_test_key unique (id, is_test),
  constraint external_calendar_events_service_call_id_fkey foreign key (service_call_id, is_test)
    references public.service_calls (id, is_test) on delete restrict,
  -- The visit belongs to the linked call (Migration 4's visits (id, service_call_id) key).
  constraint external_calendar_events_visit_id_fkey foreign key (visit_id, service_call_id)
    references public.visits (id, service_call_id) on delete restrict,
  constraint external_calendar_events_link_check check ((visit_id is null) = (service_call_id is null)),
  constraint external_calendar_events_last_change_check check ((last_change_key is null) = (last_changed_at is null)),
  constraint external_calendar_events_simulator_creator_check check (data_source <> 'simulator' or created_by is not null)
);
-- One event per visit.
create unique index external_calendar_events_visit_id_key on public.external_calendar_events (visit_id) where visit_id is not null;
create index external_calendar_events_service_call_id_idx on public.external_calendar_events (service_call_id)
  where service_call_id is not null;
comment on table public.external_calendar_events is
  'Calendar invitation events (D08, D24): one row per (source, calendar, event id). Written only by private.ingest_calendar_event. Never deleted.';
alter table public.external_calendar_events enable row level security;

-- 1.2 calendar_event_changes: every change received, once per (event, change key) (database-schema
--     §10: unique event identifiers make replays idempotent). Append-only. The id is drawn by the
--     writer before it applies the change, so the field history and the review items it writes name
--     it ('cal-change:<id>'); the row itself is written with the final outcome. snapshot keeps the
--     parsed fields of a processed version (the base of the D39 comparisons, OQ-12).
create table public.calendar_event_changes (
  id uuid primary key,
  calendar_event_id uuid not null,
  change_key text not null
    constraint calendar_event_changes_change_key_check check (char_length(change_key) between 1 and 512 and change_key ~ '^[!-~]+$'),
  -- The source's change time (Graph lastModifiedDateTime; the simulator's clock): orders changes.
  changed_at timestamptz not null
    constraint calendar_event_changes_changed_at_check check (isfinite(changed_at)),
  -- Server receipt time (t16).
  recorded_at timestamptz not null default now(),
  -- auth.uid() of the session that delivered it (TEMPORARY, OQ-10: required).
  received_by uuid not null
    constraint calendar_event_changes_received_by_fkey references public.profiles (id) on delete restrict,
  change_type text not null
    constraint calendar_event_changes_change_type_check check (change_type in ('upsert', 'delete')),
  -- sha256 of the command as received (jsonb text): a replay must match it.
  payload_sha256 text not null
    constraint calendar_event_changes_payload_sha256_check check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null
    constraint calendar_event_changes_outcome_check check (outcome in ('applied', 'review', 'unparsed', 'stale', 'no_effect')),
  -- What the change touched: the call and visit of the event, and the call's customer.
  service_call_id uuid,
  visit_id uuid,
  customer_id uuid,
  -- Fields this change applied (the D39 source of each field is the newest change that applied it).
  applied_fields text[] not null default '{}'
    constraint calendar_event_changes_applied_fields_check check (applied_fields <@ array[
      'customers.created', 'customers.phone', 'customers.phone_alt', 'products.created',
      'service_calls.created', 'service_calls.call_type_id', 'service_calls.fault_description',
      'service_calls.warranty', 'service_calls.handling_rep_name',
      'visits.created', 'visits.technician_id', 'visits.scheduled_start', 'visits.scheduled_end', 'visits.task_number',
      'visits.city', 'visits.street', 'visits.building', 'visits.floor', 'visits.apartment', 'visits.arrival_notes',
      'visits.tech_notes', 'visits.pickup_item', 'visits.pickup_location_id']::text[]),
  snapshot jsonb
    constraint calendar_event_changes_snapshot_check check (
      snapshot is null or (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 16384)),
  -- D47: from the event (t15).
  is_test boolean not null,
  constraint calendar_event_changes_change_key_key unique (calendar_event_id, change_key),
  -- Parent of the composite foreign keys of calendar_ingestion_errors.
  constraint calendar_event_changes_id_is_test_key unique (id, is_test),
  constraint calendar_event_changes_calendar_event_id_fkey foreign key (calendar_event_id, is_test)
    references public.external_calendar_events (id, is_test) on delete restrict,
  constraint calendar_event_changes_service_call_id_fkey foreign key (service_call_id, is_test)
    references public.service_calls (id, is_test) on delete restrict,
  constraint calendar_event_changes_visit_id_fkey foreign key (visit_id, service_call_id)
    references public.visits (id, service_call_id) on delete restrict,
  constraint calendar_event_changes_customer_id_fkey foreign key (customer_id, is_test)
    references public.customers (id, is_test) on delete restrict,
  constraint calendar_event_changes_visit_check check (visit_id is null or service_call_id is not null),
  -- A deletion is never applied field by field and never unparsed.
  constraint calendar_event_changes_delete_check check (change_type = 'upsert' or outcome in ('review', 'no_effect', 'stale')),
  -- Only a processed version of an invitation keeps its parsed fields, and an applied one always does.
  constraint calendar_event_changes_snapshot_state_check check (
    snapshot is null or (change_type = 'upsert' and outcome in ('applied', 'review', 'no_effect'))),
  constraint calendar_event_changes_snapshot_kept_check check (
    outcome not in ('applied', 'review') or change_type = 'delete' or snapshot is not null),
  constraint calendar_event_changes_applied_state_check check (cardinality(applied_fields) = 0 or outcome in ('applied', 'review'))
);
create index calendar_event_changes_event_changed_at_idx on public.calendar_event_changes (calendar_event_id, changed_at);
create index calendar_event_changes_received_by_recorded_at_idx on public.calendar_event_changes (received_by, recorded_at);
create index calendar_event_changes_customer_id_idx on public.calendar_event_changes (customer_id) where customer_id is not null;
create index calendar_event_changes_service_call_id_idx on public.calendar_event_changes (service_call_id)
  where service_call_id is not null;
comment on table public.calendar_event_changes is
  'Every change of a calendar invitation received (D08, D24, D39): one row per (event, change key), with its outcome. Append-only. Written only by private.ingest_calendar_event.';
alter table public.calendar_event_changes enable row level security;

-- 1.3 calendar_ingestion_errors: invitations that were not ingested (spec "Invitation intake",
--     IN-03, IN-04, S-05): the reasons (machine-readable problems), the sanitized values that
--     recognise the invitation and nothing else of its body. One open row per event at most: a
--     later change of the same event resolves it ('ingested', 'superseded' or 'deleted'). Only the
--     resolution columns change, once.
create table public.calendar_ingestion_errors (
  id uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null,
  -- The change that was not ingested.
  change_id uuid not null constraint calendar_ingestion_errors_change_id_key unique,
  -- Sanitized by the service (no invisible character, at most 255 characters).
  subject text
    constraint calendar_ingestion_errors_subject_check check (
      subject = btrim(subject) and char_length(subject) between 1 and 255 and subject is nfc normalized
      and subject !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and subject !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- Lower case, trimmed, NFC; no code point TEXT-SAFE refuses and no space variant anywhere (the
  -- writer's private.ingest_email rule; independent review S1).
  organizer_email text
    constraint calendar_ingestion_errors_organizer_email_check check (
      organizer_email = lower(btrim(organizer_email)) and char_length(organizer_email) <= 254
      and organizer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and organizer_email is nfc normalized
      and organizer_email !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and organizer_email !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]'),
  -- A JSON array of at most 20 addresses in the same form (the code points as jsonpath escapes; NFC
  -- is the writer's rule only: jsonpath cannot test it).
  attendee_emails jsonb not null default '[]'::jsonb
    constraint calendar_ingestion_errors_attendee_emails_check check (
      jsonb_typeof(attendee_emails) = 'array' and jsonb_array_length(attendee_emails) <= 20
      and pg_column_size(attendee_emails) <= 8192
      and not jsonb_path_exists(attendee_emails,
        '$[*] ? (@.type() != "string" || !(@ like_regex "^[^@ A-Z]+@[^@ A-Z]+[.][^@ A-Z]+$")
                 || @ like_regex "[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d159}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}\u{f0000}-\u{10ffff}\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]")')),
  -- The invitation's own date and times, when they were readable.
  event_start timestamptz,
  event_end timestamptz,
  -- Values read to recognise the invitation ("מס׳ פנייה", customer name), only when valid.
  request_number text
    constraint calendar_ingestion_errors_request_number_check check (request_number ~ '^[A-Za-z0-9-]{1,32}$'),
  customer_name text
    constraint calendar_ingestion_errors_customer_name_check check (
      customer_name = btrim(customer_name) and char_length(customer_name) between 1 and 120 and customer_name is nfc normalized
      and customer_name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
      and customer_name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- At least one problem: {kind, field[, rule][, value]} (features/calendar/ingestion/types.ts), no
  -- other member; a rule from the closed lists INVALID_RULES and CONFLICT_RULES; a value null or a
  -- string of 1 to 120 characters without a code point TEXT-SAFE refuses and without an edge space
  -- (the writer also checks NFC and which rule belongs to which kind; independent review S1).
  problems jsonb not null
    constraint calendar_ingestion_errors_problems_check check (
      jsonb_typeof(problems) = 'array' and jsonb_array_length(problems) between 1 and 30
      and pg_column_size(problems) <= 16384
      and not jsonb_path_exists(problems,
        '$[*] ? (@.type() != "object" || !exists(@.kind) || !exists(@.field)
                 || @.kind.type() != "string" || @.field.type() != "string"
                 || !(@.kind like_regex "^(missing|invalid|unknown_place|unknown_technician|inactive_technician|ambiguous_technician|conflict)$")
                 || !(@.field like_regex "^(req|task|rep|customerNo|customer|phone|phone2|city|street|building|floor|apt|arrival|type|product|sku|desc|warranty|collect|collectFrom|techNote|subject|attendee|organizer|schedule|body)$"))')
      and not jsonb_path_exists(problems,
        '$[*] ? (@.type() == "object").keyvalue() ? (!(@.key like_regex "^(kind|field|rule|value)$"))')
      and not jsonb_path_exists(problems,
        '$[*] ? ((exists(@.rule)
                  && (@.rule.type() != "string"
                      || !(@.rule like_regex "^(format|length|duplicate_label|warranty_format|unknown_call_type|end_before_start|too_many_attendees|request_number_changed|real_service_call|real_customer|real_product)$")))
                 || (exists(@.value) && @.value.type() != "null"
                     && (@.value.type() != "string" || !(@.value like_regex "^.{1,120}$" flag "s")
                         || @.value like_regex "^[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$"
                         || @.value like_regex "[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d159}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}\u{f0000}-\u{10ffff}]")))')),
  status text not null default 'open'
    constraint calendar_ingestion_errors_status_check check (status in ('open', 'resolved')),
  -- Server receipt time (t12).
  created_at timestamptz not null default now(),
  -- Server time of the resolution (t12).
  resolved_at timestamptz,
  resolution text
    constraint calendar_ingestion_errors_resolution_check check (resolution in ('ingested', 'superseded', 'deleted')),
  -- The later change of the same event that resolved it.
  resolved_by_change_id uuid,
  -- D47: from the event (t15).
  is_test boolean not null,
  updated_at timestamptz not null default now(),
  version integer not null default 1 constraint calendar_ingestion_errors_version_check check (version >= 1),
  constraint calendar_ingestion_errors_calendar_event_id_fkey foreign key (calendar_event_id, is_test)
    references public.external_calendar_events (id, is_test) on delete restrict,
  constraint calendar_ingestion_errors_change_id_fkey foreign key (change_id, is_test)
    references public.calendar_event_changes (id, is_test) on delete restrict,
  constraint calendar_ingestion_errors_resolved_by_change_id_fkey foreign key (resolved_by_change_id, is_test)
    references public.calendar_event_changes (id, is_test) on delete restrict,
  constraint calendar_ingestion_errors_schedule_check check (
    (event_start is null) = (event_end is null)
    and (event_start is null or (isfinite(event_start) and isfinite(event_end) and event_end >= event_start))),
  constraint calendar_ingestion_errors_resolution_state_check check (
    (status = 'open' and resolved_at is null and resolution is null and resolved_by_change_id is null)
    or (status = 'resolved' and resolved_at is not null and resolution is not null and resolved_by_change_id is not null
        and resolved_by_change_id <> change_id))
);
-- One open row per event (the newest problem of the invitation).
create unique index calendar_ingestion_errors_open_key on public.calendar_ingestion_errors (calendar_event_id) where status = 'open';
create index calendar_ingestion_errors_status_created_at_idx on public.calendar_ingestion_errors (status, created_at);
create index calendar_ingestion_errors_resolved_by_change_id_idx on public.calendar_ingestion_errors (resolved_by_change_id)
  where resolved_by_change_id is not null;
comment on table public.calendar_ingestion_errors is
  'Invitations not ingested (S-05; "זימונים שלא נקלטו"): machine-readable problems and sanitized values. Only the resolution changes, once. Written only by private.ingest_calendar_event. Never deleted.';
alter table public.calendar_ingestion_errors enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger functions (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants). None of them writes data: they set or check NEW only. Messages are generic.
-- ---------------------------------------------------------------------------------------------

-- t15 on calendar_event_changes and calendar_ingestion_errors (BEFORE INSERT): is_test from the
-- event (D47); the client value is ignored.
create function private.tg_calendar_child_marker()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_is_test boolean;
begin
  select e.is_test into v_is_test from public.external_calendar_events e where e.id = new.calendar_event_id;
  if not found then
    raise exception using errcode = '23503', message = tg_table_name || ': unknown calendar event';
  end if;
  new.is_test := v_is_test;
  return new;
end
$$;

-- t35 on external_calendar_events (BEFORE INSERT OR UPDATE): an event is created active, unlinked
-- and without a change; the visit link is set once and never changes; a deleted event stays
-- deleted; the newest change time never goes back (OQ-9).
create function private.tg_calendar_event_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.service_call_id is not null or new.visit_id is not null
       or new.last_change_key is not null or new.last_changed_at is not null then
      raise exception using errcode = '55000', message = 'external_calendar_events: an event is created active, unlinked and without a change';
    end if;
    return new;
  end if;
  if old.visit_id is not null and (new.visit_id, new.service_call_id) is distinct from (old.visit_id, old.service_call_id) then
    raise exception using errcode = '55000', message = 'external_calendar_events: the visit link is set once';
  end if;
  if old.status = 'deleted' and new.status <> 'deleted' then
    raise exception using errcode = '55000', message = 'external_calendar_events: a deleted event stays deleted';
  end if;
  if old.last_changed_at is not null and (new.last_changed_at is null or new.last_changed_at < old.last_changed_at) then
    raise exception using errcode = '55000', message = 'external_calendar_events: the newest change time never goes back';
  end if;
  return new;
end
$$;

-- t12 on calendar_ingestion_errors (BEFORE INSERT OR UPDATE): a row is created open with the
-- server's receipt time; it is resolved once (open -> resolved, resolved_at = now()); a resolved
-- row never changes again. Every other column is frozen by t10.
create function private.tg_ingestion_error_state()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'open' then
      raise exception using errcode = '55000', message = 'calendar_ingestion_errors: a row is created open';
    end if;
    new.created_at := now();
    return new;
  end if;
  if old.status = 'resolved' then
    raise exception using errcode = '55000', message = 'calendar_ingestion_errors: a resolved row never changes';
  end if;
  if new.status = 'resolved' then
    new.resolved_at := now();
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Attach the triggers (name prefixes fix the firing order, as in Migrations 2 to 5). On
--    external_calendar_events is_test is a stored generated column: its one-way check runs AFTER
--    the row is formed (a30) and its markers are frozen by t10 (data_source) and generation.
-- ---------------------------------------------------------------------------------------------
create trigger t10_immutable before update on public.external_calendar_events
  for each row execute function private.tg_immutable_except(
    'status', 'service_call_id', 'visit_id', 'last_change_key', 'last_changed_at', 'version', 'updated_at', 'updated_by',
    'is_test');
create trigger t35_event_guard before insert or update on public.external_calendar_events
  for each row execute function private.tg_calendar_event_guard();
create trigger t90_bump_version before update on public.external_calendar_events
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.external_calendar_events
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.external_calendar_events
  for each statement execute function private.tg_reject_truncate();
create trigger a30_one_way after insert or update on public.external_calendar_events
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');

-- calendar_event_changes: append-only.
create trigger t10_reject_update_delete before update or delete on public.calendar_event_changes
  for each row execute function private.tg_reject_update_delete();
create trigger t15_marker_from_event before insert on public.calendar_event_changes
  for each row execute function private.tg_calendar_child_marker();
create trigger t16_change_time before insert on public.calendar_event_changes
  for each row execute function private.tg_history_server_time();
create trigger t30_one_way before insert on public.calendar_event_changes
  for each row execute function private.tg_one_way_people('received_by');
create trigger t99_reject_truncate before truncate on public.calendar_event_changes
  for each statement execute function private.tg_reject_truncate();

-- calendar_ingestion_errors: only the resolution changes, once.
create trigger t10_immutable before update on public.calendar_ingestion_errors
  for each row execute function private.tg_immutable_except(
    'status', 'resolved_at', 'resolution', 'resolved_by_change_id', 'version', 'updated_at');
create trigger t12_error_state before insert or update on public.calendar_ingestion_errors
  for each row execute function private.tg_ingestion_error_state();
create trigger t15_marker_from_event before insert on public.calendar_ingestion_errors
  for each row execute function private.tg_calendar_child_marker();
create trigger t20_immutable_markers before update on public.calendar_ingestion_errors
  for each row execute function private.tg_immutable_markers();
create trigger t90_bump_version before update on public.calendar_ingestion_errors
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.calendar_ingestion_errors
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.calendar_ingestion_errors
  for each statement execute function private.tg_reject_truncate();

-- ---------------------------------------------------------------------------------------------
-- 4. Read helpers of the writer (SECURITY INVOKER: their only caller is the postgres-owned
--    SECURITY DEFINER body; no grants, no public wrapper). None of them writes data.
-- ---------------------------------------------------------------------------------------------

-- A text member of a JSON object: NULL when absent or JSON null; any other type: 22023.
create function private.ingest_text(p_object jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_object is null or jsonb_typeof(p_object) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if not (p_object ? p_key) or jsonb_typeof(p_object -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_object -> p_key) <> 'string' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  return p_object ->> p_key;
end
$$;

-- A timestamp member written as ISO 8601 with seconds and an explicit offset; NULL when absent;
-- anything else (also an impossible date): 22023.
create function private.ingest_timestamp(p_object jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_text text := private.ingest_text(p_object, p_key);
  v_value timestamptz;
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  begin
    v_value := v_text::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid input';
  end;
  if not isfinite(v_value) or v_value < timestamptz '2000-01-01 00:00:00+00' or v_value > timestamptz '2101-01-01 00:00:00+00' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  return v_value;
end
$$;

-- The text rules of the columns the writer fills (independent review S1), as predicates: false for
-- NULL. Migrations 2 and 3 write each rule out in the CHECKs; these are the same expressions, so
-- the writer can apply them to every value it stores where no CHECK reads it (a review item, a
-- snapshot, a problem). features/calendar/ingestion/text.ts states the same rules in TypeScript.
-- TEXT-SAFE (p_multiline false) or TEXT-SAFE-ML (true; U+000A inside the text, never first or
-- last), 1 to p_max characters (Migration 2 section 1, Migration 3 section 1).
create function private.ingest_safe_text(p_value text, p_max integer, p_multiline boolean)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    p_value = btrim(p_value) and char_length(p_value) between 1 and p_max and p_value is nfc normalized
    and case when p_multiline then
          p_value !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
          and p_value !~ '^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
        else
          p_value !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
          and p_value !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
        end,
    false)
$$;

-- ASCII-ID (task number, customer number, SKU): printable ASCII with single internal spaces, 1 to
-- p_max characters (Migration 2 section 1).
create function private.ingest_ascii_id(p_value text, p_max integer)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(char_length(p_value) between 1 and p_max and p_value ~ '^[!-~]+( [!-~]+)*$', false)
$$;

-- An e-mail address as the writer stores it (attendees, organizer; technicians.outlook_email's
-- form, Migration 1): lower case, trimmed, NFC, at most 254 characters, one "@" and a dot after it,
-- no code point TEXT-SAFE refuses and no space variant anywhere.
create function private.ingest_email(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    p_value = lower(btrim(p_value)) and char_length(p_value) <= 254 and p_value is nfc normalized
    and p_value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and p_value !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]'
    and p_value !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]',
    false)
$$;

-- The D39 source time of a field: the change time of the newest change that applied it to this
-- customer or call (NULL when none did).
create function private.ingest_field_source_at(p_customer_id uuid, p_service_call_id uuid, p_field text)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select max(c.changed_at)
  from public.calendar_event_changes c
  where p_field = any (c.applied_fields)
    and ((p_customer_id is not null and c.customer_id = p_customer_id)
         or (p_service_call_id is not null and c.service_call_id = p_service_call_id))
$$;

-- The writer's answer for one stored change (also for a replay): the outcome, the call and visit,
-- the review items it opened and the problems of an unparsed change. No customer data beyond the
-- request number the caller sent.
create function private.ingest_answer(p_change_id uuid, p_replay boolean)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'outcome', c.outcome,
    'replay', p_replay,
    'change_id', c.id,
    -- An unparsed change answers with the request number it carried (null when unreadable).
    'request_number', coalesce((select x.request_number from public.calendar_ingestion_errors x where x.change_id = c.id),
                               s.request_number),
    'visit_number', v.visit_number,
    'service_call_id', c.service_call_id,
    'visit_id', c.visit_id,
    -- The items this change opened on its own call (independent review N3: the reference and the
    -- call both match).
    'review_items', (select count(*) from public.review_items r
                     where r.source_ref = 'cal-change:' || c.id::text and r.service_call_id = c.service_call_id),
    'applied_fields', to_jsonb(c.applied_fields),
    'problems', coalesce((select x.problems from public.calendar_ingestion_errors x where x.change_id = c.id), '[]'::jsonb))
  from public.calendar_event_changes c
  left join public.service_calls s on s.id = c.service_call_id
  left join public.visits v on v.id = c.visit_id
  where c.id = p_change_id
$$;

-- ---------------------------------------------------------------------------------------------
-- 4b. Apply helpers of the writer (SECURITY INVOKER, called only by the postgres-owned SECURITY
--     DEFINER body after it locked the call, the visit and the customer; no grants, no public
--     wrapper). They UPDATE rows and call the reviewed helpers write_entity_change (source
--     'invitation') and create_review_item (source 'invitation'); they insert nothing themselves.
--     The actor is auth.uid() of the session, as in every writer.
-- ---------------------------------------------------------------------------------------------

-- An open visit takes the new version of its own invitation (D39, OQ-5): for a scheduled visit
-- every change applies; for a visit en route or in progress a re-assignment and an address change
-- open review items ('reassignment', 'address_change') and the rest applies. For every optional
-- field an empty value means no change (OQ-3). Each applied field gets its history row.
-- p_base is the event's previous processed version (calendar_event_changes.snapshot, as for
-- ingest_apply_call; NULL when there is none). D39 routes a change "made in that invitation": for a
-- visit en route or in progress a re-assignment or an address change opens its review item only
-- when this version's technician or address differs from the base, so a later version that keeps
-- them (notes, time) does not open the same item again, also after a keep_current decision
-- (independent review M1). With a NULL base every difference from the visit counts.
create function private.ingest_apply_visit(
  p_visit public.visits, p_base jsonb, p_technician_id uuid, p_task text, p_start timestamptz, p_end timestamptz,
  p_city text, p_street text, p_building text, p_floor text, p_apartment text, p_arrival text, p_tech_notes text,
  p_pickup_item text, p_location_id uuid, p_ref text, inout p_applied text[], inout p_reviews integer)
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_started boolean := p_visit.status in ('en_route', 'in_progress');
  v_new public.visits := p_visit;
  v_old_address jsonb := jsonb_build_object('city', p_visit.city, 'street', p_visit.street, 'building', p_visit.building,
                                            'floor', p_visit.floor, 'apartment', p_visit.apartment);
  v_new_address jsonb := jsonb_build_object('city', p_city, 'street', p_street,
                                            'building', coalesce(p_building, p_visit.building),
                                            'floor', coalesce(p_floor, p_visit.floor),
                                            'apartment', coalesce(p_apartment, p_visit.apartment));
  v_base_fields jsonb := p_base -> 'fields';
  -- Changed in this invitation (D39): the technician, and the address (an empty optional part is
  -- no change, OQ-3).
  v_technician_changed boolean := p_base is null or (p_base ->> 'technician_id') is distinct from p_technician_id::text;
  v_address_changed boolean := p_base is null
    or (v_base_fields ->> 'city') is distinct from p_city or (v_base_fields ->> 'street') is distinct from p_street
    or (p_building is not null and (v_base_fields ->> 'building') is distinct from p_building)
    or (p_floor is not null and (v_base_fields ->> 'floor') is distinct from p_floor)
    or (p_apartment is not null and (v_base_fields ->> 'apartment') is distinct from p_apartment);
begin
  if p_visit.status not in ('scheduled', 'en_route', 'in_progress') then
    raise exception using errcode = '55000', message = 'visits: a closed or cancelled visit is never changed by an invitation';
  end if;
  v_new.task_number := p_task;
  v_new.scheduled_start := p_start;
  v_new.scheduled_end := p_end;
  v_new.arrival_notes := coalesce(p_arrival, p_visit.arrival_notes);
  v_new.tech_notes := coalesce(p_tech_notes, p_visit.tech_notes);
  v_new.pickup_item := coalesce(p_pickup_item, p_visit.pickup_item);
  v_new.pickup_location_id := coalesce(p_location_id, p_visit.pickup_location_id);
  if p_technician_id is distinct from p_visit.technician_id then
    if v_started then
      if v_technician_changed then
        perform private.create_review_item('reassignment', p_ref || ':reassignment', p_visit.service_call_id, p_visit.id,
          'invitation', p_ref, null, jsonb_build_object('technician_id', p_technician_id),
          jsonb_build_object('technician_id', p_visit.technician_id, 'status', p_visit.status), null);
        p_reviews := p_reviews + 1;
      end if;
    else
      v_new.technician_id := p_technician_id;
    end if;
  end if;
  if v_new_address is distinct from v_old_address then
    if v_started then
      if v_address_changed then
        perform private.create_review_item('address_change', p_ref || ':address_change', p_visit.service_call_id, p_visit.id,
          'invitation', p_ref, null, jsonb_strip_nulls(v_new_address), jsonb_strip_nulls(v_old_address), null);
        p_reviews := p_reviews + 1;
      end if;
    else
      v_new.city := p_city;
      v_new.street := p_street;
      v_new.building := v_new_address ->> 'building';
      v_new.floor := v_new_address ->> 'floor';
      v_new.apartment := v_new_address ->> 'apartment';
    end if;
  end if;

  if v_new.technician_id is distinct from p_visit.technician_id then
    perform private.write_entity_change('visits', p_visit.id, 'technician_id', to_jsonb(p_visit.technician_id),
      to_jsonb(v_new.technician_id), 'invitation', p_ref);
    p_applied := p_applied || 'visits.technician_id'::text;
  end if;
  if v_new.task_number is distinct from p_visit.task_number then
    perform private.write_entity_change('visits', p_visit.id, 'task_number', to_jsonb(p_visit.task_number),
      to_jsonb(v_new.task_number), 'invitation', p_ref);
    p_applied := p_applied || 'visits.task_number'::text;
  end if;
  if v_new.scheduled_start is distinct from p_visit.scheduled_start then
    perform private.write_entity_change('visits', p_visit.id, 'scheduled_start', to_jsonb(p_visit.scheduled_start),
      to_jsonb(v_new.scheduled_start), 'invitation', p_ref);
    p_applied := p_applied || 'visits.scheduled_start'::text;
  end if;
  if v_new.scheduled_end is distinct from p_visit.scheduled_end then
    perform private.write_entity_change('visits', p_visit.id, 'scheduled_end', to_jsonb(p_visit.scheduled_end),
      to_jsonb(v_new.scheduled_end), 'invitation', p_ref);
    p_applied := p_applied || 'visits.scheduled_end'::text;
  end if;
  if v_new.city is distinct from p_visit.city then
    perform private.write_entity_change('visits', p_visit.id, 'city', to_jsonb(p_visit.city), to_jsonb(v_new.city), 'invitation', p_ref);
    p_applied := p_applied || 'visits.city'::text;
  end if;
  if v_new.street is distinct from p_visit.street then
    perform private.write_entity_change('visits', p_visit.id, 'street', to_jsonb(p_visit.street), to_jsonb(v_new.street),
      'invitation', p_ref);
    p_applied := p_applied || 'visits.street'::text;
  end if;
  if v_new.building is distinct from p_visit.building then
    perform private.write_entity_change('visits', p_visit.id, 'building', to_jsonb(p_visit.building), to_jsonb(v_new.building),
      'invitation', p_ref);
    p_applied := p_applied || 'visits.building'::text;
  end if;
  if v_new.floor is distinct from p_visit.floor then
    perform private.write_entity_change('visits', p_visit.id, 'floor', to_jsonb(p_visit.floor), to_jsonb(v_new.floor), 'invitation', p_ref);
    p_applied := p_applied || 'visits.floor'::text;
  end if;
  if v_new.apartment is distinct from p_visit.apartment then
    perform private.write_entity_change('visits', p_visit.id, 'apartment', to_jsonb(p_visit.apartment),
      to_jsonb(v_new.apartment), 'invitation', p_ref);
    p_applied := p_applied || 'visits.apartment'::text;
  end if;
  if v_new.arrival_notes is distinct from p_visit.arrival_notes then
    perform private.write_entity_change('visits', p_visit.id, 'arrival_notes', to_jsonb(p_visit.arrival_notes),
      to_jsonb(v_new.arrival_notes), 'invitation', p_ref);
    p_applied := p_applied || 'visits.arrival_notes'::text;
  end if;
  if v_new.tech_notes is distinct from p_visit.tech_notes then
    perform private.write_entity_change('visits', p_visit.id, 'tech_notes', to_jsonb(p_visit.tech_notes),
      to_jsonb(v_new.tech_notes), 'invitation', p_ref);
    p_applied := p_applied || 'visits.tech_notes'::text;
  end if;
  if v_new.pickup_item is distinct from p_visit.pickup_item then
    perform private.write_entity_change('visits', p_visit.id, 'pickup_item', to_jsonb(p_visit.pickup_item),
      to_jsonb(v_new.pickup_item), 'invitation', p_ref);
    p_applied := p_applied || 'visits.pickup_item'::text;
  end if;
  if v_new.pickup_location_id is distinct from p_visit.pickup_location_id then
    perform private.write_entity_change('visits', p_visit.id, 'pickup_location_id', to_jsonb(p_visit.pickup_location_id),
      to_jsonb(v_new.pickup_location_id), 'invitation', p_ref);
    p_applied := p_applied || 'visits.pickup_location_id'::text;
  end if;

  if (v_new.technician_id, v_new.task_number, v_new.scheduled_start, v_new.scheduled_end, v_new.city, v_new.street,
      v_new.building, v_new.floor, v_new.apartment, v_new.arrival_notes, v_new.tech_notes, v_new.pickup_item,
      v_new.pickup_location_id)
     is distinct from
     (p_visit.technician_id, p_visit.task_number, p_visit.scheduled_start, p_visit.scheduled_end, p_visit.city, p_visit.street,
      p_visit.building, p_visit.floor, p_visit.apartment, p_visit.arrival_notes, p_visit.tech_notes, p_visit.pickup_item,
      p_visit.pickup_location_id) then
    update public.visits v
    set technician_id = v_new.technician_id, task_number = v_new.task_number, scheduled_start = v_new.scheduled_start,
        scheduled_end = v_new.scheduled_end, city = v_new.city, street = v_new.street, building = v_new.building,
        floor = v_new.floor, apartment = v_new.apartment, arrival_notes = v_new.arrival_notes, tech_notes = v_new.tech_notes,
        pickup_item = v_new.pickup_item, pickup_location_id = v_new.pickup_location_id, updated_by = auth.uid()
    where v.id = p_visit.id;
  end if;
end
$$;

-- The call level of an invitation for an open visit of an existing call or customer (D39; OQ-3,
-- OQ-4): a different customer number, customer name or SKU opens a review item ('customer_change',
-- 'sku_change'; nothing of it is applied) when it changed in this invitation (or the invitation is
-- new: p_base NULL); the contact details (phone, phone_alt) and, for an existing call
-- (p_call_fields), the call type, fault description, warranty and handling representative take the
-- invitation's value when it is not empty, differs, changed in this invitation and the
-- invitation's change time is after the field's source (private.ingest_field_source_at). Each
-- applied field gets its history row.
create function private.ingest_apply_call(
  p_call public.service_calls, p_customer public.customers, p_product public.products, p_call_fields boolean,
  p_base jsonb, p_fields jsonb, p_changed_at timestamptz, p_call_type_id uuid, p_rep_profile_id uuid, p_ref text,
  inout p_applied text[], inout p_reviews integer)
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_base jsonb := p_base -> 'fields';
  v_phone text := p_fields ->> 'phone';
  v_phone_alt text := p_fields ->> 'phone_alt';
  v_new_phone text := p_customer.phone;
  v_new_phone_alt text := p_customer.phone_alt;
  v_call public.service_calls := p_call;
  v_source_at timestamptz;
begin
  -- Identity (D39): never applied silently.
  if p_customer.customer_number is distinct from (p_fields ->> 'customer_number') then
    if v_base is null or (v_base ->> 'customer_number') is distinct from (p_fields ->> 'customer_number') then
      perform private.create_review_item('customer_change', p_ref || ':customer_change', p_call.id, null, 'invitation', p_ref,
        null, jsonb_build_object('customer_number', p_fields ->> 'customer_number', 'customer_name', p_fields ->> 'customer_name'),
        jsonb_build_object('customer_number', p_customer.customer_number, 'customer_name', p_customer.name), null);
      p_reviews := p_reviews + 1;
    end if;
  else
    if p_customer.name is distinct from (p_fields ->> 'customer_name')
       and (v_base is null or (v_base ->> 'customer_name') is distinct from (p_fields ->> 'customer_name')) then
      perform private.create_review_item('customer_change', p_ref || ':customer_change', p_call.id, null, 'invitation', p_ref,
        null, jsonb_build_object('customer_number', p_customer.customer_number, 'customer_name', p_fields ->> 'customer_name'),
        jsonb_build_object('customer_number', p_customer.customer_number, 'customer_name', p_customer.name), null);
      p_reviews := p_reviews + 1;
    end if;
    -- Contact details, field by field (D39).
    v_source_at := private.ingest_field_source_at(p_customer.id, null, 'customers.phone');
    if v_phone is not null and v_phone is distinct from p_customer.phone
       and (v_base is null or (v_base ->> 'phone') is distinct from v_phone)
       and (v_source_at is null or p_changed_at > v_source_at) then
      v_new_phone := v_phone;
      perform private.write_entity_change('customers', p_customer.id, 'phone', to_jsonb(p_customer.phone), to_jsonb(v_phone),
        'invitation', p_ref);
      p_applied := p_applied || 'customers.phone'::text;
    end if;
    v_source_at := private.ingest_field_source_at(p_customer.id, null, 'customers.phone_alt');
    if v_phone_alt is not null and v_phone_alt is distinct from p_customer.phone_alt
       and (v_base is null or (v_base ->> 'phone_alt') is distinct from v_phone_alt)
       and (v_source_at is null or p_changed_at > v_source_at) then
      v_new_phone_alt := v_phone_alt;
      perform private.write_entity_change('customers', p_customer.id, 'phone_alt', to_jsonb(p_customer.phone_alt),
        to_jsonb(v_phone_alt), 'invitation', p_ref);
      p_applied := p_applied || 'customers.phone_alt'::text;
    end if;
    if (v_new_phone, v_new_phone_alt) is distinct from (p_customer.phone, p_customer.phone_alt) then
      update public.customers x set phone = v_new_phone, phone_alt = v_new_phone_alt, updated_by = auth.uid()
      where x.id = p_customer.id;
    end if;
  end if;

  if not p_call_fields then
    return;
  end if;

  if p_product.sku_normalized is distinct from upper((p_fields ->> 'sku') collate "C")
     and (v_base is null or (v_base ->> 'sku') is distinct from (p_fields ->> 'sku')) then
    perform private.create_review_item('sku_change', p_ref || ':sku_change', p_call.id, null, 'invitation', p_ref, null,
      jsonb_build_object('sku', p_fields ->> 'sku', 'product_name', p_fields ->> 'product_name'),
      jsonb_build_object('sku', p_product.sku_display, 'product_name', p_product.name), null);
    p_reviews := p_reviews + 1;
  end if;

  -- Call fields (OQ-3).
  v_source_at := private.ingest_field_source_at(null, p_call.id, 'service_calls.call_type_id');
  if p_call_type_id is distinct from p_call.call_type_id
     and (v_base is null or (v_base ->> 'call_type') is distinct from (p_fields ->> 'call_type'))
     and (v_source_at is null or p_changed_at > v_source_at) then
    v_call.call_type_id := p_call_type_id;
    perform private.write_entity_change('service_calls', p_call.id, 'call_type_id', to_jsonb(p_call.call_type_id),
      to_jsonb(p_call_type_id), 'invitation', p_ref);
    p_applied := p_applied || 'service_calls.call_type_id'::text;
  end if;
  v_source_at := private.ingest_field_source_at(null, p_call.id, 'service_calls.fault_description');
  if (p_fields ->> 'fault_description') is distinct from p_call.fault_description
     and (v_base is null or (v_base ->> 'fault_description') is distinct from (p_fields ->> 'fault_description'))
     and (v_source_at is null or p_changed_at > v_source_at) then
    v_call.fault_description := p_fields ->> 'fault_description';
    perform private.write_entity_change('service_calls', p_call.id, 'fault_description', to_jsonb(p_call.fault_description),
      to_jsonb(v_call.fault_description), 'invitation', p_ref);
    p_applied := p_applied || 'service_calls.fault_description'::text;
  end if;
  v_source_at := private.ingest_field_source_at(null, p_call.id, 'service_calls.warranty');
  if (p_fields ->> 'warranty_raw') is not null
     and ((p_fields ->> 'warranty_status'), (p_fields ->> 'warranty_until')::date, (p_fields ->> 'warranty_raw'))
         is distinct from (p_call.warranty_status, p_call.warranty_until, p_call.warranty_raw)
     and (v_base is null or (v_base ->> 'warranty_raw') is distinct from (p_fields ->> 'warranty_raw'))
     and (v_source_at is null or p_changed_at > v_source_at) then
    v_call.warranty_status := p_fields ->> 'warranty_status';
    v_call.warranty_until := (p_fields ->> 'warranty_until')::date;
    v_call.warranty_raw := p_fields ->> 'warranty_raw';
    if v_call.warranty_status is distinct from p_call.warranty_status then
      perform private.write_entity_change('service_calls', p_call.id, 'warranty_status', to_jsonb(p_call.warranty_status),
        to_jsonb(v_call.warranty_status), 'invitation', p_ref);
    end if;
    if v_call.warranty_until is distinct from p_call.warranty_until then
      perform private.write_entity_change('service_calls', p_call.id, 'warranty_until', to_jsonb(p_call.warranty_until),
        to_jsonb(v_call.warranty_until), 'invitation', p_ref);
    end if;
    if v_call.warranty_raw is distinct from p_call.warranty_raw then
      perform private.write_entity_change('service_calls', p_call.id, 'warranty_raw', to_jsonb(p_call.warranty_raw),
        to_jsonb(v_call.warranty_raw), 'invitation', p_ref);
    end if;
    p_applied := p_applied || 'service_calls.warranty'::text;
  end if;
  v_source_at := private.ingest_field_source_at(null, p_call.id, 'service_calls.handling_rep_name');
  if (p_fields ->> 'handling_rep_name') is distinct from p_call.handling_rep_name
     and (v_base is null or (v_base ->> 'handling_rep_name') is distinct from (p_fields ->> 'handling_rep_name'))
     and (v_source_at is null or p_changed_at > v_source_at) then
    v_call.handling_rep_name := p_fields ->> 'handling_rep_name';
    v_call.handling_rep_profile_id := p_rep_profile_id;
    perform private.write_entity_change('service_calls', p_call.id, 'handling_rep_name', to_jsonb(p_call.handling_rep_name),
      to_jsonb(v_call.handling_rep_name), 'invitation', p_ref);
    if v_call.handling_rep_profile_id is distinct from p_call.handling_rep_profile_id then
      perform private.write_entity_change('service_calls', p_call.id, 'handling_rep_profile_id',
        to_jsonb(p_call.handling_rep_profile_id), to_jsonb(v_call.handling_rep_profile_id), 'invitation', p_ref);
    end if;
    p_applied := p_applied || 'service_calls.handling_rep_name'::text;
  end if;
  if (v_call.call_type_id, v_call.fault_description, v_call.warranty_status, v_call.warranty_until, v_call.warranty_raw,
      v_call.handling_rep_name, v_call.handling_rep_profile_id)
     is distinct from
     (p_call.call_type_id, p_call.fault_description, p_call.warranty_status, p_call.warranty_until, p_call.warranty_raw,
      p_call.handling_rep_name, p_call.handling_rep_profile_id) then
    update public.service_calls c
    set call_type_id = v_call.call_type_id, fault_description = v_call.fault_description,
        warranty_status = v_call.warranty_status, warranty_until = v_call.warranty_until, warranty_raw = v_call.warranty_raw,
        handling_rep_name = v_call.handling_rep_name, handling_rep_profile_id = v_call.handling_rep_profile_id,
        updated_by = auth.uid()
    where c.id = p_call.id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. The ingestion writer (D08, D17, D19, D24, D38, D39, D44, D47; X-01, X-03, S-05). SECURITY
--    DEFINER plpgsql in private, every reference schema-qualified, no dynamic SQL. Order: the
--    caller (an active Manager, Creator or Customer Service user, profile locked FOR SHARE; D24,
--    SIM-10, a fixed capability), the command's shape and every value's rule (22023), the rate
--    limit (OQ-8), the event identity (serialized per event), replay or conflict, stale or after
--    deletion, then deletion, unparsed or upsert. Every row it creates carries data_source
--    'simulator' (D47, OQ-10). The database does not see the simulator's environment switch
--    (CALENDAR_SIMULATOR is checked by the server action only; TEMPORARY OQ-13: until the go-live
--    hand-off any active Manager, Creator or Customer Service session can call this through the
--    Data API on Preview and Production alike). It never sends anything: simulated visits never
--    send email (D24, SIM-09). Returns private.ingest_answer of the stored change.
-- ---------------------------------------------------------------------------------------------
create function private.ingest_calendar_event(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- The only source a person's session can deliver (OQ-10).
  v_source constant text := 'simulator';
  v_caller public.profiles;
  v_kind text;
  v_calendar_id text;
  v_event_key text;
  v_change_key text;
  v_changed_at timestamptz;
  v_sha text;
  v_event public.external_calendar_events;
  v_prior public.calendar_event_changes;
  v_change_id uuid := gen_random_uuid();
  v_ref text;
  v_event_ref text;
  v_ev jsonb;
  v_f jsonb;
  v_subject text;
  v_organizer text;
  v_attendees text[];
  v_attendee_list text;
  v_start timestamptz;
  v_end timestamptz;
  v_problems jsonb := '[]'::jsonb;
  v_recognised jsonb;
  v_item jsonb;
  v_item_kind text;
  v_item_field text;
  v_item_rule text;
  v_item_value text;
  v_req text;
  v_task text;
  v_rep text;
  v_customer_number text;
  v_customer_name text;
  v_phone text;
  v_phone_alt text;
  v_city text;
  v_street text;
  v_building text;
  v_floor text;
  v_apartment text;
  v_arrival text;
  v_call_type text;
  v_product_name text;
  v_sku text;
  v_fault text;
  v_w_status text;
  v_w_until date;
  v_w_raw text;
  v_pickup_item text;
  v_pickup_location text;
  v_tech_notes text;
  v_tech_ids uuid[];
  v_technician_id uuid;
  v_call_type_id uuid;
  v_location_id uuid;
  v_rep_profile_id uuid;
  v_call public.service_calls;
  v_visit public.visits;
  v_customer public.customers;
  v_product public.products;
  v_base jsonb;
  v_snapshot jsonb;
  v_applied text[] := '{}';
  v_reviews integer := 0;
  v_outcome text;
  v_visit_number integer;
  v_new_call boolean := false;
  v_new_customer boolean := false;
  v_open boolean;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);

  -- 1. The command's shape (features/calendar/ingestion/plan.ts toDatabaseCommand).
  if p_command is null or jsonb_typeof(p_command) <> 'object' or pg_column_size(p_command) > 65536
     or exists (select 1 from jsonb_object_keys(p_command) k
                where k not in ('source', 'calendar_id', 'event_id', 'change_key', 'changed_at', 'kind', 'event', 'fields',
                                'problems', 'recognised')) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  v_kind := private.ingest_text(p_command, 'kind');
  v_calendar_id := private.ingest_text(p_command, 'calendar_id');
  v_event_key := private.ingest_text(p_command, 'event_id');
  v_change_key := private.ingest_text(p_command, 'change_key');
  v_changed_at := private.ingest_timestamp(p_command, 'changed_at');
  if private.ingest_text(p_command, 'source') is distinct from v_source
     or v_kind is null or v_kind not in ('upsert', 'unparsed', 'delete')
     or v_calendar_id is null or char_length(v_calendar_id) > 256 or v_calendar_id !~ '^[!-~]+$'
     or v_event_key is null or char_length(v_event_key) > 512 or v_event_key !~ '^[!-~]+$'
     or v_change_key is null or char_length(v_change_key) > 512 or v_change_key !~ '^[!-~]+$'
     or v_changed_at is null or v_changed_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;

  -- 2. The content of the command, by kind, before anything is read or written (independent
  --    review S1, N1): the members a kind does not use are JSON null, and every text value meets
  --    its column's rule (private.ingest_safe_text, ingest_ascii_id, ingest_email, the request-
  --    number and phone formats), also where no CHECK reads it (a review item, a snapshot, a
  --    problem), and also when the change turns out to be a replay, stale or after a deletion.
  if v_kind = 'delete' then
    if p_command -> 'event' is distinct from 'null'::jsonb or p_command -> 'fields' is distinct from 'null'::jsonb
       or p_command -> 'problems' is distinct from 'null'::jsonb or p_command -> 'recognised' is distinct from 'null'::jsonb then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
  else
    -- 2a. The event part of an upsert or an unparsed change.
    v_ev := p_command -> 'event';
    if v_ev is null or jsonb_typeof(v_ev) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_ev) k where k not in ('subject', 'organizer_email', 'attendee_emails', 'start', 'end'))
       or jsonb_typeof(v_ev -> 'attendee_emails') is distinct from 'array'
       or jsonb_array_length(v_ev -> 'attendee_emails') > 20
       or exists (select 1 from jsonb_array_elements(v_ev -> 'attendee_emails') a where jsonb_typeof(a) <> 'string') then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
    v_subject := private.ingest_text(v_ev, 'subject');
    v_organizer := private.ingest_text(v_ev, 'organizer_email');
    v_attendees := array(select jsonb_array_elements_text(v_ev -> 'attendee_emails'));
    v_start := private.ingest_timestamp(v_ev, 'start');
    v_end := private.ingest_timestamp(v_ev, 'end');
    if (v_subject is not null and not private.ingest_safe_text(v_subject, 255, false))
       or (v_organizer is not null and not private.ingest_email(v_organizer))
       or exists (select 1 from unnest(v_attendees) a where not private.ingest_email(a)) then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;

    if v_kind = 'unparsed' then
      -- 2b. An unparsed change: its problems (S-05; features/calendar/ingestion/types.ts) and the
      --     values that recognise it.
      v_problems := p_command -> 'problems';
      v_recognised := p_command -> 'recognised';
      if jsonb_typeof(v_problems) is distinct from 'array' or jsonb_array_length(v_problems) not between 1 and 30
         or p_command -> 'fields' is distinct from 'null'::jsonb
         or jsonb_typeof(v_recognised) is distinct from 'object'
         or exists (select 1 from jsonb_object_keys(v_recognised) k where k not in ('request_number', 'customer_name')) then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      v_req := private.ingest_text(v_recognised, 'request_number');
      v_customer_name := private.ingest_text(v_recognised, 'customer_name');
      if (v_req is not null and v_req !~ '^[A-Za-z0-9-]{1,32}$')
         or (v_customer_name is not null and not private.ingest_safe_text(v_customer_name, 120, false)) then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      -- Each problem: kind and field from their closed lists, a rule only for 'invalid'
      -- (INVALID_RULES) and 'conflict' (CONFLICT_RULES), a value null or TEXT-SAFE of at most 120
      -- characters, and no other member.
      for v_item in select x.value from jsonb_array_elements(v_problems) x loop
        if jsonb_typeof(v_item) <> 'object' then
          raise exception using errcode = '22023', message = 'invalid input';
        end if;
        if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('kind', 'field', 'rule', 'value')) then
          raise exception using errcode = '22023', message = 'invalid input';
        end if;
        v_item_kind := private.ingest_text(v_item, 'kind');
        v_item_field := private.ingest_text(v_item, 'field');
        v_item_rule := private.ingest_text(v_item, 'rule');
        v_item_value := private.ingest_text(v_item, 'value');
        if v_item_kind is null or v_item_field is null
           or v_item_kind not in ('missing', 'invalid', 'unknown_place', 'unknown_technician', 'inactive_technician',
                                  'ambiguous_technician', 'conflict')
           or v_item_field not in ('req', 'task', 'rep', 'customerNo', 'customer', 'phone', 'phone2', 'city', 'street', 'building',
                                   'floor', 'apt', 'arrival', 'type', 'product', 'sku', 'desc', 'warranty', 'collect',
                                   'collectFrom', 'techNote', 'subject', 'attendee', 'organizer', 'schedule', 'body')
           -- (CASE in parentheses: PL/pgSQL ends an IF condition at the first THEN outside them.)
           or (case v_item_kind
                 when 'invalid' then v_item_rule is null
                   or v_item_rule not in ('format', 'length', 'duplicate_label', 'warranty_format', 'unknown_call_type',
                                          'end_before_start', 'too_many_attendees')
                 when 'conflict' then v_item_rule is null
                   or v_item_rule not in ('request_number_changed', 'real_service_call', 'real_customer', 'real_product')
                 else v_item_rule is not null
               end)
           or (v_item_value is not null and not private.ingest_safe_text(v_item_value, 120, false)) then
          raise exception using errcode = '22023', message = 'invalid input';
        end if;
      end loop;
    else
      -- 2c. Upsert: every field present (null when absent), required ones set, each with its
      --     column's rule (features/calendar/ingestion/parse.ts FIELD_RULES; Migrations 2 and 3).
      v_f := p_command -> 'fields';
      if v_f is null or jsonb_typeof(v_f) <> 'object'
         or (select count(*) from jsonb_object_keys(v_f) k
             where k in ('request_number', 'task_number', 'handling_rep_name', 'customer_number', 'customer_name', 'phone',
                         'phone_alt', 'city', 'street', 'building', 'floor', 'apartment', 'arrival_notes', 'call_type',
                         'product_name', 'sku', 'fault_description', 'warranty_status', 'warranty_until', 'warranty_raw',
                         'pickup_item', 'pickup_location', 'tech_notes')) <> 23
         or (select count(*) from jsonb_object_keys(v_f)) <> 23
         or p_command -> 'problems' is distinct from 'null'::jsonb
         or p_command -> 'recognised' is distinct from 'null'::jsonb
         or v_start is null or v_end is null or v_end < v_start or cardinality(v_attendees) = 0 then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      v_req := private.ingest_text(v_f, 'request_number');
      v_task := private.ingest_text(v_f, 'task_number');
      v_rep := private.ingest_text(v_f, 'handling_rep_name');
      v_customer_number := private.ingest_text(v_f, 'customer_number');
      v_customer_name := private.ingest_text(v_f, 'customer_name');
      v_phone := private.ingest_text(v_f, 'phone');
      v_phone_alt := private.ingest_text(v_f, 'phone_alt');
      v_city := private.ingest_text(v_f, 'city');
      v_street := private.ingest_text(v_f, 'street');
      v_building := private.ingest_text(v_f, 'building');
      v_floor := private.ingest_text(v_f, 'floor');
      v_apartment := private.ingest_text(v_f, 'apartment');
      v_arrival := private.ingest_text(v_f, 'arrival_notes');
      v_call_type := private.ingest_text(v_f, 'call_type');
      v_product_name := private.ingest_text(v_f, 'product_name');
      v_sku := private.ingest_text(v_f, 'sku');
      v_fault := private.ingest_text(v_f, 'fault_description');
      v_w_status := private.ingest_text(v_f, 'warranty_status');
      v_w_raw := private.ingest_text(v_f, 'warranty_raw');
      v_pickup_item := private.ingest_text(v_f, 'pickup_item');
      v_pickup_location := private.ingest_text(v_f, 'pickup_location');
      v_tech_notes := private.ingest_text(v_f, 'tech_notes');
      if private.ingest_text(v_f, 'warranty_until') is not null then
        if private.ingest_text(v_f, 'warranty_until') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' then
          raise exception using errcode = '22023', message = 'invalid input';
        end if;
        v_w_until := private.ingest_text(v_f, 'warranty_until')::date;
      end if;
      if v_req is null or v_req !~ '^[A-Za-z0-9-]{1,32}$'
         or not private.ingest_ascii_id(v_task, 40)
         or not private.ingest_safe_text(v_rep, 60, false)
         or not private.ingest_ascii_id(v_customer_number, 40)
         or not private.ingest_safe_text(v_customer_name, 120, false)
         or v_phone is null or char_length(v_phone) > 20 or v_phone !~ '^\+?[0-9]([ -]?[0-9]){2,}$'
         or (v_phone_alt is not null and (char_length(v_phone_alt) > 20 or v_phone_alt !~ '^\+?[0-9]([ -]?[0-9]){2,}$'))
         or not private.ingest_safe_text(v_city, 60, false)
         or not private.ingest_safe_text(v_street, 120, false)
         or (v_building is not null and not private.ingest_safe_text(v_building, 20, false))
         or (v_floor is not null and not private.ingest_safe_text(v_floor, 20, false))
         or (v_apartment is not null and not private.ingest_safe_text(v_apartment, 20, false))
         or (v_arrival is not null and not private.ingest_safe_text(v_arrival, 1000, true))
         or not private.ingest_safe_text(v_call_type, 60, false)
         or not private.ingest_safe_text(v_product_name, 120, false)
         or not private.ingest_ascii_id(v_sku, 40)
         or not private.ingest_safe_text(v_fault, 1000, true)
         or (v_w_status is null) <> (v_w_raw is null)
         or (v_w_status is not null and v_w_status not in ('yes', 'no'))
         or (v_w_raw is not null and not private.ingest_safe_text(v_w_raw, 60, false))
         or (v_w_until is not null and v_w_status is distinct from 'yes')
         or (v_pickup_item is not null and not private.ingest_safe_text(v_pickup_item, 120, false))
         or (v_pickup_location is not null and not private.ingest_safe_text(v_pickup_location, 60, false))
         or (v_tech_notes is not null and not private.ingest_safe_text(v_tech_notes, 1000, true)) then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
    end if;
  end if;

  -- 3. Rate limit (OQ-8). A count of the caller's recent changes, not a lock: two of his calls
  --    side by side may both pass at the limit (accepted for the TEMPORARY value; README N2).
  if (select count(*) from public.calendar_event_changes c
      where c.received_by = v_caller.id and c.recorded_at > now() - interval '1 minute') >= 30 then
    raise exception using errcode = 'PT429', message = 'too many invitation changes; try again in a minute';
  end if;

  -- 4. The event's identity, serialized for the rest of the transaction (two deliveries of one
  --    event never run side by side).
  perform pg_advisory_xact_lock(hashtextextended('tm.calendar_event:' || v_source || ':' || v_calendar_id || ':' || v_event_key, 0));
  insert into public.external_calendar_events as e (data_source, calendar_id, event_id, created_by, updated_by)
  values (v_source, v_calendar_id, v_event_key, v_caller.id, v_caller.id)
  on conflict (data_source, calendar_id, event_id) do nothing;
  select e.* into v_event from public.external_calendar_events e
  where e.data_source = v_source and e.calendar_id = v_calendar_id and e.event_id = v_event_key
  for update;
  v_ref := 'cal-change:' || v_change_id::text;
  v_event_ref := 'cal-event:' || v_event.id::text;

  -- 5. Replay or conflict: the same change key again (database-schema.md §10).
  v_sha := encode(sha256(convert_to(p_command::text, 'UTF8')), 'hex');
  select c.* into v_prior from public.calendar_event_changes c
  where c.calendar_event_id = v_event.id and c.change_key = v_change_key;
  if found then
    if v_prior.payload_sha256 is distinct from v_sha then
      raise exception using errcode = '23505', message = 'calendar_event_changes: the change key was received before with other content';
    end if;
    return private.ingest_answer(v_prior.id, true);
  end if;

  -- 6. An older change (out of order, OQ-9) is recorded and never applied; after a deletion
  --    nothing applies (OQ-2). Its content was checked in step 2 like any other.
  if (v_event.last_changed_at is not null and v_changed_at <= v_event.last_changed_at) or v_event.status = 'deleted' then
    insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type,
                                               payload_sha256, outcome, service_call_id, visit_id)
    values (v_change_id, v_event.id, v_change_key, v_changed_at, v_caller.id,
            case when v_kind = 'delete' then 'delete' else 'upsert' end, v_sha,
            case when v_event.status = 'deleted' and not (v_event.last_changed_at is not null and v_changed_at <= v_event.last_changed_at)
                 then 'no_effect' else 'stale' end,
            v_event.service_call_id, v_event.visit_id);
    if v_event.status = 'deleted' and v_changed_at > v_event.last_changed_at then
      update public.external_calendar_events e
      set last_change_key = v_change_key, last_changed_at = v_changed_at, updated_by = v_caller.id
      where e.id = v_event.id;
    end if;
    return private.ingest_answer(v_change_id, false);
  end if;

  -- 7. Deletion (OQ-2): never an automatic cancellation.
  if v_kind = 'delete' then
    v_outcome := 'no_effect';
    if v_event.visit_id is not null then
      select c.* into v_call from public.service_calls c where c.id = v_event.service_call_id for update;
      select v.* into v_visit from public.visits v where v.id = v_event.visit_id for update;
      if v_visit.status in ('scheduled', 'en_route', 'in_progress') then
        perform private.create_review_item('cancellation', v_ref || ':cancellation', v_call.id, v_visit.id, 'invitation', v_ref,
          null, jsonb_build_object('event', 'deleted'),
          jsonb_build_object('status', v_visit.status, 'technician_id', v_visit.technician_id), null);
        v_outcome := 'review';
      end if;
    end if;
    insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type,
                                               payload_sha256, outcome, service_call_id, visit_id)
    values (v_change_id, v_event.id, v_change_key, v_changed_at, v_caller.id, 'delete', v_sha, v_outcome,
            v_event.service_call_id, v_event.visit_id);
    update public.calendar_ingestion_errors x
    set status = 'resolved', resolution = 'deleted', resolved_by_change_id = v_change_id
    where x.calendar_event_id = v_event.id and x.status = 'open';
    update public.external_calendar_events e
    set status = 'deleted', last_change_key = v_change_key, last_changed_at = v_changed_at, updated_by = v_caller.id
    where e.id = v_event.id;
    return private.ingest_answer(v_change_id, false);
  end if;

  -- 8. Upsert: lookups in Settings and in what is stored (S-05: each failure is a readable reason;
  --    its value is the text read, at most 120 characters, already checked in step 2).
  if v_kind = 'upsert' then
    -- Technician = the attendee whose Outlook email matches (D18, SE-05).
    v_attendee_list := btrim(left(array_to_string(v_attendees, ', '), 120));
    v_tech_ids := array(select t.id from public.technicians t where t.outlook_email = any (v_attendees) order by t.id);
    if cardinality(v_tech_ids) = 0 then
      v_problems := v_problems || jsonb_build_object('kind', 'unknown_technician', 'field', 'attendee', 'value', v_attendee_list);
    elsif cardinality(v_tech_ids) > 1 then
      v_problems := v_problems || jsonb_build_object('kind', 'ambiguous_technician', 'field', 'attendee', 'value', v_attendee_list);
    else
      v_technician_id := v_tech_ids[1];
    end if;
    select t.id into v_call_type_id from public.call_types t where t.label_he = v_call_type and t.is_active;
    if v_call_type_id is null then
      v_problems := v_problems || jsonb_build_object('kind', 'invalid', 'field', 'type', 'rule', 'unknown_call_type',
        'value', v_call_type);
    end if;
    if v_pickup_location is not null then
      select l.id into v_location_id from public.collection_locations l where l.name = v_pickup_location and l.is_active;
      if v_location_id is null then
        v_problems := v_problems || jsonb_build_object('kind', 'unknown_place', 'field', 'collectFrom', 'value', v_pickup_location);
      end if;
    end if;
    -- A visit never moves to another call (OQ-7); test data never joins real data (D47).
    if v_event.service_call_id is not null
       and (select c.request_number from public.service_calls c where c.id = v_event.service_call_id) is distinct from v_req then
      v_problems := v_problems || jsonb_build_object('kind', 'conflict', 'field', 'req', 'rule', 'request_number_changed', 'value', v_req);
    elsif exists (select 1 from public.service_calls c where c.request_number = v_req and not c.is_test) then
      v_problems := v_problems || jsonb_build_object('kind', 'conflict', 'field', 'req', 'rule', 'real_service_call', 'value', v_req);
    end if;
    if exists (select 1 from public.customers c where c.customer_number = v_customer_number and not c.is_test) then
      v_problems := v_problems || jsonb_build_object('kind', 'conflict', 'field', 'customerNo', 'rule', 'real_customer',
        'value', v_customer_number);
    end if;
    if exists (select 1 from public.products p where p.sku_normalized = upper(v_sku collate "C") and not p.is_test) then
      v_problems := v_problems || jsonb_build_object('kind', 'conflict', 'field', 'sku', 'rule', 'real_product', 'value', v_sku);
    end if;
    if v_event.visit_id is not null then
      select v.* into v_visit from public.visits v where v.id = v_event.visit_id;
    end if;
    -- Eligibility of a new assignment (OQ-6; Migration 5 section 13).
    if v_technician_id is not null and (v_event.visit_id is null or v_visit.technician_id is distinct from v_technician_id)
       and not exists (select 1 from public.technicians t join public.profiles p on p.id = t.profile_id
                       where t.id = v_technician_id and t.accepts_invitations and p.is_active and p.role = 'technician'
                         and p.deleted_at is null) then
      v_problems := v_problems || jsonb_build_object('kind', 'inactive_technician', 'field', 'attendee', 'value', v_attendee_list);
    end if;
  end if;

  -- 9. Not ingested: one open row per event lists the reasons (S-05); the visit, if any, keeps
  --    its earlier version.
  if jsonb_array_length(v_problems) > 0 then
    insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type,
                                               payload_sha256, outcome, service_call_id, visit_id)
    values (v_change_id, v_event.id, v_change_key, v_changed_at, v_caller.id, 'upsert', v_sha, 'unparsed',
            v_event.service_call_id, v_event.visit_id);
    update public.calendar_ingestion_errors x
    set status = 'resolved', resolution = 'superseded', resolved_by_change_id = v_change_id
    where x.calendar_event_id = v_event.id and x.status = 'open';
    insert into public.calendar_ingestion_errors (calendar_event_id, change_id, subject, organizer_email, attendee_emails,
                                                  event_start, event_end, request_number, customer_name, problems)
    values (v_event.id, v_change_id, v_subject, v_organizer, to_jsonb(v_attendees),
            case when v_start is not null and v_end is not null then v_start end,
            case when v_start is not null and v_end is not null then v_end end,
            v_req, v_customer_name, v_problems);
    update public.external_calendar_events e
    set last_change_key = v_change_key, last_changed_at = v_changed_at, updated_by = v_caller.id
    where e.id = v_event.id;
    return private.ingest_answer(v_change_id, false);
  end if;

  -- 10. Ingest. The base is the event's previous processed version (D39 "changed in that
  --     invitation"); for a new event every value counts as changed.
  v_snapshot := jsonb_build_object('fields', v_f, 'attendee_emails', to_jsonb(v_attendees), 'start', v_start, 'end', v_end,
                                   'technician_id', v_technician_id);
  select c.snapshot into v_base from public.calendar_event_changes c
  where c.calendar_event_id = v_event.id and c.snapshot is not null
  order by c.changed_at desc limit 1;
  select p.id into v_rep_profile_id from public.profiles p
  where p.invitation_rep_name = v_rep and p.is_active and p.deleted_at is null
    and p.role in ('creator', 'manager', 'customer_service');

  if v_event.visit_id is null then
    -- 10a. The event's first valid version: a new visit. The request number is the call's key
    --      (X-01); serialized, so two events with a new number never create two calls.
    perform pg_advisory_xact_lock(hashtextextended('tm.request_number:' || v_req, 0));
    select c.* into v_call from public.service_calls c where c.request_number = v_req for update;
    if not found then
      -- D19: the customer and the product by their keys; an existing product name is never
      -- overwritten (ON CONFLICT DO NOTHING; PR-05, PR-07).
      insert into public.customers as x (customer_number, name, phone, phone_alt, data_source, source_ref, created_by, updated_by)
      values (v_customer_number, v_customer_name, v_phone, v_phone_alt, v_source, v_event_ref, v_caller.id, v_caller.id)
      on conflict (customer_number) do nothing
      returning x.* into v_customer;
      if v_customer.id is null then
        select x.* into v_customer from public.customers x where x.customer_number = v_customer_number for update;
      else
        v_new_customer := true;
        v_applied := v_applied || array['customers.created', 'customers.phone']
          || case when v_phone_alt is not null then array['customers.phone_alt'] else '{}'::text[] end;
      end if;
      insert into public.products as x (sku_display, sku_normalized, name, data_source, source_ref, created_by, updated_by)
      values (v_sku, upper(v_sku collate "C"), v_product_name, v_source, v_event_ref, v_caller.id, v_caller.id)
      on conflict (sku_normalized) do nothing
      returning x.* into v_product;
      if v_product.id is null then
        select x.* into v_product from public.products x where x.sku_normalized = upper(v_sku collate "C");
      else
        v_applied := v_applied || 'products.created'::text;
      end if;
      -- The call is created open with its first visit (DEV-13 of PR 1.5).
      insert into public.service_calls as x (request_number, customer_id, product_id, call_type_id, fault_description,
                                             warranty_status, warranty_until, warranty_raw, handling_rep_name,
                                             handling_rep_profile_id, status, next_visit_number, data_source, source_ref,
                                             created_by, updated_by)
      values (v_req, v_customer.id, v_product.id, v_call_type_id, v_fault, v_w_status, v_w_until, v_w_raw, v_rep,
              v_rep_profile_id, 'open', 2, v_source, v_event_ref, v_caller.id, v_caller.id)
      returning x.* into v_call;
      v_new_call := true;
      v_applied := v_applied || array['service_calls.created', 'service_calls.call_type_id', 'service_calls.fault_description',
                                      'service_calls.handling_rep_name']
        || case when v_w_status is not null then array['service_calls.warranty'] else '{}'::text[] end;
      v_visit_number := 1;
    else
      -- A follow-up invitation: the next visit of the same call (X-03; D38: it reopens a resolved
      -- call). The call's customer and product stay (D39).
      v_visit_number := v_call.next_visit_number;
      if v_visit_number > 999 then
        raise exception using errcode = '55000', message = 'service_calls: no free visit number';
      end if;
      update public.service_calls c set next_visit_number = v_visit_number + 1, updated_by = v_caller.id
      where c.id = v_call.id
      returning c.* into v_call;
      select x.* into v_customer from public.customers x where x.id = v_call.customer_id for update;
    end if;
    insert into public.visits as x (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                                    status, city, street, building, floor, apartment, arrival_notes, tech_notes, pickup_item,
                                    pickup_location_id, source_ref, is_test, created_by, updated_by)
    values (v_call.id, v_technician_id, v_visit_number, v_task, v_start, v_end, 'scheduled', v_city, v_street, v_building,
            v_floor, v_apartment, v_arrival, v_tech_notes, v_pickup_item, v_location_id, v_event_ref, v_call.is_test,
            v_caller.id, v_caller.id)
    returning x.* into v_visit;
    insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id, is_test)
    values (v_visit.id, v_visit.version, 'created', null, 'scheduled', v_caller.id, v_visit.is_test);
    v_applied := v_applied || 'visits.created'::text;
    update public.external_calendar_events e
    set service_call_id = v_call.id, visit_id = v_visit.id, updated_by = v_caller.id
    where e.id = v_event.id;
    v_open := true;
  else
    -- 10b. A new version of an ingested invitation (update, reschedule, re-assignment), compared
    --      with the base for what changed in it (D39; independent review M1).
    select c.* into v_call from public.service_calls c where c.id = v_event.service_call_id for update;
    select v.* into v_visit from public.visits v where v.id = v_event.visit_id for update;
    select x.* into v_customer from public.customers x where x.id = v_call.customer_id for update;
    v_open := v_visit.status in ('scheduled', 'en_route', 'in_progress');
    if v_open then
      select a.p_applied, a.p_reviews into v_applied, v_reviews
      from private.ingest_apply_visit(v_visit, v_base, v_technician_id, v_task, v_start, v_end, v_city, v_street, v_building,
        v_floor, v_apartment, v_arrival, v_tech_notes, v_pickup_item, v_location_id, v_ref, v_applied, v_reviews) a;
    end if;
  end if;

  -- 11. Call level, for an open visit with an existing customer (a follow-up invitation, a new
  --     call of a known customer, a new version): identity changes go to review (D39, OQ-4);
  --     contact details and, for an existing call, the call fields follow the newest invitation
  --     field by field (D39, OQ-3). A closed or cancelled visit is never changed (D39).
  if v_open and not v_new_customer then
    select x.* into v_product from public.products x where x.id = v_call.product_id;
    select a.p_applied, a.p_reviews into v_applied, v_reviews
    from private.ingest_apply_call(v_call, v_customer, v_product, not v_new_call, v_base, v_f, v_changed_at, v_call_type_id,
      v_rep_profile_id, v_ref, v_applied, v_reviews) a;
  end if;

  perform private.recalc_call_status(v_call.id);

  v_outcome := case
    when not v_open then 'no_effect'
    when v_reviews > 0 then 'review'
    when cardinality(v_applied) > 0 then 'applied'
    else 'no_effect'
  end;
  insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type,
                                             payload_sha256, outcome, service_call_id, visit_id, customer_id, applied_fields,
                                             snapshot)
  values (v_change_id, v_event.id, v_change_key, v_changed_at, v_caller.id, 'upsert', v_sha, v_outcome, v_call.id, v_visit.id,
          v_customer.id, v_applied, v_snapshot);
  -- An open unparsed row of the event is resolved: 'ingested' when this version reached an open
  -- visit, 'superseded' when its visit is closed or cancelled and nothing of it applies (D39;
  -- independent review N5).
  update public.calendar_ingestion_errors x
  set status = 'resolved', resolution = case when v_open then 'ingested' else 'superseded' end,
      resolved_by_change_id = v_change_id
  where x.calendar_event_id = v_event.id and x.status = 'open';
  update public.external_calendar_events e
  set last_change_key = v_change_key, last_changed_at = v_changed_at, updated_by = v_caller.id
  where e.id = v_event.id;
  return private.ingest_answer(v_change_id, false);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Public API: the thin SECURITY INVOKER wrapper of the writer (same name and argument). The
--    body checks its caller (an active Manager, Creator or Customer Service user). The simulator's
--    environment switch (D24, SIM-11) is checked by the server action only, before it calls this:
--    the database cannot see it, so the switch does not hold for this RPC (TEMPORARY OQ-13; the
--    go-live hand-off in the header revokes it or gates it on an owner-set flag).
-- ---------------------------------------------------------------------------------------------
create function public.ingest_calendar_event(p_command jsonb)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.ingest_calendar_event(p_command) $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Test-data census (replaces the PR 1.6 function; same signature, ACL and caller rule).
--    external_calendar_events is counted per source in fixed rows, as the other root tables; the
--    two child tables in one 'all sources' row each.
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
    select 'external_calendar_events', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'automated_test',
           count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.external_calendar_events x
    union all
    select 'calendar_event_changes', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_event_changes x
    union all
    select 'calendar_ingestion_errors', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_ingestion_errors x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. RLS policies: SELECT only, TO authenticated only, every one requires an active profile
--    (through the helpers). No write or anon policies. TEMPORARY (OQ-1, open decision 15): the
--    unparsed list (calendar_ingestion_errors) for the office roles that use the simulator
--    (active Creator, Manager, Customer Service; D24, D60 (4), (11)); the event identity and the
--    change log for the Creator only. The list reads the open rows newest first through the
--    (status, created_at) index, bounded by the request (and PostgREST's max_rows).
-- ---------------------------------------------------------------------------------------------
create policy external_calendar_events_select_creator on public.external_calendar_events for select to authenticated
  using ((select private.is_creator()));
create policy calendar_event_changes_select_creator on public.calendar_event_changes for select to authenticated
  using ((select private.is_creator()));
create policy calendar_ingestion_errors_select_office on public.calendar_ingestion_errors for select to authenticated
  using ((select private.is_office_user()));

-- ---------------------------------------------------------------------------------------------
-- 9. Grants, per object (never PR 1.3's blanket revokes, which would strip its grants). Tables:
--    SELECT for authenticated, nothing else for anyone; no sequences. Functions: EXECUTE for
--    authenticated on the wrapper and the body it calls (the body checks its caller); none on the
--    trigger functions or the helpers. Nothing for anon, service_role or PUBLIC.
--    test_data_census() keeps its ACL (CREATE OR REPLACE keeps it).
-- ---------------------------------------------------------------------------------------------
revoke all on table public.external_calendar_events from public, anon, authenticated, service_role;
revoke all on table public.calendar_event_changes from public, anon, authenticated, service_role;
revoke all on table public.calendar_ingestion_errors from public, anon, authenticated, service_role;

grant select on public.external_calendar_events, public.calendar_event_changes, public.calendar_ingestion_errors to authenticated;

revoke all on function private.tg_calendar_child_marker() from public, anon, authenticated, service_role;
revoke all on function private.tg_calendar_event_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_ingestion_error_state() from public, anon, authenticated, service_role;
revoke all on function private.ingest_text(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.ingest_timestamp(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.ingest_safe_text(text, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function private.ingest_ascii_id(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.ingest_email(text) from public, anon, authenticated, service_role;
revoke all on function private.ingest_field_source_at(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.ingest_answer(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.ingest_apply_visit(public.visits, jsonb, uuid, text, timestamptz, timestamptz, text, text, text, text,
  text, text, text, text, uuid, text, text[], integer) from public, anon, authenticated, service_role;
revoke all on function private.ingest_apply_call(public.service_calls, public.customers, public.products, boolean, jsonb, jsonb,
  timestamptz, uuid, uuid, text, text[], integer) from public, anon, authenticated, service_role;
revoke all on function private.ingest_calendar_event(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ingest_calendar_event(jsonb) from public, anon, authenticated, service_role;

grant execute on function
  private.ingest_calendar_event(jsonb),
  public.ingest_calendar_event(jsonb)
to authenticated;

comment on function private.ingest_calendar_event(jsonb) is
  'Step 6: the database side of the single calendar ingestion service (D08, D19, D24, D38, D39, D47). One change of one invitation per call, in one transaction; idempotent per (event, change key). Never called by a migration.';
comment on function public.ingest_calendar_event(jsonb) is
  'Step 6: the ingestion RPC (SECURITY INVOKER wrapper). Called by the simulator server action under the caller''s session. TEMPORARY OQ-13: the simulator switch is not checked here; revoked or flag-gated before real use.';

-- ---------------------------------------------------------------------------------------------
-- 10. Hand-offs (no statement).
--     Step 5 ("זימונים שלא נקלטו", S-05; open decision 15): the list reads the open rows of
--     calendar_ingestion_errors (status 'open', newest created_at first, a bounded page) through
--     calendar_ingestion_errors_select_office; once the owner names the matrix key, a migration
--     replaces that policy's fixed capability with the key (OQ-1); the source label comes from
--     is_test (every source before Step 11 is test data); the mapping of the
--     problem kinds to Hebrew (features/calendar/data/types.ts UnparsedProblem gains the
--     technician and conflict kinds). The simulator button inside that screen (D60 (11)).
--     Step 3 / Step 7: the D39 notification of an applied change to a visit en route or in
--     progress (OQ-5) and of a new or changed visit for its technician (spec "Notifications").
--     The D44 apply paths of the invitation review types (OQ-11): resolve_review_item gains
--     apply_incoming for reassignment, address_change, cancellation (after open decision 5),
--     customer_change and sku_change (with the field_version step of Migration 4 OQ-14).
--     Step 11: the Microsoft Graph source ('microsoft_graph' in the data_source CHECKs) and its
--     session-less entry point; received_by then admits the service (OQ-10). The Graph adapter
--     filters by the subject prefix before the database for new and changed events, but a
--     deletion carries no subject: today every deletion of an unknown event is recorded (an
--     event row 'deleted', a 'no_effect' change); the Graph adapter must deliver deletions only
--     for events this table already knows (README N7).
--     Before real use (D23; OQ-13, open decision 21): a reviewed migration revokes EXECUTE on
--     public.ingest_calendar_event(jsonb) and private.ingest_calendar_event(jsonb) from
--     authenticated, or makes the body refuse unless an owner-set flag allows the simulator.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- 11. Fail closed when the hardening did not take effect (owner, 2026-11-11 and 2026-11-12: as
--     in Migration 5, section 14, byte for byte). Read-only; any leftover raises, and the whole
--     migration then rolls back. tests/db/320 runs a copy of this block (kept identical by
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
