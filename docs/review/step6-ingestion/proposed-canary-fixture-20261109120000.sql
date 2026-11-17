-- Canary rows for migration 20261109120000_calendar_ingestion.sql (Step 6), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (D47: the two events are 'simulator' and
-- 'automated_test' data, so is_test is true; the changes and errors copy it from their event in
-- the triggers), example.test addresses, explicit ids and timestamps; the three tables have uuid
-- keys, so no sequence is consumed. Inserted directly as postgres in one transaction, with every
-- trigger and CHECK active (the writer needs a signed-in user). No earlier row is changed; the only
-- UPDATEs move rows added here to their later states, as the guards require (an event is created
-- active, unlinked and without a change, an error open): the simulator event's visit link and
-- newest change, the automated event's deletion, and the two resolutions.
--
-- Server times are set by the triggers: calendar_event_changes.recorded_at,
-- calendar_ingestion_errors.created_at and resolved_at.
--
-- The rows reference only canary rows of the earlier fixtures: the PR 1.3 Manager
-- (c0000000-0000-4000-8000-000000001001), the PR 1.4 customer ...6001, and the PR 1.5 call a001
-- with its visit b001. Two events, four changes (one applied with its parsed fields, two unparsed
-- versions, a deletion) and two errors (one superseded, one resolved by the deletion): every
-- column of the three tables is non-null in at least one row, so no coverage exception is needed.

-- Two invitation events: one from the simulator, one automated test event.
insert into public.external_calendar_events (id, data_source, calendar_id, event_id, created_at, created_by, updated_at, updated_by,
                                             version)
values
  ('c0000000-0000-4000-8000-00000000e601', 'simulator', 'simulator', 'sim-canary-0001', '2026-02-01 08:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-02-01 08:00:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-00000000e602', 'automated_test', 'canary-calendar', 'evt-canary-0002', '2026-02-01 09:00:00+00',
   null, '2026-02-01 09:00:00+00', null, 1);

-- Four changes: one applied (with its parsed fields), two unparsed versions and a deletion.
insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type, payload_sha256,
                                           outcome, service_call_id, visit_id, customer_id, applied_fields, snapshot, is_test)
values
  ('c0000000-0000-4000-8000-00000000f601', 'c0000000-0000-4000-8000-00000000e601', 'sim-canary-k1', '2026-02-01 08:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 'upsert', repeat('a', 64), 'applied', 'c0000000-0000-4000-8000-00000000a001',
   'c0000000-0000-4000-8000-00000000b001', 'c0000000-0000-4000-8000-000000006001', '{visits.created,customers.phone}',
   '{"fields": {"request_number": "CNRY-R-0001"}, "start": "2026-01-21T08:00:00+00:00"}', true),
  ('c0000000-0000-4000-8000-00000000f602', 'c0000000-0000-4000-8000-00000000e602', 'evt-canary-k1', '2026-02-01 09:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 'upsert', repeat('b', 64), 'unparsed', null, null, null, '{}', null, true),
  ('c0000000-0000-4000-8000-00000000f603', 'c0000000-0000-4000-8000-00000000e602', 'evt-canary-k2', '2026-02-01 10:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 'upsert', repeat('c', 64), 'unparsed', null, null, null, '{}', null, true),
  ('c0000000-0000-4000-8000-00000000f604', 'c0000000-0000-4000-8000-00000000e602', 'evt-canary-k3', '2026-02-01 11:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 'delete', repeat('d', 64), 'no_effect', null, null, null, '{}', null, true);

-- The two unparsed versions: the first superseded by the second, the second resolved by the deletion.
insert into public.calendar_ingestion_errors (id, calendar_event_id, change_id, subject, organizer_email, attendee_emails, event_start,
                                              event_end, request_number, customer_name, problems, is_test, updated_at, version)
values ('c0000000-0000-4000-8000-00000000f611', 'c0000000-0000-4000-8000-00000000e602', 'c0000000-0000-4000-8000-00000000f602',
        '[קריאת שירות] קנרית', 'rep-canary@example.test', '["tech-canary@example.test"]', '2026-02-03 08:00:00+00',
        '2026-02-03 10:00:00+00', 'CNRY-R-0002', 'לקוח קנרית', '[{"kind": "missing", "field": "customerNo"}]', true,
        '2026-02-01 09:00:00+00', 1);
update public.calendar_ingestion_errors
set status = 'resolved', resolution = 'superseded', resolved_by_change_id = 'c0000000-0000-4000-8000-00000000f603'
where id = 'c0000000-0000-4000-8000-00000000f611';
insert into public.calendar_ingestion_errors (id, calendar_event_id, change_id, problems, is_test, updated_at, version)
values ('c0000000-0000-4000-8000-00000000f612', 'c0000000-0000-4000-8000-00000000e602', 'c0000000-0000-4000-8000-00000000f603',
        '[{"kind": "unknown_place", "field": "collectFrom", "value": "מחסן קנרית"}]', true, '2026-02-01 10:00:00+00', 1);
update public.calendar_ingestion_errors
set status = 'resolved', resolution = 'deleted', resolved_by_change_id = 'c0000000-0000-4000-8000-00000000f604'
where id = 'c0000000-0000-4000-8000-00000000f612';

-- The simulator event's visit link and newest change; the automated event deleted.
update public.external_calendar_events
set service_call_id = 'c0000000-0000-4000-8000-00000000a001', visit_id = 'c0000000-0000-4000-8000-00000000b001',
    last_change_key = 'sim-canary-k1', last_changed_at = '2026-02-01 08:00:00+00'
where id = 'c0000000-0000-4000-8000-00000000e601';
update public.external_calendar_events
set status = 'deleted', last_change_key = 'evt-canary-k3', last_changed_at = '2026-02-01 11:00:00+00'
where id = 'c0000000-0000-4000-8000-00000000e602';
