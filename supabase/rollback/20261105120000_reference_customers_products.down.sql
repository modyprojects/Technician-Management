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
-- on the empty tables; the others prove that each refusal condition stops it.

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
