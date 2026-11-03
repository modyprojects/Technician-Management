-- Step 1, PR 1.2: smoke tests for the database test harness (pgTAP).
-- There are no migrations yet. These checks are catalog-wide, so they keep guarding every
-- object that later migrations add (D33, D47, docs/security.md §5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  current_setting('server_version_num')::int >= 170000,
  'local database runs Postgres 17 or later, like the remote project'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where grantee in ('anon', 'PUBLIC') and table_schema in ('public', 'private')),
  0::bigint,
  'anon and PUBLIC have no table privileges in public or private'
);

-- Sequences are not in information_schema.role_table_grants, and Supabase's default privileges
-- grant anon access to new sequences, so they are checked separately (grantee 0 = PUBLIC).
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'S'
      and exists (
        select 1 from aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
        where a.grantee = 0 or a.grantee = (select oid from pg_roles where rolname = 'anon'))),
  0::bigint,
  'anon and PUBLIC have no sequence privileges in public or private'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint,
  'anon cannot execute any function in public or private'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0::bigint,
  'every table in public and private has row level security enabled'
);

-- D47: every data table carries a test-data marker. Exemptions must be listed here with a reason.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and not a.attisdropped
          and a.attname in ('is_test', 'target_is_test'))
      and c.relname <> all (array[]::text[])),
  0::bigint,
  'every table in public and private carries a test-data marker (D47) or is an approved exemption'
);

select is(
  (select count(*) from pg_namespace where nspname = 'private'
    and has_schema_privilege('anon', oid, 'usage')),
  0::bigint,
  'anon has no usage on the private schema (if it exists)'
);

select * from finish();
rollback;
