-- PR 1.3: private.bootstrap_first_creator (D49; docs/database-schema.md §8.5). Created by the
-- migration, never run by it. Locally it runs only inside this rolled-back transaction (owner question Q3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select is((select count(*) from public.profiles where role = 'creator'), 0::bigint,
  'the migration did not create a Creator');
select is((select count(*) from public.audit_logs where action = 'creator.bootstrapped'), 0::bigint,
  'the migration did not run the bootstrap');

select ok(
  not has_function_privilege('anon', 'private.bootstrap_first_creator(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.bootstrap_first_creator(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'private.bootstrap_first_creator(uuid,text)', 'execute'),
  'no API role can execute bootstrap_first_creator');
select is(
  (select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'private.bootstrap_first_creator(uuid,text)'::regprocedure and a.grantee <> p.proowner),
  0::bigint, 'only the owner holds EXECUTE on bootstrap_first_creator');
select ok(not (select prosecdef from pg_proc where oid = 'private.bootstrap_first_creator(uuid,text)'::regprocedure),
  'bootstrap_first_creator is SECURITY INVOKER (it runs with the owner''s own rights)');

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test', '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'c2', 'a1']) as k;
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000a1', 'x') $$,
  '42501', null, 'an authenticated user cannot run the bootstrap');
reset role;
select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר') $$,
  '42501', 'not authorized', 'the bootstrap refuses to run while JWT claims are present');
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר') $$,
  '42501', 'not authorized', 'the bootstrap refuses to run with a legacy JWT sub claim');
select set_config('request.jwt.claim.sub', '', true);

select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000ff', 'יוצר') $$,
  '22023', 'unknown user', 'the bootstrap fails for a user that does not exist');
select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000a1', 'יוצר') $$,
  '55000', 'the user already has a profile', 'the bootstrap never promotes an existing profile');

select is(private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר'),
  '00000000-0000-4000-8000-0000000000c1'::uuid, 'the owner''s database role runs the bootstrap once');
select ok(
  (select role = 'creator' and is_active and not is_test and created_by is null
   from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'the first Creator is an active, real (not test) profile (D49)');
select ok(
  exists (select 1 from public.audit_logs where action = 'creator.bootstrapped' and actor_profile_id is null
            and target_id = '00000000-0000-4000-8000-0000000000c1' and not target_is_test),
  'the bootstrap is audited');
select throws_ok($$ select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c2', 'יוצר נוסף') $$,
  '55000', 'a Creator already exists', 'a second run fails because a Creator exists');
select is((select count(*) from public.profiles where role = 'creator'), 1::bigint, 'exactly one Creator exists');
select is(private.audit_chain_verify(), null::bigint, 'the audit chain verifies after the bootstrap');

select * from finish();
rollback;
