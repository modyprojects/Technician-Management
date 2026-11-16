-- Canary rows for migration 20261106120000_service_calls_visits.sql (PR 1.5), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (D47: data_source 'simulator' or 'automated_test'
-- on the calls, so their generated is_test is true; the visits and every visit_* and history row
-- copy is_test = true from their parent in the triggers), no e-mail addresses, explicit ids;
-- no sequence is consumed (the identity ids of visit_time_reports, visit_events and entity_changes
-- use OVERRIDING SYSTEM VALUE from 1000001 up). Inserted directly as postgres in one transaction,
-- with every trigger and CHECK active: there is no write path in PR 1.5, and the deferred
-- constraint triggers (c10 to c40) check every call, visit, report and signature at COMMIT.
--
-- Server times are set by the triggers, whatever a writer sends (D45, plan DEV-9): opened_at,
-- assigned_at, closed_at, cancelled_at, received_at, recorded_at and changed_at take the
-- transaction's now(). So the resolved call a001 stores resolved_at = now(), which equals the
-- closed_at of its resolving visit b002 in the same transaction (c10 and c20 compare them), and the
-- field-time flags are computed against now(): the device times below are from January 2026, so the
-- skew is large and the skew-corrected times fall before the assignment (large_skew,
-- before_assignment). These are the only values that differ between canary runs.
--
-- The rows reference only canary rows of the earlier fixtures: the PR 1.3 Manager
-- (c0000000-0000-4000-8000-000000001001, with work_phone and invitation_rep_name), the Technician
-- profile ...1002 and technician ...2001; the PR 1.4 customers ...6001 and ...6002, products ...5001
-- and ...5002, call types ...7001 and ...7002 (deactivated), continuation reasons ...8001 and
-- ...8002 (deactivated) and pickup place ...9001. Calls are c0000000-0000-4000-8000-00000000a0xx and
-- visits ...b0xx. Visits are inserted in number order per call (t35). For later unique keys
-- (docs/review/step1-pr15 §2.11) the task numbers are distinct within each call, and every call,
-- visit, signature and time report has its own source_ref or operation_id. No coverage exception is
-- needed: every column of the seven new tables is non-null in at least one row below.

-- Calls (status as compute_call_status gives it; next_visit_number above every visit number):
-- a001 resolved (simulator, warranty yes until 03/2028 with its raw text, representative linked to
--      the Manager's profile, an earlier update by the Manager);
-- a002 awaiting_followup (automated_test, warranty no);
-- a003 awaiting_scheduling (its only visit was cancelled; no warranty given);
-- a004 open again after a reopen (resolved_at NULL; the history rows are below).
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  warranty_status, warranty_until, warranty_raw, handling_rep_name, handling_rep_profile_id,
                                  status, next_visit_number, resolved_at, data_source, source_ref,
                                  created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-00000000a001', 'CNRY-R-0001', 'c0000000-0000-4000-8000-000000006001',
   'c0000000-0000-4000-8000-000000005001', 'c0000000-0000-4000-8000-000000007001',
   E'המכשיר אינו נדלק.\nתקלת קנרית לבדיקה בלבד.', 'yes', '2028-03-01', 'כן עד 03/2028', 'נציגת קנרית',
   'c0000000-0000-4000-8000-000000001001', 'resolved', 3, now(), 'simulator', 'canary:sim-event:a001',
   '2026-01-21 07:00:00+00', 'c0000000-0000-4000-8000-000000001001', '2026-01-22 12:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 2),
  ('c0000000-0000-4000-8000-00000000a002', 'CNRY-R-0002', 'c0000000-0000-4000-8000-000000006002',
   'c0000000-0000-4000-8000-000000005002', 'c0000000-0000-4000-8000-000000007002',
   'רעש חריג בזמן פעולה', 'no', null, 'לא', 'נציג קנרית ללא פרופיל', null, 'awaiting_followup', 2, null,
   'automated_test', 'canary.test-run.a002', '2026-01-21 07:10:00+00', null, '2026-01-21 07:10:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000a003', 'CNRY-R-0003', 'c0000000-0000-4000-8000-000000006002',
   'c0000000-0000-4000-8000-000000005001', 'c0000000-0000-4000-8000-000000007001',
   'נזילה מתחתית המכשיר', null, null, null, 'נציגת קנרית', null, 'awaiting_scheduling', 2, null,
   'automated_test', 'canary.test-run.a003', '2026-01-21 07:20:00+00', null, '2026-01-21 07:20:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000a004', 'CNRY-R-0004', 'c0000000-0000-4000-8000-000000006001',
   'c0000000-0000-4000-8000-000000005002', 'c0000000-0000-4000-8000-000000007002',
   'התקנה חוזרת לאחר החלפת חלק', null, null, null, 'נציגת קנרית', 'c0000000-0000-4000-8000-000000001001',
   'open', 3, null, 'simulator', 'canary:sim-event:a004', '2026-01-21 07:30:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-23 08:00:00+00', null, 1);

-- Visits (assigned_at, closed_at and cancelled_at are set by t12, is_test by t15):
-- b001 a001/1 followup with an active reason and next-visit notes;
-- b002 a001/2 done, with every optional field set (address details, notes, pickup item and place),
--      field_version 2 and an update by the Manager;
-- b003 a002/1 followup with the deactivated reason;
-- b004 a003/1 cancelled by the Manager;
-- b005 a004/1 done (the call was resolved by it before the reopen);
-- b006 a004/2 scheduled (the reopening visit).
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, building, floor, apartment, arrival_notes, tech_notes, pickup_item,
                           pickup_location_id, followup_reason_id, next_visit_notes, cancelled_by, source_ref,
                           field_version, created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-00000000b001', 'c0000000-0000-4000-8000-00000000a001', 'c0000000-0000-4000-8000-000000002001',
   1, 'CNRY-T-0001', '2026-01-21 08:00:00+00', '2026-01-21 10:00:00+00', 'followup', 'עיר בדיונית', 'רחוב הקנרית',
   null, null, null, null, null, null, null, 'c0000000-0000-4000-8000-000000008001', 'להביא חלק חלופי בביקור הבא',
   null, 'canary:sim-event:b001', 1, '2026-01-21 07:00:00+00', null, '2026-01-21 07:00:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-00000000a001', 'c0000000-0000-4000-8000-000000002001',
   2, 'CNRY-T-0002', '2026-01-22 08:00:00+00', '2026-01-22 10:00:00+00', 'done', 'עיר בדיונית', 'שדרות הקנרית',
   '12א', '3', '7', 'קוד כניסה בדיוני, להתקשר לפני ההגעה', E'הוחלף חלק.\nנבדק לאחר ההחלפה.', 'חלק ישן להחזרה',
   'c0000000-0000-4000-8000-000000009001', null, null, null, 'canary:sim-event:b002', 2, '2026-01-21 12:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-22 12:00:00+00', 'c0000000-0000-4000-8000-000000001001', 4),
  ('c0000000-0000-4000-8000-00000000b003', 'c0000000-0000-4000-8000-00000000a002', 'c0000000-0000-4000-8000-000000002001',
   1, 'CNRY-T-0003', '2026-01-21 11:00:00+00', '2026-01-21 12:00:00+00', 'followup', 'עיר בדיונית', 'רחוב הניסוי',
   null, null, null, null, null, null, null, 'c0000000-0000-4000-8000-000000008002', 'ממתין להחלטת לקוח',
   null, 'canary.test-run.b003', 1, '2026-01-21 07:10:00+00', null, '2026-01-21 07:10:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b004', 'c0000000-0000-4000-8000-00000000a003', 'c0000000-0000-4000-8000-000000002001',
   1, 'CNRY-T-0004', '2026-01-23 08:00:00+00', '2026-01-23 09:00:00+00', 'cancelled', 'עיר בדיונית', 'רחוב הניסוי',
   null, null, null, null, null, null, null, null, null, 'c0000000-0000-4000-8000-000000001001',
   'canary.test-run.b004', 1, '2026-01-21 07:20:00+00', null, '2026-01-21 07:20:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b005', 'c0000000-0000-4000-8000-00000000a004', 'c0000000-0000-4000-8000-000000002001',
   1, 'CNRY-T-0005', '2026-01-21 13:00:00+00', '2026-01-21 14:00:00+00', 'done', 'עיר בדיונית', 'רחוב הקנרית',
   null, null, null, null, null, null, null, null, null, null, 'canary:sim-event:b005', 1,
   '2026-01-21 07:30:00+00', null, '2026-01-21 07:30:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b006', 'c0000000-0000-4000-8000-00000000a004', 'c0000000-0000-4000-8000-000000002001',
   2, 'CNRY-T-0006', '2026-02-02 08:00:00+00', '2026-02-02 09:00:00+00', 'scheduled', 'עיר בדיונית', 'רחוב הקנרית',
   null, null, null, null, null, null, null, null, null, null, 'canary:sim-event:b006', 1,
   '2026-01-23 08:00:00+00', null, '2026-01-23 08:00:00+00', null, 1);

-- Treatment summaries of the closed visits (c10 rule b, c40): written ones, one updated by the
-- Manager, and an approved transcription.
insert into public.visit_reports (visit_id, summary_text, summary_source, created_at, created_by, updated_at, updated_by,
                                  version)
values
  ('c0000000-0000-4000-8000-00000000b001', 'אובחנה תקלה בחלק פנימי; נדרש חלק חלופי', 'written',
   '2026-01-21 10:00:00+00', null, '2026-01-21 10:00:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b002', E'הוחלף החלק.\nהמכשיר נבדק ופועל.', 'written', '2026-01-22 10:00:00+00',
   'c0000000-0000-4000-8000-000000001002', '2026-01-22 12:00:00+00', 'c0000000-0000-4000-8000-000000001001', 2),
  ('c0000000-0000-4000-8000-00000000b003', 'הלקוח יחליט אם להחליף את המכשיר', 'written', '2026-01-21 12:00:00+00',
   null, '2026-01-21 12:00:00+00', null, 1),
  ('c0000000-0000-4000-8000-00000000b005', 'ההתקנה הושלמה ונבדקה', 'approved_transcription', '2026-01-21 14:00:00+00',
   null, '2026-01-21 14:00:00+00', null, 1);

-- Customer signatures of the done visits (c10 rule a, c30), with the sha256 of the NFC text as
-- UTF-8 (D43) and the device operation that carried each one.
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, created_at,
                                     created_by)
values
  ('c0000000-0000-4000-8000-00000000b002', 'חותם קנרית',
   E'אני מאשר/ת שהטיפול בוצע לשביעות רצוני.\nנוסח קנרית לבדיקה בלבד.',
   'dc5c6c6fb0fb13e0be9c0041b3e8a3db4afaed00369be57a014529cd5542c301', 'c0000000-0000-4000-8000-00000000c001',
   '2026-01-22 10:00:00+00', 'c0000000-0000-4000-8000-000000001002'),
  ('c0000000-0000-4000-8000-00000000b005', 'חותמת קנרית', 'אני מאשר/ת שהטיפול בוצע. נוסח קנרית קצר.',
   '35212b4e4cd448b86d46f09a6f5b9f88bcf489d22687c9acfc3502788599d2df', 'c0000000-0000-4000-8000-00000000c002',
   '2026-01-21 14:00:00+00', 'c0000000-0000-4000-8000-000000001002');

-- Device field times of b002, reported by the Technician himself (t35: the credited technician is
-- the reporter's own record). received_at, clock_skew_ms and row_flags are computed by t35.
insert into public.visit_time_reports (id, visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
overriding system value
values
  (1000001, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-000000002001', 'departed', '2026-01-22 07:30:00+00', 'Asia/Jerusalem', 120,
   '2026-01-22 07:35:00+00', 'device', 'c0000000-0000-4000-8000-00000000d001'),
  (1000002, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-000000002001', 'arrived', '2026-01-22 08:05:00+00', 'Asia/Jerusalem', 120,
   '2026-01-22 08:10:00+00', 'device', 'c0000000-0000-4000-8000-00000000d002'),
  (1000003, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-000000002001', 'ended', '2026-01-22 09:40:00+00', 'Asia/Jerusalem', 120,
   '2026-01-22 09:45:00+00', 'device', 'c0000000-0000-4000-8000-00000000d003'),
  (1000004, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-000000002001', 'signed', '2026-01-22 09:50:00+00', 'Asia/Jerusalem', 120,
   '2026-01-22 09:55:00+00', 'device', 'c0000000-0000-4000-8000-00000000d004');

-- Status history (c10 rule d: every visit has its 'created' event and its latest event ends in
-- its status). b002 went through the field statuses, changed by the Technician on his device.
insert into public.visit_events (id, visit_id, version_after, event_type, from_status, to_status, actor_profile_id,
                                 operation_id)
overriding system value
values
  (1000001, 'c0000000-0000-4000-8000-00000000b001', 1, 'created', null, 'followup', null, null),
  (1000002, 'c0000000-0000-4000-8000-00000000b002', 1, 'created', null, 'scheduled', null, null),
  (1000003, 'c0000000-0000-4000-8000-00000000b002', 2, 'status_changed', 'scheduled', 'en_route',
   'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000e001'),
  (1000004, 'c0000000-0000-4000-8000-00000000b002', 3, 'status_changed', 'en_route', 'in_progress',
   'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000e002'),
  (1000005, 'c0000000-0000-4000-8000-00000000b002', 4, 'status_changed', 'in_progress', 'done',
   'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000e003'),
  (1000006, 'c0000000-0000-4000-8000-00000000b003', 1, 'created', null, 'followup', null, null),
  (1000007, 'c0000000-0000-4000-8000-00000000b004', 1, 'created', null, 'cancelled', null, null),
  (1000008, 'c0000000-0000-4000-8000-00000000b005', 1, 'created', null, 'done', null, null),
  (1000009, 'c0000000-0000-4000-8000-00000000b006', 1, 'created', null, 'scheduled', null, null);

-- Field history on three targets (t20 sets changed_at and is_test from the target): the reopen of
-- a004 (status and resolved_at, recalculated by the system in the Manager's session), a schedule
-- change of b006 from an updated invitation, and a customer phone update from an invitation.
insert into public.entity_changes (id, entity_table, entity_id, field, old_value, new_value, source, source_ref,
                                   actor_profile_id)
overriding system value
values
  (1000001, 'service_calls', 'c0000000-0000-4000-8000-00000000a004', 'status', '"resolved"', '"open"', 'system', null,
   'c0000000-0000-4000-8000-000000001001'),
  (1000002, 'service_calls', 'c0000000-0000-4000-8000-00000000a004', 'resolved_at', '"2026-01-21T14:00:00+00:00"', null,
   'system', null, 'c0000000-0000-4000-8000-000000001001'),
  (1000003, 'visits', 'c0000000-0000-4000-8000-00000000b006', 'scheduled_start', '"2026-02-01T08:00:00+00:00"',
   '"2026-02-02T08:00:00+00:00"', 'invitation', 'canary:sim-event:b006', null),
  (1000004, 'customers', 'c0000000-0000-4000-8000-000000006001', 'phone', '"050-000-0100"', '"050-000-0101"',
   'invitation', 'canary:sim-event:a001', null);
