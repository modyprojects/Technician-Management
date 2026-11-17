-- PR 1.6: row-level security and role isolation on review_items, visit_corrections and
-- offline_operations (docs/database-schema.md §8.1, §8.3; docs/testing.md categories 1-3; D33, D36,
-- D44, D46, D47, D51; D58 (5): RLS, permissions and role isolation first). Covered: the exact
-- policies; who reads what for every caller (anon, a signed-in user without a profile, no JWT, a
-- deactivated Manager, the Creator, a Manager and Customer Service with the TEMPORARY D51 defaults
-- and with `card`, `cal`, `calls` and `conflicts` turned off or on, Technicians A and B,
-- service_role); `calls` without `card` reads no review item and no correction (card content);
-- Technician isolation (only his own operations, also after a re-assignment; never a review item or
-- a correction); immediate revocation on deactivation; no direct write for any API role.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr16 section 13), deny by default:
--   OQ-2  review_items and visit_corrections need `card` and (`cal` or `calls`); offline_operations
--         need `conflicts` (office) or are the Technician's own;
--   OQ-11 no Technician policy on review_items (the status of his submission comes with Step 4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

-- tm_counts: what the caller reads: review items / corrections / operations / Technician B's operations.
create function pg_temp.tm_counts(p_setup text, p_sub uuid, p_role text default 'authenticated')
returns text
language sql
as $f$ select pg_temp.tm_run_as(p_setup, p_sub, p_role,
  'create temporary table tm_seen on commit drop as select concat_ws(''/'', (select count(*) from public.review_items), (select count(*) from public.visit_corrections),
                       (select count(*) from public.offline_operations),
                       (select count(*) from public.offline_operations o where o.actor_profile_id = ''00000000-0000-4000-8000-0000000000d2'')) as v',
  'select v from tm_seen') $f$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test, automated_test; D47): the real Creator
-- c1, Managers a1 and a2, Customer Service b1, Technicians A (d1, e1) and B (d2, e2), a signed-in
-- user f0 without a profile. Call K (R-2501, open) has visit 1 (done, Technician A, with its
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
  ('00000000-0000-4000-8000-000000250c01', 'C-2501', 'לקוח בדיקה', '050-000-2501', 'automated_test', 'pr16-250');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000250d01', 'kt-2501', 'KT-2501', 'מוצר בדיקה', 'automated_test', 'pr16-250');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000250a01', 'R-2501', '00000000-0000-4000-8000-000000250c01',
        '00000000-0000-4000-8000-000000250d01', (select c.id from public.call_types c where c.sort_order = 1),
        'תקלת בדיקה', 'נציג בדיקה', 'open', 5, 'automated_test', 'pr16-250-k');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, followup_reason_id, next_visit_notes, source_ref) values
  ('00000000-0000-4000-8000-000000250b01', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-0000000000e1',
   1, 'K1', now() - interval '3 hours', now() - interval '2 hours', 'done', 'עיר בדיקה', 'רחוב הבדיקה 1', null, null, 'pr16-250-k1'),
  ('00000000-0000-4000-8000-000000250b02', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-0000000000e1',
   2, 'K2', now() - interval '2 hours', now() - interval '1 hour', 'followup', 'עיר בדיקה', 'רחוב הבדיקה 2',
   (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', 'pr16-250-k2'),
  ('00000000-0000-4000-8000-000000250b03', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-0000000000e2',
   3, 'K3', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 3', null, null,
   'pr16-250-k3'),
  ('00000000-0000-4000-8000-000000250b04', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-0000000000e1',
   4, 'K4', now() + interval '2 days', now() + interval '2 days 1 hour', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 4', null, null,
   'pr16-250-k4');
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  ('00000000-0000-4000-8000-000000250b01', 'הוחלף חלק', 'written'),
  ('00000000-0000-4000-8000-000000250b02', 'נדרש חלק', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-000000250b01', 'חותם בדיקה', 'נוסח בדיקה', encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'),
          '00000000-0000-4000-8000-000000250e00');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr16-250-k%';
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
select '00000000-0000-4000-8000-000000250b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
       x.kind, x.at, 'Asia/Jerusalem', 120, x.at + interval '1 minute', 'device', x.op::uuid
from (values ('departed', now() - interval '3 hours', '00000000-0000-4000-8000-000000250e01'),
             ('arrived', now() - interval '150 minutes', '00000000-0000-4000-8000-000000250e02'),
             ('ended', now() - interval '130 minutes', '00000000-0000-4000-8000-000000250e03')) as x (kind, at, op);
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;

-- The rows to read (as postgres; every trigger applies): three review items (an invitation item of
-- visit 3, Technician A's second departure report of visit 1, a call-level SKU change), two D14
-- corrections (the summary of visit 1, the reason of visit 2), and three offline operations
-- (Technician A: an applied one on visit 1 and the one stored for review; Technician B: one on
-- visit 3).
insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id,
                                 operation_id, submitted_version, current_version)
values ('reassignment', 'pr16-250-r1', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-000000250b03', 'invitation', 'evt-1', null, null, '{"technician": "א"}', '{"technician": "ב"}'),
       ('duplicate_time_report', 'pr16-250-r2', '00000000-0000-4000-8000-000000250a01', '00000000-0000-4000-8000-000000250b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000250f02',
        '{"kind": "departed", "reported_at": "2026-11-16T06:00:00+00:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-11-16T06:01:00+00:00"}', '{}'),
       ('sku_change', 'pr16-250-r4', '00000000-0000-4000-8000-000000250a01', null, 'invitation', 'evt-4', null, null, '{"sku": "B"}', '{"sku": "A"}');
insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by)
values ('00000000-0000-4000-8000-000000250b01', 'summary', '"הוחלף חלק"', '"סיכום מתוקן"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1'),
       ('00000000-0000-4000-8000-000000250b02', 'followup_reason', to_jsonb((select r.id from public.followup_reasons r where r.sort_order = 1)),
        to_jsonb((select r.id from public.followup_reasons r where r.sort_order = 2)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1');
insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
                                       device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version, review_item_id)
values ('00000000-0000-4000-8000-000000250f01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000250b01', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null),
       ('00000000-0000-4000-8000-000000250f02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000250b01', 'time_report', repeat('b', 64), 1, now(), 'Asia/Jerusalem', 120, 'review', 1,
        (select r.id from public.review_items r where r.dedupe_key = 'pr16-250-r2')),
       ('00000000-0000-4000-8000-000000250f03', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000250b03', 'time_report', repeat('c', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, null);

-- ---------------------------------------------------------------------------------------------
-- 1. Policies and grants
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select p.tablename::text collate "default", p.policyname::text collate "default", p.permissive collate "default",
            p.roles::text collate "default", p.cmd collate "default",
            p.qual collate "default", p.with_check collate "default"
     from pg_policies p where p.schemaname = 'public' and p.tablename in ('review_items', 'visit_corrections', 'offline_operations')
     order by p.tablename::text collate "C", p.policyname::text collate "C" $$,
  $$ values
     ('offline_operations'::text, 'offline_operations_select_office'::text, 'PERMISSIVE'::text, '{authenticated}'::text, 'SELECT'::text,
      '( SELECT private.has_permission(''conflicts''::text) AS has_permission)'::text, null::text),
     ('offline_operations', 'offline_operations_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '((actor_profile_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.has_role(''technician''::text) AS has_role))', null),
     ('review_items', 'review_items_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''card''::text) AS has_permission) AND (( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission)))', null),
     ('visit_corrections', 'visit_corrections_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''card''::text) AS has_permission) AND (( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission)))', null) $$,
  'exactly four SELECT policies TO authenticated (no write policy): office reads by matrix key through the helpers (an active profile required), the Technician his own operations');
select results_eq(
  $$ select c.relname::text collate "default", a.grantee::regrole::text collate "default", a.privilege_type::text
     from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.oid in ('public.review_items'::regclass, 'public.visit_corrections'::regclass, 'public.offline_operations'::regclass)
       and a.grantee <> c.relowner
     order by 1, 2, 3 $$,
  $$ values ('offline_operations'::text, 'authenticated'::text, 'SELECT'::text), ('review_items', 'authenticated', 'SELECT'),
            ('visit_corrections', 'authenticated', 'SELECT') $$,
  'grants: SELECT for authenticated only on the three tables (nothing for anon, service_role or PUBLIC; no write grant)');

-- ---------------------------------------------------------------------------------------------
-- 2. Who reads what (review items / corrections / operations / Technician B's operations)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.label, pg_temp.tm_counts(x.setup, x.sub::uuid, x.role)
     from (values
       (1, 'a signed-in user without a profile', null, '00000000-0000-4000-8000-0000000000f0', 'authenticated'),
       (2, 'authenticated without a JWT', null, null, 'authenticated'),
       (3, 'a deactivated Manager', $q$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000a2'$q$, '00000000-0000-4000-8000-0000000000a2', 'authenticated'),
       (4, 'Technician A (his two operations only)', null, '00000000-0000-4000-8000-0000000000d1', 'authenticated'),
       (5, 'Technician B (his one operation only)', null, '00000000-0000-4000-8000-0000000000d2', 'authenticated'),
       (6, 'Technician A deactivated (revocation at the next query)',
        $q$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000d1'$q$, '00000000-0000-4000-8000-0000000000d1', 'authenticated'),
       (7, 'Technician B after visit 3 is re-assigned to A (his own submission stays his)',
        $q$update public.visits set technician_id = '00000000-0000-4000-8000-0000000000e1' where id = '00000000-0000-4000-8000-000000250b03'$q$, '00000000-0000-4000-8000-0000000000d2', 'authenticated'),
       (8, 'Customer Service (TEMPORARY defaults: cal, calls, card; no conflicts)', null, '00000000-0000-4000-8000-0000000000b1', 'authenticated'),
       (9, 'Customer Service with card off', $q$update public.role_permissions set allowed = false where role = 'customer_service' and permission_key in ('card')$q$, '00000000-0000-4000-8000-0000000000b1', 'authenticated'),
       (10, 'Customer Service with conflicts on', $q$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key in ('conflicts')$q$, '00000000-0000-4000-8000-0000000000b1', 'authenticated'),
       (11, 'a Manager (TEMPORARY defaults)', null, '00000000-0000-4000-8000-0000000000a1', 'authenticated'),
       (12, 'a Manager with card off (calls without card: no card content)', $q$update public.role_permissions set allowed = false where role = 'manager' and permission_key in ('card')$q$, '00000000-0000-4000-8000-0000000000a1', 'authenticated'),
       (13, 'a Manager with cal and calls off', $q$update public.role_permissions set allowed = false where role = 'manager' and permission_key in ('cal', 'calls')$q$, '00000000-0000-4000-8000-0000000000a1', 'authenticated'),
       (14, 'a Manager with calls off (cal is enough)', $q$update public.role_permissions set allowed = false where role = 'manager' and permission_key in ('calls')$q$, '00000000-0000-4000-8000-0000000000a1', 'authenticated'),
       (15, 'a Manager with conflicts off', $q$update public.role_permissions set allowed = false where role = 'manager' and permission_key in ('conflicts')$q$, '00000000-0000-4000-8000-0000000000a1', 'authenticated'),
       (16, 'the Creator', null, '00000000-0000-4000-8000-0000000000c1', 'authenticated'),
       (17, 'postgres (owner, positive control)', null, null, 'postgres')
     ) as x (n, label, setup, sub, role) order by x.n $$,
  $$ values ('a signed-in user without a profile', '0/0/0/0'), ('authenticated without a JWT', '0/0/0/0'),
            ('a deactivated Manager', '0/0/0/0'), ('Technician A (his two operations only)', '0/0/2/0'),
            ('Technician B (his one operation only)', '0/0/1/1'),
            ('Technician A deactivated (revocation at the next query)', '0/0/0/0'),
            ('Technician B after visit 3 is re-assigned to A (his own submission stays his)', '0/0/1/1'),
            ('Customer Service (TEMPORARY defaults: cal, calls, card; no conflicts)', '3/2/0/0'),
            ('Customer Service with card off', '0/0/0/0'), ('Customer Service with conflicts on', '3/2/3/1'),
            ('a Manager (TEMPORARY defaults)', '3/2/3/1'),
            ('a Manager with card off (calls without card: no card content)', '0/0/3/1'),
            ('a Manager with cal and calls off', '0/0/3/1'), ('a Manager with calls off (cal is enough)', '3/2/3/1'),
            ('a Manager with conflicts off', '3/2/0/0'), ('the Creator', '3/2/3/1'),
            ('postgres (owner, positive control)', '3/2/3/1') $$,
  'reads per caller: review items and corrections with card and (cal or calls); operations with conflicts or the Technician''s own; nothing without an active profile; revocation is immediate');
select results_eq(
  $$ select x.r, left(pg_temp.tm_run_as(null, null, x.r, $q$select count(*) from public.review_items$q$), 5),
            left(pg_temp.tm_run_as(null, null, x.r, $q$select count(*) from public.visit_corrections$q$), 5),
            left(pg_temp.tm_run_as(null, null, x.r, $q$select count(*) from public.offline_operations$q$), 5)
     from (values ('anon'), ('service_role')) as x (r) $$,
  $$ values ('anon', '42501', '42501', '42501'), ('service_role', '42501', '42501', '42501') $$,
  'anon and service_role read nothing (no grant: 42501)');
select is(pg_temp.tm_run_as(null, '00000000-0000-4000-8000-0000000000d1', 'authenticated',
  $$ create temporary table tm_seen on commit drop as
       select string_agg(o.operation_id::text || ':' || o.result, ',' order by o.operation_id) as v from public.offline_operations o $$,
  $$ select v from tm_seen $$),
  '00000000-0000-4000-8000-000000250f01:applied,00000000-0000-4000-8000-000000250f02:review',
  'Technician A reads the result of each of his operations (T-01: what was applied and what waits for review), never the review item itself');

-- ---------------------------------------------------------------------------------------------
-- 3. No direct write for any API role (writers only)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.label, left(pg_temp.tm_run_as(null, '00000000-0000-4000-8000-0000000000c1', 'authenticated', x.stmt), 5)
     from (values
       (1, 'insert a review item', $q$insert into public.review_items (review_type, dedupe_key, service_call_id, source, source_ref, submitted_version, current_version) values ('sku_change', 'x', '00000000-0000-4000-8000-000000250a01', 'invitation', 'e', '{}', '{}')$q$),
       (2, 'decide a review item', $q$update public.review_items set status = 'resolved'$q$),
       (3, 'delete a review item', $q$delete from public.review_items$q$),
       (4, 'insert a correction', $q$insert into public.visit_corrections (visit_id, field, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000250b01', 'summary', '"x"', 'r', 1, 2, '00000000-0000-4000-8000-0000000000c1')$q$),
       (5, 'update a correction', $q$update public.visit_corrections set reason = 'x'$q$),
       (6, 'insert an operation', $q$insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version, device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000250b01', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1)$q$),
       (7, 'delete an operation', $q$delete from public.offline_operations$q$),
       (8, 'truncate the three tables', $q$truncate public.offline_operations, public.visit_corrections, public.review_items$q$)
     ) as x (n, label, stmt) order by x.n $$,
  $$ values ('insert a review item', '42501'), ('decide a review item', '42501'), ('delete a review item', '42501'),
            ('insert a correction', '42501'), ('update a correction', '42501'), ('insert an operation', '42501'),
            ('delete an operation', '42501'), ('truncate the three tables', '42501') $$,
  'the Creator writes none of the three tables directly (no grant: every change goes through a writer)');
select results_eq(
  $$ select x.label, pg_temp.tm_run_as('grant insert, update, delete on public.review_items, public.visit_corrections, public.offline_operations to authenticated',
                                       '00000000-0000-4000-8000-0000000000c1', 'authenticated', x.stmt)
     from (values
       (1, 'insert a review item with a temporary grant', $q$insert into public.review_items (review_type, dedupe_key, service_call_id, source, source_ref, submitted_version, current_version) values ('sku_change', 'x', '00000000-0000-4000-8000-000000250a01', 'invitation', 'e', '{}', '{}')$q$),
       (2, 'insert a correction with a temporary grant', $q$insert into public.visit_corrections (visit_id, field, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000250b01', 'summary', '"x"', 'r', 2, 3, '00000000-0000-4000-8000-0000000000c1')$q$),
       (3, 'insert an operation with a temporary grant', $q$insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version, device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000250b01', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1)$q$)
     ) as x (n, label, stmt) order by x.n $$,
  $$ values ('insert a review item with a temporary grant', '42501 new row violates row-level security policy for table "review_items"'),
            ('insert a correction with a temporary grant', '42501 new row violates row-level security policy for table "visit_corrections"'),
            ('insert an operation with a temporary grant', '42501 new row violates row-level security policy for table "offline_operations"') $$,
  'with a temporary grant RLS still refuses every insert (no write policy)');
select is(pg_temp.tm_run_as('grant update, delete on public.review_items, public.visit_corrections, public.offline_operations to authenticated',
  '00000000-0000-4000-8000-0000000000c1', 'authenticated',
  $$ create temporary table tm_seen on commit drop as select 0 as v;
     with u as (update public.review_items set updated_by = updated_by returning 1),
          d1 as (delete from public.visit_corrections returning 1),
          d2 as (delete from public.offline_operations returning 1)
     update tm_seen set v = (select count(*) from u) + (select count(*) from d1) + (select count(*) from d2) $$,
  $$ select v::text from tm_seen $$),
  '0', 'with a temporary grant an update or delete reaches no row (no write policy)');

select * from finish();
rollback;
