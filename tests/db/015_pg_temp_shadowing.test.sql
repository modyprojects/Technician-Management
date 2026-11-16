-- PR 1.3, final independent review SEC-1: a session acting as `authenticated` holds TEMP on the
-- database and can create types in its own temporary schema. PostgreSQL searches pg_temp first for
-- type and relation names unless search_path lists it, and an empty search_path does not list it:
-- a domain pg_temp.text would then stand in for `text` inside every SECURITY DEFINER body (and the
-- trigger functions they fire), and its CHECK would run the caller's code as postgres. Every
-- function in public and private therefore pins search_path = pg_catalog, pg_temp, with pg_temp
-- last (PostgreSQL, "Writing SECURITY DEFINER Functions Safely"); 010 asserts that catalog-wide.
-- This file proves it with the attack itself: as `authenticated` it shadows text, uuid, jsonb and
-- timestamptz (the type names that are plain identifiers; integer, bigint and boolean are grammar
-- keywords that always mean pg_catalog) with domains whose CHECK refuses to run as anyone but
-- `authenticated`, then calls RPCs, helpers and policies as `authenticated`.
-- PR 1.5: the fixtures also write a service call with a closed and an open visit (every trigger
-- fires, and the deferred SECURITY DEFINER checks run at SET CONSTRAINTS ... IMMEDIATE while the
-- domains exist), and the Technician calls the three narrow read functions (previous_visits,
-- visit_rep_contact, my_visit_details) through their wrappers with the domains in place.
--
-- The file runs in its own session (pg_prove), and the fixtures are written after the domains
-- exist, so every function and trigger below is compiled while the domains exist (PL/pgSQL keeps
-- variable types per session). While they exist this file uses no unqualified type name and calls
-- no pgTAP function (pgTAP's own variables would resolve to the domains): each call runs in a DO
-- block that keeps its outcome in a setting, and the settings are checked after the domains are
-- dropped. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- The attacker's objects, created by `authenticated` in its own temporary schema.
set local role authenticated;
create function pg_temp.tm_shadow_probe(p_value pg_catalog.text)
returns pg_catalog.bool
language plpgsql
as $probe$
begin
  perform pg_catalog.set_config('tm_test.shadow_ran_as',
    pg_catalog.concat_ws(',', nullif(pg_catalog.current_setting('tm_test.shadow_ran_as', true), ''), current_user),
    true);
  if current_user <> 'authenticated' then
    raise exception 'pg_temp shadowing ran as %', current_user;
  end if;
  return true;
end
$probe$;
create domain pg_temp.text as pg_catalog.text check (pg_temp.tm_shadow_probe(value));
create domain pg_temp.uuid as pg_catalog.uuid check (pg_temp.tm_shadow_probe(value::pg_catalog.text));
create domain pg_temp.jsonb as pg_catalog.jsonb check (pg_temp.tm_shadow_probe(value::pg_catalog.text));
create domain pg_temp.timestamptz as pg_catalog.timestamptz check (pg_temp.tm_shadow_probe(value::pg_catalog.text));
reset role;

-- Fixtures (local, rolled back), written as postgres while the domains exist, so the triggers they
-- fire are compiled now. No casts: the literals take the column and parameter types by OID.
do $fixtures$
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-c1@example.test', now(), now()),
    ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a1@example.test', now(), now()),
    ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-d1@example.test', now(), now()),
    ('00000000-0000-4000-8000-0000000000f0', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-f0@example.test', now(), now());
  begin
    perform private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
    insert into public.profiles (id, role, full_name, work_phone, is_active) values
      ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', '03-000-0015', true),
      ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', null, true);
    insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
      ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test');
    -- PR 1.5: a call of the Technician with visit 1 done (signature, summary, history) and visit 2
    -- scheduled, written as Step 4 and Step 6 writers will write them.
    insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
      ('00000000-0000-4000-8000-0000000015c1', 'C-1501', 'לקוח צל', '050-000-1501', 'automated_test', 'pr15-015-1');
    insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
      ('00000000-0000-4000-8000-0000000015d1', 'SH-1501', 'SH-1501', 'מוצר צל', 'automated_test', 'pr15-015-1');
    insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                      warranty_status, warranty_until, warranty_raw, handling_rep_name,
                                      handling_rep_profile_id, status, next_visit_number, data_source, source_ref) values
      ('00000000-0000-4000-8000-0000000015a1', 'R-1501', '00000000-0000-4000-8000-0000000015c1',
       '00000000-0000-4000-8000-0000000015d1', (select t.id from public.call_types t where t.sort_order = 1),
       'תקלת צל', 'yes', '2027-05-01', 'כן עד 05/2027', 'נציגת צל', '00000000-0000-4000-8000-0000000000a1', 'open', 3,
       'automated_test', 'pr15-015-1');
    insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start,
                               scheduled_end, status, city, street, source_ref) values
      ('00000000-0000-4000-8000-0000000015b1', '00000000-0000-4000-8000-0000000015a1', '00000000-0000-4000-8000-0000000000e1',
       1, 'T-1501', '2026-11-01 08:00:00+00', '2026-11-01 09:00:00+00', 'done', 'עיר צל', 'רחוב צל', 'pr15-015-1'),
      ('00000000-0000-4000-8000-0000000015b2', '00000000-0000-4000-8000-0000000015a1', '00000000-0000-4000-8000-0000000000e1',
       2, 'T-1502', '2026-11-20 08:00:00+00', '2026-11-20 09:00:00+00', 'scheduled', 'עיר צל', 'רחוב צל', 'pr15-015-2');
    insert into public.visit_reports (visit_id, summary_text, summary_source) values
      ('00000000-0000-4000-8000-0000000015b1', 'סיכום צל', 'written');
    insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id) values
      ('00000000-0000-4000-8000-0000000015b1', 'חותם צל', 'נוסח אישור צל',
       '2b2fba45e6799f70e41a174407c0247e6d7299375f240a00dda725c43f617925', '00000000-0000-4000-8000-0000000015e1');
    insert into public.visit_events (visit_id, version_after, event_type, to_status) values
      ('00000000-0000-4000-8000-0000000015b1', 1, 'created', 'done'),
      ('00000000-0000-4000-8000-0000000015b2', 1, 'created', 'scheduled');
    set constraints all immediate;
    perform pg_catalog.set_config('tm_test.r_fixtures', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_fixtures', sqlstate || ' ' || sqlerrm, true);
  end;
end
$fixtures$;

-- The attack: calls as `authenticated` with the caller's claims, as PostgREST makes them.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $calls$
begin
  begin
    perform public.authorize_account_creation('technician', 'shadow-a@example.test', 'צל');
    perform pg_catalog.set_config('tm_test.r_authorize', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_authorize', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform public.request_account_change('create', null, 'customer_service', 'shadow-b@example.test', 'צל ב');
    perform pg_catalog.set_config('tm_test.r_request', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_request', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform public.admin_update_profile('00000000-0000-4000-8000-0000000000d1', 1, 'טכנאי א שונה', '050-000-0000', null);
    perform public.admin_update_technician('00000000-0000-4000-8000-0000000000e1', 1, 'טכנאי א', 't-y', 'tech-a2@example.test', null, true);
    perform pg_catalog.set_config('tm_test.r_update', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_update', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform public.admin_set_role_permission('manager', 'settings', true, 1, 'self-grant');
    perform pg_catalog.set_config('tm_test.r_manager_matrix', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_manager_matrix', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform pg_catalog.set_config('tm_test.r_reads',
      pg_catalog.concat_ws(',', public.has_permission('settings'), public.is_creator(), public.my_technician_id(),
                           (select pg_catalog.count(*) from public.profiles)),
      true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_reads', sqlstate || ' ' || sqlerrm, true);
  end;
end
$calls$;
reset role;

-- PR 1.5: the Technician reads his open visit through the three narrow read functions (SECURITY
-- DEFINER bodies behind SECURITY INVOKER wrappers) with the domains in place.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
do $calls$
begin
  begin
    perform pg_catalog.set_config('tm_test.r_previous_visits',
      (select pg_catalog.string_agg(pg_catalog.concat_ws(':', v.visit_number, v.status, v.technician_name, v.summary_text,
                                                         v.summary_source, v.is_test), ',')
       from public.previous_visits('00000000-0000-4000-8000-0000000015b2') v), true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_previous_visits', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform pg_catalog.set_config('tm_test.r_rep_contact',
      (select pg_catalog.concat_ws(':', r.rep_name, r.work_phone)
       from public.visit_rep_contact('00000000-0000-4000-8000-0000000015b2') r), true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_rep_contact', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform pg_catalog.set_config('tm_test.r_visit_details',
      (select pg_catalog.concat_ws(':', d.request_number, d.fault_description, d.warranty_status, d.warranty_until,
                                   d.is_test, d.customer_number, d.customer_name, d.product_sku_display)
       from public.my_visit_details('00000000-0000-4000-8000-0000000015b2') d), true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_visit_details', sqlstate || ' ' || sqlerrm, true);
  end;
end
$calls$;
reset role;

-- A signed-in user without a profile: the declarations of a body run before its caller check.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f0","role":"authenticated"}', true);
set local role authenticated;
do $calls$
begin
  begin
    perform public.admin_set_role_permission('manager', 'settings', true, 1, 'no profile');
    perform pg_catalog.set_config('tm_test.r_noprofile', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_noprofile', sqlstate || ' ' || sqlerrm, true);
  end;
end
$calls$;
reset role;

-- The Creator: a matrix change (role_permissions triggers) and the census (SECURITY INVOKER).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
do $calls$
begin
  begin
    perform public.admin_set_role_permission('customer_service', 'export', true, 1, 'בדיקה');
    perform pg_catalog.set_config('tm_test.r_creator_matrix', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_creator_matrix', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform pg_catalog.set_config('tm_test.r_census',
      (select pg_catalog.string_agg(c.test_rows::pg_catalog.text, ',' order by c.table_name) from public.test_data_census() c), true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_census', sqlstate || ' ' || sqlerrm, true);
  end;
end
$calls$;
reset role;
select set_config('tm_test.after_attack', coalesce(current_setting('tm_test.shadow_ran_as', true), ''), true);

-- Positive controls: the shadowing is live in this session. A SECURITY DEFINER function owned by
-- postgres with an empty search_path runs the probe as postgres; the same function with
-- search_path = pg_catalog, pg_temp does not.
create function pg_temp.tm_unpinned() returns void language plpgsql security definer set search_path = ''
as $f$ declare v_value text := 'x'; begin perform v_value; end $f$;
create function pg_temp.tm_pinned() returns void language plpgsql security definer set search_path = pg_catalog, pg_temp
as $f$ declare v_value text := 'x'; begin perform v_value; end $f$;
grant execute on function pg_temp.tm_unpinned(), pg_temp.tm_pinned() to authenticated;
set local role authenticated;
do $calls$
begin
  begin
    perform pg_temp.tm_pinned();
    perform pg_catalog.set_config('tm_test.r_pinned', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_pinned', sqlstate || ' ' || sqlerrm, true);
  end;
  begin
    perform pg_temp.tm_unpinned();
    perform pg_catalog.set_config('tm_test.r_unpinned', 'ok', true);
  exception when others then
    perform pg_catalog.set_config('tm_test.r_unpinned', sqlstate || ' ' || sqlerrm, true);
  end;
end
$calls$;
drop domain pg_temp.text;
drop domain pg_temp.uuid;
drop domain pg_temp.jsonb;
drop domain pg_temp.timestamptz;
reset role;
select set_config('request.jwt.claims', '', true);

-- Results (the domains are gone; pgTAP may run again).
select is(current_setting('tm_test.r_fixtures', true), 'ok',
  'the fixtures written as postgres (bootstrap, profiles, field profile; PR 1.5 call, visits and their deferred checks) fired the triggers without evaluating the domains');
select is(current_setting('tm_test.r_unpinned', true), 'P0001 pg_temp shadowing ran as postgres',
  'positive control: a SECURITY DEFINER function with an empty search_path runs the caller''s pg_temp domain CHECK as postgres');
select is(current_setting('tm_test.r_pinned', true), 'ok',
  'positive control: the same function with search_path = pg_catalog, pg_temp ignores the pg_temp domain');
-- The policies call auth.uid() (Supabase-managed, no search_path of its own) in the caller's own
-- query, so its casts may meet the domains there, with the caller's own rights only.
select ok(string_to_array(current_setting('tm_test.after_attack', true), ',') <@ array['authenticated'],
  'the domains'' CHECK never ran with more than the caller''s own rights (no RPC body, helper, wrapper or trigger ran it as postgres)');
select is(current_setting('tm_test.r_authorize', true), 'ok', 'a Manager''s creation intent works with the domains in place');
select is(current_setting('tm_test.r_request', true), 'ok', 'a Manager''s request works with the domains in place');
select is(current_setting('tm_test.r_update', true), 'ok', 'a Manager''s profile and field-profile updates work with the domains in place');
select is(current_setting('tm_test.r_manager_matrix', true), '42501 not authorized',
  'a Manager still cannot change the matrix: the caller check, not a pg_temp domain, decides');
select is(current_setting('tm_test.r_noprofile', true), '42501 not authorized',
  'a user without a profile gets 42501, not the result of code run during the declarations');
select is(current_setting('tm_test.r_reads', true), 'f,f,2',
  'the helpers and policies answer as without the domains (no settings key, not the Creator, no technician id; reads through RLS)');
select is(current_setting('tm_test.r_creator_matrix', true), 'ok', 'the Creator''s matrix change works with the domains in place');
select ok(current_setting('tm_test.r_census', true) ~ '^[0-9,]+$', 'the census runs with the domains in place');
select is(current_setting('tm_test.r_previous_visits', true), '1:done:טכנאי א:סיכום צל:written:t',
  'PR 1.5: a Technician''s previous_visits works with the domains in place');
select is(current_setting('tm_test.r_rep_contact', true), 'נציגת צל:03-000-0015',
  'PR 1.5: a Technician''s visit_rep_contact works with the domains in place');
select is(current_setting('tm_test.r_visit_details', true), 'R-1501:תקלת צל:yes:2027-05-01:t:C-1501:לקוח צל:SH-1501',
  'PR 1.5: a Technician''s my_visit_details works with the domains in place');
select ok(
  (select not allowed and version = 1 and updated_by is null from public.role_permissions
   where role = 'manager' and permission_key = 'settings'),
  'the Manager''s own matrix value is unchanged (no write as postgres behind the RPC)');
select is((select count(*) from public.audit_logs where action = 'matrix.value_set'), 1::bigint,
  'only the Creator''s matrix change is audited');
select ok(
  exists (select 1 from public.account_requests where email = 'shadow-a@example.test' and request_type = 'direct_create')
  and exists (select 1 from public.account_requests where email = 'shadow-b@example.test' and request_type = 'create'),
  'the intent and the request were stored');
select is(private.audit_chain_verify(), null::bigint, 'the audit chain written while the domains existed verifies');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and coalesce(p.proconfig, '{}') <> array['search_path=pg_catalog, pg_temp']),
  0::bigint, 'every function in public and private pins search_path = pg_catalog, pg_temp');

select * from finish();
rollback;
