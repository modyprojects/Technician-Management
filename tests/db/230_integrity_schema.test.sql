-- PR 1.6: schema, markers and integrity rules of Migration 4 (docs/database-schema.md §1, §2, §4
-- "Migration 4", §7, §10; D14, D44, D45, D47; docs/testing.md categories 6, 7, 10 and 12; D58 (5):
-- data integrity). Covered, as postgres (the rules hold for the owner role, so for every writer):
--   the three new tables (columns, keys, every foreign key RESTRICT, CHECK value sets, indexes,
--   triggers, RLS, comments); the D47 markers copied from the parent (the client value ignored) and
--   frozen, the composite foreign keys, the one-way rule (section 8, simulated go-live); a review
--   item is created open, decided once, never changed after and never deleted, both versions frozen
--   (D44); corrections only of a server-closed visit (D14), append-only, one per visit version, with
--   the value rules per field; offline operations immutable; the two kinds of correction rows of
--   visit_time_reports (an office correction, an accepted second device report that keeps its
--   original receipt time, OQ-13); visits.field_version (database-schema.md §1, OQ-14); and the
--   current value of visit_time_current (the newest correction wins, a late device report never
--   overrides one, a correction clears a computed sequence flag; D45).
-- Who reads the tables: 250_integrity_rls. The writers: 240_integrity_writers. Idempotency and
-- review dedupe: 260_offline_idempotency.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_run_as: p_setup runs first as postgres (matrix changes, a deactivation, a relaxed CHECK), then
-- p_sql runs as p_role with the JWT claims of p_sub (none when NULL), then p_probe runs as postgres
-- and returns one text value ('ok' without a probe). Everything is undone. An error returns its
-- SQLSTATE and the constraint name, the column (23502) or the message.
create function pg_temp.tm_run_as(p_setup text, p_sub uuid, p_role text, p_sql text, p_probe text default null)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
  v_column text;
  v_message text;
  v_result text;
begin
  begin
    begin
      if p_setup is not null then
        execute p_setup;
      end if;
      perform set_config('request.jwt.claims',
        case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
      if p_role <> 'postgres' then
        execute 'set local role ' || quote_ident(p_role);
      end if;
      execute p_sql;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if p_probe is null then
        v_result := 'ok';
      else
        execute p_probe into v_result;
      end if;
      set constraints all deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name,
        v_column = column_name, v_message = message_text;
      return v_state || ' ' || case when v_state = '23502' then v_column
                                    else coalesce(nullif(v_constraint, ''), v_message) end;
    end;
    raise exception using errcode = 'TM001', message = coalesce(v_result, '<null>');
  exception when sqlstate 'TM001' then
    get stacked diagnostics v_message = message_text;
    return v_message;
  end;
end
$f$;
create function pg_temp.tm_as(p_sub uuid, p_sql text, p_probe text default null)
returns text
language sql
as $f$ select pg_temp.tm_run_as(null, p_sub, 'authenticated', p_sql, p_probe) $f$;
create function pg_temp.tm_try(p_sql text, p_probe text default null)
returns text
language sql
as $f$ select pg_temp.tm_run_as(null, null, 'postgres', p_sql, p_probe) $f$;

create function pg_temp.tm_columns(p_table regclass)
returns table (col text, typ text, not_null boolean, dflt text, generated text, identity text)
language sql
as $f$
  select a.attname::text, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
         a.attgenerated::text, a.attidentity::text
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
  order by a.attnum
$f$;
create function pg_temp.tm_constraints(p_table regclass)
returns table (conname text, contype text, cols text, ref text, on_delete text)
language sql
as $f$
  select k.conname::text, k.contype::text,
         coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                   from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey)), ''),
         coalesce((select r.relname::text from pg_class r where r.oid = k.confrelid), ''), k.confdeltype::text
  from pg_constraint k where k.conrelid = p_table
  order by k.conname::text collate "C"
$f$;
create function pg_temp.tm_triggers(p_table regclass)
returns setof text
language sql
as $f$
  select pg_get_triggerdef(t.oid) from pg_trigger t
  where t.tgrelid = p_table and not t.tgisinternal
  order by t.tgname::text collate "C"
$f$;

-- ---------------------------------------------------------------------------------------------
-- 1. Columns, keys, CHECKs, indexes, triggers, RLS and comments
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select * from pg_temp.tm_columns('public.review_items') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', '', ''),
            ('review_type', 'text', true, null, '', ''),
            ('dedupe_key', 'text', true, null, '', ''),
            ('service_call_id', 'uuid', true, null, '', ''),
            ('visit_id', 'uuid', false, null, '', ''),
            ('source', 'text', true, null, '', ''),
            ('source_ref', 'text', false, null, '', ''),
            ('submitted_by_profile_id', 'uuid', false, null, '', ''),
            ('operation_id', 'uuid', false, null, '', ''),
            ('submitted_version', 'jsonb', true, null, '', ''),
            ('current_version', 'jsonb', true, null, '', ''),
            ('base_version', 'jsonb', false, null, '', ''),
            ('status', 'text', true, '''open''::text', '', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('resolved_at', 'timestamp with time zone', false, null, '', ''),
            ('resolved_by', 'uuid', false, null, '', ''),
            ('resolution', 'text', false, null, '', ''),
            ('resolution_choices', 'jsonb', false, null, '', ''),
            ('resolution_note', 'text', false, null, '', ''),
            ('is_test', 'boolean', true, null, '', ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('updated_by', 'uuid', false, null, '', ''),
            ('version', 'integer', true, '1', '', '') $$,
  'review_items: type, dedupe key, call and optional visit, source with its reference or device submitter and operation, both versions and the base (D44), status and the decision, the test marker, bookkeeping and version');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_corrections') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', '', ''),
            ('visit_id', 'uuid', true, null, '', ''),
            ('field', 'text', true, null, '', ''),
            ('old_value', 'jsonb', false, null, '', ''),
            ('new_value', 'jsonb', true, null, '', ''),
            ('reason', 'text', true, null, '', ''),
            ('version_before', 'integer', true, null, '', ''),
            ('version_after', 'integer', true, null, '', ''),
            ('corrected_by', 'uuid', true, null, '', ''),
            ('recorded_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('is_test', 'boolean', true, null, '', '') $$,
  'visit_corrections: the visit, one field with its old and new value, the reason, the visit versions before and after, the corrector, the server time and the test marker (D14)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.offline_operations') $$,
  $$ values ('operation_id', 'uuid', true, null::text, '', ''),
            ('actor_profile_id', 'uuid', true, null, '', ''),
            ('visit_id', 'uuid', true, null, '', ''),
            ('op_type', 'text', true, null, '', ''),
            ('payload_sha256', 'text', true, null, '', ''),
            ('expected_field_version', 'integer', true, null, '', ''),
            ('device_sent_at', 'timestamp with time zone', true, null, '', ''),
            ('device_tz', 'text', true, null, '', ''),
            ('device_utc_offset_min', 'integer', true, null, '', ''),
            ('received_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('result', 'text', true, null, '', ''),
            ('resulting_field_version', 'integer', true, null, '', ''),
            ('review_item_id', 'uuid', false, null, '', ''),
            ('is_test', 'boolean', true, null, '', '') $$,
  'offline_operations: the device operation id as the key (no default), the actor, the visit, type, payload hash, the field versions, the D45 device and server times, the final result and its review item, the test marker');
select results_eq(
  $$ select * from pg_temp.tm_constraints('public.review_items') $$,
  $$ values ('review_items_base_version_check', 'c', 'base_version', '', ' '),
            ('review_items_current_version_check', 'c', 'current_version', '', ' '),
            ('review_items_dedupe_key_check', 'c', 'dedupe_key', '', ' '),
            ('review_items_dedupe_key_key', 'u', 'dedupe_key', '', ' '),
            ('review_items_device_check', 'c', 'source,source_ref,submitted_by_profile_id,operation_id', '', ' '),
            ('review_items_id_is_test_key', 'u', 'id,is_test', '', ' '),
            ('review_items_invitation_check', 'c', 'source,source_ref,submitted_by_profile_id,operation_id', '', ' '),
            ('review_items_pkey', 'p', 'id', '', ' '),
            ('review_items_resolution_check', 'c', 'resolution', '', ' '),
            ('review_items_resolution_choices_check', 'c', 'resolution_choices', '', ' '),
            ('review_items_resolution_note_check', 'c', 'resolution_note', '', ' '),
            ('review_items_resolution_state_check', 'c', 'status,resolved_at,resolved_by,resolution,resolution_choices,resolution_note', '', ' '),
            ('review_items_resolved_by_fkey', 'f', 'resolved_by', 'profiles', 'r'),
            ('review_items_review_type_check', 'c', 'review_type', '', ' '),
            ('review_items_service_call_id_fkey', 'f', 'service_call_id,is_test', 'service_calls', 'r'),
            ('review_items_source_check', 'c', 'source', '', ' '),
            ('review_items_source_ref_check', 'c', 'source_ref', '', ' '),
            ('review_items_status_check', 'c', 'status', '', ' '),
            ('review_items_submitted_by_profile_id_fkey', 'f', 'submitted_by_profile_id', 'profiles', 'r'),
            ('review_items_submitted_version_check', 'c', 'submitted_version', '', ' '),
            ('review_items_time_report_check', 'c', 'review_type,submitted_version', '', ' '),
            ('review_items_type_source_check', 'c', 'review_type,source', '', ' '),
            ('review_items_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
            ('review_items_version_check', 'c', 'version', '', ' '),
            ('review_items_visit_check', 'c', 'review_type,visit_id', '', ' '),
            ('review_items_visit_id_fkey', 'f', 'service_call_id,visit_id', 'visits', 'r') $$,
  'review_items: the dedupe key unique; the call by (service_call_id, is_test); the visit by (visit_id, service_call_id), so it belongs to the call; the type, source and decision rules; every foreign key RESTRICT');
select results_eq(
  $$ select * from pg_temp.tm_constraints('public.visit_corrections') $$,
  $$ values ('visit_corrections_corrected_by_fkey', 'f', 'corrected_by', 'profiles', 'r'),
            ('visit_corrections_field_check', 'c', 'field', '', ' '),
            ('visit_corrections_id_is_test_key', 'u', 'id,is_test', '', ' '),
            ('visit_corrections_new_value_check', 'c', 'field,new_value', '', ' '),
            ('visit_corrections_old_value_check', 'c', 'old_value', '', ' '),
            ('visit_corrections_pkey', 'p', 'id', '', ' '),
            ('visit_corrections_reason_check', 'c', 'reason', '', ' '),
            ('visit_corrections_value_check', 'c', 'old_value,new_value', '', ' '),
            ('visit_corrections_version_before_check', 'c', 'version_before', '', ' '),
            ('visit_corrections_version_check', 'c', 'version_before,version_after', '', ' '),
            ('visit_corrections_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r'),
            ('visit_corrections_visit_id_version_after_key', 'u', 'visit_id,version_after', '', ' ') $$,
  'visit_corrections: the visit by (visit_id, is_test); one correction per visit version; the field and value rules; every foreign key RESTRICT');
select results_eq(
  $$ select * from pg_temp.tm_constraints('public.offline_operations') $$,
  $$ values ('offline_operations_actor_profile_id_fkey', 'f', 'actor_profile_id', 'profiles', 'r'),
            ('offline_operations_device_sent_at_check', 'c', 'device_sent_at', '', ' '),
            ('offline_operations_device_tz_check', 'c', 'device_tz', '', ' '),
            ('offline_operations_device_utc_offset_min_check', 'c', 'device_utc_offset_min', '', ' '),
            ('offline_operations_expected_field_version_check', 'c', 'expected_field_version', '', ' '),
            ('offline_operations_op_type_check', 'c', 'op_type', '', ' '),
            ('offline_operations_payload_sha256_check', 'c', 'payload_sha256', '', ' '),
            ('offline_operations_pkey', 'p', 'operation_id', '', ' '),
            ('offline_operations_result_check', 'c', 'result', '', ' '),
            ('offline_operations_resulting_field_version_check', 'c', 'resulting_field_version', '', ' '),
            ('offline_operations_review_check', 'c', 'result,review_item_id', '', ' '),
            ('offline_operations_review_item_id_fkey', 'f', 'review_item_id,is_test', 'review_items', 'r'),
            ('offline_operations_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r') $$,
  'offline_operations: keyed by the operation id; the visit and the review item by (id, is_test); the device and result rules; every foreign key RESTRICT');
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid)
     from pg_constraint k
     where k.contype = 'c'
       and k.conrelid in ('public.review_items'::regclass, 'public.visit_corrections'::regclass, 'public.offline_operations'::regclass)
       and k.conname not in ('review_items_resolution_note_check', 'visit_corrections_reason_check', 'visit_corrections_new_value_check')
     order by k.conname::text collate "C" $$,
  $$ values ('offline_operations_device_sent_at_check', 'CHECK (isfinite(device_sent_at))'),
            ('offline_operations_device_tz_check', 'CHECK (((char_length(device_tz) <= 64) AND (device_tz ~ ''^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$''::text)))'),
            ('offline_operations_device_utc_offset_min_check', 'CHECK (((device_utc_offset_min >= ''-840''::integer) AND (device_utc_offset_min <= 840)))'),
            ('offline_operations_expected_field_version_check', 'CHECK ((expected_field_version >= 1))'),
            ('offline_operations_op_type_check', 'CHECK ((op_type = ANY (ARRAY[''time_report''::text, ''pickup''::text, ''summary''::text, ''parts''::text, ''media''::text, ''recording''::text, ''close''::text])))'),
            ('offline_operations_payload_sha256_check', 'CHECK ((payload_sha256 ~ ''^[0-9a-f]{64}$''::text))'),
            ('offline_operations_result_check', 'CHECK ((result = ANY (ARRAY[''applied''::text, ''review''::text])))'),
            ('offline_operations_resulting_field_version_check', 'CHECK ((resulting_field_version >= 1))'),
            ('offline_operations_review_check', 'CHECK (((result = ''review''::text) = (review_item_id IS NOT NULL)))'),
            ('review_items_base_version_check', 'CHECK (((jsonb_typeof(base_version) = ''object''::text) AND (pg_column_size(base_version) <= 16384)))'),
            ('review_items_current_version_check', 'CHECK (((jsonb_typeof(current_version) = ''object''::text) AND (pg_column_size(current_version) <= 16384)))'),
            ('review_items_dedupe_key_check', 'CHECK ((dedupe_key ~ ''^[A-Za-z0-9._:-]{1,200}$''::text))'),
            ('review_items_device_check', 'CHECK (((source <> ''device''::text) OR ((operation_id IS NOT NULL) AND (submitted_by_profile_id IS NOT NULL) AND (source_ref IS NULL))))'),
            ('review_items_invitation_check', 'CHECK (((source <> ''invitation''::text) OR ((source_ref IS NOT NULL) AND (operation_id IS NULL) AND (submitted_by_profile_id IS NULL))))'),
            ('review_items_resolution_check', 'CHECK ((resolution = ANY (ARRAY[''apply_incoming''::text, ''keep_current''::text, ''per_field''::text])))'),
            ('review_items_resolution_choices_check', 'CHECK (((jsonb_typeof(resolution_choices) = ''object''::text) AND (resolution_choices <> ''{}''::jsonb) AND (pg_column_size(resolution_choices) <= 16384) AND (NOT jsonb_path_exists(resolution_choices, ''$.keyvalue()?((!(@."key" like_regex "^[A-Za-z][A-Za-z0-9_]{0,62}$") || @."value".type() != "string") || @."value" != "current" && @."value" != "incoming")''::jsonpath))))'),
            ('review_items_resolution_state_check', 'CHECK ((((status = ''open''::text) AND (resolved_at IS NULL) AND (resolved_by IS NULL) AND (resolution IS NULL) AND (resolution_choices IS NULL) AND (resolution_note IS NULL)) OR ((status = ''resolved''::text) AND (resolved_at IS NOT NULL) AND (resolved_by IS NOT NULL) AND (resolution IS NOT NULL) AND ((resolution = ''per_field''::text) = (resolution_choices IS NOT NULL)))))'),
            ('review_items_review_type_check', 'CHECK ((review_type = ANY (ARRAY[''reassignment''::text, ''cancellation''::text, ''address_change''::text, ''customer_change''::text, ''sku_change''::text, ''edit_conflict''::text, ''closure_of_cancelled_visit''::text, ''approval_text_mismatch''::text, ''duplicate_time_report''::text])))'),
            ('review_items_source_check', 'CHECK ((source = ANY (ARRAY[''invitation''::text, ''device''::text])))'),
            ('review_items_source_ref_check', 'CHECK ((source_ref ~ ''^[A-Za-z0-9._:-]{1,200}$''::text))'),
            ('review_items_status_check', 'CHECK ((status = ANY (ARRAY[''open''::text, ''resolved''::text])))'),
            ('review_items_submitted_version_check', 'CHECK (((jsonb_typeof(submitted_version) = ''object''::text) AND (pg_column_size(submitted_version) <= 16384)))'),
            ('review_items_time_report_check', 'CHECK (((review_type <> ''duplicate_time_report''::text) OR ((submitted_version ?& ARRAY[''kind''::text, ''reported_at''::text, ''device_tz''::text, ''device_utc_offset_min''::text, ''device_sent_at''::text]) AND ((submitted_version ->> ''kind''::text) = ANY (ARRAY[''departed''::text, ''arrived''::text, ''ended''::text, ''signed''::text])) AND ((submitted_version ->> ''reported_at''::text) ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}(:[0-9]{2}){0,2}$''::text) AND ((submitted_version ->> ''device_sent_at''::text) ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}(:[0-9]{2}){0,2}$''::text))))'),
            ('review_items_type_source_check', 'CHECK ((((review_type = ANY (ARRAY[''reassignment''::text, ''cancellation''::text, ''address_change''::text, ''customer_change''::text, ''sku_change''::text])) AND (source = ''invitation''::text)) OR ((review_type = ANY (ARRAY[''edit_conflict''::text, ''closure_of_cancelled_visit''::text, ''approval_text_mismatch''::text, ''duplicate_time_report''::text])) AND (source = ''device''::text))))'),
            ('review_items_version_check', 'CHECK ((version >= 1))'),
            ('review_items_visit_check', 'CHECK (((visit_id IS NULL) = (review_type = ANY (ARRAY[''customer_change''::text, ''sku_change''::text]))))'),
            ('visit_corrections_field_check', 'CHECK ((field = ANY (ARRAY[''summary''::text, ''followup_reason''::text, ''next_visit_notes''::text, ''departed''::text, ''arrived''::text, ''ended''::text])))'),
            ('visit_corrections_old_value_check', 'CHECK (((jsonb_typeof(old_value) = ''string''::text) AND (pg_column_size(old_value) <= 16384)))'),
            ('visit_corrections_value_check', 'CHECK ((old_value IS DISTINCT FROM new_value))'),
            ('visit_corrections_version_before_check', 'CHECK ((version_before >= 1))'),
            ('visit_corrections_version_check', 'CHECK ((version_after = (version_before + 1)))') $$,
  'value sets and rules (TEMPORARY OQ-9, OQ-10, OQ-12; codes only grow): review types, sources and decisions, the operation types and results, the dedupe and reference formats, JSON objects for the versions, versions and field versions from 1');
select results_eq(
  $$ select i.relname::text collate "default", pg_get_indexdef(x.indexrelid)
     from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
     where c.relnamespace = 'public'::regnamespace and c.relname in ('review_items', 'visit_corrections', 'offline_operations')
     order by i.relname::text collate "C" $$,
  $$ values ('offline_operations_actor_profile_id_received_at_idx', 'CREATE INDEX offline_operations_actor_profile_id_received_at_idx ON public.offline_operations USING btree (actor_profile_id, received_at)'),
            ('offline_operations_pkey', 'CREATE UNIQUE INDEX offline_operations_pkey ON public.offline_operations USING btree (operation_id)'),
            ('offline_operations_review_item_id_idx', 'CREATE INDEX offline_operations_review_item_id_idx ON public.offline_operations USING btree (review_item_id) WHERE (review_item_id IS NOT NULL)'),
            ('offline_operations_visit_id_idx', 'CREATE INDEX offline_operations_visit_id_idx ON public.offline_operations USING btree (visit_id)'),
            ('review_items_dedupe_key_key', 'CREATE UNIQUE INDEX review_items_dedupe_key_key ON public.review_items USING btree (dedupe_key)'),
            ('review_items_id_is_test_key', 'CREATE UNIQUE INDEX review_items_id_is_test_key ON public.review_items USING btree (id, is_test)'),
            ('review_items_operation_id_idx', 'CREATE INDEX review_items_operation_id_idx ON public.review_items USING btree (operation_id) WHERE (operation_id IS NOT NULL)'),
            ('review_items_pkey', 'CREATE UNIQUE INDEX review_items_pkey ON public.review_items USING btree (id)'),
            ('review_items_service_call_id_idx', 'CREATE INDEX review_items_service_call_id_idx ON public.review_items USING btree (service_call_id)'),
            ('review_items_status_created_at_idx', 'CREATE INDEX review_items_status_created_at_idx ON public.review_items USING btree (status, created_at)'),
            ('review_items_visit_id_idx', 'CREATE INDEX review_items_visit_id_idx ON public.review_items USING btree (visit_id) WHERE (visit_id IS NOT NULL)'),
            ('visit_corrections_corrected_by_idx', 'CREATE INDEX visit_corrections_corrected_by_idx ON public.visit_corrections USING btree (corrected_by)'),
            ('visit_corrections_id_is_test_key', 'CREATE UNIQUE INDEX visit_corrections_id_is_test_key ON public.visit_corrections USING btree (id, is_test)'),
            ('visit_corrections_pkey', 'CREATE UNIQUE INDEX visit_corrections_pkey ON public.visit_corrections USING btree (id)'),
            ('visit_corrections_visit_id_field_version_after_idx', 'CREATE INDEX visit_corrections_visit_id_field_version_after_idx ON public.visit_corrections USING btree (visit_id, field, version_after)'),
            ('visit_corrections_visit_id_version_after_key', 'CREATE UNIQUE INDEX visit_corrections_visit_id_version_after_key ON public.visit_corrections USING btree (visit_id, version_after)') $$,
  'indexes: the keys, the review list (status, created_at), the lookups by call, visit and operation, the corrections per visit and field, and the operations per actor (T-01)');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.review_items') $$,
  $$ values ('CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''status'', ''resolved_at'', ''resolved_by'', ''resolution'', ''resolution_choices'', ''resolution_note'', ''version'', ''updated_at'', ''updated_by'')'),
            ('CREATE TRIGGER t12_review_state BEFORE INSERT OR UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_review_item_state()'),
            ('CREATE TRIGGER t15_marker_from_call BEFORE INSERT ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_call_child_marker()'),
            ('CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
            ('CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''submitted_by_profile_id'', ''resolved_by'', ''updated_by'')'),
            ('CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
            ('CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.review_items FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
            ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.review_items FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'review_items: only the decision columns change (t10); t12 created open and decided once; marker from the call (t15) and frozen (t20); one-way people (t30); version; no delete or truncate');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visit_corrections') $$,
  $$ values ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.visit_corrections FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'),
            ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.visit_corrections FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
            ('CREATE TRIGGER t16_correction_time BEFORE INSERT ON public.visit_corrections FOR EACH ROW EXECUTE FUNCTION private.tg_history_server_time()'),
            ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.visit_corrections FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''corrected_by'')'),
            ('CREATE TRIGGER t31_correction_guard BEFORE INSERT ON public.visit_corrections FOR EACH ROW EXECUTE FUNCTION private.tg_visit_correction_guard()'),
            ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visit_corrections FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visit_corrections: append-only; marker from the visit; server time; one-way corrector; the D14 guard after the marker');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.offline_operations') $$,
  $$ values ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.offline_operations FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'),
            ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.offline_operations FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
            ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.offline_operations FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''actor_profile_id'')'),
            ('CREATE TRIGGER t35_offline_operation BEFORE INSERT ON public.offline_operations FOR EACH ROW EXECUTE FUNCTION private.tg_offline_operation_derive()'),
            ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.offline_operations FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'offline_operations: immutable; marker from the visit; one-way actor; the server receipt time and the review-item match');
select results_eq(
  $$ select c.relname::text collate "default", c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)::text collate "default",
            obj_description(c.oid, 'pg_class') is not null
     from pg_class c where c.relnamespace = 'public'::regnamespace
       and c.relname in ('review_items', 'visit_corrections', 'offline_operations')
     order by c.relname::text collate "C" $$,
  $$ values ('offline_operations'::text, true, false, 'postgres'::text, true), ('review_items', true, false, 'postgres', true),
            ('visit_corrections', true, false, 'postgres', true) $$,
  'the three tables: RLS on (not forced: the definer writers run as the owner), owned by postgres, with a comment');

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test, automated_test; D47): the real Creator
-- c1, Managers a1 and a2, Customer Service b1, Technicians A (d1, e1) and B (d2, e2), a signed-in
-- user f0 without a profile. Call K (R-2301, open) has visit 1 (done, Technician A, with its
-- summary, signature and device times), visit 2 (followup, Technician A), visit 3 (scheduled,
-- Technician B) and visit 4 (cancelled, Technician A). Every row is test data.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'a2', 'b1', 'd1', 'd2', 'f0']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000230c01', 'C-2301', 'לקוח בדיקה', '050-000-2301', 'automated_test', 'pr16-230');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000230d01', 'kt-2301', 'KT-2301', 'מוצר בדיקה', 'automated_test', 'pr16-230');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000230a01', 'R-2301', '00000000-0000-4000-8000-000000230c01',
        '00000000-0000-4000-8000-000000230d01', (select c.id from public.call_types c where c.sort_order = 1),
        'תקלת בדיקה', 'נציג בדיקה', 'open', 5, 'automated_test', 'pr16-230-k');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, followup_reason_id, next_visit_notes, source_ref) values
  ('00000000-0000-4000-8000-000000230b01', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-0000000000e1',
   1, 'K1', now() - interval '3 hours', now() - interval '2 hours', 'done', 'עיר בדיקה', 'רחוב הבדיקה 1', null, null, 'pr16-230-k1'),
  ('00000000-0000-4000-8000-000000230b02', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-0000000000e1',
   2, 'K2', now() - interval '2 hours', now() - interval '1 hour', 'followup', 'עיר בדיקה', 'רחוב הבדיקה 2',
   (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', 'pr16-230-k2'),
  ('00000000-0000-4000-8000-000000230b03', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-0000000000e2',
   3, 'K3', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 3', null, null,
   'pr16-230-k3'),
  ('00000000-0000-4000-8000-000000230b04', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-0000000000e1',
   4, 'K4', now() + interval '2 days', now() + interval '2 days 1 hour', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 4', null, null,
   'pr16-230-k4');
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  ('00000000-0000-4000-8000-000000230b01', 'הוחלף חלק', 'written'),
  ('00000000-0000-4000-8000-000000230b02', 'נדרש חלק', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-000000230b01', 'חותם בדיקה', 'נוסח בדיקה', encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'),
          '00000000-0000-4000-8000-000000230e00');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr16-230-k%';
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
select '00000000-0000-4000-8000-000000230b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
       x.kind, x.at, 'Asia/Jerusalem', 120, x.at + interval '1 minute', 'device', x.op::uuid
from (values ('departed', now() - interval '3 hours', '00000000-0000-4000-8000-000000230e01'),
             ('arrived', now() - interval '150 minutes', '00000000-0000-4000-8000-000000230e02'),
             ('ended', now() - interval '130 minutes', '00000000-0000-4000-8000-000000230e03')) as x (kind, at, op);
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;

-- A second call K2 (R-2302) with one scheduled visit, for the visit-belongs-to-the-call rule.
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000230a02', 'R-2302', '00000000-0000-4000-8000-000000230c01', '00000000-0000-4000-8000-000000230d01',
        (select c.id from public.call_types c where c.sort_order = 1), 'תקלה שנייה', 'נציג בדיקה', 'open', 2,
        'automated_test', 'pr16-230-k2');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
values ('00000000-0000-4000-8000-000000230b21', '00000000-0000-4000-8000-000000230a02', '00000000-0000-4000-8000-0000000000e1', 1, 'W1', now() + interval '3 days', now() + interval '3 days 1 hour', 'scheduled', 'עיר', 'רחוב',
        'pr16-230-w1');
insert into public.visit_events (visit_id, version_after, event_type, to_status) values ('00000000-0000-4000-8000-000000230b21', 1, 'created', 'scheduled');
select lives_ok('set constraints all immediate', 'the second call passes every deferred check');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 2. Markers (D47): copied from the parent, the client value ignored; frozen; composite keys
-- ---------------------------------------------------------------------------------------------
create temporary table tm_case (n integer generated always as identity, grp text not null, label text not null,
                                stmt text not null, probe text, expected text not null) on commit drop;
insert into tm_case (grp, label, stmt, probe, expected) values
  ('markers', 'review_items.is_test from the call (false sent)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version, is_test) values ('edit_conflict', 'pr16-m1', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}', false)$s$,
   $s$select is_test::text from public.review_items where dedupe_key = 'pr16-m1'$s$, 'true'),
  ('markers', 'visit_corrections.is_test from the visit (false sent)',
   $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by, is_test)
      values ('00000000-0000-4000-8000-000000230b01', 'summary', '"א"', '"ב"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1', false)$s$,
   $s$select is_test::text from public.visit_corrections$s$, 'true'),
  ('markers', 'offline_operations.is_test from the visit (false sent)',
   $s$insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
        device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version, is_test)
      values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000230b01', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, false)$s$,
   $s$select is_test::text from public.offline_operations$s$, 'true'),
  ('markers', 'review_items.is_test is frozen',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-m2', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set is_test = false where dedupe_key = 'pr16-m2'$s$, null,
   '55000 review_items: these fields are immutable'),
  ('markers', 'review_items.is_test is frozen by t20 too (t10 disabled)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-m3', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); alter table public.review_items disable trigger t10_immutable;
      update public.review_items set is_test = false where dedupe_key = 'pr16-m3'$s$, null,
   '55000 review_items: test-data markers are immutable (D47)'),
  ('markers', 'composite key: a real-marked item on a test call (t15 disabled)',
   $s$alter table public.review_items disable trigger t15_marker_from_call;
      insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version, is_test) values ('reassignment', 'pr16-m4', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b03', 'invitation', 'evt-1', null, null, '{}', '{}', false)$s$,
   null, '23503 review_items_service_call_id_fkey'),
  ('markers', 'composite key: a real-marked correction of a test visit (t15 disabled)',
   $s$alter table public.visit_corrections disable trigger t15_marker_from_visit;
      insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by, is_test)
      values ('00000000-0000-4000-8000-000000230b01', 'summary', '"א"', '"ב"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000c1', false)$s$, null, '23503 visit_corrections_visit_id_fkey'),
  ('markers', 'composite key: a real-marked operation on a test visit (t15 disabled)',
   $s$alter table public.offline_operations disable trigger t15_marker_from_visit;
      insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
        device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version, is_test)
      values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000230b01', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1, false)$s$,
   null, '23503 offline_operations_visit_id_fkey'),
  ('markers', 'the visit belongs to the item''s call (D44 composite key)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-m5', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b21', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}')$s$, null, '23503 review_items_visit_id_fkey'),
  ('markers', 'an unknown call', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-m6', gen_random_uuid(), null, 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}')$s$, null,
   '23503 review_items: unknown service call'),
  ('markers', 'a correction of an unknown visit', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values (gen_random_uuid(), 'summary', '"א"', '"ב"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23503 visit_corrections: unknown visit');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'markers' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'markers' order by c.n $$,
  'D47: the three tables copy is_test from their parent whatever the writer sends, never change it, and the composite foreign keys refuse a mismatch; a review item''s visit belongs to its call');

-- ---------------------------------------------------------------------------------------------
-- 3. review_items: created open, decided once, both versions frozen (D44)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, probe, expected) values
  ('items', 'created open, at the server time (a client created_at is ignored)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version, created_at) values ('edit_conflict', 'pr16-i1', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}', '2000-01-01')$s$,
   $s$select concat_ws(' ', status, created_at = now(), version) from public.review_items where dedupe_key = 'pr16-i1'$s$, 'open t 1'),
  ('items', 'never created decided', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version, status) values ('edit_conflict', 'pr16-i2', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}', 'resolved')$s$, null,
   '55000 review_items: an item is created open'),
  ('items', 'decided once: resolved_at is the server''s, the version rises',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i3', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolved_at = '2000-01-01', updated_by = '00000000-0000-4000-8000-0000000000a1' where dedupe_key = 'pr16-i3'$s$,
   $s$select concat_ws(' ', status, resolved_at = now(), version) from public.review_items where dedupe_key = 'pr16-i3'$s$,
   'resolved t 2'),
  ('items', 'a decided item never changes again',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i4', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1'
        where dedupe_key = 'pr16-i4';
      update public.review_items set resolution_note = 'מאוחר' where dedupe_key = 'pr16-i4'$s$, null,
   '55000 review_items: a resolved item never changes'),
  ('items', 'a decided item never reopens',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i5', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1'
        where dedupe_key = 'pr16-i5';
      update public.review_items set status = 'open', resolution = null, resolved_by = null, resolved_at = null
        where dedupe_key = 'pr16-i5'$s$, null, '55000 review_items: a resolved item never changes'),
  ('items', 'version A is frozen', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i6', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set submitted_version = '{"x": 1}'
        where dedupe_key = 'pr16-i6'$s$, null, '55000 review_items: these fields are immutable'),
  ('items', 'version B is frozen', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i7', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set current_version = '{"x": 1}'
        where dedupe_key = 'pr16-i7'$s$, null, '55000 review_items: these fields are immutable'),
  ('items', 'the base is frozen', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i8', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set base_version = '{"x": 1}'
        where dedupe_key = 'pr16-i8'$s$, null, '55000 review_items: these fields are immutable'),
  ('items', 'the type is frozen', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i9', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set review_type = 'approval_text_mismatch'
        where dedupe_key = 'pr16-i9'$s$, null, '55000 review_items: these fields are immutable'),
  ('items', 'decided without a decider',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i10', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current'
        where dedupe_key = 'pr16-i10'$s$, null, '23514 review_items_resolution_state_check'),
  ('items', 'per_field without choices',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i11', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'per_field', resolved_by = '00000000-0000-4000-8000-0000000000a1'
        where dedupe_key = 'pr16-i11'$s$, null, '23514 review_items_resolution_state_check'),
  ('items', 'a per-field choice outside current / incoming',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i12', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'per_field', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_choices = '{"summary": "both"}' where dedupe_key = 'pr16-i12'$s$, null, '23514 review_items_resolution_choices_check'),
  ('items', 'a per-field choice that is not a string',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i13', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'per_field', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_choices = '{"summary": 1}' where dedupe_key = 'pr16-i13'$s$, null, '23514 review_items_resolution_choices_check'),
  ('items', 'a per-field key that is not a field name',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i14', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'per_field', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_choices = '{"no such field": "current"}' where dedupe_key = 'pr16-i14'$s$, null,
   '23514 review_items_resolution_choices_check'),
  ('items', 'per_field with valid choices (positive control)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i15', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'per_field', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_choices = '{"summary": "incoming", "nextNote": "current"}' where dedupe_key = 'pr16-i15'$s$, null, 'ok'),
  ('items', 'a D39 type from a device', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('reassignment', 'pr16-i16', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}')$s$, null, '23514 review_items_type_source_check'),
  ('items', 'a device type from an invitation',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i17', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'invitation', 'evt-1', null, null, '{}', '{}')$s$,
   null, '23514 review_items_type_source_check'),
  ('items', 'a call-level type with a visit',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('customer_change', 'pr16-i18', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'invitation', 'evt-1', null, null, '{}', '{}')$s$,
   null, '23514 review_items_visit_check'),
  ('items', 'a visit-level type without a visit',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('address_change', 'pr16-i19', '00000000-0000-4000-8000-000000230a01', null, 'invitation', 'evt-1', null, null, '{}', '{}')$s$,
   null, '23514 review_items_visit_check'),
  ('items', 'a device item without its operation',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i20', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', null, '{}', '{}')$s$,
   null, '23514 review_items_device_check'),
  ('items', 'an invitation item with a device operation',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('reassignment', 'pr16-i21', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b03', 'invitation', 'evt-1', null, gen_random_uuid(), '{}', '{}')$s$,
   null, '23514 review_items_invitation_check'),
  ('items', 'a JSON null as version B',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i22', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', 'null')$s$,
   null, '23514 review_items_current_version_check'),
  ('items', 'a note with a leading line feed (TEXT-SAFE-ML)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i23', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_note = chr(10) || 'הערה' where dedupe_key = 'pr16-i23'$s$, null, '23514 review_items_resolution_note_check'),
  ('items', 'a note with a line feed inside (positive control)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i24', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1',
        resolution_note = 'שורה' || chr(10) || 'שנייה' where dedupe_key = 'pr16-i24'$s$, null, 'ok'),
  ('items', 'never deleted', $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-i25', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}'); delete from public.review_items where dedupe_key = 'pr16-i25'$s$, null,
   '55000 review_items: rows are never deleted'),
  ('items', 'a second device report with every value (positive control, review N2)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('duplicate_time_report', 'pr16-i26', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{"kind": "arrived", "reported_at": "2026-11-16T08:00:00+02:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-11-16T08:01:00.123456+02:00"}', '{}')$s$, null, 'ok'),
  ('items', 'a second device report whose time has no UTC offset (review N2)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('duplicate_time_report', 'pr16-i27', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{"kind": "arrived", "reported_at": "2026-11-16T08:00:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-11-16T08:01:00.123456+02:00"}', '{}')$s$, null, '23514 review_items_time_report_check'),
  ('items', 'a second device report whose send time is not a time (review N2)',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('duplicate_time_report', 'pr16-i28', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{"kind": "arrived", "reported_at": "2026-11-16T08:00:00+02:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "אתמול"}', '{}')$s$, null, '23514 review_items_time_report_check'),
  ('items', 'a second device report of an unknown kind',
   $s$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('duplicate_time_report', 'pr16-i29', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{"kind": "lunch", "reported_at": "2026-11-16T08:00:00+02:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-11-16T08:01:00.123456+02:00"}', '{}')$s$, null, '23514 review_items_time_report_check');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'items' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'items' order by c.n $$,
  'review_items: created open at the server time; decided once (server time, version raised), never changed or reopened after; both versions, the base and the type frozen; the decision, type, source and note rules; a second device report carries a field-time kind and offset-qualified times (review N2); never deleted');

-- ---------------------------------------------------------------------------------------------
-- 4. visit_corrections: only of a server-closed visit (D14); append-only; value rules
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, probe, expected) values
  ('corr', 'a summary of the done visit (positive control; server time)', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', '"הוחלף חלק"', '"סיכום מתוקן"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$,
   $s$select concat_ws(' ', recorded_at = now(), is_test) from public.visit_corrections$s$, 't t'),
  ('corr', 'a scheduled visit (not server-closed)', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b03', 'summary', null, '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections: this field of this visit cannot be corrected'),
  ('corr', 'a cancelled visit', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b04', 'summary', null, '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections: this field of this visit cannot be corrected'),
  ('corr', 'the continuation reason of a done visit', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'followup_reason', null, to_jsonb((select r.id from public.followup_reasons r where r.sort_order = 2)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$,
   null, '23514 visit_corrections: this field of this visit cannot be corrected'),
  ('corr', 'the next-visit notes of a done visit', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'next_visit_notes', null, '"הערה"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections: this field of this visit cannot be corrected'),
  ('corr', 'the continuation reason of the followup visit (positive control)',
   $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b02', 'followup_reason', to_jsonb((select r.id from public.followup_reasons r where r.sort_order = 1)), to_jsonb((select r.id from public.followup_reasons r where r.sort_order = 2)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$,
   null, 'ok'),
  ('corr', 'an unknown continuation reason', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b02', 'followup_reason', null, to_jsonb(gen_random_uuid()), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23503 visit_corrections: unknown continuation reason'),
  ('corr', 'a continuation reason that is not an id', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b02', 'followup_reason', null, '"סיבה"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_new_value_check'),
  ('corr', 'a field outside the set (parts, OQ-5)', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'parts', null, '"חלק"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, '23514 visit_corrections_field_check'),
  ('corr', 'a summary that is not a JSON string', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '["סיכום"]', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, '23514 visit_corrections_new_value_check'),
  ('corr', 'a summary with a leading space', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '" סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, '23514 visit_corrections_new_value_check'),
  ('corr', 'a summary with a control character', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, to_jsonb('סיכום' || chr(27)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_new_value_check'),
  ('corr', 'a summary of 4001 characters', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, to_jsonb(repeat('א', 4001)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_new_value_check'),
  ('corr', 'next-visit notes of 1001 characters', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b02', 'next_visit_notes', null, to_jsonb(repeat('א', 1001)), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_new_value_check'),
  ('corr', 'a field time without a UTC offset', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', null, '"2026-11-16T08:00:00"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_new_value_check'),
  ('corr', 'a field time with its offset (positive control)', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', null, '"2026-11-16T08:00:00+02:00"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, 'ok'),
  ('corr', 'an old value that is not a JSON string', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', '1', '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, '23514 visit_corrections_old_value_check'),
  ('corr', 'no change', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', '"סיכום"', '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null, '23514 visit_corrections_value_check'),
  ('corr', 'versions that do not step by one', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', 'סיבה', 1, 3, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_version_check'),
  ('corr', 'two corrections claiming one visit version',
   $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1'); insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', null, '"2026-11-16T08:00:00+02:00"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23505 visit_corrections_visit_id_version_after_key'),
  ('corr', 'a reason with a control character', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', 'סיבה' || chr(7), 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_reason_check'),
  ('corr', 'a reason of 501 characters', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', repeat('א', 501), 1, 2, '00000000-0000-4000-8000-0000000000a1')$s$, null,
   '23514 visit_corrections_reason_check'),
  ('corr', 'update a correction', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1'); update public.visit_corrections set reason = 'אחרת'$s$, null,
   '55000 visit_corrections is append-only'),
  ('corr', 'delete a correction', $s$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'summary', null, '"סיכום"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1'); delete from public.visit_corrections$s$, null,
   '55000 visit_corrections is append-only');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'corr' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'corr' order by c.n $$,
  'visit_corrections: only of a server-closed visit (follow-up fields of a followup visit only, D14); one per visit version; the value rules per field (TEXT-SAFE-ML, an existing reason id, a time with its offset); append-only, also for postgres');

-- ---------------------------------------------------------------------------------------------
-- 5. visit_time_reports: the two kinds of correction rows (D45; OQ-13)
-- ---------------------------------------------------------------------------------------------
-- tm_corr: the visit_corrections row c1 (arrived of visit 1, 08:00 +02:00, by the Manager), then p_sql.
create function pg_temp.tm_corr(p_sql text) returns text language sql as $f$
  select $q$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', null, '"2026-11-16T08:00:00+02:00"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1'); $q$ || p_sql
$f$;
-- tm_item: a resolved, accepted second departure report of visit 1 by Technician A (operation f1),
-- created at p_created (t12 and t10 disabled inside the scenario to back-date it), then p_sql.
create function pg_temp.tm_item(p_sql text, p_resolution text default 'apply_incoming', p_created text default 'now()')
returns text language sql as $f$
  select 'alter table public.review_items disable trigger t12_review_state;
          alter table public.review_items disable trigger t10_immutable;
          insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, submitted_by_profile_id,
            operation_id, submitted_version, current_version, status, created_at, resolved_at, resolved_by, resolution)
          values (''duplicate_time_report'', ''pr16-t1'', ''00000000-0000-4000-8000-000000230a01'', ''00000000-0000-4000-8000-000000230b01'', ''device'',
            ''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-000000230f01'',
            ''{"kind": "departed", "reported_at": "2026-11-16T06:00:00+00:00", "device_tz": "Asia/Jerusalem", "device_utc_offset_min": 120, "device_sent_at": "2026-11-16T06:01:00+00:00"}'',
            ''{}'', ''resolved'', ' || p_created || ', now(), ''00000000-0000-4000-8000-0000000000a1'', ' || quote_literal(p_resolution) || ');
          alter table public.review_items enable trigger t12_review_state;
          alter table public.review_items enable trigger t10_immutable; ' || p_sql
$f$;
create function pg_temp.tm_tr(p_cols text, p_vals text) returns text language sql as $f$
  select 'insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, source, ' || p_cols
         || ') values (''00000000-0000-4000-8000-000000230b01'', ' || p_vals || ')'
$f$;
insert into tm_case (grp, label, stmt, probe, expected)
select 'times', x.label, x.stmt, x.probe, x.expected
from (values
  (1, 'an office correction matching its correction row (positive control)',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections)')),
   $s$select concat_ws(' ', t.received_at = now(), t.clock_skew_ms is null, t.row_flags::text) from public.visit_time_reports t where t.source = 'correction'$s$,
   't t {}'),
  (2, 'another kind than the corrected field',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''ended'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections)')),
   null, '23514 visit_time_reports: a corrected time matches its correction'),
  (3, 'another reporter than the corrector',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000c1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections)')),
   null, '23514 visit_time_reports: a corrected time matches its correction'),
  (4, 'another time than the corrected one',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:01:00Z'', (select id from public.visit_corrections)')),
   null, '23514 visit_time_reports: a corrected time matches its correction'),
  (5, 'an unknown correction',
   pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', now(), gen_random_uuid()'),
   null, '23503 visit_time_reports: unknown correction'),
  (6, 'an office correction with device values',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, device_tz, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', ''Asia/Jerusalem'', (select id from public.visit_corrections)')),
   null, '23514 visit_time_reports_correction_check'),
  (7, 'a correction row naming both a correction and a review item (t35 disabled; CHECKs run by name, accepted_check first)',
   pg_temp.tm_corr('alter table public.visit_time_reports disable trigger t35_time_report; ' || pg_temp.tm_tr('reported_at, correction_id, accepted_review_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections), gen_random_uuid()')),
   null, '23514 visit_time_reports_accepted_check'),
  (8, 'a correction row naming neither',
   pg_temp.tm_tr('reported_at', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', now()'),
   null, '23514 visit_time_reports_source_check'),
  (9, 'a device row naming a correction (t35 disabled; CHECKs run by name, correction_check first)',
   pg_temp.tm_corr('alter table public.visit_time_reports disable trigger t35_time_report; ' || pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, correction_id', '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''signed'', ''device'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), (select id from public.visit_corrections)')),
   null, '23514 visit_time_reports_correction_check'),
  (10, 'an accepted report matching its resolved item, back-dated: it keeps the item''s receipt time (OQ-13)',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now() - interval ''2 hours'', ''Asia/Jerusalem'', 120, now() - interval ''119 minutes'', ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')'),
     'apply_incoming', 'now() - interval ''1 hour'''),
   $s$select concat_ws(' ', t.received_at = now() - interval '1 hour', t.clock_skew_ms, t.row_flags::text)
      from public.visit_time_reports t where t.accepted_review_id is not null$s$,
   't -3540000 {large_skew,before_assignment}'),
  (11, 'an accepted report of an item kept as it was (keep_current)',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')'),
     'keep_current'),
   null, '23514 visit_time_reports: an accepted report matches its review item'),
  (12, 'an accepted report under another reporter than the submitter',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d2'', ''00000000-0000-4000-8000-0000000000e2'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')')),
   null, '23514 visit_time_reports: an accepted report matches its review item'),
  (13, 'an accepted report under another operation id',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), (select id from public.review_items where dedupe_key = ''pr16-t1'')')),
   null, '23514 visit_time_reports: an accepted report matches its review item'),
  (14, 'an accepted report credited to another technician than its reporter',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e2'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')')),
   null, '23514 visit_time_reports: an accepted report matches its review item'),
  (15, 'an accepted report without its device values',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')')),
   null, '23514 visit_time_reports_accepted_check'),
  (17, 'a second time report for the same correction (unique, review N1)',
   pg_temp.tm_corr(pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections)')
     || '; ' || pg_temp.tm_tr('reported_at, correction_id', '''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000e1'', ''arrived'', ''correction'', ''2026-11-16T06:00:00Z'', (select id from public.visit_corrections)')),
   null, '23505 visit_time_reports_correction_id_key'),
  (18, 'a second accepted report for the same review item (unique, review N1)',
   pg_temp.tm_item(pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')')
     || '; ' || pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), ''00000000-0000-4000-8000-000000230f01'', (select id from public.review_items where dedupe_key = ''pr16-t1'')')),
   null, '23505 visit_time_reports_accepted_review_id_key'),
  (16, 'an unknown review item',
   pg_temp.tm_tr('reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, accepted_review_id',
     '''00000000-0000-4000-8000-0000000000d1'', ''00000000-0000-4000-8000-0000000000e1'', ''departed'', ''correction'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), gen_random_uuid()'),
   null, '23503 visit_time_reports: unknown review item')
) as x (n, label, stmt, probe, expected)
order by x.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'times' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'times' order by c.n $$,
  'visit_time_reports (D45): an office correction carries only the corrected time and matches its correction row; an accepted report matches a resolved, accepted duplicate_time_report item (reporter, credited technician, operation), keeps every device value and its original receipt time, and its skew and flags are computed on that time');

-- ---------------------------------------------------------------------------------------------
-- 5b. Originals are never overwritten, for every writer (TEMPORARY OQ-7; independent review S3):
--     visit_reports rows keep their summary (t11_frozen), and a done or followup visit keeps its
--     continuation reason and next-visit notes (t14_closed_fields); a cancelled visit may still
--     receive them (a D44 accepted closure, PR 1.5 DEV-18), an open visit too.
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, probe, expected) values
  ('frozen', 'a summary never changes after insert', $s$update public.visit_reports set summary_text = 'אחר' where visit_id = '00000000-0000-4000-8000-000000230b01'$s$,
   null, '55000 visit_reports: these fields are immutable'),
  ('frozen', 'nor its source', $s$update public.visit_reports set summary_source = 'approved_transcription' where visit_id = '00000000-0000-4000-8000-000000230b01'$s$,
   null, '55000 visit_reports: these fields are immutable'),
  ('frozen', 'bookkeeping may change (positive control)', $s$update public.visit_reports set updated_by = '00000000-0000-4000-8000-0000000000a1' where visit_id = '00000000-0000-4000-8000-000000230b01'$s$,
   $s$select version::text from public.visit_reports where visit_id = '00000000-0000-4000-8000-000000230b01'$s$, '2'),
  ('frozen', 'a done visit gets a continuation reason',
   $s$update public.visits set followup_reason_id = (select r.id from public.followup_reasons r where r.sort_order = 2) where id = '00000000-0000-4000-8000-000000230b01'$s$,
   null, '55000 visits: a closed visit keeps its continuation reason and next-visit notes'),
  ('frozen', 'a done visit becomes followup (no outcome correction, PR 1.5 OQ-14)',
   $s$update public.visits set status = 'followup', followup_reason_id = (select r.id from public.followup_reasons r where r.sort_order = 2),
        next_visit_notes = 'הערה' where id = '00000000-0000-4000-8000-000000230b01'$s$,
   null, '55000 visits: a closed visit keeps its continuation reason and next-visit notes'),
  ('frozen', 'a followup visit changes its reason',
   $s$update public.visits set followup_reason_id = (select r.id from public.followup_reasons r where r.sort_order = 2) where id = '00000000-0000-4000-8000-000000230b02'$s$,
   null, '55000 visits: a closed visit keeps its continuation reason and next-visit notes'),
  ('frozen', 'a followup visit changes its next-visit notes', $s$update public.visits set next_visit_notes = 'אחרת' where id = '00000000-0000-4000-8000-000000230b02'$s$,
   null, '55000 visits: a closed visit keeps its continuation reason and next-visit notes'),
  ('frozen', 'a followup visit keeps them and updates its bookkeeping (positive control)',
   $s$update public.visits set updated_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000230b02'$s$, null, 'ok'),
  ('frozen', 'a cancelled visit may receive them (D44 accepted closure, PR 1.5 DEV-18)',
   $s$update public.visits set followup_reason_id = (select r.id from public.followup_reasons r where r.sort_order = 2),
        next_visit_notes = 'לבדוק' where id = '00000000-0000-4000-8000-000000230b04'$s$, null, 'ok'),
  ('frozen', 'an open visit may receive them', $s$update public.visits set next_visit_notes = 'להביא סולם' where id = '00000000-0000-4000-8000-000000230b03'$s$, null, 'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'frozen' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'frozen' order by c.n $$,
  'originals are never overwritten (OQ-7): a treatment summary never changes after insert, a closed visit keeps its continuation reason and next-visit notes (so no done -> followup change), whatever the writer; a cancelled or open visit may still receive them');

-- ---------------------------------------------------------------------------------------------
-- 6. visits.field_version (database-schema.md §1; OQ-14)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, probe, expected)
select 'fv', x.label, x.stmt,
       case when x.n = 1 then $s$select v.field_version::text from public.visits v where v.source_ref = 'pr16-230-w2'$s$
            else $s$select v.field_version::text from public.visits v where v.id = '00000000-0000-4000-8000-000000230b03'$s$ end, x.expected
from (values
  (1, 'a new visit starts at 1 (a client value is ignored)',
   $s$update public.service_calls set next_visit_number = 3 where id = '00000000-0000-4000-8000-000000230a02';
      insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end, status,
        city, street, source_ref, field_version)
      values ('00000000-0000-4000-8000-000000230a02', '00000000-0000-4000-8000-0000000000e1', 2, 'W2', now(), now(), 'scheduled', 'עיר', 'רחוב', 'pr16-230-w2', 7)$s$, '1'),
  (2, 'status (en route)', $s$update public.visits set status = 'en_route' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (3, 'assignment (another technician)', $s$update public.visits set technician_id = '00000000-0000-4000-8000-0000000000e1' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (4, 'cancellation', $s$update public.visits set status = 'cancelled', cancelled_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (5, 'city', $s$update public.visits set city = 'עיר אחרת' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (6, 'street', $s$update public.visits set street = 'רחוב אחר' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (7, 'building', $s$update public.visits set building = '5' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (8, 'floor', $s$update public.visits set floor = '2' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (9, 'apartment', $s$update public.visits set apartment = '9' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (10, 'status and street in one change: one step', $s$update public.visits set status = 'en_route', street = 'רחוב אחר' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (11, 'two changes: two steps', $s$update public.visits set status = 'en_route' where id = '00000000-0000-4000-8000-000000230b03';
                                    update public.visits set status = 'in_progress' where id = '00000000-0000-4000-8000-000000230b03'$s$, '3'),
  (12, 'non-critical: the schedule (D39)', $s$update public.visits set scheduled_start = scheduled_start + interval '1 hour',
                                               scheduled_end = scheduled_end + interval '1 hour' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (13, 'non-critical: technician notes', $s$update public.visits set tech_notes = 'להביא סולם' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (14, 'non-critical: arrival notes', $s$update public.visits set arrival_notes = 'קוד 1234' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (15, 'non-critical: the pickup item', $s$update public.visits set pickup_item = 'מדחס' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (16, 'non-critical: the task number', $s$update public.visits set task_number = 'K3b' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (17, 'bookkeeping (updated_by)', $s$update public.visits set updated_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-000000230b03'$s$, '1'),
  (18, 'a writer raises it by one (call-level D39 change)', $s$update public.visits set field_version = field_version + 1 where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (19, 'a writer''s raise with a critical change is still one step',
   $s$update public.visits set field_version = field_version + 1, status = 'en_route' where id = '00000000-0000-4000-8000-000000230b03'$s$, '2'),
  (20, 'a writer cannot jump it', $s$update public.visits set field_version = field_version + 2 where id = '00000000-0000-4000-8000-000000230b03'$s$,
   '55000 visits: field_version is set by the server'),
  (21, 'a writer cannot lower it', $s$update public.visits set status = 'en_route' where id = '00000000-0000-4000-8000-000000230b03';
                                     update public.visits set field_version = 1 where id = '00000000-0000-4000-8000-000000230b03'$s$,
   '55000 visits: field_version is set by the server')
) as x (n, label, stmt, expected)
order by x.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt, c.probe) from tm_case c where c.grp = 'fv' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'fv' order by c.n $$,
  'field_version starts at 1 and rises by one with each change of status, assignment or address (closure and cancellation included); the schedule, notes, pickup, task number and bookkeeping leave it; a writer may add exactly one, never jump or lower it');
select is(pg_temp.tm_try(
  $$ update public.visits set status = 'en_route' where id = '00000000-0000-4000-8000-000000230b03';
     update public.visits set status = 'in_progress' where id = '00000000-0000-4000-8000-000000230b03';
     update public.visits set status = 'done' where id = '00000000-0000-4000-8000-000000230b03';
     insert into public.visit_reports (visit_id, summary_text, summary_source) values ('00000000-0000-4000-8000-000000230b03', 'סיכום', 'written');
     insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
       values ('00000000-0000-4000-8000-000000230b03', 'חותם', 'נוסח', encode(sha256(convert_to('נוסח', 'UTF8')), 'hex'), gen_random_uuid());
     insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
       values ('00000000-0000-4000-8000-000000230b03', 4, 'status_changed', 'scheduled', 'done');
     select private.recalc_call_status('00000000-0000-4000-8000-000000230a01');
     set constraints all immediate $$,
  $$ select v.field_version || ' ' || (select c.status from public.service_calls c where c.id = '00000000-0000-4000-8000-000000230a01')
     from public.visits v where v.id = '00000000-0000-4000-8000-000000230b03' $$),
  '4 resolved',
  'a closure through the field statuses raises field_version three times, and the call recalculated in the same transaction passes every deferred check');

-- ---------------------------------------------------------------------------------------------
-- 7. visit_time_current: the newest correction wins, a late device report never overrides it
--    (D45; database-schema.md §7)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_try(
  $$ insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b02', 'arrived', null, '"2026-11-16T08:00:00+02:00"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1');
     insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source, correction_id)
       values ('00000000-0000-4000-8000-000000230b02', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'arrived', '2026-11-16T06:00:00Z', 'correction', (select id from public.visit_corrections));
     insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                            device_utc_offset_min, device_sent_at, source, operation_id)
       values ('00000000-0000-4000-8000-000000230b02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', 'arrived', '2026-11-16T07:00:00Z', 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid()) $$,
  $$ select c.source || ' ' || (c.reported_at = '2026-11-16T06:00:00Z') || ' '
            || (select count(*) from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-000000230b02')
     from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000230b02' and c.kind = 'arrived' $$),
  'correction true 2',
  'a device report that arrives after an office correction is stored but never overrides it (D45)');
select is(pg_temp.tm_try(
  $$ insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', '"x"', to_jsonb(timestamptz '2026-01-01T00:00:00Z'), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1');
     insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source, correction_id)
       select '00000000-0000-4000-8000-000000230b01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'arrived', '2026-01-01T00:00:00Z', 'correction', c.id from public.visit_corrections c where c.version_after = 2 $$,
  $$ select c.sequence_flags::text from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000230b01' and c.kind = 'arrived' $$),
  '{before_departed}',
  'a correction to a time before the departure shows the computed sequence flag before_departed (never stored)');
select is(pg_temp.tm_try(
  $$ insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', '"x"', to_jsonb(timestamptz '2026-01-01T00:00:00Z'), 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1');
     insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source, correction_id)
       select '00000000-0000-4000-8000-000000230b01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'arrived', '2026-01-01T00:00:00Z', 'correction', c.id from public.visit_corrections c where c.version_after = 2;
     insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b01', 'arrived', to_jsonb(timestamptz '2026-01-01T00:00:00Z'), to_jsonb(now() - interval '150 minutes'), 'סיבה', 2, 3, '00000000-0000-4000-8000-0000000000a1');
     insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, source, correction_id)
       select '00000000-0000-4000-8000-000000230b01', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'arrived', now() - interval '150 minutes', 'correction', c.id from public.visit_corrections c where c.version_after = 3 $$,
  $$ select c.sequence_flags::text || ' ' || (c.reported_at = now() - interval '150 minutes')
            || ' ' || (select count(*) from public.visit_time_reports t where t.visit_id = '00000000-0000-4000-8000-000000230b01' and t.kind = 'arrived')
     from public.visit_time_current c where c.visit_id = '00000000-0000-4000-8000-000000230b01' and c.kind = 'arrived' $$),
  '{} true 3',
  'the newest correction wins and clears the flag; the device report and the first correction stay stored (originals never overwritten)');

-- ---------------------------------------------------------------------------------------------
-- 8. Simulated go-live (rolled back): real rows and the one-way rule (D47). The pre-go-live
--    CHECKs are relaxed here only (PR 1.3 Q3 reading): a real call R with a real done visit by the
--    real Technician d9, and a test continuation reason.
-- ---------------------------------------------------------------------------------------------
alter table public.service_calls drop constraint service_calls_data_source_check;
alter table public.customers drop constraint customers_data_source_check;
alter table public.products drop constraint products_data_source_check;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'user-d9@example.test', now(), now());
insert into public.profiles (id, role, full_name, is_active, is_test)
  values ('00000000-0000-4000-8000-0000000000d9', 'technician', 'טכנאי אמיתי', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email)
  values ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000d9', false, 'טכנאי אמיתי', 't-g', 'tech-real@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref)
  values ('00000000-0000-4000-8000-000000230c09', 'R-2309', 'לקוח אמיתי', '050-000-2309', 'microsoft_graph', 'graph-230');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref)
  values ('00000000-0000-4000-8000-000000230d09', 'rp-2309', 'RP-2309', 'מוצר אמיתי', 'microsoft_graph', 'graph-230');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref, created_by)
values ('00000000-0000-4000-8000-000000230a09', 'REQ-230R', '00000000-0000-4000-8000-000000230c09',
        '00000000-0000-4000-8000-000000230d09', (select c.id from public.call_types c where c.sort_order = 1), 'לא מקרר',
        'נציג', 'awaiting_followup', 2, 'microsoft_graph', 'graph-evt-230', '00000000-0000-4000-8000-0000000000c1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, followup_reason_id, next_visit_notes, source_ref)
values ('00000000-0000-4000-8000-000000230b09', '00000000-0000-4000-8000-000000230a09', '00000000-0000-4000-8000-0000000000e9',
        1, 'KR1', now() - interval '2 hours', now() - interval '1 hour', 'followup', 'חיפה', 'הנמל 1',
        (select r.id from public.followup_reasons r where r.sort_order = 1), 'הערה', 'graph-evt-230');
insert into public.visit_reports (visit_id, summary_text, summary_source)
  values ('00000000-0000-4000-8000-000000230b09', 'נדרש חלק', 'written');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-000000230b09', 1, 'created', 'followup');
insert into public.followup_reasons (id, label_he, sort_order, is_user_added, is_test, created_by)
  values ('00000000-0000-4000-8000-000000230e99', 'סיבת בדיקה', 99, true, true, '00000000-0000-4000-8000-0000000000a1');
select lives_ok('set constraints all immediate', 'simulated go-live: the real call and its followup visit pass every deferred check');
set constraints all deferred;
select results_eq(
  $$ select x.label, pg_temp.tm_try(x.stmt, x.probe)
     from (values
       (1, 'a real item is real-marked (from its call)',
        $q$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('customer_change', 'pr16-g1', '00000000-0000-4000-8000-000000230a09', null, 'invitation', 'graph-evt-2', null, null, '{}', '{}')$q$,
        $q$select is_test::text from public.review_items where dedupe_key = 'pr16-g1'$q$),
       (2, 'a real item submitted by a test profile',
        $q$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-g2', '00000000-0000-4000-8000-000000230a09', '00000000-0000-4000-8000-000000230b09', 'device', null, '00000000-0000-4000-8000-0000000000d1', gen_random_uuid(), '{}', '{}')$q$,
        null),
       (3, 'a real item decided by a test profile',
        $q$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('customer_change', 'pr16-g3', '00000000-0000-4000-8000-000000230a09', null, 'invitation', 'graph-evt-3', null, null, '{}', '{}');
           update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000a1' where dedupe_key = 'pr16-g3'$q$,
        null),
       (4, 'a real item decided by the real Creator',
        $q$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('customer_change', 'pr16-g4', '00000000-0000-4000-8000-000000230a09', null, 'invitation', 'graph-evt-4', null, null, '{}', '{}');
           update public.review_items set status = 'resolved', resolution = 'keep_current', resolved_by = '00000000-0000-4000-8000-0000000000c1', updated_by = '00000000-0000-4000-8000-0000000000c1' where dedupe_key = 'pr16-g4'$q$,
        null),
       (5, 'a real correction recorded by a test profile',
        $q$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b09', 'next_visit_notes', '"הערה"', '"הערה חדשה"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000a1')$q$, null),
       (6, 'a real correction naming a test continuation reason',
        $q$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b09', 'followup_reason', null, '"00000000-0000-4000-8000-000000230e99"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000c1')$q$, null),
       (7, 'a real correction by the real Creator (positive control)',
        $q$insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by) values ('00000000-0000-4000-8000-000000230b09', 'next_visit_notes', '"הערה"', '"הערה חדשה"', 'סיבה', 1, 2, '00000000-0000-4000-8000-0000000000c1')$q$,
        $q$select is_test::text from public.visit_corrections$q$),
       (8, 'a real operation of a test profile',
        $q$insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
             device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version)
           values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000230b09', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1)$q$,
        null),
       (9, 'a real operation of the real Technician (positive control)',
        $q$insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
             device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version)
           values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-000000230b09', 'close', repeat('a', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1)$q$,
        $q$select is_test::text from public.offline_operations$q$),
       (10, 'a test item may name real profiles (the reverse direction is allowed)',
        $q$insert into public.review_items (review_type, dedupe_key, service_call_id, visit_id, source, source_ref, submitted_by_profile_id, operation_id, submitted_version, current_version) values ('edit_conflict', 'pr16-g10', '00000000-0000-4000-8000-000000230a01', '00000000-0000-4000-8000-000000230b01', 'device', null, '00000000-0000-4000-8000-0000000000d9', gen_random_uuid(), '{}', '{}')$q$, null)
     ) as x (n, label, stmt, probe) order by x.n $$,
  $$ values ('a real item is real-marked (from its call)', 'false'),
            ('a real item submitted by a test profile', '23514 review_items: a real record cannot reference a test profile (D47)'),
            ('a real item decided by a test profile', '23514 review_items: a real record cannot reference a test profile (D47)'),
            ('a real item decided by the real Creator', 'ok'),
            ('a real correction recorded by a test profile', '23514 visit_corrections: a real record cannot reference a test profile (D47)'),
            ('a real correction naming a test continuation reason', '23514 visit_corrections: a real record cannot reference test data (D47)'),
            ('a real correction by the real Creator (positive control)', 'false'),
            ('a real operation of a test profile', '23514 offline_operations: a real record cannot reference a test profile (D47)'),
            ('a real operation of the real Technician (positive control)', 'false'),
            ('a test item may name real profiles (the reverse direction is allowed)', 'ok') $$,
  'D47 one-way rule: a real review item, correction or offline operation never names a test profile or a test continuation reason; real rows are real-marked from their parent; a test row may name real records');

select * from finish();
rollback;
