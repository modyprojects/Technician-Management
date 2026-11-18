-- Step 4 (Version 1), Migration 7: the technician's field writers, visit media and the Storage
-- policies of the private bucket 'visit-media' (D14, D36, D38, D43, D45, D46, D47, D60 (2); QA T-02,
-- T-03, T-09; docs/testing.md categories 2, 3, 4, 5, 8, 10 and 13). Covered, per caller (Technician
-- A, Technician B, a Manager, Customer Service, the Creator, a deactivated Technician, no JWT, anon,
-- service_role): ownership (only the visit's current technician; every other caller the generic
-- 42501), the allowed transitions only (M7 OQ-1; a closed visit is read-only to the technician, D14),
-- the field version (PT409), the input (22023), the operation id (a replay returns the stored
-- outcome, another payload 23505, a second submission with another id 55000: one closure, T-09),
-- the effects in one transaction (status, status event with actor and operation, device time
-- reports credited to the reporter, summary, signature with the fixed Version 1 text, its hash and
-- the stored image, the call status per D38, the stored operation) and the deferred constraint
-- triggers passing (set constraints all immediate); the media rows (kinds, types, sizes, the
-- test/ path, the cap, the replay, the object check); the storage.objects policies (INSERT only at
-- the technician's own pending path, no UPDATE or DELETE, SELECT for him and office users with card).
-- Mechanics as tests/db/240: each scenario runs in a subtransaction that is always undone
-- (tm_run_as), as the role under test with its JWT claims; its effects are read back as postgres.
-- Fictional, test-marked fixtures only (example.test, automated_test; D47).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_run_as: p_setup runs first as postgres (matrix changes, a deactivation, a relaxed CHECK), then
-- p_sql runs as p_role with the JWT claims of p_sub (none when NULL), then p_probe runs as postgres
-- and returns one text value ('ok' without a probe). Everything is undone. An error returns its
-- SQLSTATE and the constraint name, the column (23502) or the message.
create function pg_temp.tm_run_as(p_setup text, p_sub uuid, p_role text, p_sql text, p_probe text default null)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
  v_column text;
  v_message text;
  v_result text;
begin
  begin
    begin
      if p_setup is not null then
        execute p_setup;
      end if;
      perform set_config('request.jwt.claims',
        case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
      if p_role <> 'postgres' then
        execute 'set local role ' || quote_ident(p_role);
      end if;
      execute p_sql;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if p_probe is null then
        v_result := 'ok';
      else
        execute p_probe into v_result;
      end if;
      set constraints all deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name,
        v_column = column_name, v_message = message_text;
      return v_state || ' ' || case when v_state = '23502' then v_column
                                    else coalesce(nullif(v_constraint, ''), v_message) end;
    end;
    raise exception using errcode = 'TM001', message = coalesce(v_result, '<null>');
  exception when sqlstate 'TM001' then
    get stacked diagnostics v_message = message_text;
    return v_message;
  end;
end
$f$;
create function pg_temp.tm_as(p_sub uuid, p_sql text, p_probe text default null)
returns text
language sql
as $f$ select pg_temp.tm_run_as(null, p_sub, 'authenticated', p_sql, p_probe) $f$;
create function pg_temp.tm_try(p_sql text, p_probe text default null)
returns text
language sql
as $f$ select pg_temp.tm_run_as(null, null, 'postgres', p_sql, p_probe) $f$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures: the real Creator c1, Manager a1, Customer Service b1, Technicians A (d1, e1) and B (d2,
-- e2), and Technician d3 (e3, deactivated in one case). Call K (R-3601) has visit f1 (scheduled, A)
-- and visit f2 (scheduled, B); call L (R-3602) has visit f3 (scheduled, A); call M (R-3603) has
-- visit f4 (in progress, A). The private bucket 'visit-media' (on a project: a separate
-- owner-approved operation) is created here for the Storage cases.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000360' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user360-' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'b1', 'd1', 'd2', 'd3']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000360c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000360a1', 'manager', 'מנהל בדיקה', true, true),
  ('00000000-0000-4000-8000-0000000360b1', 'customer_service', 'נציגה בדיקה', true, true),
  ('00000000-0000-4000-8000-0000000360d1', 'technician', 'טכנאי א', true, true),
  ('00000000-0000-4000-8000-0000000360d2', 'technician', 'טכנאי ב', true, true),
  ('00000000-0000-4000-8000-0000000360d3', 'technician', 'טכנאי ג', true, true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000360e1', '00000000-0000-4000-8000-0000000360d1', true, 'טכנאי א', 't-y', 'tech360-a@example.test'),
  ('00000000-0000-4000-8000-0000000360e2', '00000000-0000-4000-8000-0000000360d2', true, 'טכנאי ב', 't-e', 'tech360-b@example.test'),
  ('00000000-0000-4000-8000-0000000360e3', '00000000-0000-4000-8000-0000000360d3', true, 'טכנאי ג', 't-s', 'tech360-c@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-0000000360c0', 'C-3601', 'לקוח בדיקה', '050-000-3601', 'automated_test', 'm7-360');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-0000000360e0', 'kt-3601', 'KT-3601', 'מוצר בדיקה', 'automated_test', 'm7-360');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
select x.id::uuid, x.req, '00000000-0000-4000-8000-0000000360c0', '00000000-0000-4000-8000-0000000360e0',
       (select c.id from public.call_types c where c.sort_order = 1), 'תקלת בדיקה', 'נציג בדיקה', 'open', x.nxt,
       'automated_test', 'm7-360-' || x.req
from (values ('00000000-0000-4000-8000-0000000360aa', 'R-3601', 3), ('00000000-0000-4000-8000-0000000360ab', 'R-3602', 2),
             ('00000000-0000-4000-8000-0000000360ac', 'R-3603', 2)) as x (id, req, nxt);
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref) values
  ('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-0000000360aa', '00000000-0000-4000-8000-0000000360e1',
   1, 'K1', now(), now() + interval '1 hour', 'scheduled', 'עיר', 'רחוב 1', 'm7-360-f1'),
  ('00000000-0000-4000-8000-0000000360f2', '00000000-0000-4000-8000-0000000360aa', '00000000-0000-4000-8000-0000000360e2',
   2, 'K2', now(), now() + interval '1 hour', 'scheduled', 'עיר', 'רחוב 2', 'm7-360-f2'),
  ('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-0000000360ab', '00000000-0000-4000-8000-0000000360e1',
   1, 'L1', now(), now() + interval '1 hour', 'scheduled', 'עיר', 'רחוב 3', 'm7-360-f3'),
  ('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-0000000360ac', '00000000-0000-4000-8000-0000000360e1',
   1, 'M1', now(), now() + interval '1 hour', 'in_progress', 'עיר', 'רחוב 4', 'm7-360-f4');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'm7-360-%';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-media', 'visit-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;

-- The fixed Version 1 approval text's hash (M7 OQ-2) and a full "טופל" closure of visit f3 by
-- Technician A as one block: depart, arrive, a signature image (its object stored through the
-- INSERT policy as A), confirm, close. pg_temp.tm_done(op) returns that SQL with the closure's
-- operation id op.
create function pg_temp.tm_sha() returns text language sql as
$f$ select encode(sha256(convert_to('קריאת השירות טופלה לשביעות רצון הלקוח', 'UTF8')), 'hex') $f$;
create function pg_temp.tm_done(p_close_op text, p_extra text default '') returns text language sql as $f$
select format($b$do $d$ declare m uuid; p text; begin
  perform * from public.depart_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036011', 1, now(), 'Asia/Jerusalem', 120, now());
  perform * from public.arrive_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036012', 2, now(), 'Asia/Jerusalem', 120, now());
  select out_media_id, out_storage_path into m, p from public.add_visit_media('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036013', 'signature', null, 'image/png', 120, now(), 'Asia/Jerusalem', 120, now());
  insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 120, 'mimetype', 'image/png'));
  perform * from public.confirm_visit_media(m);
  perform * from public.close_visit('00000000-0000-4000-8000-0000000360f3', %L, 3, 'done', 'הוחלפה משאבה', 'ישראל ישראלי', %L, m, null, null, now(), 'Asia/Jerusalem', 120, now());
  %s
end $d$; set constraints all immediate$b$, p_close_op, pg_temp.tm_sha(), p_extra)
$f$;

-- ---------------------------------------------------------------------------------------------
-- 1. Departure and arrival
-- ---------------------------------------------------------------------------------------------
select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now() - interval '1 minute', 'Asia/Jerusalem', 120, now()); set constraints all immediate$s$,
    $p$select v.status || ' fv' || v.field_version
       || ' ev' || (select count(*) from public.visit_events e where e.visit_id = v.id and e.event_type = 'status_changed'
                      and e.from_status = 'scheduled' and e.to_status = 'en_route'
                      and e.actor_profile_id = '00000000-0000-4000-8000-0000000360d1' and e.operation_id = '00000000-0000-4000-8000-000000036001')
       || ' tr' || (select count(*) from public.visit_time_reports r where r.visit_id = v.id and r.kind = 'departed' and r.source = 'device'
                      and r.technician_id = '00000000-0000-4000-8000-0000000360e1' and r.reported_by_profile_id = '00000000-0000-4000-8000-0000000360d1'
                      and r.received_at > r.reported_at and r.is_test)
       || ' op ' || (select o.op_type || '/' || o.result || '/' || o.expected_field_version || '>' || o.resulting_field_version
                     from public.offline_operations o where o.operation_id = '00000000-0000-4000-8000-000000036001')
       || ' call ' || (select c.status from public.service_calls c where c.id = '00000000-0000-4000-8000-0000000360aa')
       from public.visits v where v.id = '00000000-0000-4000-8000-0000000360f1'$p$),
  'en_route fv2 ev1 tr1 op time_report/applied/1>2 call open',
  'depart_visit: scheduled -> en_route, its status event (actor, operation), the device departure time credited to the reporter, the stored operation; the call stays open; the deferred checks pass');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$do $d$ declare r record; begin
       perform * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
       select * into r from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
       if not r.out_replay or r.out_status <> 'en_route' or r.out_field_version <> 2 then raise exception 'bad replay %', r; end if;
     end $d$$s$,
    $p$select (select count(*) from public.visit_events e where e.visit_id = '00000000-0000-4000-8000-0000000360f1' and e.event_type = 'status_changed')
       || ' ' || (select count(*) from public.visit_time_reports r where r.visit_id = '00000000-0000-4000-8000-0000000360f1')$p$),
  '1 1',
  'D46: a replay of the same operation returns the stored outcome and writes nothing more');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
       select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, '2026-11-17 08:05+02', 'Asia/Jerusalem', 120, '2026-11-17 08:06+02')$s$),
  '23505 offline_operations: the operation id was already used for another payload',
  'D46: the same operation id with another payload is refused');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now(), 'Asia/Jerusalem', 120, now());
       select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036002', 2, now(), 'Asia/Jerusalem', 120, now())$s$),
  '55000 invalid status change',
  'a second departure with another operation id is refused: the visit is no longer scheduled');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.arrive_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036002', 1, now(), 'Asia/Jerusalem', 120, now())$s$),
  '55000 invalid status change',
  'OQ-1: no skip: a scheduled visit cannot be arrived at before its departure');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now(), 'Asia/Jerusalem', 120, now());
       select * from public.arrive_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036002', 2, now(), 'Asia/Jerusalem', 120, now());
       set constraints all immediate$s$,
    $p$select v.status || ' fv' || v.field_version || ' ' || (select string_agg(r.kind, ',' order by r.id) from public.visit_time_reports r where r.visit_id = v.id)
       from public.visits v where v.id = '00000000-0000-4000-8000-0000000360f1'$p$),
  'in_progress fv3 departed,arrived',
  'arrive_visit: en_route -> in_progress with the device arrival time; the deferred checks pass');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 7, now(), 'Asia/Jerusalem', 120, now())$s$),
  'PT409 version conflict',
  'a departure based on a stale field version is refused (the visit changed since the device read it)');

select results_eq(
  $q$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', x.sql)
      from (values
        ('no operation id', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', null, 1, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('bad time zone', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now(), 'Asia/Jerusalem; drop', 120, now())$s$),
        ('offset out of range', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now(), 'Asia/Jerusalem', 900, now())$s$),
        ('infinite time', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, 'infinity', 'Asia/Jerusalem', 120, now())$s$),
        ('no device time', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, null, 'Asia/Jerusalem', 120, now())$s$)
      ) as x (label, sql) $q$,
  $q$ values ('no operation id', '22023 invalid input'), ('bad time zone', '22023 invalid input'), ('offset out of range', '22023 invalid input'),
             ('infinite time', '22023 invalid input'), ('no device time', '22023 invalid input') $q$,
  'malformed input is refused (22023), D45 device values included');

-- ---------------------------------------------------------------------------------------------
-- 2. Ownership: only the visit's current technician, every other caller the generic 42501
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $q$ select x.label, pg_temp.tm_run_as(x.setup, x.sub::uuid, x.role,
        $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 1, now(), 'Asia/Jerusalem', 120, now())$s$)
      from (values
        ('Technician B', null, '00000000-0000-4000-8000-0000000360d2', 'authenticated'),
        ('Manager', null, '00000000-0000-4000-8000-0000000360a1', 'authenticated'),
        ('Customer Service', null, '00000000-0000-4000-8000-0000000360b1', 'authenticated'),
        ('Creator', null, '00000000-0000-4000-8000-0000000360c1', 'authenticated'),
        ('deactivated Technician A', $u$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000360d1'$u$,
         '00000000-0000-4000-8000-0000000360d1', 'authenticated'),
        ('no JWT', null, null, 'authenticated'),
        ('anon', null, null, 'anon'),
        ('service_role', null, null, 'service_role')
      ) as x (label, setup, sub, role) $q$,
  $q$ values ('Technician B', '42501 not authorized'), ('Manager', '42501 not authorized'), ('Customer Service', '42501 not authorized'),
             ('Creator', '42501 not authorized'), ('deactivated Technician A', '42501 not authorized'), ('no JWT', '42501 not authorized'),
             ('anon', '42501 permission denied for function depart_visit'),
             ('service_role', '42501 permission denied for function depart_visit') $q$,
  'only the visit''s current technician may depart: another technician, office roles, the Creator, a deactivated account, no JWT, anon and service_role are refused');

select is(
  pg_temp.tm_run_as(
    $u$update public.visits set technician_id = '00000000-0000-4000-8000-0000000360e2' where id = '00000000-0000-4000-8000-0000000360f1'$u$,
    '00000000-0000-4000-8000-0000000360d1', 'authenticated',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036001', 2, now(), 'Asia/Jerusalem', 120, now())$s$),
  '42501 not authorized',
  'a re-assigned visit is no longer the former technician''s (D36 revocation on the server)');

select results_eq(
  $q$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', x.sql)
      from (values
        ('update visits', $s$update public.visits set status = 'en_route' where id = '00000000-0000-4000-8000-0000000360f1'$s$),
        ('insert visit_media', $s$insert into public.visit_media (visit_id, kind, phase, storage_path, mime_type, size_bytes, state, captured_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, created_by) values ('00000000-0000-4000-8000-0000000360f4', 'photo', 'before', 'test/00000000-0000-4000-8000-0000000360f4/00000000-0000-4000-8000-0000000360ff.jpg', 'image/jpeg', 1, 'pending', now(), 'Asia/Jerusalem', 120, now(), '00000000-0000-4000-8000-0000000360fe', '00000000-0000-4000-8000-0000000360d1')$s$),
        ('insert visit_reports', $s$insert into public.visit_reports (visit_id, summary_text, summary_source) values ('00000000-0000-4000-8000-0000000360f4', 'x', 'written')$s$)
      ) as x (label, sql) $q$,
  $q$ values ('update visits', '42501 permission denied for table visits'),
             ('insert visit_media', '42501 permission denied for table visit_media'),
             ('insert visit_reports', '42501 permission denied for table visit_reports') $q$,
  'no direct writes: the technician changes a visit only through the writers');

-- ---------------------------------------------------------------------------------------------
-- 3. The closure
-- ---------------------------------------------------------------------------------------------
select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', pg_temp.tm_done('00000000-0000-4000-8000-000000036014'),
    $p$select v.status || ' closed:' || (v.closed_at is not null)
       || ' call ' || c.status || ' resolved:' || (c.resolved_at = v.closed_at)
       || ' report:' || (select r.summary_text || '/' || r.summary_source from public.visit_reports r where r.visit_id = v.id)
       || ' sig:' || (select s.signer_name || '/' || (s.signed_ack_text = 'קריאת השירות טופלה לשביעות רצון הלקוח') || '/' || (s.ack_text_sha256 = pg_temp.tm_sha())
                       || '/' || (s.signature_media_id = m.id) || '/' || s.is_test from public.visit_signatures s where s.visit_id = v.id)
       || ' media:' || m.state || '/' || m.kind || '/' || (m.storage_path like 'test/00000000-0000-4000-8000-0000000360f3/%.png')
       || ' times:' || (select string_agg(t.kind, ',' order by t.id) from public.visit_time_reports t where t.visit_id = v.id)
       || ' events:' || (select string_agg(e.to_status, ',' order by e.id) from public.visit_events e where e.visit_id = v.id)
       || ' ops:' || (select count(*) from public.offline_operations o where o.visit_id = v.id)
       from public.visits v join public.service_calls c on c.id = v.service_call_id
       join public.visit_media m on m.visit_id = v.id
       where v.id = '00000000-0000-4000-8000-0000000360f3'$p$),
  'done closed:true call resolved resolved:true report:הוחלפה משאבה/written sig:ישראל ישראלי/true/true/true/true media:stored/signature/true times:departed,arrived,ended,signed events:scheduled,en_route,in_progress,done ops:4',
  '"טופל": summary, signature with the fixed Version 1 text, its hash and the stored image, end and signing times, status events, the call resolved in the same transaction (D38); the deferred checks pass');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    pg_temp.tm_done('00000000-0000-4000-8000-000000036014',
      $x$perform * from public.close_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036014', 3, 'done', 'הוחלפה משאבה', 'ישראל ישראלי', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', m, null, null, now(), 'Asia/Jerusalem', 120, now());$x$),
    $p$select (select count(*) from public.visit_signatures where visit_id = '00000000-0000-4000-8000-0000000360f3')
       || ' ' || (select count(*) from public.visit_reports where visit_id = '00000000-0000-4000-8000-0000000360f3')$p$),
  '1 1',
  'D46, T-09: the same closure sent again (same operation, same payload) is a replay: one signature and one summary');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    pg_temp.tm_done('00000000-0000-4000-8000-000000036014',
      $x$perform * from public.close_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036015', 3, 'done', 'הוחלפה משאבה', 'ישראל ישראלי', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', m, null, null, now(), 'Asia/Jerusalem', 120, now());$x$)),
  '55000 invalid status change',
  'T-09: a double submission with another operation id is refused; the visit is closed once');

select results_eq(
  $q$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', pg_temp.tm_done('00000000-0000-4000-8000-000000036014', x.sql))
      from (values
        ('depart a closed visit', $x$perform * from public.depart_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036021', 4, now(), 'Asia/Jerusalem', 120, now());$x$),
        ('arrive at a closed visit', $x$perform * from public.arrive_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036021', 4, now(), 'Asia/Jerusalem', 120, now());$x$),
        ('add a photo to a closed visit', $x$perform * from public.add_visit_media('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036021', 'photo', 'after', 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now());$x$),
        ('close it as follow-up', $x$perform * from public.close_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036021', 4, 'followup', 'סיכום', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', now(), 'Asia/Jerusalem', 120, now());$x$)
      ) as x (label, sql) $q$,
  $q$ values ('depart a closed visit', '55000 invalid status change'), ('arrive at a closed visit', '55000 invalid status change'),
             ('add a photo to a closed visit', '55000 invalid status change'), ('close it as follow-up', '55000 invalid status change') $q$,
  'D14: a closed visit is read-only to the technician (every writer refuses it)');

select results_eq(
  $q$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', x.sql)
      from (values
        ('no signature image', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'done', 'סיכום', 'חותם', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', null, null, null, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('no signer', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'done', 'סיכום', ' ', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', '00000000-0000-4000-8000-0000000360ee', null, null, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('wrong approval-text hash', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'done', 'סיכום', 'חותם', repeat('0', 64), '00000000-0000-4000-8000-0000000360ee', null, null, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('unknown signature image', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'done', 'סיכום', 'חותם', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', '00000000-0000-4000-8000-0000000360ee', null, null, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('no summary', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'followup', '', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', now(), 'Asia/Jerusalem', 120, now())$s$),
        ('summary breaks its text rule', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'followup', ' סיכום', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', now(), 'Asia/Jerusalem', 120, now())$s$),
        ('follow-up without notes', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'followup', 'סיכום', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), null, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('follow-up with an unknown reason', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'followup', 'סיכום', null, null, null, '00000000-0000-4000-8000-0000000360ee', 'להביא חלק', now(), 'Asia/Jerusalem', 120, now())$s$),
        ('follow-up with a signature', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'followup', 'סיכום', 'חותם', null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', now(), 'Asia/Jerusalem', 120, now())$s$),
        ('unknown outcome', $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036031', 1, 'cancelled', 'סיכום', null, null, null, null, null, now(), 'Asia/Jerusalem', 120, now())$s$)
      ) as x (label, sql) $q$,
  $q$ values ('no signature image', '22023 invalid input'), ('no signer', '22023 invalid input'), ('wrong approval-text hash', '22023 invalid input'),
             ('unknown signature image', '22023 invalid input'), ('no summary', '22023 invalid input'),
             ('summary breaks its text rule', '22023 invalid input'), ('follow-up without notes', '22023 invalid input'),
             ('follow-up with an unknown reason', '22023 invalid input'), ('follow-up with a signature', '22023 invalid input'),
             ('unknown outcome', '22023 invalid input') $q$,
  'T-09, OQ-2, OQ-3: the mandatory fields of each outcome are checked on the server (22023, no detail)');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036032', 1, 'followup', 'נדרש חלק חילוף', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא משאבה', now(), 'Asia/Jerusalem', 120, now());
       set constraints all immediate$s$,
    $p$select v.status || ' ' || (select r.sort_order from public.followup_reasons r where r.id = v.followup_reason_id) || ' ' || v.next_visit_notes
       || ' call ' || c.status || ' resolved_at:' || coalesce(c.resolved_at::text, 'null')
       || ' sigs:' || (select count(*) from public.visit_signatures s where s.visit_id = v.id)
       || ' times:' || (select string_agg(t.kind, ',') from public.visit_time_reports t where t.visit_id = v.id)
       from public.visits v join public.service_calls c on c.id = v.service_call_id where v.id = '00000000-0000-4000-8000-0000000360f4'$p$),
  'followup 1 להביא משאבה call awaiting_followup resolved_at:null sigs:0 times:ended',
  'T-03, D60 (2): "המשך טיפול" completes the visit with its reason and next-visit notes; the call stays open for follow-up (D38); the deferred checks pass');

select is(
  pg_temp.tm_run_as(
    $u$update public.visits set technician_id = '00000000-0000-4000-8000-0000000360e2' where id = '00000000-0000-4000-8000-0000000360f4'$u$,
    '00000000-0000-4000-8000-0000000360d1', 'authenticated',
    $s$select * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036032', 2, 'followup', 'סיכום', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'הערה', now(), 'Asia/Jerusalem', 120, now())$s$),
  '42501 not authorized',
  'a visit re-assigned while in progress cannot be closed by the former technician');

-- ---------------------------------------------------------------------------------------------
-- 4. Media and the Storage policies
-- ---------------------------------------------------------------------------------------------
select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036041', 'photo', 'before', 'image/jpeg', 2048, now(), 'Asia/Jerusalem', 120, now());
       select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036042', 'photo', 'after', 'image/webp', 10, now(), 'Asia/Jerusalem', 120, now())$s$,
    $p$select string_agg(m.kind || '/' || m.phase || '/' || m.state || '/' || m.is_test || '/' || (m.storage_path ~ ('^test/00000000-0000-4000-8000-0000000360f4/' || m.id || '\.(jpg|webp)$')), ' ' order by m.size_bytes desc)
       from public.visit_media m where m.visit_id = '00000000-0000-4000-8000-0000000360f4'$p$),
  'photo/before/pending/true/true photo/after/pending/true/true',
  'add_visit_media: a pending, test-marked row under test/<visit>/<id>.<ext> (D47, OQ-5)');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$do $d$ declare r1 record; r2 record; begin
       select * into r1 from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036041', 'photo', 'before', 'image/jpeg', 2048, '2026-11-17 09:00+02', 'Asia/Jerusalem', 120, '2026-11-17 09:01+02');
       select * into r2 from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036041', 'photo', 'before', 'image/jpeg', 2048, '2026-11-17 09:00+02', 'Asia/Jerusalem', 120, '2026-11-17 09:01+02');
       if not r2.out_replay or r2.out_media_id <> r1.out_media_id or r2.out_storage_path <> r1.out_storage_path then raise exception 'bad replay'; end if;
     end $d$$s$,
    $p$select count(*)::text from public.visit_media m where m.visit_id = '00000000-0000-4000-8000-0000000360f4'$p$),
  '1',
  'D46: a replayed media operation returns the same row and path');

select results_eq(
  $q$ select x.label, pg_temp.tm_run_as(x.setup, x.sub::uuid, 'authenticated', x.sql)
      from (values
        ('a photo of a scheduled visit', null, '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('another technician''s visit', null, '00000000-0000-4000-8000-0000000360d2', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('a JPEG signature', null, '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'signature', null, 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('a photo without a phase', null, '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', null, 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('a GIF', null, '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/gif', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('more than 10 MiB', null, '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/jpeg', 10485761, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('the 31st media row', $u$insert into public.visit_media (visit_id, kind, phase, storage_path, mime_type, size_bytes, state, captured_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, created_by)
            select '00000000-0000-4000-8000-0000000360f4', 'photo', 'after', 'test/00000000-0000-4000-8000-0000000360f4/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1, 'pending', now(), 'Asia/Jerusalem', 120, now(), gen_random_uuid(), '00000000-0000-4000-8000-0000000360d1' from generate_series(1, 30)$u$,
         '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$),
        ('a Manager', null, '00000000-0000-4000-8000-0000000360a1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036043', 'photo', 'before', 'image/jpeg', 10, now(), 'Asia/Jerusalem', 120, now())$s$)
      ) as x (label, setup, sub, sql) $q$,
  $q$ values ('a photo of a scheduled visit', '55000 invalid status change'), ('another technician''s visit', '42501 not authorized'),
             ('a JPEG signature', '22023 invalid input'), ('a photo without a phase', '22023 invalid input'), ('a GIF', '22023 invalid input'),
             ('more than 10 MiB', '22023 invalid input'), ('the 31st media row', '55000 media limit reached'), ('a Manager', '42501 not authorized') $q$,
  'OQ-4: media only for his visit in progress, the kinds, types, sizes and the per-visit cap');

select results_eq(
  $q$ select x.label, pg_temp.tm_as(x.sub::uuid, format($b$do $d$ declare m uuid; p text; begin
         select out_media_id, out_storage_path into m, p from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036051', 'photo', 'after', 'image/jpeg', 300, now(), 'Asia/Jerusalem', 120, now());
         %s
       end $d$$b$, x.step))
      from (values
        ('confirm before the upload', '00000000-0000-4000-8000-0000000360d1', $x$perform * from public.confirm_visit_media(m);$x$),
        ('upload with another size, then confirm', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 301, 'mimetype', 'image/jpeg')); perform * from public.confirm_visit_media(m);$x$),
        ('upload, confirm twice', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 300, 'mimetype', 'image/jpeg')); perform * from public.confirm_visit_media(m); if (select out_state from public.confirm_visit_media(m)) <> 'stored' then raise exception 'not stored'; end if;$x$),
        ('upload to another path', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('visit-media', 'test/00000000-0000-4000-8000-0000000360f4/x.jpg', '{}');$x$),
        ('upload to another bucket', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('other', p, '{}');$x$),
        ('replace the stored object', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 300, 'mimetype', 'image/jpeg')); perform * from public.confirm_visit_media(m); update storage.objects set metadata = '{}' where name = p; if found then raise exception 'updated'; end if;$x$),
        ('delete the stored object', '00000000-0000-4000-8000-0000000360d1', $x$insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 300, 'mimetype', 'image/jpeg')); delete from storage.objects where name = p; if found then raise exception 'deleted'; end if;$x$)
      ) as x (label, sub, step) $q$,
  $q$ values ('confirm before the upload', '55000 the object is not stored'), ('upload with another size, then confirm', '55000 the object is not stored'),
             ('upload, confirm twice', 'ok'), ('upload to another path', '42501 new row violates row-level security policy for table "objects"'),
             ('upload to another bucket', '42501 new row violates row-level security policy for table "objects"'),
             ('replace the stored object', 'ok'),
             ('delete the stored object', '42501 Direct deletion from storage tables is not allowed. Use the Storage API instead.') $q$,
  'OQ-5, OQ-6: the object is stored only at the technician''s own pending path; a row is stored once its object matches; no update through the API (no policy: nothing changes) and no delete (Storage refuses it)');

select results_eq(
  $q$ select x.label, pg_temp.tm_run_as(
        $u$insert into storage.objects (bucket_id, name, metadata) select 'visit-media', 'test/00000000-0000-4000-8000-0000000360f4/00000000-0000-4000-8000-0000000360dd.jpg', jsonb_build_object('size', 5, 'mimetype', 'image/jpeg');
           insert into public.visit_media (id, visit_id, kind, phase, storage_path, mime_type, size_bytes, state, captured_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, created_by)
           values ('00000000-0000-4000-8000-0000000360dd', '00000000-0000-4000-8000-0000000360f4', 'photo', 'after', 'test/00000000-0000-4000-8000-0000000360f4/00000000-0000-4000-8000-0000000360dd.jpg', 'image/jpeg', 5, 'pending', now(), 'Asia/Jerusalem', 120, now(), '00000000-0000-4000-8000-0000000360dc', '00000000-0000-4000-8000-0000000360d1');
           update public.visit_media set state = 'stored' where id = '00000000-0000-4000-8000-0000000360dd';$u$ || coalesce(x.extra, ''),
        x.sub::uuid, x.role,
        $s$create temporary table if not exists tm_seen on commit drop as select 0 as n; delete from tm_seen;
           insert into tm_seen select (select count(*) from storage.objects o where o.bucket_id = 'visit-media')::int * 10
                                    + (select count(*) from public.visit_media m where m.visit_id = '00000000-0000-4000-8000-0000000360f4')::int$s$,
        $p$select n::text from tm_seen$p$)
      from (values
        ('Technician A', '00000000-0000-4000-8000-0000000360d1', 'authenticated', null),
        ('Technician B', '00000000-0000-4000-8000-0000000360d2', 'authenticated', null),
        ('Manager (card, cal)', '00000000-0000-4000-8000-0000000360a1', 'authenticated', null),
        ('Customer Service (card, cal)', '00000000-0000-4000-8000-0000000360b1', 'authenticated', null),
        ('Customer Service without card', '00000000-0000-4000-8000-0000000360b1', 'authenticated',
         $u$ update public.role_permissions set allowed = false where role = 'customer_service' and permission_key = 'card';$u$),
        ('Creator', '00000000-0000-4000-8000-0000000360c1', 'authenticated', null),
        ('anon', null, 'anon', null)
      ) as x (label, sub, role, extra) $q$,
  $q$ values ('Technician A', '11'), ('Technician B', '0'), ('Manager (card, cal)', '11'), ('Customer Service (card, cal)', '11'),
             ('Customer Service without card', '0'), ('Creator', '11'), ('anon', '42501 permission denied for table visit_media') $q$,
  'OQ-6: the stored object and its row are readable by the visit''s technician and by office users with card and (cal or calls); not by another technician, without card, or anonymously');

-- ---------------------------------------------------------------------------------------------
-- 5. Review fixes on real rows: a retry hashes the same (no device_sent_at, no TimeZone text), a
--    replay checks the ownership first, confirm_visit_media needs the visit in progress
-- ---------------------------------------------------------------------------------------------
select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$do $d$ declare r record; begin
       perform set_config('TimeZone', 'Asia/Jerusalem', true);
       perform * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036061', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
       perform set_config('TimeZone', 'America/New_York', true);
       select * into r from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036061', 1, '2026-11-17 06:00+00', 'Asia/Jerusalem', 120, '2026-11-17 08:20+02');
       if not r.out_replay or r.out_status <> 'en_route' or r.out_field_version <> 2 then raise exception 'bad replay %', r; end if;
     end $d$$s$,
    $p$select (select count(*) from public.visit_events e where e.visit_id = '00000000-0000-4000-8000-0000000360f1' and e.event_type = 'status_changed')
       || ' ' || (select count(*) from public.visit_time_reports r where r.visit_id = '00000000-0000-4000-8000-0000000360f1')
       || ' ' || (select o.device_sent_at = '2026-11-17 08:01+02' from public.offline_operations o where o.operation_id = '00000000-0000-4000-8000-000000036061')$p$),
  '1 1 true',
  'D46 (review fix): a retry of the same departure with a later device_sent_at, in another session TimeZone, is a replay (not 23505); the first delivery is kept');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', pg_temp.tm_done('00000000-0000-4000-8000-000000036062',
    $x$if not (select r.out_replay from public.close_visit('00000000-0000-4000-8000-0000000360f3', '00000000-0000-4000-8000-000000036062', 3, 'done', 'הוחלפה משאבה', 'ישראל ישראלי', 'ea91ad47a9f7df58d3077dc13bc979251392605aac92d729bbc31d1fe4ebf439', m, null, null, now(), 'Asia/Jerusalem', 120, now() + interval '3 minutes') r) then raise exception 'no replay'; end if;
       perform set_config('TimeZone', 'UTC', true);
       select out_media_id into m from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036063', 'photo', 'before', 'image/jpeg', 50, '2026-11-17 09:00+02', 'Asia/Jerusalem', 120, '2026-11-17 09:01+02');
       perform set_config('TimeZone', 'Asia/Tokyo', true);
       if (select r.out_media_id from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036063', 'photo', 'before', 'image/jpeg', 50, '2026-11-17 07:00+00', 'Asia/Jerusalem', 120, '2026-11-17 09:30+02') r) <> m then raise exception 'no media replay'; end if;$x$),
    $p$select (select count(*) from public.visit_signatures s where s.visit_id = '00000000-0000-4000-8000-0000000360f3')
       || ' ' || (select count(*) from public.visit_reports r where r.visit_id = '00000000-0000-4000-8000-0000000360f3')
       || ' ' || (select count(*) from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-0000000360f3' and t.kind in ('ended', 'signed'))
       || ' ' || (select count(*) from public.visit_media m where m.visit_id = '00000000-0000-4000-8000-0000000360f4')$p$),
  '1 1 2 1',
  'D46 (review fix): a retried closure and a retried media operation with a later device_sent_at (and another TimeZone) are replays: one signature, one summary, one media row');

select results_eq(
  $q$ select x.label, pg_temp.tm_run_as(
        $u$select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000360d1', 'role', 'authenticated')::text, true);
           set local role authenticated;
           select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036064', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
           select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036065', 'photo', 'before', 'image/jpeg', 10, '2026-11-17 09:00+02', 'Asia/Jerusalem', 120, '2026-11-17 09:01+02');
           reset role;
           update public.visits set technician_id = '00000000-0000-4000-8000-0000000360e2' where id in ('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-0000000360f4');$u$,
        x.sub::uuid, 'authenticated', x.sql)
      from (values
        ('A replays his departure', '00000000-0000-4000-8000-0000000360d1', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036064', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02')$s$),
        ('A replays his media row', '00000000-0000-4000-8000-0000000360d1', $s$select * from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036065', 'photo', 'before', 'image/jpeg', 10, '2026-11-17 09:00+02', 'Asia/Jerusalem', 120, '2026-11-17 09:01+02')$s$),
        ('B sends A''s departure', '00000000-0000-4000-8000-0000000360d2', $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036064', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02')$s$)
      ) as x (label, sub, sql) $q$,
  $q$ values ('A replays his departure', '42501 not authorized'), ('A replays his media row', '42501 not authorized'),
             ('B sends A''s departure', '42501 not authorized') $q$,
  'D36 (review fix): after re-assignment a replay of the former technician''s operation is refused (generic 42501), and the new technician cannot reuse it');

select results_eq(
  $q$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1', format($b$do $d$ declare m uuid; p text; begin
         select out_media_id, out_storage_path into m, p from public.add_visit_media('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036066', 'photo', 'after', 'image/jpeg', 300, now(), 'Asia/Jerusalem', 120, now());
         insert into storage.objects (bucket_id, name, metadata) values ('visit-media', p, jsonb_build_object('size', 300, 'mimetype', 'image/jpeg'));
         %s
         perform * from public.close_visit('00000000-0000-4000-8000-0000000360f4', '00000000-0000-4000-8000-000000036067', 1, 'followup', 'סיכום', null, null, null, (select r.id from public.followup_reasons r where r.sort_order = 1), 'הערה', now(), 'Asia/Jerusalem', 120, now());
         perform * from public.confirm_visit_media(m);
       end $d$; set constraints all immediate$b$, x.step),
       $p$select string_agg(m.state, ',') from public.visit_media m where m.visit_id = '00000000-0000-4000-8000-0000000360f4'$p$)
      from (values
        ('confirm after the closure', ''),
        ('confirmed before the closure, again after it', 'perform * from public.confirm_visit_media(m);')
      ) as x (label, step) $q$,
  $q$ values ('confirm after the closure', '55000 invalid status change'), ('confirmed before the closure, again after it', 'stored') $q$,
  'OQ-4 (review fix): a pending media row of a closed visit cannot become stored; a stored row still answers stored');

select is(
  pg_temp.tm_as('00000000-0000-4000-8000-0000000360d1',
    $s$select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036068', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 120, '2026-11-17 08:01+02');
       select * from public.depart_visit('00000000-0000-4000-8000-0000000360f1', '00000000-0000-4000-8000-000000036068', 1, '2026-11-17 08:00+02', 'Asia/Jerusalem', 60, '2026-11-17 08:01+02')$s$),
  '23505 offline_operations: the operation id was already used for another payload',
  'D46: the reported device values (here the UTC offset) stay in the hash: another value under the same id is still 23505');

select lives_ok('set constraints all immediate', 'nothing above left a pending deferred check');

select * from finish();
rollback;
