-- PR 1.6: the server's idempotency record of device sync and the review-item store (D44, D45, D46;
-- docs/database-schema.md §4 "Migration 4", §10; docs/testing.md categories 5, 10 and 13; QA T-01,
-- T-09, X-06). Covered:
--   offline_operation_replay and record_offline_operation (no grant; the Step 4 device writers call
--   them): a new operation is recorded once with its final result (the actor is the session's user,
--   the receipt time the server's, the marker the visit's); a replay with the same id and payload
--   returns the stored result and applies nothing again; the same id with another payload, visit or
--   type is refused (23505), under another user too (42501, generic); the id is serialized for the
--   transaction (advisory lock); a stored operation never changes; an operation stored for review
--   names the review item of the same visit and operation.
--   create_review_item: one item per dedupe key (a retried submission returns the stored item, its
--   first versions kept); the same key for another item is refused; the submitter is the device
--   session's user, never a parameter; the contract of a second device report (PR 1.5 OQ-11).
-- Mechanics: a postgres-owned SECURITY DEFINER scratch writer in pg_temp (the shape of the Step 4
-- time-report writer: replay check, apply or store for review, record) is called by Technician B
-- with his JWT claims; the helpers are also called directly as postgres with claims set.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
-- Fixtures (local, rolled back; fictional, example.test, automated_test; D47): the real Creator
-- c1, Managers a1 and a2, Customer Service b1, Technicians A (d1, e1) and B (d2, e2), a signed-in
-- user f0 without a profile. Call K (R-2601, open) has visit 1 (done, Technician A, with its
-- summary, signature and device times), visit 2 (followup, Technician A), visit 3 (scheduled,
-- Technician B) and visit 4 (cancelled, Technician A). Every row is test data.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'a2', 'b1', 'd1', 'd2', 'f0']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000260c01', 'C-2601', 'לקוח בדיקה', '050-000-2601', 'automated_test', 'pr16-260');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000260d01', 'kt-2601', 'KT-2601', 'מוצר בדיקה', 'automated_test', 'pr16-260');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000260a01', 'R-2601', '00000000-0000-4000-8000-000000260c01',
        '00000000-0000-4000-8000-000000260d01', (select c.id from public.call_types c where c.sort_order = 1),
        'תקלת בדיקה', 'נציג בדיקה', 'open', 5, 'automated_test', 'pr16-260-k');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, followup_reason_id, next_visit_notes, source_ref) values
  ('00000000-0000-4000-8000-000000260b01', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-0000000000e1',
   1, 'K1', now() - interval '3 hours', now() - interval '2 hours', 'done', 'עיר בדיקה', 'רחוב הבדיקה 1', null, null, 'pr16-260-k1'),
  ('00000000-0000-4000-8000-000000260b02', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-0000000000e1',
   2, 'K2', now() - interval '2 hours', now() - interval '1 hour', 'followup', 'עיר בדיקה', 'רחוב הבדיקה 2',
   (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', 'pr16-260-k2'),
  ('00000000-0000-4000-8000-000000260b03', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-0000000000e2',
   3, 'K3', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 3', null, null,
   'pr16-260-k3'),
  ('00000000-0000-4000-8000-000000260b04', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-0000000000e1',
   4, 'K4', now() + interval '2 days', now() + interval '2 days 1 hour', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 4', null, null,
   'pr16-260-k4');
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  ('00000000-0000-4000-8000-000000260b01', 'הוחלף חלק', 'written'),
  ('00000000-0000-4000-8000-000000260b02', 'נדרש חלק', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-000000260b01', 'חותם בדיקה', 'נוסח בדיקה', encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'),
          '00000000-0000-4000-8000-000000260e00');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr16-260-k%';
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
select '00000000-0000-4000-8000-000000260b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
       x.kind, x.at, 'Asia/Jerusalem', 120, x.at + interval '1 minute', 'device', x.op::uuid
from (values ('departed', now() - interval '3 hours', '00000000-0000-4000-8000-000000260e01'),
             ('arrived', now() - interval '150 minutes', '00000000-0000-4000-8000-000000260e02'),
             ('ended', now() - interval '130 minutes', '00000000-0000-4000-8000-000000260e03')) as x (kind, at, op);
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;

-- The scratch device writer (pg_temp, postgres-owned SECURITY DEFINER, like every Step 4 writer):
-- a time report of the caller's own visit. A new operation is applied, or stored for review when
-- the visit already holds a device report of that kind (PR 1.5 OQ-11); a replay returns the stored
-- result. Returns 'applied', 'review' or 'replay <result> <resulting_field_version>'.
create function pg_temp.tm_device_time_report(p_op uuid, p_visit uuid, p_kind text, p_reported timestamptz, p_payload text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_sha text := encode(sha256(convert_to(p_payload, 'UTF8')), 'hex');
  v_op public.offline_operations;
  v_visit public.visits;
  v_item uuid;
  v_result text;
begin
  v_op := private.offline_operation_replay(p_op, p_visit, 'time_report', v_sha);
  if v_op.operation_id is not null then
    return 'replay ' || v_op.result || ' ' || v_op.resulting_field_version;
  end if;
  select v.* into v_visit from public.visits v
  where v.id = p_visit and v.technician_id = (select private.my_technician_id()) for update;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  begin
    insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                           device_utc_offset_min, device_sent_at, source, operation_id)
    values (p_visit, auth.uid(), v_visit.technician_id, p_kind, p_reported, 'Asia/Jerusalem', 120, now(), 'device', p_op);
    v_result := 'applied';
  exception when unique_violation then
    v_item := private.create_review_item('duplicate_time_report', 'op.' || p_op, v_visit.service_call_id, p_visit, 'device',
      null, p_op,
      jsonb_build_object('kind', p_kind, 'reported_at', p_reported, 'device_tz', 'Asia/Jerusalem', 'device_utc_offset_min', 120,
                         'device_sent_at', now()),
      jsonb_build_object('kind', p_kind), null);
    v_result := 'review';
  end;
  perform private.record_offline_operation(p_op, p_visit, 'time_report', v_sha, v_visit.field_version, now(), 'Asia/Jerusalem',
    120, v_result, v_visit.field_version, v_item);
  return v_result;
end
$f$;
grant execute on function pg_temp.tm_device_time_report(uuid, uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. One operation, applied once (T-09: no duplicate submission; category 13)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '10 minutes', 'departed:X'), 'applied',
  'Technician B''s departure on his visit 3 is applied');
select is(pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '10 minutes', 'departed:X'), 'replay applied 1',
  'the same operation sent again (a retry after a lost answer) returns the stored result');
reset role;
select is(
  (select concat_ws(' | ', (select count(*) from public.visit_time_reports t where t.operation_id = '00000000-0000-4000-8000-000000260f01'),
                    o.actor_profile_id = '00000000-0000-4000-8000-0000000000d2', o.visit_id = '00000000-0000-4000-8000-000000260b03', o.op_type, o.payload_sha256 = encode(sha256(convert_to('departed:X', 'UTF8')), 'hex'),
                    o.expected_field_version, o.result, o.resulting_field_version, o.review_item_id is null, o.received_at = now(),
                    o.is_test, o.device_tz || '/' || o.device_utc_offset_min)
   from public.offline_operations o where o.operation_id = '00000000-0000-4000-8000-000000260f01'),
  '1 | t | t | time_report | t | 1 | applied | 1 | t | t | t | Asia/Jerusalem/120',
  'one time report and one operation row: the actor from the session, the server''s receipt time, the visit''s test marker and the final result');
select results_eq(
  $$ select x.label, pg_temp.tm_as(x.sub::uuid, x.stmt)
     from (values
       (1, 'the same id with another payload', '00000000-0000-4000-8000-0000000000d2',
        $q$select pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '9 minutes', 'departed:X2')$q$),
       (2, 'the same id for another visit', '00000000-0000-4000-8000-0000000000d2',
        $q$select pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b01', 'departed', now() - interval '10 minutes', 'departed:X')$q$),
       (3, 'the same id from another user (Technician A)', '00000000-0000-4000-8000-0000000000d1',
        $q$select pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '10 minutes', 'departed:X')$q$),
       (4, 'a new id on another technician''s visit', '00000000-0000-4000-8000-0000000000d1',
        $q$select pg_temp.tm_device_time_report(gen_random_uuid(), '00000000-0000-4000-8000-000000260b03', 'departed', now(), 'departed:A')$q$)
     ) as x (n, label, sub, stmt) order by x.n $$,
  $$ values ('the same id with another payload', '23505 offline_operations: the operation id was already used for another payload'),
            ('the same id for another visit', '23505 offline_operations: the operation id was already used for another payload'),
            ('the same id from another user (Technician A)', '42501 not authorized'),
            ('a new id on another technician''s visit', '42501 not authorized') $$,
  'a reused operation id with another payload or visit is refused (23505); under another user it is refused generically (42501, category 5)');

-- ---------------------------------------------------------------------------------------------
-- 2. A second report of the same field time goes to review (PR 1.5 OQ-11; category 10, double tap)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f02', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '8 minutes', 'departed:Y'), 'review',
  'a second departure of visit 3 under a new operation id is stored for review (never a second device row, never lost)');
select is(pg_temp.tm_device_time_report('00000000-0000-4000-8000-000000260f02', '00000000-0000-4000-8000-000000260b03', 'departed', now() - interval '8 minutes', 'departed:Y'), 'replay review 1',
  'its replay returns the stored review result');
reset role;
select is(
  (select concat_ws(' | ', (select count(*) from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-000000260b03' and t.kind = 'departed'),
                    (select count(*) from public.review_items r where r.operation_id = '00000000-0000-4000-8000-000000260f02'),
                    r.review_type, r.source, r.dedupe_key = 'op.' || '00000000-0000-4000-8000-000000260f02', r.submitted_by_profile_id = '00000000-0000-4000-8000-0000000000d2', r.status,
                    r.submitted_version ->> 'kind', o.result, o.review_item_id = r.id)
   from public.review_items r join public.offline_operations o on o.operation_id = r.operation_id
   where r.operation_id = '00000000-0000-4000-8000-000000260f02'),
  '1 | 1 | duplicate_time_report | device | t | t | open | departed | review | t',
  'one device row, one open review item (submitted by Technician B, the device values as version A), and the operation linked to it');
select is(
  (select count(*)::integer from public.offline_operations o where o.result = 'review' and o.actor_profile_id = '00000000-0000-4000-8000-0000000000d2'),
  1, 'T-01: the operations of a Technician waiting for review are countable on the server (the device counts its pending and failed items itself)');

-- ---------------------------------------------------------------------------------------------
-- 3. The helpers directly (as postgres with the caller's claims, as a Step 4 writer runs them)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
select ok(private.offline_operation_replay('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64)) is null,
  'offline_operation_replay returns NULL for a new operation id');
select ok(
  exists (select 1 from pg_locks l
          where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
            and l.classid::bigint = ((hashtextextended('tm.offline_operations:' || '00000000-0000-4000-8000-000000260f03', 0) >> 32) & 4294967295)
            and l.objid::bigint = (hashtextextended('tm.offline_operations:' || '00000000-0000-4000-8000-000000260f03', 0) & 4294967295)),
  'it holds a transaction advisory lock on the operation id (two deliveries of one operation never both apply)');
select results_eq(
  $$ select x.label, pg_temp.tm_run_as(null, x.sub::uuid, 'postgres', x.stmt)
     from (values
       (1, 'replay without an operation id', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.offline_operation_replay(null, '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64))$q$),
       (2, 'record without a session', null,
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (3, 'record an id that is already stored', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f01', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (4, 'a review result without its item', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'review', 1, null)$q$),
       (5, 'an applied result with an item (its own operation, so the CHECK decides)', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f02', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1,
             (select r.id from public.review_items r where r.operation_id = '00000000-0000-4000-8000-000000260f02'))$q$),
       (6, 'the review item of another operation', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'review', 1,
             (select r.id from public.review_items r where r.operation_id = '00000000-0000-4000-8000-000000260f02'))$q$),
       (7, 'an unknown operation type (TEMPORARY OQ-9)', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'status_change', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (8, 'a result outside the set (TEMPORARY OQ-10)', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'rejected', 1, null)$q$),
       (9, 'a payload hash that is not sha256 hex', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('C', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (10, 'an infinite device send time', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, 'infinity', 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (11, 'a device time zone that is not IANA-shaped', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'UTC+2', 120, 'applied', 1, null)$q$),
       (12, 'a field version 0', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 0, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$),
       (13, 'a valid new operation (positive control)', '00000000-0000-4000-8000-0000000000d2',
        $q$select private.record_offline_operation('00000000-0000-4000-8000-000000260f03', '00000000-0000-4000-8000-000000260b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null)$q$)
     ) as x (n, label, sub, stmt) order by x.n $$,
  $$ values ('replay without an operation id', '22023 invalid input'),
            ('record without a session', '42501 not authorized'),
            ('record an id that is already stored', '23505 offline_operations_pkey'),
            ('a review result without its item', '23514 offline_operations_review_check'),
            ('an applied result with an item (its own operation, so the CHECK decides)', '23514 offline_operations_review_check'),
            ('the review item of another operation', '23514 offline_operations: the review item belongs to another operation'),
            ('an unknown operation type (TEMPORARY OQ-9)', '23514 offline_operations_op_type_check'),
            ('a result outside the set (TEMPORARY OQ-10)', '23514 offline_operations_result_check'),
            ('a payload hash that is not sha256 hex', '23514 offline_operations_payload_sha256_check'),
            ('an infinite device send time', '23514 offline_operations_device_sent_at_check'),
            ('a device time zone that is not IANA-shaped', '23514 offline_operations_device_tz_check'),
            ('a field version 0', '23514 offline_operations_expected_field_version_check'),
            ('a valid new operation (positive control)', 'ok') $$,
  'record_offline_operation: a session is required, an id is stored once, the result and its review item agree, and every value rule holds');
select results_eq(
  $$ select x.label, pg_temp.tm_try(x.stmt)
     from (values
       (1, 'update a stored operation', $q$update public.offline_operations set result = 'review' where operation_id = '00000000-0000-4000-8000-000000260f01'$q$),
       (2, 'delete a stored operation', $q$delete from public.offline_operations where operation_id = '00000000-0000-4000-8000-000000260f01'$q$),
       (3, 'truncate the record', $q$truncate public.offline_operations$q$)
     ) as x (n, label, stmt) order by x.n $$,
  $$ values ('update a stored operation', '55000 offline_operations is append-only'),
            ('delete a stored operation', '55000 offline_operations is append-only'),
            ('truncate the record', '55000 offline_operations cannot be truncated') $$,
  'a stored operation never changes and is never deleted, even as postgres (the stored result is final)');

-- ---------------------------------------------------------------------------------------------
-- 4. Review dedupe (D44: a submission is stored once, never lost)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
select is(
  (select private.create_review_item('edit_conflict', 'pr16-260-dup', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null,
     '00000000-0000-4000-8000-000000260f10', '{"summary": "א"}', '{"summary": "ב"}', '{"summary": "ג"}')
   = private.create_review_item('edit_conflict', 'pr16-260-dup', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null,
     '00000000-0000-4000-8000-000000260f10', '{"summary": "שונה"}', '{"summary": "ב"}', null)),
  true, 'the same dedupe key for the same item returns the stored item''s id');
select is(
  (select concat_ws(' | ', count(*), min(r.submitted_version ->> 'summary'), min(r.base_version ->> 'summary'),
                    bool_and(r.submitted_by_profile_id = '00000000-0000-4000-8000-0000000000d1'))
   from public.review_items r where r.dedupe_key = 'pr16-260-dup'),
  '1 | א | ג | t',
  'one row: the first submission''s versions are kept (both versions as stored, D44), the submitter is the device session''s user');
select results_eq(
  $$ select x.label, pg_temp.tm_run_as(null, x.sub::uuid, 'postgres', x.stmt, x.probe)
     from (values
       (1, 'the same key for another visit', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('edit_conflict', 'pr16-260-dup', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b03', 'device', null, gen_random_uuid(), '{}', '{}', null)$q$,
        null::text),
       (2, 'the same key for another type', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('approval_text_mismatch', 'pr16-260-dup', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '{}', '{}', null)$q$,
        null),
       (3, 'a device item without a session (no submitter)', null,
        $q$select private.create_review_item('edit_conflict', 'pr16-260-k1', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '{}', '{}', null)$q$,
        null),
       (4, 'an invitation item ignores the session (no submitter)', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('reassignment', 'pr16-260-k2', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b03', 'invitation', 'pr16-evt-2', null, '{}', '{}', null)$q$,
        $q$select (r.submitted_by_profile_id is null)::text from public.review_items r where r.dedupe_key = 'pr16-260-k2'$q$),
       (5, 'a dedupe key outside the reference format', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('edit_conflict', 'key with spaces', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '{}', '{}', null)$q$,
        null),
       (6, 'a second device report without its device values', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('duplicate_time_report', 'pr16-260-k3', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '{"kind": "arrived"}', '{}', null)$q$,
        null),
       (7, 'a version that is not a JSON object', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('edit_conflict', 'pr16-260-k4', '00000000-0000-4000-8000-000000260a01', '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '[]', '{}', null)$q$,
        null),
       (8, 'a visit of another call', '00000000-0000-4000-8000-0000000000d1',
        $q$select private.create_review_item('edit_conflict', 'pr16-260-k5', gen_random_uuid(), '00000000-0000-4000-8000-000000260b01', 'device', null, gen_random_uuid(), '{}', '{}', null)$q$,
        null)
     ) as x (n, label, sub, stmt, probe) order by x.n $$,
  $$ values ('the same key for another visit', '23505 review_items: the dedupe key belongs to another item'),
            ('the same key for another type', '23505 review_items: the dedupe key belongs to another item'),
            ('a device item without a session (no submitter)', '23514 review_items_device_check'),
            ('an invitation item ignores the session (no submitter)', 'true'),
            ('a dedupe key outside the reference format', '23514 review_items_dedupe_key_check'),
            ('a second device report without its device values', '23514 review_items_time_report_check'),
            ('a version that is not a JSON object', '23514 review_items_submitted_version_check'),
            ('a visit of another call', '23503 review_items: unknown service call') $$,
  'create_review_item: a dedupe key belongs to one item; a device item is attributed to the session only; the contract of a second device report; versions are JSON objects; the call must exist');

select * from finish();
rollback;
