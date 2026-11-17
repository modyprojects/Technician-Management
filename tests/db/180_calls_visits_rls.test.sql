-- PR 1.5: row-level security and role isolation on the seven PR 1.5 tables and the view
-- (docs/database-schema.md §8; plan §5.2, §5.3; docs/testing.md categories 1-3; D33, D36, D47, D51;
-- D58 (5): RLS, permissions and role isolation first). Covered: the exact SELECT policies; who reads
-- what for every caller of plan §5.3 (anon, a signed-in user without a profile, inactive office
-- users, the Creator, a Manager and Customer Service with the TEMPORARY D51 defaults, a Manager with
-- `card`, `calls` or `cal` turned off, Technicians A and B, service_role); Technician isolation (own
-- visits only, every status; own summaries and signatures only, also not B's earlier visit of a
-- shared call, which is served only through previous_visits, 190; no call row, no time report, no
-- event and no change row); immediate revocation on re-assignment and deactivation; and no direct
-- write for any API role.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   OQ-12 no Technician policy on service_calls (call fields only through my_visit_details, 190);
--   OQ-1  D36 earlier visits only through previous_visits (no direct report or signature row);
--   OQ-4  summaries and signatures need `card` and (`cal` or `calls`);
--   open decision 2 (d05): no Technician reads any time report, his own included;
--   D51   matrix values are the TEMPORARY defaults (`cal`, `calls`, `card` on for Manager and
--         Customer Service); the Creator changes the Manager's keys in section 7.
--
-- Fixture (fictional, example.test, automated_test; D47):
--   call P (open):      P1 Technician B done (summary, signature, time report), P2 Technician A
--                       scheduled, P3 Technician B scheduled;
--   call Q (resolved):  Q1 Technician A done (summary, signature, time report);
--   call S (open):      S1 Technician B scheduled;
--   call R (awaiting_scheduling): R1 Technician A cancelled by the Manager.
--   Two entity_changes rows (one on call P, one on visit Q1) and a created event per visit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_state: 'ok' or the SQLSTATE of one statement.
create function pg_temp.tm_state(p_sql text)
returns text
language plpgsql
as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$f$;

-- tm_names: fixture visit ids and names, filled by postgres after the fixture.
create temporary table tm_names (id uuid primary key, name text not null) on commit drop;
grant select on pg_temp.tm_names to anon, authenticated, service_role;

-- tm_seen: what the caller reads in each relation, by fixture name (task numbers for visits and
-- their child rows, request numbers for calls, counts for history rows). Summaries and signatures
-- are named through pg_temp.tm_names (written by postgres, no RLS), never through public.visits,
-- so a row the caller reads is listed even when its visit is hidden from him (independent review
-- S2: a join with visits would hide it for the wrong reason).
create function pg_temp.tm_seen()
returns text
language sql
as $f$
  select 'calls ' || coalesce((select string_agg(c.request_number, ',' order by c.request_number collate "C")
                               from public.service_calls c), '-')
    || ' | visits ' || coalesce((select string_agg(v.task_number, ',' order by v.task_number collate "C")
                                 from public.visits v), '-')
    || ' | reports ' || coalesce((select string_agg(coalesce(n.name, '?'), ',' order by n.name collate "C")
                                  from public.visit_reports r left join pg_temp.tm_names n on n.id = r.visit_id), '-')
    || ' | signatures ' || coalesce((select string_agg(coalesce(n.name, '?'), ',' order by n.name collate "C")
                                     from public.visit_signatures s left join pg_temp.tm_names n on n.id = s.visit_id), '-')
    || ' | times ' || (select count(*) from public.visit_time_reports)
    || ' | current ' || (select count(*) from public.visit_time_current)
    || ' | events ' || (select count(*) from public.visit_events)
    || ' | changes ' || (select count(*) from public.entity_changes)
$f$;

-- tm_selects: the outcome of a SELECT on each relation (for roles without a grant).
create function pg_temp.tm_selects()
returns text
language sql
as $f$
  select string_agg(t.t || ' ' || pg_temp.tm_state('select count(*) from public.' || t.t), ', ' order by t.n)
  from unnest(array['service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                    'visit_time_current', 'visit_events', 'entity_changes']) with ordinality as t (t, n)
$f$;

-- tm_writes: the distinct outcomes of every direct write on each table (an UPDATE of an ordinary
-- column, so no generated-column error hides the privilege check); each attempt is undone.
create function pg_temp.tm_writes()
returns text
language sql
as $f$
  select string_agg(distinct pg_temp.tm_state(case o.o
      when 'insert' then 'insert into public.' || t.t || ' default values'
      when 'update' then 'update public.' || t.t || ' set ' || t.c || ' = ' || t.c
      when 'delete' then 'delete from public.' || t.t
      else 'truncate public.' || t.t end), ',')
  from (values ('service_calls', 'fault_description'), ('visits', 'city'), ('visit_reports', 'summary_text'),
               ('visit_signatures', 'signer_name'), ('visit_time_reports', 'kind'), ('visit_events', 'event_type'),
               ('entity_changes', 'field')) as t (t, c)
  cross join unnest(array['insert', 'update', 'delete', 'truncate']) as o (o)
$f$;

-- tm_as_then: runs p_sql as postgres, then the probe tm_seen() as the given user, in one
-- subtransaction that is always undone; returns the probe's value or the first error.
create function pg_temp.tm_as_then(p_sql text, p_sub text)
returns text
language plpgsql
as $f$
declare
  v_result text;
  v_done boolean := false;
begin
  begin
    execute p_sql;
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_result := pg_temp.tm_seen();
    v_done := true;
    raise exception using errcode = 'TM001', message = 'undo the scenario';
  exception when others then
    if not v_done then
      v_result := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  return v_result;
end
$f$;
grant execute on function pg_temp.tm_state(text), pg_temp.tm_seen(), pg_temp.tm_selects(), pg_temp.tm_writes()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Fixtures (local, rolled back)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a9', 'b1', 'b2', 'd1', 'd2', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active, work_phone) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true, '03-000-0180'),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false, null),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true, null),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false, null),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true, null),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true, null);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000180c01', 'C-1801', 'לקוח בדיקה', '050-000-1801', 'automated_test', 'pr15-180-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000180d01', 'kt-1801', 'KT-1801', 'מוצר בדיקה', 'automated_test', 'pr15-180-1');

insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, handling_rep_profile_id, status, next_visit_number, resolved_at,
                                  data_source, source_ref)
select x.id::uuid, x.req, '00000000-0000-4000-8000-000000180c01', '00000000-0000-4000-8000-000000180d01',
       (select t.id from public.call_types t where t.sort_order = 1), 'תקלת בדיקה', 'נציג בדיקה',
       x.rep::uuid, x.status, x.next_n, case when x.status = 'resolved' then now() end, 'automated_test', x.ref
from (values
  ('00000000-0000-4000-8000-000000180a01', 'R-1801', '00000000-0000-4000-8000-0000000000a1', 'open', 4, 'pr15-180-p'),
  ('00000000-0000-4000-8000-000000180a02', 'R-1802', null, 'resolved', 2, 'pr15-180-q'),
  ('00000000-0000-4000-8000-000000180a03', 'R-1803', null, 'open', 2, 'pr15-180-s'),
  ('00000000-0000-4000-8000-000000180a04', 'R-1804', null, 'awaiting_scheduling', 2, 'pr15-180-r')
) as x (id, req, rep, status, next_n, ref);
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, cancelled_by, source_ref)
select x.id::uuid, x.call_id::uuid, x.tech::uuid, x.n, x.task, x.day::timestamptz, x.day::timestamptz + interval '1 hour',
       x.status, 'עיר בדיקה', 'רחוב הבדיקה 1', x.cancelled_by::uuid, 'pr15-180-' || lower(x.task)
from (values
  ('00000000-0000-4000-8000-000000180b11', '00000000-0000-4000-8000-000000180a01', '00000000-0000-4000-8000-0000000000e2', 1, 'P1', '2026-11-02 08:00:00+00', 'done', null),
  ('00000000-0000-4000-8000-000000180b12', '00000000-0000-4000-8000-000000180a01', '00000000-0000-4000-8000-0000000000e1', 2, 'P2', '2026-11-20 08:00:00+00', 'scheduled', null),
  ('00000000-0000-4000-8000-000000180b13', '00000000-0000-4000-8000-000000180a01', '00000000-0000-4000-8000-0000000000e2', 3, 'P3', '2026-11-22 08:00:00+00', 'scheduled', null),
  ('00000000-0000-4000-8000-000000180b21', '00000000-0000-4000-8000-000000180a02', '00000000-0000-4000-8000-0000000000e1', 1, 'Q1', '2026-11-03 08:00:00+00', 'done', null),
  ('00000000-0000-4000-8000-000000180b31', '00000000-0000-4000-8000-000000180a03', '00000000-0000-4000-8000-0000000000e2', 1, 'S1', '2026-11-21 08:00:00+00', 'scheduled', null),
  ('00000000-0000-4000-8000-000000180b41', '00000000-0000-4000-8000-000000180a04', '00000000-0000-4000-8000-0000000000e1', 1, 'R1', '2026-11-23 08:00:00+00', 'cancelled', '00000000-0000-4000-8000-0000000000a1')
) as x (id, call_id, tech, n, task, day, status, cancelled_by);
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  ('00000000-0000-4000-8000-000000180b11', 'סיכום של טכנאי ב', 'written'),
  ('00000000-0000-4000-8000-000000180b21', 'סיכום של טכנאי א', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id) values
  ('00000000-0000-4000-8000-000000180b11', 'חותם ב', 'אני מאשר/ת שהטיפול בוצע.',
   encode(sha256(convert_to('אני מאשר/ת שהטיפול בוצע.', 'UTF8')), 'hex'), '00000000-0000-4000-8000-000000180f11'),
  ('00000000-0000-4000-8000-000000180b21', 'חותם א', 'אני מאשר/ת שהטיפול בוצע.',
   encode(sha256(convert_to('אני מאשר/ת שהטיפול בוצע.', 'UTF8')), 'hex'), '00000000-0000-4000-8000-000000180f21');
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id) values
  ('00000000-0000-4000-8000-000000180b11', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e2',
   'arrived', now(), 'Asia/Jerusalem', 120, now(), 'device', '00000000-0000-4000-8000-000000180f12'),
  ('00000000-0000-4000-8000-000000180b21', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
   'arrived', now(), 'Asia/Jerusalem', 120, now(), 'device', '00000000-0000-4000-8000-000000180f22');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr15-180-%';
select private.write_entity_change('service_calls', '00000000-0000-4000-8000-000000180a01', 'fault_description',
  '"תקלה קודמת"', '"תקלת בדיקה"', 'edit', 'pr15-180-change-1');
select private.write_entity_change('visits', '00000000-0000-4000-8000-000000180b21', 'street',
  '"רחוב קודם"', '"רחוב הבדיקה 1"', 'edit', 'pr15-180-change-2');
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;
insert into tm_names select v.id, v.task_number from public.visits v where v.source_ref like 'pr15-180-%';

create temporary table tm_expected (who text primary key, seen text) on commit drop;
insert into tm_expected values
  ('all', 'calls R-1801,R-1802,R-1803,R-1804 | visits P1,P2,P3,Q1,R1,S1 | reports P1,Q1 | signatures P1,Q1 | times 2 | current 2 | events 6 | changes 2'),
  ('none', 'calls - | visits - | reports - | signatures - | times 0 | current 0 | events 0 | changes 0'),
  ('tech_a', 'calls - | visits P2,Q1,R1 | reports Q1 | signatures Q1 | times 0 | current 0 | events 0 | changes 0'),
  ('tech_b', 'calls - | visits P1,P3,S1 | reports P1 | signatures P1 | times 0 | current 0 | events 0 | changes 0');
grant select on pg_temp.tm_expected to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Catalog: RLS on, exactly ten SELECT policies, no write policy
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", c.relrowsecurity, c.relforcerowsecurity
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                         'visit_events', 'entity_changes')
     order by c.relname::text collate "C" $$,
  $$ values ('entity_changes', true, false), ('service_calls', true, false), ('visit_events', true, false),
            ('visit_reports', true, false), ('visit_signatures', true, false), ('visit_time_reports', true, false),
            ('visits', true, false) $$,
  'RLS is enabled on the seven tables (not forced: the SECURITY DEFINER bodies and checks run as the owner)');
select results_eq(
  $$ select p.tablename::text collate "default", p.policyname::text collate "default", p.permissive collate "default",
            p.roles::text collate "default", p.cmd collate "default", p.qual collate "default", p.with_check collate "default"
     from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                           'visit_events', 'entity_changes')
     order by p.tablename collate "C", p.policyname collate "C" $$,
  $$ values
     ('entity_changes', 'entity_changes_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '( SELECT private.has_permission(''calls''::text) AS has_permission)', null::text),
     ('service_calls', 'service_calls_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null),
     ('visit_events', 'visit_events_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '( SELECT private.has_permission(''calls''::text) AS has_permission)', null),
     ('visit_reports', 'visit_reports_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''card''::text) AS has_permission) AND (( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission)))', null),
     ('visit_reports', 'visit_reports_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(EXISTS ( SELECT 1
   FROM visits v
  WHERE ((v.id = visit_reports.visit_id) AND (v.technician_id = ( SELECT private.my_technician_id() AS my_technician_id)))))', null),
     ('visit_signatures', 'visit_signatures_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''card''::text) AS has_permission) AND (( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission)))', null),
     ('visit_signatures', 'visit_signatures_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(EXISTS ( SELECT 1
   FROM visits v
  WHERE ((v.id = visit_signatures.visit_id) AND (v.technician_id = ( SELECT private.my_technician_id() AS my_technician_id)))))', null),
     ('visit_time_reports', 'visit_time_reports_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null),
     ('visits', 'visits_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null),
     ('visits', 'visits_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(technician_id = ( SELECT private.my_technician_id() AS my_technician_id))', null) $$,
  'exactly ten SELECT policies, all TO authenticated; no Technician policy on calls, time reports, events or changes; no write policy');
select results_eq(
  $$ select c.relname::text collate "default", a.grantee::regrole::text, a.privilege_type::text
     from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                         'visit_time_current', 'visit_events', 'entity_changes')
       and a.grantee <> c.relowner
     order by c.relname::text collate "C", 2, 3 $$,
  $$ values ('entity_changes', 'authenticated', 'SELECT'), ('service_calls', 'authenticated', 'SELECT'),
            ('visit_events', 'authenticated', 'SELECT'), ('visit_reports', 'authenticated', 'SELECT'),
            ('visit_signatures', 'authenticated', 'SELECT'), ('visit_time_current', 'authenticated', 'SELECT'),
            ('visit_time_reports', 'authenticated', 'SELECT'), ('visits', 'authenticated', 'SELECT') $$,
  'grants: SELECT for authenticated only; nothing for anon, service_role or PUBLIC; no write grant');

-- ---------------------------------------------------------------------------------------------
-- 3. Callers without access
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(pg_temp.tm_selects(),
  'service_calls 42501, visits 42501, visit_reports 42501, visit_signatures 42501, visit_time_reports 42501, visit_time_current 42501, visit_events 42501, entity_changes 42501',
  'anon: no relation can be read');
select is(pg_temp.tm_writes(), '42501', 'anon: every direct write is refused');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(pg_temp.tm_selects(),
  'service_calls 42501, visits 42501, visit_reports 42501, visit_signatures 42501, visit_time_reports 42501, visit_time_current 42501, visit_events 42501, entity_changes 42501',
  'service_role: no grant, so nothing can be read (it bypasses RLS, not grants)');
select is(pg_temp.tm_writes(), '42501', 'service_role: every direct write is refused');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'none'),
  'a signed-in user without a profile reads nothing');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'none'), 'an inactive Manager reads nothing');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'none'),
  'an inactive Customer Service user reads nothing');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 4. Office users with the TEMPORARY D51 defaults; the Creator
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'), 'the Creator reads every row');
select is(pg_temp.tm_writes(), '42501', 'the Creator has no direct write (no write grant)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'),
  'a Manager with `cal`, `calls` and `card` (TEMPORARY D51 defaults) reads every row');
select is(pg_temp.tm_writes(), '42501', 'a Manager has no direct write');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'),
  'Customer Service with the TEMPORARY D51 defaults reads every row');
select is(pg_temp.tm_writes(), '42501', 'Customer Service has no direct write');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 5. Technicians: own rows only (D36 earlier visits only through previous_visits, 190)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'tech_a'),
  'Technician A: his own visits in every status (open, closed, cancelled), his own summary and signature; no call row, no time report (his own included, TEMPORARY d05), no event, no change');
select is((select count(*)::integer from public.visit_reports r where r.visit_id = '00000000-0000-4000-8000-000000180b11'), 0,
  'Technician A does not read B''s summary of the earlier visit P1 of the shared call P, although his P2 is open (OQ-1)');
select is((select count(*)::integer from public.visits v where v.id = '00000000-0000-4000-8000-000000180b13'), 0,
  'Technician A does not see B''s later visit P3 of the same call (D36: never future or concurrent visits of others)');
select is((select count(*)::integer from public.service_calls c where c.id = '00000000-0000-4000-8000-000000180a02'), 0,
  'Technician A does not read his own closed call Q (status, resolved_at and updated_at would reveal later visits)');
select is((select count(*)::integer from public.visit_signatures s where s.visit_id = '00000000-0000-4000-8000-000000180b11'), 0,
  'Technician A reads neither B''s signature nor its signer name on the earlier visit P1 (direct count, D36)');
select is(pg_temp.tm_writes(), '42501', 'Technician A has no direct write');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'tech_b'),
  'Technician B: only his own visits, summary and signature; nothing of Technician A');
select is((select count(*)::integer from public.visit_reports r where r.visit_id = '00000000-0000-4000-8000-000000180b21')
          + (select count(*)::integer from public.visit_signatures s where s.visit_id = '00000000-0000-4000-8000-000000180b21'), 0,
  'Technician B reads neither A''s summary nor A''s signature of Q1 (direct counts)');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 6. Revocation is immediate (the helpers read the current rows)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_as_then(
  $$ update public.visits v set technician_id = '00000000-0000-4000-8000-0000000000e2'
     where v.id = '00000000-0000-4000-8000-000000180b12' $$, '00000000-0000-4000-8000-0000000000d1'),
  'calls - | visits Q1,R1 | reports Q1 | signatures Q1 | times 0 | current 0 | events 0 | changes 0',
  're-assignment of P2 from A to B: A no longer sees P2');
select is(pg_temp.tm_as_then(
  $$ update public.visits v set technician_id = '00000000-0000-4000-8000-0000000000e2'
     where v.id = '00000000-0000-4000-8000-000000180b12' $$, '00000000-0000-4000-8000-0000000000d2'),
  'calls - | visits P1,P2,P3,S1 | reports P1 | signatures P1 | times 0 | current 0 | events 0 | changes 0',
  're-assignment of P2 from A to B: B sees P2 at once');
select is(pg_temp.tm_as_then(
  $$ update public.profiles p set is_active = false where p.id = '00000000-0000-4000-8000-0000000000d1' $$,
  '00000000-0000-4000-8000-0000000000d1'),
  (select e.seen from tm_expected e where e.who = 'none'),
  'deactivated Technician A reads nothing, his own closed visit, summary and signature included');
select is(pg_temp.tm_as_then(
  $$ update public.profiles p set is_active = false where p.id = '00000000-0000-4000-8000-0000000000a1' $$,
  '00000000-0000-4000-8000-0000000000a1'),
  (select e.seen from tm_expected e where e.who = 'none'),
  'a Manager deactivated after sign-in reads nothing at once');
select is(pg_temp.tm_as_then(
  $$ update public.profiles p set is_active = false where p.id = '00000000-0000-4000-8000-0000000000b1' $$,
  '00000000-0000-4000-8000-0000000000b1'),
  (select e.seen from tm_expected e where e.who = 'none'),
  'a Customer Service user deactivated after sign-in reads nothing at once');

-- ---------------------------------------------------------------------------------------------
-- 7. Matrix keys (TEMPORARY D51 values changed by the Creator; enforced in the database)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'card', false, 1, null), 2, 'the Creator turns `card` off for Managers');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(),
  'calls R-1801,R-1802,R-1803,R-1804 | visits P1,P2,P3,Q1,R1,S1 | reports - | signatures - | times 2 | current 2 | events 6 | changes 2',
  'Manager without `card`: calls, visits, times, events and changes, but no summary and no signature (OQ-4)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'),
  'Customer Service keeps `card`: the Manager''s keys do not change another role');
reset role;

select is(
  pg_temp.tm_state($$ select private.write_entity_change('visit_reports', '00000000-0000-4000-8000-000000180b11',
    'summary_text', '"x"', '"y"', 'edit', null) $$),
  '23514',
  'entity_changes cannot hold summary or signature history, so `card` off leaks nothing through it (DEV-8)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'card', true, 2, null)
          + public.admin_set_role_permission('manager', 'calls', false, 1, null), 5,
  'the Creator turns `card` back on and `calls` off for Managers');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(),
  'calls R-1801,R-1802,R-1803,R-1804 | visits P1,P2,P3,Q1,R1,S1 | reports P1,Q1 | signatures P1,Q1 | times 2 | current 2 | events 0 | changes 0',
  'Manager with `cal` and `card` but without `calls`: no event and no change row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'calls', true, 2, null)
          + public.admin_set_role_permission('manager', 'cal', false, 1, null), 5,
  'the Creator turns `calls` back on and `cal` off for Managers');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'),
  'Manager with `calls` and `card` but without `cal` still reads every row (`calls` covers all of them)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'calls', false, 3, null), 4,
  'the Creator turns `calls` off too (Managers keep only `card`)');
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'all'),
  'the Creator still reads every row (he has every key)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_seen(), (select e.seen from tm_expected e where e.who = 'none'),
  'Manager with `card` only reads nothing (`card` alone opens no summary or signature)');
select is((select count(*)::integer from public.visit_reports) + (select count(*)::integer from public.visit_signatures), 0,
  'Manager with `card` only: direct counts of summaries and signatures are 0 (TEMPORARY OQ-4)');
reset role;

select is((select count(*)::integer from public.visits v where v.source_ref like 'pr15-180-%'), 6,
  'every scenario was undone: the fixture visits are unchanged');

select * from finish();
rollback;
