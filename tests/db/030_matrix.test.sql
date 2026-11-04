-- PR 1.3: the permission matrix (D33, D51; docs/database-schema.md §8.1, §8.2, §8.4;
-- docs/testing.md category 4 "Matrix metadata"). Values are TEMPORARY until Step 10 (D51).
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- Fixtures (local, rolled back): see 020_markers.test.sql.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a9', 'b1', 'd1', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);

-- Catalogue and seeded values ------------------------------------------------------------------
select results_eq(
  $$ select key, enforcement from public.permissions order by sort_order $$,
  $$ values ('cal', 'screen'), ('calls', 'data'), ('card', 'data'), ('cancel', 'data'), ('dashGen', 'screen'),
            ('dashTech', 'screen'), ('dashProd', 'screen'), ('export', 'screen'), ('settings', 'data'),
            ('usage', 'screen'), ('products', 'data'), ('conflicts', 'data'), ('recordings', 'data') $$,
  'the catalogue holds exactly the 13 D33 keys with their enforcement (data or screen)');

select throws_ok(
  $$ insert into public.permissions (key, label_he, enforcement, sort_order) values ('matrix', 'עריכת הרשאות', 'data', 99) $$,
  '23514', null, 'a fixed capability can never become a key (closed catalogue CHECK)');

select results_eq(
  $$ select role, permission_key, allowed from public.role_permissions rp
     join public.permissions k on k.key = rp.permission_key order by rp.role, k.sort_order $$,
  $$ values
     ('customer_service', 'cal', true), ('customer_service', 'calls', true), ('customer_service', 'card', true),
     ('customer_service', 'cancel', false), ('customer_service', 'dashGen', false), ('customer_service', 'dashTech', false),
     ('customer_service', 'dashProd', false), ('customer_service', 'export', false), ('customer_service', 'settings', false),
     ('customer_service', 'usage', false), ('customer_service', 'products', false), ('customer_service', 'conflicts', false),
     ('customer_service', 'recordings', false),
     ('manager', 'cal', true), ('manager', 'calls', true), ('manager', 'card', true), ('manager', 'cancel', true),
     ('manager', 'dashGen', true), ('manager', 'dashTech', true), ('manager', 'dashProd', true), ('manager', 'export', true),
     ('manager', 'settings', false), ('manager', 'usage', false), ('manager', 'products', true),
     ('manager', 'conflicts', true), ('manager', 'recordings', true) $$,
  'the 26 seeded values equal the D33 defaults');

select is(
  (select count(*) from public.role_permissions where value_status = 'temporary' and approved_by is null and approved_at is null),
  26::bigint, 'every seeded value is TEMPORARY (D51) and unapproved');

select throws_ok(
  $$ insert into public.role_permissions (role, permission_key, allowed) values ('creator', 'cal', true) $$,
  '23514', null, 'the Creator is never in the matrix (role CHECK)');
select throws_ok(
  $$ insert into public.role_permissions (role, permission_key, allowed) values ('technician', 'cal', true) $$,
  '23514', null, 'Technician capabilities are fixed, never in the matrix (role CHECK)');
select throws_ok(
  $$ update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'cancel' $$,
  '23514', null, 'TEMPORARY: Customer Service cancel stays off until d08, even as postgres');
select throws_ok(
  $$ update public.role_permissions set allowed = true where role = 'manager' and permission_key = 'usage' $$,
  '23514', null, 'TEMPORARY: usage stays off until d13, even as postgres');

-- has_permission per role -----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select k.key, public.has_permission(k.key) from public.permissions k order by k.sort_order $$,
  $$ values ('cal', true), ('calls', true), ('card', true), ('cancel', true), ('dashGen', true), ('dashTech', true),
            ('dashProd', true), ('export', true), ('settings', true), ('usage', false), ('products', true),
            ('conflicts', true), ('recordings', true) $$,
  'Creator: every key (TEMPORARY: usage denied until d13)');
select is(public.has_permission('no_such_key'), false, 'Creator: an unknown key is denied');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select k.key, public.has_permission(k.key) from public.permissions k order by k.sort_order $$,
  $$ select rp.permission_key, rp.allowed from public.role_permissions rp join public.permissions k on k.key = rp.permission_key
     where rp.role = 'manager' order by k.sort_order $$,
  'Manager: has_permission follows the matrix');
select is(public.has_permission('settings'), false, 'Manager: settings is off by default');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select k.key from public.permissions k where public.has_permission(k.key) order by k.sort_order $$,
  $$ values ('cal'), ('calls'), ('card') $$,
  'Customer Service: cal, calls and card only');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from unnest(array['cal', 'calls', 'card', 'cancel', 'dashGen', 'dashTech', 'dashProd', 'export',
  'settings', 'usage', 'products', 'conflicts', 'recordings']) k where public.has_permission(k)), 0::bigint,
  'Technician: no matrix key (fixed capabilities)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('calls'), false, 'a deactivated Manager has no permission');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('calls'), false, 'a signed-in user without a profile has no permission');
reset role;

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.has_permission('calls') $$, '42501', null, 'anon cannot execute has_permission');
reset role;

-- admin_set_role_permission (Creator only, immediate, audited) -----------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'export', true, 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot change the matrix');
select throws_ok($$ select public.admin_set_role_permission('manager', 'settings', true, 1, null) $$,
  '42501', 'not authorized', 'a Manager cannot grant himself a key');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'export', true, 1, null) $$,
  '42501', 'not authorized', 'Customer Service cannot change the matrix');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'export', true, 1, null) $$,
  '42501', 'not authorized', 'a Technician cannot change the matrix');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('customer_service', 'export', true, 1, 'בדיקה'), 2,
  'the Creator changes a value; the new version is returned');
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'export', false, 1, null) $$,
  'PT409', 'version conflict', 'a stale expected_version is a conflict (HTTP 409)');
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'no_such_key', true, 1, null) $$,
  '22023', 'invalid input', 'an unknown key is rejected');
select throws_ok($$ select public.admin_set_role_permission('creator', 'cal', false, 1, null) $$,
  '22023', 'invalid input', 'the Creator role is not in the matrix');
select throws_ok($$ select public.admin_set_role_permission('technician', 'cal', true, 1, null) $$,
  '22023', 'invalid input', 'the Technician role is not in the matrix');
select throws_ok($$ select public.admin_set_role_permission('customer_service', 'cancel', true, 1, null) $$,
  '55000', null, 'TEMPORARY: Customer Service cancel cannot be granted until d08');
select throws_ok($$ select public.admin_set_role_permission('manager', 'usage', true, 1, null) $$,
  '55000', null, 'TEMPORARY: usage cannot be granted until d13');
reset role;

select is(
  (select count(*) from public.audit_logs
   where action = 'matrix.value_set' and target_table = 'role_permissions' and target_id is null
     and actor_profile_id = '00000000-0000-4000-8000-0000000000c1' and not target_is_test
     and details = '{"key": "export", "to": true, "from": false, "role": "customer_service", "reason": "בדיקה"}'::jsonb),
  1::bigint, 'the change is audited in the same transaction (actor, role, key, from, to, reason)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('export'), true, 'the change is effective immediately for Customer Service');
reset role;

-- admin_approve_role_permission (D51). TEMPORARY (owner question Q6): no API role may execute it
-- until the owner decides who approves the final values and when (Step 10). Its rules are tested
-- as the owner's database role with the caller's claims (rolled back).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_approve_role_permission('manager', 'cal', 1) $$,
  '42501', null, 'TEMPORARY (Q6): even the Creator cannot execute the approval through the API yet');
select throws_ok($$ select private.admin_approve_role_permission('manager', 'cal', 1) $$,
  '42501', null, 'TEMPORARY (Q6): the private body is not executable either');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select private.admin_approve_role_permission('manager', 'cal', 1) $$,
  '42501', 'not authorized', 'the body itself refuses a Manager');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$ select private.admin_approve_role_permission('manager', 'cal', 1) $$,
  '42501', 'not authorized', 'the body itself refuses Customer Service');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is(private.admin_approve_role_permission('manager', 'cal', 1), 2, 'the Creator''s session marks a value approved');
select throws_ok($$ select private.admin_approve_role_permission('manager', 'cal', 2) $$,
  '55000', 'value already approved', 'an approved value cannot be approved again');
select set_config('request.jwt.claims', '', true);

select ok(
  (select value_status = 'approved' and approved_by = '00000000-0000-4000-8000-0000000000c1' and approved_at is not null
   from public.role_permissions where role = 'manager' and permission_key = 'cal'),
  'approval stores status, approver and time');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('manager', 'cal', false, 2, null), 3, 'the Creator changes an approved value');
reset role;

select ok(
  (select value_status = 'temporary' and approved_by is null and approved_at is null and not allowed
   from public.role_permissions where role = 'manager' and permission_key = 'cal'),
  'any change makes the value temporary again until approved (D51)');

select is(
  (select count(*) from public.audit_logs where action = 'matrix.value_approved'
     and details = '{"key": "cal", "role": "manager", "allowed": true}'::jsonb),
  1::bigint, 'the approval is audited');

-- A key introduced later is denied unless approved (D51). The CHECKs are dropped only inside
-- this rolled-back transaction to simulate a future migration that adds a key.
alter table public.permissions drop constraint permissions_key_check;
alter table public.permissions drop constraint permissions_enforcement_by_key;
insert into public.permissions (key, label_he, enforcement, sort_order) values ('zz_future', 'מפתח עתידי', 'screen', 99);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('zz_future'), false, 'a key added later is denied to the Manager (no value)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_permission('zz_future'), false, 'a key added later is denied to Customer Service (no value)');
reset role;
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'role_permissions' and column_name = 'allowed'), 'false',
  'a new matrix value defaults to denied');

-- Direct writes: denied for every API role (§8.4 rule 1) ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.role_permissions set allowed = true where role = 'manager' and permission_key = 'settings' $$,
  '42501', null, 'the Creator cannot write role_permissions directly (RPC only)');
select throws_ok($$ insert into public.permissions (key, label_he, enforcement, sort_order) values ('cal2', 'x', 'screen', 50) $$,
  '42501', null, 'the Creator cannot write permissions directly');
select throws_ok($$ delete from public.role_permissions $$, '42501', null, 'authenticated cannot delete matrix values');
reset role;

select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok($$ update public.role_permissions set allowed = true where role = 'manager' and permission_key = 'settings' $$,
  '42501', null, 'service_role cannot write role_permissions');
select throws_ok($$ select public.admin_set_role_permission('manager', 'settings', true, 1, null) $$,
  '42501', null, 'service_role cannot execute the matrix RPC');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.role_permissions $$, '42501', null, 'anon cannot read the matrix');
reset role;

select * from finish();
rollback;
