-- Rollback (down) script for supabase/migrations/20261107120000_integrity_offline.sql
-- (Step 1 / PR 1.6). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.6 data exists. It refuses to run when any row exists in the three
-- PR 1.6 tables (review_items, visit_corrections, offline_operations), when a visit_time_reports
-- row is a correction, when an audit row records a PR 1.6 action or targets a PR 1.6 target table
-- (visits, review_items), when a later migration is recorded in the history (roll that one back
-- first), or when the history table exists without a row for this migration.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53;
-- PR 1.3 B6). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the three functions that the migration replaced (public.test_data_census and
-- private.tg_time_report_derive to their PR 1.5 text, private.tg_audit_target to its PR 1.4 text:
-- byte-identical bodies; CREATE OR REPLACE keeps their grants and triggers), the two audit_logs
-- CHECKs (PR 1.4), the visit_time_reports source CHECK and table comment (PR 1.5), then drops the
-- PR 1.6 objects in reverse order, with no CASCADE: an unexpected dependent object makes it fail
-- instead of silently dropping more. The two visit_time_reports columns are dropped (their rows are
-- all NULL then); visits keeps its field_version values (a PR 1.5 column). The PR 1.3 to PR 1.5
-- objects, their grants and the hardening stay. Run it before the PR 1.5 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 9) and
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
      where h.version = '20261107120000' or h.name = 'integrity_offline') then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261107120000 or name integrity_offline; nothing was dropped';
    end if;
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261107120000' or h.name = 'integrity_offline')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.6 row (a review item, a correction, an offline operation, a corrected or accepted
  -- field time, or an audit row of a PR 1.6 action or target): nothing is dropped. These rows are
  -- append-only or never deleted, so the script is valid only before any PR 1.6 data.
  if exists (select 1 from public.review_items) or exists (select 1 from public.visit_corrections)
     or exists (select 1 from public.offline_operations)
     or exists (select 1 from public.visit_time_reports t where t.source <> 'device')
     or exists (select 1 from public.audit_logs a
                where a.action in ('visit.corrected', 'review_item.resolved')
                   or a.target_table in ('visits', 'review_items')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data';
  end if;

  -- 1. The functions the migration replaced, restored to their earlier text (same ACL, same
  --    triggers). Their bodies are copied byte for byte from the PR 1.5 and PR 1.4 migrations, so
  --    they are not indented.
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
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;
  create or replace function private.tg_time_report_derive()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
declare
  v_tech_profile_id uuid;
  v_tech_is_test boolean;
  v_visit_technician_id uuid;
  v_assigned_at timestamptz;
  v_flags text[] := '{}';
begin
  new.received_at := now();
  new.clock_skew_ms := null;
  select t.profile_id, t.is_test into v_tech_profile_id, v_tech_is_test
  from public.technicians t where t.id = new.technician_id;
  if not found then
    raise exception using errcode = '23503', message = 'visit_time_reports: unknown technician';
  end if;
  if new.is_test is not true and v_tech_is_test then
    raise exception using errcode = '23514', message = 'visit_time_reports: a real record cannot reference test data (D47)';
  end if;
  if new.source = 'device' and v_tech_profile_id is distinct from new.reported_by_profile_id then
    raise exception using errcode = '23514', message = 'visit_time_reports: a device report is credited to the technician who reported it';
  end if;
  select v.technician_id, v.assigned_at into v_visit_technician_id, v_assigned_at
  from public.visits v where v.id = new.visit_id;
  if not found then
    raise exception using errcode = '23503', message = 'visit_time_reports: unknown visit';
  end if;
  if new.device_sent_at is not null and isfinite(new.device_sent_at) then
    new.clock_skew_ms := round(extract(epoch from (new.device_sent_at - new.received_at)) * 1000)::bigint;
    if new.reported_at is not null and isfinite(new.reported_at)
       and extract(epoch from (new.reported_at - new.received_at)) * 1000 - new.clock_skew_ms > 120000 then
      v_flags := v_flags || 'future_time'::text;
    end if;
    if abs(new.clock_skew_ms) > 300000 then
      v_flags := v_flags || 'large_skew'::text;
    end if;
    if new.reported_at is not null and isfinite(new.reported_at)
       and new.technician_id = v_visit_technician_id
       and extract(epoch from (new.reported_at - v_assigned_at)) * 1000 - new.clock_skew_ms < 0 then
      v_flags := v_flags || 'before_assignment'::text;
    end if;
  end if;
  new.row_flags := v_flags;
  return new;
end
$$;
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
    when 'call_types' then (select x.is_test from public.call_types x where x.id = new.target_id)
    when 'followup_reasons' then (select x.is_test from public.followup_reasons x where x.id = new.target_id)
    when 'collection_locations' then (select x.is_test from public.collection_locations x where x.id = new.target_id)
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

  -- 2. The public API wrappers, then the writers and the internal helpers.
  drop function public.correct_visit(uuid, text, text, text, integer);
  drop function public.resolve_review_item(uuid, integer, text, jsonb, text);
  drop function private.correct_visit(uuid, text, text, text, integer);
  drop function private.resolve_review_item(uuid, integer, text, jsonb, text);
  drop function private.create_review_item(text, text, uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb);
  drop function private.offline_operation_replay(uuid, uuid, text, text);
  drop function private.record_offline_operation(uuid, uuid, text, text, integer, timestamptz, text, integer, text, integer, uuid);

  -- 3. visit_time_reports back to PR 1.5: the correction keys, CHECKs and indexes, the two columns,
  --    the source CHECK and the table comment.
  alter table public.visit_time_reports
    drop constraint visit_time_reports_accepted_review_id_fkey,
    drop constraint visit_time_reports_correction_id_fkey,
    drop constraint visit_time_reports_accepted_check,
    drop constraint visit_time_reports_correction_check,
    drop constraint visit_time_reports_source_check;
  drop index public.visit_time_reports_correction_id_key;
  drop index public.visit_time_reports_accepted_review_id_key;
  alter table public.visit_time_reports
    drop column correction_id,
    drop column accepted_review_id;
  alter table public.visit_time_reports
    add constraint visit_time_reports_source_check check (source = 'device');
  comment on table public.visit_time_reports is
    'Device-reported field times (D45). Append-only; flagged, never rejected for clock values; current value in public.visit_time_current. No write path in PR 1.5 (Step 4, PR 1.6).';

  -- 4. Tables, in reverse dependency order. Their triggers, policies, indexes and constraints go
  --    with them (DROP is neither DELETE nor TRUNCATE, so the row triggers do not fire).
  drop table public.offline_operations;
  drop table public.visit_corrections;
  drop table public.review_items;

  -- 5. visits back to PR 1.5: the field_version trigger, the closed-visit freeze and the parent key
  --    of review_items; visit_reports without the PR 1.6 freeze (its PR 1.5 t10 was never changed).
  drop trigger t13_field_version on public.visits;
  drop trigger t14_closed_fields on public.visits;
  alter table public.visits drop constraint visits_id_service_call_id_key;
  drop trigger t11_frozen on public.visit_reports;

  -- 6. The two audit_logs CHECKs back to PR 1.4 (no row uses a PR 1.6 action or target, step 0).
  alter table public.audit_logs
    drop constraint audit_logs_action_check,
    add constraint audit_logs_action_check check (action in (
      'matrix.value_set', 'matrix.value_approved',
      'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
      'account_creation.authorized',
      'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
      'technician.created', 'technician.updated', 'technician.outlook_email_changed',
      'credentials.change_authorized', 'creator.bootstrapped',
      'call_type.created', 'call_type.activated', 'call_type.deactivated',
      'followup_reason.created', 'followup_reason.activated', 'followup_reason.deactivated', 'followup_reason.deleted',
      'collection_location.created', 'collection_location.activated', 'collection_location.deactivated',
      'collection_location.deleted'));
  alter table public.audit_logs
    drop constraint audit_logs_target_table_check,
    add constraint audit_logs_target_table_check check (target_table in (
      'profiles', 'technicians', 'account_requests', 'role_permissions',
      'call_types', 'followup_reasons', 'collection_locations'));

  -- 7. The six trigger functions.
  drop function private.tg_call_child_marker();
  drop function private.tg_review_item_state();
  drop function private.tg_visit_correction_guard();
  drop function private.tg_offline_operation_derive();
  drop function private.tg_visit_field_version();
  drop function private.tg_visit_closed_fields();

  -- 8. (none: no role, no sequence, no view was created.)

  -- 9. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'integrity_offline'. Every row with either is removed (step 0 refused when none exists;
  --    the count is checked again here).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261107120000' or name = 'integrity_offline';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261107120000 or name integrity_offline; nothing was dropped';
    end if;
  end if;
end
$down$;
