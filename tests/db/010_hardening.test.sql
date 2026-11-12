-- PR 1.3: privilege hardening, checked from the system catalog (docs/ROADMAP.md "PR 1.3 mandatory
-- security requirement", docs/security.md §5, docs/database-schema.md §9, docs/testing.md
-- category 1). Catalog-wide, so these checks also guard every object that later migrations add.
-- PR 1.4 (Migration 2): the exact lists now include the seven reference, customer and product
-- tables, their ten policies and the eight Settings RPCs (wrappers and bodies); four checks were
-- added for the new trigger functions and the root-table triggers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", a.privilege_type::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and a.grantee = 'authenticated'::regrole
     order by c.relname::text collate "C", a.privilege_type::text $$,
  $$ values ('account_requests', 'SELECT'), ('audit_logs', 'SELECT'), ('brands', 'SELECT'), ('call_types', 'SELECT'),
            ('collection_locations', 'SELECT'), ('customers', 'SELECT'), ('followup_reasons', 'SELECT'),
            ('permissions', 'SELECT'), ('products', 'SELECT'), ('profiles', 'SELECT'), ('role_permissions', 'SELECT'),
            ('suppliers', 'SELECT'), ('technicians', 'SELECT') $$,
  'authenticated has exactly SELECT on the six PR 1.3 tables and the seven PR 1.4 tables, and nothing else'
);

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'service_role'::regrole))),
  0::bigint,
  'anon, service_role and PUBLIC have no privilege on any table or view in public or private'
);

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee <> c.relowner
     and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
  0::bigint,
  'no role but the owner has INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any table'
);

select is(
  (select count(*) from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and a.attacl is not null),
  0::bigint,
  'no column-level grants in public or private'
);

-- ---------------------------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
   where n.nspname in ('public', 'private') and c.relkind = 'S' and a.grantee <> c.relowner),
  0::bigint,
  'no role but the owner has any privilege on a sequence in public or private (audit_logs_id_seq included)'
);

select ok(
  not has_sequence_privilege('anon', 'public.audit_logs_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.audit_logs_id_seq', 'usage')
  and not has_sequence_privilege('service_role', 'public.audit_logs_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.audit_logs_id_seq', 'update'),
  'no API role can use or advance the audit_logs identity sequence'
);

-- ---------------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select p.oid::regprocedure::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute')
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values
     ('add_call_type(text)'),
     ('add_collection_location(text,text,text,text,text)'),
     ('add_followup_reason(text)'),
     ('admin_create_profile(uuid,text,text,text,text,uuid)'),
     ('admin_create_technician(uuid,text,text,text,text,boolean)'),
     ('admin_set_role_permission(text,text,boolean,integer,text)'),
     ('admin_set_user_active(uuid,boolean,integer,text)'),
     ('admin_set_user_role(uuid,text,integer,text)'),
     ('admin_update_profile(uuid,integer,text,text,text)'),
     ('admin_update_technician(uuid,integer,text,text,text,text,boolean)'),
     ('assert_can_change_credentials(uuid,text)'),
     ('assert_can_manage(text)'),
     ('authorize_account_creation(text,text,text)'),
     ('cancel_account_request(uuid,integer)'),
     ('decide_account_request(uuid,text,integer,text)'),
     ('delete_collection_location(uuid,integer)'),
     ('delete_followup_reason(uuid,integer)'),
     ('has_permission(text)'),
     ('is_creator()'),
     ('my_technician_id()'),
     ('private.add_call_type(text)'),
     ('private.add_collection_location(text,text,text,text,text)'),
     ('private.add_followup_reason(text)'),
     ('private.admin_create_profile(uuid,text,text,text,text,uuid)'),
     ('private.admin_create_technician(uuid,text,text,text,text,boolean)'),
     ('private.admin_set_role_permission(text,text,boolean,integer,text)'),
     ('private.admin_set_user_active(uuid,boolean,integer,text)'),
     ('private.admin_set_user_role(uuid,text,integer,text)'),
     ('private.admin_update_profile(uuid,integer,text,text,text)'),
     ('private.admin_update_technician(uuid,integer,text,text,text,text,boolean)'),
     ('private.assert_can_change_credentials(uuid,text)'),
     ('private.assert_can_manage(text)'),
     ('private.authorize_account_creation(text,text,text)'),
     ('private.cancel_account_request(uuid,integer)'),
     ('private.decide_account_request(uuid,text,integer,text)'),
     ('private.delete_collection_location(uuid,integer)'),
     ('private.delete_followup_reason(uuid,integer)'),
     ('private.has_permission(text)'),
     ('private.has_role(text)'),
     ('private.is_active_user()'),
     ('private.is_creator()'),
     ('private.is_office_user()'),
     ('private.my_technician_id()'),
     ('private.request_account_change(text,uuid,text,text,text)'),
     ('private.set_call_type_active(uuid,boolean,integer)'),
     ('private.set_collection_location_active(uuid,boolean,integer)'),
     ('private.set_followup_reason_active(uuid,boolean,integer)'),
     ('request_account_change(text,uuid,text,text,text)'),
     ('set_call_type_active(uuid,boolean,integer)'),
     ('set_collection_location_active(uuid,boolean,integer)'),
     ('set_followup_reason_active(uuid,boolean,integer)'),
     ('test_data_census()') $$,
  'authenticated can execute exactly the public API and the private helpers and bodies it calls'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'anon and service_role cannot execute any function in public or private'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'private') and a.grantee = 0),
  0::bigint,
  'PUBLIC cannot execute any function in public or private'
);

select ok(
  not has_function_privilege('authenticated', 'private.write_audit(text,text,uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.require_caller(text[])', 'execute')
  and not has_function_privilege('authenticated', 'private.audit_chain_verify(bigint,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.bootstrap_first_creator(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_audit_chain()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_audit_target()', 'execute'),
  'write_audit, require_caller, audit_chain_verify, bootstrap_first_creator and trigger functions are not executable by authenticated'
);

-- PR 1.4: the three new trigger functions have no grant either.
select ok(
  not has_function_privilege('authenticated', 'private.tg_immutable_except()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_one_way_product_refs()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_followup_reason_delete_guard()', 'execute'),
  'PR 1.4: tg_immutable_except, tg_one_way_product_refs and tg_followup_reason_delete_guard are not executable by authenticated'
);

-- PR 1.4: the eight Settings bodies are SECURITY DEFINER in private; their public wrappers are
-- SECURITY INVOKER (the catalog-wide checks below cover owner and search_path).
select results_eq(
  $$ select n.nspname::text collate "default", count(*) filter (where p.prosecdef), count(*) filter (where not p.prosecdef)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname in ('add_call_type', 'set_call_type_active', 'add_followup_reason', 'set_followup_reason_active',
                         'delete_followup_reason', 'add_collection_location', 'set_collection_location_active',
                         'delete_collection_location')
     group by n.nspname order by n.nspname::text collate "C" $$,
  $$ values ('private', 8::bigint, 0::bigint), ('public', 0::bigint, 8::bigint) $$,
  'PR 1.4: eight SECURITY DEFINER Settings bodies in private and eight SECURITY INVOKER wrappers in public'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_approve_role_permission(text,text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.admin_approve_role_permission(text,text,integer)', 'execute'),
  'TEMPORARY (owner question Q6): no API role can mark a matrix value approved until the owner decides'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and (n.nspname <> 'private' or p.proowner <> 'postgres'::regrole
          or coalesce(p.proconfig, '{}') <> array['search_path=pg_catalog, pg_temp'])),
  0::bigint,
  'every SECURITY DEFINER function is in private, owned by postgres, with search_path pg_catalog, pg_temp (security.md §5, SEC-1)'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef),
  0::bigint,
  'no SECURITY DEFINER function in public: public exposes SECURITY INVOKER wrappers only'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and coalesce(p.proconfig, '{}') <> array['search_path=pg_catalog, pg_temp']),
  0::bigint,
  'every function in public and private pins search_path to pg_catalog, pg_temp (pg_temp last: an empty search_path searches pg_temp first for types, SEC-1)'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prosrc ~* '\mexecute\M' or p.prosrc ~* '\mformat\s*\(')),
  0::bigint,
  'no function in public or private builds or runs dynamic SQL (no EXECUTE, no format())'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proowner <> 'postgres'::regrole),
  0::bigint,
  'every function in public and private is owned by postgres'
);

-- ---------------------------------------------------------------------------------------------
-- Default privileges (known finding: Supabase's defaults granted anon access to new sequences)
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and (d.defaclnamespace = 0 or d.defaclnamespace in ('public'::regnamespace, 'private'::regnamespace))
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))),
  0::bigint,
  'the default privileges of postgres grant nothing to PUBLIC, anon, authenticated or service_role in public, private or globally'
);

select ok(
  exists (select 1 from pg_default_acl d
          where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
            and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
  'the global default for functions created by postgres revokes EXECUTE from PUBLIC'
);

-- ---------------------------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------------------------
select ok(has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has USAGE on private (the wrappers and policies call private helpers)');

select ok(
  not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('service_role', 'private', 'usage')
  and not exists (select 1 from pg_namespace s cross join lateral aclexplode(s.nspacl) a
                  where s.nspname = 'private' and a.grantee = 0),
  'anon, service_role and PUBLIC have no USAGE on private'
);

select is(
  (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
     cross join unnest(array['public', 'private']) s
   where has_schema_privilege(r, s, 'create')),
  0::bigint,
  'no API role can create objects in public or private'
);

select ok(
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage')
  and has_schema_privilege('service_role', 'public', 'usage'),
  'preserved for PostgREST: USAGE on public for anon, authenticated and service_role'
);

select is(
  (select pg_get_userbyid(nspowner)::text from pg_namespace where nspname = 'private'),
  'postgres',
  'private is owned by postgres'
);

-- ---------------------------------------------------------------------------------------------
-- Tables: RLS, policies, foreign keys, ownership, views
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_policy pol
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
     and (pol.polcmd <> 'r' or pol.polroles <> array['authenticated'::regrole::oid] or not pol.polpermissive)),
  0::bigint,
  'every policy is a permissive SELECT policy TO authenticated (no write or anon policies)'
);

select results_eq(
  $$ select c.relname::text collate "default", count(pol.oid)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_policy pol on pol.polrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r'
     group by c.relname order by c.relname::text collate "C" $$,
  $$ values ('account_requests', 2::bigint), ('audit_logs', 2::bigint), ('brands', 1::bigint), ('call_types', 2::bigint),
            ('collection_locations', 2::bigint), ('customers', 1::bigint), ('followup_reasons', 2::bigint),
            ('permissions', 1::bigint), ('products', 1::bigint), ('profiles', 3::bigint), ('role_permissions', 2::bigint),
            ('suppliers', 1::bigint), ('technicians', 2::bigint) $$,
  'every PR 1.3 and PR 1.4 table has its read policies (PR 1.4: ten)'
);

-- PR 1.4, generated columns (plan V1): on products and customers is_test is a stored generated
-- column, which BEFORE triggers read as NULL. The one-way checks therefore run AFTER the row is
-- formed, and no BEFORE trigger there reads the marker.
select results_eq(
  $$ select c.relname::text collate "default", t.tgname::text collate "default", t.tgfoid::regprocedure::text collate "default"
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname in ('products', 'customers') and c.relnamespace = 'public'::regnamespace
       and not t.tgisinternal and (t.tgtype & 2) = 0 and t.tgenabled = 'O'
     order by 1, 2 $$,
  $$ values ('customers', 'a30_one_way', 'private.tg_one_way_people()'),
            ('products', 'a30_one_way', 'private.tg_one_way_people()'),
            ('products', 'a31_one_way_refs', 'private.tg_one_way_product_refs()') $$,
  'PR 1.4: the one-way triggers on products and customers are enabled AFTER row triggers'
);
select is(
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname in ('products', 'customers') and c.relnamespace = 'public'::regnamespace
     and not t.tgisinternal and (t.tgtype & 2) <> 0
     and t.tgfoid in ('private.tg_one_way_people()'::regprocedure, 'private.tg_immutable_markers()'::regprocedure)),
  0::bigint,
  'PR 1.4: no BEFORE trigger on products or customers runs tg_one_way_people or tg_immutable_markers (they would read is_test as NULL)'
);

select is(
  (select count(*) from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and k.contype = 'f' and k.confdeltype <> 'r'),
  0::bigint,
  'every foreign key in public and private is ON DELETE RESTRICT'
);

select ok(
  exists (select 1 from pg_constraint k
          where k.conrelid = 'public.profiles'::regclass and k.contype = 'f'
            and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'r'),
  'profiles.id references auth.users ON DELETE RESTRICT'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relowner <> 'postgres'::regrole),
  0::bigint,
  'every relation in public and private is owned by postgres'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')),
  0::bigint,
  'no views in public or private (no view can bypass authorization)'
);

-- ---------------------------------------------------------------------------------------------
-- Probe: objects that postgres creates from now on get no privileges for API roles
-- (negative control for the default privileges; rolled back).
-- ---------------------------------------------------------------------------------------------
create table public.zz_probe_table (id int);
create sequence public.zz_probe_seq;
create function public.zz_probe_fn() returns int language sql as 'select 1';
create view public.zz_probe_view as select 1 as x;
create table private.zz_probe_table (id int);
create sequence private.zz_probe_seq;
create function private.zz_probe_fn() returns int language sql as 'select 1';

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
   where n.nspname in ('public', 'private') and c.relname like 'zz_probe_%'
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))),
  0::bigint,
  'probe: a new table, sequence or view in public or private gets no privilege for PUBLIC, anon, authenticated or service_role'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname = 'zz_probe_fn'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'probe: a new function in public or private is not executable by anon, authenticated or service_role'
);

select * from finish();
rollback;
