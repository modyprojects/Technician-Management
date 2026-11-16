-- PR 1.3 to PR 1.6: the rollback (down) scripts, tested inside this transaction and rolled back
-- (docs/database-schema.md "Migration order and approval checklist" item 6). The blocks between
-- the markers are byte-identical copies of the down scripts; tests/ci/rollback.test.mjs fails if
-- they differ. The newest migration's script runs first: the PR 1.6 script, then the PR 1.5 script
-- (which refuses while the PR 1.6 history row is recorded), then the PR 1.4 script (which cannot
-- run while PR 1.5 objects depend on its tables), then the PR 1.3 script (which cannot run while
-- PR 1.4 objects depend on its tables and helpers). Manual runs on the local stack (down, catalog
-- checks, re-apply) are in docs/review/step1-pr13/README.md, docs/review/step1-pr14/README.md,
-- docs/review/step1-pr15/README.md and docs/review/step1-pr16/README.md.
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

select ok(to_regnamespace('private') is not null and to_regclass('public.profiles') is not null,
  'positive control: the migration is applied before the rollback runs');

-- ---------------------------------------------------------------------------------------------
-- PR 1.6 (Migration 4) down script, first: the newest migration's script runs before the others.
-- ---------------------------------------------------------------------------------------------
select ok(
  to_regclass('public.review_items') is not null and to_regclass('public.visit_corrections') is not null
  and to_regclass('public.offline_operations') is not null
  and to_regprocedure('public.correct_visit(uuid,text,text,text,integer)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000'),
  'PR 1.6 positive control: Migration 4 is applied before its rollback runs');

-- Fail closed: an invitation review item (a re-assignment of a scheduled visit, stored through
-- create_review_item as the Step 6 ingestion will store it), with its call and visit, all inserted
-- inside the tested statement, so they are rolled back with it, deferred checks included.
select throws_ok($rollback$
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000016e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'tech-1690@example.test', now(), now());
insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000016e1', 'technician', 'טכנאי בדיקת שחזור');
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email)
  values ('00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016e1', true, 'טכנאי בדיקת שחזור', 't-y',
          'tech-1690-o@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000016c1', 'C-16901', 'לקוח בדיקת שחזור', '050-000-1691', 'automated_test', 'pr16-990-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000016d1', 'RB-16901', 'RB-16901', 'מוצר בדיקת שחזור', 'automated_test', 'pr16-990-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
  select '00000000-0000-4000-8000-0000000016a1', 'R-16901', '00000000-0000-4000-8000-0000000016c1',
         '00000000-0000-4000-8000-0000000016d1', t.id, 'תקלת בדיקת שחזור', 'נציגת בדיקה', 'open', 2,
         'automated_test', 'pr16-990-1'
  from public.call_types t where t.sort_order = 1;
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
  values ('00000000-0000-4000-8000-0000000016b1', '00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016f1',
          1, 'T-16901', now() + interval '1 day', now() + interval '1 day 2 hours', 'scheduled', 'עיר בדיקה', 'רחוב בדיקה',
          'pr16-990-1');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-0000000016b1', 1, 'created', 'scheduled');
select private.create_review_item('reassignment', 'pr16-990-ri-1', '00000000-0000-4000-8000-0000000016a1',
  '00000000-0000-4000-8000-0000000016b1', 'invitation', 'pr16-990-evt-1', null, '{"technician": "ב"}', '{"technician": "א"}', null);
-- >>> BEGIN supabase/rollback/20261107120000_integrity_offline.down.sql
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
-- <<< END supabase/rollback/20261107120000_integrity_offline.down.sql
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses to run once a review item exists (fail closed)');
select ok(
  to_regclass('public.review_items') is not null and to_regprocedure('private.resolve_review_item(uuid,integer,text,jsonb,text)') is not null
  and (select count(*) from public.review_items) + (select count(*) from public.service_calls) + (select count(*) from public.visits) = 0
  and not exists (select 1 from public.technicians)
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000'),
  'PR 1.6: after the refused run nothing was dropped and the fixture is gone');

-- A later migration is recorded: refused with a clear message (not a dependency error at DROP time).
select throws_ok($rollback$
insert into supabase_migrations.schema_migrations (version, name) values ('20261201000000', 'later_migration_probe');
-- >>> BEGIN supabase/rollback/20261107120000_integrity_offline.down.sql
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
-- <<< END supabase/rollback/20261107120000_integrity_offline.down.sql
$rollback$,
  '55000', 'rollback refused: a later migration is recorded; roll it back first',
  'PR 1.6: the down script refuses while a later migration is recorded');
select ok(
  to_regclass('public.visit_corrections') is not null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '20261201000000'),
  'PR 1.6: after that refusal nothing was dropped and the probe row is gone');

-- OPS-1 (as in PR 1.3 to PR 1.5): without a history row (the CLI's version or the MCP name) the
-- rollback is refused before anything is dropped. The history row is deleted inside the tested
-- statement.
select throws_ok($rollback$
delete from supabase_migrations.schema_migrations where version = '20261107120000' or name = 'integrity_offline';
-- >>> BEGIN supabase/rollback/20261107120000_integrity_offline.down.sql
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
-- <<< END supabase/rollback/20261107120000_integrity_offline.down.sql
$rollback$,
  '55000', 'rollback refused: no migration history row with version 20261107120000 or name integrity_offline; nothing was dropped',
  'PR 1.6: the down script refuses when the history table holds no row for the migration');
select ok(
  to_regclass('public.offline_operations') is not null and to_regprocedure('public.resolve_review_item(uuid,integer,text,jsonb,text)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000'),
  'PR 1.6: after that refusal nothing was dropped and the history row is still there');

-- Review TEST-2 (as in PR 1.4 and PR 1.5): each refusal condition alone. One more byte-identical
-- copy, inside a function, runs the same DO block after a single fixture made inside each tested
-- statement (so every fixture, every ALTER and every queued deferred check rolls back with it). A
-- table holds a row on its own only after its parent foreign keys are dropped and its triggers
-- disabled inside the tested statement.
create function pg_temp.tm_pr16_down()
returns void
language plpgsql
as $fn$
begin
-- >>> BEGIN supabase/rollback/20261107120000_integrity_offline.down.sql
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
-- <<< END supabase/rollback/20261107120000_integrity_offline.down.sql
end
$fn$;

select throws_ok($rollback$
alter table public.review_items disable trigger user;
alter table public.review_items drop constraint review_items_service_call_id_fkey;
insert into public.review_items (review_type, dedupe_key, service_call_id, source, source_ref, submitted_version,
                                 current_version, is_test)
  values ('sku_change', 'pr16-990-ri-2', gen_random_uuid(), 'invitation', 'pr16-990-evt-2', '{"sku": "B"}', '{"sku": "A"}', true);
select pg_temp.tm_pr16_down();
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses when only a review item exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_corrections disable trigger user;
alter table public.visit_corrections drop constraint visit_corrections_visit_id_fkey,
  drop constraint visit_corrections_corrected_by_fkey;
insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after,
                                      corrected_by, is_test)
  values (gen_random_uuid(), 'summary', '"א"', '"ב"', 'בדיקת שחזור', 1, 2, gen_random_uuid(), true);
select pg_temp.tm_pr16_down();
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses when only a visit correction exists (review TEST-2)');
select throws_ok($rollback$
alter table public.offline_operations disable trigger user;
alter table public.offline_operations drop constraint offline_operations_visit_id_fkey,
  drop constraint offline_operations_actor_profile_id_fkey;
insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256,
                                       expected_field_version, device_sent_at, device_tz, device_utc_offset_min, result,
                                       resulting_field_version, is_test)
  values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'time_report', repeat('a', 64), 1, now(),
          'Asia/Jerusalem', 120, 'applied', 1, true);
select pg_temp.tm_pr16_down();
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses when only an offline operation exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_time_reports disable trigger user;
alter table public.visit_time_reports drop constraint visit_time_reports_visit_id_fkey,
  drop constraint visit_time_reports_technician_id_fkey, drop constraint visit_time_reports_reported_by_profile_id_fkey,
  drop constraint visit_time_reports_correction_id_fkey;
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source,
                                       correction_id, is_test)
  values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'arrived', now(), 'correction', gen_random_uuid(), true);
select pg_temp.tm_pr16_down();
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses when only a corrected field time exists (review TEST-2)');
select throws_ok($rollback$
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000016e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'tech-1690@example.test', now(), now());
insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000016e1', 'technician', 'טכנאי בדיקת שחזור');
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email)
  values ('00000000-0000-4000-8000-0000000016f1', '00000000-0000-4000-8000-0000000016e1', true, 'טכנאי בדיקת שחזור', 't-y',
          'tech-1690-o@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000016c1', 'C-16901', 'לקוח בדיקת שחזור', '050-000-1691', 'automated_test', 'pr16-990-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000016d1', 'RB-16901', 'RB-16901', 'מוצר בדיקת שחזור', 'automated_test', 'pr16-990-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
  select '00000000-0000-4000-8000-0000000016a1', 'R-16901', '00000000-0000-4000-8000-0000000016c1',
         '00000000-0000-4000-8000-0000000016d1', t.id, 'תקלת בדיקת שחזור', 'נציגת בדיקה', 'open', 2,
         'automated_test', 'pr16-990-1'
  from public.call_types t where t.sort_order = 1;
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
  values ('00000000-0000-4000-8000-0000000016b1', '00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016f1',
          1, 'T-16901', now() + interval '1 day', now() + interval '1 day 2 hours', 'scheduled', 'עיר בדיקה', 'רחוב בדיקה',
          'pr16-990-1');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-0000000016b1', 1, 'created', 'scheduled');
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000016c9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'creator-1690@example.test', now(), now());
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000016c9', 'יוצר בדיקת שחזור');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000016c9","role":"authenticated"}', true);
select private.write_audit('visit.corrected', 'visits', '00000000-0000-4000-8000-0000000016b1', '{}');
select set_config('request.jwt.claims', '', true);
select pg_temp.tm_pr16_down();
$rollback$,
  '55000', 'rollback refused: PR 1.6 data exists (review items, corrections, offline operations or their audit rows); this down script is valid only before any PR 1.6 data',
  'PR 1.6: the down script refuses when only a PR 1.6 audit row exists (review TEST-2)');
select ok(
  to_regclass('public.review_items') is not null and to_regprocedure('private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb)') is not null
  and (select count(*) from public.review_items) + (select count(*) from public.visit_corrections)
      + (select count(*) from public.offline_operations) + (select count(*) from public.visit_time_reports)
      + (select count(*) from public.audit_logs) + (select count(*) from public.visits) = 0
  and (select count(*) from pg_constraint k
       where k.conname in ('review_items_service_call_id_fkey', 'visit_corrections_visit_id_fkey',
                           'visit_corrections_corrected_by_fkey', 'offline_operations_visit_id_fkey',
                           'offline_operations_actor_profile_id_fkey', 'visit_time_reports_visit_id_fkey',
                           'visit_time_reports_technician_id_fkey', 'visit_time_reports_reported_by_profile_id_fkey',
                           'visit_time_reports_correction_id_fkey')) = 9
  and not exists (select 1 from pg_trigger t
                  where t.tgrelid in ('public.review_items'::regclass, 'public.visit_corrections'::regclass,
                                      'public.offline_operations'::regclass, 'public.visit_time_reports'::regclass)
                    and not t.tgisinternal and t.tgenabled <> 'O'),
  'PR 1.6: after those refusals nothing was dropped, every fixture is gone, and the foreign keys and triggers are back');

-- The run on the empty tables, with an MCP-style history row next to the CLI's (both removed).
insert into supabase_migrations.schema_migrations (version, name) values ('20261112093013', 'integrity_offline');

-- >>> BEGIN supabase/rollback/20261107120000_integrity_offline.down.sql
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
-- <<< END supabase/rollback/20261107120000_integrity_offline.down.sql

select ok(
  to_regclass('public.review_items') is null and to_regclass('public.visit_corrections') is null
  and to_regclass('public.offline_operations') is null
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname in ('public', 'private')
                    and p.proname in ('tg_call_child_marker', 'tg_review_item_state', 'tg_visit_correction_guard',
                                      'tg_offline_operation_derive', 'tg_visit_field_version', 'create_review_item',
                                      'offline_operation_replay', 'record_offline_operation', 'correct_visit',
                                      'resolve_review_item', 'tg_visit_closed_fields'))
  and not exists (select 1 from pg_trigger where tgname in ('t13_field_version', 't14_closed_fields', 't11_frozen'))
  and not exists (select 1 from pg_constraint where conname = 'visits_id_service_call_id_key')
  and not exists (select 1 from pg_attribute a where a.attrelid = 'public.visit_time_reports'::regclass and not a.attisdropped
                    and a.attname in ('correction_id', 'accepted_review_id')),
  'PR 1.6: the three tables, the 13 functions, the two visits triggers, the visit_reports freeze, the visits key and the two visit_time_reports columns are gone');
-- The three replaced functions are back to their earlier text: md5(prosrc) and
-- md5(pg_get_functiondef) as computed on a database built from Migrations 1 to 3 (PostgreSQL 17;
-- docs/review/step1-pr16/README.md section 9).
select results_eq(
  $$ select p.proname::text collate "default", md5(p.prosrc) collate "default", md5(pg_get_functiondef(p.oid)) collate "default"
     from pg_proc p where p.oid in ('private.tg_audit_target()'::regprocedure, 'public.test_data_census()'::regprocedure,
                                    'private.tg_time_report_derive()'::regprocedure)
     order by p.proname::text collate "C" $$,
  $$ values ('test_data_census', '4a651f5edf43d06916c45ebc7654ae05', '83fe88a2b81c1fc9582a2f09f655a72f'),
            ('tg_audit_target', 'd25cf9e179600a75b7812b9a04c23d29', 'bef804c030ce770fd7c2ba2a11dc3700'),
            ('tg_time_report_derive', '5a07fe647a2d760096b6b8f1091f6b01', '5de862f735265d0b5713c1479a667c7d') $$,
  'PR 1.6: test_data_census and tg_time_report_derive are restored byte for byte to PR 1.5, tg_audit_target to PR 1.4');
select is(
  (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = any (array['audit_row_hash', 'audit_chain_verify', 'write_audit', 'tg_audit_target', 'tg_audit_chain',
                                'tg_reject_update_delete', 'tg_reject_truncate', 'tg_one_way_people']::name[])),
  'd30c54fba69e0689cd53735e46f99404',
  'PR 1.6: the audit anchor''s functions fingerprint is the PR 1.5 value again');
-- The whole catalog of public and private equals a database built from Migrations 1 to 3, by
-- fingerprints of every function definition and ACL, constraint, trigger, column (type, NOT NULL,
-- default), relation (kind, ACL, RLS, comment), index and policy (PostgreSQL 17; README section 9).
select results_eq(
  $$ select x.k, x.v collate "default" from (
     select 'functions'::text, md5(string_agg(n.nspname || '.' || p.proname || ':' || pg_get_functiondef(p.oid), '|' order by n.nspname, p.proname, p.oid))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
     union all
     select 'function ACLs', md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text, ''), '|' order by p.oid::regprocedure::text))
     from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     union all
     select 'constraints', md5(string_agg(c.relname || '.' || k.conname || '=' || pg_get_constraintdef(k.oid), '|' order by c.relname, k.conname))
     from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     union all
     select 'triggers', md5(string_agg(pg_get_triggerdef(t.oid), '|' order by c.relname, t.tgname))
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and not t.tgisinternal
     union all
     select 'columns', md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                                      || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '|' order by c.relname, a.attname))
     from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and a.attnum > 0 and not a.attisdropped
     union all
     select 'relations', md5(string_agg(c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity
                                        || ':' || coalesce(obj_description(c.oid, 'pg_class'), ''), '|' order by c.relname))
     from pg_class c where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     union all
     select 'indexes', md5(string_agg(pg_get_indexdef(i.indexrelid), '|' order by pg_get_indexdef(i.indexrelid)))
     from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     union all
     select 'policies', md5(string_agg(pol.polname || ':' || pg_get_expr(pol.polqual, pol.polrelid), '|' order by pol.polname))
     from pg_policy pol) x (k, v) $$,
  $$ values ('functions'::text, '73f2bc5270af30ce3874471cc7a5f4ea'::text), ('function ACLs', '0773fd0da3d280d21d98377c5b8603c1'),
            ('constraints', '2e28e31d63c9b3aa3acadba0485b13e8'), ('triggers', '2de1c7211cb917d235cc609907a0cb66'),
            ('columns', '9b350c944d8467453d554392cd1f70a9'), ('relations', '6db31c3907b0a906016c2afb1add0a28'),
            ('indexes', 'f6add8a9b5e9eee5868a7681ea3f0f29'), ('policies', 'ced0c5455e921edab80f9cde3a9bde4d') $$,
  'PR 1.6: every function, ACL, constraint, trigger, column, relation, index and policy equals the catalog built from Migrations 1 to 3');
select ok(
  not exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000' or name = 'integrity_offline')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261106120000')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000'),
  'PR 1.6: its history rows are removed (CLI version and MCP name); the PR 1.3 to PR 1.5 rows stay');
select results_eq(
  $$ select t from (select distinct c.table_name as t from public.test_data_census() c) x order by t collate "C" $$,
  $$ values ('account_requests'), ('audit_logs'), ('brands'), ('call_types'), ('collection_locations'), ('customers'),
            ('entity_changes'), ('followup_reasons'), ('permissions'), ('products'), ('profiles'), ('role_permissions'),
            ('service_calls'), ('storage'), ('suppliers'), ('technicians'), ('visit_events'), ('visit_reports'),
            ('visit_signatures'), ('visit_time_reports'), ('visits') $$,
  'PR 1.6: the census covers the PR 1.3 to PR 1.5 tables again');

-- ---------------------------------------------------------------------------------------------
-- PR 1.5 (Migration 3) down script
-- ---------------------------------------------------------------------------------------------
select ok(
  to_regclass('public.service_calls') is not null and to_regclass('public.visit_time_current') is not null
  and to_regprocedure('public.previous_visits(uuid)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261106120000'),
  'PR 1.5 positive control: Migration 3 is applied before its rollback runs');

-- Fail closed: a service call with its first visit and its 'created' event, written as the Step 6
-- ingestion will write them (every trigger active; inserted inside the tested statement, so they
-- are rolled back with it, deferred checks included).
select throws_ok($rollback$
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000099e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'tech-990@example.test', now(), now());
insert into public.profiles (id, role, full_name) values ('00000000-0000-4000-8000-0000000099e1', 'technician', 'טכנאי בדיקת שחזור');
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email)
  values ('00000000-0000-4000-8000-0000000099f1', '00000000-0000-4000-8000-0000000099e1', true, 'טכנאי בדיקת שחזור', 't-y',
          'tech-990-o@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000099c1', 'C-99015', 'לקוח בדיקת שחזור', '050-000-9915', 'automated_test', 'pr15-990-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000099d1', 'RB-99015', 'RB-99015', 'מוצר בדיקת שחזור', 'automated_test', 'pr15-990-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
  select '00000000-0000-4000-8000-0000000099a1', 'R-99015', '00000000-0000-4000-8000-0000000099c1',
         '00000000-0000-4000-8000-0000000099d1', t.id, 'תקלת בדיקת שחזור', 'נציגת בדיקה', 'open', 2,
         'automated_test', 'pr15-990-1'
  from public.call_types t where t.sort_order = 1;
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
  values ('00000000-0000-4000-8000-0000000099b1', '00000000-0000-4000-8000-0000000099a1', '00000000-0000-4000-8000-0000000099f1',
          1, 'T-99015', now() + interval '1 day', now() + interval '1 day 2 hours', 'scheduled', 'עיר בדיקה', 'רחוב בדיקה',
          'pr15-990-1');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-0000000099b1', 1, 'created', 'scheduled');
-- >>> BEGIN supabase/rollback/20261106120000_service_calls_visits.down.sql
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
-- <<< END supabase/rollback/20261106120000_service_calls_visits.down.sql
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses to run once a service call and its visit exist (fail closed)');
select ok(
  to_regclass('public.service_calls') is not null and to_regprocedure('private.recalc_call_status(uuid)') is not null
  and (select count(*) from public.service_calls) + (select count(*) from public.visits) + (select count(*) from public.visit_events) = 0
  and not exists (select 1 from public.technicians)
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261106120000'),
  'PR 1.5: after the refused run nothing was dropped and the fixture is gone');

-- A later migration is recorded: refused with a clear message (not a dependency error at DROP time).
select throws_ok($rollback$
insert into supabase_migrations.schema_migrations (version, name) values ('20261201000000', 'later_migration_probe');
-- >>> BEGIN supabase/rollback/20261106120000_service_calls_visits.down.sql
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
-- <<< END supabase/rollback/20261106120000_service_calls_visits.down.sql
$rollback$,
  '55000', 'rollback refused: a later migration is recorded; roll it back first',
  'PR 1.5: the down script refuses while a later migration is recorded');
select ok(
  to_regclass('public.visits') is not null
  and not exists (select 1 from supabase_migrations.schema_migrations where version = '20261201000000'),
  'PR 1.5: after that refusal nothing was dropped and the probe row is gone');

-- OPS-1 (as in PR 1.3 and PR 1.4): without a history row (the CLI's version or the MCP name) the
-- rollback is refused before anything is dropped. The history row is deleted inside the tested
-- statement.
select throws_ok($rollback$
delete from supabase_migrations.schema_migrations where version = '20261106120000' or name = 'service_calls_visits';
-- >>> BEGIN supabase/rollback/20261106120000_service_calls_visits.down.sql
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
-- <<< END supabase/rollback/20261106120000_service_calls_visits.down.sql
$rollback$,
  '55000', 'rollback refused: no migration history row with version 20261106120000 or name service_calls_visits; nothing was dropped',
  'PR 1.5: the down script refuses when the history table holds no row for the migration');
select ok(
  to_regclass('public.entity_changes') is not null and to_regprocedure('public.my_visit_details(uuid)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261106120000'),
  'PR 1.5: after that refusal nothing was dropped and the history row is still there');

-- Review TEST-2 (as in PR 1.4): each refusal condition alone. One more byte-identical copy, inside a
-- function, runs the same DO block after a single fixture made inside each tested statement (so
-- every fixture, every ALTER and every queued deferred check rolls back with it). A child table
-- holds a row on its own only after its parent foreign keys are dropped and its triggers disabled
-- inside the tested statement (no other PR 1.5 table has a row then).
create function pg_temp.tm_pr15_down()
returns void
language plpgsql
as $fn$
begin
-- >>> BEGIN supabase/rollback/20261106120000_service_calls_visits.down.sql
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
-- <<< END supabase/rollback/20261106120000_service_calls_visits.down.sql
end
$fn$;

select throws_ok($rollback$
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000099c1', 'C-99015', 'לקוח בדיקת שחזור', '050-000-9915', 'automated_test', 'pr15-990-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000099d1', 'RB-99015', 'RB-99015', 'מוצר בדיקת שחזור', 'automated_test', 'pr15-990-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
  select '00000000-0000-4000-8000-0000000099a1', 'R-99015', '00000000-0000-4000-8000-0000000099c1',
         '00000000-0000-4000-8000-0000000099d1', t.id, 'תקלת בדיקת שחזור', 'נציגת בדיקה', 'open', 2,
         'automated_test', 'pr15-990-1'
  from public.call_types t where t.sort_order = 1;
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a service call exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visits disable trigger user;
alter table public.visits drop constraint visits_service_call_id_fkey, drop constraint visits_technician_id_fkey;
insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
                           city, street, source_ref, is_test)
  values (gen_random_uuid(), gen_random_uuid(), 1, 'T-99016', now(), now(), 'scheduled', 'עיר בדיקה', 'רחוב בדיקה', 'pr15-990-2', true);
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a visit exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_reports disable trigger user;
alter table public.visit_reports drop constraint visit_reports_visit_id_fkey;
insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
  values (gen_random_uuid(), 'סיכום בדיקת שחזור', 'written', true);
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a treatment summary exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_signatures disable trigger user;
alter table public.visit_signatures drop constraint visit_signatures_visit_id_fkey;
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
  values (gen_random_uuid(), 'חותם בדיקה', 'נוסח אישור בדיקה',
          encode(sha256(convert_to('נוסח אישור בדיקה', 'UTF8')), 'hex'), gen_random_uuid(), true);
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a signature exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_time_reports disable trigger user;
alter table public.visit_time_reports drop constraint visit_time_reports_visit_id_fkey,
  drop constraint visit_time_reports_technician_id_fkey, drop constraint visit_time_reports_reported_by_profile_id_fkey;
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, clock_skew_ms, source, operation_id, is_test)
  values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'departed', now(), 'Asia/Jerusalem', 120, now(), 0,
          'device', gen_random_uuid(), true);
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a field time report exists (review TEST-2)');
select throws_ok($rollback$
alter table public.visit_events disable trigger user;
alter table public.visit_events drop constraint visit_events_visit_id_fkey;
insert into public.visit_events (visit_id, version_after, event_type, to_status, is_test)
  values (gen_random_uuid(), 1, 'created', 'scheduled', true);
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a visit status event exists (review TEST-2)');
select throws_ok($rollback$
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-0000000099c2', 'C-99017', 'לקוח בדיקת שחזור ב', '050-000-9917', 'automated_test', 'pr15-990-3');
insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source, source_ref)
  values ('customers', '00000000-0000-4000-8000-0000000099c2', 'phone', '"050-000-9916"', '"050-000-9917"', 'invitation', 'pr15-990-3');
select pg_temp.tm_pr15_down();
$rollback$,
  '55000', 'rollback refused: PR 1.5 data exists (service calls, visits or their history); this down script is valid only before any PR 1.5 data',
  'PR 1.5: the down script refuses when only a field-history row exists (a customer change; review TEST-2)');
select ok(
  to_regclass('public.service_calls') is not null and to_regprocedure('private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)') is not null
  and (select count(*) from public.service_calls) + (select count(*) from public.visits) + (select count(*) from public.visit_reports)
      + (select count(*) from public.visit_signatures) + (select count(*) from public.visit_time_reports)
      + (select count(*) from public.visit_events) + (select count(*) from public.entity_changes)
      + (select count(*) from public.customers) + (select count(*) from public.products) = 0
  and (select count(*) from pg_constraint k
       where k.conname in ('visits_service_call_id_fkey', 'visits_technician_id_fkey', 'visit_reports_visit_id_fkey',
                           'visit_signatures_visit_id_fkey', 'visit_time_reports_visit_id_fkey',
                           'visit_time_reports_technician_id_fkey', 'visit_time_reports_reported_by_profile_id_fkey',
                           'visit_events_visit_id_fkey')) = 8
  and not exists (select 1 from pg_trigger t
                  where t.tgrelid in ('public.visits'::regclass, 'public.visit_reports'::regclass, 'public.visit_signatures'::regclass,
                                      'public.visit_time_reports'::regclass, 'public.visit_events'::regclass)
                    and not t.tgisinternal and t.tgenabled <> 'O'),
  'PR 1.5: after those refusals nothing was dropped, every fixture is gone, and the foreign keys and triggers are back');

-- The run on the empty tables, with an MCP-style history row next to the CLI's (both removed).
insert into supabase_migrations.schema_migrations (version, name) values ('20261111093013', 'service_calls_visits');

-- >>> BEGIN supabase/rollback/20261106120000_service_calls_visits.down.sql
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
-- <<< END supabase/rollback/20261106120000_service_calls_visits.down.sql

select ok(
  to_regclass('public.service_calls') is null and to_regclass('public.visits') is null
  and to_regclass('public.visit_reports') is null and to_regclass('public.visit_signatures') is null
  and to_regclass('public.visit_time_reports') is null and to_regclass('public.visit_events') is null
  and to_regclass('public.entity_changes') is null and to_regclass('public.visit_time_current') is null
  and to_regclass('public.visit_time_reports_id_seq') is null and to_regclass('public.visit_events_id_seq') is null
  and to_regclass('public.entity_changes_id_seq') is null
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname in ('public', 'private')
                    and p.proname in ('tg_visit_marker', 'tg_visit_child_marker', 'tg_history_server_time',
                                      'tg_entity_change_target', 'tg_one_way_call_refs', 'tg_one_way_visit_refs',
                                      'tg_visit_number_guard', 'tg_service_call_guard', 'tg_visit_state_guard',
                                      'tg_time_report_derive', 'ct_visit_rules', 'ct_service_call_rules', 'ct_signature_rules',
                                      'ct_report_rules', 'compute_call_status', 'recalc_call_status', 'write_entity_change',
                                      'can_read_visit', 'previous_visits', 'visit_rep_contact', 'my_visit_details')),
  'PR 1.5: the seven tables, the view, the identity sequences and the 24 functions are gone');
-- The replaced PR 1.4 census is back to its PR 1.4 text, and tg_audit_target (not touched by
-- PR 1.5) keeps its PR 1.4 text: md5(prosrc) and md5(pg_get_functiondef) as computed on a database
-- built from the PR 1.3 and PR 1.4 migrations (PostgreSQL 17; docs/review/step1-pr14/README.md
-- section 9, docs/review/step1-pr15/README.md).
select results_eq(
  $$ select p.proname::text collate "default", md5(p.prosrc) collate "default", md5(pg_get_functiondef(p.oid)) collate "default"
     from pg_proc p where p.oid in ('private.tg_audit_target()'::regprocedure, 'public.test_data_census()'::regprocedure)
     order by p.proname::text collate "C" $$,
  $$ values ('test_data_census', '0dbefb7f4ee3841621188838db7bd002', 'b72dcff406dea4acd841d6ab62200401'),
            ('tg_audit_target', 'd25cf9e179600a75b7812b9a04c23d29', 'bef804c030ce770fd7c2ba2a11dc3700') $$,
  'PR 1.5: test_data_census is restored byte for byte to PR 1.4; tg_audit_target keeps its PR 1.4 text');
select is(
  (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = any (array['audit_row_hash', 'audit_chain_verify', 'write_audit', 'tg_audit_target', 'tg_audit_chain',
                                'tg_reject_update_delete', 'tg_reject_truncate', 'tg_one_way_people']::name[])),
  'd30c54fba69e0689cd53735e46f99404',
  'PR 1.5: the audit anchor''s functions fingerprint is the PR 1.3 + PR 1.4 value (PR 1.5 replaced no audit function)');
select ok(
  not exists (select 1 from supabase_migrations.schema_migrations where version = '20261106120000' or name = 'service_calls_visits')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000')
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261104120000'),
  'PR 1.5: its history rows are removed (CLI version and MCP name); the PR 1.3 and PR 1.4 rows stay');
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
  'PR 1.5: the PR 1.3 and PR 1.4 table grants are intact (SELECT for authenticated on their thirteen tables)');
-- The PR 1.4 delete RPCs keep their bodies (README section 9 pins of docs/review/step1-pr14), and
-- the Migration 1 and 2 trigger functions that PR 1.5 attached to its tables are still there.
select results_eq(
  $$ select p.proname::text collate "default", md5(p.prosrc) collate "default"
     from pg_proc p
     where p.oid in ('private.delete_followup_reason(uuid,integer)'::regprocedure,
                     'private.delete_collection_location(uuid,integer)'::regprocedure,
                     'private.tg_immutable_except()'::regprocedure)
     order by p.proname::text collate "C" $$,
  $$ values ('delete_collection_location', 'ccd8b95405e0d3dfa4c71eddd13abe90'),
            ('delete_followup_reason', '9476621392a7287d19d0a51cb5996fe6'),
            ('tg_immutable_except', '7aab821ecfdd2a14c42dcba975a9a4de') $$,
  'PR 1.5: the PR 1.4 delete RPCs and tg_immutable_except keep their PR 1.4 text');
select ok(
  to_regprocedure('private.tg_bump_version()') is not null and to_regprocedure('private.tg_immutable_markers()') is not null
  and to_regprocedure('private.tg_reject_update_delete()') is not null and to_regprocedure('private.tg_reject_delete()') is not null
  and to_regprocedure('private.tg_reject_truncate()') is not null and to_regprocedure('private.tg_one_way_people()') is not null
  and has_function_privilege('authenticated', 'public.test_data_census()', 'execute')
  and not has_function_privilege('anon', 'public.test_data_census()', 'execute')
  and not has_function_privilege('service_role', 'public.test_data_census()', 'execute'),
  'PR 1.5: the shared Migration 1 trigger functions remain and the restored census keeps its grants');
select results_eq(
  $$ select t from (select distinct c.table_name as t from public.test_data_census() c) x order by t collate "C" $$,
  $$ values ('account_requests'), ('audit_logs'), ('brands'), ('call_types'), ('collection_locations'), ('customers'),
            ('followup_reasons'), ('permissions'), ('products'), ('profiles'), ('role_permissions'), ('storage'),
            ('suppliers'), ('technicians') $$,
  'PR 1.5: the census covers the PR 1.3 and PR 1.4 tables again');

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
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
$rollback$,
  '55000', 'rollback refused: no migration history row with version 20261105120000 or name reference_customers_products; nothing was dropped',
  'PR 1.4: the down script refuses when the history table holds no row for the migration');
select ok(
  to_regclass('public.products') is not null and to_regprocedure('public.delete_followup_reason(uuid,integer)') is not null
  and exists (select 1 from supabase_migrations.schema_migrations where version = '20261105120000'),
  'PR 1.4: after that refusal nothing was dropped and the history row is still there');

-- Independent review TEST-2: each refusal condition alone. One more byte-identical copy, inside a
-- function, runs the same DO block after a single fixture made inside each tested statement (so
-- every fixture rolls back with it); the copies above run it at top level, as psql does.
create function pg_temp.tm_pr14_down()
returns void
language plpgsql
as $fn$
begin
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
-- <<< END supabase/rollback/20261105120000_reference_customers_products.down.sql
end
$fn$;

select throws_ok($rollback$
insert into public.customers (customer_number, name, phone, data_source, source_ref)
  values ('C-990', 'לקוח בדיקת שחזור', '050-000-0990', 'automated_test', 'run-990');
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a customer (review TEST-2)');
select throws_ok($rollback$
insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
  values ('RB-990', 'RB-990', 'מוצר בדיקת שחזור', 'automated_test', 'run-990');
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a product (review TEST-2)');
select throws_ok($rollback$
insert into public.suppliers (name) values ('ספק בדיקת שחזור');
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a supplier (review TEST-2)');
select throws_ok($rollback$
insert into public.collection_locations (name, place_type, sort_order, address)
  values ('מקום בדיקת שחזור', 'branch', 1, 'רחוב השחזור 1');
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a pickup place (review TEST-2)');
select throws_ok($rollback$
alter table public.call_types disable trigger t95_reject_delete;
delete from public.call_types where sort_order = 2;
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a D48 call type is missing (so only the count of call types differs) (review TEST-2)');
select throws_ok($rollback$
alter table public.followup_reasons disable trigger t95_delete_guard;
delete from public.followup_reasons where sort_order = 5;
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a D48 continuation reason is missing (so only the count of reasons differs) (review TEST-2)');
select throws_ok($rollback$
update public.followup_reasons set is_active = false where sort_order = 3;
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when a D48 continuation reason was changed (deactivated) (review TEST-2)');
select throws_ok($rollback$
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'creator-990@example.test', now(), now());
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000009c1', 'יוצר בדיקת שחזור');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000009c1","role":"authenticated"}', true);
select private.delete_followup_reason(r.created_id, 1) from private.add_followup_reason('סיבת בדיקת שחזור') r;
select set_config('request.jwt.claims', '', true);
select pg_temp.tm_pr14_down();
$rollback$,
  '55000', 'rollback refused: PR 1.4 data, changed D48 rows or PR 1.4 audit rows exist; this down script is valid only before any PR 1.4 data',
  'PR 1.4: the down script refuses when only PR 1.4 audit rows exist (a reason added and deleted through the Settings RPCs) (review TEST-2)');
select ok(
  to_regclass('public.products') is not null and to_regprocedure('private.add_followup_reason(text)') is not null
  and (select count(*) from public.customers) + (select count(*) from public.products) + (select count(*) from public.suppliers)
      + (select count(*) from public.collection_locations) = 0
  and (select count(*) from public.call_types where is_active and version = 1) = 2
  and (select count(*) from public.followup_reasons where is_active and version = 1) = 5
  and not exists (select 1 from public.audit_logs) and not exists (select 1 from public.profiles)
  and exists (select 1 from pg_trigger where tgname = 't95_reject_delete' and tgrelid = 'public.call_types'::regclass and tgenabled = 'O')
  and exists (select 1 from pg_trigger where tgname = 't95_delete_guard' and tgrelid = 'public.followup_reasons'::regclass and tgenabled = 'O'),
  'PR 1.4: after those refusals nothing was dropped, every fixture is gone and the delete triggers are enabled again');

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
