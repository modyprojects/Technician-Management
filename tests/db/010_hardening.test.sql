-- PR 1.3: privilege hardening, checked from the system catalog (docs/ROADMAP.md "PR 1.3 mandatory
-- security requirement", docs/security.md §5, docs/database-schema.md §9, docs/testing.md
-- category 1). Catalog-wide, so these checks also guard every object that later migrations add.
-- PR 1.4 (Migration 2): the exact lists now include the seven reference, customer and product
-- tables, their ten policies and the eight Settings RPCs (wrappers and bodies); four checks were
-- added for the new trigger functions and the root-table triggers.
-- PR 1.5 (Migration 3): the exact lists now include the seven service-call and visit tables, the
-- view visit_time_current (the only view, SECURITY INVOKER; plan DEV-7), their ten policies and the
-- three narrow read functions (wrappers and bodies); four checks were added for the new trigger and
-- constraint-trigger functions, the call-status and history functions, the SECURITY DEFINER
-- classification and the new identity sequences.
-- PR 1.6 (Migration 4): the exact lists now include the three integrity and offline tables, their
-- four policies and the two writers (wrappers and bodies); three checks were added for the six new
-- trigger functions, the three internal helpers (no grant, no wrapper) and the SECURITY DEFINER
-- classification of the two writers.
-- PR 1.8 (Migration 5): the EXECUTE list gains the deletion writer (wrapper and body) and loses
-- the four retired request functions (D60 (7), C-02: no grant for any role); three checks were
-- added for the three new trigger functions, the retired request path and the SECURITY DEFINER
-- classification of the deletion writer.
-- Step 6 (Migration 6): the exact lists now include the three calendar ingestion tables, their
-- three Creator-only policies (OQ-1) and the ingestion writer (wrapper and body); nothing was
-- removed from any list.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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
  $$ values ('account_requests', 'SELECT'), ('audit_logs', 'SELECT'), ('brands', 'SELECT'), ('calendar_event_changes', 'SELECT'),
            ('calendar_ingestion_errors', 'SELECT'), ('call_types', 'SELECT'),
            ('collection_locations', 'SELECT'), ('customers', 'SELECT'), ('entity_changes', 'SELECT'), ('external_calendar_events', 'SELECT'),
            ('followup_reasons', 'SELECT'), ('offline_operations', 'SELECT'), ('permissions', 'SELECT'), ('products', 'SELECT'),
            ('profiles', 'SELECT'), ('review_items', 'SELECT'), ('role_permissions', 'SELECT'), ('service_calls', 'SELECT'),
            ('suppliers', 'SELECT'), ('technicians', 'SELECT'), ('visit_corrections', 'SELECT'),
            ('visit_events', 'SELECT'), ('visit_media', 'SELECT'), ('visit_reports', 'SELECT'), ('visit_signatures', 'SELECT'),
            ('visit_time_current', 'SELECT'), ('visit_time_reports', 'SELECT'), ('visits', 'SELECT') $$,
  'authenticated has exactly SELECT on the six PR 1.3 tables, the seven PR 1.4 tables, the seven PR 1.5 tables, the PR 1.5 view the three PR 1.6 tables, the three Step 6 tables and the Step 4 table (Migration 7), and nothing else'
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

select ok(
  not has_sequence_privilege('authenticated', 'public.visit_time_reports_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.visit_events_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.entity_changes_id_seq', 'usage')
  and not has_sequence_privilege('service_role', 'public.visit_time_reports_id_seq', 'usage')
  and not has_sequence_privilege('service_role', 'public.visit_events_id_seq', 'usage')
  and not has_sequence_privilege('service_role', 'public.entity_changes_id_seq', 'usage')
  and not has_sequence_privilege('anon', 'public.entity_changes_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.entity_changes_id_seq', 'update'),
  'PR 1.5: no API role can use or advance the identity sequences of visit_time_reports, visit_events and entity_changes'
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
     ('add_visit_media(uuid,uuid,text,text,text,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('admin_create_profile(uuid,text,text,text,text,uuid)'),
     ('admin_create_technician(uuid,text,text,text,text,boolean)'),
     ('admin_delete_user(uuid,integer,text)'),
     ('admin_set_role_permission(text,text,boolean,integer,text)'),
     ('admin_set_user_active(uuid,boolean,integer,text)'),
     ('admin_set_user_role(uuid,text,integer,text)'),
     ('admin_update_profile(uuid,integer,text,text,text)'),
     ('admin_update_technician(uuid,integer,text,text,text,text,boolean)'),
     ('arrive_visit(uuid,uuid,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('assert_can_change_credentials(uuid,text)'),
     ('assert_can_manage(text)'),
     ('authorize_account_creation(text,text,text)'),
     ('cancel_account_request(uuid,integer)'),
     ('close_visit(uuid,uuid,integer,text,text,text,text,uuid,uuid,text,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('confirm_visit_media(uuid)'),
     ('correct_visit(uuid,text,text,text,integer)'),
     ('delete_collection_location(uuid,integer)'),
     ('delete_followup_reason(uuid,integer)'),
     ('depart_visit(uuid,uuid,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('has_permission(text)'),
     ('ingest_calendar_event(jsonb)'),
     ('is_creator()'),
     ('my_technician_id()'),
     ('my_visit_details(uuid)'),
     ('previous_visits(uuid)'),
     ('private.add_call_type(text)'),
     ('private.add_collection_location(text,text,text,text,text)'),
     ('private.add_followup_reason(text)'),
     ('private.add_visit_media(uuid,uuid,text,text,text,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('private.admin_create_profile(uuid,text,text,text,text,uuid)'),
     ('private.admin_create_technician(uuid,text,text,text,text,boolean)'),
     ('private.admin_delete_user(uuid,integer,text)'),
     ('private.admin_set_role_permission(text,text,boolean,integer,text)'),
     ('private.admin_set_user_active(uuid,boolean,integer,text)'),
     ('private.admin_set_user_role(uuid,text,integer,text)'),
     ('private.admin_update_profile(uuid,integer,text,text,text)'),
     ('private.admin_update_technician(uuid,integer,text,text,text,text,boolean)'),
     ('private.arrive_visit(uuid,uuid,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('private.assert_can_change_credentials(uuid,text)'),
     ('private.assert_can_manage(text)'),
     ('private.authorize_account_creation(text,text,text)'),
     ('private.cancel_account_request(uuid,integer)'),
     ('private.close_visit(uuid,uuid,integer,text,text,text,text,uuid,uuid,text,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('private.confirm_visit_media(uuid)'),
     ('private.correct_visit(uuid,text,text,text,integer)'),
     ('private.delete_collection_location(uuid,integer)'),
     ('private.delete_followup_reason(uuid,integer)'),
     ('private.depart_visit(uuid,uuid,integer,timestamp with time zone,text,integer,timestamp with time zone)'),
     ('private.has_permission(text)'),
     ('private.has_role(text)'),
     ('private.ingest_calendar_event(jsonb)'),
     ('private.is_active_user()'),
     ('private.is_creator()'),
     ('private.is_office_user()'),
     ('private.my_technician_id()'),
     ('private.my_visit_details(uuid)'),
     ('private.previous_visits(uuid)'),
     ('private.resolve_review_item(uuid,integer,text,jsonb,text)'),
     ('private.set_call_type_active(uuid,boolean,integer)'),
     ('private.set_collection_location_active(uuid,boolean,integer)'),
     ('private.set_followup_reason_active(uuid,boolean,integer)'),
     ('private.visit_media_object_readable(text)'),
     ('private.visit_media_object_writable(text)'),
     ('private.visit_rep_contact(uuid)'),
     ('resolve_review_item(uuid,integer,text,jsonb,text)'),
     ('set_call_type_active(uuid,boolean,integer)'),
     ('set_collection_location_active(uuid,boolean,integer)'),
     ('set_followup_reason_active(uuid,boolean,integer)'),
     ('test_data_census()'),
     ('visit_rep_contact(uuid)') $$,
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

-- PR 1.5: the ten trigger functions and the four constraint-trigger functions have no grant either
-- (a trigger function cannot be called directly; the grant would only widen what the catalog shows).
select ok(
  not has_function_privilege('authenticated', 'private.tg_visit_marker()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_child_marker()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_history_server_time()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_entity_change_target()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_one_way_call_refs()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_one_way_visit_refs()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_number_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_service_call_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_state_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_time_report_derive()', 'execute')
  and not has_function_privilege('authenticated', 'private.ct_visit_rules()', 'execute')
  and not has_function_privilege('authenticated', 'private.ct_service_call_rules()', 'execute')
  and not has_function_privilege('authenticated', 'private.ct_signature_rules()', 'execute')
  and not has_function_privilege('authenticated', 'private.ct_report_rules()', 'execute'),
  'PR 1.5: the ten trigger functions and the four constraint-trigger functions are not executable by authenticated'
);

-- PR 1.5: the call-status functions, the field-history writer and the visit-read helper have no
-- grant and no public wrapper (plan section 6.4, DEV-16; mutant M30).
select ok(
  not has_function_privilege('authenticated', 'private.compute_call_status(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.recalc_call_status(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.can_read_visit(uuid)', 'execute')
  and to_regprocedure('public.compute_call_status(uuid)') is null and to_regprocedure('public.recalc_call_status(uuid)') is null
  and to_regprocedure('public.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)') is null
  and to_regprocedure('public.can_read_visit(uuid)') is null,
  'PR 1.5: compute_call_status, recalc_call_status, write_entity_change and can_read_visit are not executable by authenticated and have no public wrapper'
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

-- PR 1.5: SECURITY DEFINER only where a body must see rows the caller cannot (the four deferred
-- checks, the visit-read helper, the three narrow read bodies); the writers and the trigger
-- functions run as the caller (their callers are postgres-owned definer bodies). The narrow
-- functions and their wrappers are STABLE (plan V17).
select results_eq(
  $$ select n.nspname::text collate "default", p.proname::text collate "default", p.prosecdef, p.provolatile::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname in ('tg_visit_marker', 'tg_visit_child_marker', 'tg_history_server_time', 'tg_entity_change_target',
                         'tg_one_way_call_refs', 'tg_one_way_visit_refs', 'tg_visit_number_guard', 'tg_service_call_guard',
                         'tg_visit_state_guard', 'tg_time_report_derive', 'ct_visit_rules', 'ct_service_call_rules',
                         'ct_signature_rules', 'ct_report_rules', 'compute_call_status', 'recalc_call_status',
                         'write_entity_change', 'can_read_visit', 'previous_visits', 'visit_rep_contact', 'my_visit_details')
     order by n.nspname::text collate "C", p.proname::text collate "C" $$,
  $$ values ('private', 'can_read_visit', true, 's'), ('private', 'compute_call_status', false, 's'),
            ('private', 'ct_report_rules', true, 'v'), ('private', 'ct_service_call_rules', true, 'v'),
            ('private', 'ct_signature_rules', true, 'v'), ('private', 'ct_visit_rules', true, 'v'),
            ('private', 'my_visit_details', true, 's'), ('private', 'previous_visits', true, 's'),
            ('private', 'recalc_call_status', false, 'v'), ('private', 'tg_entity_change_target', false, 'v'),
            ('private', 'tg_history_server_time', false, 'v'), ('private', 'tg_one_way_call_refs', false, 'v'),
            ('private', 'tg_one_way_visit_refs', false, 'v'), ('private', 'tg_service_call_guard', false, 'v'),
            ('private', 'tg_time_report_derive', false, 'v'), ('private', 'tg_visit_child_marker', false, 'v'),
            ('private', 'tg_visit_marker', false, 'v'), ('private', 'tg_visit_number_guard', false, 'v'),
            ('private', 'tg_visit_state_guard', false, 'v'), ('private', 'visit_rep_contact', true, 's'),
            ('private', 'write_entity_change', false, 'v'),
            ('public', 'my_visit_details', false, 's'), ('public', 'previous_visits', false, 's'),
            ('public', 'visit_rep_contact', false, 's') $$,
  'PR 1.5: eight SECURITY DEFINER bodies in private (four deferred checks, can_read_visit, three narrow reads); everything else SECURITY INVOKER; the reads are STABLE'
);

-- PR 1.6: the six new trigger functions and the three internal helpers have no grant, and the
-- helpers have no public wrapper (their callers are the postgres-owned writers of Step 4 and
-- Step 6; migration guard rule 4).
select ok(
  not has_function_privilege('authenticated', 'private.tg_call_child_marker()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_review_item_state()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_correction_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_offline_operation_derive()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_field_version()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_visit_closed_fields()', 'execute'),
  'PR 1.6: the six new trigger functions are not executable by authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.offline_operation_replay(uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated',
        'private.record_offline_operation(uuid,uuid,text,text,integer,timestamptz,text,integer,text,integer,uuid)', 'execute')
  and to_regprocedure('public.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb)') is null
  and to_regprocedure('public.offline_operation_replay(uuid,uuid,text,text)') is null
  and to_regprocedure('public.record_offline_operation(uuid,uuid,text,text,integer,timestamptz,text,integer,text,integer,uuid)') is null,
  'PR 1.6: create_review_item, offline_operation_replay and record_offline_operation are not executable by authenticated and have no public wrapper'
);
-- PR 1.6: the two writers are SECURITY DEFINER bodies in private behind SECURITY INVOKER wrappers;
-- the helpers and the new trigger functions run as the caller (postgres-owned definer bodies).
select results_eq(
  $$ select n.nspname::text collate "default", p.proname::text collate "default", p.prosecdef, p.provolatile::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname in ('correct_visit', 'resolve_review_item', 'create_review_item', 'offline_operation_replay',
                         'record_offline_operation', 'tg_call_child_marker', 'tg_review_item_state',
                         'tg_visit_correction_guard', 'tg_offline_operation_derive', 'tg_visit_field_version',
                         'tg_visit_closed_fields')
     order by n.nspname::text collate "C", p.proname::text collate "C" $$,
  $$ values ('private', 'correct_visit', true, 'v'), ('private', 'create_review_item', false, 'v'),
            ('private', 'offline_operation_replay', false, 'v'), ('private', 'record_offline_operation', false, 'v'),
            ('private', 'resolve_review_item', true, 'v'), ('private', 'tg_call_child_marker', false, 'v'),
            ('private', 'tg_offline_operation_derive', false, 'v'), ('private', 'tg_review_item_state', false, 'v'),
            ('private', 'tg_visit_closed_fields', false, 'v'), ('private', 'tg_visit_correction_guard', false, 'v'),
            ('private', 'tg_visit_field_version', false, 'v'),
            ('public', 'correct_visit', false, 'v'), ('public', 'resolve_review_item', false, 'v') $$,
  'PR 1.6: two SECURITY DEFINER writer bodies in private (correct_visit, resolve_review_item) and their SECURITY INVOKER wrappers; the helpers and trigger functions are SECURITY INVOKER; all VOLATILE'
);

-- PR 1.8: the three new trigger functions have no grant; the retired request path (D60 (7), C-02)
-- is executable by no API role, Creator included (the bodies stay for the rollback); the deletion
-- writer is a SECURITY DEFINER body in private behind a SECURITY INVOKER wrapper.
select ok(
  not has_function_privilege('authenticated', 'private.tg_profile_deleted_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_technician_deleted_guard()', 'execute')
  and not has_function_privilege('authenticated', 'private.tg_account_requests_retired()', 'execute'),
  'PR 1.8: the three new trigger functions are not executable by authenticated'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated', 'service_role']) r (rolname)
   where n.nspname in ('public', 'private') and p.proname in ('request_account_change', 'decide_account_request')
     and has_function_privilege(r.rolname, p.oid, 'execute'))
  + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname in ('public', 'private') and p.proname in ('request_account_change', 'decide_account_request')
       and a.grantee <> p.proowner),
  0::bigint,
  'PR 1.8 (C-02): the four request and decision functions are executable by no role but their owner'
);
select results_eq(
  $$ select n.nspname::text collate "default", p.proname::text collate "default", p.prosecdef, p.provolatile::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.proname in ('admin_delete_user', 'tg_profile_deleted_guard', 'tg_technician_deleted_guard',
                         'tg_account_requests_retired')
     order by n.nspname::text collate "C", p.proname::text collate "C" $$,
  $$ values ('private', 'admin_delete_user', true, 'v'), ('private', 'tg_account_requests_retired', false, 'v'),
            ('private', 'tg_profile_deleted_guard', false, 'v'), ('private', 'tg_technician_deleted_guard', false, 'v'),
            ('public', 'admin_delete_user', false, 'v') $$,
  'PR 1.8: the deletion writer is a SECURITY DEFINER body in private behind a SECURITY INVOKER wrapper; the trigger functions are SECURITY INVOKER; all VOLATILE'
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
  $$ values ('account_requests', 2::bigint), ('audit_logs', 2::bigint), ('brands', 1::bigint),
            ('calendar_event_changes', 1::bigint), ('calendar_ingestion_errors', 1::bigint), ('call_types', 2::bigint),
            ('collection_locations', 2::bigint), ('customers', 1::bigint), ('entity_changes', 1::bigint),
            ('external_calendar_events', 1::bigint),
            ('followup_reasons', 2::bigint), ('offline_operations', 2::bigint), ('permissions', 1::bigint),
            ('products', 1::bigint), ('profiles', 3::bigint), ('review_items', 1::bigint),
            ('role_permissions', 2::bigint), ('service_calls', 1::bigint), ('suppliers', 1::bigint), ('technicians', 2::bigint),
            ('visit_corrections', 1::bigint), ('visit_events', 1::bigint), ('visit_media', 2::bigint), ('visit_reports', 2::bigint),
            ('visit_signatures', 2::bigint), ('visit_time_reports', 1::bigint), ('visits', 2::bigint) $$,
  'every PR 1.3 to PR 1.6 table has its read policies (PR 1.4: ten; PR 1.5: ten, none for Technicians on service_calls; PR 1.6: four, none for Technicians on review_items and visit_corrections; Step 6: three, Creator only; Step 4: two on visit_media)'
);

-- PR 1.4, generated columns (plan V1): on products and customers is_test is a stored generated
-- column, which BEFORE triggers read as NULL. The one-way checks therefore run AFTER the row is
-- formed, and no BEFORE trigger there reads the marker. PR 1.5: the same for service_calls (its
-- AFTER triggers are the two one-way checks and the deferred c20 check).
select results_eq(
  $$ select c.relname::text collate "default", t.tgname::text collate "default", t.tgfoid::regprocedure::text collate "default"
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname in ('products', 'customers', 'service_calls') and c.relnamespace = 'public'::regnamespace
       and not t.tgisinternal and (t.tgtype & 2) = 0 and t.tgenabled = 'O'
     order by 1, 2 $$,
  $$ values ('customers', 'a30_one_way', 'private.tg_one_way_people()'),
            ('products', 'a30_one_way', 'private.tg_one_way_people()'),
            ('products', 'a31_one_way_refs', 'private.tg_one_way_product_refs()'),
            ('service_calls', 'a30_one_way', 'private.tg_one_way_people()'),
            ('service_calls', 'a31_one_way_refs', 'private.tg_one_way_call_refs()'),
            ('service_calls', 'c20_call_rules', 'private.ct_service_call_rules()') $$,
  'PR 1.4 and PR 1.5: the one-way triggers on products, customers and service_calls are enabled AFTER row triggers'
);
select is(
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname in ('products', 'customers', 'service_calls') and c.relnamespace = 'public'::regnamespace
     and not t.tgisinternal and (t.tgtype & 2) <> 0
     and t.tgfoid in ('private.tg_one_way_people()'::regprocedure, 'private.tg_immutable_markers()'::regprocedure,
                      'private.tg_one_way_call_refs()'::regprocedure)),
  0::bigint,
  'PR 1.4 and PR 1.5: no BEFORE trigger on products, customers or service_calls runs a one-way or marker function (they would read is_test as NULL)'
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

-- PR 1.5 (DEV-7): database-schema.md §9 forbids views that bypass authorization. The only view is
-- visit_time_current, which runs with the caller's rights (security_invoker), so the policies of
-- visit_time_reports apply to whoever reads it. No other view and no materialized view.
select results_eq(
  $$ select n.nspname::text collate "default", c.relname::text collate "default", c.relkind::text,
            coalesce(c.reloptions, '{}')::text collate "default"
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')
     order by 1, 2 $$,
  $$ values ('public', 'visit_time_current', 'v', '{security_invoker=true}') $$,
  'the only view in public or private is visit_time_current, with security_invoker (no view can bypass authorization)'
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
