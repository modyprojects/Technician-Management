-- PR 1.3: helpers and who reads what (docs/database-schema.md §8.3, §9; docs/security.md §5, §10;
-- docs/testing.md categories 2, 3 and 4). Roles come from profiles only, never from JWT or Auth
-- metadata claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- Fixtures (local, rolled back): see 020_markers.test.sql.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a9', 'b1', 'b2', 'b9', 'd1', 'd2', 'd3', 'd4', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true),
  ('00000000-0000-4000-8000-0000000000d3', 'technician', 'טכנאי ללא כרטיס', true),
  ('00000000-0000-4000-8000-0000000000d4', 'technician', 'טכנאי לא פעיל', false);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000b9', 'customer_service', 'נציגה אמיתית', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, accepts_invitations) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test', true),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test', false),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000d4', true, 'טכנאי לא פעיל', 't-s', 'tech-d@example.test', true);

-- Creator ----------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_creator(), true, 'Creator: is_creator() is true');
select is(public.my_technician_id(), null::uuid, 'Creator: no technician id');
select is((select count(*) from public.profiles), 11::bigint, 'Creator: reads every profile');
select is((select count(*) from public.technicians), 3::bigint, 'Creator: reads every technician');
select is((select count(*) from public.permissions), 13::bigint, 'Creator: reads the catalogue');
select is((select count(*) from public.role_permissions), 26::bigint, 'Creator: reads every matrix value');
reset role;

-- Manager -----------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_creator(), false, 'Manager: is_creator() is false');
select results_eq(
  $$ select role, count(*) from public.profiles group by role order by role $$,
  $$ values ('customer_service', 3::bigint), ('manager', 1::bigint), ('technician', 4::bigint) $$,
  'Manager: reads Technician and Customer Service profiles and his own, never other Managers or the Creator');
select is((select count(*) from public.technicians), 3::bigint, 'Manager: reads every technician');
select is((select count(*) from public.role_permissions where role = 'manager'), 13::bigint, 'Manager: reads his role''s values');
select is((select count(*) from public.role_permissions where role <> 'manager'), 0::bigint,
  'Manager: never reads Customer Service values (owner question Q8)');
reset role;

-- Customer Service --------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_creator(), false, 'Customer Service: is_creator() is false');
select is((select array_agg(id) from public.profiles), array['00000000-0000-4000-8000-0000000000b1'::uuid],
  'Customer Service: reads only his own profile');
select is((select count(*) from public.technicians), 3::bigint, 'Customer Service with cal/calls: reads technicians');
select is((select count(*) from public.permissions), 13::bigint, 'Customer Service: reads the catalogue');
select is((select count(*) from public.role_permissions where role = 'customer_service'), 13::bigint,
  'Customer Service: reads his role''s values only');
select is((select count(*) from public.role_permissions), 13::bigint, 'Customer Service: never Manager values');
reset role;

-- Technician A vs B -------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(public.my_technician_id(), '00000000-0000-4000-8000-0000000000e1'::uuid, 'Technician A: my_technician_id()');
select is((select array_agg(id) from public.technicians), array['00000000-0000-4000-8000-0000000000e1'::uuid],
  'Technician A: reads only his own technician row');
select is((select array_agg(id) from public.profiles), array['00000000-0000-4000-8000-0000000000d1'::uuid],
  'Technician A: reads only his own profile, never Technician B''s');
select is((select count(*) from public.permissions) + (select count(*) from public.role_permissions)
          + (select count(*) from public.account_requests) + (select count(*) from public.audit_logs),
  0::bigint, 'Technician A: no matrix, request or audit rows');
select is(public.is_creator(), false, 'Technician A: is_creator() is false');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(public.my_technician_id(), '00000000-0000-4000-8000-0000000000e2'::uuid,
  'Technician B: accepts_invitations = false still returns his id (it is not access, SE-05)');
select is((select array_agg(id) from public.technicians), array['00000000-0000-4000-8000-0000000000e2'::uuid],
  'Technician B: reads only his own technician row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select is(public.my_technician_id(), null::uuid, 'an inactive Technician has no technician id');
select is((select count(*) from public.technicians) + (select count(*) from public.profiles), 0::bigint,
  'an inactive Technician reads nothing');
reset role;

-- Users without access ----------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.profiles) + (select count(*) from public.technicians)
          + (select count(*) from public.permissions) + (select count(*) from public.role_permissions),
  0::bigint, 'a deactivated Manager reads nothing');
reset role;

-- Forged claims: roles never come from the JWT or Auth metadata ------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","user_role":"creator","app_metadata":{"role":"creator"},"user_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(public.is_creator(), false, 'a user without a profile is not a Creator, whatever his claims say');
select is(public.has_permission('calls'), false, 'a user without a profile has no permission, whatever his claims say');
select is((select count(*) from public.profiles) + (select count(*) from public.technicians)
          + (select count(*) from public.permissions), 0::bigint, 'a user without a profile reads nothing');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"service_role","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(public.is_creator(), false, 'a JWT role or metadata claim does not make Customer Service a Creator');
select is((select count(*) from public.profiles), 1::bigint, 'a forged claim does not widen Customer Service''s reads');
reset role;

-- anon and service_role read nothing --------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select public.is_creator() $$, '42501', null, 'anon cannot execute is_creator');
reset role;
set local role service_role;
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'service_role cannot read profiles (no grant)');
select throws_ok($$ select count(*) from public.technicians $$, '42501', null, 'service_role cannot read technicians (no grant)');
reset role;

-- Data keys are enforced on the data: technicians follow cal/calls (D33) ---------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_role_permission('customer_service', 'cal', false, 1, null);
select public.admin_set_role_permission('customer_service', 'calls', false, 1, null);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.technicians), 0::bigint,
  'with cal and calls off, Customer Service reads no technician rows immediately');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.technicians), 3::bigint,
  'the Manager''s fixed access to technicians does not depend on the Customer Service values');
reset role;

-- A role change takes effect immediately (D36) -----------------------------------------------------------
update public.profiles set role = 'technician' where id = '00000000-0000-4000-8000-0000000000a2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.profiles), 1::bigint, 'after a role change the former Manager reads only his own profile');
reset role;


-- Review T4: an inactive Creator reads nothing (every Creator policy and the census go through
-- is_creator(), which requires an active profile). It cannot arise through the API today (the last
-- active Creator is locked and nothing creates a second one), so it is inserted as postgres.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user-c2@example.test', now(), now());
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000c2', 'creator', 'יוצר לא פעיל', false, false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_creator(), false, 'T4: an inactive Creator is not the Creator');
select is(
  (select (select count(*) from public.profiles) + (select count(*) from public.technicians)
        + (select count(*) from public.permissions) + (select count(*) from public.role_permissions)
        + (select count(*) from public.account_requests) + (select count(*) from public.audit_logs)),
  0::bigint, 'T4: an inactive Creator reads 0 rows in every table');
select throws_ok($$ select * from public.test_data_census() $$, '42501', 'not authorized', 'T4: an inactive Creator cannot run the census');
reset role;

select * from finish();
rollback;
