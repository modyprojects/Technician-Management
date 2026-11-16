-- PR 1.6: the fail-closed hardening check of Migration 4 (section 12; owner, 2026-11-11 and
-- 2026-11-12: as in Migration 3). The function below runs a byte-identical copy of the section 12
-- DO body (tests/ci/hardening-assertion.test.mjs keeps it identical to the migration and to
-- Migration 3 section 12). Each case injects one leftover on a Migration 4 object (or a global
-- default) inside the checked statement, so the error rolls the injection back with it; an
-- invoker view over a new table passes. No data rows; the owner cases create a role
-- (tm_test_owner, not an API role) that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

create function pg_temp.m4_hardening_check() returns void language plpgsql as $assert$
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

select lives_ok('select pg_temp.m4_hardening_check()', 'the migrated database (Migrations 1 to 4) passes the hardening check');

select throws_like(
  $q$do $t$ begin grant select on table public.review_items to anon; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %review_items SELECT to anon%',
  'fails closed on a review_items SELECT for anon');

select throws_like(
  $q$do $t$ begin grant insert on table public.visit_corrections to authenticated; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %visit_corrections INSERT to authenticated%',
  'fails closed on a visit_corrections INSERT for authenticated');

select throws_like(
  $q$do $t$ begin grant update on table public.offline_operations to authenticated; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %offline_operations UPDATE to authenticated%',
  'fails closed on an offline_operations UPDATE for authenticated');

select throws_like(
  $q$do $t$ begin grant delete on table public.review_items to service_role; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %review_items DELETE to service_role%',
  'fails closed on a review_items DELETE for service_role');

select throws_like(
  $q$do $t$ begin grant select on table public.visit_corrections to public; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %visit_corrections SELECT to -%',
  'fails closed on a visit_corrections SELECT for PUBLIC');

select throws_like(
  $q$do $t$ begin grant update (resolution_note) on table public.review_items to authenticated; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%column %review_items.resolution_note UPDATE to authenticated%',
  'fails closed on a column UPDATE of review_items for authenticated');

select throws_like(
  $q$do $t$ begin grant execute on function private.record_offline_operation(uuid, uuid, text, text, integer, timestamptz, text, integer, text, integer, uuid) to anon; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.record_offline_operation(uuid,uuid,text,text,integer,timestamp with time zone,text,integer,text,integer,uuid) EXECUTE to anon%',
  'fails closed on EXECUTE of the offline-operation helper for anon');

select throws_like(
  $q$do $t$ begin grant execute on function private.create_review_item(text, text, uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb) to service_role; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb) EXECUTE to service_role%',
  'fails closed on EXECUTE of the review-item helper for service_role');

select throws_like(
  $q$do $t$ begin grant execute on function public.correct_visit(uuid, text, text, text, integer) to public; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function correct_visit(uuid,text,text,text,integer) EXECUTE to -%',
  'fails closed on EXECUTE of the correction wrapper for PUBLIC');

select throws_like(
  $q$do $t$ begin grant execute on function private.resolve_review_item(uuid, integer, text, jsonb, text) to anon; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.resolve_review_item(uuid,integer,text,jsonb,text) EXECUTE to anon%',
  'fails closed on EXECUTE of the resolution body for anon');

select throws_like(
  $q$do $t$ begin alter table public.offline_operations disable row level security; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%table %offline_operations without row level security%',
  'fails closed when offline_operations loses RLS');

select throws_like(
  $q$do $t$ begin alter table public.visit_corrections disable row level security; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%table %visit_corrections without row level security%',
  'fails closed when visit_corrections loses RLS');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.review_items for select to anon using (true); perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%policy t_leak on %review_items for a role other than authenticated%',
  'fails closed on a review_items policy for anon');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.offline_operations for select using (true); perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%policy t_leak on %offline_operations for a role other than authenticated%',
  'fails closed on an offline_operations policy for PUBLIC');

select throws_like(
  $q$do $t$ begin alter function private.correct_visit(uuid, text, text, text, integer) set search_path = public, pg_temp; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.correct_visit(uuid,text,text,text,integer) without search_path pg_catalog, pg_temp%',
  'fails closed when the correction body loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.tg_visit_field_version() reset search_path; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.tg_visit_field_version() without search_path pg_catalog, pg_temp%',
  'fails closed when a new trigger function loses its pinned search_path');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema private to tm_test_owner; alter function private.resolve_review_item(uuid, integer, text, jsonb, text) owner to tm_test_owner; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%function private.resolve_review_item(uuid,integer,text,jsonb,text) owned by tm_test_owner%',
  'fails closed on a writer not owned by postgres');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema public to tm_test_owner; alter table public.review_items owner to tm_test_owner; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%relation %review_items owned by tm_test_owner%',
  'fails closed on a new table not owned by postgres');

select throws_like(
  $q$do $t$ begin create view public.v_leak as select r.id from public.review_items r; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%view %v_leak without security_invoker%',
  'fails closed on a definer-rights view over review_items');

select throws_like(
  $q$do $t$ begin create materialized view public.mv_leak as select o.operation_id from public.offline_operations o; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%materialized view %mv_leak%',
  'fails closed on a materialized view over offline_operations');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres in schema public grant select on tables to anon; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%default privileges of postgres (r) SELECT to anon%',
  'fails closed on a default table privilege in public for anon');

select throws_like(
  $q$do $t$ begin alter default privileges for role postgres grant execute on functions to public; perform pg_temp.m4_hardening_check(); end $t$$q$,
  '%global default privileges of postgres (f) EXECUTE to -%',
  'fails closed on the global function default for PUBLIC');

select throws_like(
  $q$do $t$ begin create view public.v_ok with (security_invoker = on) as select r.id from public.review_items r; perform pg_temp.m4_hardening_check(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes an invoker-rights view over review_items (the reader''s RLS applies)');

select lives_ok('select pg_temp.m4_hardening_check()', 'every injection was rolled back with its failed check');

select * from finish();
rollback;
