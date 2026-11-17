-- PR 1.3: audit_logs is append-only with a hash chain (docs/database-schema.md §1, §4;
-- docs/security.md §8; docs/testing.md category 6), and the truncate triggers on every table.
-- The immutability boundary covers the app, the secret key and service_role; owner-level access is
-- outside it: a naive edit is detected by the chain, a rewrite that recomputes the chain or a
-- deletion of the newest rows only with an anchor recorded outside the database (review S3).
-- PR 1.4: the truncate triggers cover the seven new tables, and the Settings actions are audited
-- (TEMPORARY, owner question OQ-9) with target_is_test derived from the three new target tables.
-- PR 1.5: the truncate triggers cover the seven service-call and visit tables (append-only history
-- included). PostgreSQL refuses a TRUNCATE of a table that another table references (0A000) before
-- any BEFORE TRUNCATE trigger runs, so each statement below lists the referencing tables too, and
-- the table named first is the one whose trigger rejects it.
-- PR 1.6: the truncate triggers cover review_items, visit_corrections and offline_operations, which
-- reference service_calls, visits and each other, so the PR 1.5 statements list them too; the D14
-- correction and the review decision are audited (their exact rows: 240_integrity_writers).
-- PR 1.8: the request path is retired (D60 (7), C-02), so the Manager's audited action on an
-- account_requests row is now his direct Customer Service creation intent ('account_creation.authorized',
-- D60 (7)) instead of a reactivation request ('account_request.created'); the counts are unchanged.
-- The Manager's call type needs `callTypes` (on for Managers by default, D60 (8)); the PR 1.4
-- `settings` grant below no longer opens it. The deletion's audit row: 290_account_admin.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

-- Fixtures (local, rolled back): see 020_markers.test.sql.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a2', 'b1', 'b2', 'd1', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'מנהל ב', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test');

-- Several audited actions by different actors.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_role_permission('customer_service', 'export', true, 1, null);
select public.admin_update_profile('00000000-0000-4000-8000-0000000000a2', 1, 'מנהל ב', '03-000-0000', null);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.authorize_account_creation('customer_service', 'new-agent@example.test', 'נציגה חדשה');
select public.admin_update_technician('00000000-0000-4000-8000-0000000000e1', 1, 'טכנאי א', 't-y', 'tech-a2@example.test', null, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', false, 1, null);
reset role;
select set_config('request.jwt.claims', '', true);

-- Hash chain ---------------------------------------------------------------------------------------------
select is((select count(*) from public.audit_logs), 7::bigint, 'seven audit rows (the bootstrap and five actions, one of them writing two rows)');
select is((select prev_hash from public.audit_logs order by id limit 1), repeat('0', 64), 'the first row links to the zero hash');
select is(
  (select count(*) from (select a.prev_hash, lag(a.row_hash) over (order by a.id) as previous from public.audit_logs a) x
   where x.previous is not null and x.prev_hash <> x.previous),
  0::bigint, 'every row links to the previous row''s hash');
select is(private.audit_chain_verify(), null::bigint, 'the chain verifies');
select ok(
  (select bool_and(target_is_test) from public.audit_logs where target_table in ('technicians', 'account_requests'))
  and (select not target_is_test from public.audit_logs where action = 'creator.bootstrapped')
  and (select not target_is_test from public.audit_logs where target_table = 'role_permissions'),
  'target_is_test is derived from the target row (test targets true; the real Creator and the matrix false)');
select is((select actor_profile_id from public.audit_logs where action = 'creator.bootstrapped'), null::uuid,
  'the bootstrap row has no actor (owner''s database role)');

-- Append-only for every role ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ update public.audit_logs set details = '{}' $$, '42501', null, 'the Creator cannot update audit rows');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'the Creator cannot delete audit rows');
select throws_ok($$ truncate public.audit_logs $$, '42501', null, 'the Creator cannot truncate audit_logs');
select throws_ok(
  $$ insert into public.audit_logs (action, target_table, target_id, target_is_test, prev_hash, row_hash)
     values ('profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000a1', true, repeat('0', 64), repeat('1', 64)) $$,
  '42501', null, 'no direct inserts: audit rows are written only by private.write_audit');
select throws_ok($$ select private.write_audit('profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000a1', '{}') $$,
  '42501', null, 'authenticated cannot execute private.write_audit');
reset role;

select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok($$ update public.audit_logs set details = '{}' $$, '42501', null, 'service_role cannot update audit rows');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'service_role cannot delete audit rows');
select throws_ok($$ truncate public.audit_logs $$, '42501', null, 'service_role cannot truncate audit_logs');
reset role;

-- Even with privileges granted (simulating a mistaken grant, rolled back), the triggers reject.
grant select, update, delete, truncate on public.audit_logs to service_role;
set local role service_role;
select throws_ok($$ update public.audit_logs set details = '{}' $$, '55000', 'audit_logs is append-only',
  'service_role with UPDATE granted is still rejected by the trigger');
select throws_ok($$ delete from public.audit_logs $$, '55000', 'audit_logs is append-only',
  'service_role with DELETE granted is still rejected by the trigger');
select throws_ok($$ truncate public.audit_logs $$, '55000', 'audit_logs cannot be truncated',
  'service_role with TRUNCATE granted is still rejected by the statement trigger');
reset role;
revoke all on public.audit_logs from service_role;

select throws_ok($$ update public.audit_logs set details = '{}' $$, '55000', 'audit_logs is append-only',
  'postgres cannot update audit rows (trigger)');
select throws_ok($$ delete from public.audit_logs $$, '55000', 'audit_logs is append-only',
  'postgres cannot delete audit rows (trigger)');
select throws_ok($$ truncate public.audit_logs $$, '55000', 'audit_logs cannot be truncated',
  'postgres cannot truncate audit_logs (trigger)');

-- Truncate triggers on every PR 1.3 to PR 1.6 table -------------------------------------------------
select is(
  (select count(distinct c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and t.tgfoid = 'private.tg_reject_truncate()'::regprocedure
     and t.tgenabled = 'O' and (t.tgtype & 32) <> 0 and (t.tgtype & 2) <> 0),
  23::bigint, 'every PR 1.3, PR 1.4, PR 1.5 and PR 1.6 table (23) has an enabled BEFORE TRUNCATE statement trigger');
select throws_ok(
  $$ truncate public.audit_logs, public.account_requests, public.role_permissions, public.permissions,
       public.technicians, public.profiles, public.brands, public.suppliers, public.products, public.customers,
       public.call_types, public.followup_reasons, public.collection_locations, public.service_calls, public.visits,
       public.visit_reports, public.visit_signatures, public.visit_time_reports, public.visit_events,
       public.entity_changes, public.review_items, public.visit_corrections, public.offline_operations $$,
  '55000', 'audit_logs cannot be truncated', 'truncating all PR 1.3 to PR 1.6 tables together is rejected, even as postgres');
-- PR 1.5: each new table, as postgres (with the tables that reference it, see the header).
select throws_ok(
  $$ truncate public.service_calls, public.visits, public.visit_reports, public.visit_signatures,
       public.visit_time_reports, public.visit_events, public.review_items, public.visit_corrections,
       public.offline_operations $$,
  '55000', 'service_calls cannot be truncated', 'PR 1.5: service_calls cannot be truncated, even as postgres');
select throws_ok(
  $$ truncate public.visits, public.visit_reports, public.visit_signatures, public.visit_time_reports, public.visit_events,
       public.review_items, public.visit_corrections, public.offline_operations $$,
  '55000', 'visits cannot be truncated', 'PR 1.5: visits cannot be truncated, even as postgres');
select throws_ok($$ truncate public.visit_reports $$, '55000', 'visit_reports cannot be truncated',
  'PR 1.5: visit_reports cannot be truncated, even as postgres');
select throws_ok($$ truncate public.visit_signatures $$, '55000', 'visit_signatures cannot be truncated',
  'PR 1.5: visit_signatures cannot be truncated, even as postgres');
select throws_ok($$ truncate public.visit_time_reports $$, '55000', 'visit_time_reports cannot be truncated',
  'PR 1.5: visit_time_reports (append-only) cannot be truncated, even as postgres');
select throws_ok($$ truncate public.visit_events $$, '55000', 'visit_events cannot be truncated',
  'PR 1.5: visit_events (append-only) cannot be truncated, even as postgres');
select throws_ok($$ truncate public.entity_changes $$, '55000', 'entity_changes cannot be truncated',
  'PR 1.5: entity_changes (append-only) cannot be truncated, even as postgres');
-- PR 1.6: each new table, as postgres (with the tables that reference it).
select throws_ok($$ truncate public.review_items, public.visit_time_reports, public.offline_operations $$, '55000',
  'review_items cannot be truncated', 'PR 1.6: review_items cannot be truncated, even as postgres');
select throws_ok($$ truncate public.visit_corrections, public.visit_time_reports $$, '55000',
  'visit_corrections cannot be truncated', 'PR 1.6: visit_corrections (append-only) cannot be truncated, even as postgres');
select throws_ok($$ truncate public.offline_operations $$, '55000', 'offline_operations cannot be truncated',
  'PR 1.6: offline_operations (immutable) cannot be truncated, even as postgres');

-- Tamper evidence: owner-level access can change a row only with the trigger disabled (rolled back);
-- the chain shows it.
create temporary table original_row on commit drop as
  select id, details from public.audit_logs order by id offset 2 limit 1;
alter table public.audit_logs disable trigger t10_reject_update_delete;
update public.audit_logs set details = '{"tampered": true}'
where id = (select id from original_row);
select is(private.audit_chain_verify(), (select id from original_row),
  'audit_chain_verify reports the first tampered row');
update public.audit_logs a set details = o.details from original_row o where a.id = o.id;
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is(private.audit_chain_verify(), null::bigint, 'restoring the row makes the chain verify again');

-- Who reads the audit (Q8) ------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs), 7::bigint, 'the Creator reads every audit row');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select action from public.audit_logs order by id $$,
  $$ values ('account_creation.authorized'), ('technician.updated'), ('technician.outlook_email_changed'), ('profile.deactivated') $$,
  'Manager: his own actions and the Technician and Customer Service accounts (incl. another Manager''s deactivation of one)');
select is((select count(*) from public.audit_logs where target_table = 'role_permissions'), 0::bigint,
  'Manager: never matrix rows');
select is((select count(*) from public.audit_logs where target_id = '00000000-0000-4000-8000-0000000000a2'), 0::bigint,
  'Manager: never another Manager''s account');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs), 0::bigint, 'an inactive Customer Service user reads no audit rows');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs), 0::bigint, 'a Technician reads no audit rows');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs), 0::bigint, 'a user without a profile reads no audit rows');
reset role;

-- PR 1.4: Settings actions (TEMPORARY, OQ-9) --------------------------------------------------------------
-- The real Creator acts on test rows he creates and on the real D48 rows; a1 (test Manager) gets
-- `settings` from the Creator (PR 1.4) and adds a call type (PR 1.8: with `callTypes`, D60 (8)).
create temporary table pr14_ids (k text primary key, id uuid) on commit drop;
grant all on pr14_ids to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
insert into pr14_ids select 'call_type', id from public.add_call_type('בדיקת יומן');
select public.set_call_type_active((select id from public.call_types where sort_order = 1), false, 1);
select public.set_call_type_active((select id from public.call_types where sort_order = 1), true, 2);
insert into pr14_ids select 'reason', id from public.add_followup_reason('סיבת בדיקה');
select public.set_followup_reason_active((select id from public.followup_reasons where sort_order = 2), false, 1);
select public.set_followup_reason_active((select id from public.followup_reasons where sort_order = 2), true, 2);
select public.delete_followup_reason((select id from pr14_ids where k = 'reason'), 1);
insert into pr14_ids select 'place', id from public.add_collection_location('מחסן בדיקה', 'logistics_center', 'רחוב הבדיקה 1', null, null);
select public.set_collection_location_active((select id from pr14_ids where k = 'place'), false, 1);
select public.set_collection_location_active((select id from pr14_ids where k = 'place'), true, 2);
select public.delete_collection_location((select id from pr14_ids where k = 'place'), 3);
select public.admin_set_role_permission('manager', 'settings', true, 1, null);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into pr14_ids select 'manager_call_type', id from public.add_call_type('בדיקת מנהל');
reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select a.action, a.target_table, a.target_is_test, a.details, a.actor_profile_id
     from public.audit_logs a where a.target_table in ('call_types', 'followup_reasons', 'collection_locations')
     order by a.id $$,
  $$ values
     ('call_type.created', 'call_types', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('call_type.deactivated', 'call_types', false, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('call_type.activated', 'call_types', false, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('followup_reason.created', 'followup_reasons', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('followup_reason.deactivated', 'followup_reasons', false, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('followup_reason.activated', 'followup_reasons', false, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('followup_reason.deleted', 'followup_reasons', true, '{"label": "סיבת בדיקה"}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('collection_location.created', 'collection_locations', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('collection_location.deactivated', 'collection_locations', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('collection_location.activated', 'collection_locations', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('collection_location.deleted', 'collection_locations', true, '{"label": "מחסן בדיקה"}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid),
     ('call_type.created', 'call_types', true, '{}'::jsonb, '00000000-0000-4000-8000-0000000000a1'::uuid) $$,
  'PR 1.4: the eleven Settings actions are audited; target_is_test follows the target (D48 rows real, app-created rows test)');
select is(private.audit_chain_verify(), null::bigint, 'PR 1.4: the chain verifies after the Settings actions');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select throws_ok(
  $$ select private.write_audit('call_type.renamed', 'call_types', (select id from pr14_ids where k = 'call_type'), '{}') $$,
  '23514', 'new row for relation "audit_logs" violates check constraint "audit_logs_action_check"',
  'PR 1.4: an action outside the list is rejected (no rename, OQ-5)');
select throws_ok(
  $$ select private.write_audit('call_type.created', 'call_types', '00000000-0000-4000-8000-00000000ffff', '{}') $$,
  '23503', 'audit_logs: unknown audit target', 'PR 1.4: an unknown call type target is rejected');
select throws_ok(
  $$ select private.write_audit('call_type.created', 'customers', '00000000-0000-4000-8000-0000000000c1', '{}') $$,
  '23503', 'audit_logs: unknown audit target', 'PR 1.4: customers are not an audit target (nothing writes them in PR 1.4)');
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs where target_table in ('call_types', 'followup_reasons', 'collection_locations')),
  12::bigint, 'PR 1.4: the Creator reads every Settings audit row');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select a.action, a.target_id from public.audit_logs a
     where a.target_table in ('call_types', 'followup_reasons', 'collection_locations') order by a.id $$,
  $$ select 'call_type.created'::text, (select id from pr14_ids where k = 'manager_call_type') $$,
  'PR 1.4: a Manager reads only his own Settings actions (TEMPORARY, OQ-9; the policy is unchanged)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.audit_logs where target_table in ('call_types', 'followup_reasons', 'collection_locations')),
  0::bigint, 'PR 1.4: a Technician reads no Settings audit rows');
reset role;
select set_config('request.jwt.claims', '', true);

-- Chain integrity against the owner's database role (review S7 item 6) --------------------------------
select set_config('request.jwt.claims', '', true);
insert into public.audit_logs (actor_profile_id, action, target_table, target_id, target_is_test, occurred_at, prev_hash, row_hash, details)
values ('00000000-0000-4000-8000-0000000000c1', 'profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000c1', true,
        '2000-01-01T00:00:00Z', repeat('a', 64), repeat('b', 64), '{}');
select ok(
  (select occurred_at = now() and not target_is_test and prev_hash <> repeat('a', 64) and row_hash <> repeat('b', 64)
   from public.audit_logs order by id desc limit 1),
  'an insert with forged occurred_at, target_is_test, prev_hash and row_hash gets the server values');
select is(private.audit_chain_verify(), null::bigint, 'the chain still verifies after that insert');
select throws_ok(
  $$ insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
     overriding system value values (1, '00000000-0000-4000-8000-0000000000c1', 'profile.updated', 'profiles',
     '00000000-0000-4000-8000-0000000000c1', '{}') $$,
  '55000', 'audit_logs: ids must follow the chain', 'an id below the newest row is refused');
alter table public.audit_logs disable trigger t90_audit_chain;
select throws_ok(
  $$ insert into public.audit_logs (actor_profile_id, action, target_table, target_id, prev_hash, row_hash, details)
     values ('00000000-0000-4000-8000-0000000000c1', 'profile.updated', 'profiles', '00000000-0000-4000-8000-0000000000c1',
             (select prev_hash from public.audit_logs order by id desc limit 1), repeat('c', 64), '{}') $$,
  '23505', null, 'a fork (two rows after the same row) is refused by UNIQUE (prev_hash), even with the chain trigger off');
alter table public.audit_logs enable trigger t90_audit_chain;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select throws_ok(
  $$ select private.write_audit('matrix.value_set', 'role_permissions', '00000000-0000-4000-8000-0000000000c1', '{}') $$,
  '23514', 'new row for relation "audit_logs" violates check constraint "audit_logs_target_id_check"',
  'T5: a matrix row has no target id (its role and key are in details), even through write_audit as postgres');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select private.audit_chain_verify(1, null) $$, '22023', 'invalid input',
  'an anchor needs both its id and its row_hash');

-- Anchoring (review S3): record the newest row's id and row_hash outside the database.
create temporary table anchor_a on commit drop as
  select id, row_hash from public.audit_logs order by id desc limit 1;
select is(private.audit_chain_verify((select id from anchor_a), (select row_hash from anchor_a)), null::bigint,
  'the chain verifies against a current anchor');

-- A rewrite that recomputes every later hash is not visible to the chain alone (documented
-- limitation), but the anchor shows it.
alter table public.audit_logs disable trigger t10_reject_update_delete;
update public.audit_logs set details = '{"rewritten": true}'
where id = (select id from public.audit_logs order by id offset 2 limit 1);
do $$
declare
  v_row record;
  v_prev text := repeat('0', 64);
  v_hash text;
begin
  for v_row in select a.* from public.audit_logs a order by a.id loop
    v_hash := private.audit_row_hash(v_prev, v_row.id, v_row.occurred_at, v_row.actor_profile_id, v_row.action,
                                     v_row.target_table, v_row.target_id, v_row.target_is_test, v_row.details);
    update public.audit_logs set prev_hash = v_prev, row_hash = v_hash where id = v_row.id;
    v_prev := v_hash;
  end loop;
end
$$;
select is(private.audit_chain_verify(), null::bigint,
  'limitation: a rewrite that recomputes the whole chain verifies without an anchor');
select is(private.audit_chain_verify((select id from anchor_a), (select row_hash from anchor_a)), (select id from anchor_a),
  'with the anchor recorded earlier the rewrite is detected');

-- Deleting the newest rows: also visible only through an anchor.
create temporary table anchor_b on commit drop as
  select id, row_hash from public.audit_logs order by id desc limit 1;
delete from public.audit_logs where id = (select id from anchor_b);
select is(private.audit_chain_verify(), null::bigint, 'limitation: deleting the newest row verifies without an anchor');
select is(private.audit_chain_verify((select id from anchor_b), (select row_hash from anchor_b)), (select id from anchor_b),
  'with an anchor the deletion of the newest rows is detected');

-- Deleting a row in the middle breaks the link of the next row.
create temporary table deleted_middle on commit drop as
  select id, (select a2.id from public.audit_logs a2 where a2.id > a.id order by a2.id limit 1) as next_id
  from public.audit_logs a order by a.id offset 1 limit 1;
delete from public.audit_logs where id = (select id from deleted_middle);
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is(private.audit_chain_verify(), (select next_id from deleted_middle),
  'deleting a row in the middle is detected at the next row');

select * from finish();
rollback;
