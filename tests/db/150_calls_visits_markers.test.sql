-- PR 1.5: test-data markers, the one-way rule, frozen fields and append-only rows on the service-call,
-- visit and history tables (D47, D39, D43, D45; docs/database-schema.md §1, §2, §4, §6; docs/testing.md
-- categories 6 and 12). Markers are copied from the parent (the client value is ignored) and never
-- change, for every role; the composite foreign keys keep a test child off a real parent and a real
-- child off a test parent; a real row never references a test row; the new one-way and marker
-- triggers fail closed when the referenced row is not visible to the caller; entity_changes takes
-- its marker from the target and refuses JSON null and oversized values with generic messages.
--
-- Mechanics (plan §10): writes that must reach the triggers run as postgres, as service_role with
-- temporary grants, or through a postgres-owned SECURITY DEFINER scratch writer in pg_temp called
-- by an API role; API roles are checked for 42501 without a grant and for 0 rows with a temporary
-- grant (no write policy). Every probe runs in a subtransaction that is always undone (tm_try_as),
-- so temporary grants, policies and disabled triggers never outlive it.
--
-- Real-marked rows are impossible before go-live. Section 8 relaxes the relevant CHECKs inside this
-- rolled-back transaction (PR 1.3 owner question Q3) and is last, so every earlier test runs against
-- the full set of constraints.
-- PR 1.6: review_items, visit_corrections and offline_operations reference service_calls and
-- visits, so the TRUNCATE probes of those two tables (and their temporary grants) list them too;
-- their own markers and guards are asserted in 230_integrity_schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Test-only helpers (pg_temp, rolled back) --------------------------------------------------------
-- tm_try_as: p_setup runs first as postgres (temporary grants, policies, disabled triggers), then
-- p_sql runs as p_role with the JWT claims of p_sub (none when NULL); everything is undone. Returns
-- 'ok' (or 'rows N' when p_rows), or the SQLSTATE plus the constraint name, the column (23502) or
-- the message.
create function pg_temp.tm_try_as(p_setup text, p_sub uuid, p_role text, p_sql text, p_rows boolean default false)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
  v_column text;
  v_message text;
  v_rows bigint;
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
      get diagnostics v_rows = row_count;
      -- Restores the file's constraint mode before the undo (see 160_call_status.test.sql: a SET
      -- CONSTRAINTS made inside a probe that succeeds would otherwise outlive the probe).
      set constraints all deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name,
        v_column = column_name, v_message = message_text;
      return v_state || ' ' || case when v_state = '23502' then v_column
                                    else coalesce(nullif(v_constraint, ''), v_message) end;
    end;
    v_result := case when p_rows then 'rows ' || v_rows else 'ok' end;
    raise exception using errcode = 'TM001', message = v_result;
  exception when sqlstate 'TM001' then
    get stacked diagnostics v_message = message_text;
    return v_message;
  end;
end
$f$;
create function pg_temp.tm_try(p_sql text)
returns text
language sql
as $f$ select pg_temp.tm_try_as(null, null, 'postgres', p_sql) $f$;

-- The scratch writer (V27): a postgres-owned SECURITY DEFINER function, the shape of every later
-- writer. API roles may call it; it runs its statement as postgres.
create function pg_temp.tm_definer_exec(p_sql text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $f$
begin
  execute p_sql;
end
$f$;
grant execute on function pg_temp.tm_definer_exec(text) to authenticated;

-- Temporary grants for service_role (it bypasses RLS, not grants): the seven tables and every table
-- their triggers read, so a refusal comes from a trigger or constraint, never from a missing grant.
create temporary table tm_setup (k text primary key, sql text not null) on commit drop;
insert into tm_setup values
  ('service_role',
   'grant select, insert, update, delete, truncate on public.service_calls, public.visits, public.visit_reports,
      public.visit_signatures, public.visit_time_reports, public.visit_events, public.entity_changes,
      public.review_items, public.visit_corrections, public.offline_operations to service_role;
    grant select on public.profiles, public.technicians, public.customers, public.products, public.call_types,
      public.followup_reasons, public.collection_locations to service_role'),
  ('authenticated_writes',
   'grant insert, update, delete, truncate on public.service_calls, public.visits, public.visit_reports,
      public.visit_signatures, public.visit_time_reports, public.visit_events, public.entity_changes,
      public.review_items, public.visit_corrections, public.offline_operations to authenticated');

create temporary table tm_case (
  n integer generated always as identity, grp text not null, label text not null, stmt text not null, expected text not null
) on commit drop;

-- ---------------------------------------------------------------------------------------------
-- 1. Fixtures (local, rolled back; fictional, example.test; D47). c1 is the only real profile (the
--    bootstrapped Creator, D49). Every write below sends is_test = false where the column can be
--    written: the triggers must ignore it.
--    Call 1 (automated_test): visit 1 closed done, as a Step 4 writer would close it (summary,
--    signature, status event, time report, recalculation). Call 2 (simulator, created by a1): visit
--    1 scheduled.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'b1', 'd1', 'd2', 'd9']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000601', 'C-1501', 'לקוח בדיקה א', '050-000-0001', 'automated_test', 'pr15-150-1'),
  ('00000000-0000-4000-8000-000000000602', 'C-1502', 'לקוח בדיקה ב', '050-000-0002', 'automated_test', 'pr15-150-2');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000501', 'kt-1501', 'KT-1501', 'מוצר בדיקה א', 'automated_test', 'pr15-150-1'),
  ('00000000-0000-4000-8000-000000000502', 'kt-1502', 'KT-1502', 'מוצר בדיקה ב', 'automated_test', 'pr15-150-2');
insert into public.call_types (id, label_he, sort_order, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000701', 'סוג בדיקה', 3, true, '00000000-0000-4000-8000-0000000000a1');
insert into public.followup_reasons (id, label_he, sort_order, is_user_added, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000801', 'סיבת בדיקה', 6, true, true, '00000000-0000-4000-8000-0000000000a1');
insert into public.collection_locations (id, name, place_type, sort_order, address, created_by) values
  ('00000000-0000-4000-8000-000000000901', 'מחסן בדיקה', 'branch', 1, 'רחוב הבדיקה 1', '00000000-0000-4000-8000-0000000000a1');

insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, handling_rep_profile_id, status, next_visit_number, data_source, source_ref, created_by)
values ('00000000-0000-4000-8000-00000000c001', 'REQ-1501', '00000000-0000-4000-8000-000000000601',
        '00000000-0000-4000-8000-000000000501', (select t.id from public.call_types t where t.sort_order = 1),
        'לא מקרר', 'נציג א', '00000000-0000-4000-8000-0000000000a1', 'open', 2, 'automated_test', 'pr15-150-c1',
        '00000000-0000-4000-8000-0000000000a1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, pickup_location_id, source_ref, is_test, created_by)
values ('00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000e1',
        1, 'T-1501', now() - interval '2 hours', now() - interval '1 hour', 'scheduled', 'חיפה', 'הנמל 1',
        '00000000-0000-4000-8000-000000000901', 'pr15-150-v11', false, '00000000-0000-4000-8000-0000000000a1');
insert into public.visit_events (visit_id, version_after, event_type, to_status, actor_profile_id, is_test)
values ('00000000-0000-4000-8000-00000000b011', 1, 'created', 'scheduled', '00000000-0000-4000-8000-0000000000a1', false);
update public.visits set status = 'done', updated_by = '00000000-0000-4000-8000-0000000000d1'
  where id = '00000000-0000-4000-8000-00000000b011';
insert into public.visit_reports (visit_id, summary_text, summary_source, created_by, is_test)
values ('00000000-0000-4000-8000-00000000b011', 'הוחלף מדחס', 'written', '00000000-0000-4000-8000-0000000000d1', false);
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, created_by, is_test)
values ('00000000-0000-4000-8000-00000000b011', 'ישראל ישראלי', 'אני מאשר שהעבודה בוצעה',
        encode(sha256(convert_to('אני מאשר שהעבודה בוצעה', 'UTF8')), 'hex'), '00000000-0000-4000-8000-00000000f011',
        '00000000-0000-4000-8000-0000000000d1', false);
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id, operation_id, is_test)
values ('00000000-0000-4000-8000-00000000b011', 2, 'status_changed', 'scheduled', 'done', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-00000000f011', false);
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
  device_utc_offset_min, device_sent_at, source, operation_id, is_test)
values ('00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
        'arrived', now() - interval '90 minutes', 'Asia/Jerusalem', 120, now(), 'device', '00000000-0000-4000-8000-00000000f012', false);
select is(private.recalc_call_status('00000000-0000-4000-8000-00000000c001'), 'resolved',
  'fixture: call 1 resolves when its only visit is closed done (recalculation as a writer would call it)');

insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, status, next_visit_number, data_source, source_ref, created_by)
values ('00000000-0000-4000-8000-00000000c002', 'REQ-1502', '00000000-0000-4000-8000-000000000602',
        '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000701', 'רעש חזק', 'נציג ב', 'open', 3,
        'simulator', 'sim-evt-1502', '00000000-0000-4000-8000-0000000000a1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, source_ref, is_test)
values ('00000000-0000-4000-8000-00000000b021', '00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000e2',
        1, 'T-1502', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'עכו', 'החומה 2',
        'sim-evt-1502', false);
insert into public.visit_events (visit_id, version_after, event_type, to_status, is_test)
values ('00000000-0000-4000-8000-00000000b021', 1, 'created', 'scheduled', false);
select lives_ok('set constraints all immediate',
  'fixture: both calls, their visits, the closure and its history pass the deferred checks (c10-c40)');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 2. Markers are copied from the parent; the client value is ignored (D47; V2, V13)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.t, x.is_test from (
       select 1 as n, 'visits'::text as t, v.is_test from public.visits v where v.id = '00000000-0000-4000-8000-00000000b011'
       union all select 2, 'visits (call 2)', v.is_test from public.visits v where v.id = '00000000-0000-4000-8000-00000000b021'
       union all select 3, 'visit_reports', r.is_test from public.visit_reports r where r.visit_id = '00000000-0000-4000-8000-00000000b011'
       union all select 4, 'visit_signatures', s.is_test from public.visit_signatures s where s.visit_id = '00000000-0000-4000-8000-00000000b011'
       union all select 5, 'visit_time_reports', t.is_test from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-00000000b011'
       union all select 6, 'visit_events (two)', bool_and(e.is_test) and count(*) = 2 from public.visit_events e
                 where e.visit_id = '00000000-0000-4000-8000-00000000b011'
       union all select 7, 'entity_changes (the recalculation''s two rows)', bool_and(c.is_test) and count(*) = 2
                 from public.entity_changes c where c.entity_id = '00000000-0000-4000-8000-00000000c001') x
     order by x.n $$,
  $$ values ('visits'::text, true), ('visits (call 2)', true), ('visit_reports', true), ('visit_signatures', true),
            ('visit_time_reports', true), ('visit_events (two)', true), ('entity_changes (the recalculation''s two rows)', true) $$,
  'D47: every child of a test call is stored as test data although the writer sent is_test = false (t15, t20 copy the marker)');

-- ---------------------------------------------------------------------------------------------
-- 3. The root marker: generated, fails closed, traceable
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected)
select 'data_source', v.label,
       format($s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
                   handling_rep_name, status, next_visit_number, data_source, source_ref, created_by)
                 values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
                         (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, %L,
                         'pr15-150-probe', '00000000-0000-4000-8000-0000000000a1')$s$, v.val),
       case when v.ok then 'ok' when v.val is null then '23502 data_source' else '23514 service_calls_data_source_check' end
from (values
  (1, 'simulator', 'simulator', true),
  (2, 'automated_test', 'automated_test', true),
  (3, 'microsoft_graph (real; only an approved Step 11 migration adds it)', 'microsoft_graph', false),
  (4, 'seed (no seed source, D47)', 'seed', false),
  (5, 'manual', 'manual', false),
  (6, 'upper-case SIMULATOR', 'SIMULATOR', false),
  (7, 'padded simulator', 'simulator ', false),
  (8, 'empty', '', false),
  (9, 'missing', null, false)
) v (n, label, val, ok)
order by v.n;
insert into tm_case (grp, label, stmt, expected) values
  ('generated', 'insert is_test',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
        handling_rep_name, status, next_visit_number, data_source, source_ref, is_test)
      values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'automated_test',
              'pr15-150-probe', false)$s$,
   '428C9 cannot insert a non-DEFAULT value into column "is_test"'),
  ('generated', 'update is_test',
   $s$update public.service_calls set is_test = false where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '428C9 column "is_test" can only be updated to DEFAULT'),
  ('generated', 'a simulator call without its creator',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
        handling_rep_name, status, next_visit_number, data_source, source_ref)
      values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'simulator',
              'sim-evt-9')$s$,
   '23514 service_calls_simulator_creator_check'),
  ('generated', 'an automated-test call without a creator (a test run)',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
        handling_rep_name, status, next_visit_number, data_source, source_ref)
      values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'automated_test',
              'pr15-150-probe')$s$,
   'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'data_source' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'data_source' order by c.n $$,
  'service_calls.data_source is required and only simulator or automated_test before go-live: no real or seed source (fails closed, D47)');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'generated' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'generated' order by c.n $$,
  'service_calls.is_test cannot be written, even as postgres (only data_source sets it); a simulator call names the user who created it');
select results_eq(
  $$ select c.request_number, c.data_source, c.is_test from public.service_calls c order by c.request_number collate "C" $$,
  $$ values ('REQ-1501'::text, 'automated_test'::text, true), ('REQ-1502', 'simulator', true) $$,
  'is_test is generated as true for the simulator and automated-test sources');

-- ---------------------------------------------------------------------------------------------
-- 4. Markers, frozen fields, append-only and immutable rows, delete and truncate (categories 6, 12)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected) values
  ('guards', 'marker: visits.is_test',
   $s$update public.visits set is_test = false where id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visits: these fields are immutable'),
  ('guards', 'marker: visit_reports.is_test',
   $s$update public.visit_reports set is_test = false where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_reports: these fields are immutable'),
  ('guards', 'marker: visit_signatures.is_test',
   $s$update public.visit_signatures set is_test = false where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_signatures is append-only'),
  ('guards', 'marker: visit_time_reports.is_test',
   $s$update public.visit_time_reports set is_test = false where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_time_reports is append-only'),
  ('guards', 'marker: visit_events.is_test',
   $s$update public.visit_events set is_test = false where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_events is append-only'),
  ('guards', 'marker: entity_changes.is_test',
   $s$update public.entity_changes set is_test = false where entity_id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 entity_changes is append-only'),
  ('guards', 'marker: service_calls.data_source (is_test follows it)',
   $s$update public.service_calls set data_source = 'simulator' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.customer_id (D39: a different customer goes to review, PR 1.6)',
   $s$update public.service_calls set customer_id = '00000000-0000-4000-8000-000000000602' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.product_id (D39: a different SKU goes to review)',
   $s$update public.service_calls set product_id = '00000000-0000-4000-8000-000000000502' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.request_number',
   $s$update public.service_calls set request_number = 'REQ-1599' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.opened_at (D45, D57)',
   $s$update public.service_calls set opened_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.source_ref',
   $s$update public.service_calls set source_ref = 'pr15-150-x' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: service_calls.created_by',
   $s$update public.service_calls set created_by = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 service_calls: these fields are immutable'),
  ('guards', 'frozen: visits.service_call_id',
   $s$update public.visits set service_call_id = '00000000-0000-4000-8000-00000000c001' where id = '00000000-0000-4000-8000-00000000b021'$s$,
   '55000 visits: these fields are immutable'),
  ('guards', 'frozen: visits.visit_number',
   $s$update public.visits set visit_number = 2 where id = '00000000-0000-4000-8000-00000000b021'$s$,
   '55000 visits: these fields are immutable'),
  ('guards', 'frozen: visits.source_ref',
   $s$update public.visits set source_ref = 'pr15-150-x' where id = '00000000-0000-4000-8000-00000000b021'$s$,
   '55000 visits: these fields are immutable'),
  ('guards', 'frozen: visits.created_at',
   $s$update public.visits set created_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-00000000b021'$s$,
   '55000 visits: these fields are immutable'),
  ('guards', 'frozen: visit_reports.created_by',
   $s$update public.visit_reports set created_by = '00000000-0000-4000-8000-0000000000a1' where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_reports: these fields are immutable'),
  ('guards', 'allowed: service_calls.customer_id set to its own value',
   $s$update public.service_calls set customer_id = customer_id where id = '00000000-0000-4000-8000-00000000c001'$s$, 'ok'),
  ('guards', 'allowed: service_calls.fault_description',
   $s$update public.service_calls set fault_description = 'לא מקרר, רעש' where id = '00000000-0000-4000-8000-00000000c001'$s$, 'ok'),
  ('guards', 'allowed: visits.tech_notes of an open visit',
   $s$update public.visits set tech_notes = 'להביא סולם' where id = '00000000-0000-4000-8000-00000000b021'$s$, 'ok'),
  ('guards', 'frozen: visit_reports.summary_text (PR 1.6 t11, OQ-7: corrections are visit_corrections rows)',
   $s$update public.visit_reports set summary_text = 'הוחלף מדחס ומאוורר' where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_reports: these fields are immutable'),
  ('guards', 'allowed: visit_reports bookkeeping (updated_by)',
   $s$update public.visit_reports set updated_by = '00000000-0000-4000-8000-0000000000c1' where visit_id = '00000000-0000-4000-8000-00000000b011'$s$, 'ok'),
  ('guards', 'update a signature',
   $s$update public.visit_signatures set signer_name = 'אחר' where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_signatures is append-only'),
  ('guards', 'delete a signature',
   $s$delete from public.visit_signatures where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_signatures is append-only'),
  ('guards', 'update a time report',
   $s$update public.visit_time_reports set reported_at = now() where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_time_reports is append-only'),
  ('guards', 'delete a time report',
   $s$delete from public.visit_time_reports where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_time_reports is append-only'),
  ('guards', 'update a status event',
   $s$update public.visit_events set to_status = 'followup' where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_events is append-only'),
  ('guards', 'delete a status event',
   $s$delete from public.visit_events where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_events is append-only'),
  ('guards', 'update a history row',
   $s$update public.entity_changes set source = 'edit' where entity_id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 entity_changes is append-only'),
  ('guards', 'delete a history row',
   $s$delete from public.entity_changes where entity_id = '00000000-0000-4000-8000-00000000c001'$s$,
   '55000 entity_changes is append-only'),
  ('guards', 'delete a call',
   $s$delete from public.service_calls where id = '00000000-0000-4000-8000-00000000c002'$s$,
   '55000 service_calls: rows are never deleted'),
  ('guards', 'delete a visit',
   $s$delete from public.visits where id = '00000000-0000-4000-8000-00000000b021'$s$,
   '55000 visits: rows are never deleted'),
  ('guards', 'delete a summary',
   $s$delete from public.visit_reports where visit_id = '00000000-0000-4000-8000-00000000b011'$s$,
   '55000 visit_reports: rows are never deleted'),
  ('guards', 'truncate visit_reports', 'truncate public.visit_reports', '55000 visit_reports cannot be truncated'),
  ('guards', 'truncate visit_signatures', 'truncate public.visit_signatures', '55000 visit_signatures cannot be truncated'),
  ('guards', 'truncate visit_time_reports', 'truncate public.visit_time_reports', '55000 visit_time_reports cannot be truncated'),
  ('guards', 'truncate visit_events', 'truncate public.visit_events', '55000 visit_events cannot be truncated'),
  ('guards', 'truncate entity_changes', 'truncate public.entity_changes', '55000 entity_changes cannot be truncated'),
  ('guards', 'truncate visits with its children',
   'truncate public.visits, public.visit_reports, public.visit_signatures, public.visit_time_reports, public.visit_events, public.review_items, public.visit_corrections, public.offline_operations',
   '55000 visits cannot be truncated'),
  ('guards', 'truncate service_calls with every table that references it',
   'truncate public.service_calls, public.visits, public.visit_reports, public.visit_signatures, public.visit_time_reports, public.visit_events, public.review_items, public.visit_corrections, public.offline_operations',
   '55000 service_calls cannot be truncated');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'guards' and c.label like 'marker:%' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'guards' and c.label like 'marker:%' order by c.n $$,
  'as postgres: no marker changes (D47): t10 freezes them on the editable tables, the append-only tables refuse every update');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c
     where c.grp = 'guards' and (c.label like 'frozen:%' or c.label like 'allowed:%') order by c.n $$,
  $$ select c.label, c.expected from tm_case c
     where c.grp = 'guards' and (c.label like 'frozen:%' or c.label like 'allowed:%') order by c.n $$,
  'as postgres: the request number, customer and product (D39, until the PR 1.6 review), opened_at, sources, call and number of a visit and creation fields never change; the listed fields do');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c
     where c.grp = 'guards' and not (c.label like 'marker:%' or c.label like 'frozen:%' or c.label like 'allowed:%') order by c.n $$,
  $$ select c.label, c.expected from tm_case c
     where c.grp = 'guards' and not (c.label like 'marker:%' or c.label like 'frozen:%' or c.label like 'allowed:%') order by c.n $$,
  'as postgres: signatures are immutable, time reports, status events and history are append-only, no call, visit or summary is deleted and no table is truncated');

-- Defence in depth: with t10 disabled (inside the probe only), t20 still freezes the marker.
select results_eq(
  $$ select pg_temp.tm_try('alter table public.visits disable trigger t10_immutable;
                            update public.visits set is_test = false where id = ''00000000-0000-4000-8000-00000000b021''')
     union all
     select pg_temp.tm_try('alter table public.visit_reports disable trigger t10_immutable;
                            alter table public.visit_reports disable trigger t11_frozen;
                            update public.visit_reports set is_test = false where visit_id = ''00000000-0000-4000-8000-00000000b011''') $$,
  $$ values ('55000 visits: test-data markers are immutable (D47)'::text),
            ('55000 visit_reports: test-data markers are immutable (D47)') $$,
  'with the t10 guard (and PR 1.6''s t11 on visit_reports) disabled, t20 (tg_immutable_markers) still freezes is_test on visits and visit_reports');

-- service_role bypasses RLS, not grants or triggers: with temporary grants every guard holds.
select results_eq(
  $$ select c.label, pg_temp.tm_try_as((select s.sql from tm_setup s where s.k = 'service_role'), null, 'service_role', c.stmt)
     from tm_case c where c.grp = 'guards' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'guards' order by c.n $$,
  'as service_role with temporary table grants: the same markers, frozen fields, append-only rows, delete and truncate guards hold');

-- API roles: no write grant (42501); with a temporary grant there is no write policy, so an UPDATE
-- or DELETE reaches no row (TRUNCATE, which RLS does not cover, reaches the trigger).
select results_eq(
  $$ select c.label, left(pg_temp.tm_try_as(null, '00000000-0000-4000-8000-0000000000c1', 'authenticated', c.stmt), 5)
     from tm_case c where c.grp = 'guards' order by c.n $$,
  $$ select c.label, '42501'::text from tm_case c where c.grp = 'guards' order by c.n $$,
  'the Creator: every direct update, delete and truncate is refused (no grant, 42501)');
select results_eq(
  $$ select c.label, pg_temp.tm_try_as((select s.sql from tm_setup s where s.k = 'authenticated_writes'),
                                       '00000000-0000-4000-8000-0000000000c1', 'authenticated', c.stmt, true)
     from tm_case c where c.grp = 'guards' and c.stmt !~* '^truncate' order by c.n $$,
  $$ select c.label, 'rows 0'::text from tm_case c where c.grp = 'guards' and c.stmt !~* '^truncate' order by c.n $$,
  'the Creator with a temporary write grant: every update and delete reaches 0 rows (no write policy, RLS)');
select results_eq(
  $$ select c.label, pg_temp.tm_try_as((select s.sql from tm_setup s where s.k = 'authenticated_writes'),
                                       '00000000-0000-4000-8000-0000000000c1', 'authenticated', c.stmt)
     from tm_case c where c.grp = 'guards' and c.stmt ~* '^truncate' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'guards' and c.stmt ~* '^truncate' order by c.n $$,
  'the Creator with a temporary TRUNCATE grant: the truncate trigger refuses every table (RLS does not cover TRUNCATE)');
select results_eq(
  $$ select x.k, x.n from (
       select 1 as o, 'visits rows of call 1'::text as k, count(*) as n from public.visits v
         where v.service_call_id = '00000000-0000-4000-8000-00000000c001' and v.is_test and v.status = 'done'
       union all select 2, 'signatures', count(*) from public.visit_signatures s where s.signer_name = 'ישראל ישראלי' and s.is_test
       union all select 3, 'events', count(*) from public.visit_events e where e.visit_id = '00000000-0000-4000-8000-00000000b011'
       union all select 4, 'history rows', count(*) from public.entity_changes c where c.source = 'system' and c.is_test) x
     order by x.o $$,
  $$ values ('visits rows of call 1'::text, 1::bigint), ('signatures', 1), ('events', 2), ('history rows', 2) $$,
  'nothing was changed or removed by the refused writes');

-- ---------------------------------------------------------------------------------------------
-- 5. entity_changes: marker from the target, generic refusals, value rules (V25; DEV-8)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, source_ref, changed_at, is_test)
     values ('customers', '00000000-0000-4000-8000-000000000601', 'phone', '"050-000-0009"', '"050-000-0001"', 'invitation',
             'sim-evt-1', '2000-01-01T00:00:00Z', false),
            ('products', '00000000-0000-4000-8000-000000000501', 'name', '"מוצר"', '"מוצר בדיקה א"', 'edit', null,
             '2000-01-01T00:00:00Z', false),
            ('service_calls', '00000000-0000-4000-8000-00000000c002', 'warranty_status', null, '"no"', 'invitation',
             'sim-evt-1502', '2000-01-01T00:00:00Z', false),
            ('visits', '00000000-0000-4000-8000-00000000b021', 'scheduled_start', '"2026-11-06T08:00:00+00:00"',
             '"2026-11-07T08:00:00+00:00"', 'invitation', 'sim-evt-1502', '2000-01-01T00:00:00Z', false)
     returning entity_table, is_test, changed_at = now() $$,
  $$ values ('customers'::text, true, true), ('products', true, true), ('service_calls', true, true), ('visits', true, true) $$,
  'entity_changes: is_test comes from each of the four target tables and changed_at is the server time; the client values are ignored');

select results_eq(
  $$ insert into public.visit_events (visit_id, version_after, event_type, to_status, recorded_at, is_test)
     values ('00000000-0000-4000-8000-00000000b021', 1, 'created', 'scheduled', '2000-01-01T00:00:00Z', false)
     returning recorded_at = now(), is_test $$,
  $$ values (true, true) $$,
  'visit_events: recorded_at is the server time (t16) and is_test comes from the visit; the client values are ignored');

insert into tm_case (grp, label, stmt, expected)
select 'history', v.label,
       format($s$insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, source_ref)
                 values (%L, %L, %L, %L::jsonb, %L::jsonb, %L, %L)$s$, v.tbl, v.id, v.fld, v.old, v.new, v.src, v.ref),
       v.expected
from (values
  (1, 'an unknown target', 'service_calls', '00000000-0000-4000-8000-00000000c0ff', 'status', '"open"', '"resolved"', 'system', null,
   '23503 entity_changes: unknown target'),
  (2, 'a visit id named as a call', 'service_calls', '00000000-0000-4000-8000-00000000b021', 'status', '"open"', '"resolved"', 'system', null,
   '23503 entity_changes: unknown target'),
  (3, 'a field that is not a column of the target', 'service_calls', '00000000-0000-4000-8000-00000000c002', 'warranty', '"open"', '"x"',
   'invitation', null, '23514 entity_changes: invalid change record'),
  (4, 'a column of another table', 'customers', '00000000-0000-4000-8000-000000000601', 'sku_display', '"a"', '"b"', 'invitation', null,
   '23514 entity_changes: invalid change record'),
  (5, 'a system column', 'visits', '00000000-0000-4000-8000-00000000b021', 'ctid', '"a"', '"b"', 'system', null,
   '23514 entity_changes: invalid change record'),
  (6, 'an account (profiles is not a target, PR 1.3 Q4)', 'profiles', '00000000-0000-4000-8000-0000000000a1', 'full_name', '"a"', '"b"',
   'edit', null, '23514 entity_changes: invalid change record'),
  (7, 'no field', 'visits', '00000000-0000-4000-8000-00000000b021', null, '"a"', '"b"', 'system', null,
   '23514 entity_changes: invalid change record'),
  (8, 'a JSON null new value (SQL NULL means no value)', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', 'null',
   'invitation', null, '23514 entity_changes_new_value_check'),
  (9, 'a JSON null old value', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', 'null', '"a"', 'invitation', null,
   '23514 entity_changes_old_value_check'),
  (10, 'a new value of 20000 characters', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', null,
   to_jsonb(repeat('א', 20000))::text, 'invitation', null, '23514 entity_changes_new_value_check'),
  (11, 'an old value of 20000 characters', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes',
   to_jsonb(repeat('a', 20000))::text, null, 'invitation', null, '23514 entity_changes_old_value_check'),
  (12, 'a value of 16000 ASCII characters', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', null,
   to_jsonb(repeat('a', 16000))::text, 'invitation', null, 'ok'),
  (13, 'a new value without an old one', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', null, '"a"', 'invitation', null, 'ok'),
  (14, 'an old value cleared', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', null, 'invitation', null, 'ok'),
  (15, 'neither value', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', null, null, 'invitation', null,
   '23514 entity_changes_value_check'),
  (16, 'equal values', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', '"a"', 'invitation', null,
   '23514 entity_changes_value_check'),
  (17, 'another source', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', '"b"', 'import', null,
   '23514 entity_changes_source_check'),
  (18, 'a source reference with a space', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', '"b"', 'invitation',
   'sim evt', '23514 entity_changes_source_ref_check'),
  (19, 'each source: correction', 'visits', '00000000-0000-4000-8000-00000000b021', 'tech_notes', '"a"', '"b"', 'correction', null, 'ok'),
  (20, 'merge', 'customers', '00000000-0000-4000-8000-000000000601', 'name', '"a"', '"b"', 'merge', null, 'ok'),
  (21, 'rejected_submission', 'visits', '00000000-0000-4000-8000-00000000b021', 'status', '"scheduled"', '"done"',
   'rejected_submission', 'op-1', 'ok')
) v (n, label, tbl, id, fld, old, new, src, ref, expected)
order by v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'history' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'history' order by c.n $$,
  'entity_changes: an unknown target (23503) or a field that is not a column of the target (23514) is refused with a generic message; JSON null, values over 16 KB and no-change rows are refused (V25)');
select results_eq(
  $$ select pg_temp.tm_try_as(null, null, 'postgres', c.stmt) ~ '(c0ff|b021|warranty|sku_display|ctid|full_name)'
     from tm_case c where c.grp = 'history' and c.expected like '2350%' or (c.grp = 'history' and c.expected like '%invalid change record')
     order by c.n $$,
  $$ values (false), (false), (false), (false), (false), (false), (false) $$,
  'the trigger messages never echo the target id or the field name');

-- write_entity_change takes the actor from the session (no actor parameter; M47).
create temporary table tm_history_ids (k text primary key, id bigint not null) on commit drop;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into tm_history_ids select 'with a session', private.write_entity_change('visits', '00000000-0000-4000-8000-00000000b021',
  'task_number', '"T-1500"', '"T-1502"', 'invitation', 'sim-evt-1502');
select set_config('request.jwt.claims', '', true);
insert into tm_history_ids select 'without a session', private.write_entity_change('customers', '00000000-0000-4000-8000-000000000602',
  'name', '"לקוח"', '"לקוח בדיקה ב"', 'invitation', null);
select results_eq(
  $$ select i.k, c.actor_profile_id, c.is_test, c.entity_table, c.field, c.source
     from tm_history_ids i join public.entity_changes c on c.id = i.id order by i.k collate "C" $$,
  $$ values ('with a session'::text, '00000000-0000-4000-8000-0000000000a1'::uuid, true, 'visits'::text, 'task_number'::text, 'invitation'::text),
            ('without a session', null, true, 'customers', 'name', 'invitation') $$,
  'write_entity_change records auth.uid() of the session as the actor (NULL without one: Graph ingestion, a system recalculation) and the target''s marker');

-- ---------------------------------------------------------------------------------------------
-- 6. Census (D47; category 12): the nine new rows count exactly the test-marked rows
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.table_name, c.bucket, c.test_rows from public.test_data_census() c
     where c.table_name in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports', 'visit_events',
                            'entity_changes') $$,
  $$ values ('service_calls'::text, 'simulator'::text, 1::bigint), ('service_calls', 'automated_test', 1),
            ('service_calls', 'other sources', 0),
            ('visits', 'all sources', (select count(*) from public.visits where is_test)),
            ('visit_reports', 'all sources', (select count(*) from public.visit_reports where is_test)),
            ('visit_signatures', 'all sources', (select count(*) from public.visit_signatures where is_test)),
            ('visit_time_reports', 'all sources', (select count(*) from public.visit_time_reports where is_test)),
            ('visit_events', 'all sources', (select count(*) from public.visit_events where is_test)),
            ('entity_changes', 'all sources', (select count(*) from public.entity_changes where is_test)) $$,
  'the census counts calls per source and every test-marked visit, summary, signature, time report, event and history row');
select is(
  (select count(*) from public.visits) + (select count(*) from public.visit_reports) + (select count(*) from public.visit_signatures)
  + (select count(*) from public.visit_time_reports) + (select count(*) from public.visit_events),
  (select sum(c.test_rows)::bigint from public.test_data_census() c
   where c.table_name in ('visits', 'visit_reports', 'visit_signatures', 'visit_time_reports', 'visit_events')),
  'every visit row and every child row of this file is counted (all of them are test data)');



-- ---------------------------------------------------------------------------------------------
-- 7. Fail closed (§2.8; M45): a SECURITY INVOKER trigger reads under the caller's RLS. A caller
--    with a bare temporary INSERT grant reaches the BEFORE triggers before RLS refuses the row
--    (V27 finding), so a referenced row he cannot see is reported as missing (23503), never
--    treated as real or as test. Each control, with visible references, reaches the RLS refusal
--    (42501) instead.
-- ---------------------------------------------------------------------------------------------
create temporary table tm_fc (
  n integer generated always as identity, grp text not null, label text not null, sub uuid not null, setup text not null,
  stmt text not null, expected text not null
) on commit drop;
insert into tm_fc (grp, label, sub, setup, stmt, expected) values
  ('test', 'Technician B: a status event on A''s visit (t15 cannot read the visit)', '00000000-0000-4000-8000-0000000000d2',
   'grant insert on public.visit_events to authenticated',
   $s$insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
      values ('00000000-0000-4000-8000-00000000b011', 3, 'status_changed', 'done', 'followup')$s$,
   '23503 visit_events: unknown visit'),
  ('test', 'control: Technician A on his own visit', '00000000-0000-4000-8000-0000000000d1',
   'grant insert on public.visit_events to authenticated',
   $s$insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
      values ('00000000-0000-4000-8000-00000000b011', 3, 'status_changed', 'done', 'followup')$s$,
   '42501 new row violates row-level security policy for table "visit_events"'),
  ('test', 'Technician B: a summary on A''s visit', '00000000-0000-4000-8000-0000000000d2',
   'grant insert on public.visit_reports to authenticated',
   $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
      values ('00000000-0000-4000-8000-00000000b011', 'סיכום', 'written')$s$,
   '23503 visit_reports: unknown visit'),
  ('test', 'Technician A: a visit on a call he cannot read (t15)', '00000000-0000-4000-8000-0000000000d1',
   'grant insert on public.visits to authenticated',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
        status, city, street, source_ref, is_test)
      values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2', now(), now(),
              'scheduled', 'חיפה', 'הנמל 1', 'pr15-150-probe', true)$s$,
   '23503 visits: unknown service call'),
  ('test', 'control: the Manager on the same call', '00000000-0000-4000-8000-0000000000a1',
   'grant insert on public.visits to authenticated',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
        status, city, street, source_ref, is_test)
      values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2', now(), now(),
              'scheduled', 'חיפה', 'הנמל 1', 'pr15-150-probe', true)$s$,
   '42501 new row violates row-level security policy for table "visits"'),
  ('test', 'Technician A: a time report crediting Technician B, whose record he cannot read (t35)',
   '00000000-0000-4000-8000-0000000000d1', 'grant insert on public.visit_time_reports to authenticated',
   $s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id)
      values ('00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2',
              'ended', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid())$s$,
   '23503 visit_time_reports: unknown technician'),
  ('test', 'control: crediting himself', '00000000-0000-4000-8000-0000000000d1',
   'grant insert on public.visit_time_reports to authenticated',
   $s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id)
      values ('00000000-0000-4000-8000-00000000b011', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
              'ended', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid())$s$,
   '42501 new row violates row-level security policy for table "visit_time_reports"'),
  ('test', 'Technician A: a history row on a call he cannot read (t20)', '00000000-0000-4000-8000-0000000000d1',
   'grant insert on public.entity_changes to authenticated',
   $s$insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source)
      values ('service_calls', '00000000-0000-4000-8000-00000000c002', 'status', '"open"', '"resolved"', 'system')$s$,
   '23503 entity_changes: unknown target'),
  ('test', 'control: the Manager on the same call', '00000000-0000-4000-8000-0000000000a1',
   'grant insert on public.entity_changes to authenticated',
   $s$insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source)
      values ('service_calls', '00000000-0000-4000-8000-00000000c002', 'status', '"open"', '"resolved"', 'system')$s$,
   '42501 new row violates row-level security policy for table "entity_changes"');
select results_eq(
  $$ select f.label, pg_temp.tm_try_as(f.setup, f.sub, 'authenticated', f.stmt) from tm_fc f where f.grp = 'test' order by f.n $$,
  $$ select f.label, f.expected from tm_fc f where f.grp = 'test' order by f.n $$,
  'fail closed: the marker, time-report and history triggers report a visit, call or technician the caller cannot read as missing (23503); with visible rows the write reaches the RLS refusal (42501)');

-- ---------------------------------------------------------------------------------------------
-- 8. Simulated go-live (rolled back): real rows and the one-way rule (D47). The pre-go-live
--    CHECKs are relaxed here only; d9 is a real Technician (e9). Real call R has real visit 1
--    (scheduled) and next_visit_number 3; call 2 (test) also accepts a visit 2.
-- ---------------------------------------------------------------------------------------------
alter table public.service_calls drop constraint service_calls_data_source_check;
alter table public.customers drop constraint customers_data_source_check;
alter table public.products drop constraint products_data_source_check;
alter table public.collection_locations drop constraint collection_locations_test_until_golive_check;

insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000d9', 'technician', 'טכנאי אמיתי', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000d9', false, 'טכנאי אמיתי', 't-g', 'tech-real@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref, created_by) values
  ('00000000-0000-4000-8000-000000000611', 'R-1501', 'לקוח אמיתי', '050-000-0011', 'microsoft_graph', 'graph-1',
   '00000000-0000-4000-8000-0000000000c1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref, created_by) values
  ('00000000-0000-4000-8000-000000000511', 'rp-1501', 'RP-1501', 'מוצר אמיתי', 'microsoft_graph', 'graph-1',
   '00000000-0000-4000-8000-0000000000c1');
insert into public.collection_locations (id, name, place_type, sort_order, address, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000911', 'מחסן אמיתי', 'branch', 11, 'רחוב אמיתי 1', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, handling_rep_profile_id, status, next_visit_number, data_source, source_ref, created_by)
values ('00000000-0000-4000-8000-00000000c0f1', 'REQ-15R1', '00000000-0000-4000-8000-000000000611',
        '00000000-0000-4000-8000-000000000511', (select t.id from public.call_types t where t.sort_order = 1), 'לא מקרר',
        'יוצר', '00000000-0000-4000-8000-0000000000c1', 'open', 3, 'microsoft_graph', 'graph-evt-1',
        '00000000-0000-4000-8000-0000000000c1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, pickup_location_id, followup_reason_id, source_ref, is_test, created_by)
values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        1, 'T-15R1', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'חיפה', 'הנמל 1',
        '00000000-0000-4000-8000-000000000911', (select r.id from public.followup_reasons r where r.sort_order = 1),
        'graph-evt-1', true, '00000000-0000-4000-8000-0000000000c1');
insert into public.visit_events (visit_id, version_after, event_type, to_status, actor_profile_id, is_test)
values ('00000000-0000-4000-8000-00000000b0f1', 1, 'created', 'scheduled', '00000000-0000-4000-8000-0000000000c1', true);
-- A source added later without updating the generated expression counts as test data.
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-00000000c003', 'REQ-1503', '00000000-0000-4000-8000-000000000601',
        '00000000-0000-4000-8000-000000000501', (select t.id from public.call_types t where t.sort_order = 1), 'תקלה',
        'נציג', 'open', 2, 'later_source', 'pr15-150-c3');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, source_ref, is_test)
values ('00000000-0000-4000-8000-00000000b031', '00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-0000000000e1',
        1, 'T-1503', now(), now(), 'scheduled', 'חיפה', 'הנמל 3', 'pr15-150-v31', false);
insert into public.visit_events (visit_id, version_after, event_type, to_status, is_test)
values ('00000000-0000-4000-8000-00000000b031', 1, 'created', 'scheduled', false);
select lives_ok('set constraints all immediate', 'simulated go-live fixture: the real call and its visit pass the deferred checks');
set constraints all deferred;

select results_eq(
  $$ select x.k, x.is_test from (
       select 1 as n, 'real call (microsoft_graph)'::text as k, c.is_test from public.service_calls c
         where c.id = '00000000-0000-4000-8000-00000000c0f1'
       union all select 2, 'its visit (the writer sent is_test = true)', v.is_test from public.visits v
         where v.id = '00000000-0000-4000-8000-00000000b0f1'
       union all select 3, 'its created event (the writer sent is_test = true)', e.is_test from public.visit_events e
         where e.visit_id = '00000000-0000-4000-8000-00000000b0f1'
       union all select 4, 'a call from a later source', c.is_test from public.service_calls c
         where c.id = '00000000-0000-4000-8000-00000000c003') x
     order by x.n $$,
  $$ values ('real call (microsoft_graph)'::text, false), ('its visit (the writer sent is_test = true)', false),
            ('its created event (the writer sent is_test = true)', false), ('a call from a later source', true) $$,
  'simulated go-live: microsoft_graph generates is_test = false and the children copy it (V2); a source added later counts as test data (fails safe)');
select results_eq(
  $$ select c.bucket, c.test_rows from public.test_data_census() c where c.table_name = 'service_calls' $$,
  $$ values ('simulator'::text, 1::bigint), ('automated_test', 1), ('other sources', 1) $$,
  'the census counts the later-source call under other sources and never counts the real call');

-- 8.1 The one-way rule: a real row never references a test technician, place, reason, call type or
--     profile; a test row may reference real rows.
insert into tm_case (grp, label, stmt, expected) values
  ('one_way', 'a real visit assigned to a test technician',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2',
        now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2')$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a real visit with a test pickup place',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, pickup_location_id, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000901', 'graph-evt-2')$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a real visit with a test continuation reason',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, followup_reason_id, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000801', 'graph-evt-2')$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a real visit created by a test profile',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref, created_by) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 visits: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a real visit re-assigned to a test technician',
   $s$update public.visits set technician_id = '00000000-0000-4000-8000-0000000000e1' where id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a real visit gets a test pickup place',
   $s$update public.visits set pickup_location_id = '00000000-0000-4000-8000-000000000901' where id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a real visit gets a test continuation reason',
   $s$update public.visits set followup_reason_id = '00000000-0000-4000-8000-000000000801' where id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visits: a real record cannot reference test data (D47)'),
  ('one_way', 'a test profile updates a real visit',
   $s$update public.visits set tech_notes = 'הערה', updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visits: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a test profile cancels a real visit',
   $s$update public.visits set status = 'cancelled', cancelled_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visits: a real record cannot reference a test profile (D47)'),
  ('one_way', 'control: a real visit with real references',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, pickup_location_id, followup_reason_id, source_ref, created_by)
      values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9', 2, 'T-2', now(), now(), 'scheduled',
              'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000911', (select r.id from public.followup_reasons r where r.sort_order = 2),
              'graph-evt-2', '00000000-0000-4000-8000-0000000000c1')$s$,
   'ok'),
  ('one_way', 'control: a test visit with real references',
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, pickup_location_id, followup_reason_id, source_ref, created_by)
      values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000e9', 2, 'T-2', now(), now(), 'scheduled',
              'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000911', (select r.id from public.followup_reasons r where r.sort_order = 2),
              'sim-evt-2', '00000000-0000-4000-8000-0000000000c1')$s$,
   'ok'),
  ('one_way', 'a real call with a test representative profile',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        handling_rep_profile_id, status, next_visit_number, data_source, source_ref)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000511',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'מנהל א', '00000000-0000-4000-8000-0000000000a1',
              'open', 2, 'microsoft_graph', 'graph-evt-3')$s$,
   '23514 service_calls: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a real call created by a test profile',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref, created_by)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000511',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'microsoft_graph',
              'graph-evt-3', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 service_calls: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a test profile updates a real call',
   $s$update public.service_calls set fault_description = 'תקלה אחרת', updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-00000000c0f1'$s$,
   '23514 service_calls: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a real call gets a test representative profile',
   $s$update public.service_calls set handling_rep_profile_id = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-00000000c0f1'$s$,
   '23514 service_calls: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a real call with a test call type',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000511',
              '00000000-0000-4000-8000-000000000701', 'תקלה', 'נציג', 'open', 2, 'microsoft_graph', 'graph-evt-3')$s$,
   '23514 service_calls: a real record cannot reference test data (D47)'),
  ('one_way', 'a real call gets a test call type',
   $s$update public.service_calls set call_type_id = '00000000-0000-4000-8000-000000000701'
      where id = '00000000-0000-4000-8000-00000000c0f1'$s$,
   '23514 service_calls: a real record cannot reference test data (D47)'),
  ('one_way', 'control: a real call with real references',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        handling_rep_profile_id, status, next_visit_number, data_source, source_ref, created_by)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000511',
              (select t.id from public.call_types t where t.sort_order = 2), 'תקלה', 'יוצר', '00000000-0000-4000-8000-0000000000c1',
              'open', 2, 'microsoft_graph', 'graph-evt-3', '00000000-0000-4000-8000-0000000000c1')$s$,
   'ok'),
  ('one_way', 'control: a test call with a real representative and call type',
   $s$update public.service_calls set handling_rep_profile_id = '00000000-0000-4000-8000-0000000000c1',
        call_type_id = (select t.id from public.call_types t where t.sort_order = 2), updated_by = '00000000-0000-4000-8000-0000000000c1'
      where id = '00000000-0000-4000-8000-00000000c002'$s$,
   'ok'),
  ('one_way', 'a summary on a real visit written by a test profile',
   $s$insert into public.visit_reports (visit_id, summary_text, summary_source, created_by)
      values ('00000000-0000-4000-8000-00000000b0f1', 'סיכום', 'written', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 visit_reports: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a summary on a real visit updated by a test profile (PR 1.6: only bookkeeping may change)',
   $s$insert into public.visit_reports (visit_id, summary_text, summary_source, created_by)
      values ('00000000-0000-4000-8000-00000000b0f1', 'סיכום', 'written', '00000000-0000-4000-8000-0000000000c1');
      update public.visit_reports set updated_by = '00000000-0000-4000-8000-0000000000a1'
      where visit_id = '00000000-0000-4000-8000-00000000b0f1'$s$,
   '23514 visit_reports: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a signature on a real visit recorded by a test profile',
   $s$insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, created_by)
      values ('00000000-0000-4000-8000-00000000b0f1', 'חותם', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
              gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 visit_signatures: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a time report on a real visit by a test reporter',
   $s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id)
      values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
              'departed', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid())$s$,
   '23514 visit_time_reports: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a time report on a real visit crediting a test technician',
   $s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id)
      values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000e1',
              'departed', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid())$s$,
   '23514 visit_time_reports: a real record cannot reference test data (D47)'),
  ('one_way', 'a status event on a real visit by a test actor',
   $s$insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id)
      values ('00000000-0000-4000-8000-00000000b0f1', 2, 'status_changed', 'scheduled', 'en_route', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 visit_events: a real record cannot reference a test profile (D47)'),
  ('one_way', 'a history row on a real call by a test actor',
   $s$insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, actor_profile_id)
      values ('service_calls', '00000000-0000-4000-8000-00000000c0f1', 'fault_description', '"א"', '"ב"', 'edit',
              '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 entity_changes: a real record cannot reference a test profile (D47)'),
  ('one_way', 'control: the real Technician reports his own time on the real visit',
   $s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id)
      values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000e9',
              'departed', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid())$s$,
   'ok'),
  ('one_way', 'control: a status event on the real visit by the real Creator',
   $s$insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id)
      values ('00000000-0000-4000-8000-00000000b0f1', 2, 'status_changed', 'scheduled', 'en_route', '00000000-0000-4000-8000-0000000000c1')$s$,
   'ok'),
  ('one_way', 'control: a history row on the real call without an actor',
   $s$insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source)
      values ('service_calls', '00000000-0000-4000-8000-00000000c0f1', 'fault_description', '"א"', '"ב"', 'system')$s$,
   'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way' order by c.n $$,
  'as postgres: a real call, visit, summary, signature, time report, event or history row never references a test technician, place, reason, call type or profile, on INSERT and UPDATE; a test row may reference real rows');
select results_eq(
  $$ select c.label, pg_temp.tm_try_as((select s.sql from tm_setup s where s.k = 'service_role'), null, 'service_role', c.stmt)
     from tm_case c where c.grp = 'one_way' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way' order by c.n $$,
  'as service_role with temporary grants: the same one-way refusals');
select results_eq(
  $$ select c.label, pg_temp.tm_try_as(null, '00000000-0000-4000-8000-0000000000d1', 'authenticated',
                                       'select pg_temp.tm_definer_exec(' || quote_literal(c.stmt) || ')')
     from tm_case c where c.grp = 'one_way' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way' order by c.n $$,
  'through a postgres-owned SECURITY DEFINER writer called by a Technician (the shape of every later writer): the same one-way refusals');

-- 8.2 The composite foreign keys (V1): with the marker trigger disabled inside the probe only, a
--     real-marked child under a test parent and a test-marked child under a real parent are refused.
insert into tm_case (grp, label, stmt, expected) values
  ('composite', 'a real-marked visit under a test call',
   $s$alter table public.visits disable trigger t15_marker_from_call;
      insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref, is_test) values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000e9', 2,
        'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'pr15-150-probe', false)$s$,
   '23503 visits_service_call_id_fkey'),
  ('composite', 'a test-marked visit under a real call',
   $s$alter table public.visits disable trigger t15_marker_from_call;
      insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref, is_test) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e1', 2,
        'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2', true)$s$,
   '23503 visits_service_call_id_fkey'),
  ('composite', 'control: the matching marker with the trigger disabled',
   $s$alter table public.visits disable trigger t15_marker_from_call;
      insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref, is_test) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9', 2,
        'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2', false)$s$,
   'ok'),
  ('composite', 'a real-marked summary on a test visit',
   $s$alter table public.visit_reports disable trigger t15_marker_from_visit;
      insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
      values ('00000000-0000-4000-8000-00000000b021', 'סיכום', 'written', false)$s$,
   '23503 visit_reports_visit_id_fkey'),
  ('composite', 'a test-marked summary on a real visit',
   $s$alter table public.visit_reports disable trigger t15_marker_from_visit;
      insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
      values ('00000000-0000-4000-8000-00000000b0f1', 'סיכום', 'written', true)$s$,
   '23503 visit_reports_visit_id_fkey'),
  ('composite', 'a real-marked signature on a test visit',
   $s$alter table public.visit_signatures disable trigger t15_marker_from_visit;
      insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
      values ('00000000-0000-4000-8000-00000000b021', 'חותם', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
              gen_random_uuid(), false)$s$,
   '23503 visit_signatures_visit_id_fkey'),
  ('composite', 'a test-marked signature on a real visit',
   $s$alter table public.visit_signatures disable trigger t15_marker_from_visit;
      insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
      values ('00000000-0000-4000-8000-00000000b0f1', 'חותם', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
              gen_random_uuid(), true)$s$,
   '23503 visit_signatures_visit_id_fkey'),
  ('composite', 'a real-marked time report on a test visit',
   $s$alter table public.visit_time_reports disable trigger t15_marker_from_visit;
      insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id, is_test)
      values ('00000000-0000-4000-8000-00000000b021', '00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000e9',
              'departed', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid(), false)$s$,
   '23503 visit_time_reports_visit_id_fkey'),
  ('composite', 'a test-marked time report on a real visit',
   $s$alter table public.visit_time_reports disable trigger t15_marker_from_visit;
      insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
        device_utc_offset_min, device_sent_at, source, operation_id, is_test)
      values ('00000000-0000-4000-8000-00000000b0f1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
              'departed', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid(), true)$s$,
   '23503 visit_time_reports_visit_id_fkey'),
  ('composite', 'a real-marked status event on a test visit',
   $s$alter table public.visit_events disable trigger t15_marker_from_visit;
      insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
      values ('00000000-0000-4000-8000-00000000b021', 2, 'status_changed', 'scheduled', 'en_route', false)$s$,
   '23503 visit_events_visit_id_fkey'),
  ('composite', 'a test-marked status event on a real visit',
   $s$alter table public.visit_events disable trigger t15_marker_from_visit;
      insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
      values ('00000000-0000-4000-8000-00000000b0f1', 2, 'status_changed', 'scheduled', 'en_route', true)$s$,
   '23503 visit_events_visit_id_fkey'),
  ('composite', 'a real call for a test customer',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000511',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'microsoft_graph', 'graph-evt-3')$s$,
   '23503 service_calls_customer_id_fkey'),
  ('composite', 'a test call for a real customer',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref)
      values ('REQ-1504', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'automated_test', 'pr15-150-probe')$s$,
   '23503 service_calls_customer_id_fkey'),
  ('composite', 'a real call for a test product',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref)
      values ('REQ-15R2', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'microsoft_graph', 'graph-evt-3')$s$,
   '23503 service_calls_product_id_fkey'),
  ('composite', 'a test call for a real product',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description, handling_rep_name,
        status, next_visit_number, data_source, source_ref)
      values ('REQ-1504', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000511',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'automated_test', 'pr15-150-probe')$s$,
   '23503 service_calls_product_id_fkey');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'composite' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'composite' order by c.n $$,
  'D47 composite keys: a call matches its customer and product, a visit its call and every child its visit, even with the marker trigger disabled (equality, as designed: a test call never links a real customer or product)');
select is(
  (select count(*) from pg_trigger t
   where t.tgrelid in ('public.visits'::regclass, 'public.visit_reports'::regclass, 'public.visit_signatures'::regclass,
                       'public.visit_time_reports'::regclass, 'public.visit_events'::regclass)
     and not t.tgisinternal and t.tgenabled <> 'O'),
  0::bigint, 'the marker triggers disabled inside the probes are enabled again (V22)');

-- 8.3 entity_changes takes is_test from real targets too.
select results_eq(
  $$ insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, is_test)
     values ('customers', '00000000-0000-4000-8000-000000000611', 'phone', '"050-000-0010"', '"050-000-0011"', 'invitation', true),
            ('products', '00000000-0000-4000-8000-000000000511', 'name', '"מוצר"', '"מוצר אמיתי"', 'edit', true),
            ('service_calls', '00000000-0000-4000-8000-00000000c0f1', 'status', '"awaiting_scheduling"', '"open"', 'system', true),
            ('visits', '00000000-0000-4000-8000-00000000b0f1', 'technician_id', null, '"00000000-0000-4000-8000-0000000000e9"',
             'invitation', true)
     returning entity_table, is_test $$,
  $$ values ('customers'::text, false), ('products', false), ('service_calls', false), ('visits', false) $$,
  'entity_changes on real customers, products, calls and visits is stored as real (the client value is ignored)');

-- 8.4 Fail closed in the one-way trigger of visits (M45): a Manager who reads the real call but,
--     through a temporary restrictive policy, not the test technician, place or reason, gets 23503
--     (never "not test, accepted"). Without the hiding policy the same row is refused as test data.
insert into tm_fc (grp, label, sub, setup, stmt, expected)
select 'real', v.label, '00000000-0000-4000-8000-0000000000a1', s.setup, v.stmt, v.expected
from (values
  (1, 'a real visit with a test technician he cannot read', true,
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2',
        now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2')$s$,
   '23503 visits: unknown technician'),
  (2, 'a real visit with a test pickup place he cannot read', true,
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, pickup_location_id, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000901', 'graph-evt-2')$s$,
   '23503 visits: unknown pickup place'),
  (3, 'a real visit with a test continuation reason he cannot read', true,
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, followup_reason_id, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e9',
        2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1', '00000000-0000-4000-8000-000000000801', 'graph-evt-2')$s$,
   '23503 visits: unknown continuation reason'),
  (4, 'control: a real visit with real references he reads', true,
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, pickup_location_id, followup_reason_id, source_ref) values ('00000000-0000-4000-8000-00000000c0f1',
        '00000000-0000-4000-8000-0000000000e9', 2, 'T-2', now(), now(), 'scheduled', 'חיפה', 'הנמל 1',
        '00000000-0000-4000-8000-000000000911', (select r.id from public.followup_reasons r where r.sort_order = 2), 'graph-evt-2')$s$,
   '42501 new row violates row-level security policy for table "visits"'),
  (5, 'control: without the hiding policy the test technician is refused as test data', false,
   $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref) values ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2',
        now(), now(), 'scheduled', 'חיפה', 'הנמל 1', 'graph-evt-2')$s$,
   '23514 visits: a real record cannot reference test data (D47)')
) v (n, label, hide, stmt, expected)
cross join lateral (select 'grant insert on public.visits to authenticated' || case when v.hide then
  '; create policy tm_hide_test on public.technicians as restrictive for select to authenticated using (not technicians.is_test)
   ; create policy tm_hide_test on public.collection_locations as restrictive for select to authenticated using (not collection_locations.is_test)
   ; create policy tm_hide_test on public.followup_reasons as restrictive for select to authenticated using (not followup_reasons.is_test)'
  else '' end as setup) s
order by v.n;
select results_eq(
  $$ select f.label, pg_temp.tm_try_as(f.setup, f.sub, 'authenticated', f.stmt) from tm_fc f where f.grp = 'real' order by f.n $$,
  $$ select f.label, f.expected from tm_fc f where f.grp = 'real' order by f.n $$,
  'fail closed: the one-way trigger of visits reports a technician, place or reason the caller cannot read as missing (23503), never as real');
select is(
  (select count(*) from pg_policy p where p.polname = 'tm_hide_test'), 0::bigint,
  'the temporary hiding policies did not outlive their probes');

select * from finish();
rollback;
