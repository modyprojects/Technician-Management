-- PR 1.5: field time reports (D45; docs/database-schema.md §7; plan §2.5, §4; docs/testing.md
-- category 10; D58 (5): data integrity). Covered: server-forced received_at, clock_skew_ms and
-- row_flags (client values ignored); at most one device report per visit and kind (double tap ->
-- 23505); a device report is credited to the technician who reported it; unknown technician;
-- infinite device times refused; the TEMPORARY flags future_time, large_skew and before_assignment
-- (a clock off by a year is accepted and flagged, never rejected); a re-assignment does not move
-- earlier reports; the view's current value per visit and kind, its sequence flags, and the
-- precedence of a non-device row (PR 1.6 corrections) that clears them.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   OQ-11 thresholds: future_time when the reported time is more than 2 minutes ahead of the
--         server once the device's clock offset is removed; large_skew above 5 minutes of offset;
--         before_assignment when the reported time (offset removed) is before visits.assigned_at;
--         sequence flags computed in the view, never stored.
-- Who reads time reports (no Technician, office `cal` or `calls`) is asserted in 180.
--
-- Fixture (fictional, example.test, automated_test; D47): call P (open) with P1 (Technician A,
-- assigned an hour ago, back-dated with t12 disabled) and P2 (Technician B).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_run: runs p_sql and then p_probe (one text value) in one subtransaction that is always
-- undone; returns the probe's value ('ok' without a probe) or the first error (SQLSTATE and the
-- constraint name, else the message).
create function pg_temp.tm_run(p_sql text, p_probe text default null)
returns text
language plpgsql
as $f$
declare
  v_result text;
  v_done boolean := false;
  v_state text;
  v_constraint text;
  v_message text;
begin
  begin
    execute p_sql;
    if p_probe is null then
      v_result := 'ok';
    else
      execute p_probe into v_result;
    end if;
    v_done := true;
    raise exception using errcode = 'TM001', message = 'undo the scenario';
  exception when others then
    if not v_done then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text;
      v_result := v_state || ' ' || coalesce(nullif(v_constraint, ''), v_message);
    end if;
  end;
  return v_result;
end
$f$;

-- tm_report: the INSERT of one device report on P1 or P2 (as postgres; there is no write path in
-- PR 1.5). Times are given as offsets from the server's now().
create function pg_temp.tm_report(p_visit text, p_reporter text, p_tech text, p_kind text, p_reported text,
                                  p_sent text, p_op text, p_extra text default '')
returns text
language sql
immutable
as $f$
  select format(
    'insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,'
    || ' device_utc_offset_min, device_sent_at, source, operation_id%s) values (%L, %L, %L, %L, %s, ''Asia/Jerusalem'', 120,'
    || ' %s, ''device'', %L%s)',
    case when p_extra = '' then '' else ', received_at, clock_skew_ms, row_flags' end,
    case p_visit when 'P1' then '00000000-0000-4000-8000-000000200b11' else '00000000-0000-4000-8000-000000200b12' end,
    case p_reporter when 'A' then '00000000-0000-4000-8000-0000000000d1' else '00000000-0000-4000-8000-0000000000d2' end,
    case p_tech when 'A' then '00000000-0000-4000-8000-0000000000e1' when 'B' then '00000000-0000-4000-8000-0000000000e2'
                else '00000000-0000-4000-8000-000000200999' end,
    p_kind, p_reported, p_sent, p_op, p_extra)
$f$;

-- tm_derived: the server-derived fields of the report with the given operation id.
create function pg_temp.tm_derived(p_op text)
returns text
language sql
as $f$
  select concat_ws(' ', t.received_at = now(), t.clock_skew_ms, t.row_flags::text)
  from public.visit_time_reports t where t.operation_id = p_op::uuid
$f$;

-- ---------------------------------------------------------------------------------------------
-- 1. Fixtures (local, rolled back)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'd1', 'd2']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000200c01', 'C-2001', 'לקוח בדיקה', '050-000-2001', 'automated_test', 'pr15-200-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000200d01', 'kt-2001', 'KT-2001', 'מוצר בדיקה', 'automated_test', 'pr15-200-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000200a01', 'R-2001', '00000000-0000-4000-8000-000000200c01',
        '00000000-0000-4000-8000-000000200d01', (select t.id from public.call_types t where t.sort_order = 1),
        'תקלת בדיקה', 'נציג בדיקה', 'open', 3, 'automated_test', 'pr15-200-p');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref) values
  ('00000000-0000-4000-8000-000000200b11', '00000000-0000-4000-8000-000000200a01', '00000000-0000-4000-8000-0000000000e1',
   1, 'P1', '2026-11-20 08:00:00+00', '2026-11-20 09:00:00+00', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 1', 'pr15-200-p1'),
  ('00000000-0000-4000-8000-000000200b12', '00000000-0000-4000-8000-000000200a01', '00000000-0000-4000-8000-0000000000e2',
   2, 'P2', '2026-11-21 08:00:00+00', '2026-11-21 09:00:00+00', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 2', 'pr15-200-p2');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr15-200-%';
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;
alter table public.visits disable trigger t12_visit_state;
update public.visits v set assigned_at = now() - interval '1 hour' where v.source_ref like 'pr15-200-%';
select lives_ok('set constraints all immediate', 'the back-dated fixture (assigned an hour ago) still passes every deferred check');
alter table public.visits enable trigger t12_visit_state;
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 2. Server-derived fields; client values ignored
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'A', 'departed', 'now() - interval ''10 seconds''', 'now() - interval ''2 seconds''',
                    '00000000-0000-4000-8000-000000200f01', ', ''2000-01-01 00:00:00+00'', 999, ''{future_time}'''),
  $$ select pg_temp.tm_derived('00000000-0000-4000-8000-000000200f01') $$),
  't -2000 {}',
  'received_at is the server''s now(), clock_skew_ms = device_sent_at - received_at, row_flags recomputed: the client''s values are ignored');

-- The base report used by the double-tap and re-assignment cases.
select lives_ok(
  pg_temp.tm_report('P1', 'A', 'A', 'arrived', 'now() - interval ''5 minutes''', 'now()', '00000000-0000-4000-8000-000000200f02'),
  'Technician A''s arrival on P1 is recorded');

-- ---------------------------------------------------------------------------------------------
-- 3. Integrity: one device report per visit and kind; credited to the reporter; finite times
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'A', 'arrived', 'now()', 'now()', '00000000-0000-4000-8000-000000200f03')),
  '23505 visit_time_reports_device_once_key', 'a second device arrival for the same visit (double tap) is refused');
select is(pg_temp.tm_run(
  pg_temp.tm_report('P2', 'B', 'B', 'arrived', 'now()', 'now()', '00000000-0000-4000-8000-000000200f03')),
  'ok', 'positive control: the same kind on another visit is accepted');
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'B', 'ended', 'now()', 'now()', '00000000-0000-4000-8000-000000200f04')),
  '23514 visit_time_reports: a device report is credited to the technician who reported it',
  'a device report credited to another technician than its reporter is refused');
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'X', 'ended', 'now()', 'now()', '00000000-0000-4000-8000-000000200f04')),
  '23503 visit_time_reports: unknown technician', 'a report for an unknown technician is refused');
select results_eq(
  $$ select x.case_name, pg_temp.tm_run(pg_temp.tm_report('P1', 'A', 'A', 'ended', x.reported, x.sent,
                                                            '00000000-0000-4000-8000-000000200f05'))
     from (values ('reported_at infinity', '''infinity''', 'now()'),
                  ('reported_at -infinity', '''-infinity''', 'now()'),
                  ('device_sent_at infinity', 'now()', '''infinity'''),
                  ('reported_at missing', 'null', 'now()')) as x (case_name, reported, sent) $$,
  $$ values ('reported_at infinity', '23514 visit_time_reports_device_check'),
            ('reported_at -infinity', '23514 visit_time_reports_device_check'),
            ('device_sent_at infinity', '23514 visit_time_reports_device_check'),
            ('reported_at missing', '23514 visit_time_reports_device_check') $$,
  'infinite or missing device times are refused (no flag arithmetic on them)');

-- ---------------------------------------------------------------------------------------------
-- 4. TEMPORARY flags (OQ-11): flagged, never rejected for clock values
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.case_name, pg_temp.tm_run(
       pg_temp.tm_report('P1', 'A', 'A', 'ended', x.reported, x.sent, '00000000-0000-4000-8000-000000200f06'),
       $q$ select row_flags::text from public.visit_time_reports where operation_id = '00000000-0000-4000-8000-000000200f06' $q$)
     from (values
       ('sane clock', 'now() - interval ''1 minute''', 'now()'),
       ('reported 10 minutes ahead', 'now() + interval ''10 minutes''', 'now()'),
       ('reported 1 minute ahead (within 2 minutes)', 'now() + interval ''1 minute''', 'now()'),
       ('device clock 10 minutes fast', 'now() + interval ''9 minutes''', 'now() + interval ''10 minutes'''),
       ('device clock 4 minutes fast (within 5 minutes)', 'now() + interval ''3 minutes''', 'now() + interval ''4 minutes'''),
       ('device clock a year slow', 'now() - interval ''1 year'' - interval ''1 minute''', 'now() - interval ''1 year'''),
       ('reported before the assignment', 'now() - interval ''2 hours''', 'now()'),
       ('slow clock, real time after the assignment', 'now() - interval ''1 hour'' - interval ''20 minutes''', 'now() - interval ''30 minutes''')
     ) as x (case_name, reported, sent) $$,
  $$ values ('sane clock', '{}'), ('reported 10 minutes ahead', '{future_time}'),
            ('reported 1 minute ahead (within 2 minutes)', '{}'), ('device clock 10 minutes fast', '{large_skew}'),
            ('device clock 4 minutes fast (within 5 minutes)', '{}'), ('device clock a year slow', '{large_skew}'),
            ('reported before the assignment', '{before_assignment}'),
            ('slow clock, real time after the assignment', '{large_skew}') $$,
  'flags measure the reported time with the device''s clock offset removed: future_time above 2 minutes ahead, large_skew above 5 minutes of offset, before_assignment before visits.assigned_at; a year-off clock is accepted and flagged');

-- ---------------------------------------------------------------------------------------------
-- 5. A re-assignment does not move earlier reports
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  $$ update public.visits v set technician_id = '00000000-0000-4000-8000-0000000000e2'
     where v.id = '00000000-0000-4000-8000-000000200b11' $$,
  $$ select concat_ws(' ', t.reported_by_profile_id = '00000000-0000-4000-8000-0000000000d1',
                      t.technician_id = '00000000-0000-4000-8000-0000000000e1', t.row_flags::text)
     from public.visit_time_reports t where t.operation_id = '00000000-0000-4000-8000-000000200f02' $$),
  't t {}', 'after P1 is re-assigned to B, A''s arrival stays credited to A and reported by A');
select is(pg_temp.tm_run(
  $$ update public.visits v set technician_id = '00000000-0000-4000-8000-0000000000e2'
     where v.id = '00000000-0000-4000-8000-000000200b11' $$ || ';'
  || pg_temp.tm_report('P1', 'B', 'B', 'ended', 'now()', 'now()', '00000000-0000-4000-8000-000000200f07'),
  $$ select string_agg(t.kind || ':' || (t.technician_id = '00000000-0000-4000-8000-0000000000e1'), ',' order by t.id)
     from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-000000200b11' $$),
  'arrived:true,ended:false', 'after the re-assignment, B''s own report on P1 is credited to B (each report to its reporter)');

-- ---------------------------------------------------------------------------------------------
-- 6. The view: current value per visit and kind, sequence flags, precedence of non-device rows
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'A', 'departed', 'now() - interval ''2 minutes''', 'now()', '00000000-0000-4000-8000-000000200f08'),
  $$ select string_agg(c.kind || ' ' || c.source || ' ' || c.sequence_flags::text, ', ' order by c.kind)
     from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000200b11' $$),
  'arrived device {before_departed}, departed device {}',
  'an arrival reported before the departure is shown with the computed sequence flag before_departed (never stored)');
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'A', 'departed', 'now() - interval ''20 minutes''', 'now()', '00000000-0000-4000-8000-000000200f08')
  || '; ' || pg_temp.tm_report('P1', 'A', 'A', 'ended', 'now() - interval ''30 minutes''', 'now()', '00000000-0000-4000-8000-000000200f09'),
  $$ select string_agg(c.kind || ' ' || c.sequence_flags::text, ', ' order by c.kind)
     from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000200b11' $$),
  'arrived {}, departed {}, ended {before_arrived,before_departed}',
  'an end reported before the arrival and the departure gets both sequence flags');
-- PR 1.6 adds non-device sources (corrections); the CHECK is relaxed only inside the undone
-- scenario to show that the view prefers them and that a correction clears the sequence flag.
select is(pg_temp.tm_run(
  pg_temp.tm_report('P1', 'A', 'A', 'departed', 'now() - interval ''2 minutes''', 'now()', '00000000-0000-4000-8000-000000200f08')
  || $$; alter table public.visit_time_reports drop constraint visit_time_reports_source_check;
        insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source)
        values ('00000000-0000-4000-8000-000000200b11', '00000000-0000-4000-8000-0000000000c1',
                '00000000-0000-4000-8000-0000000000e1', 'arrived', now() - interval '1 minute', 'correction'),
               ('00000000-0000-4000-8000-000000200b11', '00000000-0000-4000-8000-0000000000c1',
                '00000000-0000-4000-8000-0000000000e1', 'arrived', now() - interval '30 seconds', 'correction') $$,
  $$ select string_agg(c.kind || ' ' || c.source || ' ' || (c.reported_at = now() - interval '30 seconds') || ' '
                       || c.sequence_flags::text, ', ' order by c.kind)
     from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000200b11' $$),
  'arrived correction true {}, departed device false {}',
  'a non-device row takes precedence over the device report (the newest by id wins) and clears before_departed');
select is((select count(*)::integer from public.visit_time_reports), 1,
  'every scenario was undone: only the base arrival remains');

select * from finish();
rollback;
