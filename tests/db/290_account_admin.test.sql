-- PR 1.8: account administration under D60 (7) (M-06, M-10, C-01; docs/review/step1-pr18/README.md
-- sections 4 and 7; docs/security.md §5; docs/testing.md categories 2 and 4). Every call runs as
-- `authenticated` with the caller's JWT claims, as PostgREST does. Per caller:
--   - the Manager creates (both phases), edits, activates and deactivates Technician and Customer
--     Service accounts directly, with no Creator approval; he never acts on a Manager or the
--     Creator, never on his own account, never deletes, never changes a role, never sets a password
--     or an email, and a test Manager never touches a real account (D47);
--   - the Creator manages every role, changes roles (a role change grants exactly the new role's
--     capabilities), and deletes per Option A: the account becomes inactive and marked deleted,
--     audited; never his own account and never a Creator account (TEMPORARY OQ-1);
--   - a deleted Technician stops receiving new work: the deletion turns his field profile's
--     "פעיל" (accepts_invitations) off, audited, and it stays off (independent review S-2);
--   - a deleted account is never activated, edited, given a role or credentials again (the
--     reactivation guard; OQ-2); its user reads nothing and runs nothing (the database side of "no
--     sign-in"; the Auth side is Step 2's); its history and attribution stay (the rows that
--     reference it, its name and its field profile); the Creator and, for Technician and Customer
--     Service accounts, the Manager still read it (OQ-3, OQ-8);
--   - Customer Service, a Technician, a deactivated user, a deleted user, a user without a profile,
--     anon and service_role manage no account.
-- The retired request path: 050. The schema and the triggers as the owner's role: 280.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Fixtures (local, rolled back): see 020_markers.test.sql. a9, b2 and d2 are deactivated; a8 and b8
-- real-marked; c2 a second, real Creator inserted as postgres only to show that a Creator account is
-- never deleted (nothing in the app creates one, D49); f1 to f4 are Auth users without a profile
-- for the creations, f9 one that never gets a profile. d3 has a field profile and a scheduled visit
-- (the history that a deletion keeps).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now() - interval '1 hour', now() - interval '1 hour'
from unnest(array['c1', 'c2', 'a1', 'a2', 'a8', 'a9', 'b1', 'b2', 'b3', 'b8', 'd1', 'd2', 'd3', 'd4', 'f9']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000d4', 'technician', 'טכנאי ללא כרטיס', true);
-- b3 and d3 were created by the Manager a2 (created_by keeps that attribution after his deletion).
insert into public.profiles (id, role, full_name, work_phone, is_active, created_by, updated_by) values
  ('00000000-0000-4000-8000-0000000000b3', 'customer_service', 'נציגה למחיקה', '03-000-0290', true,
   '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000000d3', 'technician', 'טכנאי למחיקה', null, true,
   '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2');
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000c2', 'creator', 'יוצר ב', true, false),
  ('00000000-0000-4000-8000-0000000000a8', 'manager', 'מנהל אמיתי', true, false),
  ('00000000-0000-4000-8000-0000000000b8', 'customer_service', 'נציגה אמיתית', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי לא פעיל', 't-e', 'tech-b@example.test'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000d3', true, 'טכנאי למחיקה', 't-s', 'tech-c@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000029c1', 'C-29001', 'לקוח בדיקה', '050-000-2901', 'automated_test', 'pr18-290-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000029d1', 'RB-29001', 'RB-29001', 'מוצר בדיקה', 'automated_test', 'pr18-290-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
  select '00000000-0000-4000-8000-0000000029a1', 'R-29001', '00000000-0000-4000-8000-0000000029c1',
         '00000000-0000-4000-8000-0000000029d1', t.id, 'תקלת בדיקה', 'נציגת בדיקה', 'open', 2, 'automated_test', 'pr18-290-1'
  from public.call_types t where t.sort_order = 1;
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
  values ('00000000-0000-4000-8000-0000000029b1', '00000000-0000-4000-8000-0000000029a1', '00000000-0000-4000-8000-0000000000e3',
          1, 'T-29001', now() + interval '1 day', now() + interval '1 day 2 hours', 'scheduled', 'עיר בדיקה', 'רחוב בדיקה',
          'pr18-290-1');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-0000000029b1', 1, 'created', 'scheduled');

-- Helpers (pg_temp, rolled back): the outcome of one statement ('ok' plus its first value, or the
-- SQLSTATE and message), and the account actions run by the current caller.
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
-- Every account function once, against a Customer Service account (b1), a Technician (d1, e1),
-- d4 (no field profile) and f9 (no profile). A caller who manages no account is refused by each
-- before any input or target is looked at.
create function pg_temp.tm_all_actions()
returns table (action text, outcome text)
language sql
as $f$
  select v.action, pg_temp.tm_try(v.q) from (values
    (1, 'assert_can_manage', $q$ select public.assert_can_manage('technician') $q$),
    (2, 'authorize_account_creation', $q$ select public.authorize_account_creation('technician', 'probe@example.test', 'x') $q$),
    (3, 'admin_create_profile', $q$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f9', 'technician', 'x', null, null, '00000000-0000-4000-8000-0000000000f9') $q$),
    (4, 'admin_set_user_active', $q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', false, 1, null) $q$),
    (5, 'admin_update_profile', $q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000b1', 1, 'x', null, null) $q$),
    (6, 'admin_set_user_role', $q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'technician', 1, null) $q$),
    (7, 'admin_delete_user', $q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b1', 1, null) $q$),
    (8, 'assert_can_change_credentials', $q$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b1', 'password') $q$),
    (9, 'admin_create_technician', $q$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000d4', 'x', 't-s', 'probe-o@example.test', null, true) $q$),
    (10, 'admin_update_technician', $q$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e1', 1, 'x', 't-y', 'tech-a@example.test', null, true) $q$)
  ) v (n, action, q)
  order by v.n
$f$;
create function pg_temp.tm_refused(p_message text)
returns table (action text, outcome text)
language sql
as $f$
  select v.action, '42501 ' || replace(p_message, '%', v.action) from (values
    (1, 'assert_can_manage'), (2, 'authorize_account_creation'), (3, 'admin_create_profile'), (4, 'admin_set_user_active'),
    (5, 'admin_update_profile'), (6, 'admin_set_user_role'), (7, 'admin_delete_user'), (8, 'assert_can_change_credentials'),
    (9, 'admin_create_technician'), (10, 'admin_update_technician')) v (n, action)
  order by v.n
$f$;
-- What a Manager must never do (D60 (7), D34 e, D47).
create function pg_temp.tm_manager_never()
returns table (action text, outcome text)
language sql
as $f$
  select v.action, pg_temp.tm_try(v.q) from (values
    (1, 'create a Manager', $q$ select public.authorize_account_creation('manager', 'new-manager@example.test', 'x') $q$),
    (2, 'create a Creator', $q$ select public.authorize_account_creation('creator', 'new-creator@example.test', 'x') $q$),
    (3, 'manage Managers', $q$ select public.assert_can_manage('manager') $q$),
    (4, 'deactivate a Manager', $q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a2', false, 1, null) $q$),
    (5, 'deactivate the Creator', $q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000c1', false, 1, null) $q$),
    (6, 'deactivate himself', $q$ select public.admin_set_user_active(auth.uid(), false, 1, null) $q$),
    (7, 'edit a Manager', $q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000a2', 1, 'x', null, null) $q$),
    (8, 'edit the Creator', $q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000c1', 1, 'x', null, null) $q$),
    (9, 'edit himself', $q$ select public.admin_update_profile(auth.uid(), 1, 'x', null, null) $q$),
    (10, 'change a Customer Service role', $q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'technician', 1, null) $q$),
    (11, 'promote to Manager', $q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'manager', 1, null) $q$),
    (12, 'change a Technician role', $q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000d4', 'customer_service', 1, null) $q$),
    (13, 'delete Customer Service', $q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b1', 1, null) $q$),
    (14, 'delete a Technician', $q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000d1', 1, null) $q$),
    (15, 'set a password', $q$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b1', 'password') $q$),
    (16, 'change an email', $q$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000d1', 'email') $q$)
  ) v (n, action, q)
  order by v.n
$f$;
grant execute on function pg_temp.tm_try(text), pg_temp.tm_all_actions(), pg_temp.tm_refused(text), pg_temp.tm_manager_never()
  to anon, authenticated, service_role;
create function pg_temp.tm_mark()
returns text
language sql
as $f$ select set_config('tm_test.audit_mark', (select coalesce(max(a.id), 0) from public.audit_logs a)::text, true) $f$;
create function pg_temp.tm_audit()
returns table (action text, target text, target_is_test boolean, actor text, details jsonb)
language sql
as $f$
  select a.action, right(a.target_id::text, 2), a.target_is_test, right(a.actor_profile_id::text, 2), a.details
  from public.audit_logs a
  where a.id > coalesce(nullif(current_setting('tm_test.audit_mark', true), ''), '0')::bigint
    and a.target_table in ('profiles', 'technicians', 'account_requests')
  order by a.id
$f$;

-- =================================================================================================
-- A. Callers who manage no account: every account function refuses them first.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('not authorized') $$,
  'Customer Service manages no account (all ten account functions: 42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('not authorized') $$,
  'a Technician manages no account');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('not authorized') $$,
  'a deactivated Manager manages no account');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f9","role":"authenticated","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('not authorized') $$,
  'a signed-in user without a profile, with forged Creator claims, manages no account');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('permission denied for function %') $$,
  'anon: no EXECUTE on any account function');
reset role;
set local role service_role;
select results_eq($$ select * from pg_temp.tm_all_actions() $$, $$ select * from pg_temp.tm_refused('permission denied for function %') $$,
  'service_role: no EXECUTE on any account function (no Auth admin path around the database checks)');
reset role;

-- =================================================================================================
-- B. The Manager: what he never does, test and real (D60 (7), D34 e).
-- =================================================================================================
create function pg_temp.tm_manager_never_expected()
returns table (action text, outcome text)
language sql
as $f$
  select v.action, '42501 not authorized' from (values
    (1, 'create a Manager'), (2, 'create a Creator'), (3, 'manage Managers'), (4, 'deactivate a Manager'),
    (5, 'deactivate the Creator'), (6, 'deactivate himself'), (7, 'edit a Manager'), (8, 'edit the Creator'), (9, 'edit himself'),
    (10, 'change a Customer Service role'), (11, 'promote to Manager'), (12, 'change a Technician role'),
    (13, 'delete Customer Service'), (14, 'delete a Technician'), (15, 'set a password'), (16, 'change an email')) v (n, action)
  order by v.n
$f$;
grant execute on function pg_temp.tm_manager_never_expected() to authenticated;
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_manager_never() $$, $$ select * from pg_temp.tm_manager_never_expected() $$,
  'a test Manager never creates or acts on a Manager or the Creator, never acts on himself, never changes a role, never deletes, never sets a password or an email');
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b8', false, 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000b8', 1, 'x', null, null) $q$)) $$,
  $$ values ('42501 not authorized', '42501 not authorized') $$,
  'a test Manager never touches a real account (D47)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_manager_never() $$, $$ select * from pg_temp.tm_manager_never_expected() $$,
  'a real-marked Manager is refused the same by the role rules themselves (not by the test-user rule)');
reset role;
select ok(
  (select count(*) = 0 from pg_temp.tm_audit())
  and (select bool_and(is_active and deleted_at is null and version = 1) from public.profiles
       where id in ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b1',
                    '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d1',
                    '00000000-0000-4000-8000-0000000000b8'))
  and (select role = 'customer_service' from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  'B: the refused calls changed no account and wrote no audit row');

-- =================================================================================================
-- C. The Manager creates Technician and Customer Service accounts directly (D60 (7), M-06):
--    phase 1 (intent), phase 2 simulated (the Auth user with the intent id), phase 3 (profile).
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.assert_can_manage('customer_service') $$, 'the Manager manages Customer Service accounts');
select lives_ok($$ select set_config('tm_test.intent_cs', public.authorize_account_creation('customer_service', 'new-agent@example.test', 'נציגה חדשה')::text, true) $$,
  'phase 1: the Manager authorizes a Customer Service creation, with no Creator approval (D60 (7))');
select lives_ok($$ select set_config('tm_test.intent_tech', public.authorize_account_creation('technician', 'new-tech@example.test', 'טכנאי חדש')::text, true) $$,
  'phase 1: the Manager authorizes a Technician creation');
reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'new-agent@example.test', jsonb_build_object('provider', 'email', 'account_request_id', current_setting('tm_test.intent_cs')), now(), now()),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'new-tech@example.test', jsonb_build_object('provider', 'email', 'account_request_id', current_setting('tm_test.intent_tech')), now(), now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'technician', 'x', null, null,
     current_setting('tm_test.intent_cs')::uuid) $$,
  '42501', 'not authorized', 'phase 3 binds only the authorized role');
select is(public.admin_create_profile('00000000-0000-4000-8000-0000000000f1', 'customer_service', '', '03-000-0291', 'נציגה חדשה',
            current_setting('tm_test.intent_cs')::uuid),
  '00000000-0000-4000-8000-0000000000f1'::uuid, 'phase 3: the Manager creates the Customer Service account (D60 (7), M-06)');
select is(public.admin_create_profile('00000000-0000-4000-8000-0000000000f2', 'technician', 'טכנאי חדש', null, null,
            current_setting('tm_test.intent_tech')::uuid),
  '00000000-0000-4000-8000-0000000000f2'::uuid, 'phase 3: the Manager creates the Technician account');
select lives_ok($$ select public.admin_create_technician('00000000-0000-4000-8000-0000000000f2', 'טכנאי חדש', 't-y', 'new-tech-o@example.test', null, true) $$,
  'the Manager adds the Technician''s field profile (phone, Outlook email, colour, "פעיל": C-01)');
reset role;
select ok(
  (select role = 'customer_service' and is_active and is_test and created_by = '00000000-0000-4000-8000-0000000000a1'
          and full_name = 'נציגה חדשה' and work_phone = '03-000-0291' and deleted_at is null
   from public.profiles where id = '00000000-0000-4000-8000-0000000000f1')
  and (select role = 'technician' and is_active and is_test from public.profiles where id = '00000000-0000-4000-8000-0000000000f2')
  and (select count(*) = 2 from public.account_requests
       where id in (current_setting('tm_test.intent_cs')::uuid, current_setting('tm_test.intent_tech')::uuid)
         and target_profile_id is not null and status = 'approved'),
  'both accounts are active test accounts created by the Manager and bound to their intents');
select results_eq($$ select * from pg_temp.tm_audit() $$,
  $$ select * from (values
       ('account_creation.authorized'::text, right(current_setting('tm_test.intent_cs'), 2), true, 'a1'::text,
        '{"actor_role": "manager", "requested_role": "customer_service"}'::jsonb),
       ('account_creation.authorized', right(current_setting('tm_test.intent_tech'), 2), true, 'a1',
        '{"actor_role": "manager", "requested_role": "technician"}'::jsonb),
       ('profile.created', 'f1', true, 'a1', jsonb_build_object('role', 'customer_service', 'request_id', current_setting('tm_test.intent_cs'))),
       ('profile.created', 'f2', true, 'a1', jsonb_build_object('role', 'technician', 'request_id', current_setting('tm_test.intent_tech'))),
       ('technician.created', (select right(t.id::text, 2) from public.technicians t where t.profile_id = '00000000-0000-4000-8000-0000000000f2'),
        true, 'a1', '{"profile_id": "00000000-0000-4000-8000-0000000000f2"}'::jsonb)) x $$,
  'C: each phase is audited with the Manager as actor (intent, profile, field profile)');

-- =================================================================================================
-- D. The Manager edits, activates and deactivates Technician and Customer Service accounts
--    directly (D60 (7)); a deactivated user reads nothing and runs nothing.
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_update_profile('00000000-0000-4000-8000-0000000000b1', 1, 'נציגה א מעודכנת', '03-000-0001', 'נציגה א'),
             public.admin_update_profile('00000000-0000-4000-8000-0000000000d1', 1, 'טכנאי א מעודכן', '050-000-0001', null),
             public.admin_update_technician('00000000-0000-4000-8000-0000000000e1', 1, 'טכנאי א מעודכן', 't-e', 'tech-a@example.test', 'מכשיר א', true)) $$,
  $$ values (2, 2, 2) $$, 'the Manager edits a Customer Service account, a Technician account and its field profile (D34 d)');
select results_eq(
  $$ values (public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', false, 2, 'עזבה'),
             public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', true, 3, 'חזרה'),
             public.admin_set_user_active('00000000-0000-4000-8000-0000000000b2', true, 1, null),
             public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', true, 1, null),
             public.admin_set_user_active('00000000-0000-4000-8000-0000000000d1', false, 2, 'טלפון אבד')) $$,
  $$ values (3, 4, 2, 2, 3) $$,
  'the Manager deactivates and reactivates Customer Service accounts and activates a Technician immediately, with no request (D60 (7) supersedes D34 a)');
reset role;
select results_eq($$ select * from pg_temp.tm_audit() $$,
  $$ values ('profile.updated'::text, 'b1'::text, true, 'a1'::text, '{"fields": ["full_name", "work_phone", "invitation_rep_name"]}'::jsonb),
            ('profile.updated', 'd1', true, 'a1', '{"fields": ["full_name", "work_phone"]}'::jsonb),
            ('technician.updated', 'e1', true, 'a1', '{"fields": ["display_name", "color", "device_label"]}'::jsonb),
            ('profile.deactivated', 'b1', true, 'a1', '{"reason": "עזבה", "actor_role": "manager"}'::jsonb),
            ('profile.activated', 'b1', true, 'a1', '{"reason": "חזרה", "actor_role": "manager"}'::jsonb),
            ('profile.activated', 'b2', true, 'a1', '{"actor_role": "manager"}'::jsonb),
            ('profile.activated', 'd2', true, 'a1', '{"actor_role": "manager"}'::jsonb),
            ('profile.deactivated', 'd1', true, 'a1', '{"reason": "טלפון אבד", "actor_role": "manager"}'::jsonb) $$,
  'D: every edit, activation and deactivation is audited with the Manager as actor (the Creator''s notice reads these rows, Step 2)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values ((select count(*) from public.profiles) + (select count(*) from public.technicians) + (select count(*) from public.visits)
             + (select count(*) from public.permissions), public.has_permission('calls'), public.my_technician_id()) $$,
  $$ values (0::bigint, false, null::uuid) $$,
  'M-06: a deactivated user reads nothing and has no permission or technician id (revocation is immediate)');
reset role;

-- =================================================================================================
-- E. Role changes: the Creator only (D60 (7)); a role change grants exactly the new role's
--    capabilities (C-01).
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_user_role('00000000-0000-4000-8000-0000000000b2', 'manager', 2, 'קידום'),
             public.admin_set_user_role('00000000-0000-4000-8000-0000000000f1', 'technician', 1, 'העברה')) $$,
  $$ values (3, 2) $$, 'the Creator changes roles (Customer Service to Manager, Customer Service to Technician)');
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'creator', 4, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000c1', 'manager', 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000d3', 'customer_service', 1, null) $q$)) $$,
  $$ values ('42501 not authorized', '42501 not authorized', '55000 profiles: a profile with a technician record keeps its role') $$,
  'nobody is promoted to Creator (D49); the Creator keeps his own role; a Technician with a field profile keeps his (PR 1.3 rules kept)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select k.key, public.has_permission(k.key) from public.permissions k order by k.sort_order $$,
  $$ select rp.permission_key, rp.allowed and rp.permission_key <> 'usage' from public.role_permissions rp
     join public.permissions k on k.key = rp.permission_key where rp.role = 'manager' order by k.sort_order $$,
  'C-01: after the change to Manager the account has exactly the Manager''s matrix values (never usage)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values ((select count(*) from public.permissions k where public.has_permission(k.key)), public.my_technician_id(),
             (select count(*) from public.visits)) $$,
  $$ values (0::bigint, null::uuid, 0::bigint) $$,
  'C-01: after the change to Technician (no field profile yet) the account has no matrix key, no technician id and reads no visit');
reset role;

-- =================================================================================================
-- F. Deletion, Option A (D60 (7); C-01, M-10): the Creator only.
-- =================================================================================================
select pg_temp.tm_mark();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ values (public.my_technician_id(), (select count(*) from public.visits)) $$,
  $$ values ('00000000-0000-4000-8000-0000000000e3'::uuid, 1::bigint) $$,
  'positive control: before the deletion the Technician d3 reads his scheduled visit');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000c1', 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000c2', 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-00000000ffff', 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user(null, 1, null) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b3', null, null) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b3', 1, repeat('x', 301)) $q$),
             pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b3', 7, null) $q$)) $$,
  $$ values ('42501 not authorized', '42501 not authorized', '42501 not authorized', '22023 invalid input', '22023 invalid input',
             '22023 invalid input', 'PT409 version conflict') $$,
  'the Creator never deletes his own account or a Creator account (OQ-1); an unknown id is the generic 42501; input and version are checked');
select results_eq(
  $$ values (public.admin_delete_user('00000000-0000-4000-8000-0000000000b3', 1, 'עזבה את החברה'),
             public.admin_delete_user('00000000-0000-4000-8000-0000000000d3', 1, null),
             public.admin_delete_user('00000000-0000-4000-8000-0000000000a2', 1, 'עזב')) $$,
  $$ values (2, 2, 2) $$,
  'the Creator deletes a Customer Service account, a Technician and a Manager (C-01: every role but Creator); the new version is returned');
select is(pg_temp.tm_try($q$ select public.admin_delete_user('00000000-0000-4000-8000-0000000000b3', 2, null) $q$),
  '55000 the account is deleted', 'a deleted account cannot be deleted again');
reset role;
select results_eq(
  $$ select right(p.id::text, 2), p.is_active, p.deleted_at = now(), right(p.deleted_by::text, 2), p.full_name, p.version
     from public.profiles p where p.deleted_at is not null order by p.id $$,
  $$ values ('a2'::text, false, true, 'c1'::text, 'מנהל ב'::text, 2), ('b3', false, true, 'c1', 'נציגה למחיקה', 2),
            ('d3', false, true, 'c1', 'טכנאי למחיקה', 2) $$,
  'each deleted account is inactive, marked deleted by the Creator at server time, and keeps its name (no row removed)');
select results_eq($$ select * from pg_temp.tm_audit() $$,
  $$ values ('profile.deleted'::text, 'b3'::text, true, 'c1'::text,
             '{"role": "customer_service", "reason": "עזבה את החברה", "was_active": true}'::jsonb),
            ('technician.updated', 'e3', true, 'c1', '{"cause": "profile.deleted", "fields": ["accepts_invitations"]}'::jsonb),
            ('profile.deleted', 'd3', true, 'c1', '{"role": "technician", "was_active": true}'::jsonb),
            ('profile.deleted', 'a2', true, 'c1', '{"role": "manager", "reason": "עזב", "was_active": true}'::jsonb) $$,
  'F: each deletion is audited once (profile.deleted, the role, whether it was active, the reason), the Technician''s "פעיל" change too (S-2); refusals wrote nothing');
select results_eq(
  $$ select right(t.id::text, 2), t.accepts_invitations, t.version, coalesce(right(t.updated_by::text, 2), '-')
     from public.technicians t
     where t.id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3')
     order by t.id $$,
  $$ values ('e1'::text, true, 2, 'a1'::text), ('e2', true, 1, '-'), ('e3', false, 2, 'c1') $$,
  'S-2: the deletion turned the deleted Technician''s "פעיל" off (no new invitations), by the Creator; other field profiles are untouched');

-- =================================================================================================
-- G. After the deletion: never reactivated or changed; nothing for the deleted user; history kept.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', true, 2, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', false, 2, null) $q$),
             pg_temp.tm_try($q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000b3', 2, 'שם אחר', null, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b3', 'manager', 2, null) $q$),
             pg_temp.tm_try($q$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000b3', 'password') $q$),
             pg_temp.tm_try($q$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000a2', 'email') $q$),
             pg_temp.tm_try($q$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e3', 2, 'טכנאי למחיקה', 't-s', 'tech-c@example.test', null, true) $q$)) $$,
  $$ values ('55000 the account is deleted', '55000 the account is deleted',
             '55000 profiles: a deleted account never changes (D60 (7))', '55000 profiles: a deleted account never changes (D60 (7))',
             '55000 the account is deleted', '55000 the account is deleted',
             '55000 technicians: the account is deleted (D60 (7))') $$,
  'C-01: the Creator cannot reactivate, deactivate, edit, re-role or give credentials to a deleted account, nor turn its "פעיל" on again (OQ-2, S-2)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', true, 2, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000d3', true, 2, null) $q$),
             pg_temp.tm_try($q$ select public.admin_update_profile('00000000-0000-4000-8000-0000000000d3', 2, 'x', null, null) $q$),
             pg_temp.tm_try($q$ select public.admin_set_user_active('00000000-0000-4000-8000-0000000000a2', true, 2, null) $q$),
             pg_temp.tm_try($q$ select public.admin_update_technician('00000000-0000-4000-8000-0000000000e3', 2, 'טכנאי למחיקה', 't-s', 'tech-c@example.test', null, true) $q$)) $$,
  $$ values ('55000 the account is deleted', '55000 the account is deleted',
             '55000 profiles: a deleted account never changes (D60 (7))', '42501 not authorized',
             '55000 technicians: the account is deleted (D60 (7))') $$,
  'the Manager cannot reactivate or edit a deleted Customer Service or Technician account, nor turn the deleted Technician''s "פעיל" on again; a deleted Manager stays outside his scope');
select results_eq(
  $$ select right(p.id::text, 2), p.deleted_at is not null from public.profiles p
     where p.id in ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000d3',
                    '00000000-0000-4000-8000-0000000000a2') order by p.id $$,
  $$ values ('b3'::text, true), ('d3', true) $$,
  'OQ-3: the Manager still reads the deleted Technician and Customer Service accounts (attribution), never the deleted Manager');
select is(
  (select count(*) from public.audit_logs where action = 'profile.deleted'), 2::bigint,
  'OQ-8: the Manager reads the deletion rows of Technician and Customer Service accounts, not of a Manager');
reset role;

create function pg_temp.tm_deleted_reads()
returns table (k text, v text)
language sql
as $f$
  values ('rows', ((select count(*) from public.profiles) + (select count(*) from public.technicians)
                   + (select count(*) from public.permissions) + (select count(*) from public.role_permissions)
                   + (select count(*) from public.account_requests) + (select count(*) from public.audit_logs)
                   + (select count(*) from public.service_calls) + (select count(*) from public.visits)
                   + (select count(*) from public.call_types) + (select count(*) from public.followup_reasons))::text),
         ('keys', (select count(*) from public.permissions k where public.has_permission(k.key))::text),
         ('technician', coalesce(public.my_technician_id()::text, 'none')),
         ('creator', public.is_creator()::text),
         ('manage', pg_temp.tm_try($q$ select public.assert_can_manage('technician') $q$)),
         ('authorize', pg_temp.tm_try($q$ select public.authorize_account_creation('technician', 'after@example.test', 'x') $q$)),
         ('reasons', pg_temp.tm_try($q$ select r.id from public.add_followup_reason('סיבה אחרי מחיקה') r $q$))
$f$;
grant execute on function pg_temp.tm_deleted_reads() to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_deleted_reads() $$,
  $$ values ('rows', '0'), ('keys', '0'), ('technician', 'none'), ('creator', 'false'), ('manage', '42501 not authorized'),
            ('authorize', '42501 not authorized'), ('reasons', '42501 not authorized') $$,
  'C-01: the deleted Technician''s session (a JWT issued before the deletion) reads nothing, not even his visit, and runs nothing');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_deleted_reads() $$,
  $$ values ('rows', '0'), ('keys', '0'), ('technician', 'none'), ('creator', 'false'), ('manage', '42501 not authorized'),
            ('authorize', '42501 not authorized'), ('reasons', '42501 not authorized') $$,
  'the deleted Manager''s session reads nothing and manages nothing');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_deleted_reads() $$,
  $$ values ('rows', '0'), ('keys', '0'), ('technician', 'none'), ('creator', 'false'), ('manage', '42501 not authorized'),
            ('authorize', '42501 not authorized'), ('reasons', '42501 not authorized') $$,
  'the deleted Customer Service user''s session reads nothing and runs nothing');
reset role;

select ok(
  (select technician_id = '00000000-0000-4000-8000-0000000000e3' and status = 'scheduled'
   from public.visits where id = '00000000-0000-4000-8000-0000000029b1')
  and (select display_name = 'טכנאי למחיקה' and profile_id = '00000000-0000-4000-8000-0000000000d3' and version = 2
          and not accepts_invitations
       from public.technicians where id = '00000000-0000-4000-8000-0000000000e3')
  and (select count(*) = 2 from public.profiles where created_by = '00000000-0000-4000-8000-0000000000a2')
  and (select count(*) from public.audit_logs where target_id in ('00000000-0000-4000-8000-0000000000b3',
       '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a2')) = 3
  and (select count(*) from public.profiles where id in ('00000000-0000-4000-8000-0000000000b3',
       '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a2')) = 3,
  'C-01: history stays and still references the deleted accounts: the visit keeps its Technician, the field profile its name, the accounts the deleted Manager created keep created_by, the audit rows keep their targets');
select is(private.audit_chain_verify(), null::bigint, 'the audit chain verifies after every account action');

-- =================================================================================================
-- H. Credentials stay with the Creator (D34 e, kept by D60 (7)).
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.assert_can_change_credentials('00000000-0000-4000-8000-0000000000f2', 'email') $$,
  'the Creator authorizes an email change of an active account (before the Auth Admin call)');
reset role;
select is(
  (select count(*) from public.audit_logs where action = 'credentials.change_authorized'
     and target_id = '00000000-0000-4000-8000-0000000000f2' and details = '{"kind": "email"}'::jsonb
     and actor_profile_id = '00000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'the authorization is audited; the refusals for deleted accounts wrote none');
select is(
  (select count(*) from public.audit_logs where action = 'credentials.change_authorized'), 1::bigint,
  'no credential authorization was written for a Manager or a deleted account');

select * from finish();
rollback;
