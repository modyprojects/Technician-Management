-- Canary rows for migration 20261107120000_integrity_offline.sql (PR 1.6), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (D47: every new row copies is_test = true from its
-- test call or visit in the triggers), no e-mail addresses, explicit ids; no sequence is consumed
-- (the two new visit_time_reports rows use OVERRIDING SYSTEM VALUE, 1000005 and 1000006). Inserted
-- directly as postgres in one transaction, with every trigger and CHECK active (the writers need a
-- signed-in user). No visit, call, report or earlier row is changed: the two review items that are
-- resolved here are inserted open and decided in this fixture, which only adds rows.
--
-- Server times are set by the triggers (D45): review_items.created_at and resolved_at,
-- visit_corrections.recorded_at, offline_operations.received_at and the received_at of the two new
-- time reports (the accepted report takes its review item's created_at, PR 1.6 OQ-13). They and
-- the derived skew and flags of the accepted report are the only values that differ between runs.
--
-- The rows reference only canary rows of the earlier fixtures: the PR 1.3 Manager
-- (c0000000-0000-4000-8000-000000001001), the Technician profile ...1002 and technician ...2001;
-- the PR 1.4 continuation reasons ...8001 and ...8002; the PR 1.5 calls a001 (resolved), a002
-- (awaiting follow-up) and a004 (open) and visits b001 (a001/1 followup), b002 (a001/2 done, version
-- 4), b003 (a002/1 followup) and b006 (a004/2 scheduled). Review items are
-- c0000000-0000-4000-8000-00000000f0xx, corrections ...f1xx and operations ...f2xx. No coverage
-- exception is needed: every column of the three new tables and the two new visit_time_reports
-- columns is non-null in at least one row below.

-- Review items: two device submissions (a second departure report on the done visit b002, and an
-- edit conflict on the follow-up visit b003, each with its operation id) and two invitation items
-- (a different SKU on the open call a004, call level; a re-assignment of the scheduled visit b006).
insert into public.review_items (id, review_type, dedupe_key, service_call_id, visit_id, source, source_ref,
                                 submitted_by_profile_id, operation_id, submitted_version, current_version, base_version)
values
  ('c0000000-0000-4000-8000-00000000f001', 'duplicate_time_report', 'canary.op.f202', 'c0000000-0000-4000-8000-00000000a001',
   'c0000000-0000-4000-8000-00000000b002', 'device', null, 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-00000000f202',
   '{"kind": "departed", "reported_at": "2026-01-22T07:31:00+00:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-01-22T07:36:00+00:00"}',
   '{"kind": "departed", "reported_at": "2026-01-22T07:30:00+00:00"}', '{"kind": "departed", "reported_at": null}'),
  ('c0000000-0000-4000-8000-00000000f002', 'edit_conflict', 'canary.op.f203', 'c0000000-0000-4000-8000-00000000a002',
   'c0000000-0000-4000-8000-00000000b003', 'device', null, 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-00000000f203', '{"summary": "סיכום שנשלח מהמכשיר"}',
   '{"summary": "הלקוח יחליט אם להחליף את המכשיר"}', null),
  ('c0000000-0000-4000-8000-00000000f003', 'sku_change', 'canary.sim-event.f003', 'c0000000-0000-4000-8000-00000000a004',
   null, 'invitation', 'canary:sim-event:f003', null, null, '{"sku": "CNRY-SKU-9"}', '{"sku": "CNRY-SKU-2"}', null),
  ('c0000000-0000-4000-8000-00000000f004', 'reassignment', 'canary.sim-event.f004', 'c0000000-0000-4000-8000-00000000a004',
   'c0000000-0000-4000-8000-00000000b006', 'invitation', 'canary:sim-event:f004', null, null,
   '{"technician": "טכנאי קנרית אחר"}', '{"technician": "טכנאי קנרית"}', '{"technician": "טכנאי קנרית"}');

-- Two decisions by the Manager (t12 sets resolved_at): the second departure report accepted
-- (D14 note: the visit is server-closed), and the edit conflict decided per field.
update public.review_items
set status = 'resolved', resolved_by = 'c0000000-0000-4000-8000-000000001001', resolution = 'apply_incoming',
    resolution_note = 'דיווח היציאה השני אושר לבדיקה', updated_by = 'c0000000-0000-4000-8000-000000001001'
where id = 'c0000000-0000-4000-8000-00000000f001';
update public.review_items
set status = 'resolved', resolved_by = 'c0000000-0000-4000-8000-000000001001', resolution = 'per_field',
    resolution_choices = '{"summary": "current"}', resolution_note = 'נשאר הסיכום שבשרת',
    updated_by = 'c0000000-0000-4000-8000-000000001001'
where id = 'c0000000-0000-4000-8000-00000000f002';

-- D14 corrections by the Manager (t16 sets recorded_at): the arrival time and the summary of b002
-- (versions 4 -> 5 -> 6), the continuation reason of b001 and the next-visit notes of b003.
insert into public.visit_corrections (id, visit_id, field, old_value, new_value, reason, version_before, version_after,
                                      corrected_by)
values
  ('c0000000-0000-4000-8000-00000000f101', 'c0000000-0000-4000-8000-00000000b002', 'arrived',
   '"2026-01-22T08:05:00+00:00"', '"2026-01-22T08:00:00+00:00"', 'שעת ההגעה תוקנה לפי יומן הרכב', 4, 5,
   'c0000000-0000-4000-8000-000000001001'),
  ('c0000000-0000-4000-8000-00000000f102', 'c0000000-0000-4000-8000-00000000b002', 'summary',
   '"הוחלף החלק.\nהמכשיר נבדק ופועל."', '"הוחלף החלק.\nהמכשיר נבדק ופועל.\nתיקון קנרית."',
   'השלמת סיכום', 5, 6, 'c0000000-0000-4000-8000-000000001001'),
  ('c0000000-0000-4000-8000-00000000f103', 'c0000000-0000-4000-8000-00000000b001', 'followup_reason',
   '"c0000000-0000-4000-8000-000000008001"', '"c0000000-0000-4000-8000-000000008002"', 'סיבת ההמשך עודכנה', 1, 2,
   'c0000000-0000-4000-8000-000000001001'),
  ('c0000000-0000-4000-8000-00000000f104', 'c0000000-0000-4000-8000-00000000b003', 'next_visit_notes',
   '"ממתין להחלטת לקוח"', '"ממתין להחלטת לקוח עד סוף החודש"', 'פירוט הערה לביקור הבא', 1, 2,
   'c0000000-0000-4000-8000-000000001001');

-- The two kinds of correction rows of a field time (D45): the accepted second departure report of
-- f001 (reported by the Technician on his device, credited to him, his operation id) and the
-- corrected arrival of f101 (recorded by the Manager).
insert into public.visit_time_reports (id, visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id, correction_id,
                                       accepted_review_id)
overriding system value
values
  (1000005, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001002',
   'c0000000-0000-4000-8000-000000002001', 'departed', '2026-01-22 07:31:00+00', 'Asia/Jerusalem', 120,
   '2026-01-22 07:36:00+00', 'correction', 'c0000000-0000-4000-8000-00000000f202', null,
   'c0000000-0000-4000-8000-00000000f001'),
  (1000006, 'c0000000-0000-4000-8000-00000000b002', 'c0000000-0000-4000-8000-000000001001',
   'c0000000-0000-4000-8000-000000002001', 'arrived', '2026-01-22 08:00:00+00', null, null, null, 'correction', null,
   'c0000000-0000-4000-8000-00000000f101', null);

-- Offline operations of the Technician (t35 sets received_at): an applied time report on b006 and
-- the two operations stored for review (f001, f002).
insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256,
                                       expected_field_version, device_sent_at, device_tz, device_utc_offset_min, result,
                                       resulting_field_version, review_item_id)
values
  ('c0000000-0000-4000-8000-00000000f201', 'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000b006',
   'time_report', '0b5c0b8a6e2f3e1f4c0d9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d', 1, '2026-02-02 07:40:00+00',
   'Asia/Jerusalem', 120, 'applied', 1, null),
  ('c0000000-0000-4000-8000-00000000f202', 'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000b002',
   'time_report', '1c6d1c9b7f3a4f2a5d1eab9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e', 2, '2026-01-22 07:36:00+00',
   'Asia/Jerusalem', 120, 'review', 2, 'c0000000-0000-4000-8000-00000000f001'),
  ('c0000000-0000-4000-8000-00000000f203', 'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000b003',
   'summary', '2d7e2dac8a4b5a3b6e2fbcad9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f', 1, '2026-01-21 12:05:00+00',
   'Asia/Jerusalem', 120, 'review', 1, 'c0000000-0000-4000-8000-00000000f002');
