-- Rollback (down) script for supabase/migrations/20261109120000_calendar_ingestion.sql (Step 6).
-- Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any Step 6 data exists. It refuses to run when any row exists in the three
-- Step 6 tables (external_calendar_events, calendar_event_changes, calendar_ingestion_errors; every
-- ingested or unparsed invitation leaves rows there, and the calls, visits, customers, products,
-- history rows and review items it created name them), when a later migration is recorded in the
-- history (roll that one back first), or when the history table exists without a row for this
-- migration.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53;
-- PR 1.3 B6). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restore
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the function that the migration replaced (public.test_data_census to its PR 1.6
-- text: a byte-identical body; CREATE OR REPLACE keeps its grants), then drops the Step 6 objects
-- in reverse order, with no CASCADE: an unexpected dependent object makes it fail instead of
-- silently dropping more. The policies and triggers go with their tables. The Migration 1 to 5
-- objects, their grants and the hardening stay. Run it before the PR 1.8 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 5) and
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
      where h.version = '20261109120000' or h.name = 'calendar_ingestion') then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261109120000 or name calendar_ingestion; nothing was dropped';
    end if;
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261109120000' or h.name = 'calendar_ingestion')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any Step 6 row (an invitation event, a received change or an unparsed invitation): nothing is
  -- dropped. These rows are never deleted, and the records ingestion created reference them by
  -- their opaque ids, so the script is valid only before any Step 6 data.
  if exists (select 1 from public.external_calendar_events) or exists (select 1 from public.calendar_event_changes)
     or exists (select 1 from public.calendar_ingestion_errors) then
    raise exception using errcode = '55000',
      message = 'rollback refused: Step 6 data exists (calendar events, received changes or unparsed invitations); this down script is valid only before any Step 6 data';
  end if;

  -- 1. The function the migration replaced, restored to its earlier text (same ACL). Its body is
  --    copied byte for byte from the PR 1.6 migration, so it is not indented.
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
    select 'service_calls', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.service_calls x
    union all
    select 'service_calls', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.service_calls x
    union all
    select 'service_calls', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.service_calls x
    union all
    select 'visits', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visits x
    union all
    select 'visit_reports', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_reports x
    union all
    select 'visit_signatures', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_signatures x
    union all
    select 'visit_time_reports', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_time_reports x
    union all
    select 'visit_events', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_events x
    union all
    select 'entity_changes', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.entity_changes x
    union all
    select 'review_items', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.review_items x
    union all
    select 'visit_corrections', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_corrections x
    union all
    select 'offline_operations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.offline_operations x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 2. The public wrapper, the writer and its helpers.
  drop function public.ingest_calendar_event(jsonb);
  drop function private.ingest_calendar_event(jsonb);
  drop function private.ingest_apply_call(public.service_calls, public.customers, public.products, boolean, jsonb, jsonb,
    timestamptz, uuid, uuid, text, text[], integer);
  drop function private.ingest_apply_visit(public.visits, jsonb, uuid, text, timestamptz, timestamptz, text, text, text, text,
    text, text, text, text, uuid, text, text[], integer);
  drop function private.ingest_answer(uuid, boolean);
  drop function private.ingest_field_source_at(uuid, uuid, text);
  drop function private.ingest_email(text);
  drop function private.ingest_ascii_id(text, integer);
  drop function private.ingest_safe_text(text, integer, boolean);
  drop function private.ingest_timestamp(jsonb, text);
  drop function private.ingest_text(jsonb, text);

  -- 3. The three tables (their policies, triggers, indexes and constraints go with them), children
  --    first.
  drop table public.calendar_ingestion_errors;
  drop table public.calendar_event_changes;
  drop table public.external_calendar_events;

  -- 4. The three trigger functions.
  drop function private.tg_ingestion_error_state();
  drop function private.tg_calendar_event_guard();
  drop function private.tg_calendar_child_marker();

  -- 5. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'calendar_ingestion'. Every row with either is removed (step 0 refused when none exists;
  --    the count is checked again here).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261109120000' or name = 'calendar_ingestion';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261109120000 or name calendar_ingestion; nothing was dropped';
    end if;
  end if;
end
$down$;
