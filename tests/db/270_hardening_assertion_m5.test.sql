-- PR 1.8: the fail-closed hardening check of Migration 5 (section 14; owner, 2026-11-11 and
-- 2026-11-12: as in Migrations 3 and 4). The function below runs a byte-identical copy of the
-- section 14 DO body (tests/ci/hardening-assertion.test.mjs keeps it identical to the migration and
-- to Migration 4 section 12). Each case injects one leftover on a Migration 5 object (the deletion
-- writer, the new trigger functions, the retired request path, the deletion columns, the matrix
-- tables, the replaced functions) or a default, inside the checked statement, so the error rolls
-- the injection back with it; an invoker view passes, and the known limit (EXECUTE for
-- authenticated is allowed by design; 010 asserts the exact list) is shown. No data rows; the owner
-- cases create a role (tm_test_owner, not an API role) that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.m5_hardening_check() returns void language plpgsql as $assert$
declare
  v_api oid[];
  v_authenticated oid;
  v_leaks text;
begin
  select pg_catalog.array_agg(r.oid) into v_api
  from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
  select r.oid into v_authenticated from pg_catalog.pg_roles r where r.rolname = 'authenticated';

  select pg_catalog.string_agg(x.leak, '; ' order by x.leak) into v_leaks
  from (
    select 'schema ' || n.nspname || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text as leak
    from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a
    where n.nspname in ('public', 'private') and a.privilege_type = 'CREATE'
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'relation ' || c.oid::regclass::text || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated)
           or (a.grantee = v_authenticated and (c.relkind = 'S' or a.privilege_type <> 'SELECT')))
    union all
    select 'column ' || c.oid::regclass::text || '.' || t.attname || ' ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_attribute t
    join pg_catalog.pg_class c on c.oid = t.attrelid
    cross join lateral pg_catalog.aclexplode(t.attacl) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and t.attacl is not null
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'function ' || p.oid::regprocedure::text || ' EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))) a
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated))
    union all
    select 'default privileges of postgres (' || d.defaclobjtype::text || ') ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    -- No global entry means the built-in default (EXECUTE for PUBLIC), so a missing row is a leak.
    select 'global default privileges of postgres (f) EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.aclexplode(coalesce(
      (select d.defaclacl from pg_catalog.pg_default_acl d
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'),
      pg_catalog.acldefault('f'::"char", 'postgres'::regrole))) a
    where a.grantee = 0 or a.grantee = any (v_api)
    union all
    select 'table ' || c.oid::regclass::text || ' without row level security'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    select 'relation ' || c.oid::regclass::text || ' owned by ' || c.relowner::regrole::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.relowner <> 'postgres'::regrole
    union all
    select 'function ' || p.oid::regprocedure::text || ' owned by ' || p.proowner::regrole::text
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proowner <> 'postgres'::regrole
    union all
    select 'policy ' || o.polname || ' on ' || o.polrelid::regclass::text || ' for a role other than authenticated'
    from pg_catalog.pg_policy o
    join pg_catalog.pg_class c on c.oid = o.polrelid
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and o.polroles is distinct from array[v_authenticated]::oid[]
    union all
    select 'function ' || p.oid::regprocedure::text || ' without search_path pg_catalog, pg_temp'
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
    union all
    -- A view runs with its owner's rights unless security_invoker is on; a materialized view
    -- has no such option. Only invoker-rights views (the RLS of the reader applies) pass.
    select 'view ' || c.oid::regclass::text || ' without security_invoker'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'v'
      and not coalesce((select o.option_value::boolean from pg_catalog.pg_options_to_table(c.reloptions) o
                        where o.option_name = 'security_invoker'), false)
    union all
    select 'materialized view ' || c.oid::regclass::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'm'
  ) x;

  if v_leaks is not null then
    raise exception 'hardening check failed, nothing is applied: %', v_leaks;
  end if;
end
$assert$;

select lives_ok('select pg_temp.m5_hardening_check()', 'the migrated database (Migrations 1 to 5) passes the hardening check');

select throws_like(
  $q$do $t$ begin grant execute on function private.admin_delete_user(uuid, integer, text) to anon; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.admin_delete_user(uuid,integer,text) EXECUTE to anon%',
  'fails closed on EXECUTE of the deletion body for anon');

select throws_like(
  $q$do $t$ begin grant execute on function public.admin_delete_user(uuid, integer, text) to public; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function admin_delete_user(uuid,integer,text) EXECUTE to -%',
  'fails closed on EXECUTE of the deletion wrapper for PUBLIC');

select throws_like(
  $q$do $t$ begin grant execute on function private.tg_profile_deleted_guard() to service_role; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.tg_profile_deleted_guard() EXECUTE to service_role%',
  'fails closed on EXECUTE of a new trigger function for service_role');

select throws_like(
  $q$do $t$ begin grant execute on function public.request_account_change(text, uuid, text, text, text) to anon; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function request_account_change(text,uuid,text,text,text) EXECUTE to anon%',
  'fails closed when the retired request wrapper is granted to anon');

select throws_like(
  $q$do $t$ begin grant execute on function private.decide_account_request(uuid, text, integer, text) to public; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.decide_account_request(uuid,text,integer,text) EXECUTE to -%',
  'fails closed when the retired decision body is granted to PUBLIC');

select throws_like(
  $q$do $t$ begin grant update (deleted_at) on table public.profiles to authenticated; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%column %profiles.deleted_at UPDATE to authenticated%',
  'fails closed on a column UPDATE of profiles.deleted_at for authenticated');

select throws_like(
  $q$do $t$ begin grant select (deleted_by) on table public.profiles to anon; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%column %profiles.deleted_by SELECT to anon%',
  'fails closed on a column SELECT of profiles.deleted_by for anon');

select throws_like(
  $q$do $t$ begin grant update on table public.profiles to authenticated; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%relation %profiles UPDATE to authenticated%',
  'fails closed on a profiles UPDATE for authenticated (a deletion or reactivation outside the writers)');

select throws_like(
  $q$do $t$ begin grant insert on table public.permissions to anon; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%relation %permissions INSERT to anon%',
  'fails closed on a permissions INSERT for anon (the closed key catalogue)');

select throws_like(
  $q$do $t$ begin grant update on table public.role_permissions to authenticated; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%relation %role_permissions UPDATE to authenticated%',
  'fails closed on a role_permissions UPDATE for authenticated (a narrow key granted outside the Creator''s function)');

select throws_like(
  $q$do $t$ begin grant insert on table public.account_requests to service_role; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%relation %account_requests INSERT to service_role%',
  'fails closed on an account_requests INSERT for service_role');

select throws_like(
  $q$do $t$ begin alter table public.profiles disable row level security; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%table %profiles without row level security%',
  'fails closed when profiles loses RLS');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.account_requests for select to anon using (true); perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%policy t_leak on %account_requests for a role other than authenticated%',
  'fails closed on an account_requests policy for anon (the history)');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.profiles for select using (profiles.deleted_at is not null); perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%policy t_leak on %profiles for a role other than authenticated%',
  'fails closed on a profiles policy for PUBLIC');

select throws_like(
  $q$do $t$ begin alter function private.admin_delete_user(uuid, integer, text) set search_path = public, pg_temp; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.admin_delete_user(uuid,integer,text) without search_path pg_catalog, pg_temp%',
  'fails closed when the deletion body loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.tg_technician_deleted_guard() reset search_path; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.tg_technician_deleted_guard() without search_path pg_catalog, pg_temp%',
  'fails closed when a new trigger function loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.has_permission(text) reset search_path; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.has_permission(text) without search_path pg_catalog, pg_temp%',
  'fails closed when the replaced has_permission loses its pinned search_path');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema private to tm_test_owner; alter function private.admin_delete_user(uuid, integer, text) owner to tm_test_owner; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.admin_delete_user(uuid,integer,text) owned by tm_test_owner%',
  'fails closed on the deletion writer not owned by postgres');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema private to tm_test_owner; alter function private.authorize_account_creation(text, text, text) owner to tm_test_owner; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%function private.authorize_account_creation(text,text,text) owned by tm_test_owner%',
  'fails closed on a replaced account writer not owned by postgres');

select throws_like(
  $q$do $t$ begin create view public.v_leak as select p.id, p.deleted_at, p.deleted_by from public.profiles p; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%view %v_leak without security_invoker%',
  'fails closed on a definer-rights view over the deletion columns');

select throws_like(
  $q$do $t$ begin create materialized view public.mv_leak as select r.email from public.account_requests r; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%materialized view %mv_leak%',
  'fails closed on a materialized view over account_requests');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres in schema public grant execute on functions to anon; perform pg_temp.m5_hardening_check(); end $t$$q$,
  '%default privileges of postgres (f) EXECUTE to anon%',
  'fails closed on a default function privilege in public for anon');

select throws_like(
  $q$do $t$ begin create view public.v_ok with (security_invoker = on) as select p.id, p.deleted_at from public.profiles p; perform pg_temp.m5_hardening_check(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes an invoker-rights view over profiles (the reader''s RLS applies)');

-- Known limit, by design: the check allows EXECUTE for authenticated on any function, so a grant
-- of the retired request path to authenticated passes it. 010 asserts the exact EXECUTE list (the
-- retired path excluded), and 050 the refusal for every caller.
select throws_like(
  $q$do $t$ begin grant execute on function public.request_account_change(text, uuid, text, text, text) to authenticated; perform pg_temp.m5_hardening_check(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'known limit: EXECUTE for authenticated passes the check (010 and 050 guard the retired path)');

select lives_ok('select pg_temp.m5_hardening_check()', 'every injection was rolled back with its failed check');

select * from finish();
rollback;
