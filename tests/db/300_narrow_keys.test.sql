-- PR 1.8: the narrow matrix keys (D60 (8), M-07) and `usage` (D60 (9), C-03; docs/review/step1-pr18
-- sections 4 and 13; docs/testing.md category 4). Every call runs as `authenticated` with the
-- caller's JWT claims, as PostgREST does.
--   - callTypes gates the two call-type RPCs, reasons the three continuation-reason RPCs, settings
--     only the three pickup-place RPCs: each key opens exactly its own RPCs, `settings` alone no
--     longer opens call types or reasons, and the narrow keys never open pickup places;
--   - defaults (TEMPORARY, D51; OQ-6): the Manager has reasons and callTypes (and ackText) and not
--     settings; Customer Service has none; the Creator has every key; a Technician, a deactivated,
--     deleted or unknown user none; a change takes effect at the next call (revocation);
--   - only the Creator changes a narrow-key value, audited;
--   - ackText has no table or function yet (OQ-7);
--   - usage is the Creator's alone: has_permission grants it to no other role, the matrix can never
--     grant it (the Creator's function and the CHECK), and has_permission would refuse it to a
--     matrix role even if a later change relaxed the CHECK (D60 (9), fixed capability).
-- Every probe runs in a subtransaction that is rolled back, so each case starts from the same rows
-- and versions and leaves no row or audit row; the effects of a successful call are in 120.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Fixtures (local, rolled back): see 020_markers.test.sql. a9 is deactivated, a7 deleted below,
-- a8 real-marked, f1 an Auth user without a profile.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a7', 'a8', 'a9', 'b1', 'd1', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a7', 'manager', 'מנהל שנמחק', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000a8', 'manager', 'מנהל אמיתי', true, false);

-- Helpers (pg_temp, rolled back).
create temporary table tm_ids (k text primary key, id uuid not null) on commit drop;
grant select, insert on pg_temp.tm_ids to authenticated;
-- The outcome of one statement, always rolled back: 'ok', or the SQLSTATE and message.
create function pg_temp.tm_probe(p_sql text)
returns text
language plpgsql
as $f$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'P0001', message = 'tm_probe_ok';
  exception when others then
    if sqlerrm = 'tm_probe_ok' then
      return 'ok';
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end
$f$;
-- One call of each of the eight Settings RPCs against test rows the Creator creates below.
create function pg_temp.tm_keys()
returns table (rpc text, outcome text)
language sql
as $f$
  select v.rpc, pg_temp.tm_probe(v.q)
  from (values
    (1, 'add_call_type', $q$ select r.id from public.add_call_type('סוג מבדיקת מפתחות') r $q$),
    (2, 'set_call_type_active', $q$ select public.set_call_type_active((select t.id from pg_temp.tm_ids t where t.k = 'ct'), false, 1) $q$),
    (3, 'add_followup_reason', $q$ select r.id from public.add_followup_reason('סיבה מבדיקת מפתחות') r $q$),
    (4, 'set_followup_reason_active', $q$ select public.set_followup_reason_active((select t.id from pg_temp.tm_ids t where t.k = 'r'), false, 1) $q$),
    (5, 'delete_followup_reason', $q$ select public.delete_followup_reason((select t.id from pg_temp.tm_ids t where t.k = 'r'), 1) $q$),
    (6, 'add_collection_location', $q$ select r.id from public.add_collection_location('מקום מבדיקת מפתחות', 'branch', 'רחוב המפתחות 1', null, null) r $q$),
    (7, 'set_collection_location_active', $q$ select public.set_collection_location_active((select t.id from pg_temp.tm_ids t where t.k = 'p'), false, 1) $q$),
    (8, 'delete_collection_location', $q$ select public.delete_collection_location((select t.id from pg_temp.tm_ids t where t.k = 'p'), 1) $q$)
  ) v (n, rpc, q)
  order by v.n
$f$;
-- The expected outcomes for a caller who holds the given keys.
create function pg_temp.tm_expect(p_call_types boolean, p_reasons boolean, p_settings boolean)
returns table (rpc text, outcome text)
language sql
as $f$
  select v.rpc, case when v.open then 'ok' else '42501 not authorized' end
  from (values
    (1, 'add_call_type', p_call_types), (2, 'set_call_type_active', p_call_types),
    (3, 'add_followup_reason', p_reasons), (4, 'set_followup_reason_active', p_reasons), (5, 'delete_followup_reason', p_reasons),
    (6, 'add_collection_location', p_settings), (7, 'set_collection_location_active', p_settings),
    (8, 'delete_collection_location', p_settings)
  ) v (n, rpc, open)
  order by v.n
$f$;
grant execute on function pg_temp.tm_probe(text), pg_temp.tm_keys(), pg_temp.tm_expect(boolean, boolean, boolean) to authenticated;

-- The Creator creates the test rows the probes act on, and deletes a7.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_ids select 'ct', r.id from public.add_call_type('סוג לבדיקת מפתחות') r;
insert into pg_temp.tm_ids select 'r', r.id from public.add_followup_reason('סיבה לבדיקת מפתחות') r;
insert into pg_temp.tm_ids select 'p', r.id from public.add_collection_location('מקום לבדיקת מפתחות', 'branch', 'רחוב 1', null, null) r;
select public.admin_delete_user('00000000-0000-4000-8000-0000000000a7', 1, null);
reset role;
create temporary table counts_before on commit drop as
  select (select count(*) from public.call_types) + (select count(*) from public.followup_reasons)
         + (select count(*) from public.collection_locations) as rows_before,
         (select sum(c.version) from public.call_types c) + (select sum(r.version) from public.followup_reasons r)
         + (select sum(l.version) from public.collection_locations l) as versions_before,
         (select count(*) from public.audit_logs) as audit_before;

-- =================================================================================================
-- A. Each key opens exactly its own RPCs.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(true, true, true) $$,
  'the Creator: all eight (he has every key)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(true, true, false) $$,
  'M-07: a Manager with the default keys (reasons and callTypes on, settings off) manages call types and continuation reasons, never pickup places');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(true, true, false) $$,
  'a real-marked Manager: the same keys, on test rows');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, false) $$,
  'Customer Service with the default keys (all off): none of the eight');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, false) $$,
  'a Technician: none (fixed capabilities; he only selects active reasons in his visit)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, false) $$,
  'a deactivated Manager: none, although Managers hold reasons and callTypes');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, false) $$,
  'a deleted Manager: none');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, false) $$,
  'a signed-in user without a profile, with forged Creator claims: none');
reset role;

-- =================================================================================================
-- B. The Creator changes one key at a time; each change takes effect at the next call.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'callTypes', false, 1, 'בדיקת מפתח צר'), 2,
  'the Creator turns callTypes off for Managers');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, true, false) $$,
  'without callTypes the Manager keeps continuation reasons and loses call types at the next call');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('manager', 'callTypes', true, 2, null),
             public.admin_set_role_permission('manager', 'reasons', false, 1, null)) $$,
  $$ values (3, 2) $$, 'the Creator turns callTypes on again and reasons off');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(true, false, false) $$,
  'without reasons the Manager keeps call types and loses continuation reasons');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('manager', 'callTypes', false, 3, null),
             public.admin_set_role_permission('manager', 'settings', true, 1, null)) $$,
  $$ values (4, 2) $$, 'the Creator leaves the Manager settings only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, false, true) $$,
  'D60 (8): settings alone no longer opens call types or continuation reasons; it opens pickup places only');
select is(pg_temp.tm_probe($q$ select r.created_id from private.add_call_type('סוג ישיר') r $q$), '42501 not authorized',
  'with settings alone the private call-type body refuses too (each body checks its own key)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('customer_service', 'reasons', true, 1, null)) $$,
  $$ values (2) $$, 'the Creator gives Customer Service reasons (an editable TEMPORARY value, D51)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_keys() $$, $$ select * from pg_temp.tm_expect(false, true, false) $$,
  'Customer Service with reasons only: continuation reasons only');
reset role;

select ok(
  (select rows_before = (select count(*) from public.call_types) + (select count(*) from public.followup_reasons)
                        + (select count(*) from public.collection_locations)
          and versions_before = (select sum(c.version) from public.call_types c) + (select sum(r.version) from public.followup_reasons r)
                                + (select sum(l.version) from public.collection_locations l)
          and audit_before + 6 = (select count(*) from public.audit_logs)
   from counts_before),
  'the probes left no Settings row, version or audit row (only the six matrix changes were written)');
select results_eq(
  $$ select a.details ->> 'role', a.details ->> 'key', (a.details ->> 'from')::boolean, (a.details ->> 'to')::boolean,
            right(a.actor_profile_id::text, 2)
     from public.audit_logs a where a.action = 'matrix.value_set' order by a.id $$,
  $$ values ('manager', 'callTypes', true, false, 'c1'), ('manager', 'callTypes', false, true, 'c1'),
            ('manager', 'reasons', true, false, 'c1'), ('manager', 'callTypes', true, false, 'c1'),
            ('manager', 'settings', false, true, 'c1'), ('customer_service', 'reasons', false, true, 'c1') $$,
  'every narrow-key change is audited with the Creator as actor (D33)');

-- =================================================================================================
-- C. Only the Creator changes a narrow-key value; ackText has no use yet.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_role_permission('manager', 'callTypes', true, 4, null) $$,
  '42501', 'not authorized', 'a Manager cannot give himself a narrow key');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'callTypes', true, 1, null) $$,
  '42501', 'not authorized', 'Customer Service cannot give itself a narrow key');
reset role;
select results_eq(
  $$ select rp.role, rp.allowed, rp.value_status from public.role_permissions rp where rp.permission_key = 'ackText' order by rp.role $$,
  $$ values ('customer_service', false, 'temporary'), ('manager', true, 'temporary') $$,
  'ackText: Manager on, Customer Service off (TEMPORARY, D51)');
select is(
  (select count(*) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.prosrc like '%ackText%'),
  0::bigint, 'OQ-7: no function checks ackText yet (the approval-text versions and their writer come in Step 4, D43)');

-- =================================================================================================
-- D. usage: the Creator's alone (D60 (9)).
-- =================================================================================================
create function pg_temp.tm_usage()
returns text
language sql
as $f$ select public.has_permission('usage')::text $f$;
grant execute on function pg_temp.tm_usage() to authenticated;
create temporary table tm_usage_seen (caller text primary key, usage text) on commit drop;
grant insert on pg_temp.tm_usage_seen to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('creator', pg_temp.tm_usage());
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('manager', pg_temp.tm_usage());
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('customer service', pg_temp.tm_usage());
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('technician', pg_temp.tm_usage());
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('deleted manager', pg_temp.tm_usage());
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.tm_usage_seen values ('no profile', pg_temp.tm_usage());
reset role;
select results_eq($$ select caller, usage from pg_temp.tm_usage_seen order by caller collate "C" $$,
  $$ values ('creator', 'true'), ('customer service', 'false'), ('deleted manager', 'false'), ('manager', 'false'),
            ('no profile', 'false'), ('technician', 'false') $$,
  'C-03: usage is the Creator''s alone (PR 1.8: it was denied to him too until d13)');
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.has_permission('usage') $$, '42501', null, 'anon cannot even ask');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (pg_temp.tm_probe($q$ select public.admin_set_role_permission('manager', 'usage', true, 1, null) $q$),
             pg_temp.tm_probe($q$ select public.admin_set_role_permission('customer_service', 'usage', true, 1, null) $q$)) $$,
  $$ values ('55000 value locked until an open owner decision', '55000 value locked until an open owner decision') $$,
  'the matrix never grants usage, not even by the Creator (the Migration 1 refusal, now for good: DEV-5)');
reset role;

-- Defence in depth: a later change that relaxed the CHECK by mistake (simulated inside this
-- rolled-back transaction) still gives a matrix role no usage, because has_permission refuses it.
alter table public.role_permissions drop constraint role_permissions_pending_decisions;
update public.role_permissions set allowed = true where permission_key = 'usage';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('usage'), false, 'D60 (9): with a usage value set to true, the Manager still has no usage');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('usage'), false, 'D60 (9): and neither has Customer Service');
reset role;

select * from finish();
rollback;
