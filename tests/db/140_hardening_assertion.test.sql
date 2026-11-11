-- PR 1.4: the fail-closed hardening check of Migration 2 (section 11; owner, 2026-11-11). The
-- function below runs a byte-identical copy of the section 11 DO body (tests/ci/
-- hardening-assertion.test.mjs keeps them in sync). Each case injects one leftover inside the
-- checked statement, so the error rolls the injection back with it; the check must name it.
-- Covers the PR 1.3 section 15 privilege checks (also unchanged in section 11) and the section 11
-- additions: RLS, owners, policy roles, the pinned search_path and views. No data rows; the owner
-- cases create a role (tm_test_owner, not an API role) that the failed check rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.m2_hardening_check() returns void language plpgsql as $assert$
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
    select 'view ' || c.oid::regclass::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('v', 'm')
  ) x;

  if v_leaks is not null then
    raise exception 'hardening check failed, nothing is applied: %', v_leaks;
  end if;
end
$assert$;

select lives_ok('select pg_temp.m2_hardening_check()', 'the migrated database passes the hardening check');

select throws_like(
  $q$do $t$ begin grant select on table public.customers to anon; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %customers SELECT to anon%',
  'fails closed on a table SELECT for anon');

select throws_like(
  $q$do $t$ begin grant insert on table public.products to authenticated; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %products INSERT to authenticated%',
  'fails closed on a table INSERT for authenticated');

select throws_like(
  $q$do $t$ begin grant update (name) on table public.customers to authenticated; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%column %customers.name UPDATE to authenticated%',
  'fails closed on a column UPDATE for authenticated');

select throws_like(
  $q$do $t$ begin grant select on table public.brands to service_role; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %brands SELECT to service_role%',
  'fails closed on a table SELECT for service_role');

select throws_like(
  $q$do $t$ begin grant select on table public.suppliers to public; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %suppliers SELECT to -%',
  'fails closed on a table SELECT for PUBLIC');

select throws_like(
  $q$do $t$ begin grant usage on sequence public.audit_logs_id_seq to authenticated; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %audit_logs_id_seq USAGE to authenticated%',
  'fails closed on a sequence USAGE for authenticated');

select throws_like(
  $q$do $t$ begin grant create on schema public to authenticated; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%schema public CREATE to authenticated%',
  'fails closed on CREATE on public for authenticated');

select throws_like(
  $q$do $t$ begin grant usage, create on schema private to anon; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%schema private CREATE to anon%',
  'fails closed on CREATE on private for anon');

select throws_like(
  $q$do $t$ begin grant execute on function public.add_call_type(text) to anon; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function add_call_type(text) EXECUTE to anon%',
  'fails closed on a public function EXECUTE for anon');

select throws_like(
  $q$do $t$ begin grant execute on function private.delete_collection_location(uuid, integer) to public; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function private.delete_collection_location(uuid,integer) EXECUTE to -%',
  'fails closed on a private function EXECUTE for PUBLIC');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres in schema public grant select on tables to anon; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%default privileges of postgres (r) SELECT to anon%',
  'fails closed on a default table privilege in public for anon');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres grant execute on functions to public; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%global default privileges of postgres (f) EXECUTE to -%',
  'fails closed on the global function default for PUBLIC (no global row)');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres grant execute on functions to anon; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%global default privileges of postgres (f) EXECUTE to anon%',
  'fails closed on the global function default for anon');

select throws_like(
  $q$do $t$ begin alter table public.call_types disable row level security; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%table %call_types without row level security%',
  'fails closed on a table without RLS');

select throws_like(
  $q$do $t$ begin create table public.t_leak (id integer); perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%table %t_leak without row level security%',
  'fails closed on a new table without RLS');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema public to tm_test_owner; alter table public.suppliers owner to tm_test_owner; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%relation %suppliers owned by tm_test_owner%',
  'fails closed on a table not owned by postgres');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema private to tm_test_owner; alter function private.add_call_type(text) owner to tm_test_owner; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function private.add_call_type(text) owned by tm_test_owner%',
  'fails closed on a function not owned by postgres');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.customers for select to anon using (true); perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%policy t_leak on %customers for a role other than authenticated%',
  'fails closed on a policy for anon');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.products for select using (true); perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%policy t_leak on %products for a role other than authenticated%',
  'fails closed on a policy for PUBLIC (no TO clause)');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.brands for select to authenticated, anon using (true); perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%policy t_leak on %brands for a role other than authenticated%',
  'fails closed on a policy for authenticated and anon');

select throws_like(
  $q$do $t$ begin alter function public.add_call_type(text) reset search_path; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function add_call_type(text) without search_path pg_catalog, pg_temp%',
  'fails closed on a public function without a pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.add_call_type(text) set search_path = public, pg_temp; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function private.add_call_type(text) without search_path pg_catalog, pg_temp%',
  'fails closed on a private function with another search_path');

select throws_like(
  $q$do $t$ begin create function public.f_leak() returns integer language sql as 'select 1'; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%function f_leak() without search_path pg_catalog, pg_temp%',
  'fails closed on a new function without a pinned search_path');

select throws_like(
  $q$do $t$ begin create view public.v_leak with (security_invoker = true) as select 1 as x; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%view %v_leak%',
  'fails closed on a view (even security_invoker)');

select throws_like(
  $q$do $t$ begin create materialized view public.mv_leak as select 1 as x; perform pg_temp.m2_hardening_check(); end $t$$q$,
  '%view %mv_leak%',
  'fails closed on a materialized view');

select lives_ok('select pg_temp.m2_hardening_check()', 'every injection was rolled back with its failed check');

select * from finish();
rollback;
