-- Step 6: the fail-closed hardening check of Migration 6 (section 11; owner, 2026-11-11 and
-- 2026-11-12: as in Migrations 3 to 5). The function below runs a byte-identical copy of the
-- section 11 DO body (tests/ci/hardening-assertion.test.mjs keeps it identical to the migration and
-- to Migration 5 section 14). Each case injects one leftover on a Migration 6 object (the ingestion
-- writer, its wrapper and helpers, the new trigger functions, the three tables and their columns,
-- the replaced census), inside the checked statement, so the error rolls the injection back with
-- it; an invoker view passes, and the known limit (EXECUTE for authenticated is allowed by design;
-- 010 asserts the exact list) is shown. No data rows; the owner cases create a role
-- (tm_test_owner, not an API role) that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.m6_hardening_check() returns void language plpgsql as $assert$
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

select lives_ok('select pg_temp.m6_hardening_check()', 'the migrated database (Migrations 1 to 6) passes the hardening check');

select throws_like(
  $q$do $t$ begin grant execute on function private.ingest_calendar_event(jsonb) to anon; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.ingest_calendar_event(jsonb) EXECUTE to anon%',
  'fails closed on EXECUTE of the ingestion body for anon');

select throws_like(
  $q$do $t$ begin grant execute on function public.ingest_calendar_event(jsonb) to public; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function ingest_calendar_event(jsonb) EXECUTE to -%',
  'fails closed on EXECUTE of the ingestion wrapper for PUBLIC');

select throws_like(
  $q$do $t$ begin grant execute on function public.ingest_calendar_event(jsonb) to service_role; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function ingest_calendar_event(jsonb) EXECUTE to service_role%',
  'fails closed on EXECUTE of the ingestion wrapper for service_role');

select throws_like(
  $q$do $t$ begin grant execute on function private.ingest_text(jsonb, text) to anon; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.ingest_text(jsonb,text) EXECUTE to anon%',
  'fails closed on EXECUTE of a writer helper for anon');

select throws_like(
  $q$do $t$ begin grant execute on function private.tg_calendar_event_guard() to service_role; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.tg_calendar_event_guard() EXECUTE to service_role%',
  'fails closed on EXECUTE of a new trigger function for service_role');

select throws_like(
  $q$do $t$ begin grant insert on table public.external_calendar_events to authenticated; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%relation %external_calendar_events INSERT to authenticated%',
  'fails closed on an external_calendar_events INSERT for authenticated');

select throws_like(
  $q$do $t$ begin grant update on table public.calendar_ingestion_errors to authenticated; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%relation %calendar_ingestion_errors UPDATE to authenticated%',
  'fails closed on a calendar_ingestion_errors UPDATE for authenticated (a resolution outside the writer)');

select throws_like(
  $q$do $t$ begin grant select on table public.calendar_event_changes to anon; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%relation %calendar_event_changes SELECT to anon%',
  'fails closed on a calendar_event_changes SELECT for anon');

select throws_like(
  $q$do $t$ begin grant delete on table public.calendar_event_changes to service_role; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%relation %calendar_event_changes DELETE to service_role%',
  'fails closed on a calendar_event_changes DELETE for service_role');

select throws_like(
  $q$do $t$ begin grant update (snapshot) on table public.calendar_event_changes to authenticated; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%column %calendar_event_changes.snapshot UPDATE to authenticated%',
  'fails closed on a column UPDATE of the change snapshot for authenticated');

select throws_like(
  $q$do $t$ begin grant select (problems) on table public.calendar_ingestion_errors to anon; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%column %calendar_ingestion_errors.problems SELECT to anon%',
  'fails closed on a column SELECT of the unparsed problems for anon');

select throws_like(
  $q$do $t$ begin alter table public.calendar_ingestion_errors disable row level security; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%table %calendar_ingestion_errors without row level security%',
  'fails closed when calendar_ingestion_errors loses RLS');

select throws_like(
  $q$do $t$ begin alter table public.external_calendar_events disable row level security; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%table %external_calendar_events without row level security%',
  'fails closed when external_calendar_events loses RLS');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.calendar_ingestion_errors for select to anon using (true); perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%policy t_leak on %calendar_ingestion_errors for a role other than authenticated%',
  'fails closed on a calendar_ingestion_errors policy for anon');

select throws_like(
  $q$do $t$ begin create policy t_leak on public.calendar_event_changes for select using (true); perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%policy t_leak on %calendar_event_changes for a role other than authenticated%',
  'fails closed on a calendar_event_changes policy for PUBLIC');

select throws_like(
  $q$do $t$ begin alter function private.ingest_calendar_event(jsonb) set search_path = public, pg_temp; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.ingest_calendar_event(jsonb) without search_path pg_catalog, pg_temp%',
  'fails closed when the ingestion body loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.ingest_apply_call(public.service_calls, public.customers, public.products, boolean, jsonb, jsonb, timestamptz, uuid, uuid, text, text[], integer) reset search_path; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.ingest_apply_call(%) without search_path pg_catalog, pg_temp%',
  'fails closed when the call-level helper loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function private.tg_ingestion_error_state() reset search_path; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.tg_ingestion_error_state() without search_path pg_catalog, pg_temp%',
  'fails closed when a new trigger function loses its pinned search_path');

select throws_like(
  $q$do $t$ begin alter function public.test_data_census() reset search_path; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function test_data_census() without search_path pg_catalog, pg_temp%',
  'fails closed when the replaced census loses its pinned search_path');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema private to tm_test_owner; alter function private.ingest_calendar_event(jsonb) owner to tm_test_owner; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%function private.ingest_calendar_event(jsonb) owned by tm_test_owner%',
  'fails closed on the ingestion writer not owned by postgres');

select throws_like(
  $q$do $t$ begin create role tm_test_owner nologin; grant tm_test_owner to postgres; grant create on schema public to tm_test_owner; alter table public.calendar_ingestion_errors owner to tm_test_owner; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%relation %calendar_ingestion_errors owned by tm_test_owner%',
  'fails closed on a Step 6 table not owned by postgres');

select throws_like(
  $q$do $t$ begin create view public.v_leak as select x.subject, x.problems from public.calendar_ingestion_errors x; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%view %v_leak without security_invoker%',
  'fails closed on a definer-rights view over the unparsed invitations');

select throws_like(
  $q$do $t$ begin create materialized view public.mv_leak as select c.snapshot from public.calendar_event_changes c; perform pg_temp.m6_hardening_check(); end $t$$q$,
  '%materialized view %mv_leak%',
  'fails closed on a materialized view over the change snapshots');

select throws_like(
  $q$do $t$ begin create view public.v_ok with (security_invoker = on) as select x.id, x.status from public.calendar_ingestion_errors x; perform pg_temp.m6_hardening_check(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes an invoker-rights view over calendar_ingestion_errors (the reader''s RLS applies)');

-- Known limit, by design: the check allows EXECUTE for authenticated on any function, so a grant
-- of a writer helper to authenticated passes it. 010 asserts the exact EXECUTE list (the helpers
-- excluded), and 330 the refusal for every caller.
select throws_like(
  $q$do $t$ begin grant execute on function private.ingest_apply_visit(public.visits, uuid, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text, uuid, text, text[], integer) to authenticated; perform pg_temp.m6_hardening_check(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'known limit: EXECUTE for authenticated passes the check (010 and 330 guard the helpers)');

select lives_ok('select pg_temp.m6_hardening_check()', 'every injection was rolled back with its failed check');

select * from finish();
rollback;
