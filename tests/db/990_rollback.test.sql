-- PR 1.3 and PR 1.4: the rollback (down) scripts, tested inside this transaction and rolled back
-- (docs/database-schema.md "Migration order and approval checklist" item 6). The blocks between
-- the markers are byte-identical copies of the down scripts; tests/ci/rollback.test.mjs fails if
-- they differ. The PR 1.4 script runs first (newest migration first): the PR 1.3 script cannot
-- run while PR 1.4 objects depend on its tables and helpers. Manual runs on the local stack
-- (down, catalog checks, re-apply) are in docs/review/step1-pr13/README.md and
-- docs/review/step1-pr14/README.md.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select ok(to_regnamespace('private') is not null and to_regclass('public.profiles') is not null,
  'positive control: the migration is applied before the rollback runs');

-- ---------------------------------------------------------------------------------------------
-- PR 1.4 (Migration 2) down script
-- ---------------------------------------------------------------------------------------------
select ok(
  to_regclass('public.products') is not null and to_regprocedure('public.add_call_type(text)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000'),
  'PR 1.4 positive control: Migration 2 is applied before its rollback runs');

-- Fail closed: a test brand (inserted inside the tested statement, so it is rolled back with it).
select throws_ok($rollback$
insert into public.brands (name) values ('מותג בדיקת שחזור');
-- >>> BEGIN supabase/rollback/20261105120000_reference_customers_products.down.sql
-- Rollback (down) script for supabase/migrations/20261105120000_reference_customers_products.sql
-- (Step 1 / PR 1.4). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.4 data exists. It refuses to run when a customer, product, brand,
-- supplier or pickup place exists, when the call types or continuation reasons are not exactly the
-- D48 rows as the migration created them, when an audit row targets a PR 1.4 table, or when a
-- later migration is recorded in the history (roll that one back first).
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the two PR 1.3 functions that the migration replaced (private.tg_audit_target and
-- public.test_data_census, byte-identical bodies; CREATE OR REPLACE keeps their grants and the
-- audit_logs trigger) and the two audit_logs CHECKs, then drops the PR 1.4 objects in reverse
-- order, with no CASCADE: an unexpected dependent object makes it fail instead of silently dropping
-- more. The PR 1.3 objects, grants and the hardening stay. Run it before the PR 1.3 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, three prove that it refuses to run.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed. A later migration may depend on these objects: refuse, with a clear message
  --    instead of a dependency error at DROP time.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261105120000' or h.name = 'reference_customers_products')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.4 data, or a D48 row that is not as the migration created it (labels, order, active,
  -- real, version 1, no creator), or an audit row about a PR 1.4 table: nothing is dropped.
  if exists (select 1 from public.customers) or exists (select 1 from public.products)
     or exists (select 1 from public.brands) or exists (select 1 from public.suppliers)
     or exists (select 1 from public.collection_locations)
     or (select count(*) from public.call_types) <> 2
     or exists (select 1 from public.call_types c
                where not (c.is_active and not c.is_test and c.version = 1 and c.created_by is null
                           and c.updated_by is null and (c.label_he, c.sort_order) in (('תיקון', 1), ('התקנה', 2))))
     or (select count(*) from public.followup_reasons) <> 5
     or exists (select 1 from public.followup_reasons r
                where not (r.is_active and not r.is_test and not r.is_user_added and r.version = 1
                           and r.created_by is null and r.updated_by is null
                           and (r.label_he, r.sort_order) in (('ממתין לחלקי חילוף', 1), ('נדרש ביקור נוסף', 2),
                                                              ('נדרשת בדיקת מתקין', 3), ('הזמנת מוצר חדש', 4),
                                                              ('לקוח לא נמצא', 5))))
     or exists (select 1 from public.audit_logs a
                where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data';
  end if;

  -- 1. Public API wrappers, then the private RPC bodies.
  drop function public.delete_collection_location(uuid, integer);
  drop function public.set_collection_location_active(uuid, boolean, integer);
  drop function public.add_collection_location(text, text, text, text, text);
  drop function public.delete_followup_reason(uuid, integer);
  drop function public.set_followup_reason_active(uuid, boolean, integer);
  drop function public.add_followup_reason(text);
  drop function public.set_call_type_active(uuid, boolean, integer);
  drop function public.add_call_type(text);
  drop function private.delete_collection_location(uuid, integer);
  drop function private.set_collection_location_active(uuid, boolean, integer);
  drop function private.add_collection_location(text, text, text, text, text);
  drop function private.delete_followup_reason(uuid, integer);
  drop function private.set_followup_reason_active(uuid, boolean, integer);
  drop function private.add_followup_reason(text);
  drop function private.set_call_type_active(uuid, boolean, integer);
  drop function private.add_call_type(text);

  -- 2. The two PR 1.3 functions, restored to their PR 1.3 text (same ACL and trigger attachment).
  --    Their bodies are copied byte for byte from the PR 1.3 migration, so they are not indented.
  create or replace function private.tg_audit_target()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  create or replace function public.test_data_census()
  returns table (table_name text, marker text, bucket text, test_rows bigint)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 3. The two audit_logs CHECKs, restored to the PR 1.3 lists (no PR 1.4 audit row exists: step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions'));

  -- 4. Tables, in dependency order. Their triggers, policies, indexes and constraints go with them
  --    (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.products;
  drop table public.customers;
  drop table public.brands;
  drop table public.suppliers;
  drop table public.call_types;
  drop table public.followup_reasons;
  drop table public.collection_locations;

  -- 5. The PR 1.4 trigger functions.
  drop function private.tg_followup_reason_delete_guard();
  drop function private.tg_one_way_product_refs();
  drop function private.tg_immutable_except();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'reference_customers_products'. Every row with either is removed. When the history table
  --    exists but holds neither, the whole rollback is refused (nothing is dropped).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261105120000' or name = 'reference_customers_products';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses to run once PR 1.4 data exists (fail closed)');
select ok(
  to_regclass('public.brands') is not null and to_regprocedure('private.add_call_type(text)') is not null
  and (select count(*) from public.brands) = 0
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000'),
  'PR 1.4: after the refused run nothing was dropped and the fixture is gone');

-- Fail closed: a D48 row that is no longer as the migration created it (deactivated).
select throws_ok($rollback$
update public.call_types set is_active = false where sort_order = 2;
-- >>> BEGIN supabase/rollback/20261105120000_reference_customers_products.down.sql
-- Rollback (down) script for supabase/migrations/20261105120000_reference_customers_products.sql
-- (Step 1 / PR 1.4). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.4 data exists. It refuses to run when a customer, product, brand,
-- supplier or pickup place exists, when the call types or continuation reasons are not exactly the
-- D48 rows as the migration created them, when an audit row targets a PR 1.4 table, or when a
-- later migration is recorded in the history (roll that one back first).
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the two PR 1.3 functions that the migration replaced (private.tg_audit_target and
-- public.test_data_census, byte-identical bodies; CREATE OR REPLACE keeps their grants and the
-- audit_logs trigger) and the two audit_logs CHECKs, then drops the PR 1.4 objects in reverse
-- order, with no CASCADE: an unexpected dependent object makes it fail instead of silently dropping
-- more. The PR 1.3 objects, grants and the hardening stay. Run it before the PR 1.3 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, three prove that it refuses to run.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed. A later migration may depend on these objects: refuse, with a clear message
  --    instead of a dependency error at DROP time.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261105120000' or h.name = 'reference_customers_products')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.4 data, or a D48 row that is not as the migration created it (labels, order, active,
  -- real, version 1, no creator), or an audit row about a PR 1.4 table: nothing is dropped.
  if exists (select 1 from public.customers) or exists (select 1 from public.products)
     or exists (select 1 from public.brands) or exists (select 1 from public.suppliers)
     or exists (select 1 from public.collection_locations)
     or (select count(*) from public.call_types) <> 2
     or exists (select 1 from public.call_types c
                where not (c.is_active and not c.is_test and c.version = 1 and c.created_by is null
                           and c.updated_by is null and (c.label_he, c.sort_order) in (('תיקון', 1), ('התקנה', 2))))
     or (select count(*) from public.followup_reasons) <> 5
     or exists (select 1 from public.followup_reasons r
                where not (r.is_active and not r.is_test and not r.is_user_added and r.version = 1
                           and r.created_by is null and r.updated_by is null
                           and (r.label_he, r.sort_order) in (('ממתין לחלקי חילוף', 1), ('נדרש ביקור נוסף', 2),
                                                              ('נדרשת בדיקת מתקין', 3), ('הזמנת מוצר חדש', 4),
                                                              ('לקוח לא נמצא', 5))))
     or exists (select 1 from public.audit_logs a
                where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data';
  end if;

  -- 1. Public API wrappers, then the private RPC bodies.
  drop function public.delete_collection_location(uuid, integer);
  drop function public.set_collection_location_active(uuid, boolean, integer);
  drop function public.add_collection_location(text, text, text, text, text);
  drop function public.delete_followup_reason(uuid, integer);
  drop function public.set_followup_reason_active(uuid, boolean, integer);
  drop function public.add_followup_reason(text);
  drop function public.set_call_type_active(uuid, boolean, integer);
  drop function public.add_call_type(text);
  drop function private.delete_collection_location(uuid, integer);
  drop function private.set_collection_location_active(uuid, boolean, integer);
  drop function private.add_collection_location(text, text, text, text, text);
  drop function private.delete_followup_reason(uuid, integer);
  drop function private.set_followup_reason_active(uuid, boolean, integer);
  drop function private.add_followup_reason(text);
  drop function private.set_call_type_active(uuid, boolean, integer);
  drop function private.add_call_type(text);

  -- 2. The two PR 1.3 functions, restored to their PR 1.3 text (same ACL and trigger attachment).
  --    Their bodies are copied byte for byte from the PR 1.3 migration, so they are not indented.
  create or replace function private.tg_audit_target()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  create or replace function public.test_data_census()
  returns table (table_name text, marker text, bucket text, test_rows bigint)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 3. The two audit_logs CHECKs, restored to the PR 1.3 lists (no PR 1.4 audit row exists: step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions'));

  -- 4. Tables, in dependency order. Their triggers, policies, indexes and constraints go with them
  --    (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.products;
  drop table public.customers;
  drop table public.brands;
  drop table public.suppliers;
  drop table public.call_types;
  drop table public.followup_reasons;
  drop table public.collection_locations;

  -- 5. The PR 1.4 trigger functions.
  drop function private.tg_followup_reason_delete_guard();
  drop function private.tg_one_way_product_refs();
  drop function private.tg_immutable_except();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'reference_customers_products'. Every row with either is removed. When the history table
  --    exists but holds neither, the whole rollback is refused (nothing is dropped).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261105120000' or name = 'reference_customers_products';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses to run once a D48 row was changed');
select ok(
  to_regclass('public.call_types') is not null
  and (select count(*) from public.call_types where is_active and version = 1) = 2,
  'PR 1.4: after that refusal nothing was dropped and the D48 row is unchanged');

-- A later migration is recorded: refused with a clear message (not a dependency error at DROP time).
select throws_ok($rollback$
insert into supabase_migrations.schema_migrations (version, name) values ('20261201000000', 'later_migration_probe');
-- >>> BEGIN supabase/rollback/20261105120000_reference_customers_products.down.sql
-- Rollback (down) script for supabase/migrations/20261105120000_reference_customers_products.sql
-- (Step 1 / PR 1.4). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.4 data exists. It refuses to run when a customer, product, brand,
-- supplier or pickup place exists, when the call types or continuation reasons are not exactly the
-- D48 rows as the migration created them, when an audit row targets a PR 1.4 table, or when a
-- later migration is recorded in the history (roll that one back first).
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the two PR 1.3 functions that the migration replaced (private.tg_audit_target and
-- public.test_data_census, byte-identical bodies; CREATE OR REPLACE keeps their grants and the
-- audit_logs trigger) and the two audit_logs CHECKs, then drops the PR 1.4 objects in reverse
-- order, with no CASCADE: an unexpected dependent object makes it fail instead of silently dropping
-- more. The PR 1.3 objects, grants and the hardening stay. Run it before the PR 1.3 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, three prove that it refuses to run.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed. A later migration may depend on these objects: refuse, with a clear message
  --    instead of a dependency error at DROP time.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261105120000' or h.name = 'reference_customers_products')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.4 data, or a D48 row that is not as the migration created it (labels, order, active,
  -- real, version 1, no creator), or an audit row about a PR 1.4 table: nothing is dropped.
  if exists (select 1 from public.customers) or exists (select 1 from public.products)
     or exists (select 1 from public.brands) or exists (select 1 from public.suppliers)
     or exists (select 1 from public.collection_locations)
     or (select count(*) from public.call_types) <> 2
     or exists (select 1 from public.call_types c
                where not (c.is_active and not c.is_test and c.version = 1 and c.created_by is null
                           and c.updated_by is null and (c.label_he, c.sort_order) in (('תיקון', 1), ('התקנה', 2))))
     or (select count(*) from public.followup_reasons) <> 5
     or exists (select 1 from public.followup_reasons r
                where not (r.is_active and not r.is_test and not r.is_user_added and r.version = 1
                           and r.created_by is null and r.updated_by is null
                           and (r.label_he, r.sort_order) in (('ממתין לחלקי חילוף', 1), ('נדרש ביקור נוסף', 2),
                                                              ('נדרשת בדיקת מתקין', 3), ('הזמנת מוצר חדש', 4),
                                                              ('לקוח לא נמצא', 5))))
     or exists (select 1 from public.audit_logs a
                where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data';
  end if;

  -- 1. Public API wrappers, then the private RPC bodies.
  drop function public.delete_collection_location(uuid, integer);
  drop function public.set_collection_location_active(uuid, boolean, integer);
  drop function public.add_collection_location(text, text, text, text, text);
  drop function public.delete_followup_reason(uuid, integer);
  drop function public.set_followup_reason_active(uuid, boolean, integer);
  drop function public.add_followup_reason(text);
  drop function public.set_call_type_active(uuid, boolean, integer);
  drop function public.add_call_type(text);
  drop function private.delete_collection_location(uuid, integer);
  drop function private.set_collection_location_active(uuid, boolean, integer);
  drop function private.add_collection_location(text, text, text, text, text);
  drop function private.delete_followup_reason(uuid, integer);
  drop function private.set_followup_reason_active(uuid, boolean, integer);
  drop function private.add_followup_reason(text);
  drop function private.set_call_type_active(uuid, boolean, integer);
  drop function private.add_call_type(text);

  -- 2. The two PR 1.3 functions, restored to their PR 1.3 text (same ACL and trigger attachment).
  --    Their bodies are copied byte for byte from the PR 1.3 migration, so they are not indented.
  create or replace function private.tg_audit_target()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  create or replace function public.test_data_census()
  returns table (table_name text, marker text, bucket text, test_rows bigint)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 3. The two audit_logs CHECKs, restored to the PR 1.3 lists (no PR 1.4 audit row exists: step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions'));

  -- 4. Tables, in dependency order. Their triggers, policies, indexes and constraints go with them
  --    (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.products;
  drop table public.customers;
  drop table public.brands;
  drop table public.suppliers;
  drop table public.call_types;
  drop table public.followup_reasons;
  drop table public.collection_locations;

  -- 5. The PR 1.4 trigger functions.
  drop function private.tg_followup_reason_delete_guard();
  drop function private.tg_one_way_product_refs();
  drop function private.tg_immutable_except();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'reference_customers_products'. Every row with either is removed. When the history table
  --    exists but holds neither, the whole rollback is refused (nothing is dropped).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261105120000' or name = 'reference_customers_products';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
$rollback$,
  '55000', 'rollback refused: a later migration is recorded; roll it back first',
  'PR 1.4: the down script refuses while a later migration is recorded');
select ok(
  to_regclass('public.products') is not null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '20261201000000'),
  'PR 1.4: after that refusal nothing was dropped and the probe row is gone');

-- OPS-1 (as in PR 1.3): without a history row (the CLI's version or the MCP name) the rollback is
-- refused as a whole. The history row is deleted inside the tested statement.
select throws_ok($rollback$
delete from supabase_migrations.schema_migrations where version = '20261105120000' or name = 'reference_customers_products';
-- >>> BEGIN supabase/rollback/20261105120000_reference_customers_products.down.sql
-- Rollback (down) script for supabase/migrations/20261105120000_reference_customers_products.sql
-- (Step 1 / PR 1.4). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.4 data exists. It refuses to run when a customer, product, brand,
-- supplier or pickup place exists, when the call types or continuation reasons are not exactly the
-- D48 rows as the migration created them, when an audit row targets a PR 1.4 table, or when a
-- later migration is recorded in the history (roll that one back first).
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the two PR 1.3 functions that the migration replaced (private.tg_audit_target and
-- public.test_data_census, byte-identical bodies; CREATE OR REPLACE keeps their grants and the
-- audit_logs trigger) and the two audit_logs CHECKs, then drops the PR 1.4 objects in reverse
-- order, with no CASCADE: an unexpected dependent object makes it fail instead of silently dropping
-- more. The PR 1.3 objects, grants and the hardening stay. Run it before the PR 1.3 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, three prove that it refuses to run.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed. A later migration may depend on these objects: refuse, with a clear message
  --    instead of a dependency error at DROP time.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261105120000' or h.name = 'reference_customers_products')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.4 data, or a D48 row that is not as the migration created it (labels, order, active,
  -- real, version 1, no creator), or an audit row about a PR 1.4 table: nothing is dropped.
  if exists (select 1 from public.customers) or exists (select 1 from public.products)
     or exists (select 1 from public.brands) or exists (select 1 from public.suppliers)
     or exists (select 1 from public.collection_locations)
     or (select count(*) from public.call_types) <> 2
     or exists (select 1 from public.call_types c
                where not (c.is_active and not c.is_test and c.version = 1 and c.created_by is null
                           and c.updated_by is null and (c.label_he, c.sort_order) in (('תיקון', 1), ('התקנה', 2))))
     or (select count(*) from public.followup_reasons) <> 5
     or exists (select 1 from public.followup_reasons r
                where not (r.is_active and not r.is_test and not r.is_user_added and r.version = 1
                           and r.created_by is null and r.updated_by is null
                           and (r.label_he, r.sort_order) in (('ממתין לחלקי חילוף', 1), ('נדרש ביקור נוסף', 2),
                                                              ('נדרשת בדיקת מתקין', 3), ('הזמנת מוצר חדש', 4),
                                                              ('לקוח לא נמצא', 5))))
     or exists (select 1 from public.audit_logs a
                where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data';
  end if;

  -- 1. Public API wrappers, then the private RPC bodies.
  drop function public.delete_collection_location(uuid, integer);
  drop function public.set_collection_location_active(uuid, boolean, integer);
  drop function public.add_collection_location(text, text, text, text, text);
  drop function public.delete_followup_reason(uuid, integer);
  drop function public.set_followup_reason_active(uuid, boolean, integer);
  drop function public.add_followup_reason(text);
  drop function public.set_call_type_active(uuid, boolean, integer);
  drop function public.add_call_type(text);
  drop function private.delete_collection_location(uuid, integer);
  drop function private.set_collection_location_active(uuid, boolean, integer);
  drop function private.add_collection_location(text, text, text, text, text);
  drop function private.delete_followup_reason(uuid, integer);
  drop function private.set_followup_reason_active(uuid, boolean, integer);
  drop function private.add_followup_reason(text);
  drop function private.set_call_type_active(uuid, boolean, integer);
  drop function private.add_call_type(text);

  -- 2. The two PR 1.3 functions, restored to their PR 1.3 text (same ACL and trigger attachment).
  --    Their bodies are copied byte for byte from the PR 1.3 migration, so they are not indented.
  create or replace function private.tg_audit_target()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  create or replace function public.test_data_census()
  returns table (table_name text, marker text, bucket text, test_rows bigint)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 3. The two audit_logs CHECKs, restored to the PR 1.3 lists (no PR 1.4 audit row exists: step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions'));

  -- 4. Tables, in dependency order. Their triggers, policies, indexes and constraints go with them
  --    (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.products;
  drop table public.customers;
  drop table public.brands;
  drop table public.suppliers;
  drop table public.call_types;
  drop table public.followup_reasons;
  drop table public.collection_locations;

  -- 5. The PR 1.4 trigger functions.
  drop function private.tg_followup_reason_delete_guard();
  drop function private.tg_one_way_product_refs();
  drop function private.tg_immutable_except();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'reference_customers_products'. Every row with either is removed. When the history table
  --    exists but holds neither, the whole rollback is refused (nothing is dropped).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261105120000' or name = 'reference_customers_products';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
$rollback$,
  '55000', 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped',
  'PR 1.4: the down script refuses when the history table holds no row for the migration');
select ok(
  to_regclass('public.products') is not null and to_regprocedure('public.delete_followup_reason(uuid,integer)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000'),
  'PR 1.4: after that refusal nothing was dropped and the history row is still there');

-- The run on the empty tables, with an MCP-style history row next to the CLI's (both removed).
insert into supabase_migrations.schema_migrations (version, name) values ('20261110093013', 'reference_customers_products');

-- >>> BEGIN supabase/rollback/20261105120000_reference_customers_products.down.sql
-- Rollback (down) script for supabase/migrations/20261105120000_reference_customers_products.sql
-- (Step 1 / PR 1.4). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.4 data exists. It refuses to run when a customer, product, brand,
-- supplier or pickup place exists, when the call types or continuation reasons are not exactly the
-- D48 rows as the migration created them, when an audit row targets a PR 1.4 table, or when a
-- later migration is recorded in the history (roll that one back first).
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the two PR 1.3 functions that the migration replaced (private.tg_audit_target and
-- public.test_data_census, byte-identical bodies; CREATE OR REPLACE keeps their grants and the
-- audit_logs trigger) and the two audit_logs CHECKs, then drops the PR 1.4 objects in reverse
-- order, with no CASCADE: an unexpected dependent object makes it fail instead of silently dropping
-- more. The PR 1.3 objects, grants and the hardening stay. Run it before the PR 1.3 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, three prove that it refuses to run.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed. A later migration may depend on these objects: refuse, with a clear message
  --    instead of a dependency error at DROP time.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261105120000' or h.name = 'reference_customers_products')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.4 data, or a D48 row that is not as the migration created it (labels, order, active,
  -- real, version 1, no creator), or an audit row about a PR 1.4 table: nothing is dropped.
  if exists (select 1 from public.customers) or exists (select 1 from public.products)
     or exists (select 1 from public.brands) or exists (select 1 from public.suppliers)
     or exists (select 1 from public.collection_locations)
     or (select count(*) from public.call_types) <> 2
     or exists (select 1 from public.call_types c
                where not (c.is_active and not c.is_test and c.version = 1 and c.created_by is null
                           and c.updated_by is null and (c.label_he, c.sort_order) in (('תיקון', 1), ('התקנה', 2))))
     or (select count(*) from public.followup_reasons) <> 5
     or exists (select 1 from public.followup_reasons r
                where not (r.is_active and not r.is_test and not r.is_user_added and r.version = 1
                           and r.created_by is null and r.updated_by is null
                           and (r.label_he, r.sort_order) in (('ממתין לחלקי חילוף', 1), ('נדרש ביקור נוסף', 2),
                                                              ('נדרשת בדיקת מתקין', 3), ('הזמנת מוצר חדש', 4),
                                                              ('לקוח לא נמצא', 5))))
     or exists (select 1 from public.audit_logs a
                where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data';
  end if;

  -- 1. Public API wrappers, then the private RPC bodies.
  drop function public.delete_collection_location(uuid, integer);
  drop function public.set_collection_location_active(uuid, boolean, integer);
  drop function public.add_collection_location(text, text, text, text, text);
  drop function public.delete_followup_reason(uuid, integer);
  drop function public.set_followup_reason_active(uuid, boolean, integer);
  drop function public.add_followup_reason(text);
  drop function public.set_call_type_active(uuid, boolean, integer);
  drop function public.add_call_type(text);
  drop function private.delete_collection_location(uuid, integer);
  drop function private.set_collection_location_active(uuid, boolean, integer);
  drop function private.add_collection_location(text, text, text, text, text);
  drop function private.delete_followup_reason(uuid, integer);
  drop function private.set_followup_reason_active(uuid, boolean, integer);
  drop function private.add_followup_reason(text);
  drop function private.set_call_type_active(uuid, boolean, integer);
  drop function private.add_call_type(text);

  -- 2. The two PR 1.3 functions, restored to their PR 1.3 text (same ACL and trigger attachment).
  --    Their bodies are copied byte for byte from the PR 1.3 migration, so they are not indented.
  create or replace function private.tg_audit_target()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  create or replace function public.test_data_census()
  returns table (table_name text, marker text, bucket text, test_rows bigint)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 3. The two audit_logs CHECKs, restored to the PR 1.3 lists (no PR 1.4 audit row exists: step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions'));

  -- 4. Tables, in dependency order. Their triggers, policies, indexes and constraints go with them
  --    (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.products;
  drop table public.customers;
  drop table public.brands;
  drop table public.suppliers;
  drop table public.call_types;
  drop table public.followup_reasons;
  drop table public.collection_locations;

  -- 5. The PR 1.4 trigger functions.
  drop function private.tg_followup_reason_delete_guard();
  drop function private.tg_one_way_product_refs();
  drop function private.tg_immutable_except();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'reference_customers_products'. Every row with either is removed. When the history table
  --    exists but holds neither, the whole rollback is refused (nothing is dropped).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261105120000' or name = 'reference_customers_products';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql

select ok(
  to_regclass('public.brands') is null and to_regclass('public.suppliers') is null and to_regclass('public.products') is null
  and to_regclass('public.customers') is null and to_regclass('public.call_types') is null
  and to_regclass('public.followup_reasons') is null and to_regclass('public.collection_locations') is null
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname in ('public', 'private')
                    and p.proname in ('add_call_type', 'set_call_type_active', 'add_followup_reason',
                                      'set_followup_reason_active', 'delete_followup_reason', 'add_collection_location',
                                      'set_collection_location_active', 'delete_collection_location',
                                      'tg_immutable_except', 'tg_one_way_product_refs', 'tg_followup_reason_delete_guard')),
  'PR 1.4: the seven tables, the sixteen RPC functions and the three trigger functions are gone');
-- The two replaced PR 1.3 functions are back to their PR 1.3 text: md5(prosrc) and
-- md5(pg_get_functiondef) as computed on a database built from the PR 1.3 migration alone
-- (PostgreSQL 17; docs/review/step1-pr14/README.md).
select results_eq(
  $$ select p.proname::text collate "default", md5(p.prosrc) collate "default", md5(pg_get_functiondef(p.oid)) collate "default"
     from pg_proc p where p.oid in ('private.tg_audit_target()'::regprocedure, 'public.test_data_census()'::regprocedure)
     order by p.proname::text collate "C" $$,
  $$ values ('test_data_census', '3211abf9cee3aeaff37e295c8c7dd676', 'a3705a984b6b73006525560cbd73b131'),
            ('tg_audit_target', 'e40c9e2a67f38646423a415e920123e5', '449514a6a5762e5f9338920fc57440f0') $$,
  'PR 1.4: tg_audit_target and test_data_census are restored byte for byte to PR 1.3');
select is(
  (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = any (array['audit_row_hash', 'audit_chain_verify', 'write_audit', 'tg_audit_target', 'tg_audit_chain',
                                'tg_reject_update_delete', 'tg_reject_truncate', 'tg_one_way_people']::name[])),
  'b3b1ee523bf02f0a9d6f72ca5effb820',
  'PR 1.4: the audit anchor''s functions fingerprint is back to the PR 1.3 value');
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid)
     from pg_constraint k where k.conrelid = 'public.audit_logs'::regclass
       and k.conname in ('audit_logs_action_check', 'audit_logs_target_table_check')
     order by k.conname::text collate "C" $$,
  $$ values
     ('audit_logs_action_check', 'CHECK ((action = ANY (ARRAY[''matrix.value_set''::text, ''matrix.value_approved''::text, ''account_request.created''::text, ''account_request.approved''::text, ''account_request.rejected''::text, ''account_request.cancelled''::text, ''account_creation.authorized''::text, ''profile.created''::text, ''profile.role_changed''::text, ''profile.activated''::text, ''profile.deactivated''::text, ''profile.updated''::text, ''technician.created''::text, ''technician.updated''::text, ''technician.outlook_email_changed''::text, ''credentials.change_authorized''::text, ''creator.bootstrapped''::text])))'),
     ('audit_logs_target_table_check', 'CHECK ((target_table = ANY (ARRAY[''profiles''::text, ''technicians''::text, ''account_requests''::text, ''role_permissions''::text])))') $$,
  'PR 1.4: the two audit_logs CHECKs are restored to the PR 1.3 lists');
select ok(
  not exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000' or name = 'reference_customers_products')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000'),
  'PR 1.4: its history rows are removed (CLI version and MCP name); the PR 1.3 row stays');
select results_eq(
  $$ select c.relname::text collate "default", a.privilege_type::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and a.grantee = 'authenticated'::regrole
     order by c.relname::text collate "C", a.privilege_type::text $$,
  $$ values ('account_requests', 'SELECT'), ('audit_logs', 'SELECT'), ('permissions', 'SELECT'),
            ('profiles', 'SELECT'), ('role_permissions', 'SELECT'), ('technicians', 'SELECT') $$,
  'PR 1.4: the PR 1.3 table grants are intact (SELECT for authenticated on the six PR 1.3 tables)');
select ok(
  has_function_privilege('authenticated', 'public.test_data_census()', 'execute')
  and not has_function_privilege('anon', 'public.test_data_census()', 'execute')
  and not has_function_privilege('service_role', 'public.test_data_census()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_audit_target()', 'execute')
  and exists (select 1 from pg_trigger t where t.tgrelid = 'public.audit_logs'::regclass and t.tgname = 't20_audit_target'
                and t.tgfoid = 'private.tg_audit_target()'::regprocedure and t.tgenabled = 'O'),
  'PR 1.4: the restored functions keep their PR 1.3 grants and the audit_logs trigger still runs tg_audit_target');
select results_eq(
  $$ select table_name from public.test_data_census() order by table_name collate "C" $$,
  $$ values ('account_requests'), ('audit_logs'), ('permissions'), ('profiles'), ('role_permissions'), ('storage'), ('technicians') $$,
  'PR 1.4: the census covers the PR 1.3 tables again');

-- ---------------------------------------------------------------------------------------------
-- PR 1.3 (Migration 1) down script
-- ---------------------------------------------------------------------------------------------

-- Fail closed (review S4): with one profile present (inserted inside the tested statement, so it is
-- rolled back with it), the down script (one DO block, re-review R-S3) refuses and nothing is dropped.
select throws_ok($rollback$
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rollback-probe@example.test', now(), now());
insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000000f9', 'technician', 'בדיקת שחזור');
-- >>> BEGIN supabase/rollback/20261104120000_access_and_permissions.down.sql
-- Rollback (down) script for supabase/migrations/20261104120000_access_and_permissions.sql
-- (Step 1 / PR 1.3). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before Step 2. After the first Creator is bootstrapped (D49) this script would
-- destroy the real Creator's profile and the audit evidence; it refuses to run as soon as any
-- profile, technician, request or audit row exists.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- It also removes the migration history row (CLI version or MCP name, step 6) and refuses to run
-- when the history table exists without one.
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (re-review R-S3): the refusal, every DROP and the history
-- delete are one statement, so a refusal or any error cancels all of it whatever the client
-- flags (also with plain `psql -f`). Static DDL only (no EXECUTE).
-- Explicit drops in reverse order, no CASCADE: an unexpected dependent object makes it fail
-- instead of silently dropping more. It deliberately keeps the privilege hardening (revoked
-- default privileges and grants; owner question Q2 in docs/review/step1-pr13): restoring Supabase's permissive defaults
-- would reopen the known anon finding.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, two prove that it refuses to run (data present; no history row, step 6).

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed (S4): refuse to run once any account, request or audit row exists (for example
  --    after the first Creator was bootstrapped, D49). Nothing is dropped then.
  if exists (select 1 from public.profiles) or exists (select 1 from public.technicians)
     or exists (select 1 from public.account_requests) or exists (select 1 from public.audit_logs) then
    raise exception using errcode = '55000',
      message = 'rollback refused: accounts, requests or audit rows exist; this down script is valid only before Step 2';
  end if;

  -- 1. Public API (SECURITY INVOKER wrappers and the census).
  drop function public.test_data_census();
  drop function public.cancel_account_request(uuid, integer);
  drop function public.decide_account_request(uuid, text, integer, text);
  drop function public.request_account_change(text, uuid, text, text, text);
  drop function public.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function public.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function public.admin_update_profile(uuid, integer, text, text, text);
  drop function public.admin_set_user_active(uuid, boolean, integer, text);
  drop function public.admin_set_user_role(uuid, text, integer, text);
  drop function public.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function public.authorize_account_creation(text, text, text);
  drop function public.assert_can_change_credentials(uuid, text);
  drop function public.assert_can_manage(text);
  drop function public.admin_approve_role_permission(text, text, integer);
  drop function public.admin_set_role_permission(text, text, boolean, integer, text);
  drop function public.my_technician_id();
  drop function public.is_creator();
  drop function public.has_permission(text);

  -- 2. Private RPC bodies, the first-Creator function and the internal functions
  --    (require_caller returns the profiles row type, so it goes before the table).
  drop function private.bootstrap_first_creator(uuid, text);
  drop function private.cancel_account_request(uuid, integer);
  drop function private.decide_account_request(uuid, text, integer, text);
  drop function private.request_account_change(text, uuid, text, text, text);
  drop function private.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function private.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function private.admin_update_profile(uuid, integer, text, text, text);
  drop function private.admin_set_user_active(uuid, boolean, integer, text);
  drop function private.admin_set_user_role(uuid, text, integer, text);
  drop function private.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function private.authorize_account_creation(text, text, text);
  drop function private.assert_can_change_credentials(uuid, text);
  drop function private.assert_can_manage(text);
  drop function private.admin_approve_role_permission(text, text, integer);
  drop function private.admin_set_role_permission(text, text, boolean, integer, text);
  drop function private.require_caller(text[]);
  drop function private.audit_chain_verify(bigint, text);
  drop function private.write_audit(text, text, uuid, jsonb);

  -- 3. Tables. Their triggers, policies, indexes, constraints and the identity sequence go with
  --    them (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.audit_logs;
  drop table public.account_requests;
  drop table public.role_permissions;
  drop table public.permissions;
  drop table public.technicians;
  drop table public.profiles;

  -- 4. Helpers (used by the policies dropped above) and trigger functions.
  drop function private.my_technician_id();
  drop function private.has_permission(text);
  drop function private.is_office_user();
  drop function private.is_creator();
  drop function private.has_role(text);
  drop function private.is_active_user();
  drop function private.tg_audit_chain();
  drop function private.tg_audit_target();
  drop function private.audit_row_hash(text, bigint, timestamptz, uuid, text, text, uuid, boolean, jsonb);
  drop function private.tg_account_request_guard();
  drop function private.tg_technician_guard();
  drop function private.tg_profile_guard();
  drop function private.tg_one_way_people();
  drop function private.tg_reject_truncate();
  drop function private.tg_reject_delete();
  drop function private.tg_reject_update_delete();
  drop function private.tg_immutable_markers();
  drop function private.tg_bump_version();

  -- 5. The private schema (empty by now; it fails if anything else was added to it).
  drop schema private;

  -- 6. The migration history, so the migration can be applied again and is never listed as applied
  --    once its objects are gone (review OPS-1). The CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which
  --    must be 'access_and_permissions' (docs/review/step1-pr13/README.md section 10). Every row
  --    with either is removed. When the history table exists but holds neither, the whole rollback
  --    is refused (nothing is dropped): find the recorded row first.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261104120000' or name = 'access_and_permissions';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261104120000 or name access_and_permissions; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261104120000_access_and_permissions.down.sql
$rollback$,
  '55000', 'rollback refused: accounts, requests or audit rows exist; this down script is valid only before Step 2',
  'the down script refuses to run once a profile exists (fail closed)');
select ok(
  to_regnamespace('private') is not null and to_regclass('public.audit_logs') is not null
  and to_regprocedure('public.admin_create_profile(uuid,text,text,text,text,uuid)') is not null
  and (select count(*) from public.profiles) = 0
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000'),
  'after the refused run nothing was dropped and the fixture is gone');

-- Review OPS-1: without a migration history row (the CLI's version or the MCP name) the rollback
-- is refused as a whole, so the history can never list the migration as applied once its objects
-- are gone. The history row is deleted inside the tested statement, so it comes back with it.
select throws_ok($rollback$
delete from supabase_migrations.schema_migrations where version = '20261104120000' or name = 'access_and_permissions';
-- >>> BEGIN supabase/rollback/20261104120000_access_and_permissions.down.sql
-- Rollback (down) script for supabase/migrations/20261104120000_access_and_permissions.sql
-- (Step 1 / PR 1.3). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before Step 2. After the first Creator is bootstrapped (D49) this script would
-- destroy the real Creator's profile and the audit evidence; it refuses to run as soon as any
-- profile, technician, request or audit row exists.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- It also removes the migration history row (CLI version or MCP name, step 6) and refuses to run
-- when the history table exists without one.
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (re-review R-S3): the refusal, every DROP and the history
-- delete are one statement, so a refusal or any error cancels all of it whatever the client
-- flags (also with plain `psql -f`). Static DDL only (no EXECUTE).
-- Explicit drops in reverse order, no CASCADE: an unexpected dependent object makes it fail
-- instead of silently dropping more. It deliberately keeps the privilege hardening (revoked
-- default privileges and grants; owner question Q2 in docs/review/step1-pr13): restoring Supabase's permissive defaults
-- would reopen the known anon finding.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, two prove that it refuses to run (data present; no history row, step 6).

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed (S4): refuse to run once any account, request or audit row exists (for example
  --    after the first Creator was bootstrapped, D49). Nothing is dropped then.
  if exists (select 1 from public.profiles) or exists (select 1 from public.technicians)
     or exists (select 1 from public.account_requests) or exists (select 1 from public.audit_logs) then
    raise exception using errcode = '55000',
      message = 'rollback refused: accounts, requests or audit rows exist; this down script is valid only before Step 2';
  end if;

  -- 1. Public API (SECURITY INVOKER wrappers and the census).
  drop function public.test_data_census();
  drop function public.cancel_account_request(uuid, integer);
  drop function public.decide_account_request(uuid, text, integer, text);
  drop function public.request_account_change(text, uuid, text, text, text);
  drop function public.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function public.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function public.admin_update_profile(uuid, integer, text, text, text);
  drop function public.admin_set_user_active(uuid, boolean, integer, text);
  drop function public.admin_set_user_role(uuid, text, integer, text);
  drop function public.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function public.authorize_account_creation(text, text, text);
  drop function public.assert_can_change_credentials(uuid, text);
  drop function public.assert_can_manage(text);
  drop function public.admin_approve_role_permission(text, text, integer);
  drop function public.admin_set_role_permission(text, text, boolean, integer, text);
  drop function public.my_technician_id();
  drop function public.is_creator();
  drop function public.has_permission(text);

  -- 2. Private RPC bodies, the first-Creator function and the internal functions
  --    (require_caller returns the profiles row type, so it goes before the table).
  drop function private.bootstrap_first_creator(uuid, text);
  drop function private.cancel_account_request(uuid, integer);
  drop function private.decide_account_request(uuid, text, integer, text);
  drop function private.request_account_change(text, uuid, text, text, text);
  drop function private.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function private.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function private.admin_update_profile(uuid, integer, text, text, text);
  drop function private.admin_set_user_active(uuid, boolean, integer, text);
  drop function private.admin_set_user_role(uuid, text, integer, text);
  drop function private.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function private.authorize_account_creation(text, text, text);
  drop function private.assert_can_change_credentials(uuid, text);
  drop function private.assert_can_manage(text);
  drop function private.admin_approve_role_permission(text, text, integer);
  drop function private.admin_set_role_permission(text, text, boolean, integer, text);
  drop function private.require_caller(text[]);
  drop function private.audit_chain_verify(bigint, text);
  drop function private.write_audit(text, text, uuid, jsonb);

  -- 3. Tables. Their triggers, policies, indexes, constraints and the identity sequence go with
  --    them (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.audit_logs;
  drop table public.account_requests;
  drop table public.role_permissions;
  drop table public.permissions;
  drop table public.technicians;
  drop table public.profiles;

  -- 4. Helpers (used by the policies dropped above) and trigger functions.
  drop function private.my_technician_id();
  drop function private.has_permission(text);
  drop function private.is_office_user();
  drop function private.is_creator();
  drop function private.has_role(text);
  drop function private.is_active_user();
  drop function private.tg_audit_chain();
  drop function private.tg_audit_target();
  drop function private.audit_row_hash(text, bigint, timestamptz, uuid, text, text, uuid, boolean, jsonb);
  drop function private.tg_account_request_guard();
  drop function private.tg_technician_guard();
  drop function private.tg_profile_guard();
  drop function private.tg_one_way_people();
  drop function private.tg_reject_truncate();
  drop function private.tg_reject_delete();
  drop function private.tg_reject_update_delete();
  drop function private.tg_immutable_markers();
  drop function private.tg_bump_version();

  -- 5. The private schema (empty by now; it fails if anything else was added to it).
  drop schema private;

  -- 6. The migration history, so the migration can be applied again and is never listed as applied
  --    once its objects are gone (review OPS-1). The CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which
  --    must be 'access_and_permissions' (docs/review/step1-pr13/README.md section 10). Every row
  --    with either is removed. When the history table exists but holds neither, the whole rollback
  --    is refused (nothing is dropped): find the recorded row first.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261104120000' or name = 'access_and_permissions';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261104120000 or name access_and_permissions; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261104120000_access_and_permissions.down.sql
$rollback$,
  '55000', 'rollback refused: no migration history row with version 20261104120000 or name access_and_permissions; nothing was dropped',
  'OPS-1: the down script refuses when the history table holds no row for the migration');
select ok(
  to_regnamespace('private') is not null and to_regclass('public.audit_logs') is not null
  and to_regprocedure('public.admin_create_profile(uuid,text,text,text,text,uuid)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000'),
  'after that refusal nothing was dropped and the history row is still there');

-- The run on the empty tables. Review OPS-1: an MCP apply records a version the server assigns,
-- with the name passed to it; an MCP-style row stands for one here (a re-apply would add such a
-- row next to the CLI's), and the down script removes both.
insert into supabase_migrations.schema_migrations (version, name) values ('20261110093012', 'access_and_permissions');

-- >>> BEGIN supabase/rollback/20261104120000_access_and_permissions.down.sql
-- Rollback (down) script for supabase/migrations/20261104120000_access_and_permissions.sql
-- (Step 1 / PR 1.3). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before Step 2. After the first Creator is bootstrapped (D49) this script would
-- destroy the real Creator's profile and the audit evidence; it refuses to run as soon as any
-- profile, technician, request or audit row exists.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53).
-- It also removes the migration history row (CLI version or MCP name, step 6) and refuses to run
-- when the history table exists without one.
-- Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (re-review R-S3): the refusal, every DROP and the history
-- delete are one statement, so a refusal or any error cancels all of it whatever the client
-- flags (also with plain `psql -f`). Static DDL only (no EXECUTE).
-- Explicit drops in reverse order, no CASCADE: an unexpected dependent object makes it fail
-- instead of silently dropping more. It deliberately keeps the privilege hardening (revoked
-- default privileges and grants; owner question Q2 in docs/review/step1-pr13): restoring Supabase's permissive defaults
-- would reopen the known anon finding.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, two prove that it refuses to run (data present; no history row, step 6).

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed (S4): refuse to run once any account, request or audit row exists (for example
  --    after the first Creator was bootstrapped, D49). Nothing is dropped then.
  if exists (select 1 from public.profiles) or exists (select 1 from public.technicians)
     or exists (select 1 from public.account_requests) or exists (select 1 from public.audit_logs) then
    raise exception using errcode = '55000',
      message = 'rollback refused: accounts, requests or audit rows exist; this down script is valid only before Step 2';
  end if;

  -- 1. Public API (SECURITY INVOKER wrappers and the census).
  drop function public.test_data_census();
  drop function public.cancel_account_request(uuid, integer);
  drop function public.decide_account_request(uuid, text, integer, text);
  drop function public.request_account_change(text, uuid, text, text, text);
  drop function public.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function public.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function public.admin_update_profile(uuid, integer, text, text, text);
  drop function public.admin_set_user_active(uuid, boolean, integer, text);
  drop function public.admin_set_user_role(uuid, text, integer, text);
  drop function public.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function public.authorize_account_creation(text, text, text);
  drop function public.assert_can_change_credentials(uuid, text);
  drop function public.assert_can_manage(text);
  drop function public.admin_approve_role_permission(text, text, integer);
  drop function public.admin_set_role_permission(text, text, boolean, integer, text);
  drop function public.my_technician_id();
  drop function public.is_creator();
  drop function public.has_permission(text);

  -- 2. Private RPC bodies, the first-Creator function and the internal functions
  --    (require_caller returns the profiles row type, so it goes before the table).
  drop function private.bootstrap_first_creator(uuid, text);
  drop function private.cancel_account_request(uuid, integer);
  drop function private.decide_account_request(uuid, text, integer, text);
  drop function private.request_account_change(text, uuid, text, text, text);
  drop function private.admin_update_technician(uuid, integer, text, text, text, text, boolean);
  drop function private.admin_create_technician(uuid, text, text, text, text, boolean);
  drop function private.admin_update_profile(uuid, integer, text, text, text);
  drop function private.admin_set_user_active(uuid, boolean, integer, text);
  drop function private.admin_set_user_role(uuid, text, integer, text);
  drop function private.admin_create_profile(uuid, text, text, text, text, uuid);
  drop function private.authorize_account_creation(text, text, text);
  drop function private.assert_can_change_credentials(uuid, text);
  drop function private.assert_can_manage(text);
  drop function private.admin_approve_role_permission(text, text, integer);
  drop function private.admin_set_role_permission(text, text, boolean, integer, text);
  drop function private.require_caller(text[]);
  drop function private.audit_chain_verify(bigint, text);
  drop function private.write_audit(text, text, uuid, jsonb);

  -- 3. Tables. Their triggers, policies, indexes, constraints and the identity sequence go with
  --    them (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.audit_logs;
  drop table public.account_requests;
  drop table public.role_permissions;
  drop table public.permissions;
  drop table public.technicians;
  drop table public.profiles;

  -- 4. Helpers (used by the policies dropped above) and trigger functions.
  drop function private.my_technician_id();
  drop function private.has_permission(text);
  drop function private.is_office_user();
  drop function private.is_creator();
  drop function private.has_role(text);
  drop function private.is_active_user();
  drop function private.tg_audit_chain();
  drop function private.tg_audit_target();
  drop function private.audit_row_hash(text, bigint, timestamptz, uuid, text, text, uuid, boolean, jsonb);
  drop function private.tg_account_request_guard();
  drop function private.tg_technician_guard();
  drop function private.tg_profile_guard();
  drop function private.tg_one_way_people();
  drop function private.tg_reject_truncate();
  drop function private.tg_reject_delete();
  drop function private.tg_reject_update_delete();
  drop function private.tg_immutable_markers();
  drop function private.tg_bump_version();

  -- 5. The private schema (empty by now; it fails if anything else was added to it).
  drop schema private;

  -- 6. The migration history, so the migration can be applied again and is never listed as applied
  --    once its objects are gone (review OPS-1). The CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which
  --    must be 'access_and_permissions' (docs/review/step1-pr13/README.md section 10). Every row
  --    with either is removed. When the history table exists but holds neither, the whole rollback
  --    is refused (nothing is dropped): find the recorded row first.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261104120000' or name = 'access_and_permissions';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261104120000 or name access_and_permissions; nothing was dropped';
    end if;
  end if;
end
$down$;
-- <<< END supabase/rollback/20261104120000_access_and_permissions.down.sql

select ok(to_regnamespace('private') is null, 'the private schema is gone');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
  0::bigint, 'no table, index, sequence or view is left in public');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  0::bigint, 'no function is left in public');
select is(
  (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
  0::bigint, 'no policy is left in public');
select is(
  (select count(*) from pg_constraint k join pg_namespace n on n.oid = k.connamespace
   where k.confrelid = 'auth.users'::regclass and n.nspname = 'public'),
  0::bigint, 'no foreign key to auth.users is left');
select is(
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'),
  0::bigint, 'no trigger is left that calls a private function');
select is(
  (select count(*) from supabase_migrations.schema_migrations where version = '20261104120000' or name = 'access_and_permissions'),
  0::bigint, 'the migration history rows are removed (the CLI version and the MCP name, OPS-1), so the migration can be applied again');
select is(
  (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole
     and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
     and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))),
  0::bigint, 'the hardening stays: the default privileges of postgres still grant nothing to PUBLIC or the API roles');
select ok(
  exists (select 1 from pg_default_acl d
          where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
            and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
  'the hardening stays: functions created by postgres still get no EXECUTE for PUBLIC');
select ok(
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage')
  and not has_schema_privilege('anon', 'public', 'create') and not has_schema_privilege('authenticated', 'public', 'create'),
  'schema public keeps USAGE (PostgREST) and no CREATE for the API roles');

select * from finish();
rollback;
