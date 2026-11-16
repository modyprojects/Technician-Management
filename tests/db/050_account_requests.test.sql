-- PR 1.3 tested here the D34 (a) request path: Manager-initiated Customer Service requests and the
-- Creator's decisions (98 assertions, docs/review/step1-pr13). PR 1.8 (Migration 5): D60 (7)
-- supersedes D34 (a) and C-02 retires that path (docs/review/step1-pr18/README.md section 7), so this
-- file now proves the retirement for every caller and what the history keeps (docs/security.md §5,
-- docs/testing.md categories 2 and 4; TEMPORARY PR 1.8 OQ-4):
--   - request_account_change and decide_account_request (wrappers and bodies) run for nobody, the
--     Creator included, and a refused call changes nothing and writes no audit row;
--   - their bodies are Migration 1's text, unchanged (the rollback only grants them again);
--   - no new request row can be stored, even by the owner's role (t05_requests_retired); a
--     creation intent (direct_create) still can;
--   - the history stays readable under the PR 1.3 policies (the Creator every row, a Manager his
--     own) and nobody else reads it;
--   - a pending request never takes effect; cancel_account_request is unchanged (a requester
--     cancels his own pending request, the Creator an approved, unfulfilled creation, nobody a
--     decided one), audited;
--   - an approved Customer Service 'create' request is no longer bound by admin_create_profile;
--   - an open legacy creation request still holds its email until it is cancelled, and a
--     Manager's direct Customer Service intent then works (D60 (7)).
-- The request rows below stand for history written before Migration 5: they are inserted as
-- postgres with t05_requests_retired disabled only around that insert (inside the rolled-back
-- transaction). Every call runs as `authenticated` with the caller's JWT claims, as PostgREST does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Fixtures (local, rolled back): see 020_markers.test.sql. a9 is a deactivated Manager; a8, b8 and
-- d8 are real-marked; f1 is an Auth user without a profile; f2 the Auth user of a legacy creation.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a8', 'a9', 'b1', 'b2', 'b8', 'd1', 'd8', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000a8', 'manager', 'מנהל אמיתי', true, false),
  ('00000000-0000-4000-8000-0000000000b8', 'customer_service', 'נציגה אמיתית', true, false),
  ('00000000-0000-4000-8000-0000000000d8', 'technician', 'טכנאי אמיתי', true, false);

-- History written before Migration 5 (as Migration 1's functions wrote it): a1's pending
-- reactivation of b2 (r1) and pending Customer Service creation (r2); a2's creation request that
-- the Creator approved and nobody fulfilled (r3); a1's role change that the Creator rejected (r4).
alter table public.account_requests disable trigger t05_requests_retired;
insert into public.account_requests (id, request_type, target_profile_id, target_version, requested_role, email, full_name,
                                     requested_by, status, decided_by, decided_at, rejection_reason, is_test) values
  ('00000000-0000-4000-8000-000000005001', 'reactivate', '00000000-0000-4000-8000-0000000000b2', 1, null, null, null,
   '00000000-0000-4000-8000-0000000000a1', 'pending', null, null, null, true),
  ('00000000-0000-4000-8000-000000005002', 'create', null, null, 'customer_service', 'legacy.agent@example.test', 'נציגה ותיקה',
   '00000000-0000-4000-8000-0000000000a1', 'pending', null, null, null, true),
  ('00000000-0000-4000-8000-000000005003', 'create', null, null, 'customer_service', 'legacy.approved@example.test', 'נציגה מאושרת',
   '00000000-0000-4000-8000-0000000000a2', 'approved', '00000000-0000-4000-8000-0000000000c1', now() - interval '1 day', null, true),
  ('00000000-0000-4000-8000-000000005004', 'role_change', '00000000-0000-4000-8000-0000000000b1', 1, 'technician', null, null,
   '00000000-0000-4000-8000-0000000000a1', 'rejected', '00000000-0000-4000-8000-0000000000c1', now() - interval '1 day',
   'בקשה ישנה שנדחתה', true);
alter table public.account_requests enable trigger t05_requests_retired;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'legacy.approved@example.test', '{"provider": "email", "account_request_id": "00000000-0000-4000-8000-000000005003"}',
   now(), now());

-- Outcome of one statement ('ok' plus its first value, or the SQLSTATE and message), as in 120.
create function pg_temp.tm_try(p_sql text)
returns text
language plpgsql
as $f$
declare
  v_out text;
begin
  execute p_sql into v_out;
  return 'ok' || coalesce(' ' || nullif(v_out, ''), '');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;

-- The four retired entry points, each called with arguments that Migration 1 would have accepted.
create function pg_temp.tm_retired()
returns table (call text, outcome text)
language sql
as $f$
  select v.call, pg_temp.tm_try(v.q)
  from (values
    (1, 'public request', $q$ select public.request_account_change('create', null, 'customer_service', 'retired@example.test', 'x') $q$),
    (2, 'private request', $q$ select private.request_account_change('activate', '00000000-0000-4000-8000-0000000000b2', null, null, null) $q$),
    (3, 'public decision', $q$ select public.decide_account_request('00000000-0000-4000-8000-000000005001', 'approve', 1, null) $q$),
    (4, 'private decision', $q$ select private.decide_account_request('00000000-0000-4000-8000-000000005001', 'reject', 1, 'x') $q$)
  ) v (n, call, q)
  order by v.n
$f$;
create function pg_temp.tm_denied_for_authenticated()
returns table (call text, outcome text)
language sql
as $f$
  values ('public request', '42501 permission denied for function request_account_change'),
         ('private request', '42501 permission denied for function request_account_change'),
         ('public decision', '42501 permission denied for function decide_account_request'),
         ('private decision', '42501 permission denied for function decide_account_request')
$f$;
grant execute on function pg_temp.tm_try(text), pg_temp.tm_retired(), pg_temp.tm_denied_for_authenticated()
  to anon, authenticated, service_role;

create temporary table counts_before on commit drop as
  select (select count(*) from public.account_requests) as requests,
         (select sum(r.version) from public.account_requests r) as versions,
         (select count(*) from public.audit_logs) as audit_rows,
         (select count(*) from public.profiles where is_active) as active_profiles;

-- A. The retired path runs for nobody (C-02) ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'the Creator: no request and no decision, through the wrappers or the private bodies (C-02)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'a test Manager: no request and no decision (D60 (7): he acts directly instead)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'a real-marked Manager: no request and no decision');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'Customer Service: no request and no decision');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'a Technician: no request and no decision');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'a deactivated Manager: no request and no decision');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_retired() $$, $$ select * from pg_temp.tm_denied_for_authenticated() $$,
  'a signed-in user without a profile, with forged Creator claims: no request and no decision');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select results_eq($$ select * from pg_temp.tm_retired() $$,
  $$ values ('public request', '42501 permission denied for function request_account_change'),
            ('private request', '42501 permission denied for schema private'),
            ('public decision', '42501 permission denied for function decide_account_request'),
            ('private decision', '42501 permission denied for schema private') $$,
  'anon: no request and no decision');
reset role;
set local role service_role;
select results_eq($$ select * from pg_temp.tm_retired() $$,
  $$ values ('public request', '42501 permission denied for function request_account_change'),
            ('private request', '42501 permission denied for schema private'),
            ('public decision', '42501 permission denied for function decide_account_request'),
            ('private decision', '42501 permission denied for schema private') $$,
  'service_role: no request and no decision (it bypasses RLS, not grants)');
reset role;

select ok(
  (select requests = (select count(*) from public.account_requests)
          and versions = (select sum(r.version) from public.account_requests r)
          and audit_rows = (select count(*) from public.audit_logs)
          and active_profiles = (select count(*) from public.profiles where is_active)
   from counts_before)
  and (select status = 'pending' and version = 1 from public.account_requests where id = '00000000-0000-4000-8000-000000005001')
  and (select not is_active and version = 1 from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'),
  'the refused calls changed nothing: no request row, no decision, no audit row; the pending reactivation never took effect');

select results_eq(
  $$ select p.oid::regprocedure::text collate "default", md5(p.prosrc) collate "default" from pg_proc p
     where p.proname in ('request_account_change', 'decide_account_request') order by p.oid::regprocedure::text collate "C" $$,
  $$ values ('decide_account_request(uuid,text,integer,text)', '29a0f950eb90e8e5aba2476dcb626303'),
            ('private.decide_account_request(uuid,text,integer,text)', 'd4a6a566c25b2896b6fd6fe256e053fe'),
            ('private.request_account_change(text,uuid,text,text,text)', '1c9dadb9f8991aabd5ceb4453a33769c'),
            ('request_account_change(text,uuid,text,text,text)', '02bc4bc9a488886d9cfec844ef6466a2') $$,
  'the four retired functions keep Migration 1''s text (only their grants were revoked; the rollback grants them again)');

-- B. No new request row, even as postgres (t05_requests_retired) ----------------------------------------
select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
     values ('create', 'customer_service', 'new.request@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', true) $$,
  '55000', 'account_requests: account requests are retired (D60 (7))', 'a creation request is refused, even as postgres');
select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
     values ('activate', '00000000-0000-4000-8000-0000000000b1', 1, '00000000-0000-4000-8000-0000000000a2', true) $$,
  '55000', 'account_requests: account requests are retired (D60 (7))', 'an activation request is refused, even as postgres');
select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
     values ('reactivate', '00000000-0000-4000-8000-0000000000d1', 1, '00000000-0000-4000-8000-0000000000a2', true) $$,
  '55000', 'account_requests: account requests are retired (D60 (7))', 'a reactivation request is refused, even as postgres');
select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_role, requested_by, is_test)
     values ('role_change', '00000000-0000-4000-8000-0000000000d1', 1, 'customer_service', '00000000-0000-4000-8000-0000000000a2', true) $$,
  '55000', 'account_requests: account requests are retired (D60 (7))', 'a role-change request is refused, even as postgres');

-- C. The history stays readable under the PR 1.3 policies -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select right(id::text, 4), status from public.account_requests order by id $$,
  $$ values ('5001', 'pending'), ('5002', 'pending'), ('5003', 'approved'), ('5004', 'rejected') $$,
  'the Creator reads every history row');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select right(id::text, 4) from public.account_requests order by id $$,
  $$ values ('5001'), ('5002'), ('5004') $$, 'a Manager reads his own history rows only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select right(id::text, 4) from public.account_requests order by id $$,
  $$ values ('5003') $$, 'another Manager reads his own row only');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 0::bigint, 'a deactivated Manager reads no history row');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 0::bigint,
  'Customer Service reads no history row (also not the rejected role change of his own account)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 0::bigint, 'a Technician reads no history row');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.account_requests $$, '42501', null, 'anon cannot read account_requests');
reset role;

-- D. An approved legacy creation is no longer bound (OQ-4) ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f2', 'customer_service', 'x', null, null,
                                        '00000000-0000-4000-8000-000000005003') $$,
  '42501', 'not authorized',
  'the Creator can no longer complete an approved Customer Service creation request (PR 1.3 Q14), even with the Auth user''s nonce');
reset role;
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000f2'), 0::bigint,
  'no profile was bound to the legacy creation');

-- E. Cancellation is unchanged (OQ-4) -----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.cancel_account_request('00000000-0000-4000-8000-000000005001', 1) $$,
  '42501', 'not authorized', 'another Manager cannot cancel a Manager''s pending request');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.cancel_account_request('00000000-0000-4000-8000-000000005001', 1) $$,
  '42501', 'not authorized', 'the Creator cannot cancel a Manager''s pending request (he rejected those, which is retired)');
select is(public.cancel_account_request('00000000-0000-4000-8000-000000005003', 1), 2,
  'the Creator cancels the approved, unfulfilled legacy creation');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.cancel_account_request('00000000-0000-4000-8000-000000005001', 1), 2,
  'a Manager cancels his own pending legacy request');
select throws_ok($$ select public.cancel_account_request('00000000-0000-4000-8000-000000005004', 1) $$,
  '55000', 'the request cannot be cancelled', 'a decided request cannot be cancelled');
reset role;
select results_eq(
  $$ select a.action, right(a.target_id::text, 4), right(a.actor_profile_id::text, 2), a.details
     from public.audit_logs a where a.action = 'account_request.cancelled' order by a.id $$,
  $$ values ('account_request.cancelled', '5003', 'c1', '{"from_status": "approved", "request_type": "create"}'::jsonb),
            ('account_request.cancelled', '5001', 'a1', '{"from_status": "pending", "request_type": "reactivate"}'::jsonb) $$,
  'each cancellation is audited with its actor, the request type and the status it left');

-- F. An open legacy creation holds its email until it is cancelled; then the Manager's direct
--    Customer Service intent works (D60 (7)) -----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.authorize_account_creation('customer_service', 'legacy.agent@example.test', 'נציגה') $$,
  '55000', 'an open request exists', 'a pending legacy creation request still holds its email (one open creation per email)');
select is(public.cancel_account_request('00000000-0000-4000-8000-000000005002', 1), 2,
  'its requester cancels it');
select lives_ok($$ select public.authorize_account_creation('customer_service', 'legacy.agent@example.test', 'נציגה') $$,
  'then the Manager authorizes the Customer Service creation directly (D60 (7))');
reset role;
select ok(
  (select request_type = 'direct_create' and status = 'approved' and requested_role = 'customer_service'
          and requested_by = '00000000-0000-4000-8000-0000000000a1' and decided_by = requested_by and is_test
          and target_profile_id is null
   from public.account_requests where email = 'legacy.agent@example.test' and status = 'approved')
  and (select count(*) from public.audit_logs a join public.account_requests r on r.id = a.target_id
       where a.action = 'account_creation.authorized' and r.email = 'legacy.agent@example.test'
         and a.details = '{"actor_role": "manager", "requested_role": "customer_service"}'::jsonb) = 1,
  'the intent is a test-marked direct_create approved by its own requester, and audited');

select * from finish();
rollback;
