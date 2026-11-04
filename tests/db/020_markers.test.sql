-- PR 1.3: test-data markers and integrity triggers (D47; docs/database-schema.md §1, §2, §8.4;
-- docs/testing.md categories 6, 7 and 12). Runs as postgres, so it also proves that the
-- triggers hold for the owner role where the design says "every role".
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures (local, rolled back). Auth users have no password; their metadata claims "creator" to
-- prove that roles never come from Auth metadata. Every profile is test data (is_test defaults to
-- true) except the bootstrapped Creator (D49) and b9, a real-marked target.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'a9', 'b1', 'b2', 'b9', 'd1', 'd2', 'd3', 'd4', 'd9', 'f1', 'f2']) as k;
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
  ('00000000-0000-4000-8000-0000000000b9', 'customer_service', 'נציגה אמיתית', true, false),
  ('00000000-0000-4000-8000-0000000000d9', 'technician', 'טכנאי אמיתי', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.account_requests (id, request_type, target_profile_id, target_version, requested_by, is_test) values
  ('00000000-0000-4000-8000-0000000000aa', 'reactivate', '00000000-0000-4000-8000-0000000000b2', 1,
   '00000000-0000-4000-8000-0000000000a1', true);

-- Markers: defaults and immutability ---------------------------------------------------------
select is((select is_test from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'), true,
  'profiles.is_test defaults to true (fails safe)');

select throws_ok(
  $$ insert into public.profiles (id, role, full_name, is_active) values ('00000000-0000-4000-8000-0000000000f1', 'creator', 'x', true) $$,
  '23514', null, 'a test Creator is impossible (CHECK profiles_no_test_creator)');

select throws_ok(
  $$ update public.profiles set is_test = false where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '55000', 'profiles: test-data markers are immutable (D47)', 'profiles.is_test cannot change, even as postgres');

select throws_ok(
  $$ update public.technicians set is_test = false where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '55000', 'technicians: test-data markers are immutable (D47)', 'technicians.is_test cannot change, even as postgres');

select throws_ok(
  $$ update public.account_requests set is_test = false where id = '00000000-0000-4000-8000-0000000000aa' $$,
  '55000', null, 'account_requests.is_test cannot change, even as postgres');

select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email)
     values ('00000000-0000-4000-8000-0000000000d3', false, 'x', 't-s', 'x@example.test') $$,
  '23503', null, 'technicians.is_test must equal the profile''s (composite foreign key)');

select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
     values ('activate', '00000000-0000-4000-8000-0000000000b9', 1, '00000000-0000-4000-8000-0000000000a1', true) $$,
  '23503', null, 'account_requests.is_test must equal the target''s (composite foreign key)');

-- Version ------------------------------------------------------------------------------------
update public.profiles set full_name = 'מנהל א שונה' where id = '00000000-0000-4000-8000-0000000000a1';
select is((select version from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'), 2,
  'version is raised by trigger on every update');

update public.profiles set version = 100 where id = '00000000-0000-4000-8000-0000000000a2';
select is((select version from public.profiles where id = '00000000-0000-4000-8000-0000000000a2'), 2,
  'a version written directly is replaced by old version + 1');

-- Email and shape rules ----------------------------------------------------------------------
select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email)
     values ('00000000-0000-4000-8000-0000000000d3', true, 'x', 't-s', 'someone@company.example') $$,
  '23514', null, 'a test Technician''s Outlook email must be in example.test (D47)');

select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email)
     values ('00000000-0000-4000-8000-0000000000d3', true, 'x', 't-s', 'Tech-C@Example.test') $$,
  '23514', null, 'Outlook emails are stored lower-case and trimmed');

select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
     values ('create', 'customer_service', 'new@company.example', 'x', '00000000-0000-4000-8000-0000000000a1', true) $$,
  '23514', null, 'TEMPORARY (owner question Q12): a test request''s sign-in email must be in example.test');

select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
     values ('create', 'technician', 'new@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', true) $$,
  '23514', null, 'a create request is for a Customer Service account only');

select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_role, requested_by, is_test)
     values ('role_change', '00000000-0000-4000-8000-0000000000b1', 1, 'manager', '00000000-0000-4000-8000-0000000000a1', true) $$,
  '23514', null, 'only a direct creation names the manager role: a request never asks for it (CHECK, §8.4 rule 4)');

select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
     values ('direct_create', 'technician', 'new@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', true) $$,
  '23514', null, 'a direct creation is never pending: it is authorized when it is stored');

-- Technician link (§8.4 rule 5) ----------------------------------------------------------------
select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email)
     values ('00000000-0000-4000-8000-0000000000b1', true, 'x', 't-s', 'cs@example.test') $$,
  '23514', 'technicians: the profile must have the technician role', 'a technicians row links only to a Technician profile');

select throws_ok(
  $$ update public.profiles set role = 'customer_service' where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '55000', 'profiles: a profile with a technician record keeps its role', 'a profile with a technicians row cannot change role');

select throws_ok(
  $$ update public.technicians set profile_id = '00000000-0000-4000-8000-0000000000d3' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '55000', null, 'technicians.profile_id is immutable');

-- No promotion to Creator; last Creator (D49, §8.4 rule 4) ------------------------------------
select throws_ok(
  $$ update public.profiles set role = 'creator' where id = '00000000-0000-4000-8000-0000000000b9' $$,
  '55000', 'profiles: no user is promoted to Creator (D49)', 'no profile is ever promoted to Creator, even as postgres');

select throws_ok(
  $$ update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '55000', 'profiles: the last active Creator cannot be demoted or deactivated', 'the last active Creator cannot be deactivated');

select throws_ok(
  $$ update public.profiles set role = 'manager' where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '55000', 'profiles: the last active Creator cannot be demoted or deactivated', 'the last active Creator cannot be demoted');

select throws_ok(
  $$ update public.profiles set id = '00000000-0000-4000-8000-0000000000f2' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '55000', null, 'profiles.id is immutable');
select throws_ok(
  $$ update public.profiles set created_by = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '55000', 'profiles: id and creation fields are immutable', 'profiles.created_by is immutable');
select throws_ok(
  $$ update public.profiles set created_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '55000', 'profiles: id and creation fields are immutable', 'profiles.created_at is immutable');

-- One-way rule (D47) -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.profiles (id, role, full_name, is_active, is_test, created_by)
     values ('00000000-0000-4000-8000-0000000000f1', 'customer_service', 'x', true, false, '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', 'profiles: a real record cannot reference a test profile (D47)', 'a real profile cannot reference a test creator of the row');

select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
     values ('activate', '00000000-0000-4000-8000-0000000000b9', 1, '00000000-0000-4000-8000-0000000000a1', false) $$,
  '23514', 'account_requests: a real record cannot reference a test profile (D47)', 'a real request cannot have a test requester');

select throws_ok(
  $$ update public.role_permissions set updated_by = '00000000-0000-4000-8000-0000000000a1' where role = 'manager' and permission_key = 'cal' $$,
  '23514', 'role_permissions: a real record cannot reference a test profile (D47)', 'matrix values (real configuration) cannot reference a test profile');

select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email, created_by)
     values ('00000000-0000-4000-8000-0000000000d9', false, 'x', 't-s', 'real-tech@company.example', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', 'technicians: a real record cannot reference a test profile (D47)', 'a real technician record cannot have a test creator');

-- audit_logs: a test actor on a real target is refused (the row is real because its target is).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select private.write_audit('profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000b9', '{}') $$,
  '23514', 'audit_logs: a real record cannot reference a test profile (D47)', 'an audit row on a real target cannot have a test actor');
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select private.write_audit('profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000b9', '{}') $$,
  '23514', null, 'an audit row without an actor is only the bootstrap row (CHECK audit_logs_actor_check)');

select lives_ok(
  $$ update public.profiles set updated_by = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-0000000000b1' $$,
  'a test record may reference a real one');

-- Account request transitions ------------------------------------------------------------------
select throws_ok(
  $$ update public.account_requests set email = 'x@example.test' where id = '00000000-0000-4000-8000-0000000000aa' $$,
  '55000', 'account_requests: request fields are immutable', 'request fields are immutable');

update public.account_requests set status = 'approved', decided_by = '00000000-0000-4000-8000-0000000000c1', decided_at = now()
where id = '00000000-0000-4000-8000-0000000000aa';
select throws_ok(
  $$ update public.account_requests set status = 'pending', decided_by = null, decided_at = null where id = '00000000-0000-4000-8000-0000000000aa' $$,
  '55000', 'account_requests: invalid status change', 'a decided request never returns to pending');
select throws_ok(
  $$ update public.account_requests set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000aa' $$,
  '55000', 'account_requests: invalid status change', 'an approved reactivation cannot be cancelled afterwards');

insert into public.account_requests (id, request_type, requested_role, email, full_name, requested_by, status, decided_by, decided_at, is_test) values
  ('00000000-0000-4000-8000-0000000000ab', 'direct_create', 'technician', 'new.tech@example.test', 'טכנאי חדש',
   '00000000-0000-4000-8000-0000000000a1', 'approved', '00000000-0000-4000-8000-0000000000a1', now(), true),
  ('00000000-0000-4000-8000-0000000000ac', 'create', 'customer_service', 'new.agent@example.test', 'נציגה חדשה',
   '00000000-0000-4000-8000-0000000000a1', 'pending', null, null, true);
select lives_ok(
  $$ update public.account_requests set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000ab' $$,
  'an approved creation that is not fulfilled yet can be cancelled (the decision fields stay)');
update public.account_requests set status = 'approved', decided_by = '00000000-0000-4000-8000-0000000000c1', decided_at = now()
where id = '00000000-0000-4000-8000-0000000000ac';
update public.account_requests set target_profile_id = '00000000-0000-4000-8000-0000000000d3'
where id = '00000000-0000-4000-8000-0000000000ac';
select throws_ok(
  $$ update public.account_requests set target_profile_id = '00000000-0000-4000-8000-0000000000d4' where id = '00000000-0000-4000-8000-0000000000ac' $$,
  '55000', 'account_requests: invalid status change', 'a fulfilled creation is never linked again');
select throws_ok(
  $$ update public.account_requests set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000000ac' $$,
  '55000', 'account_requests: invalid status change', 'R-S5: a fulfilled creation cannot be cancelled, even as postgres');
select throws_ok(
  $$ update public.account_requests set status = 'cancelled', target_profile_id = null where id = '00000000-0000-4000-8000-0000000000ac' $$,
  '55000', 'account_requests: invalid status change', 'R-S5: nor unlinked and cancelled');

-- One open creation per email and one pending request per account: the RPCs check first, so the
-- partial unique indexes are the only protection when two calls race (re-review R-S5).
insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by, decided_at, is_test)
values ('direct_create', 'technician', 'race@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', 'approved',
        '00000000-0000-4000-8000-0000000000a1', now(), true);
select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
     values ('create', 'customer_service', 'race@example.test', 'x', '00000000-0000-4000-8000-0000000000a2', true) $$,
  '23505', null, 'R-S5: a second open creation for the same email is refused by the unique index, even as postgres');
select throws_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by, decided_at, is_test)
     values ('direct_create', 'manager', 'race@example.test', 'x', '00000000-0000-4000-8000-0000000000c1', 'approved',
             '00000000-0000-4000-8000-0000000000c1', now(), true) $$,
  '23505', null, 'R-S5: also when both are approved direct creations');
select lives_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by, decided_at, is_test)
     values ('direct_create', 'technician', 'new.tech@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', 'approved',
             '00000000-0000-4000-8000-0000000000a1', now(), true) $$,
  'a cancelled creation does not hold its email (the index is partial)');
insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
values ('activate', '00000000-0000-4000-8000-0000000000b2', 1, '00000000-0000-4000-8000-0000000000a1', true);
select throws_ok(
  $$ insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
     values ('reactivate', '00000000-0000-4000-8000-0000000000b2', 1, '00000000-0000-4000-8000-0000000000a2', true) $$,
  '23505', null, 'R-S5: a second pending request for the same account is refused by the unique index, even as postgres');

-- No deletes (§1) and FK restrict --------------------------------------------------------------
select throws_ok($$ delete from public.profiles where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '55000', 'profiles: rows are never deleted', 'profiles rows are never deleted, even as postgres');
select throws_ok($$ delete from public.technicians where id = '00000000-0000-4000-8000-0000000000e2' $$,
  '55000', 'technicians: rows are never deleted', 'technicians rows are never deleted, even as postgres');
select throws_ok($$ delete from public.permissions where key = 'usage' $$,
  '55000', 'permissions: rows are never deleted', 'permission keys are never deleted, even as postgres');
select throws_ok($$ delete from public.role_permissions where role = 'manager' and permission_key = 'usage' $$,
  '55000', 'role_permissions: rows are never deleted', 'matrix values are never deleted, even as postgres');
select throws_ok($$ delete from public.account_requests where id = '00000000-0000-4000-8000-0000000000aa' $$,
  '55000', 'account_requests: rows are never deleted', 'account requests are never deleted, even as postgres');
select throws_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '23503', null, 'an Auth user with a profile cannot be deleted (ON DELETE RESTRICT)');

select * from finish();
rollback;
