-- PR 1.5: visit integrity (docs/database-schema.md §4 "Migration 3", §7, §9; plan §2.2, §2.4, §2.9,
-- §4; docs/testing.md category 7; D14, D36, D38, D39, D43, D44, D45). Covered: the visit CHECKs
-- (follow-up outcome, closed_at, cancelled_at, cancelled_by, open-not-cancelled, schedule order);
-- visit-number allocation (t35: below next_visit_number, above every number of the call; the
-- number never changes; next_visit_number never decreases); the server times of t12 (forced on
-- INSERT, on a re-assignment, on a closure and on a cancellation; refused otherwise; the D44
-- window [cancelled_at, now()] for a closure accepted after cancellation); the transition rules of
-- closed and cancelled visits and their frozen fields; the deferred checks c10 (a)-(d) run by a
-- Technician, by a Manager without `card` (who cannot see the signature or the summary) and by
-- service_role, c20 (a)-(c), c30 and c40; the immutable signature and its hash CHECK; and the
-- Settings deletes of a continuation reason or pickup place that a visit uses (55000, no audit
-- row left).
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   closed and cancelled visits: a closed visit stays closed (done <-> followup only), a cancelled
--         visit stays cancelled or is closed by an accepted closure (D44), and their assignment,
--         schedule, address, notes and pickup never change; moves among the open statuses are
--         not restricted (Step 4, Step 6 and PR 1.6 decide);
--   open decision 3 (d06): a closed visit needs its treatment summary (c10 rule b);
--   OQ-2  the constraint-trigger functions are SECURITY DEFINER owned by postgres;
--   OQ-14 done -> followup keeps closed_at and the signature;
--   OQ-15 no signature version or media columns.
-- Matrix values are the TEMPORARY D51 defaults (`cal`, `calls` and `card` on for Manager and
-- Customer Service); the Creator turns `card` off for Managers in section 6.
--
-- Mechanics (plan §10): there is no write path in PR 1.5, so writers are simulated as postgres or
-- by a postgres-owned SECURITY DEFINER scratch writer in pg_temp (V27) that the role under test
-- calls; the role then runs SET CONSTRAINTS ALL IMMEDIATE itself, so the deferred checks run in its
-- context (V3, V4). States no writer can reach are built by disabling t12 or t35 inside an undone
-- subtransaction (V22). Every scenario runs through pg_temp.tm_run, which undoes it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(88);

-- ---------------------------------------------------------------------------------------------
-- Test-only helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_id: the fixture ids by short name.
create function pg_temp.tm_id(p_name text)
returns uuid
language sql
immutable
as $f$
  select v.id from (values
    ('creator', '00000000-0000-4000-8000-0000000000c1'::uuid),
    ('manager', '00000000-0000-4000-8000-0000000000a1'::uuid),
    ('tech_a_profile', '00000000-0000-4000-8000-0000000000d1'::uuid),
    ('tech_b_profile', '00000000-0000-4000-8000-0000000000d2'::uuid),
    ('tech_a', '00000000-0000-4000-8000-0000000000e1'::uuid),
    ('tech_b', '00000000-0000-4000-8000-0000000000e2'::uuid),
    ('customer', '00000000-0000-4000-8000-000000170c01'::uuid),
    ('product', '00000000-0000-4000-8000-000000170d01'::uuid),
    ('reason', '00000000-0000-4000-8000-000000170f01'::uuid),
    ('reason_unused', '00000000-0000-4000-8000-000000170f02'::uuid),
    ('place', '00000000-0000-4000-8000-000000170e01'::uuid),
    ('place_unused', '00000000-0000-4000-8000-000000170e02'::uuid),
    ('P', '00000000-0000-4000-8000-000000170a01'::uuid),
    ('Q', '00000000-0000-4000-8000-000000170a02'::uuid),
    ('R', '00000000-0000-4000-8000-000000170a03'::uuid),
    ('N', '00000000-0000-4000-8000-000000170a09'::uuid),
    ('P1', '00000000-0000-4000-8000-000000170b11'::uuid),
    ('P2', '00000000-0000-4000-8000-000000170b12'::uuid),
    ('P3', '00000000-0000-4000-8000-000000170b13'::uuid),
    ('Q1', '00000000-0000-4000-8000-000000170b21'::uuid),
    ('Q2', '00000000-0000-4000-8000-000000170b22'::uuid),
    ('R1', '00000000-0000-4000-8000-000000170b31'::uuid)) v (name, id)
  where v.name = p_name
$f$;

-- tm_run: runs p_sql and then p_probe (a query that returns one text value) in one subtransaction
-- that is always undone, and returns the probe's value ('ok' without a probe), or the first error:
-- its SQLSTATE and constraint name for a constraint violation, else its SQLSTATE and message plus
-- any DETAIL and HINT (so a generic trigger message is also shown to carry no row data). The
-- constraint mode is restored before the undo (see 160_call_status), so a scenario that ends with
-- SET CONSTRAINTS ALL IMMEDIATE never leaves the file in immediate mode.
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
  v_detail text;
  v_hint text;
begin
  begin
    execute p_sql;
    if p_probe is null then
      v_result := 'ok';
    else
      execute p_probe into v_result;
    end if;
    v_done := true;
    set constraints all deferred;
    raise exception using errcode = 'TM001', message = 'undo the scenario';
  exception when others then
    if not v_done then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text,
        v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      v_result := v_state || ' ' || coalesce(nullif(v_constraint, ''),
        v_message || coalesce(' | detail: ' || nullif(v_detail, ''), '') || coalesce(' | hint: ' || nullif(v_hint, ''), ''));
    end if;
  end;
  return v_result;
end
$f$;

-- tm_then: as tm_run, but p_sql's error is caught and the probe still runs after it; returns the
-- error (as tm_run shows it, or 'ok') and the probe's value, separated by ' | '.
create function pg_temp.tm_then(p_sql text, p_probe text)
returns text
language plpgsql
as $f$
declare
  v_error text := 'ok';
  v_result text;
  v_state text;
  v_message text;
begin
  begin
    begin
      execute p_sql;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      v_error := v_state || ' ' || v_message;
    end;
    execute p_probe into v_result;
    raise exception using errcode = 'TM001', message = 'undo the scenario';
  exception when sqlstate 'TM001' then
    null;
  end;
  return v_error || ' | ' || v_result;
end
$f$;

-- tm_close_p1: the scratch writer of plan §10 (V27). A postgres-owned SECURITY DEFINER body that
-- closes visit P1 as done the way a Step 4 closure will: the status, the treatment summary, the
-- customer signature (hash of the NFC text as UTF-8), the status event and the recalculation of
-- the call (plan §3.2). p_skip leaves one of them out ('report', 'signature', 'event', 'recalc').
create function pg_temp.tm_close_p1(p_skip text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $f$
begin
  update public.visits v set status = 'done' where v.id = pg_temp.tm_id('P1');
  if p_skip is distinct from 'report' then
    insert into public.visit_reports (visit_id, summary_text, summary_source)
    values (pg_temp.tm_id('P1'), 'הוחלף חלק פנימי והמכשיר נבדק', 'written');
  end if;
  if p_skip is distinct from 'signature' then
    insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
    values (pg_temp.tm_id('P1'), 'חותם בדיקה', 'אני מאשר/ת שהטיפול בוצע.',
            encode(sha256(convert_to('אני מאשר/ת שהטיפול בוצע.', 'UTF8')), 'hex'), '00000000-0000-4000-8000-000000170e11');
  end if;
  if p_skip is distinct from 'event' then
    insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
    values (pg_temp.tm_id('P1'), 3, 'status_changed', 'scheduled', 'done');
  end if;
  if p_skip is distinct from 'recalc' then
    perform private.recalc_call_status(pg_temp.tm_id('P'));
  end if;
end
$f$;
grant execute on function pg_temp.tm_id(text), pg_temp.tm_run(text, text), pg_temp.tm_then(text, text),
  pg_temp.tm_close_p1(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Fixtures (local, rolled back; fictional, example.test, automated_test; D47)
-- ---------------------------------------------------------------------------------------------
-- Call P (open): visit P1 scheduled, Technician A, pickup place in use.
-- Call Q (resolved): visit Q1 followup (Technician A, reason in use, summary) and visit Q2 done
--   (Technician B, summary and signature); Q resolves by Q2.
-- Call R (awaiting_scheduling): visit R1 cancelled by the Manager.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'd1', 'd2']) as k;
select private.bootstrap_first_creator(pg_temp.tm_id('creator'), 'יוצר');
insert into public.profiles (id, role, full_name, is_active, work_phone) values
  (pg_temp.tm_id('manager'), 'manager', 'מנהל א', true, '03-000-0170'),
  (pg_temp.tm_id('tech_a_profile'), 'technician', 'טכנאי א', true, null),
  (pg_temp.tm_id('tech_b_profile'), 'technician', 'טכנאי ב', true, null);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  (pg_temp.tm_id('tech_a'), pg_temp.tm_id('tech_a_profile'), true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  (pg_temp.tm_id('tech_b'), pg_temp.tm_id('tech_b_profile'), true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  (pg_temp.tm_id('customer'), 'C-1701', 'לקוח בדיקה', '050-000-1701', 'automated_test', 'pr15-170-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  (pg_temp.tm_id('product'), 'kt-1701', 'KT-1701', 'מוצר בדיקה', 'automated_test', 'pr15-170-1');
insert into public.followup_reasons (id, label_he, sort_order, is_active, is_user_added, is_test, created_by) values
  (pg_temp.tm_id('reason'), 'סיבת בדיקה בשימוש', 6, true, true, true, pg_temp.tm_id('creator')),
  (pg_temp.tm_id('reason_unused'), 'סיבת בדיקה פנויה', 7, true, true, true, pg_temp.tm_id('creator'));
insert into public.collection_locations (id, name, place_type, sort_order, address, created_by) values
  (pg_temp.tm_id('place'), 'מחסן בדיקה בשימוש', 'logistics_center', 1, 'רחוב הבדיקה 1', pg_temp.tm_id('creator')),
  (pg_temp.tm_id('place_unused'), 'סניף בדיקה פנוי', 'branch', 2, 'רחוב הבדיקה 2', pg_temp.tm_id('creator'));

insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, handling_rep_profile_id, status, next_visit_number, resolved_at,
                                  data_source, source_ref) values
  (pg_temp.tm_id('P'), 'R-1701', pg_temp.tm_id('customer'), pg_temp.tm_id('product'),
   (select t.id from public.call_types t where t.sort_order = 1), 'המכשיר אינו מקרר', 'נציג בדיקה', pg_temp.tm_id('manager'),
   'open', 2, null, 'automated_test', 'pr15-170-p'),
  (pg_temp.tm_id('Q'), 'R-1702', pg_temp.tm_id('customer'), pg_temp.tm_id('product'),
   (select t.id from public.call_types t where t.sort_order = 1), 'רעש חריג', 'נציג בדיקה', null,
   'resolved', 3, now(), 'automated_test', 'pr15-170-q'),
  (pg_temp.tm_id('R'), 'R-1703', pg_temp.tm_id('customer'), pg_temp.tm_id('product'),
   (select t.id from public.call_types t where t.sort_order = 2), 'התקנה', 'נציג בדיקה', null,
   'awaiting_scheduling', 2, null, 'automated_test', 'pr15-170-r');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, pickup_location_id, followup_reason_id, next_visit_notes, cancelled_by,
                           source_ref) values
  (pg_temp.tm_id('P1'), pg_temp.tm_id('P'), pg_temp.tm_id('tech_a'), 1, 'T-1701', '2026-11-20 08:00:00+00',
   '2026-11-20 09:00:00+00', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 1', pg_temp.tm_id('place'), null, null, null,
   'pr15-170-p1'),
  (pg_temp.tm_id('Q1'), pg_temp.tm_id('Q'), pg_temp.tm_id('tech_a'), 1, 'T-1702', '2026-11-02 08:00:00+00',
   '2026-11-02 09:00:00+00', 'followup', 'עיר בדיקה', 'רחוב הבדיקה 2', null, pg_temp.tm_id('reason'),
   'להביא חלק חילוף', null, 'pr15-170-q1'),
  (pg_temp.tm_id('Q2'), pg_temp.tm_id('Q'), pg_temp.tm_id('tech_b'), 2, 'T-1703', '2026-11-03 08:00:00+00',
   '2026-11-03 09:00:00+00', 'done', 'עיר בדיקה', 'רחוב הבדיקה 2', null, null, null, null, 'pr15-170-q2'),
  (pg_temp.tm_id('R1'), pg_temp.tm_id('R'), pg_temp.tm_id('tech_a'), 1, 'T-1704', '2026-11-21 08:00:00+00',
   '2026-11-21 09:00:00+00', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 3', null, null, null, pg_temp.tm_id('manager'),
   'pr15-170-r1');
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  (pg_temp.tm_id('Q1'), 'אובחנה תקלה; נדרש חלק', 'written'),
  (pg_temp.tm_id('Q2'), 'הוחלף חלק והמכשיר פועל', 'approved_transcription');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id) values
  (pg_temp.tm_id('Q2'), 'חותמת בדיקה', 'אני מאשר/ת שהטיפול בוצע.',
   encode(sha256(convert_to('אני מאשר/ת שהטיפול בוצע.', 'UTF8')), 'hex'), '00000000-0000-4000-8000-000000170e21');
insert into public.visit_events (visit_id, version_after, event_type, to_status) values
  (pg_temp.tm_id('P1'), 1, 'created', 'scheduled'),
  (pg_temp.tm_id('Q1'), 1, 'created', 'followup'),
  (pg_temp.tm_id('Q2'), 1, 'created', 'done'),
  (pg_temp.tm_id('R1'), 1, 'created', 'cancelled');
select lives_ok('set constraints all immediate',
  'the fixture passes every deferred check (c10, c20, c30, c40) when they run (V4)');

-- Past server times, which no writer can set (t12 forces now()): every visit was assigned a day
-- ago, Q's visits were closed a day ago (Q's resolved_at follows Q2), and R1 was cancelled two
-- hours ago. Built with t12 disabled (V22); the deferred checks run again before t12 is restored.
alter table public.visits disable trigger t12_visit_state;
set constraints all deferred;
update public.visits v set assigned_at = now() - interval '1 day'
where v.id in (pg_temp.tm_id('P1'), pg_temp.tm_id('Q1'), pg_temp.tm_id('Q2'), pg_temp.tm_id('R1'));
update public.visits v set closed_at = now() - interval '1 day' where v.id in (pg_temp.tm_id('Q1'), pg_temp.tm_id('Q2'));
update public.visits v set cancelled_at = now() - interval '2 hours' where v.id = pg_temp.tm_id('R1');
update public.service_calls c set resolved_at = now() - interval '1 day' where c.id = pg_temp.tm_id('Q');
select lives_ok('set constraints all immediate', 'the back-dated fixture still passes every deferred check');
alter table public.visits enable trigger t12_visit_state;
set constraints all deferred;
select results_eq(
  $$ select c.request_number, c.status, c.resolved_at = now() - interval '1 day', c.next_visit_number
     from public.service_calls c where c.data_source = 'automated_test' order by c.request_number collate "C" $$,
  $$ values ('R-1701'::text, 'open'::text, null::boolean, 2), ('R-1702', 'resolved', true, 3),
            ('R-1703', 'awaiting_scheduling', null, 2) $$,
  'fixture: P open, Q resolved by Q2 (resolved_at = its closed_at), R awaiting scheduling');

-- ---------------------------------------------------------------------------------------------
-- 2. Visit CHECKs (D39, D44, SE-07, TE-21)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run($$ update public.visits v set status = 'followup' where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_followup_check', 'a follow-up outcome without a continuation reason is refused');
select is(pg_temp.tm_run($$ update public.visits v set status = 'followup', followup_reason_id = pg_temp.tm_id('reason')
                            where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_followup_check', 'a follow-up outcome without next-visit notes is refused');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'followup', followup_reason_id = pg_temp.tm_id('reason'),
       next_visit_notes = 'להביא חלק חילוף' || chr(10) || 'לתאם מראש' where v.id = pg_temp.tm_id('P1') $$,
  $$ select v.status || ' ' || (v.closed_at = now()) from public.visits v where v.id = pg_temp.tm_id('P1') $$),
  'followup true', 'a follow-up outcome with a reason and multi-line notes is accepted (closed_at set by the server)');
select is(pg_temp.tm_run($$ update public.visits v set scheduled_end = v.scheduled_start - interval '1 minute'
                            where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_schedule_check', 'a visit cannot end before it starts');
select is(pg_temp.tm_run($$ update public.visits v set scheduled_end = v.scheduled_start where v.id = pg_temp.tm_id('P1') $$),
  'ok', 'a visit may end when it starts (zero length)');
select is(pg_temp.tm_run($$ update public.visits v set cancelled_by = pg_temp.tm_id('manager') where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_cancelled_by_check', 'cancelled_by needs a cancellation time');
-- The remaining CHECKs back t12 (which forces these columns); they are reached with t12 disabled.
select is(pg_temp.tm_run($$ alter table public.visits disable trigger t12_visit_state;
                            update public.visits v set status = 'done' where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_closed_at_check', 'without t12: a done visit without closed_at is refused by the CHECK');
select is(pg_temp.tm_run($$ alter table public.visits disable trigger t12_visit_state;
                            update public.visits v set closed_at = now() where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_closed_at_check', 'without t12: an open visit with closed_at is refused by the CHECK');
select is(pg_temp.tm_run($$ alter table public.visits disable trigger t12_visit_state;
                            update public.visits v set status = 'cancelled' where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_cancelled_at_check', 'without t12: a cancelled visit without cancelled_at is refused by the CHECK');
select is(pg_temp.tm_run($$ alter table public.visits disable trigger t12_visit_state;
                            update public.visits v set cancelled_at = now() where v.id = pg_temp.tm_id('P1') $$),
  '23514 visits_open_not_cancelled_check', 'without t12: an open visit with cancelled_at is refused by the CHECK');

-- ---------------------------------------------------------------------------------------------
-- 3. Visit numbers (t35; D36 "earlier" = lower number, D38 "latest by number")
-- ---------------------------------------------------------------------------------------------
-- tm_new_visit(n): an INSERT of visit number n on call P (the other columns are valid).
create function pg_temp.tm_new_visit(p_id text, p_number integer, p_status text default 'scheduled')
returns text
language sql
immutable
as $f$
  select format($i$insert into public.visits (id, service_call_id, technician_id, visit_number, task_number,
      scheduled_start, scheduled_end, status, city, street, source_ref)
    values (pg_temp.tm_id(%L), pg_temp.tm_id('P'), pg_temp.tm_id('tech_b'), %s, 'T-17-%s', '2026-11-25 08:00:00+00',
      '2026-11-25 09:00:00+00', %L, 'עיר בדיקה', 'רחוב הבדיקה 4', 'pr15-170-n%s')$i$, p_id, p_number, p_number, p_status, p_number)
$f$;
select is(pg_temp.tm_run(pg_temp.tm_new_visit('P2', 2)),
  '23514 visits: visit numbers are allocated in order',
  'a visit number equal to next_visit_number is refused (the writer raises next_visit_number first)');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 4 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P3', 3),
                         $$ select string_agg(v.visit_number::text, ',' order by v.visit_number) from public.visits v
                            where v.service_call_id = pg_temp.tm_id('P') $$),
  '1,3', 'a visit number above every number of the call and below next_visit_number is accepted (a gap is allowed)');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 4 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P3', 3) || '; ' || pg_temp.tm_new_visit('P2', 2)),
  '23514 visits: visit numbers are allocated in order',
  'a visit number below the highest number of the call is refused (numbers follow creation order, M40)');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P2', 1)),
  '23514 visits: visit numbers are allocated in order', 'a visit number is never reused');
select is(pg_temp.tm_run($$ alter table public.visits disable trigger t35_visit_number;
                            update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P2', 1)),
  '23505 visits_service_call_id_visit_number_key', 'without t35 the unique key still refuses a second visit 1 of a call');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 2 where c.id = pg_temp.tm_id('Q') $$),
  '23514 service_calls: next_visit_number never decreases', 'next_visit_number never decreases');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 10 where c.id = pg_temp.tm_id('Q') $$),
  'ok', 'next_visit_number may grow (numbers are never reused, gaps are allowed)');
select is(pg_temp.tm_run($$ update public.visits v set visit_number = 5 where v.id = pg_temp.tm_id('P1') $$),
  '55000 visits: these fields are immutable', 'a visit number never changes');

-- ---------------------------------------------------------------------------------------------
-- 4. Server times (t12; D45, DEV-9): forced, never taken from a writer
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  $$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P');
     insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start,
       scheduled_end, status, city, street, assigned_at, closed_at, cancelled_at, source_ref)
     values (pg_temp.tm_id('P2'), pg_temp.tm_id('P'), pg_temp.tm_id('tech_b'), 2, 'T-1705', '2026-11-25 08:00:00+00',
       '2026-11-25 09:00:00+00', 'done', 'עיר בדיקה', 'רחוב הבדיקה 4', '2001-01-01 00:00:00+00', '2001-01-02 00:00:00+00',
       null, 'pr15-170-p2') $$,
  $$ select (v.assigned_at = now()) || ' ' || (v.closed_at = now()) || ' ' || (v.cancelled_at is null)
     from public.visits v where v.id = pg_temp.tm_id('P2') $$),
  'true true true', 'INSERT of a closed visit: assigned_at and closed_at are the server''s now(), whatever the writer sends');
select is(pg_temp.tm_run(
  $$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P');
     insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start,
       scheduled_end, status, city, street, assigned_at, closed_at, cancelled_at, source_ref)
     values (pg_temp.tm_id('P2'), pg_temp.tm_id('P'), pg_temp.tm_id('tech_b'), 2, 'T-1705', '2026-11-25 08:00:00+00',
       '2026-11-25 09:00:00+00', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 4', '2001-01-01 00:00:00+00',
       '2001-01-02 00:00:00+00', '2001-01-03 00:00:00+00', 'pr15-170-p2') $$,
  $$ select (v.assigned_at = now()) || ' ' || (v.closed_at is null) || ' ' || (v.cancelled_at is null)
     from public.visits v where v.id = pg_temp.tm_id('P2') $$),
  'true true true', 'INSERT of an open visit: assigned_at is now(); a sent closed_at or cancelled_at is dropped');
select is(pg_temp.tm_run(
  $$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P');
     insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start,
       scheduled_end, status, city, street, cancelled_at, source_ref)
     values (pg_temp.tm_id('P2'), pg_temp.tm_id('P'), pg_temp.tm_id('tech_b'), 2, 'T-1705', '2026-11-25 08:00:00+00',
       '2026-11-25 09:00:00+00', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 4', '2001-01-03 00:00:00+00', 'pr15-170-p2') $$,
  $$ select (v.cancelled_at = now()) || ' ' || (v.closed_at is null) from public.visits v where v.id = pg_temp.tm_id('P2') $$),
  'true true', 'INSERT of a cancelled visit: cancelled_at is now()');
select is(pg_temp.tm_run(
  $$ update public.visits v set technician_id = pg_temp.tm_id('tech_b'), assigned_at = '2001-01-01 00:00:00+00'
     where v.id = pg_temp.tm_id('P1') $$,
  $$ select (v.assigned_at = now())::text from public.visits v where v.id = pg_temp.tm_id('P1') $$),
  'true', 're-assignment of an open visit: assigned_at becomes now() (the writer''s value is ignored)');
select is(pg_temp.tm_run($$ update public.visits v set assigned_at = now() where v.id = pg_temp.tm_id('P1') $$),
  '55000 visits: assigned_at is set by the server', 'assigned_at does not change without a re-assignment');
select is(pg_temp.tm_run($$ update public.visits v set city = 'עיר אחרת', scheduled_start = '2026-11-20 07:00:00+00'
                            where v.id = pg_temp.tm_id('P1') $$,
                         $$ select (v.assigned_at = now() - interval '1 day')::text from public.visits v where v.id = pg_temp.tm_id('P1') $$),
  'true', 'other changes of an open visit keep assigned_at');
select is(pg_temp.tm_run($$ update public.visits v set closed_at = now() - interval '1 hour' where v.id = pg_temp.tm_id('P1') $$),
  '55000 visits: closed_at is set by the server', 'an open visit gets no closed_at from a writer');
select is(pg_temp.tm_run($$ update public.visits v set cancelled_at = now() - interval '1 hour' where v.id = pg_temp.tm_id('P1') $$),
  '55000 visits: cancelled_at is set by the server', 'an open visit gets no cancelled_at from a writer');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'done', closed_at = now() - interval '1 day' where v.id = pg_temp.tm_id('P1') $$,
  $$ select (v.closed_at = now())::text from public.visits v where v.id = pg_temp.tm_id('P1') $$),
  'true', 'a closure gets closed_at = now(), whatever the writer sends (M39)');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'cancelled', cancelled_at = now() - interval '1 day', cancelled_by = pg_temp.tm_id('manager')
     where v.id = pg_temp.tm_id('P1') $$,
  $$ select (v.cancelled_at = now()) || ' ' || (v.cancelled_by = pg_temp.tm_id('manager')) || ' ' || (v.closed_at is null)
     from public.visits v where v.id = pg_temp.tm_id('P1') $$),
  'true true true', 'a cancellation gets cancelled_at = now(); cancelled_by is the writer''s');
select is(pg_temp.tm_run($$ update public.visits v set closed_at = now() where v.id = pg_temp.tm_id('Q2') $$),
  '55000 visits: closed_at is set by the server', 'the closure time of a closed visit never changes');
select is(pg_temp.tm_run($$ update public.visits v set cancelled_at = now() where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: cancelled_at is set by the server', 'the cancellation time of a cancelled visit never changes');
-- D44: a closure accepted after cancellation keeps its original receipt time, within
-- [cancelled_at, now()] (Step 1 plan v6 §7.2 C1). R1 was cancelled two hours ago.
select is(pg_temp.tm_run($$ update public.visits v set status = 'done', closed_at = now() - interval '3 hours'
                            where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: closed_at is set by the server', 'D44: a receipt time before the cancellation is refused');
select is(pg_temp.tm_run($$ update public.visits v set status = 'done', closed_at = now() + interval '1 minute'
                            where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: closed_at is set by the server', 'D44: a receipt time in the future is refused');
select is(pg_temp.tm_run($$ update public.visits v set status = 'followup', followup_reason_id = pg_temp.tm_id('reason'),
                              next_visit_notes = 'לתאם שוב' where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: closed_at is set by the server', 'D44: an accepted closure without its receipt time is refused');
select is(pg_temp.tm_run($$ update public.visits v set status = 'done', closed_at = v.cancelled_at where v.id = pg_temp.tm_id('R1') $$,
                         $$ select (v.closed_at = v.cancelled_at)::text from public.visits v where v.id = pg_temp.tm_id('R1') $$),
  'true', 'D44: a receipt time equal to the cancellation time is accepted (closed interval)');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'done', closed_at = now() - interval '1 hour' where v.id = pg_temp.tm_id('R1');
     insert into public.visit_reports (visit_id, summary_text, summary_source) values (pg_temp.tm_id('R1'), 'טופל לפני הביטול', 'written');
     insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('R1'), 'חותם בדיקה', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
             '00000000-0000-4000-8000-000000170e31');
     insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
     values (pg_temp.tm_id('R1'), 3, 'status_changed', 'cancelled', 'done');
     select private.recalc_call_status(pg_temp.tm_id('R'));
     set constraints all immediate $$,
  $$ select v.status || ' ' || (v.closed_at = now() - interval '1 hour') || ' ' || (v.cancelled_at = now() - interval '2 hours')
            || ' ' || (v.cancelled_by = pg_temp.tm_id('manager')) || ' ' || c.status || ' ' || (c.resolved_at = v.closed_at)
     from public.visits v join public.service_calls c on c.id = v.service_call_id where v.id = pg_temp.tm_id('R1') $$),
  'done true true true resolved true',
  'D44: an accepted closure one hour ago keeps its receipt time and the cancellation, passes every deferred check and resolves the call at that time');

-- ---------------------------------------------------------------------------------------------
-- 5. Closed and cancelled visits (TEMPORARY, deny by default; D14, D39, D44)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run($$ update public.visits v set status = 'scheduled' where v.id = pg_temp.tm_id('Q2') $$),
  '55000 visits: invalid status change', 'a done visit never returns to an open status (M43)');
select is(pg_temp.tm_run($$ update public.visits v set status = 'cancelled' where v.id = pg_temp.tm_id('Q2') $$),
  '55000 visits: invalid status change', 'a done visit is never cancelled');
select is(pg_temp.tm_run($$ update public.visits v set status = 'in_progress' where v.id = pg_temp.tm_id('Q1') $$),
  '55000 visits: invalid status change', 'a follow-up visit never returns to an open status');
select is(pg_temp.tm_run($$ update public.visits v set status = 'scheduled' where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: invalid status change', 'a cancelled visit never returns to an open status');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'followup', followup_reason_id = pg_temp.tm_id('reason'), next_visit_notes = 'לבדוק שוב'
     where v.id = pg_temp.tm_id('Q2') $$,
  $$ select v.status || ' ' || (v.closed_at = now() - interval '1 day') from public.visits v where v.id = pg_temp.tm_id('Q2') $$),
  'followup true', 'done -> followup is accepted and keeps the closure time (OQ-14)');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'done' where v.id = pg_temp.tm_id('Q1') $$,
  $$ select v.status || ' ' || (v.closed_at = now() - interval '1 day') from public.visits v where v.id = pg_temp.tm_id('Q1') $$),
  'done true', 'followup -> done keeps the closure time (the signature rule is checked at COMMIT, 160)');
select is(pg_temp.tm_run(
  $$ update public.visits v set status = 'en_route' where v.id = pg_temp.tm_id('P1');
     update public.visits v set status = 'in_progress' where v.id = pg_temp.tm_id('P1');
     update public.visits v set status = 'scheduled' where v.id = pg_temp.tm_id('P1') $$,
  $$ select v.status || ' ' || (v.closed_at is null) || ' ' || (v.cancelled_at is null) from public.visits v
     where v.id = pg_temp.tm_id('P1') $$),
  'scheduled true true', 'moves among the open statuses are not restricted in PR 1.5 (Step 4, Step 6 and PR 1.6 decide)');
select is(pg_temp.tm_run($$ update public.visits v set city = 'עיר אחרת' where v.id = pg_temp.tm_id('Q2') $$),
  '55000 visits: a closed or cancelled visit keeps its assignment, schedule, address, notes and pickup',
  'the address of a closed visit never changes (D39)');
select is(pg_temp.tm_run($$ update public.visits v set technician_id = pg_temp.tm_id('tech_a') where v.id = pg_temp.tm_id('Q2') $$),
  '55000 visits: a closed or cancelled visit keeps its assignment, schedule, address, notes and pickup',
  'a closed visit is never re-assigned');
select is(pg_temp.tm_run($$ update public.visits v set tech_notes = 'הערה מאוחרת', pickup_location_id = pg_temp.tm_id('place')
                            where v.id = pg_temp.tm_id('Q1') $$),
  '55000 visits: a closed or cancelled visit keeps its assignment, schedule, address, notes and pickup',
  'the notes and pickup of a closed visit never change');
select is(pg_temp.tm_run($$ update public.visits v set scheduled_start = '2026-11-21 07:00:00+00' where v.id = pg_temp.tm_id('R1') $$),
  '55000 visits: a closed or cancelled visit keeps its assignment, schedule, address, notes and pickup',
  'the schedule of a cancelled visit never changes');

-- ---------------------------------------------------------------------------------------------
-- 6. Deferred visit checks c10 (a)-(d) in the caller's context (V3; SECURITY DEFINER, OQ-2)
-- ---------------------------------------------------------------------------------------------
-- The scratch writer closes P1 (or leaves one part out); the role under test then runs SET
-- CONSTRAINTS ALL IMMEDIATE itself. The check reads rows the caller cannot read (the call row for
-- every role here; the signature and the summary for a Manager without `card`), so it must run with
-- its owner's rights (M8 makes it SECURITY INVOKER and fails these cases).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'card', false, 1, null), 2,
  'the Creator turns `card` off for Managers (TEMPORARY D51 values otherwise unchanged)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1(null); set constraints all immediate $$,
                         $$ select current_user || ' ' || (select count(*) from public.service_calls) || ' '
                                   || (select v.status from public.visits v where v.id = pg_temp.tm_id('P1')) $$),
  'authenticated 0 done',
  'Technician A (who reads no call row): a complete closure passes c10, c20, c30 and c40 run in his session');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('signature'); set constraints all immediate $$),
  '23514 visits: a completed visit needs the customer signature', 'Technician A: c10 (a) a done visit without a signature fails (M9)');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('report'); set constraints all immediate $$),
  '23514 visits: a closed visit needs its treatment summary', 'Technician A: c10 (b) a closed visit without a summary fails');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('recalc'); set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)',
  'Technician A: c10 (c) a visit change without the call recalculation fails');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('event'); set constraints all immediate $$),
  '23514 visits: the status history does not match the visit', 'Technician A: c10 (d) a status change without its event fails (M46)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1(null); set constraints all immediate $$,
                         $$ select (select count(*) from public.visit_signatures) || ' ' || (select count(*) from public.visit_reports)
                                   || ' ' || (select v.status from public.visits v where v.id = pg_temp.tm_id('P1'))
                                   || ' ' || (select c.status from public.service_calls c where c.id = pg_temp.tm_id('P')) $$),
  '0 0 done resolved',
  'Manager without `card`: a complete closure passes c10 in his session although he reads no signature or summary (M8)');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('signature'); set constraints all immediate $$),
  '23514 visits: a completed visit needs the customer signature', 'Manager without `card`: c10 (a) fails without a signature');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('report'); set constraints all immediate $$),
  '23514 visits: a closed visit needs its treatment summary', 'Manager without `card`: c10 (b) fails without a summary');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('recalc'); set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)', 'Manager without `card`: c10 (c) fails without the recalculation');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('event'); set constraints all immediate $$),
  '23514 visits: the status history does not match the visit', 'Manager without `card`: c10 (d) fails without the status event');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1(null); set constraints all immediate $$, $$ select current_user::text $$),
  'service_role', 'service_role (no table grant at all): a complete closure passes c10, c20, c30 and c40 run in its session');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('signature'); set constraints all immediate $$),
  '23514 visits: a completed visit needs the customer signature', 'service_role: c10 (a) fails without a signature');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('report'); set constraints all immediate $$),
  '23514 visits: a closed visit needs its treatment summary', 'service_role: c10 (b) fails without a summary');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('recalc'); set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)', 'service_role: c10 (c) fails without the recalculation');
select is(pg_temp.tm_run($$ select pg_temp.tm_close_p1('event'); set constraints all immediate $$),
  '23514 visits: the status history does not match the visit', 'service_role: c10 (d) fails without the status event');
reset role;
select set_config('request.jwt.claims', '', true);

-- c10 (c) on a cancellation and (d) on a new visit (written as postgres).
select is(pg_temp.tm_run($$ update public.visits v set status = 'cancelled' where v.id = pg_temp.tm_id('P1');
                            insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
                            values (pg_temp.tm_id('P1'), 3, 'status_changed', 'scheduled', 'cancelled');
                            set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)',
  'c10 (c): a cancellation without the recalculation fails');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P2', 2) || '; set constraints all immediate'),
  '23514 visits: the status history does not match the visit', 'c10 (d): a new visit without any event fails');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P2', 2) || $$;
                            insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
                            values (pg_temp.tm_id('P2'), 1, 'status_changed', 'en_route', 'scheduled');
                            set constraints all immediate $$),
  '23514 visits: the status history does not match the visit',
  'c10 (d): a new visit whose events end in its status but has no created event fails');
select is(pg_temp.tm_run($$ update public.service_calls c set next_visit_number = 3 where c.id = pg_temp.tm_id('P'); $$
                         || pg_temp.tm_new_visit('P2', 2) || $$;
                            insert into public.visit_events (visit_id, version_after, event_type, to_status)
                            values (pg_temp.tm_id('P2'), 1, 'created', 'scheduled');
                            set constraints all immediate $$),
  'ok', 'a new open visit with its created event on an open call passes every deferred check');

-- ---------------------------------------------------------------------------------------------
-- 7. Deferred call, signature and summary checks: c20 (a)-(c), c30, c40
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run(
  $$ insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
       handling_rep_name, status, next_visit_number, data_source, source_ref)
     values (pg_temp.tm_id('N'), 'R-1709', pg_temp.tm_id('customer'), pg_temp.tm_id('product'),
       (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג בדיקה', 'open', 2, 'automated_test',
       'pr15-170-n');
     set constraints all immediate $$),
  '23514 service_calls: a call has at least one visit', 'c20 (a): a call without a visit fails');
select is(pg_temp.tm_run($$ update public.service_calls c set status = 'awaiting_scheduling' where c.id = pg_temp.tm_id('P');
                            set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)',
  'c20 (b): a call status written without its visits fails');
select is(pg_temp.tm_run($$ update public.service_calls c set resolved_at = now() where c.id = pg_temp.tm_id('Q');
                            set constraints all immediate $$),
  '23514 service_calls: the stored call status does not match its visits (D38)',
  'c20 (b): a resolved_at other than the resolving visit''s closed_at fails (TEMPORARY OQ-3)');
select is(pg_temp.tm_run($$ alter table public.service_calls disable trigger t35_call_guard;
                            update public.service_calls c set next_visit_number = 2 where c.id = pg_temp.tm_id('Q');
                            set constraints all immediate $$),
  '23514 service_calls: next_visit_number must be above every visit number',
  'c20 (c): with t35 disabled, a next_visit_number not above every visit number still fails at COMMIT (M56)');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('Q1'), 'חותם', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
             '00000000-0000-4000-8000-000000170e12');
     set constraints all immediate $$),
  '23514 visit_signatures: a signature belongs to a completed visit', 'c30: no signature on a follow-up visit (M41)');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('P1'), 'חותם', 'אישור', encode(sha256(convert_to('אישור', 'UTF8')), 'hex'),
             '00000000-0000-4000-8000-000000170e13');
     set constraints all immediate $$),
  '23514 visit_signatures: a signature belongs to a completed visit', 'c30: no signature on a scheduled visit');
select is(pg_temp.tm_run(
  $$ insert into public.visit_reports (visit_id, summary_text, summary_source) values (pg_temp.tm_id('P1'), 'טיוטה', 'written');
     set constraints all immediate $$),
  '23514 visit_reports: a treatment summary belongs to a closed visit', 'c40: no summary on an open visit (no server draft, M42)');
select is(pg_temp.tm_run(
  $$ insert into public.visit_reports (visit_id, summary_text, summary_source) values (pg_temp.tm_id('R1'), 'טיוטה', 'written');
     set constraints all immediate $$),
  '23514 visit_reports: a treatment summary belongs to a closed visit', 'c40: no summary on a cancelled visit');

-- ---------------------------------------------------------------------------------------------
-- 8. Signatures are immutable; the hash is of the NFC text as UTF-8 (D43)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_run($$ update public.visit_signatures s set signer_name = 'שם אחר' where s.visit_id = pg_temp.tm_id('Q2') $$),
  '55000 visit_signatures is append-only', 'a signature is never changed (as postgres)');
select is(pg_temp.tm_run($$ delete from public.visit_signatures s where s.visit_id = pg_temp.tm_id('Q2') $$),
  '55000 visit_signatures is append-only', 'a signature is never deleted (as postgres)');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('P1'), 'חותם', 'אישור', encode(sha256(convert_to('אישור אחר', 'UTF8')), 'hex'),
             '00000000-0000-4000-8000-000000170e14') $$),
  '23514 visit_signatures_ack_text_sha256_check', 'a hash of another text is refused');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('P1'), 'חותם', 'אישור', upper(encode(sha256(convert_to('אישור', 'UTF8')), 'hex')),
             '00000000-0000-4000-8000-000000170e14') $$),
  '23514 visit_signatures_ack_text_sha256_check', 'the hash is lower-case hex only');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('P1'), 'חותם', 'caf' || U&'e\0301', encode(sha256(convert_to('caf' || U&'e\0301', 'UTF8')), 'hex'),
             '00000000-0000-4000-8000-000000170e14') $$),
  '23514 visit_signatures_signed_ack_text_check', 'an approval text that is not NFC is refused, even with its own hash');
select is(pg_temp.tm_run(
  $$ insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
     values (pg_temp.tm_id('P1'), 'חותם', 'אני מאשר/ת' || chr(10) || 'שהטיפול בוצע', '00', '00000000-0000-4000-8000-000000170e14') $$),
  '23514 visit_signatures_ack_text_sha256_check', 'a hash that is not 64 hex digits is refused');

-- ---------------------------------------------------------------------------------------------
-- 9. Settings deletes of a row in use (D55 (1); SE-06, SE-07): the new RESTRICT foreign keys make
--    the PR 1.4 bodies answer "in use", and no audit row is left (V20).
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_then($$ select public.delete_followup_reason(pg_temp.tm_id('reason'), 1) $$,
                          $$ select (select count(*) from public.audit_logs a where a.action = 'followup_reason.deleted')
                                    || ' ' || (select count(*) from public.followup_reasons r where r.id = pg_temp.tm_id('reason')) $$),
  '55000 in use; deactivate it instead | 0 1',
  'deleting a continuation reason a visit uses answers "in use"; the reason stays and no audit row is left');
select is(pg_temp.tm_then($$ select public.delete_followup_reason(pg_temp.tm_id('reason_unused'), 1) $$,
                          $$ select (select count(*) from public.audit_logs a where a.action = 'followup_reason.deleted')
                                    || ' ' || (select count(*) from public.followup_reasons r where r.id = pg_temp.tm_id('reason_unused')) $$),
  'ok | 1 0', 'positive control: an unused user-added reason is deleted, with its audit row');
select is(pg_temp.tm_then($$ select public.delete_collection_location(pg_temp.tm_id('place'), 1) $$,
                          $$ select (select count(*) from public.audit_logs a where a.action = 'collection_location.deleted')
                                    || ' ' || (select count(*) from public.collection_locations l where l.id = pg_temp.tm_id('place')) $$),
  '55000 in use; deactivate it instead | 0 1',
  'deleting a pickup place a visit uses answers "in use"; the place stays and no audit row is left (M33)');
select is(pg_temp.tm_then($$ select public.delete_collection_location(pg_temp.tm_id('place_unused'), 1) $$,
                          $$ select (select count(*) from public.audit_logs a where a.action = 'collection_location.deleted')
                                    || ' ' || (select count(*) from public.collection_locations l where l.id = pg_temp.tm_id('place_unused')) $$),
  'ok | 1 0', 'positive control: an unused pickup place is deleted, with its audit row');
reset role;
select set_config('request.jwt.claims', '', true);

-- Nothing above changed the fixture: every scenario was undone.
select results_eq(
  $$ select v.id, v.status, v.version from public.visits v
     where v.service_call_id in (pg_temp.tm_id('P'), pg_temp.tm_id('Q'), pg_temp.tm_id('R'))
     order by v.id $$,
  $$ values (pg_temp.tm_id('P1'), 'scheduled'::text, 2), (pg_temp.tm_id('Q1'), 'followup', 3), (pg_temp.tm_id('Q2'), 'done', 3),
            (pg_temp.tm_id('R1'), 'cancelled', 3) $$,
  'every scenario was undone: the visits are as the fixture left them');

select * from finish();
rollback;
