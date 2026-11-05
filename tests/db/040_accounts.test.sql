-- PR 1.3: account administration (D34, D49; docs/database-schema.md §8.4, §8.5; docs/security.md
-- §5, §10; docs/testing.md categories 2 and 4). Every call runs as `authenticated` with the
-- caller's JWT claims, as PostgREST does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(142);

-- Fixtures (local, rolled back): see 020_markers.test.sql. b3 is an inactive Customer Service
-- account; f1, f2 and f3 are Auth users without a profile; b9, d8 and d9 (with field profile e9)
-- are real-marked targets.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a8', 'a9', 'b1', 'b2', 'b3', 'b9', 'd1', 'd2', 'd3', 'd4', 'd5', 'd8', 'd9', 'f1', 'f2', 'f3']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה ב', false),
  ('00000000-0000-4000-8000-0000000000b3', 'customer_service', 'נציגה ג', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true),
  ('00000000-0000-4000-8000-0000000000d3', 'technician', 'טכנאי ללא כרטיס', true),
  ('00000000-0000-4000-8000-0000000000d4', 'technician', 'טכנאי לא פעיל', false);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000b9', 'customer_service', 'נציגה אמיתית', true, false),
  ('00000000-0000-4000-8000-0000000000d8', 'technician', 'טכנאי אמיתי ללא כרטיס', true, false),
  ('00000000-0000-4000-8000-0000000000d9', 'technician', 'טכנאי אמיתי', true, false),
  -- a8: a real-marked active Manager, so the Creator-only role checks are what refuses him (review T1).
  ('00000000-0000-4000-8000-0000000000a8', 'manager', 'מנהל אמיתי', true, false);
-- d5: last updated a day ago, so an edit shows that updated_at advances (review T5).
insert into public.profiles (id, role, full_name, is_active, updated_at) values
  ('00000000-0000-4000-8000-0000000000d5', 'technician', 'טכנאי ישן', true, now() - interval '1 day');
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test'),
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000d9', false, 'טכנאי אמיתי', 't-s', 'real-tech@company.example');

-- assert_can_manage (§8.5) ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.assert_can_manage('technician') $$, 'Creator manages Technicians');
select lives_ok($$ select public.assert_can_manage('customer_service') $$, 'Creator manages Customer Service');
select lives_ok($$ select public.assert_can_manage('manager') $$, 'Creator manages Managers');
select lives_ok($$ select public.assert_can_manage('creator') $$, 'Creator manages Creators');
select throws_ok($$ select public.assert_can_manage('admin') $$, '22023', 'invalid input', 'an unknown role is invalid input');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.assert_can_manage('technician') $$, 'Manager manages Technicians');
select lives_ok($$ select public.assert_can_manage('customer_service') $$, 'Manager manages Customer Service');
select throws_ok($$ select public.assert_can_manage('manager') $$, '42501', 'not authorized', 'Manager never manages Managers');
select throws_ok($$ select public.assert_can_manage('creator') $$, '42501', 'not authorized', 'Manager never manages Creators');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_manage('technician') $$, '42501', 'not authorized', 'Customer Service manages no account');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_manage('technician') $$, '42501', 'not authorized', 'a Technician manages no account');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_manage('technician') $$, '42501', 'not authorized', 'a user without a profile manages no account');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_manage('technician') $$, '42501', 'not authorized', 'a deactivated Manager manages no account');
reset role;

-- Two-phase creation (§8.5, D34, D49; review S5, S12) ------------------------------------------
-- Phase 1: authorize_account_creation (audited intent) before the Auth Admin call; phase 2 (Step 2):
-- the Auth user is created; phase 3: admin_create_profile binds it to the intent.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.authorize_account_creation('technician', ' User-F1@Example.test ', 'טכנאי חדש') $$,
  'a Manager authorizes a Technician creation (phase 1, before any Auth user exists)');
select throws_ok($$ select public.authorize_account_creation('customer_service', 'cs-new@example.test', 'x') $$,
  '42501', 'not authorized', 'a Manager cannot authorize a Customer Service creation (D34 a: a request to the Creator)');
select throws_ok($$ select public.authorize_account_creation('manager', 'm-new@example.test', 'x') $$,
  '42501', 'not authorized', 'a Manager cannot authorize a Manager creation');
select throws_ok($$ select public.authorize_account_creation('creator', 'c-new@example.test', 'x') $$,
  '42501', 'not authorized', 'a Manager cannot authorize a Creator creation');
select throws_ok($$ select public.authorize_account_creation('technician', 'user-f1@example.test', 'x') $$,
  '55000', 'an open request exists', 'one open creation per email, so an in-flight creation cannot be bound by someone else');
select throws_ok($$ select public.authorize_account_creation('technician', 'tech@company.example', 'x') $$,
  '23514', null, 'TEMPORARY (owner question Q12): a test user''s sign-in email is in example.test');
select throws_ok($$ select public.authorize_account_creation('admin', 'x@example.test', 'x') $$,
  '22023', 'invalid input', 'an unknown role is invalid input');
reset role;
select set_config('tm_test.intent_f1', (select id::text from public.account_requests where email = 'user-f1@example.test'), true);
select ok(
  (select request_type = 'direct_create' and status = 'approved' and requested_role = 'technician' and is_test
          and requested_by = '00000000-0000-4000-8000-0000000000a1' and decided_by = requested_by and target_profile_id is null
   from public.account_requests where email = 'user-f1@example.test'),
  'the intent is stored approved by its own requester, test-marked, with the email trimmed and lower-case');
select is(
  (select count(*) from public.audit_logs where action = 'account_creation.authorized'
     and target_id = current_setting('tm_test.intent_f1')::uuid and actor_profile_id = '00000000-0000-4000-8000-0000000000a1'
     and details = '{"actor_role": "manager", "requested_role": "technician"}'::jsonb),
  1::bigint, 'phase 1 is audited before the Auth Admin call (§8.5, security.md §5)');

-- Phase 2 is simulated: the Step 2 server creates the Auth user with app_metadata.account_request_id
-- set to the intent id (the binding nonce, re-review R-S1). The fixture users exist already, so
-- each test sets the nonce it needs as postgres. f4 existed an hour before its authorization
-- (orphaned or created elsewhere); f5 was created 30 seconds before its authorization.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'orphan@example.test', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'early@example.test', now() - interval '30 seconds', now() - interval '30 seconds');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null, null) $$,
  '22023', 'invalid input', 'a profile is created only against a phase-1 intent or an approved request');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized',
  'R-S1: an Auth user without the intent nonce (created by any other path, for example a sign-up) cannot be bound');
reset role;
update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('account_request_id', gen_random_uuid()::text)
where id = '00000000-0000-4000-8000-0000000000f1';
update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('account_request_id', current_setting('tm_test.intent_f1'))
where id = '00000000-0000-4000-8000-0000000000f3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'R-S1: an Auth user whose nonce names another intent cannot be bound');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f3', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'the Auth user''s email must match the intent (even with the right nonce)');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000ff', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'an unknown Auth user gets the same generic error (S12)');
reset role;
update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('account_request_id', current_setting('tm_test.intent_f1')),
  is_anonymous = true
where id = '00000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'R-S1: an anonymous Auth user cannot be bound, even with the nonce');
reset role;
update auth.users set is_anonymous = false, is_sso_user = true where id = '00000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'R-S1: an SSO Auth user cannot be bound, even with the nonce');
reset role;
update auth.users set is_sso_user = false, deleted_at = now() where id = '00000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'R-S1: a soft-deleted Auth user cannot be bound, even with the nonce');
reset role;
update auth.users set deleted_at = null where id = '00000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', '', '050-000-0000', null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  'a Manager creates the authorized Technician profile (phase 3, immediate, D34 c)');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f1')::uuid) $$,
  '42501', 'not authorized', 'an intent is fulfilled once');
select lives_ok($$ select public.authorize_account_creation('technician', 'user-b1@example.test', 'x') $$,
  'setup: an intent for the email of an account that already has a profile');
select lives_ok($$ select public.authorize_account_creation('technician', 'orphan@example.test', 'x') $$,
  'setup: an intent for the email of an Auth user created an hour earlier');
select lives_ok($$ select public.authorize_account_creation('technician', 'early@example.test', 'x') $$,
  'setup: an intent for the email of an Auth user created 30 seconds earlier');
reset role;
update auth.users u set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_request_id', r.id::text)
from public.account_requests r
where r.email = u.email and u.id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f4',
                                     '00000000-0000-4000-8000-0000000000f5');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000b1', 'technician', 'x', null, null,
     (select id from public.account_requests where email = 'user-b1@example.test')) $$,
  '42501', 'not authorized', 'a user with a profile gets the same generic error (S12)');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f4', 'technician', 'x', null, null,
     (select id from public.account_requests where email = 'orphan@example.test')) $$,
  '42501', 'not authorized', 'an Auth user that existed before the authorization cannot be taken over, even with the nonce (review S5)');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f5', 'technician', 'x', null, null,
     (select id from public.account_requests where email = 'early@example.test')) $$,
  '42501', 'not authorized', 'R-S1: no clock tolerance: an Auth user created 30 seconds before the authorization is refused');
reset role;

select ok(
  (select role = 'technician' and is_test and is_active and created_by = '00000000-0000-4000-8000-0000000000a1'
          and full_name = 'טכנאי חדש'
   from public.profiles where id = '00000000-0000-4000-8000-0000000000f1')
  and (select target_profile_id = '00000000-0000-4000-8000-0000000000f1' from public.account_requests
       where id = current_setting('tm_test.intent_f1')::uuid),
  'the new profile is an active test Technician created by the Manager, named from the intent and linked to it; Auth metadata "creator" is ignored');
select is(
  (select count(*) from public.audit_logs where action = 'profile.created' and target_table = 'profiles'
     and target_id = '00000000-0000-4000-8000-0000000000f1' and actor_profile_id = '00000000-0000-4000-8000-0000000000a1'
     and details = jsonb_build_object('role', 'technician', 'request_id', current_setting('tm_test.intent_f1'))),
  1::bigint, 'T3: phase 3 is audited (profile.created with the role and the intent it was bound to)');

-- Another caller's intent cannot be used.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.authorize_account_creation('technician', 'user-f3@example.test', 'טכנאי ג') $$,
  'setup: a second Manager authorizes a Technician');
reset role;
select set_config('tm_test.intent_f3', (select id::text from public.account_requests where email = 'user-f3@example.test'), true);
update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('account_request_id', current_setting('tm_test.intent_f3'))
where id = '00000000-0000-4000-8000-0000000000f3';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f3', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f3')::uuid) $$,
  '42501', 'not authorized', 'a Manager cannot use another caller''s intent');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.authorize_account_creation('creator', 'c-new@example.test', 'x') $$,
  '42501', 'not authorized', 'even the Creator cannot authorize a Creator (D49: bootstrap only, owner question Q11)');
select lives_ok($$ select public.authorize_account_creation('manager', 'user-f2@example.test', 'מנהל חדש') $$,
  'the Creator authorizes a Manager creation');
reset role;
update auth.users u set raw_app_meta_data = u.raw_app_meta_data || jsonb_build_object('account_request_id', r.id::text)
from public.account_requests r where r.email = u.email and u.id = '00000000-0000-4000-8000-0000000000f2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f2', 'creator', 'x', null, null,
     (select id from public.account_requests where email = 'user-f2@example.test')) $$,
  '42501', 'not authorized', 'even the Creator cannot create a Creator profile');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f2', 'customer_service', 'x', null, null,
     (select id from public.account_requests where email = 'user-f2@example.test')) $$,
  '42501', 'not authorized', 'the role must be the authorized one');
select lives_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f2', 'manager', 'מנהל חדש', null, null,
     (select id from public.account_requests where email = 'user-f2@example.test')) $$,
  'the Creator creates the authorized Manager');
reset role;
select ok((select is_test and role = 'manager' from public.profiles where id = '00000000-0000-4000-8000-0000000000f2'),
  'every new user is a test user (TEMPORARY until go-live, D47)');

-- Re-review R-S1 (a): an Auth user stays bound to the intent it was created for. The Creator
-- authorizes a Manager creation, the Auth user is created with that intent's nonce, the Creator
-- cancels the intent; a Manager's new intent for the same email cannot bind that Auth user.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.authorize_account_creation('manager', 'rebind@example.test', 'x') $$,
  'setup: the Creator authorizes a Manager creation');
reset role;
select set_config('tm_test.intent_x', (select id::text from public.account_requests where email = 'rebind@example.test'), true);
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rebind@example.test', jsonb_build_object('provider', 'email', 'account_request_id', current_setting('tm_test.intent_x')),
   now(), now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.cancel_account_request(current_setting('tm_test.intent_x')::uuid, 1), 2,
  'setup: the Creator cancels his intent after the Auth user was created');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.authorize_account_creation('technician', 'rebind@example.test', 'x') $$,
  'setup: a Manager authorizes a Technician creation for the same email');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f6', 'technician', 'x', null, null,
     (select id from public.account_requests where email = 'rebind@example.test' and status = 'approved')) $$,
  '42501', 'not authorized', 'R-S1: the Auth user created for the cancelled intent cannot be bound through the new intent');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f6', 'manager', 'x', null, null,
     current_setting('tm_test.intent_x')::uuid) $$,
  '42501', 'not authorized', 'nor through the cancelled intent itself');
reset role;
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000f6'), 0::bigint,
  'R-S1: no profile was created for the Auth user of the cancelled intent');

-- Customer Service and Technician callers manage no account (review S7) -------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.authorize_account_creation('technician', 'x@example.test', 'x') $$,
  '42501', 'not authorized', 'Customer Service cannot authorize creations');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f3', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f3')::uuid) $$,
  '42501', 'not authorized', 'Customer Service cannot create profiles');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', false, 1, null) $$,
  '42501', 'not authorized', 'Customer Service cannot deactivate accounts');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d2', 1, 'x', null, null) $$,
  '42501', 'not authorized', 'Customer Service cannot update accounts');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000d3', 'customer_service', 1, null) $$,
  '42501', 'not authorized', 'Customer Service cannot change roles');
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000d2', 'password') $$,
  '42501', 'not authorized', 'Customer Service cannot authorize credential changes');
reset role;
-- Review T2: a test-marked caller on a test target passes the test-user rule, so only the role check
-- refuses these two.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e1', 1, 'x', 't-y', 'cs-mailbox@example.test', null, true) $$,
  '42501', 'not authorized', 'T2: Customer Service cannot update a field profile (its Outlook email included)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.authorize_account_creation('technician', 'x@example.test', 'x') $$,
  '42501', 'not authorized', 'a Technician cannot authorize creations');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f3', 'technician', 'x', null, null,
     current_setting('tm_test.intent_f3')::uuid) $$,
  '42501', 'not authorized', 'a Technician cannot create profiles');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', false, 1, null) $$,
  '42501', 'not authorized', 'a Technician cannot deactivate accounts');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d1', 1, 'x', null, null) $$,
  '42501', 'not authorized', 'a Technician cannot update his own account');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000d3', 'customer_service', 1, null) $$,
  '42501', 'not authorized', 'a Technician cannot change roles');
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000d1', 'password') $$,
  '42501', 'not authorized', 'a Technician cannot authorize credential changes');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d3', 'x', 't-s', 'tech-x@example.test', null, true) $$,
  '42501', 'not authorized', 'T2: a Technician cannot create a field profile');
reset role;

-- Review T1: a real-marked Manager (after go-live every Manager is one) is refused by the
-- Creator-only role checks themselves, not by the test-user rule.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b9', 'password') $$,
  '42501', 'not authorized', 'T1: a real-marked Manager never sets or resets passwords');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b9', 'manager', 1, null) $$,
  '42501', 'not authorized', 'T1: a real-marked Manager cannot change a role directly (no promotion to Manager)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d9","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b9', 'password') $$,
  '42501', 'not authorized', 'T1: a real-marked Technician cannot authorize credential changes');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b9', 'technician', 1, null) $$,
  '42501', 'not authorized', 'T1: a real-marked Technician cannot change roles');
reset role;

-- admin_set_user_role (Creator only) -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'technician', 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot change a role directly (Customer Service changes are requests)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_user_role('00000000-0000-4000-8000-0000000000b2', 'technician', 1, 'שינוי תפקיד'), 2,
  'the Creator changes a role; the new version is returned');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'creator', 1, null) $$,
  '42501', 'not authorized', 'nobody is promoted to Creator through an RPC (D49)');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000c1', 'manager', 1, null) $$,
  '42501', 'not authorized', 'the Creator cannot change his own role');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000d1', 'customer_service', 1, null) $$,
  '55000', 'profiles: a profile with a technician record keeps its role', 'a Technician with a field profile keeps his role');
select throws_ok($$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'technician', 5, null) $$,
  'PT409', 'version conflict', 'a stale expected_version is a conflict');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'profile.role_changed'
     and target_id = '00000000-0000-4000-8000-0000000000b2' and target_is_test
     and details = '{"from": "customer_service", "to": "technician", "reason": "שינוי תפקיד"}'::jsonb),
  1::bigint, 'the role change is audited with from, to and reason');

-- admin_set_user_active (D34 b, c) ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', false, 1, 'עזבה'), 2,
  'a Manager deactivates a Customer Service account immediately');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', false, 1, 'טלפון אבד') $$,
  'a Manager deactivates a Technician immediately');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', true, 2, null) $$,
  'a Manager reactivates a Technician immediately (D34 c)');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', true, 1, null) $$,
  '55000', 'requires the Creator''s approval', 'a Manager cannot activate a Customer Service account (request needed)');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a2', false, 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot deactivate a Manager');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000c1', false, 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot deactivate the Creator');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a1', false, 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot deactivate himself');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b9', false, 1, null) $$,
  '42501', 'not authorized', 'a test Manager cannot manage a real account (D47)');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', false, 9, null) $$,
  'PT409', 'version conflict', 'T5: a stale expected_version is a conflict');
reset role;

select ok(
  (select not is_active from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  'the deactivation took effect immediately');
select is(
  (select count(*) from public.audit_logs where action = 'profile.deactivated'
     and target_id = '00000000-0000-4000-8000-0000000000b1' and target_is_test
     and actor_profile_id = '00000000-0000-4000-8000-0000000000a1'
     and details = '{"actor_role": "manager", "reason": "עזבה"}'::jsonb),
  1::bigint, 'the deactivation is audited with the Manager as actor (the Creator''s notice reads it, Step 2)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000c1', false, 1, null) $$,
  '42501', 'not authorized', 'the Creator cannot deactivate himself (and the last Creator is locked)');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a2', false, 1, null) $$,
  'the Creator deactivates a Manager');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', true, 1, null) $$,
  'the Creator activates a Customer Service account directly');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d1', false, 1, null) $$,
  'the Creator deactivates a Technician');
reset role;

-- Revocation is immediate (D36): deactivated users read nothing ----------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select (select count(*) from public.profiles) + (select count(*) from public.technicians)
        + (select count(*) from public.permissions) + (select count(*) from public.role_permissions)
        + (select count(*) from public.account_requests) + (select count(*) from public.audit_logs)),
  0::bigint, 'a deactivated Customer Service user reads 0 rows in every table');
select is(public.has_permission('calls'), false, 'a deactivated user has no permission');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(public.my_technician_id(), null::uuid, 'a deactivated Technician has no technician id');
select is((select count(*) from public.technicians), 0::bigint, 'a deactivated Technician reads no technician row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_manage('technician') $$, '42501', 'not authorized',
  'a deactivated Manager loses account administration immediately');
reset role;

-- assert_can_change_credentials (D34 e) -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b3', 'password') $$,
  'the Creator may set a password (before the Auth Admin call)');
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b3', 'phone') $$,
  '22023', 'invalid input', 'only password and email are credential kinds');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'credentials.change_authorized'
     and target_id = '00000000-0000-4000-8000-0000000000b3' and details = '{"kind": "password"}'::jsonb),
  1::bigint, 'the authorization is audited');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b3', 'password') $$,
  '42501', 'not authorized', 'a Manager never sets or resets passwords');
select throws_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b3', 'email') $$,
  '42501', 'not authorized', 'a Manager never changes an email');
reset role;

-- Direct writes fail for every role (§8.4 rule 1) -------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000b3' $$,
  '42501', null, 'the Creator cannot update a role directly');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.profiles set is_active = true where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '42501', null, 'a Manager cannot update the active state directly');
select throws_ok($$ update public.technicians set outlook_email = 'x@example.test' where id = '00000000-0000-4000-8000-0000000000e2' $$,
  '42501', null, 'a Manager cannot update an Outlook email directly');
select throws_ok($$ insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000000f3', 'manager', 'x') $$,
  '42501', null, 'a Manager cannot insert a profile directly');
select throws_ok($$ delete from public.profiles where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '42501', null, 'a Manager cannot delete a profile');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.profiles set is_test = false where id = '00000000-0000-4000-8000-0000000000d2' $$,
  '42501', null, 'a Technician cannot update his test marker');
reset role;

select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok($$ update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000b3' $$,
  '42501', null, 'service_role cannot update a role');
select throws_ok($$ update public.technicians set outlook_email = 'x@example.test' where id = '00000000-0000-4000-8000-0000000000e2' $$,
  '42501', null, 'service_role cannot update an Outlook email');
select throws_ok($$ insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000000f3', 'manager', 'x') $$,
  '42501', null, 'service_role cannot insert a profile (never through service_role, §8.5)');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f3', 'technician', 'x', null, null, null) $$,
  '42501', null, 'service_role cannot execute the account RPCs');
reset role;
set local role anon;
select throws_ok($$ update public.profiles set is_active = true $$, '42501', null, 'anon cannot update profiles');
reset role;

-- admin_update_profile (D34 d) ----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d2',
       (select version from public.profiles where id = '00000000-0000-4000-8000-0000000000d2'), 'טכנאי ב שונה', '050-111-2222', null) $$,
  'a Manager updates a Technician''s name and work phone without approval');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000a2', 1, 'x', null, null) $$,
  '42501', 'not authorized', 'a Manager cannot update another Manager');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000a1', 1, 'x', null, null) $$,
  '42501', 'not authorized', 'a Manager cannot update his own account');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000b9', 1, 'x', null, null) $$,
  '42501', 'not authorized', 'a test Manager cannot update a real account');
select throws_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d2', 99, 'x', null, null) $$,
  'PT409', 'version conflict', 'T5: a stale expected_version is a conflict');
select is(public.admin_update_profile('00000000-0000-4000-8000-0000000000d5', 1, 'טכנאי ישן שונה', null, null), 2,
  'setup: a Manager renames d5');
reset role;
select ok((select updated_at = now() and version = 2 and updated_by = '00000000-0000-4000-8000-0000000000a1'
           from public.profiles where id = '00000000-0000-4000-8000-0000000000d5'),
  'T5: an edit advances updated_at (it was a day old) and the version');
select is(
  (select details from public.audit_logs where action = 'profile.updated'
     and target_id = '00000000-0000-4000-8000-0000000000d2'),
  '{"fields": ["full_name", "work_phone"]}'::jsonb, 'the update is audited with the changed field names');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000a1', 1, 'מנהל א', '03-555-0000', 'דורון') $$,
  'the Creator updates a Manager''s phone and invitation alias');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*) from public.audit_logs
   where target_id = '00000000-0000-4000-8000-0000000000a1' and actor_profile_id <> '00000000-0000-4000-8000-0000000000a1'),
  0::bigint, 'T4 (owner question Q8): a Manager does not read the Creator''s audit rows about his own (Manager) account');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'profile.updated' and target_id = '00000000-0000-4000-8000-0000000000a1'
     and actor_profile_id = '00000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'positive control: that audit row exists');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d3',
       (select version from public.profiles where id = '00000000-0000-4000-8000-0000000000d3'), 'טכנאי ללא כרטיס', null, 'דורון') $$,
  '23505', 'the value is already in use',
  'a duplicate alias gets a generic error without the detail that names the other account''s alias (S12)');
reset role;

-- admin_create_technician / admin_update_technician (§8.3, D34 f) ----------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d3', 'טכנאי ג', 't-s', ' Tech-C@Example.test ', 'אנדרואיד', true) $$,
  'a Manager creates a Technician field profile');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000a2', 'x', 't-s', 'x9@example.test', null, true) $$,
  '42501', 'not authorized',
  'SEC-3: for a profile he cannot read (another Manager) a Manager gets the generic error, as for an unknown id');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000b3', 'x', 't-s', 'x@example.test', null, true) $$,
  '55000', 'the profile is not a Technician', 'a field profile needs a Technician profile');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d2', 'x', 't-s', 'x2@example.test', null, true) $$,
  '55000', 'the Technician already has a field profile', 'one field profile per Technician');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d4', 'x', 't-s', 'x@company.example', null, true) $$,
  '23514', null, 'a test Technician''s Outlook email must be in example.test');
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d8', 'x', 't-s', 'x8@company.example', null, true) $$,
  '42501', 'not authorized', 'a test Manager cannot create a field profile for a real Technician (D47)');
select throws_ok($$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e9', 1, 'x', 't-s', 'real-tech@company.example', null, true) $$,
  '42501', 'not authorized', 'a test Manager cannot update a real Technician''s field profile (D47)');
select is(
  public.admin_update_technician('00000000-0000-4000-8000-0000000000e2', 1, 'טכנאי ב', 't-e', 'tech-b2@example.test', null, false),
  2, 'a Manager changes an Outlook email and the invitation toggle');
select throws_ok($$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e2', 1, 'x', 't-e', 'tech-b2@example.test', null, true) $$,
  'PT409', 'version conflict', 'a stale expected_version is a conflict');
select throws_ok($$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e2', 2, 'טכנאי ב', 't-e', 'tech-a@example.test', null, false) $$,
  '23505', null, 'T5: an Outlook email belongs to one field profile only (unique)');
reset role;
select is(
  (select count(*) from public.audit_logs a join public.technicians t on t.id = a.target_id
   where a.action = 'technician.created' and t.profile_id = '00000000-0000-4000-8000-0000000000d3'
     and a.actor_profile_id = '00000000-0000-4000-8000-0000000000a1'
     and a.details = '{"profile_id": "00000000-0000-4000-8000-0000000000d3"}'::jsonb),
  1::bigint, 'T3: a new field profile is audited (technician.created)');

select ok(
  (select is_test and outlook_email = 'tech-c@example.test' from public.technicians
   where profile_id = '00000000-0000-4000-8000-0000000000d3'),
  'the field profile copies the profile''s test marker; the Outlook email is stored trimmed and lower-case');
select results_eq(
  $$ select action, details from public.audit_logs
     where target_id = '00000000-0000-4000-8000-0000000000e2' order by id $$,
  $$ values ('technician.updated', '{"fields": ["outlook_email", "accepts_invitations"]}'::jsonb),
            ('technician.outlook_email_changed', '{}'::jsonb) $$,
  'an Outlook-email change writes its own audit row for the Creator''s notice (D34 f)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e2', 2, 'x', 't-e', 'x@example.test', null, true) $$,
  '42501', 'not authorized', 'a Technician cannot edit his own field profile');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b9","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d4', 'x', 't-s', 'x@example.test', null, true) $$,
  '42501', 'not authorized', 'Customer Service cannot create field profiles');
reset role;

select * from finish();
rollback;
