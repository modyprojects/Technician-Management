-- Step 6: the schema of calendar ingestion (Migration 6; docs/database-schema.md §2, §5, §9, §10;
-- docs/testing.md categories 1-3, 6, 12). Covered: the columns of the three tables, their triggers,
-- the fail-closed data_source, the generated and derived test markers (D47) and the one-way rule,
-- the composite foreign keys (a test row never joins a real one), uniqueness (one event per source
-- identity, one change per key, one event per visit, one open error per event), the state guards
-- (a change is append-only; an error is resolved once; an event's visit link is set once, a deleted
-- event stays deleted, its newest change time never goes back), the delete and truncate guards (also
-- as service_role with temporary grants), grants, SECURITY DEFINER classification, RLS (TEMPORARY
-- OQ-1: the Creator reads, nobody else) and the census. The writer's behaviour: 340.
-- Mechanics as in 260: rows are written as postgres; every probe runs in an undone subtransaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back): tm_run_as as in 260 (setup as postgres, then p_sql as p_role
-- with the JWT claims of p_sub, then the probe as postgres; everything undone; an error returns its
-- SQLSTATE and the constraint name or the message).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.tm_run_as(p_setup text, p_sub uuid, p_role text, p_sql text, p_probe text default null)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
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
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
      return v_state || ' ' || coalesce(nullif(v_constraint, ''), v_message);
    end;
    raise exception using errcode = 'TM001', message = coalesce(v_result, '<null>');
  exception when sqlstate 'TM001' then
    get stacked diagnostics v_message = message_text;
    return v_message;
  end;
end
$f$;
-- tm_read_as: the three tables' row counts as p_sub sees them (RLS), as "events changes errors".
create function pg_temp.tm_read_as(p_sub uuid)
returns text
language plpgsql
as $f$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
  set local role authenticated;
  select (select count(*) from public.external_calendar_events)::text || ' ' || (select count(*) from public.calendar_event_changes)
         || ' ' || (select count(*) from public.calendar_ingestion_errors) into v_result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end
$f$;
create function pg_temp.tm_try(p_sql text, p_probe text default null)
returns text
language sql
as $f$ select pg_temp.tm_run_as(null, null, 'postgres', p_sql, p_probe) $f$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test, automated_test; D47): the real Creator
-- c1, Manager a1, Customer Service b1, Technician A (d1, e1). One test event E1 (automated_test)
-- with a change K1 and an open error; call R-3301 with visit 1, linked to a second event E2.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000033' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-33' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'b1', 'd1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000033c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000033a1', 'manager', 'מנהל', true),
  ('00000000-0000-4000-8000-0000000033b1', 'customer_service', 'נציגה', true),
  ('00000000-0000-4000-8000-0000000033d1', 'technician', 'טכנאי', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000033e1', '00000000-0000-4000-8000-0000000033d1', true, 'טכנאי', 't-y', 'tech-33@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-00000033c001', 'C-3301', 'לקוח בדיקה', '050-000-3301', 'automated_test', 'run-330');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-00000033d001', 'kt-3301', 'KT-3301', 'מוצר בדיקה', 'automated_test', 'run-330');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-00000033a001', 'R-3301', '00000000-0000-4000-8000-00000033c001',
        '00000000-0000-4000-8000-00000033d001', (select c.id from public.call_types c where c.sort_order = 1),
        'תקלת בדיקה', 'נציגת בדיקה', 'open', 3, 'automated_test', 'run-330');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, is_test, source_ref) values
  ('00000000-0000-4000-8000-00000033b001', '00000000-0000-4000-8000-00000033a001', '00000000-0000-4000-8000-0000000033e1',
   1, 'T1', now() + interval '1 day', now() + interval '1 day 2 hours', 'scheduled', 'עיר', 'רחוב 1', true, 'run-330'),
  ('00000000-0000-4000-8000-00000033b002', '00000000-0000-4000-8000-00000033a001', '00000000-0000-4000-8000-0000000033e1',
   2, 'T2', now() + interval '2 days', now() + interval '2 days 2 hours', 'scheduled', 'עיר', 'רחוב 1', true, 'run-330');
insert into public.visit_events (visit_id, version_after, event_type, to_status, is_test)
values ('00000000-0000-4000-8000-00000033b001', 1, 'created', 'scheduled', true),
       ('00000000-0000-4000-8000-00000033b002', 1, 'created', 'scheduled', true);
insert into public.external_calendar_events (id, data_source, calendar_id, event_id) values
  ('00000000-0000-4000-8000-00000033e001', 'automated_test', 'cal-330', 'evt-1'),
  ('00000000-0000-4000-8000-00000033e002', 'automated_test', 'cal-330', 'evt-2');
update public.external_calendar_events
set service_call_id = '00000000-0000-4000-8000-00000033a001', visit_id = '00000000-0000-4000-8000-00000033b001'
where id = '00000000-0000-4000-8000-00000033e002';
insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type,
                                           payload_sha256, outcome, is_test)
values ('00000000-0000-4000-8000-00000033f001', '00000000-0000-4000-8000-00000033e001', 'k1', now() - interval '1 hour',
        '00000000-0000-4000-8000-0000000033a1', 'upsert', repeat('a', 64), 'unparsed', false);
insert into public.calendar_ingestion_errors (id, calendar_event_id, change_id, subject, problems, is_test)
values ('00000000-0000-4000-8000-00000033f101', '00000000-0000-4000-8000-00000033e001', '00000000-0000-4000-8000-00000033f001',
        '[קריאת שירות] בדיקה', '[{"kind":"missing","field":"customerNo"}]', false);
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- Columns and triggers
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", a.attname::text collate "default", format_type(a.atttypid, a.atttypmod), a.attnotnull
     from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.oid in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                     'public.calendar_ingestion_errors'::regclass) and a.attnum > 0 and not a.attisdropped
     order by c.relname::text collate "C", a.attnum $$,
  $$ values
     ('calendar_event_changes', 'id', 'uuid', true), ('calendar_event_changes', 'calendar_event_id', 'uuid', true),
     ('calendar_event_changes', 'change_key', 'text', true),
     ('calendar_event_changes', 'changed_at', 'timestamp with time zone', true),
     ('calendar_event_changes', 'recorded_at', 'timestamp with time zone', true),
     ('calendar_event_changes', 'received_by', 'uuid', true), ('calendar_event_changes', 'change_type', 'text', true),
     ('calendar_event_changes', 'payload_sha256', 'text', true), ('calendar_event_changes', 'outcome', 'text', true),
     ('calendar_event_changes', 'service_call_id', 'uuid', false), ('calendar_event_changes', 'visit_id', 'uuid', false),
     ('calendar_event_changes', 'customer_id', 'uuid', false), ('calendar_event_changes', 'applied_fields', 'text[]', true),
     ('calendar_event_changes', 'snapshot', 'jsonb', false), ('calendar_event_changes', 'is_test', 'boolean', true),
     ('calendar_ingestion_errors', 'id', 'uuid', true), ('calendar_ingestion_errors', 'calendar_event_id', 'uuid', true),
     ('calendar_ingestion_errors', 'change_id', 'uuid', true), ('calendar_ingestion_errors', 'subject', 'text', false),
     ('calendar_ingestion_errors', 'organizer_email', 'text', false),
     ('calendar_ingestion_errors', 'attendee_emails', 'jsonb', true),
     ('calendar_ingestion_errors', 'event_start', 'timestamp with time zone', false),
     ('calendar_ingestion_errors', 'event_end', 'timestamp with time zone', false),
     ('calendar_ingestion_errors', 'request_number', 'text', false), ('calendar_ingestion_errors', 'customer_name', 'text', false),
     ('calendar_ingestion_errors', 'problems', 'jsonb', true), ('calendar_ingestion_errors', 'status', 'text', true),
     ('calendar_ingestion_errors', 'created_at', 'timestamp with time zone', true),
     ('calendar_ingestion_errors', 'resolved_at', 'timestamp with time zone', false),
     ('calendar_ingestion_errors', 'resolution', 'text', false),
     ('calendar_ingestion_errors', 'resolved_by_change_id', 'uuid', false),
     ('calendar_ingestion_errors', 'is_test', 'boolean', true),
     ('calendar_ingestion_errors', 'updated_at', 'timestamp with time zone', true),
     ('calendar_ingestion_errors', 'version', 'integer', true),
     ('external_calendar_events', 'id', 'uuid', true), ('external_calendar_events', 'data_source', 'text', true),
     ('external_calendar_events', 'calendar_id', 'text', true), ('external_calendar_events', 'event_id', 'text', true),
     ('external_calendar_events', 'status', 'text', true), ('external_calendar_events', 'service_call_id', 'uuid', false),
     ('external_calendar_events', 'visit_id', 'uuid', false), ('external_calendar_events', 'last_change_key', 'text', false),
     ('external_calendar_events', 'last_changed_at', 'timestamp with time zone', false),
     ('external_calendar_events', 'is_test', 'boolean', false),
     ('external_calendar_events', 'created_at', 'timestamp with time zone', true),
     ('external_calendar_events', 'created_by', 'uuid', false),
     ('external_calendar_events', 'updated_at', 'timestamp with time zone', true),
     ('external_calendar_events', 'updated_by', 'uuid', false), ('external_calendar_events', 'version', 'integer', true) $$,
  'the three Step 6 tables have exactly the planned columns, types and NOT NULLs');

select results_eq(
  $$ select t.tgrelid::regclass::text collate "default", t.tgname::text collate "default", t.tgfoid::regprocedure::text
     from pg_trigger t
     where t.tgrelid in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                         'public.calendar_ingestion_errors'::regclass) and not t.tgisinternal and t.tgenabled = 'O'
     order by t.tgrelid::regclass::text collate "C", t.tgname::text collate "C" $$,
  $$ values
     ('calendar_event_changes', 't10_reject_update_delete', 'private.tg_reject_update_delete()'),
     ('calendar_event_changes', 't15_marker_from_event', 'private.tg_calendar_child_marker()'),
     ('calendar_event_changes', 't16_change_time', 'private.tg_history_server_time()'),
     ('calendar_event_changes', 't30_one_way', 'private.tg_one_way_people()'),
     ('calendar_event_changes', 't99_reject_truncate', 'private.tg_reject_truncate()'),
     ('calendar_ingestion_errors', 't10_immutable', 'private.tg_immutable_except()'),
     ('calendar_ingestion_errors', 't12_error_state', 'private.tg_ingestion_error_state()'),
     ('calendar_ingestion_errors', 't15_marker_from_event', 'private.tg_calendar_child_marker()'),
     ('calendar_ingestion_errors', 't20_immutable_markers', 'private.tg_immutable_markers()'),
     ('calendar_ingestion_errors', 't90_bump_version', 'private.tg_bump_version()'),
     ('calendar_ingestion_errors', 't95_reject_delete', 'private.tg_reject_delete()'),
     ('calendar_ingestion_errors', 't99_reject_truncate', 'private.tg_reject_truncate()'),
     ('external_calendar_events', 'a30_one_way', 'private.tg_one_way_people()'),
     ('external_calendar_events', 't10_immutable', 'private.tg_immutable_except()'),
     ('external_calendar_events', 't35_event_guard', 'private.tg_calendar_event_guard()'),
     ('external_calendar_events', 't90_bump_version', 'private.tg_bump_version()'),
     ('external_calendar_events', 't95_reject_delete', 'private.tg_reject_delete()'),
     ('external_calendar_events', 't99_reject_truncate', 'private.tg_reject_truncate()') $$,
  'every Step 6 table has its enabled guard, marker, one-way, version, delete and truncate triggers');

-- ---------------------------------------------------------------------------------------------
-- Test markers (D47)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('microsoft_graph', 'c', 'e')$q$)
     union all select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('seed', 'c', 'e')$q$)
     union all select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('simulator', 'c', 'e')$q$)
     union all select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('automated_test', 'c', 'e')$q$,
                                     $q$select is_test::text from public.external_calendar_events where event_id = 'e'$q$) $$,
  $$ values ('23514 external_calendar_events_data_source_check'::text), ('23514 external_calendar_events_data_source_check'),
            ('23514 external_calendar_events_simulator_creator_check'), ('true') $$,
  'data_source fails closed (no microsoft_graph before Step 11, no seed), a simulator event needs its creator, and is_test is generated from it');

select results_eq(
  $$ select is_test from public.calendar_event_changes where id = '00000000-0000-4000-8000-00000033f001'
     union all select is_test from public.calendar_ingestion_errors where id = '00000000-0000-4000-8000-00000033f101' $$,
  $$ values (true), (true) $$,
  'a change and an error take is_test from their event (the client''s false is ignored)');

select results_eq(
  $$ select pg_temp.tm_try($q$update public.external_calendar_events set data_source = 'simulator' where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$alter table public.calendar_ingestion_errors disable trigger t10_immutable;
                                       update public.calendar_ingestion_errors set is_test = false where id = '00000000-0000-4000-8000-00000033f101'$q$) $$,
  $$ values ('55000 external_calendar_events: these fields are immutable'::text),
            ('55000 calendar_ingestion_errors: test-data markers are immutable (D47)') $$,
  'markers are frozen: data_source by t10 on events; is_test by t20 on errors even with t10 disabled');

-- One-way rule and composite keys (a real record never references test data).
select results_eq(
  $$ select pg_temp.tm_try($q$alter table public.external_calendar_events drop constraint external_calendar_events_data_source_check;
                             alter table public.external_calendar_events add constraint tm_relaxed check (data_source in ('microsoft_graph', 'simulator', 'automated_test'));
                             insert into public.external_calendar_events (data_source, calendar_id, event_id, created_by)
                             values ('microsoft_graph', 'c', 'e', '00000000-0000-4000-8000-0000000033a1')$q$)
     union all select pg_temp.tm_try($q$alter table public.external_calendar_events drop constraint external_calendar_events_data_source_check;
                             alter table public.external_calendar_events add constraint tm_relaxed check (data_source in ('microsoft_graph', 'simulator', 'automated_test'));
                             insert into public.external_calendar_events (data_source, calendar_id, event_id, service_call_id, visit_id)
                             values ('microsoft_graph', 'c', 'e', null, null);
                             update public.external_calendar_events set service_call_id = '00000000-0000-4000-8000-00000033a001',
                               visit_id = '00000000-0000-4000-8000-00000033b002' where event_id = 'e'$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, customer_id, is_test)
                             values (gen_random_uuid(), '00000000-0000-4000-8000-00000033e001', 'k9', now(), '00000000-0000-4000-8000-0000000033a1',
                               'upsert', repeat('b', 64), 'stale', '00000000-0000-4000-8000-0000000000ff', true)$q$) $$,
  $$ values ('23514 external_calendar_events: a real record cannot reference a test profile (D47)'::text),
            ('23503 external_calendar_events_service_call_id_fkey'),
            ('23503 calendar_event_changes_customer_id_fkey') $$,
  'a real event cannot name a test creator or link a test call (one-way rule, composite key); a change references only existing rows of its own marker');

-- ---------------------------------------------------------------------------------------------
-- Keys and value rules
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('automated_test', 'cal-330', 'evt-1')$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, is_test)
                             values (gen_random_uuid(), '00000000-0000-4000-8000-00000033e001', 'k1', now(), '00000000-0000-4000-8000-0000000033a1',
                               'upsert', repeat('c', 64), 'stale', true)$q$)
     union all select pg_temp.tm_try($q$update public.external_calendar_events set service_call_id = '00000000-0000-4000-8000-00000033a001',
                               visit_id = '00000000-0000-4000-8000-00000033b001' where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, is_test)
                             values (gen_random_uuid(), '00000000-0000-4000-8000-00000033e001', 'k2', now(), '00000000-0000-4000-8000-0000000033a1',
                               'upsert', repeat('d', 64), 'unparsed', true);
                             insert into public.calendar_ingestion_errors (calendar_event_id, change_id, problems, is_test)
                             select '00000000-0000-4000-8000-00000033e001', c.id, '[{"kind":"missing","field":"req"}]', true
                             from public.calendar_event_changes c where c.change_key = 'k2'$q$) $$,
  $$ values ('23505 external_calendar_events_identity_key'::text), ('23505 calendar_event_changes_change_key_key'),
            ('23505 external_calendar_events_visit_id_key'), ('23505 calendar_ingestion_errors_open_key') $$,
  'unique: one event per (source, calendar, event id), one change per (event, change key), one event per visit, one open error per event');

select results_eq(
  $$ select pg_temp.tm_try(format($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, applied_fields, snapshot, is_test)
                             values (gen_random_uuid(), '00000000-0000-4000-8000-00000033e001', %L, now(), '00000000-0000-4000-8000-0000000033a1',
                               %L, repeat('e', 64), %L, %L::text[], %L::jsonb, true)$q$, x.k, x.t, x.o, x.f, x.s))
     from (values (1, 'k3', 'delete', 'applied', '{}', null),
                  (2, 'k4', 'upsert', 'applied', '{}', null),
                  (3, 'k5', 'upsert', 'stale', '{visits.city}', null),
                  (4, 'k6', 'upsert', 'unparsed', '{}', '{"fields": {}}'),
                  (5, 'k7', 'upsert', 'applied', '{customers.name}', '{"fields": {}}'),
                  (6, 'k8', 'upsert', 'done', '{}', null),
                  (7, 'k  9', 'upsert', 'stale', '{}', null)) x (n, k, t, o, f, s)
     order by x.n $$,
  $$ values ('23514 calendar_event_changes_delete_check'::text), ('23514 calendar_event_changes_snapshot_kept_check'),
            ('23514 calendar_event_changes_applied_state_check'), ('23514 calendar_event_changes_snapshot_state_check'),
            ('23514 calendar_event_changes_applied_fields_check'), ('23514 calendar_event_changes_outcome_check'),
            ('23514 calendar_event_changes_change_key_check') $$,
  'change rows: a deletion is never applied, an applied upsert keeps its snapshot, only applied changes list fields, a closed list of fields and outcomes, printable change keys');

select results_eq(
  $$ select pg_temp.tm_try(format($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, is_test)
                             values ('00000000-0000-4000-8000-00000033f0%s', '00000000-0000-4000-8000-00000033e001', 'kx%s', now(),
                               '00000000-0000-4000-8000-0000000033a1', 'upsert', repeat('f', 64), 'unparsed', true);
                             update public.calendar_ingestion_errors set status = 'resolved', resolution = 'superseded',
                               resolved_by_change_id = '00000000-0000-4000-8000-00000033f0%s' where status = 'open';
                             insert into public.calendar_ingestion_errors (calendar_event_id, change_id, subject, organizer_email,
                               attendee_emails, event_start, event_end, request_number, customer_name, problems, is_test)
                             values ('00000000-0000-4000-8000-00000033e001', '00000000-0000-4000-8000-00000033f0%s', %s, true)$q$,
                             x.n, x.n, x.n, x.n, x.v))
     from (values ('10', $v$'x', null, '[]', null, null, null, null, '[]'$v$),
                  ('11', $v$'x', null, '[]', null, null, null, null, '[{"kind":"guess","field":"req"}]'$v$),
                  ('12', $v$'x', null, '[]', null, null, null, null, '[{"kind":"missing","field":"password"}]'$v$),
                  ('13', $v$'x', null, '[]', null, null, null, null, '[{"kind":"missing"}]'$v$),
                  ('14', $v$'x', null, '[]', null, null, null, null, '[{"kind":5,"field":"req"}]'$v$),
                  ('15', $v$'x', null, '["Tech@Example.test"]', null, null, null, null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('16', $v$'x', 'Rep@example.test', '[]', null, null, null, null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('17', $v$'x', null, '[]', now(), now() - interval '1 hour', null, null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('18', $v$'x', null, '[]', null, null, '48 213', null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('19', $v$' x', null, '[]', null, null, null, null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('20', $v$'x' || chr(8207), null, '[]', null, null, null, null, '[{"kind":"missing","field":"req"}]'$v$),
                  ('21', $v$'x', null, '[]', null, null, null, 'לוי' || chr(160), '[{"kind":"missing","field":"req"}]'$v$)) x (n, v)
     order by x.n $$,
  $$ values ('23514 calendar_ingestion_errors_problems_check'::text), ('23514 calendar_ingestion_errors_problems_check'),
            ('23514 calendar_ingestion_errors_problems_check'), ('23514 calendar_ingestion_errors_problems_check'),
            ('23514 calendar_ingestion_errors_problems_check'), ('23514 calendar_ingestion_errors_attendee_emails_check'),
            ('23514 calendar_ingestion_errors_organizer_email_check'), ('23514 calendar_ingestion_errors_schedule_check'),
            ('23514 calendar_ingestion_errors_request_number_check'), ('23514 calendar_ingestion_errors_subject_check'),
            ('23514 calendar_ingestion_errors_subject_check'), ('23514 calendar_ingestion_errors_customer_name_check') $$,
  'error rows: at least one problem, closed kinds and fields, typed members; normalized addresses; a readable schedule; a valid request number; TEXT-SAFE subject and name (no edge space, bidi mark or space variant)');

-- ---------------------------------------------------------------------------------------------
-- State guards
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select pg_temp.tm_try($q$update public.calendar_event_changes set outcome = 'applied' where id = '00000000-0000-4000-8000-00000033f001'$q$)
     union all select pg_temp.tm_try($q$delete from public.calendar_event_changes where id = '00000000-0000-4000-8000-00000033f001'$q$)
     union all select pg_temp.tm_try($q$truncate public.calendar_ingestion_errors, public.calendar_event_changes$q$)
     union all select pg_temp.tm_try($q$delete from public.calendar_ingestion_errors$q$)
     union all select pg_temp.tm_try($q$delete from public.external_calendar_events where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$truncate public.external_calendar_events, public.calendar_event_changes, public.calendar_ingestion_errors$q$) $$,
  $$ values ('55000 calendar_event_changes is append-only'::text), ('55000 calendar_event_changes is append-only'),
            ('55000 calendar_ingestion_errors cannot be truncated'), ('55000 calendar_ingestion_errors: rows are never deleted'),
            ('55000 external_calendar_events: rows are never deleted'), ('55000 external_calendar_events cannot be truncated') $$,
  'as postgres: changes are append-only, no error or event is deleted and no Step 6 table is truncated');

select results_eq(
  $$ select pg_temp.tm_try($q$update public.calendar_ingestion_errors set problems = '[{"kind":"missing","field":"req"}]' where id = '00000000-0000-4000-8000-00000033f101'$q$)
     union all select pg_temp.tm_try($q$update public.calendar_ingestion_errors set status = 'resolved', resolution = 'ingested',
                               resolved_by_change_id = '00000000-0000-4000-8000-00000033f001' where id = '00000000-0000-4000-8000-00000033f101'$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, is_test)
                             values ('00000000-0000-4000-8000-00000033f002', '00000000-0000-4000-8000-00000033e001', 'k22', now(),
                               '00000000-0000-4000-8000-0000000033a1', 'upsert', repeat('a', 64), 'stale', true);
                             update public.calendar_ingestion_errors set status = 'resolved', resolution = 'ingested',
                               resolved_by_change_id = '00000000-0000-4000-8000-00000033f002' where id = '00000000-0000-4000-8000-00000033f101'$q$,
                             $q$select status || ' ' || resolution || ' ' || (resolved_at is not null)::text || ' ' || version
                                from public.calendar_ingestion_errors where id = '00000000-0000-4000-8000-00000033f101'$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by,
                               change_type, payload_sha256, outcome, is_test)
                             values ('00000000-0000-4000-8000-00000033f002', '00000000-0000-4000-8000-00000033e001', 'k22', now(),
                               '00000000-0000-4000-8000-0000000033a1', 'upsert', repeat('a', 64), 'stale', true);
                             update public.calendar_ingestion_errors set status = 'resolved', resolution = 'ingested',
                               resolved_by_change_id = '00000000-0000-4000-8000-00000033f002' where id = '00000000-0000-4000-8000-00000033f101';
                             update public.calendar_ingestion_errors set resolution = 'deleted' where id = '00000000-0000-4000-8000-00000033f101'$q$)
     union all select pg_temp.tm_try($q$insert into public.calendar_ingestion_errors (calendar_event_id, change_id, problems, status, is_test)
                             values ('00000000-0000-4000-8000-00000033e002', '00000000-0000-4000-8000-00000033f001', '[{"kind":"missing","field":"req"}]', 'resolved', true)$q$) $$,
  $$ values ('55000 calendar_ingestion_errors: these fields are immutable'::text),
            ('23514 calendar_ingestion_errors_resolution_state_check'),
            ('resolved ingested true 2'),
            ('55000 calendar_ingestion_errors: a resolved row never changes'),
            ('55000 calendar_ingestion_errors: a row is created open') $$,
  'an error keeps its problems; it is resolved once, by a later change of its event (server time, version raised), and never changes again; it is created open');

select results_eq(
  $$ select pg_temp.tm_try($q$update public.external_calendar_events set visit_id = null, service_call_id = null where id = '00000000-0000-4000-8000-00000033e002'$q$)
     union all select pg_temp.tm_try($q$update public.external_calendar_events set status = 'deleted' where id = '00000000-0000-4000-8000-00000033e001';
                                       update public.external_calendar_events set status = 'active' where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$update public.external_calendar_events set last_change_key = 'b', last_changed_at = now() where id = '00000000-0000-4000-8000-00000033e001';
                                       update public.external_calendar_events set last_change_key = 'a', last_changed_at = now() - interval '1 second' where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$insert into public.external_calendar_events (data_source, calendar_id, event_id, status) values ('automated_test', 'c', 'x', 'deleted')$q$)
     union all select pg_temp.tm_try($q$update public.external_calendar_events set calendar_id = 'other' where id = '00000000-0000-4000-8000-00000033e001'$q$)
     union all select pg_temp.tm_try($q$update public.external_calendar_events set last_change_key = 'a' where id = '00000000-0000-4000-8000-00000033e001'$q$) $$,
  $$ values ('55000 external_calendar_events: the visit link is set once'::text),
            ('55000 external_calendar_events: a deleted event stays deleted'),
            ('55000 external_calendar_events: the newest change time never goes back'),
            ('55000 external_calendar_events: an event is created active, unlinked and without a change'),
            ('55000 external_calendar_events: these fields are immutable'),
            ('23514 external_calendar_events_last_change_check') $$,
  'an event: the visit link is set once, a deleted event stays deleted, the newest change time never goes back, it is created active and unlinked, its identity is frozen');

select results_eq(
  $$ select pg_temp.tm_run_as($q$grant select, insert, update, delete, truncate on public.external_calendar_events,
                               public.calendar_event_changes, public.calendar_ingestion_errors to service_role$q$, null, 'service_role', x.stmt)
     from (values (1, $q$update public.calendar_event_changes set outcome = 'applied'$q$),
                  (2, $q$delete from public.calendar_ingestion_errors$q$),
                  (3, $q$update public.external_calendar_events set data_source = 'simulator'$q$),
                  (4, $q$truncate public.external_calendar_events, public.calendar_event_changes, public.calendar_ingestion_errors$q$)) x (n, stmt)
     order by x.n $$,
  $$ values ('55000 calendar_event_changes is append-only'::text), ('55000 calendar_ingestion_errors: rows are never deleted'),
            ('55000 external_calendar_events: these fields are immutable'), ('55000 external_calendar_events cannot be truncated') $$,
  'as service_role with temporary table grants: append-only, frozen fields, delete and truncate guards hold');

-- ---------------------------------------------------------------------------------------------
-- Grants, functions and RLS
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.r, x.t, has_table_privilege(x.r, x.t, 'select'), has_table_privilege(x.r, x.t, 'insert'),
            has_table_privilege(x.r, x.t, 'update'), has_table_privilege(x.r, x.t, 'delete'), has_table_privilege(x.r, x.t, 'truncate')
     from (values ('anon'), ('authenticated'), ('service_role')) r (r)
     cross join (values ('public.external_calendar_events'), ('public.calendar_event_changes'), ('public.calendar_ingestion_errors')) t (t)
     cross join lateral (select r.r, t.t) x
     order by x.r, x.t $$,
  $$ values
     ('anon', 'public.calendar_event_changes', false, false, false, false, false),
     ('anon', 'public.calendar_ingestion_errors', false, false, false, false, false),
     ('anon', 'public.external_calendar_events', false, false, false, false, false),
     ('authenticated', 'public.calendar_event_changes', true, false, false, false, false),
     ('authenticated', 'public.calendar_ingestion_errors', true, false, false, false, false),
     ('authenticated', 'public.external_calendar_events', true, false, false, false, false),
     ('service_role', 'public.calendar_event_changes', false, false, false, false, false),
     ('service_role', 'public.calendar_ingestion_errors', false, false, false, false, false),
     ('service_role', 'public.external_calendar_events', false, false, false, false, false) $$,
  'grants: SELECT for authenticated only; no write grant for any API role; nothing for anon or service_role');

select results_eq(
  $$ select p.oid::regprocedure::text collate "default", p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute'),
            has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute')
     from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and (p.proname like 'ingest%' or p.proname in ('tg_calendar_child_marker', 'tg_calendar_event_guard', 'tg_ingestion_error_state'))
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values
     ('ingest_calendar_event(jsonb)', false, true, false, false),
     ('private.ingest_answer(uuid,boolean)', false, false, false, false),
     ('private.ingest_apply_call(service_calls,customers,products,boolean,jsonb,jsonb,timestamp with time zone,uuid,uuid,text,text[],integer)', false, false, false, false),
     ('private.ingest_apply_visit(visits,uuid,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,text,text[],integer)', false, false, false, false),
     ('private.ingest_calendar_event(jsonb)', true, true, false, false),
     ('private.ingest_field_source_at(uuid,uuid,text)', false, false, false, false),
     ('private.ingest_text(jsonb,text)', false, false, false, false),
     ('private.ingest_timestamp(jsonb,text)', false, false, false, false),
     ('private.tg_calendar_child_marker()', false, false, false, false),
     ('private.tg_calendar_event_guard()', false, false, false, false),
     ('private.tg_ingestion_error_state()', false, false, false, false) $$,
  'functions: only the writer is SECURITY DEFINER; authenticated executes only the wrapper and the body it calls (the body checks its caller); helpers and triggers have no grant');

select results_eq(
  $$ select x.who, (select r from pg_temp.tm_read_as(x.sub::uuid) r)
     from (values (1, 'creator', '00000000-0000-4000-8000-0000000033c1'), (2, 'manager', '00000000-0000-4000-8000-0000000033a1'),
                  (3, 'customer service', '00000000-0000-4000-8000-0000000033b1'),
                  (4, 'technician', '00000000-0000-4000-8000-0000000033d1'),
                  (5, 'no session', null)) x (n, who, sub)
     order by x.n $$,
  $$ values ('creator', '2 1 1'), ('manager', '0 0 0'), ('customer service', '0 0 0'), ('technician', '0 0 0'),
            ('no session', '0 0 0') $$,
  'RLS (TEMPORARY OQ-1): the Creator reads the events, changes and errors; Manager, Customer Service, a Technician and a session without a profile read none');

select results_eq(
  $$ select pg_temp.tm_run_as(null, '00000000-0000-4000-8000-0000000033c1', 'authenticated', x.stmt)
     from (values (1, $q$insert into public.external_calendar_events (data_source, calendar_id, event_id) values ('simulator', 'c', 'e')$q$),
                  (2, $q$update public.calendar_ingestion_errors set status = 'resolved'$q$),
                  (3, $q$delete from public.calendar_event_changes$q$),
                  (4, $q$truncate public.calendar_ingestion_errors$q$)) x (n, stmt)
     order by x.n $$,
  $$ values ('42501 permission denied for table external_calendar_events'::text),
            ('42501 permission denied for table calendar_ingestion_errors'),
            ('42501 permission denied for table calendar_event_changes'),
            ('42501 permission denied for table calendar_ingestion_errors') $$,
  'the Creator: every direct insert, update, delete and truncate is refused (no grant, 42501); the writer is the only path');

select results_eq(
  $$ select pg_temp.tm_run_as($s$grant insert, update, delete on public.calendar_ingestion_errors, public.external_calendar_events to authenticated$s$,
       '00000000-0000-4000-8000-0000000033c1', 'authenticated', x.stmt,
       $p$select (select count(*) from public.calendar_ingestion_errors where status = 'open')::text || ' ' ||
                 (select count(*) from public.external_calendar_events where status = 'active')$p$)
     from (values (1, $q$update public.calendar_ingestion_errors set status = 'resolved', resolution = 'ingested', resolved_by_change_id = change_id$q$),
                  (2, $q$update public.external_calendar_events set status = 'deleted'$q$)) x (n, stmt)
     order by x.n $$,
  $$ values ('1 2'::text), ('1 2') $$,
  'the Creator with a temporary write grant: no write policy, so an update reaches no row (RLS)');

-- ---------------------------------------------------------------------------------------------
-- Policies and census
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", pol.polname::text collate "default", pol.polcmd::text collate "default",
            pg_get_expr(pol.polqual, pol.polrelid) collate "default"
     from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.oid in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                     'public.calendar_ingestion_errors'::regclass)
     order by c.relname::text collate "C" $$,
  $$ values ('calendar_event_changes', 'calendar_event_changes_select_creator', 'r', '( SELECT private.is_creator() AS is_creator)'),
            ('calendar_ingestion_errors', 'calendar_ingestion_errors_select_creator', 'r', '( SELECT private.is_creator() AS is_creator)'),
            ('external_calendar_events', 'external_calendar_events_select_creator', 'r', '( SELECT private.is_creator() AS is_creator)') $$,
  'one SELECT policy per table, the Creator only (TEMPORARY OQ-1, open decision 15)');

select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('external_calendar_events', 'calendar_event_changes', 'calendar_ingestion_errors')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('calendar_event_changes'::text, 'all sources'::text, 1::bigint), ('calendar_ingestion_errors', 'all sources', 1::bigint),
            ('external_calendar_events', 'automated_test', 2::bigint), ('external_calendar_events', 'other sources', 0::bigint),
            ('external_calendar_events', 'simulator', 0::bigint) $$,
  'the census counts the fixture rows of the three tables per source (D47)');

select results_eq(
  $$ select obj_description(c.oid, 'pg_class') is not null from pg_class c
     where c.oid in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                     'public.calendar_ingestion_errors'::regclass) $$,
  $$ values (true), (true), (true) $$,
  'every Step 6 table has a comment');

select results_eq(
  $$ select c.conname::text collate "default" from pg_constraint c
     where c.conrelid in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                          'public.calendar_ingestion_errors'::regclass) and c.contype = 'f' and c.confdeltype <> 'r'
     order by c.conname::text collate "C" $$,
  $$ select null::text where false $$,
  'every Step 6 foreign key is ON DELETE RESTRICT');

select results_eq(
  $$ select pg_temp.tm_try($q$insert into public.calendar_ingestion_errors (calendar_event_id, change_id, problems, is_test)
                             values ('00000000-0000-4000-8000-00000033e002', '00000000-0000-4000-8000-00000033f001', '[{"kind":"missing","field":"req"}]', true)$q$) $$,
  $$ values ('23505 calendar_ingestion_errors_change_id_key'::text) $$,
  'one error row per change');

select * from finish();
rollback;
