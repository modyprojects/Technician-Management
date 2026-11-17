-- Canary rows for migration 20261110120000_field_visit_writers.sql (Step 4, Version 1), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (D47: the call is 'simulator' data, so its
-- generated is_test is true; the visit, its summary, signature, status event and media rows copy
-- is_test = true from their parent in the triggers), no e-mail addresses, explicit ids; the one
-- identity id of visit_events uses OVERRIDING SYSTEM VALUE (1007001), so no sequence is consumed.
-- Inserted directly as postgres in one transaction, with every trigger and CHECK active; the
-- deferred constraint triggers of Migration 3 (c10 to c40) check the call, the visit, the summary
-- and the signature at COMMIT. No earlier row is changed; the only UPDATE moves the photo row added
-- here to its later state (a media row is created pending and stored once, t12).
--
-- Server times are set by the triggers: closed_at (t12 on visits) and the call's resolved_at take
-- the transaction's now() (as in the PR 1.5 fixture), and visit_media.received_at and stored_at
-- (t12 on visit_media). These are the only values that differ between canary runs.
--
-- The rows reference only canary rows of the earlier fixtures: the PR 1.3 Manager
-- (c0000000-0000-4000-8000-000000001001), the Technician profile ...1002 and technician ...2001; the
-- PR 1.4 customer ...6001, product ...5001 and call type ...7001. One resolved call a701 with its done
-- visit b701 (summary, signature with its image), a stored "before" photo d701 and the signature
-- image d702: every column of visit_media and the new visit_signatures.signature_media_id are
-- non-null in at least one row, so no coverage exception is needed.
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, resolved_at, data_source, source_ref,
                                  created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-00000000a701', 'CNRY-R-0701', 'c0000000-0000-4000-8000-000000006001',
   'c0000000-0000-4000-8000-000000005001', 'c0000000-0000-4000-8000-000000007001', 'תקלת קנרית לבדיקת שלב 4',
   'נציגת קנרית', 'resolved', 2, now(), 'simulator', 'canary:sim-event:a701', '2026-03-01 07:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-03-01 07:00:00+00', null, 1);

insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref, created_at, updated_at, version)
values
  ('c0000000-0000-4000-8000-00000000b701', 'c0000000-0000-4000-8000-00000000a701', 'c0000000-0000-4000-8000-000000002001',
   1, 'CNRY-T-0701', '2026-03-01 08:00:00+00', '2026-03-01 09:00:00+00', 'done', 'עיר בדיונית', 'רחוב הקנרית',
   'canary:sim-event:b701', '2026-03-01 07:00:00+00', '2026-03-01 07:00:00+00', 1);

insert into public.visit_events (id, visit_id, version_after, event_type, from_status, to_status, actor_profile_id,
                                 operation_id)
overriding system value
values
  (1007001, 'c0000000-0000-4000-8000-00000000b701', 1, 'created', null, 'done', null, null);

-- The photo (stored below) and the signature image (left pending: the writer stores it before a
-- closure; the canary covers both states).
insert into public.visit_media (id, visit_id, kind, phase, storage_path, mime_type, size_bytes, state, captured_at,
                                device_tz, device_utc_offset_min, device_sent_at, operation_id, created_by)
values
  ('c0000000-0000-4000-8000-00000000d701', 'c0000000-0000-4000-8000-00000000b701', 'photo', 'before',
   'test/c0000000-0000-4000-8000-00000000b701/c0000000-0000-4000-8000-00000000d701.jpg', 'image/jpeg', 2048, 'pending',
   '2026-03-01 08:20:00+00', 'Asia/Jerusalem', 120, '2026-03-01 08:21:00+00', 'c0000000-0000-4000-8000-00000000e701',
   'c0000000-0000-4000-8000-000000001002'),
  ('c0000000-0000-4000-8000-00000000d702', 'c0000000-0000-4000-8000-00000000b701', 'signature', null,
   'test/c0000000-0000-4000-8000-00000000b701/c0000000-0000-4000-8000-00000000d702.png', 'image/png', 512, 'pending',
   '2026-03-01 08:55:00+00', 'Asia/Jerusalem', 120, '2026-03-01 08:56:00+00', 'c0000000-0000-4000-8000-00000000e702',
   'c0000000-0000-4000-8000-000000001002');
update public.visit_media set state = 'stored' where id = 'c0000000-0000-4000-8000-00000000d701';

insert into public.visit_reports (visit_id, summary_text, summary_source, created_at, created_by, updated_at, updated_by,
                                  version)
values
  ('c0000000-0000-4000-8000-00000000b701', 'הוחלף חלק קנרית ונבדק', 'written', '2026-03-01 09:00:00+00',
   'c0000000-0000-4000-8000-000000001002', '2026-03-01 09:00:00+00', 'c0000000-0000-4000-8000-000000001002', 1);

-- The signature with its image (Migration 7) and the fixed Version 1 text with its sha256 (NFC,
-- UTF-8, D43).
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, created_at,
                                     created_by, signature_media_id)
values
  ('c0000000-0000-4000-8000-00000000b701', 'חותם קנרית', 'קריאת השירות טופלה לשביעות רצון הלקוח',
   'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', 'c0000000-0000-4000-8000-00000000e703',
   '2026-03-01 09:00:00+00', 'c0000000-0000-4000-8000-000000001002', 'c0000000-0000-4000-8000-00000000d702');
