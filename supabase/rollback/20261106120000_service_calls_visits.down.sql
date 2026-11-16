-- Rollback (down) script for supabase/migrations/20261106120000_service_calls_visits.sql
-- (Step 1 / PR 1.5). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.5 data exists. It refuses to run when any row exists in the seven
-- PR 1.5 tables (service_calls, visits, visit_reports, visit_signatures, visit_time_reports,
-- visit_events, entity_changes), when a later migration is recorded in the history (roll that one
-- back first), or when the history table exists without a row for this migration.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53;
-- PR 1.3 B6). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restore
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the PR 1.4 function that the migration replaced (public.test_data_census, a
-- byte-identical body; CREATE OR REPLACE keeps its grants), then drops the PR 1.5 objects in
-- reverse order, with no CASCADE: an unexpected dependent object makes it fail instead of silently
-- dropping more. The PR 1.3 and PR 1.4 objects, their grants and the hardening stay; the PR 1.4
-- delete RPCs keep their bodies (their "in use" path simply has no referencing table again). The
-- four constraint-trigger functions are owned by postgres (TEMPORARY, PR 1.5 OQ-2), so no role is
-- dropped. Run it before the PR 1.4 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 6) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables; the others prove that each refusal condition stops it.

do $down$
declare
  v_history_rows bigint;
begin
  -- 0. Fail closed, before anything is dropped. A later migration may depend on these objects:
  --    refuse, with a clear message instead of a dependency error at DROP time. The history table
  --    must hold this migration's row (the CLI version or the MCP name).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if not exists (
      select 1 from supabase_migrations.schema_migrations h
      where h.version = '20261106120000' or h.name = 'service_calls_visits') then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261106120000 or name service_calls_visits; nothing was dropped';
    end if;
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261106120000' or h.name = 'service_calls_visits')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.5 row (calls, visits, their reports, signatures, field times, status history or
  -- field history): nothing is dropped. These rows are append-only or never deleted, so the
  -- script is valid only before any PR 1.5 data.
  if exists (select 1 from public.service_calls) or exists (select 1 from public.visits)
     or exists (select 1 from public.visit_reports) or exists (select 1 from public.visit_signatures)
     or exists (select 1 from public.visit_time_reports) or exists (select 1 from public.visit_events)
     or exists (select 1 from public.entity_changes) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data';
  end if;

  -- 1. The PR 1.4 census, restored to its PR 1.4 text (same ACL). Its body is copied byte for byte
  --    from the PR 1.4 migration, so it is not indented.
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
    select 'brands', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.brands x
    union all
    select 'suppliers', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.suppliers x
    union all
    select 'products', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.products x
    union all
    select 'products', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.products x
    union all
    select 'products', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.products x
    union all
    select 'customers', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.customers x
    union all
    select 'customers', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.customers x
    union all
    select 'customers', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.customers x
    union all
    select 'call_types', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.call_types x
    union all
    select 'followup_reasons', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.followup_reasons x
    union all
    select 'collection_locations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.collection_locations x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 2. The view, then the public API wrappers.
  drop view public.visit_time_current;
  drop function public.my_visit_details(uuid);
  drop function public.visit_rep_contact(uuid);
  drop function public.previous_visits(uuid);

  -- 3. The private functions: the narrow bodies, the visit-read helper, the call-status functions
  --    and the field-history writer.
  drop function private.my_visit_details(uuid);
  drop function private.visit_rep_contact(uuid);
  drop function private.previous_visits(uuid);
  drop function private.can_read_visit(uuid);
  drop function private.recalc_call_status(uuid);
  drop function private.compute_call_status(uuid);
  drop function private.write_entity_change(text, uuid, text, jsonb, jsonb, text, text);

  -- 4. Tables, in reverse dependency order. Their triggers, constraint triggers, policies, indexes,
  --    identity sequences and constraints go with them (DROP is neither DELETE nor TRUNCATE, so the
  --    row triggers do not fire).
  drop table public.entity_changes;
  drop table public.visit_events;
  drop table public.visit_time_reports;
  drop table public.visit_signatures;
  drop table public.visit_reports;
  drop table public.visits;
  drop table public.service_calls;

  -- 5. The ten trigger functions and the four constraint-trigger functions.
  drop function private.tg_visit_marker();
  drop function private.tg_visit_child_marker();
  drop function private.tg_history_server_time();
  drop function private.tg_entity_change_target();
  drop function private.tg_one_way_call_refs();
  drop function private.tg_one_way_visit_refs();
  drop function private.tg_visit_number_guard();
  drop function private.tg_service_call_guard();
  drop function private.tg_visit_state_guard();
  drop function private.tg_time_report_derive();
  drop function private.ct_visit_rules();
  drop function private.ct_service_call_rules();
  drop function private.ct_signature_rules();
  drop function private.ct_report_rules();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'service_calls_visits'. Every row with either is removed (step 0 refused when none
  --    exists; the count is checked again here).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261106120000' or name = 'service_calls_visits';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261106120000 or name service_calls_visits; nothing was dropped';
    end if;
  end if;
end
$down$;
