-- Rollback (down) script for supabase/migrations/20261110120000_field_visit_writers.sql (Step 4,
-- Version 1). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any Step 4 data exists. It refuses to run when any row exists in visit_media,
-- visit_reports, visit_signatures, visit_time_reports or offline_operations (the field writers of
-- this migration leave rows there, and before it no writer of a technician could), when a later
-- migration is recorded in the history (roll that one back first), or when the history table exists
-- without a row for this migration. The private bucket 'visit-media' and its objects are not part
-- of the migration (a separate owner-approved operation) and are not touched here.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53;
-- PR 1.3 B6). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restore
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the function that the migration replaced (public.test_data_census to its Step 6
-- text: a byte-identical body; CREATE OR REPLACE keeps its grants), then drops the Step 4 objects
-- in reverse order, with no CASCADE: an unexpected dependent object makes it fail instead of
-- silently dropping more. The policies on storage.objects are dropped by name; the policies and
-- triggers of visit_media go with the table. The Migration 1 to 6 objects, their grants and the
-- hardening stay. Run it before the Step 6 down script.
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
      where h.version = '20261110120000' or h.name = 'field_visit_writers') then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261110120000 or name field_visit_writers; nothing was dropped';
    end if;
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261110120000' or h.name = 'field_visit_writers')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any Step 4 row (a media row, a summary, a signature, a device time report or a device
  -- operation): nothing is dropped. These rows are never deleted, so the script is valid only
  -- before any Step 4 data.
  if exists (select 1 from public.visit_media) or exists (select 1 from public.visit_reports)
     or exists (select 1 from public.visit_signatures) or exists (select 1 from public.visit_time_reports)
     or exists (select 1 from public.offline_operations) then
    raise exception using errcode = '55000',
      message = 'rollback refused: Step 4 data exists (media, summaries, signatures, time reports or device operations); this down script is valid only before any Step 4 data';
  end if;

  -- 1. The function the migration replaced, restored to its earlier text (same ACL). Its body is
  --    copied byte for byte from the Step 6 migration, so it is not indented.
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
    select 'external_calendar_events', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'automated_test',
           count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.external_calendar_events x
    union all
    select 'calendar_event_changes', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_event_changes x
    union all
    select 'calendar_ingestion_errors', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_ingestion_errors x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

  -- 2. The two policies on storage.objects.
  drop policy visit_media_objects_select on storage.objects;
  drop policy visit_media_objects_insert_technician on storage.objects;

  -- 3. The five public wrappers and the five writers.
  drop function public.confirm_visit_media(uuid);
  drop function public.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz);
  drop function public.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text, integer,
    timestamptz);
  drop function public.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz);
  drop function public.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz);
  drop function private.confirm_visit_media(uuid);
  drop function private.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz);
  drop function private.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text, integer,
    timestamptz);
  drop function private.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz);
  drop function private.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz);

  -- 4. The four read helpers.
  drop function private.visit_media_object_readable(text);
  drop function private.visit_media_object_writable(text);
  drop function private.field_device_ok(timestamptz, text, integer, timestamptz);
  drop function private.field_payload_sha256(jsonb);

  -- 5. The column of visit_signatures (its unique index and foreign key first), the table (its
  --    policies, triggers, indexes and constraints go with it) and its trigger function.
  drop index public.visit_signatures_signature_media_id_key;
  alter table public.visit_signatures drop constraint visit_signatures_signature_media_id_fkey;
  alter table public.visit_signatures drop column signature_media_id;
  drop table public.visit_media;
  drop function private.tg_visit_media_state();

  -- 6. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'field_visit_writers'. Every row with either is removed (step 0 refused when none exists;
  --    the count is checked again here).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261110120000' or name = 'field_visit_writers';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261110120000 or name field_visit_writers; nothing was dropped';
    end if;
  end if;
end
$down$;
