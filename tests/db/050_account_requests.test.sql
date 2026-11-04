-- PR 1.3: Manager-initiated Customer Service requests and the Creator's decisions (D34 a;
-- docs/database-schema.md §4 account_requests, §8.5; docs/security.md §10 "Account-approval
-- escalation"; docs/testing.md category 4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

-- Fixtures (local, rolled back): see 020_markers.test.sql. b2 and b3 are inactive Customer Service
-- accounts; d4 an inactive Technician without a field profile; a3 a Manager who leaves later.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b9', 'd1', 'd4']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a3', 'manager', 'מנהל ג', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000b3', 'customer_service', 'נציגה לא פעילה ב', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d4', 'technician', 'טכנאי לא פעיל', false);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000b9', 'customer_service', 'נציגה אמיתית', false, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test');

create temporary table counts_before on commit drop as
  select (select count(*) from auth.users) as users, (select count(*) from public.profiles) as profiles;

-- Requests by the Manager: nothing changes while pending ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.request_account_change('create', null, 'customer_service', ' New.Agent@Example.test ', 'נציגה חדשה') $$,
  'a Manager asks to create a Customer Service account');
select lives_ok($$ select public.request_account_change('reactivate', '00000000-0000-4000-8000-0000000000b2', null, null, null) $$,
  'a Manager asks to reactivate a Customer Service account');
select lives_ok($$ select public.request_account_change('role_change', '00000000-0000-4000-8000-0000000000b1', 'technician', null, null) $$,
  'a Manager asks to change a Customer Service role');
select throws_ok($$ select public.request_account_change('activate', '00000000-0000-4000-8000-0000000000b2', null, null, null) $$,
  '55000', 'a pending request exists', 'one pending request per account');
select throws_ok($$ select public.request_account_change('create', null, 'customer_service', 'new.agent@example.test', 'x') $$,
  '55000', 'an open request exists', 'one open create request per email');
select throws_ok($$ select public.request_account_change('create', null, 'manager', 'm@example.test', 'x') $$,
  '42501', 'not authorized', 'a Manager never requests the manager role');
select throws_ok($$ select public.request_account_change('create', null, 'creator', 'c@example.test', 'x') $$,
  '42501', 'not authorized', 'a Manager never requests the creator role');
select throws_ok($$ select public.request_account_change('role_change', '00000000-0000-4000-8000-0000000000b1', 'manager', null, null) $$,
  '42501', 'not authorized', 'a Manager never requests a promotion to Manager');
select throws_ok($$ select public.request_account_change('create', null, 'technician', 't@example.test', 'x') $$,
  '22023', 'invalid input', 'Technician creation is immediate, not a request (D34 c)');
select throws_ok($$ select public.request_account_change('activate', '00000000-0000-4000-8000-0000000000d4', null, null, null) $$,
  '55000', 'the request does not apply', 'Technician activation is immediate, not a request (D34 c)');
select throws_ok($$ select public.request_account_change('role_change', '00000000-0000-4000-8000-0000000000d1', 'customer_service', null, null) $$,
  '55000', 'the request does not apply', 'a Technician with a field profile keeps his role (owner question Q5)');
select throws_ok($$ select public.request_account_change('activate', '00000000-0000-4000-8000-0000000000a2', null, null, null) $$,
  '42501', 'not authorized', 'requests never target a Manager');
select throws_ok($$ select public.request_account_change('activate', '00000000-0000-4000-8000-0000000000b9', null, null, null) $$,
  '42501', 'not authorized', 'a test Manager cannot request a change to a real account (D47)');
select throws_ok($$ select public.request_account_change('create', null, 'customer_service', 'agent@company.example', 'x') $$,
  '23514', null, 'TEMPORARY (owner question Q12): a test request''s email must be in example.test');
reset role;

select ok(
  (select users = (select count(*) from auth.users) and profiles = (select count(*) from public.profiles) from counts_before),
  'while a create request is pending no Auth user and no profile exist');
select ok((select not is_active from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'),
  'while a reactivation is pending the account stays inactive');
select is((select role from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'), 'customer_service',
  'while a role change is pending the role is unchanged');
select ok(
  (select bool_and(status = 'pending' and is_test) and count(*) = 3 from public.account_requests),
  'the three requests are pending test records');
select ok(
  (select bool_and(target_version = 1) from public.account_requests where request_type <> 'create')
  and (select target_version is null from public.account_requests where request_type = 'create'),
  'a request on an account stores the account''s version, so a later change makes it stale (review S6)');
select is((select email from public.account_requests where request_type = 'create'), 'new.agent@example.test',
  'the create request stores the email trimmed and lower-case');
select is((select count(*) from public.audit_logs where action = 'account_request.created'), 3::bigint,
  'every request is audited');
select is((select count(*) from public.audit_logs where action = 'account_request.created' and details ? 'email'), 0::bigint,
  'audit details never contain the email');

-- Who may request ---------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.request_account_change('create', null, 'customer_service', 'x@example.test', 'x') $$,
  '42501', 'not authorized', 'Customer Service cannot make requests');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.request_account_change('create', null, 'customer_service', 'x@example.test', 'x') $$,
  '42501', 'not authorized', 'a Technician cannot make requests');
reset role;

-- RLS on requests ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'second@example.test', 'נציגה נוספת') $$,
  'a second Manager makes his own request');
select is((select count(*) from public.account_requests), 1::bigint, 'a Manager sees only his own requests');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 3::bigint, 'the first Manager sees his three requests');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 0::bigint, 'Customer Service sees no requests');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.account_requests), 4::bigint, 'the Creator sees every request');
reset role;

-- Decisions: Creator only ------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where request_type = 'reactivate'), 'approve', 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot approve requests (not even his own)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.decide_account_request('00000000-0000-4000-8000-000000000000', 'approve', 1, null) $$,
  '42501', 'not authorized', 'Customer Service cannot decide requests');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where request_type = 'role_change'), 'reject', 1, '  ') $$,
  '22023', 'invalid input', 'a rejection needs a reason');
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where request_type = 'role_change'), 'approve', 7, null) $$,
  'PT409', 'version conflict', 'a stale expected_version is a conflict');
select is(
  public.decide_account_request((select id from public.account_requests where request_type = 'reactivate'), 'approve', 1, null),
  2, 'the Creator approves the reactivation');
select is(
  public.decide_account_request((select id from public.account_requests where request_type = 'role_change'), 'approve', 1, null),
  2, 'the Creator approves the role change');
select is(
  public.decide_account_request((select id from public.account_requests where email = 'second@example.test'), 'reject', 1, 'אין צורך'),
  2, 'the Creator rejects a request with a reason');
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where request_type = 'reactivate'), 'reject', 2, 'x') $$,
  '55000', 'the request is not pending', 'a decided request cannot be decided again');
select is(
  public.decide_account_request((select id from public.account_requests where request_type = 'create' and email = 'new.agent@example.test'), 'approve', 1, null),
  2, 'the Creator approves the create request');
reset role;

select ok((select is_active from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'),
  'an approved reactivation activates the account');
select is((select role from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'), 'technician',
  'an approved role change applies the role');
select ok(
  (select status = 'rejected' and rejection_reason = 'אין צורך' and decided_by = '00000000-0000-4000-8000-0000000000c1'
   from public.account_requests where email = 'second@example.test'),
  'a rejection stores the reason and the decider');
select ok(
  (select status = 'approved' and target_profile_id is null from public.account_requests where email = 'new.agent@example.test'),
  'an approved create changes nothing yet: the Auth user is created in Step 2');
select results_eq(
  $$ select action from public.audit_logs where action in ('account_request.approved', 'account_request.rejected',
       'profile.activated', 'profile.role_changed') order by id $$,
  $$ values ('profile.activated'), ('account_request.approved'), ('profile.role_changed'), ('account_request.approved'),
            ('account_request.rejected'), ('account_request.approved') $$,
  'every decision and every change it applies is audited in the same transaction');

-- Fulfilment of an approved create (Step 2 flow: Auth Admin API first, then the profile) ----------
-- The Step 2 server creates the Auth user with app_metadata.account_request_id = the request id
-- (re-review R-S1); f6 carries the same nonce with another email.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', v.email,
       jsonb_build_object('provider', 'email', 'account_request_id', r.id::text), now(), now()
from (values ('00000000-0000-4000-8000-0000000000f5', 'new.agent@example.test'),
             ('00000000-0000-4000-8000-0000000000f6', 'other@example.test')) as v (id, email)
cross join public.account_requests r
where r.email = 'new.agent@example.test';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f5', 'customer_service', 'נציגה חדשה', null, null,
       (select id from public.account_requests where email = 'new.agent@example.test')) $$,
  '42501', 'not authorized', 'only the Creator fulfils an approved create request');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f6', 'customer_service', 'x', null, null,
       (select id from public.account_requests where email = 'new.agent@example.test')) $$,
  '42501', 'not authorized', 'the Auth user''s email must match the request');
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f5', 'manager', 'x', null, null,
       (select id from public.account_requests where email = 'new.agent@example.test')) $$,
  '42501', 'not authorized', 'the Creator cannot fulfil a Customer Service request with another role');
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f5', 'customer_service', 'x', null, null,
       (select id from public.account_requests where request_type = 'reactivate')) $$,
  '42501', 'not authorized', 'a request that is not a creation cannot be fulfilled');
select lives_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f5', 'customer_service', 'נציגה חדשה', null, null,
       (select id from public.account_requests where email = 'new.agent@example.test')) $$,
  'the Creator creates the approved Customer Service profile');
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f6', 'customer_service', 'x', null, null,
       (select id from public.account_requests where email = 'new.agent@example.test')) $$,
  '42501', 'not authorized', 'a request is fulfilled once');
reset role;
select is((select target_profile_id from public.account_requests where email = 'new.agent@example.test'),
  '00000000-0000-4000-8000-0000000000f5'::uuid, 'the approved request is linked to the new profile');

-- A pending create cannot be fulfilled; stale approvals (review S6, owner question Q17) ---------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pending.agent@example.test', now(), now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'pending.agent@example.test', 'נציגה ממתינה') $$,
  'setup: a pending create request');
select lives_ok($$ select public.request_account_change('activate', '00000000-0000-4000-8000-0000000000b3', null, null, null) $$,
  'setup: a request to activate b3');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'fourth@example.test', 'נציגה רביעית') $$,
  'setup: a request by Manager a3');
reset role;
-- f7 carries the nonce of the pending request, so only its state refuses the binding below.
update auth.users u set raw_app_meta_data = jsonb_build_object('provider', 'email', 'account_request_id', r.id::text)
from public.account_requests r where r.email = u.email and u.id = '00000000-0000-4000-8000-0000000000f7';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f7', 'customer_service', 'x', null, null,
       (select id from public.account_requests where email = 'pending.agent@example.test')) $$,
  '42501', 'not authorized', 'a pending (not approved) create cannot be fulfilled');
-- The Creator activates b3 directly and deactivates it again for cause; the old request is stale.
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', true, 1, null) $$,
  'setup: the Creator activates b3 directly');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', false, 2, 'סיבה') $$,
  'setup: the Creator deactivates b3 again');
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where request_type = 'activate'
       and target_profile_id = '00000000-0000-4000-8000-0000000000b3'), 'approve', 1, null) $$,
  '55000', 'the request no longer applies', 'a request whose account changed after it was made cannot be approved');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a3', false, 1, 'עזב') $$,
  'setup: the Creator deactivates Manager a3');
select throws_ok(
  $$ select public.decide_account_request((select id from public.account_requests where email = 'fourth@example.test'), 'approve', 1, null) $$,
  '55000', 'the request no longer applies', 'a request of a Manager who is no longer active cannot be approved');
select lives_ok(
  $$ select public.decide_account_request((select id from public.account_requests where email = 'fourth@example.test'), 'reject', 1, 'המבקש עזב') $$,
  'the Creator can still reject it');
reset role;
select ok((select not is_active from public.profiles where id = '00000000-0000-4000-8000-0000000000b3'),
  'the stale activation changed nothing');

-- Cancellation by the requester ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'third@example.test', 'נציגה שלישית') $$,
  'setup: another pending request');
reset role;
-- The id is passed in a setting: the other Manager cannot read the request (RLS).
select set_config('tm_test.request_id', (select id::text from public.account_requests where email = 'third@example.test'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.cancel_account_request(current_setting('tm_test.request_id')::uuid, 1) $$,
  '42501', 'not authorized', 'another Manager cannot cancel the request');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.cancel_account_request((select r.id from public.account_requests r where r.email = 'third@example.test'), 1),
  2, 'the requester cancels his pending request');
select throws_ok(
  $$ select public.cancel_account_request((select r.id from public.account_requests r where r.email = 'third@example.test'), 2) $$,
  '55000', 'the request cannot be cancelled', 'a cancelled request cannot be cancelled again');
reset role;
select ok(
  (select status = 'cancelled' and decided_by = '00000000-0000-4000-8000-0000000000a1' and decided_at is not null
   from public.account_requests where email = 'third@example.test')
  and exists (select 1 from public.audit_logs where action = 'account_request.cancelled'),
  'the cancellation is stored and audited');

-- An approved creation that is not fulfilled yet can be cancelled by its requester or the Creator,
-- so a failed Auth call never blocks the email for good; the Creator never cancels another
-- requester's pending request (he rejects it).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.cancel_account_request((select id from public.account_requests where email = 'pending.agent@example.test'), 1) $$,
  '42501', 'not authorized', 'the Creator cannot cancel a Manager''s pending request');
select is(
  public.decide_account_request((select id from public.account_requests where email = 'pending.agent@example.test'), 'approve', 1, null),
  2, 'setup: the Creator approves the create request');
select is(
  public.cancel_account_request((select id from public.account_requests where email = 'pending.agent@example.test'), 2),
  3, 'the Creator cancels the approved, unfulfilled creation');
select throws_ok(
  $$ select public.cancel_account_request((select id from public.account_requests where email = 'new.agent@example.test'), 3) $$,
  '55000', 'the request cannot be cancelled', 'a fulfilled creation cannot be cancelled');
select throws_ok(
  $$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f7', 'customer_service', 'x', null, null,
       (select id from public.account_requests where email = 'pending.agent@example.test')) $$,
  '42501', 'not authorized', 'a cancelled creation cannot be fulfilled');
reset role;
select ok(
  (select status = 'cancelled' and decided_by = '00000000-0000-4000-8000-0000000000c1' from public.account_requests
   where email = 'pending.agent@example.test')
  and exists (select 1 from public.audit_logs where action = 'account_request.cancelled'
                and details = '{"from_status": "approved", "request_type": "create"}'::jsonb
                and actor_profile_id = '00000000-0000-4000-8000-0000000000c1'),
  'the cancellation keeps the decider and is audited with the canceller as actor');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'pending.agent@example.test', 'נציגה ממתינה') $$,
  'after the cancellation the email can be requested again');
reset role;

-- Re-review R-S5: only the requester or the Creator cancels an approved, unfulfilled creation;
-- R-S1 (b): an Auth user created for a cancelled request is never bound through a later intent.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.request_account_change('create', null, 'customer_service', 'rebind.cs@example.test', 'נציגה') $$,
  'setup: a Manager asks to create a Customer Service account');
select lives_ok($$ select public.authorize_account_creation('technician', 'tech.intent@example.test', 'טכנאי') $$,
  'setup: the same Manager authorizes a Technician creation');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.decide_account_request((select id from public.account_requests where email = 'rebind.cs@example.test'), 'approve', 1, null),
  2, 'setup: the Creator approves the create request');
select lives_ok($$ select public.authorize_account_creation('manager', 'creator.intent@example.test', 'מנהל') $$,
  'setup: the Creator authorizes a Manager creation');
reset role;
select set_config('tm_test.req_cs', (select id::text from public.account_requests where email = 'rebind.cs@example.test'), true);
select set_config('tm_test.intent_tech', (select id::text from public.account_requests where email = 'tech.intent@example.test'), true);
select set_config('tm_test.intent_creator', (select id::text from public.account_requests where email = 'creator.intent@example.test'), true);
-- The Auth user for the approved request was created with its nonce, then the bind failed.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rebind.cs@example.test', jsonb_build_object('provider', 'email', 'account_request_id', current_setting('tm_test.req_cs')),
   now(), now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.cancel_account_request(current_setting('tm_test.req_cs')::uuid, 2) $$,
  '42501', 'not authorized', 'R-S5: another Manager cannot cancel a Manager''s approved, unfulfilled creation request');
select throws_ok($$ select public.cancel_account_request(current_setting('tm_test.intent_tech')::uuid, 1) $$,
  '42501', 'not authorized', 'R-S5: another Manager cannot cancel a Manager''s creation intent');
select throws_ok($$ select public.cancel_account_request(current_setting('tm_test.intent_creator')::uuid, 1) $$,
  '42501', 'not authorized', 'R-S5: a Manager cannot cancel the Creator''s creation intent');
reset role;
select ok(
  (select bool_and(status = 'approved') and count(*) = 3 from public.account_requests
   where id in (current_setting('tm_test.req_cs')::uuid, current_setting('tm_test.intent_tech')::uuid,
                current_setting('tm_test.intent_creator')::uuid)),
  'the refused cancellations changed nothing');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.cancel_account_request(current_setting('tm_test.req_cs')::uuid, 2), 3,
  'setup: the requesting Manager cancels his approved request after the failed bind');
select lives_ok($$ select public.authorize_account_creation('technician', 'rebind.cs@example.test', 'x') $$,
  'setup: and authorizes a Technician creation for the same email');
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f8', 'technician', 'x', null, null,
     (select id from public.account_requests where email = 'rebind.cs@example.test' and request_type = 'direct_create')) $$,
  '42501', 'not authorized', 'R-S1 (b): the Auth user created for the cancelled request cannot be bound through the Manager''s new intent');
reset role;

select * from finish();
rollback;
