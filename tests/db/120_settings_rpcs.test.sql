-- PR 1.4: the eight Settings RPCs (call types, continuation reasons, pickup places; D35, D48,
-- SE-06, SE-07, SE-16; docs/database-schema.md §1, §2 l.48, §4, §8.3; docs/security.md §5, §8,
-- §9; docs/testing.md categories 2, 4, 5 and 6). Every call runs as `authenticated` with the
-- caller's JWT claims, as PostgREST does.
--
-- Covered: every RPC for every caller (anon, signed in without a profile, deactivated,
-- Technician, Customer Service and Manager with and without the `settings` key, Creator,
-- service_role); stored values and returned {id, is_test}; versions (PT409) and no-change calls;
-- unknown and tampered ids; test callers never touch real (D48) rows; input validation; the
-- 100-row cap; the last-active-reason rule (DEMO l.1158); the conditional deletes (initial
-- reasons, rows in use, deletes that remove no row); the advisory locks that serialise the
-- sort order and the active-reason count; error masking; and the audit rows (TEMPORARY, OQ-9),
-- written for each action and only then.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr14 §13): every row created in the app is
-- test data (OQ-4); no rename (OQ-5); closed place types (OQ-6); text rules and the 100-row cap
-- (OQ-8); Settings actions audited, the Manager audit policy unchanged (OQ-9). Matrix values are
-- the TEMPORARY D51 defaults: `settings` off for Manager and Customer Service.
--
-- Outcomes are read through pg_temp.tm_try, which runs one statement and returns 'ok' plus its
-- first value, or the SQLSTATE and message plus any DETAIL and HINT. Comparing the whole string
-- therefore also proves that no error carries a DETAIL or HINT (no row data reaches the client).
begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

-- Fixtures (local, rolled back): see 020_markers.test.sql. a8 is a real-marked active Manager
-- (PR 1.3 Q3 reading); a9 and b2 are deactivated; f1 is an Auth user without a profile.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a8', 'a9', 'b1', 'b2', 'd1', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000a8', 'manager', 'מנהל אמיתי', true, false);

-- Helpers (pg_temp, rolled back). tm_ids maps short keys to row ids: ct1/ct2 and r1..r5 are the
-- D48 rows (by sort order); the other keys are rows created below.
create temporary table tm_ids (k text primary key, id uuid not null unique, is_test boolean) on commit drop;
grant select on pg_temp.tm_ids to anon, authenticated, service_role;
grant insert on pg_temp.tm_ids to authenticated;
insert into pg_temp.tm_ids (k, id, is_test)
select 'ct' || c.sort_order, c.id, c.is_test from public.call_types c
union all
select 'r' || r.sort_order, r.id, r.is_test from public.followup_reasons r;

create function pg_temp.tm_try(p_sql text)
returns text
language plpgsql
as $f$
declare
  v_out text;
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
begin
  execute p_sql into v_out;
  return 'ok' || coalesce(' ' || nullif(v_out, ''), '');
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
    v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_state || ' ' || v_message || coalesce(' | detail: ' || nullif(v_detail, ''), '')
    || coalesce(' | hint: ' || nullif(v_hint, ''), '');
end
$f$;

-- One call of each of the eight RPCs against test rows the Creator creates below. Every caller
-- that may not use Settings must get the same refusal from all eight, before any input or target
-- is looked at.
create function pg_temp.tm_matrix()
returns table (rpc text, outcome text)
language sql
as $f$
  select v.rpc, pg_temp.tm_try(v.q)
  from (values
    (1, 'add_call_type', $q$ select r.id from public.add_call_type('סוג מהמטריצה') r $q$),
    (2, 'set_call_type_active',
        $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, 1) $q$),
    (3, 'add_followup_reason', $q$ select r.id from public.add_followup_reason('סיבה מהמטריצה') r $q$),
    (4, 'set_followup_reason_active',
        $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 1) $q$),
    (5, 'delete_followup_reason',
        $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), 1) $q$),
    (6, 'add_collection_location',
        $q$ select r.id from public.add_collection_location('מקום מהמטריצה', 'branch', 'רחוב המטריצה 1', null, null) r $q$),
    (7, 'set_collection_location_active',
        $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), false, 1) $q$),
    (8, 'delete_collection_location',
        $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), 1) $q$)
  ) v (n, rpc, q)
  order by v.n
$f$;

-- The Settings audit rows written since the last mark, in order (read as postgres).
create function pg_temp.tm_mark()
returns text
language sql
as $f$ select set_config('tm_test.audit_mark', (select coalesce(max(a.id), 0) from public.audit_logs a)::text, true) $f$;
create function pg_temp.tm_audit()
returns table (action text, target text, target_is_test boolean, actor text, details jsonb)
language sql
as $f$
  select a.action, coalesce(k.k, a.target_id::text), a.target_is_test, right(a.actor_profile_id::text, 2), a.details
  from public.audit_logs a
  left join pg_temp.tm_ids k on k.id = a.target_id
  where a.id > coalesce(nullif(current_setting('tm_test.audit_mark', true), ''), '0')::bigint
    and a.target_table in ('call_types', 'followup_reasons', 'collection_locations')
  order by a.id
$f$;

-- Whether this transaction holds the advisory lock of a key (pg_advisory_xact_lock(bigint)).
create function pg_temp.tm_holds(p_key text)
returns boolean
language sql
as $f$
  select exists (
    select 1 from pg_catalog.pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.mode = 'ExclusiveLock'
      and l.objsubid = 1
      and l.classid::bigint = (hashtextextended(p_key, 0) >> 32) & 4294967295
      and l.objid::bigint = hashtextextended(p_key, 0) & 4294967295)
$f$;

-- Runs one statement in a subtransaction, reads whether it took the advisory lock of a key, and
-- rolls the subtransaction back (which also releases a lock taken inside it). Each probe therefore
-- starts from a transaction that does not hold the lock, and leaves nothing behind.
create function pg_temp.tm_lock_probe(p_sql text, p_key text)
returns text
language plpgsql
as $f$
begin
  if pg_temp.tm_holds(p_key) then
    return 'already held before the call';
  end if;
  begin
    execute p_sql;
    raise exception using errcode = 'P0001', message = 'tm_probe:' || pg_temp.tm_holds(p_key)::text;
  exception when others then
    if sqlerrm like 'tm_probe:%' then
      return 'lock taken: ' || substr(sqlerrm, 10);
    end if;
    return 'the call failed: ' || sqlstate || ' ' || sqlerrm;
  end;
end
$f$;

grant execute on function pg_temp.tm_try(text), pg_temp.tm_matrix() to anon, authenticated, service_role;
grant execute on function pg_temp.tm_holds(text), pg_temp.tm_lock_probe(text, text) to authenticated;
select pg_temp.tm_mark();

-- =================================================================================================
-- 0. Advisory locks (concurrency; testing.md cat. 13). pgTAP runs in one session, so a race cannot
--    be played out here; instead each probe shows that the RPC takes the lock that serialises it:
--    the sort-order lock of its list (the unique index is the backstop), and the active-reason lock
--    for a reason deactivation and for a reason delete (so two callers cannot each remove "the
--    other last" active reason). Every probe is rolled back.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_lock_probe(v.q, v.lock) from (values
       (1, 'add_call_type', $q$ select r.id from public.add_call_type('סוג לבדיקת נעילה') r $q$, 'tm.call_types.sort_order'),
       (2, 'add_followup_reason', $q$ select r.id from public.add_followup_reason('סיבה לבדיקת נעילה') r $q$, 'tm.followup_reasons.sort_order'),
       (3, 'add_collection_location', $q$ select r.id from public.add_collection_location('מקום לבדיקת נעילה', 'branch', 'רחוב הנעילה 1', null, null) r $q$,
           'tm.collection_locations.sort_order'),
       (4, 'set_followup_reason_active (deactivate)',
           $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r1'), false, 1) $q$, 'tm.followup_reasons.active'),
       (5, 'delete_followup_reason', $q$ select public.delete_followup_reason(r.id, 1) from public.add_followup_reason('סיבה למחיקת נעילה') r $q$,
           'tm.followup_reasons.active')
     ) v (n, k, q, lock) order by v.n $$,
  $$ values ('add_call_type', 'lock taken: true'), ('add_followup_reason', 'lock taken: true'),
            ('add_collection_location', 'lock taken: true'), ('set_followup_reason_active (deactivate)', 'lock taken: true'),
            ('delete_followup_reason', 'lock taken: true') $$,
  'each add takes its list''s sort-order advisory lock; a reason deactivation and a reason delete take the active-reason lock');
reset role;
select results_eq(
  $$ values (pg_temp.tm_holds('tm.call_types.sort_order') or pg_temp.tm_holds('tm.followup_reasons.sort_order')
             or pg_temp.tm_holds('tm.collection_locations.sort_order') or pg_temp.tm_holds('tm.followup_reasons.active'),
             (select count(*) from public.call_types) + (select count(*) from public.followup_reasons)
             + (select count(*) from public.collection_locations),
             (select count(*) from pg_temp.tm_audit())) $$,
  $$ values (false, 7::bigint, 0::bigint) $$,
  'the probes left no lock, no row and no audit row');

-- =================================================================================================
-- A. The Creator (the real user) adds one row to each list.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'ct_c1', r.id, r.is_test from public.add_call_type('  סוג בדיקה  ') r returning is_test $$),
  'ok true', 'Creator: add_call_type returns is_test = true (TEMPORARY OQ-4: every app-created row is test data, also the Creator''s)');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'r_c1', r.id, r.is_test from public.add_followup_reason('סיבת בדיקה') r returning is_test $$),
  'ok true', 'Creator: add_followup_reason returns is_test = true');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'p_c1', r.id, r.is_test
     from public.add_collection_location(' מחסן בדיקה ', 'logistics_center', ' רחוב הבדיקה 1, תל אביב ', ' 03-000-0000 ', '   ') r returning is_test $$),
  'ok true', 'Creator: add_collection_location returns is_test = true');
reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select c.label_he, c.sort_order, c.is_active, c.is_test, right(c.created_by::text, 2), right(c.updated_by::text, 2), c.version
     from public.call_types c where c.id = (select t.id from pg_temp.tm_ids t where t.k = 'ct_c1') $$,
  $$ values ('סוג בדיקה', 3, true, true, 'c1', 'c1', 1) $$,
  'the call type is stored trimmed, appended after the D48 rows (sort_order 3), active, test-marked, created and updated by the caller, version 1');
select results_eq(
  $$ select r.label_he, r.sort_order, r.is_active, r.is_user_added, r.is_test, right(r.created_by::text, 2), right(r.updated_by::text, 2), r.version
     from public.followup_reasons r where r.id = (select t.id from pg_temp.tm_ids t where t.k = 'r_c1') $$,
  $$ values ('סיבת בדיקה', 6, true, true, true, 'c1', 'c1', 1) $$,
  'the reason is stored user-added (deletable while unused), appended after the five D48 reasons, test-marked');
select results_eq(
  $$ select l.name, l.place_type, l.sort_order, l.address, l.phone, l.opening_hours, l.is_active, l.is_test,
            right(l.created_by::text, 2), right(l.updated_by::text, 2), l.version
     from public.collection_locations l where l.id = (select t.id from pg_temp.tm_ids t where t.k = 'p_c1') $$,
  $$ values ('מחסן בדיקה', 'logistics_center', 1, 'רחוב הבדיקה 1, תל אביב', '03-000-0000', null::text, true, true, 'c1', 'c1', 1) $$,
  'the place is stored trimmed (a blank optional field becomes NULL), first in order, active, test-marked');
select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('call_type.created', 'ct_c1', true, 'c1', '{}'::jsonb),
            ('followup_reason.created', 'r_c1', true, 'c1', '{}'::jsonb),
            ('collection_location.created', 'p_c1', true, 'c1', '{}'::jsonb) $$,
  'A: one audit row per add, with the caller as actor and target_is_test from the new row (TEMPORARY, OQ-9)');

-- =================================================================================================
-- B. Callers who may not use Settings (D51 defaults: `settings` off for Manager and Customer
--    Service): the same generic refusal from all eight RPCs, and nothing changes.
-- =================================================================================================
select pg_temp.tm_mark();

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'Technician: all eight Settings RPCs are refused (42501)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'Manager with the D51 default (settings off): all eight Settings RPCs are refused (42501)');
select is(pg_temp.tm_try($$ select r.created_id from private.add_call_type('סוג ישיר') r $$), '42501 not authorized',
  'Manager without settings: calling the private body directly is refused too (each body checks its caller, DEV-13)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'Customer Service with the D51 default (settings off): all eight Settings RPCs are refused (42501)');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","user_role":"creator","app_metadata":{"role":"creator"},"user_metadata":{"role":"creator"}}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'a signed-in user without a profile, with forged Creator claims: all eight refused (roles come from profiles only)');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","user_role":"creator","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ select r.id from public.add_call_type('סוג מזויף') r $$), '42501 not authorized',
  'a Technician with forged Creator claims is still refused');
reset role;

select set_config('request.jwt.claims', '', true);
set local role anon;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 permission denied for function add_call_type'),
            ('set_call_type_active', '42501 permission denied for function set_call_type_active'),
            ('add_followup_reason', '42501 permission denied for function add_followup_reason'),
            ('set_followup_reason_active', '42501 permission denied for function set_followup_reason_active'),
            ('delete_followup_reason', '42501 permission denied for function delete_followup_reason'),
            ('add_collection_location', '42501 permission denied for function add_collection_location'),
            ('set_collection_location_active', '42501 permission denied for function set_collection_location_active'),
            ('delete_collection_location', '42501 permission denied for function delete_collection_location') $$,
  'anon: no EXECUTE on any Settings RPC');
select is(pg_temp.tm_try($$ select r.created_id from private.add_call_type('סוג ישיר') r $$),
  '42501 permission denied for schema private', 'anon: no access to the private bodies');
reset role;
set local role service_role;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 permission denied for function add_call_type'),
            ('set_call_type_active', '42501 permission denied for function set_call_type_active'),
            ('add_followup_reason', '42501 permission denied for function add_followup_reason'),
            ('set_followup_reason_active', '42501 permission denied for function set_followup_reason_active'),
            ('delete_followup_reason', '42501 permission denied for function delete_followup_reason'),
            ('add_collection_location', '42501 permission denied for function add_collection_location'),
            ('set_collection_location_active', '42501 permission denied for function set_collection_location_active'),
            ('delete_collection_location', '42501 permission denied for function delete_collection_location') $$,
  'service_role: no EXECUTE on any Settings RPC (it bypasses RLS, not grants)');
select is(pg_temp.tm_try($$ select private.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), 1) $$),
  '42501 permission denied for schema private', 'service_role: no access to the private bodies');
reset role;

select results_eq(
  $$ select (select count(*) from public.call_types), (select count(*) from public.followup_reasons),
            (select count(*) from public.collection_locations),
            (select sum(c.version) from public.call_types c) + (select sum(r.version) from public.followup_reasons r)
              + (select sum(l.version) from public.collection_locations l),
            (select count(*) from pg_temp.tm_audit()) $$,
  $$ values (3::bigint, 6::bigint, 1::bigint, 10::bigint, 0::bigint) $$,
  'B: every refused call changed nothing (no row added, removed or changed) and wrote no audit row');

-- =================================================================================================
-- C. Manager with `settings` turned on by the Creator: test rows only.
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'settings', true, 1, null), 2, 'the Creator turns settings on for Managers');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'ct_a1', r.id, r.is_test from public.add_call_type('סוג מנהל') r returning is_test $$),
  'ok true', 'Manager with settings: add_call_type');
select is(pg_temp.tm_try($$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, 1) $$),
  'ok 2', 'Manager with settings: deactivates a test call type (returns the new version)');
select is(pg_temp.tm_try($$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), true, 2) $$),
  'ok 3', 'Manager with settings: reactivates it');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'r_a1', r.id, r.is_test from public.add_followup_reason('סיבת מנהל') r returning is_test $$),
  'ok true', 'Manager with settings: add_followup_reason');
select is(pg_temp.tm_try($$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_a1'), false, 1) $$),
  'ok 2', 'Manager with settings: set_followup_reason_active');
select is(pg_temp.tm_try($$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_a1'), 2) $$),
  'ok', 'Manager with settings: delete_followup_reason (user-added, unused)');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'p_a1', r.id, r.is_test
     from public.add_collection_location('סניף מנהל', 'branch', 'רחוב המנהל 2', null, 'א-ה 09:00-17:00') r returning is_test $$),
  'ok true', 'Manager with settings: add_collection_location');
select is(pg_temp.tm_try($$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_a1'), false, 1) $$),
  'ok 2', 'Manager with settings: set_collection_location_active');
select is(pg_temp.tm_try($$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_a1'), 2) $$),
  'ok', 'Manager with settings: delete_collection_location (unreferenced)');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'set_call_type_active ct1', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct1'), false, 1) $q$),
       (2, 'set_followup_reason_active r1', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r1'), false, 1) $q$),
       (3, 'delete_followup_reason r1', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r1'), 1) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('set_call_type_active ct1', '42501 not authorized'), ('set_followup_reason_active r1', '42501 not authorized'),
            ('delete_followup_reason r1', '42501 not authorized') $$,
  'a test Manager with settings never changes a real D48 row: the same generic 42501 as an unknown id (DBS §2 l.48)');
reset role;

-- The rule follows the caller's marker, not his role: a real-marked Manager with settings may
-- change a real row (only the real Creator exists until go-live, D49).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct2'), false, 1) $q$),
             pg_temp.tm_try($q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct2'), true, 2) $q$)) $$,
  $$ values ('ok 2', 'ok 3') $$,
  'a real-marked Manager with settings deactivates and reactivates a real D48 call type');
reset role;

-- A deactivated Manager is refused even while Managers hold `settings`; a deactivation takes
-- effect at the next call.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'a deactivated Manager: all eight refused, although Managers hold settings');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'ct_a2', r.id, r.is_test from public.add_call_type('סוג מנהל ב') r returning is_test $$),
  'ok true', 'a second Manager with settings adds a call type');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_user_active('00000000-0000-4000-8000-0000000000a2', false, 1, null), 2, 'the Creator deactivates that Manager');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ select r.id from public.add_call_type('סוג אחרי השבתה') r $$), '42501 not authorized',
  'the deactivated Manager is refused at his next call');
reset role;

select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('call_type.created', 'ct_a1', true, 'a1', '{}'::jsonb),
            ('call_type.deactivated', 'ct_c1', true, 'a1', '{}'::jsonb),
            ('call_type.activated', 'ct_c1', true, 'a1', '{}'::jsonb),
            ('followup_reason.created', 'r_a1', true, 'a1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r_a1', true, 'a1', '{}'::jsonb),
            ('followup_reason.deleted', 'r_a1', true, 'a1', '{"label": "סיבת מנהל"}'::jsonb),
            ('collection_location.created', 'p_a1', true, 'a1', '{}'::jsonb),
            ('collection_location.deactivated', 'p_a1', true, 'a1', '{}'::jsonb),
            ('collection_location.deleted', 'p_a1', true, 'a1', '{"label": "סניף מנהל"}'::jsonb),
            ('call_type.deactivated', 'ct2', false, 'a8', '{}'::jsonb),
            ('call_type.activated', 'ct2', false, 'a8', '{}'::jsonb),
            ('call_type.created', 'ct_a2', true, 'a2', '{}'::jsonb) $$,
  'C: exactly one audit row per successful action (none for the refusals); a delete keeps the label and its target_is_test');
select is(
  (select count(*) from public.followup_reasons r where r.id = (select t.id from pg_temp.tm_ids t where t.k = 'r_a1'))
  + (select count(*) from public.collection_locations l where l.id = (select t.id from pg_temp.tm_ids t where t.k = 'p_a1')),
  0::bigint, 'C: the deleted reason and place are gone');

-- =================================================================================================
-- D. Customer Service with `settings` turned on by the Creator: test rows only.
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('customer_service', 'settings', true, 1, null), 2,
  'the Creator turns settings on for Customer Service');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'add_call_type', $q$ insert into pg_temp.tm_ids select 'ct_b1', r.id, r.is_test from public.add_call_type('סוג שירות') r returning is_test $q$),
       (2, 'set_call_type_active', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_b1'), false, 1) $q$),
       (3, 'add_followup_reason', $q$ insert into pg_temp.tm_ids select 'r_b1', r.id, r.is_test from public.add_followup_reason('סיבת שירות') r returning is_test $q$),
       (4, 'set_followup_reason_active off', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_b1'), false, 1) $q$),
       (5, 'set_followup_reason_active on', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_b1'), true, 2) $q$),
       (6, 'delete_followup_reason', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_b1'), 3) $q$),
       (7, 'add_collection_location', $q$ insert into pg_temp.tm_ids select 'p_b1', r.id, r.is_test
             from public.add_collection_location('סניף שירות', 'branch', 'רחוב השירות 3', '050-000-0000', null) r returning is_test $q$),
       (8, 'set_collection_location_active', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_b1'), false, 1) $q$),
       (9, 'delete_collection_location', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_b1'), 2) $q$),
       (10, 'set_followup_reason_active r2', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r2'), false, 1) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('add_call_type', 'ok true'), ('set_call_type_active', 'ok 2'), ('add_followup_reason', 'ok true'),
            ('set_followup_reason_active off', 'ok 2'), ('set_followup_reason_active on', 'ok 3'), ('delete_followup_reason', 'ok'),
            ('add_collection_location', 'ok true'), ('set_collection_location_active', 'ok 2'), ('delete_collection_location', 'ok'),
            ('set_followup_reason_active r2', '42501 not authorized') $$,
  'Customer Service with settings: all eight RPCs work on test rows; a real D48 row is refused (42501)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'a deactivated Customer Service user: all eight refused, although Customer Service holds settings');
reset role;

select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('call_type.created', 'ct_b1', true, 'b1', '{}'::jsonb),
            ('call_type.deactivated', 'ct_b1', true, 'b1', '{}'::jsonb),
            ('followup_reason.created', 'r_b1', true, 'b1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r_b1', true, 'b1', '{}'::jsonb),
            ('followup_reason.activated', 'r_b1', true, 'b1', '{}'::jsonb),
            ('followup_reason.deleted', 'r_b1', true, 'b1', '{"label": "סיבת שירות"}'::jsonb),
            ('collection_location.created', 'p_b1', true, 'b1', '{}'::jsonb),
            ('collection_location.deactivated', 'p_b1', true, 'b1', '{}'::jsonb),
            ('collection_location.deleted', 'p_b1', true, 'b1', '{"label": "סניף שירות"}'::jsonb) $$,
  'D: exactly one audit row per successful Customer Service action');

-- =================================================================================================
-- E. The Creator turns `settings` off again (D51): refused at the next call.
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('manager', 'settings', false, 2, null),
             public.admin_set_role_permission('customer_service', 'settings', false, 2, null)) $$,
  $$ values (3, 3) $$, 'the Creator turns settings off again for Managers and Customer Service');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_matrix() $$,
  $$ values ('add_call_type', '42501 not authorized'), ('set_call_type_active', '42501 not authorized'),
            ('add_followup_reason', '42501 not authorized'), ('set_followup_reason_active', '42501 not authorized'),
            ('delete_followup_reason', '42501 not authorized'), ('add_collection_location', '42501 not authorized'),
            ('set_collection_location_active', '42501 not authorized'), ('delete_collection_location', '42501 not authorized') $$,
  'Manager after the Creator turns settings off: all eight refused at the next call (D51 revocation)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ select r.id from public.add_call_type('סוג אחרי ביטול') r $$), '42501 not authorized',
  'Customer Service after the Creator turns settings off: refused at the next call');
reset role;
select is((select count(*) from pg_temp.tm_audit()), 0::bigint, 'E: no audit row from the refused calls');

-- =================================================================================================
-- F. Versions, no-change calls, missing arguments and tampered ids (the Creator).
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'set_call_type_active, stale', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, 2) $q$),
       (2, 'set_followup_reason_active, stale', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 2) $q$),
       (3, 'set_collection_location_active, stale', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), false, 0) $q$),
       (4, 'delete_followup_reason, stale', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), 2) $q$),
       (5, 'delete_collection_location, stale', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), 99) $q$),
       (6, 'set_call_type_active, stale, no change', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), true, 1) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('set_call_type_active, stale', 'PT409 version conflict'), ('set_followup_reason_active, stale', 'PT409 version conflict'),
            ('set_collection_location_active, stale', 'PT409 version conflict'), ('delete_followup_reason, stale', 'PT409 version conflict'),
            ('delete_collection_location, stale', 'PT409 version conflict'), ('set_call_type_active, stale, no change', 'PT409 version conflict') $$,
  'a stale expected version is a conflict (PT409), also when the requested state equals the current one');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'call type', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), true, 3) $q$),
       (2, 'reason', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), true, 1) $q$),
       (3, 'place', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), true, 1) $q$),
       (4, 'D48 call type', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct1'), true, 1) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('call type', 'ok 3'), ('reason', 'ok 1'), ('place', 'ok 1'), ('D48 call type', 'ok 1') $$,
  'no change: the current version is returned');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'initial reason', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r1'), 1) $q$),
       (2, 'initial reason, stale', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r5'), 9) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('initial reason', '55000 the initial reasons are never deleted; deactivate it instead'),
            ('initial reason, stale', '55000 the initial reasons are never deleted; deactivate it instead') $$,
  'the real Creator cannot delete a D48 reason (SE-07); the rule is checked before the version (deviation B-5)');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'set_call_type_active id', $q$ select public.set_call_type_active(null, true, 1) $q$),
       (2, 'set_call_type_active active', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), null, 3) $q$),
       (3, 'set_call_type_active version', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, null) $q$),
       (4, 'set_followup_reason_active id', $q$ select public.set_followup_reason_active(null, false, 1) $q$),
       (5, 'set_followup_reason_active active', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), null, 1) $q$),
       (6, 'set_followup_reason_active version', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, null) $q$),
       (7, 'delete_followup_reason id', $q$ select public.delete_followup_reason(null, 1) $q$),
       (8, 'delete_followup_reason version', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), null) $q$),
       (9, 'set_collection_location_active id', $q$ select public.set_collection_location_active(null, false, 1) $q$),
       (10, 'set_collection_location_active active', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), null, 1) $q$),
       (11, 'set_collection_location_active version', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), false, null) $q$),
       (12, 'delete_collection_location id', $q$ select public.delete_collection_location(null, 1) $q$),
       (13, 'delete_collection_location version', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), null) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('set_call_type_active id', '22023 invalid input'), ('set_call_type_active active', '22023 invalid input'),
            ('set_call_type_active version', '22023 invalid input'), ('set_followup_reason_active id', '22023 invalid input'),
            ('set_followup_reason_active active', '22023 invalid input'), ('set_followup_reason_active version', '22023 invalid input'),
            ('delete_followup_reason id', '22023 invalid input'), ('delete_followup_reason version', '22023 invalid input'),
            ('set_collection_location_active id', '22023 invalid input'), ('set_collection_location_active active', '22023 invalid input'),
            ('set_collection_location_active version', '22023 invalid input'), ('delete_collection_location id', '22023 invalid input'),
            ('delete_collection_location version', '22023 invalid input') $$,
  'a missing id, state or expected version is invalid input (22023)');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'set_call_type_active: unknown id', $q$ select public.set_call_type_active('00000000-0000-4000-8000-00000000ffff', false, 1) $q$),
       (2, 'set_call_type_active: a reason id', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 1) $q$),
       (3, 'set_call_type_active: a place id', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), false, 1) $q$),
       (4, 'set_followup_reason_active: unknown id', $q$ select public.set_followup_reason_active('00000000-0000-4000-8000-00000000ffff', false, 1) $q$),
       (5, 'set_followup_reason_active: a call type id', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, 1) $q$),
       (6, 'delete_followup_reason: unknown id', $q$ select public.delete_followup_reason('00000000-0000-4000-8000-00000000ffff', 1) $q$),
       (7, 'delete_followup_reason: a place id', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'p_c1'), 1) $q$),
       (8, 'delete_followup_reason: a call type id', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'ct1'), 1) $q$),
       (9, 'set_collection_location_active: unknown id', $q$ select public.set_collection_location_active('00000000-0000-4000-8000-00000000ffff', false, 1) $q$),
       (10, 'set_collection_location_active: a reason id', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 1) $q$),
       (11, 'delete_collection_location: unknown id', $q$ select public.delete_collection_location('00000000-0000-4000-8000-00000000ffff', 1) $q$),
       (12, 'delete_collection_location: a reason id', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'r1'), 1) $q$),
       (13, 'delete_collection_location: a call type id', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), 3) $q$),
       (14, 'delete_collection_location: a deleted place id', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_a1'), 2) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('set_call_type_active: unknown id', '42501 not authorized'), ('set_call_type_active: a reason id', '42501 not authorized'),
            ('set_call_type_active: a place id', '42501 not authorized'), ('set_followup_reason_active: unknown id', '42501 not authorized'),
            ('set_followup_reason_active: a call type id', '42501 not authorized'), ('delete_followup_reason: unknown id', '42501 not authorized'),
            ('delete_followup_reason: a place id', '42501 not authorized'), ('delete_followup_reason: a call type id', '42501 not authorized'),
            ('set_collection_location_active: unknown id', '42501 not authorized'),
            ('set_collection_location_active: a reason id', '42501 not authorized'),
            ('delete_collection_location: unknown id', '42501 not authorized'), ('delete_collection_location: a reason id', '42501 not authorized'),
            ('delete_collection_location: a call type id', '42501 not authorized'),
            ('delete_collection_location: a deleted place id', '42501 not authorized') $$,
  'an unknown id, a deleted row or an id from another table: the same generic 42501, also for the Creator (testing.md cat. 5)');
reset role;
select results_eq(
  $$ select (select count(*) from pg_temp.tm_audit()),
            (select c.version from public.call_types c where c.id = (select t.id from pg_temp.tm_ids t where t.k = 'ct_c1')),
            (select c.version from public.call_types c where c.id = (select t.id from pg_temp.tm_ids t where t.k = 'ct1')),
            (select r.version from public.followup_reasons r where r.id = (select t.id from pg_temp.tm_ids t where t.k = 'r_c1')),
            (select l.version from public.collection_locations l where l.id = (select t.id from pg_temp.tm_ids t where t.k = 'p_c1')),
            (select count(*) from public.followup_reasons), (select count(*) from public.collection_locations) $$,
  $$ values (0::bigint, 3, 1, 1, 1, 6::bigint, 1::bigint) $$,
  'F: conflicts, no-change calls and refusals wrote no audit row and changed no version; nothing was deleted');

-- =================================================================================================
-- G. Input validation and error masking (the Creator). A CHECK, NOT NULL or unique failure inside
--    a SECURITY DEFINER body would carry the failing row or key in its DETAIL; the bodies re-raise
--    without one.
-- =================================================================================================
select pg_temp.tm_mark();
select matches(pg_temp.tm_try($$ insert into public.call_types as c (label_he, sort_order) values ('תיקון', 50) returning c.id $$),
  '^23505 .* \| detail: Key \(label_he\)=\(תיקון\) already exists\.$',
  'control: outside the RPCs, a duplicate shows the key in DETAIL (what the masking hides, plan V11)');
select matches(pg_temp.tm_try($$ insert into public.call_types as c (label_he, sort_order) values (repeat('ס', 61), 50) returning c.id $$),
  '^23514 .* \| detail: Failing row contains \(',
  'control: outside the RPCs, a CHECK failure shows the whole row in DETAIL');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_try($q$ select r.id from public.add_call_type($q$ || quote_nullable(v.label) || $q$) r $q$)
     from (values
       (1, 'null', null::text), (2, 'empty', ''), (3, 'blank', '   '), (4, '61 characters', repeat('ס', 61)),
       (5, 'RLM inside', 'סוג' || chr(8207) || 'בדיקה'), (6, 'LRM at the end', 'סוג בדיקה' || chr(8206)),
       (7, 'double space', 'סוג  כפול'), (8, 'trailing no-break space', 'סוג' || chr(160)),
       (9, 'tab', 'סוג' || chr(9) || 'טאב'), (10, 'zero-width space', 'סוג' || chr(8203) || 'רווח'),
       (11, 'not NFC', 'cafe' || chr(769)), (12, 'duplicate of a D48 label', 'תיקון'),
       (13, 'duplicate after trimming', '  התקנה '), (14, 'duplicate of a test label', 'סוג בדיקה'),
       (15, 'D48 label plus an invisible tag character', 'תיקון' || chr(x'E0001'::int)),
       (16, 'D48 label plus a variation selector', 'התקנה' || chr(x'FE0F'::int)),
       (17, 'test label with a no-break space', 'סוג' || chr(160) || 'בדיקה'),
       (18, 'only a Hangul filler', chr(x'3164'::int))
     ) v (n, k, label) order by v.n $$,
  $$ values ('null', '22023 invalid input'), ('empty', '22023 invalid input'), ('blank', '22023 invalid input'),
            ('61 characters', '22023 invalid input'), ('RLM inside', '22023 invalid input'), ('LRM at the end', '22023 invalid input'),
            ('double space', '22023 invalid input'), ('trailing no-break space', '22023 invalid input'), ('tab', '22023 invalid input'),
            ('zero-width space', '22023 invalid input'), ('not NFC', '22023 invalid input'),
            ('duplicate of a D48 label', '23505 the value is already in use'),
            ('duplicate after trimming', '23505 the value is already in use'),
            ('duplicate of a test label', '23505 the value is already in use'),
            ('D48 label plus an invisible tag character', '22023 invalid input'),
            ('D48 label plus a variation selector', '22023 invalid input'),
            ('test label with a no-break space', '22023 invalid input'), ('only a Hangul filler', '22023 invalid input') $$,
  'add_call_type: invalid labels → 22023 (also an invisible or no-break-space lookalike of an existing label, INT-2), duplicates → 23505, never with a DETAIL or HINT (TEMPORARY OQ-8 text rules)');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'ct_60', r.id, r.is_test from public.add_call_type(repeat('ס', 60)) r returning is_test $$),
  'ok true', 'add_call_type: a 60-character label is accepted');
select results_eq(
  $$ select v.k, pg_temp.tm_try($q$ select r.id from public.add_followup_reason($q$ || quote_nullable(v.label) || $q$) r $q$)
     from (values
       (1, 'null', null::text), (2, 'blank', ' '), (3, '61 characters', repeat('ס', 61)),
       (4, 'RLM inside', 'סיבה' || chr(8207) || 'חדשה'), (5, 'line separator', 'סיבה' || chr(8232) || 'חדשה'),
       (6, 'duplicate of a D48 label', 'לקוח לא נמצא'), (7, 'duplicate of a test label', ' סיבת בדיקה'),
       (8, 'D48 label with a no-break space', 'לקוח' || chr(160) || 'לא נמצא'),
       (9, 'D48 label plus a combining grapheme joiner', 'לקוח לא נמצא' || chr(x'034F'::int))
     ) v (n, k, label) order by v.n $$,
  $$ values ('null', '22023 invalid input'), ('blank', '22023 invalid input'), ('61 characters', '22023 invalid input'),
            ('RLM inside', '22023 invalid input'), ('line separator', '22023 invalid input'),
            ('duplicate of a D48 label', '23505 the value is already in use'),
            ('duplicate of a test label', '23505 the value is already in use'),
            ('D48 label with a no-break space', '22023 invalid input'),
            ('D48 label plus a combining grapheme joiner', '22023 invalid input') $$,
  'add_followup_reason: invalid labels → 22023 (also a lookalike of a D48 label, INT-2), duplicates → 23505, never with a DETAIL or HINT');
select results_eq(
  $$ select v.k, pg_temp.tm_try($q$ select r.id from public.add_collection_location($q$ || quote_nullable(v.a) || ', '
       || quote_nullable(v.b) || ', ' || quote_nullable(v.c) || ', ' || quote_nullable(v.d) || ', ' || quote_nullable(v.e) || $q$) r $q$)
     from (values
       (1, 'unknown place type', 'מחסן חדש', 'warehouse', 'רחוב חדש 1', null::text, null::text),
       (2, 'place type in another case', 'מחסן חדש', 'Branch', 'רחוב חדש 1', null, null),
       (3, 'Hebrew place type label', 'מחסן חדש', 'סניף', 'רחוב חדש 1', null, null),
       (4, 'no place type', 'מחסן חדש', null, 'רחוב חדש 1', null, null),
       (5, 'no name', null, 'branch', 'רחוב חדש 1', null, null),
       (6, 'blank name', '  ', 'branch', 'רחוב חדש 1', null, null),
       (7, 'no address', 'מחסן חדש', 'branch', null, null, null),
       (8, 'blank address', 'מחסן חדש', 'branch', '   ', null, null),
       (9, '61-character name', repeat('מ', 61), 'branch', 'רחוב חדש 1', null, null),
       (10, '121-character address', 'מחסן חדש', 'branch', repeat('ר', 121), null, null),
       (11, '121-character phone', 'מחסן חדש', 'branch', 'רחוב חדש 1', repeat('0', 121), null),
       (12, 'bidi mark in the opening hours', 'מחסן חדש', 'branch', 'רחוב חדש 1', null, 'א-ה' || chr(8206) || ' 08:00'),
       (13, 'control character in the address', 'מחסן חדש', 'branch', 'רחוב' || chr(10) || 'חדש', null, null),
       (14, 'double space in the name', 'מחסן  חדש', 'branch', 'רחוב חדש 1', null, null),
       (15, 'duplicate name', 'מחסן בדיקה', 'branch', 'כתובת אחרת 5', null, null),
       (16, 'duplicate name after trimming', ' מחסן בדיקה  ', 'logistics_center', 'כתובת אחרת 5', null, null),
       (17, 'address of only a no-break space', 'מקום ריק', 'branch', chr(160), null, null),
       (18, 'phone of only an ideographic space', 'מקום ריק', 'branch', 'רחוב חדש 1', chr(12288), null),
       (19, 'opening hours of only a no-break space', 'מקום ריק', 'branch', 'רחוב חדש 1', null, chr(160)),
       (20, 'name of only a braille pattern blank', chr(x'2800'::int), 'branch', 'רחוב חדש 1', null, null)
     ) v (n, k, a, b, c, d, e) order by v.n $$,
  $$ values ('unknown place type', '22023 invalid input'), ('place type in another case', '22023 invalid input'),
            ('Hebrew place type label', '22023 invalid input'), ('no place type', '22023 invalid input'),
            ('no name', '22023 invalid input'), ('blank name', '22023 invalid input'), ('no address', '22023 invalid input'),
            ('blank address', '22023 invalid input'), ('61-character name', '22023 invalid input'),
            ('121-character address', '22023 invalid input'), ('121-character phone', '22023 invalid input'),
            ('bidi mark in the opening hours', '22023 invalid input'), ('control character in the address', '22023 invalid input'),
            ('double space in the name', '22023 invalid input'),
            ('duplicate name', '23505 the value is already in use'), ('duplicate name after trimming', '23505 the value is already in use'),
            ('address of only a no-break space', '22023 invalid input'), ('phone of only an ideographic space', '22023 invalid input'),
            ('opening hours of only a no-break space', '22023 invalid input'), ('name of only a braille pattern blank', '22023 invalid input') $$,
  'add_collection_location: place type outside the closed list (TEMPORARY OQ-6), missing or blank-looking name or address (INT-3), lengths and text rules → 22023; duplicates → 23505; no DETAIL or HINT');
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'p_2', r.id, r.is_test
     from public.add_collection_location('סניף שני', 'branch', '  רחוב שני 2  ', '', '  ') r returning is_test $$),
  'ok true', 'add_collection_location: a valid place with empty optional fields is accepted');
reset role;
select results_eq(
  $$ select l.address, l.phone, l.opening_hours from public.collection_locations l
     where l.id = (select t.id from pg_temp.tm_ids t where t.k = 'p_2') $$,
  $$ values ('רחוב שני 2', null::text, null::text) $$,
  'the address is stored trimmed; empty optional fields are stored as NULL');
select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('call_type.created', 'ct_60', true, 'c1', '{}'::jsonb),
            ('collection_location.created', 'p_2', true, 'c1', '{}'::jsonb) $$,
  'G: only the two accepted adds wrote audit rows; every refused add wrote nothing');

-- =================================================================================================
-- H. The order: every add appends (max + 1); there is no reorder command.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_try($$ insert into pg_temp.tm_ids select 'r_new', r.id, r.is_test from public.add_followup_reason('סיבה חדשה') r returning is_test $$),
  'ok true', 'the Creator adds another reason');
reset role;
select results_eq(
  $$ select coalesce(t.k, '?'), c.sort_order from public.call_types c left join pg_temp.tm_ids t on t.id = c.id order by c.sort_order $$,
  $$ values ('ct1', 1), ('ct2', 2), ('ct_c1', 3), ('ct_a1', 4), ('ct_a2', 5), ('ct_b1', 6), ('ct_60', 7) $$,
  'call types are ordered as added, after the D48 rows');
select results_eq(
  $$ select coalesce(t.k, '?'), r.sort_order from public.followup_reasons r left join pg_temp.tm_ids t on t.id = r.id order by r.sort_order $$,
  $$ values ('r1', 1), ('r2', 2), ('r3', 3), ('r4', 4), ('r5', 5), ('r_c1', 6), ('r_new', 7) $$,
  'reasons: an add takes the highest remaining position + 1 (deleted user-added reasons leave no row)');
select results_eq(
  $$ select coalesce(t.k, '?'), l.sort_order from public.collection_locations l left join pg_temp.tm_ids t on t.id = l.id order by l.sort_order $$,
  $$ values ('p_c1', 1), ('p_2', 2) $$,
  'places: an add takes the highest remaining position + 1');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.prosrc ~* 'update\s+(only\s+)?(public\.)?(call_types|followup_reasons|collection_locations)\M[^;]*\mset\M[^;]*\m(label_he|name|sort_order|place_type|address|phone|opening_hours)\s*=' $$,
  'no function renames, reorders or edits a Settings row: the RPCs change is_active only (TEMPORARY OQ-5; no reorder command)');

-- =================================================================================================
-- I. At least one continuation reason stays active (DEMO l.1158; DEV-11), counting test and real
--    rows (the Technician close screen shows every active row).
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select t.k, pg_temp.tm_try($q$ select public.set_followup_reason_active('$q$ || t.id || $q$', false, 1) $q$)
     from pg_temp.tm_ids t where t.k in ('r1', 'r2', 'r3', 'r4', 'r5', 'r_new') order by t.k collate "C" $$,
  $$ values ('r1', 'ok 2'), ('r2', 'ok 2'), ('r3', 'ok 2'), ('r4', 'ok 2'), ('r5', 'ok 2'), ('r_new', 'ok 2') $$,
  'the real Creator deactivates the five D48 reasons and a test reason');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'deactivate the last active (a test row)', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 1) $q$),
       (2, 'delete the last active (a test row)', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), 1) $q$),
       (3, 'activate the last active again (no change)', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), true, 1) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('deactivate the last active (a test row)', '55000 at least one continuation reason must stay active'),
            ('delete the last active (a test row)', '55000 at least one continuation reason must stay active'),
            ('activate the last active again (no change)', 'ok 1') $$,
  'the last active reason can be neither deactivated nor deleted, also when only a test row remains active');
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'reactivate r1', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r1'), true, 2) $q$),
       (2, 'deactivate r_c1', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), false, 1) $q$),
       (3, 'deactivate r1, now the last active', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r1'), false, 3) $q$),
       (4, 'delete the inactive r_c1', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_c1'), 2) $q$),
       (5, 'delete the inactive r_new', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_new'), 2) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('reactivate r1', 'ok 3'), ('deactivate r_c1', 'ok 2'),
            ('deactivate r1, now the last active', '55000 at least one continuation reason must stay active'),
            ('delete the inactive r_c1', 'ok'), ('delete the inactive r_new', 'ok') $$,
  'with a real reason as the only active one, it stays active; inactive user-added reasons can still be deleted');
reset role;
select results_eq(
  $$ select t.k from public.followup_reasons r join pg_temp.tm_ids t on t.id = r.id where r.is_active $$,
  $$ values ('r1') $$, 'exactly one reason is active');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select t.k, pg_temp.tm_try($q$ select public.set_followup_reason_active('$q$ || t.id || $q$', true, 2) $q$)
     from pg_temp.tm_ids t where t.k in ('r2', 'r3', 'r4', 'r5') order by t.k collate "C" $$,
  $$ values ('r2', 'ok 3'), ('r3', 'ok 3'), ('r4', 'ok 3'), ('r5', 'ok 3') $$,
  'the real Creator reactivates the other D48 reasons');
reset role;
select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('followup_reason.deactivated', 'r1', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r2', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r3', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r4', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r5', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r_new', true, 'c1', '{}'::jsonb),
            ('followup_reason.activated', 'r1', false, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r_c1', true, 'c1', '{}'::jsonb),
            ('followup_reason.deleted', 'r_c1', true, 'c1', '{"label": "סיבת בדיקה"}'::jsonb),
            ('followup_reason.deleted', 'r_new', true, 'c1', '{"label": "סיבה חדשה"}'::jsonb),
            ('followup_reason.activated', 'r2', false, 'c1', '{}'::jsonb),
            ('followup_reason.activated', 'r3', false, 'c1', '{}'::jsonb),
            ('followup_reason.activated', 'r4', false, 'c1', '{}'::jsonb),
            ('followup_reason.activated', 'r5', false, 'c1', '{}'::jsonb) $$,
  'I: an audit row for each change of a real (target_is_test false) or test reason, none for the refusals');

-- =================================================================================================
-- J. Conditional deletes: a row in use (simulated PR 1.5 foreign key) and a delete that removes
--    no row (simulated by a trigger that skips it) fail without an audit row.
-- =================================================================================================
create schema pr14_scratch;
create table pr14_scratch.visits (
  id uuid primary key default gen_random_uuid(),
  followup_reason_id uuid references public.followup_reasons (id) on delete restrict,
  pickup_location_id uuid references public.collection_locations (id) on delete restrict);
create function pg_temp.tm_skip_delete()
returns trigger
language plpgsql
as $f$ begin return null; end $f$;

select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'reason in use', $q$ insert into pg_temp.tm_ids select 'r_used', r.id, r.is_test from public.add_followup_reason('סיבה בשימוש') r returning is_test $q$),
       (2, 'place in use', $q$ insert into pg_temp.tm_ids select 'p_used', r.id, r.is_test
             from public.add_collection_location('מקום בשימוש', 'branch', 'רחוב השימוש 4', null, null) r returning is_test $q$),
       (3, 'reason to skip', $q$ insert into pg_temp.tm_ids select 'r_skip', r.id, r.is_test from public.add_followup_reason('סיבה לדילוג') r returning is_test $q$),
       (4, 'place to skip', $q$ insert into pg_temp.tm_ids select 'p_skip', r.id, r.is_test
             from public.add_collection_location('מקום לדילוג', 'logistics_center', 'רחוב הדילוג 5', null, null) r returning is_test $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('reason in use', 'ok true'), ('place in use', 'ok true'), ('reason to skip', 'ok true'), ('place to skip', 'ok true') $$,
  'the Creator adds a reason and a place that will be in use, and a reason and a place whose delete will be skipped');
reset role;
insert into pr14_scratch.visits (followup_reason_id, pickup_location_id)
select (select t.id from pg_temp.tm_ids t where t.k = 'r_used'), (select t.id from pg_temp.tm_ids t where t.k = 'p_used');
create trigger t96_tm_skip before delete on public.followup_reasons
  for each row when (old.label_he = 'סיבה לדילוג') execute function pg_temp.tm_skip_delete();
create trigger t96_tm_skip before delete on public.collection_locations
  for each row when (old.name = 'מקום לדילוג') execute function pg_temp.tm_skip_delete();

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'delete a reason in use', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_used'), 1) $q$),
       (2, 'delete a place in use', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_used'), 1) $q$),
       (3, 'deactivate the reason in use', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r_used'), false, 1) $q$),
       (4, 'deactivate the place in use', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_used'), false, 1) $q$),
       (5, 'a reason delete that removes no row', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r_skip'), 1) $q$),
       (6, 'a place delete that removes no row', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p_skip'), 1) $q$),
       (7, 'reactivate the place in use', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p_used'), true, 2) $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('delete a reason in use', '55000 in use; deactivate it instead'),
            ('delete a place in use', '55000 in use; deactivate it instead'),
            ('deactivate the reason in use', 'ok 2'), ('deactivate the place in use', 'ok 2'),
            ('a reason delete that removes no row', '55000 the reason was not deleted'),
            ('a place delete that removes no row', '55000 the place was not deleted'),
            ('reactivate the place in use', 'ok 3') $$,
  'a referenced reason or place is not deleted (55000, deactivate it instead, SE-06/SE-07); a delete that removes no row fails instead of passing silently');
reset role;
drop trigger t96_tm_skip on public.followup_reasons;
drop trigger t96_tm_skip on public.collection_locations;
select is(
  (select count(*) from public.followup_reasons r join pg_temp.tm_ids t on t.id = r.id where t.k in ('r_used', 'r_skip'))
  + (select count(*) from public.collection_locations l join pg_temp.tm_ids t on t.id = l.id where t.k in ('p_used', 'p_skip')),
  4::bigint, 'J: the four rows still exist');
select results_eq(
  $$ select * from pg_temp.tm_audit() $$,
  $$ values ('followup_reason.created', 'r_used', true, 'c1', '{}'::jsonb),
            ('collection_location.created', 'p_used', true, 'c1', '{}'::jsonb),
            ('followup_reason.created', 'r_skip', true, 'c1', '{}'::jsonb),
            ('collection_location.created', 'p_skip', true, 'c1', '{}'::jsonb),
            ('followup_reason.deactivated', 'r_used', true, 'c1', '{}'::jsonb),
            ('collection_location.deactivated', 'p_used', true, 'c1', '{}'::jsonb),
            ('collection_location.activated', 'p_used', true, 'c1', '{}'::jsonb) $$,
  'J: no "deleted" audit row is left by a delete that failed (the audit row written before the delete rolls back with it)');

-- =================================================================================================
-- K. At most 100 rows per list, active and inactive (TEMPORARY, OQ-8).
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('tm_test.cap_start',
  ((select count(*) from public.call_types) + (select count(*) from public.followup_reasons)
   + (select count(*) from public.collection_locations))::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
do $fill$
declare
  i integer := 0;
begin
  while (select count(*) from public.call_types) < 99 loop
    i := i + 1;
    perform 1 from public.add_call_type('סוג מילוי ' || i);
  end loop;
  i := 0;
  while (select count(*) from public.followup_reasons) < 99 loop
    i := i + 1;
    perform 1 from public.add_followup_reason('סיבת מילוי ' || i);
  end loop;
  i := 0;
  while (select count(*) from public.collection_locations) < 99 loop
    i := i + 1;
    perform 1 from public.add_collection_location('מקום מילוי ' || i, 'branch', 'רחוב המילוי ' || i, null, null);
  end loop;
end
$fill$;
select results_eq(
  $$ select v.k, pg_temp.tm_try(v.q) from (values
       (1, 'call type 100', $q$ select r.is_test from public.add_call_type('סוג מאה') r $q$),
       (2, 'call type 101', $q$ select r.is_test from public.add_call_type('סוג מאה ואחד') r $q$),
       (3, 'reason 100', $q$ select r.is_test from public.add_followup_reason('סיבה מאה') r $q$),
       (4, 'reason 101', $q$ select r.is_test from public.add_followup_reason('סיבה מאה ואחת') r $q$),
       (5, 'place 100', $q$ select r.is_test from public.add_collection_location('מקום מאה', 'branch', 'רחוב מאה', null, null) r $q$),
       (6, 'place 101', $q$ select r.is_test from public.add_collection_location('מקום מאה ואחד', 'branch', 'רחוב מאה ואחד', null, null) r $q$)
     ) v (n, k, q) order by v.n $$,
  $$ values ('call type 100', 'ok true'), ('call type 101', '55000 the list is full'),
            ('reason 100', 'ok true'), ('reason 101', '55000 the list is full'),
            ('place 100', 'ok true'), ('place 101', '55000 the list is full') $$,
  'the 100th row of each list is accepted, the 101st is refused (55000)');
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct_c1'), false, 3) $q$),
             pg_temp.tm_try($q$ select r.is_test from public.add_call_type('סוג אחרי השבתה') r $q$)) $$,
  $$ values ('ok 4', '55000 the list is full') $$,
  'inactive rows count towards the cap');
reset role;
select results_eq(
  $$ select (select count(*) from public.call_types), (select count(*) from public.followup_reasons),
            (select count(*) from public.collection_locations) $$,
  $$ values (100::bigint, 100::bigint, 100::bigint) $$,
  'K: each list holds exactly 100 rows');
select is(
  (select count(*) from pg_temp.tm_audit() a where a.action like '%.created'),
  300 - current_setting('tm_test.cap_start')::bigint,
  'K: one created audit row per accepted add, none for the refused ones');

-- =================================================================================================
-- L. The audit chain still verifies after every Settings action.
-- =================================================================================================
select is(private.audit_chain_verify(), null::bigint, 'the audit chain verifies');

select * from finish();
rollback;
