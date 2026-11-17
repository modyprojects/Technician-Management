-- PR 1.8: the schema of Migration 5 (accounts and permissions; D60 (7) to (9), C-01, C-02, M-06,
-- M-07, M-10; docs/review/step1-pr18/README.md). Runs as postgres, so it also proves that the
-- CHECKs and triggers hold for the owner's role where the design says "every writer":
--   - profiles.deleted_at and deleted_by (Option A): types, no default, the three CHECKs and the
--     foreign key; the deletion takes the server time; a deleted account never changes again
--     (t12_deleted_guard; TEMPORARY OQ-2), its field profile neither (t11_deleted_profile), and
--     deleted_by follows the D47 one-way rule (t31_one_way_deleted); rows are still never deleted;
--   - the trigger order on profiles, technicians and account_requests;
--   - the audit action CHECK (30 earlier actions and profile.deleted) and the unchanged audit
--     anchor (no audit function changed);
--   - the narrow keys' enforcement CHECK, their six TEMPORARY values and the comment on the
--     usage lock;
--   - the replaced functions keep their ACLs, owner and options; the five Settings bodies check the
--     narrow keys and no longer `settings`;
--   - the table and function comments.
-- Who may call what: 290_account_admin, 300_narrow_keys; the retired request path: 050.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Fixtures (local, rolled back): see 020_markers.test.sql. b9 is a real-marked Customer Service
-- account; d2 a Technician without a field profile.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'b1', 'b2', 'b9', 'd1', 'd2']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה ב', false),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ללא כרטיס', true);
insert into public.profiles (id, role, full_name, is_active, is_test) values
  ('00000000-0000-4000-8000-0000000000b9', 'customer_service', 'נציגה אמיתית', true, false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test');

-- Columns, constraints, triggers --------------------------------------------------------------------
select results_eq(
  $$ select a.attname::text collate "default", format_type(a.atttypid, a.atttypmod) collate "default", a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) collate "default"
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.profiles'::regclass and a.attname in ('deleted_at', 'deleted_by') and not a.attisdropped
     order by a.attname::text collate "C" $$,
  $$ values ('deleted_at', 'timestamp with time zone', false, null::text), ('deleted_by', 'uuid', false, null::text) $$,
  'profiles.deleted_at (timestamptz) and deleted_by (uuid): nullable, no default (no existing row changes)');
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid) collate "default" from pg_constraint k
     where k.conrelid = 'public.profiles'::regclass and k.conname like 'profiles_deleted%'
     order by k.conname::text collate "C" $$,
  $$ values ('profiles_deleted_by_fkey', 'FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE RESTRICT'),
            ('profiles_deleted_check', 'CHECK (((deleted_at IS NULL) = (deleted_by IS NULL)))'),
            ('profiles_deleted_inactive_check', 'CHECK (((deleted_at IS NULL) OR (NOT is_active)))'),
            ('profiles_deleted_self_check', 'CHECK ((deleted_by IS DISTINCT FROM id))') $$,
  'the deletion constraints: set together, only on an inactive row, never by the account itself, deleted_by a profile (ON DELETE RESTRICT)');
select results_eq(
  $$ select c.relname::text collate "default", t.tgname::text collate "default", t.tgfoid::regprocedure::text collate "default",
            encode(t.tgargs, 'escape') collate "default", (t.tgtype & 2) <> 0, (t.tgtype & 4) <> 0, (t.tgtype & 16) <> 0
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and c.relname in ('profiles', 'technicians', 'account_requests')
       and not t.tgisinternal and t.tgenabled = 'O' and (t.tgtype & 2) <> 0 and (t.tgtype & 1) = 1 and (t.tgtype & 20) <> 0
     order by c.relname::text collate "C", t.tgname::text collate "C" $$,
  $$ values
     ('account_requests', 't05_requests_retired', 'private.tg_account_requests_retired()', '', true, true, false),
     ('account_requests', 't10_account_request_guard', 'private.tg_account_request_guard()', '', true, false, true),
     ('account_requests', 't20_immutable_markers', 'private.tg_immutable_markers()', '', true, false, true),
     ('account_requests', 't30_one_way', 'private.tg_one_way_people()', 'requested_by\000decided_by\000', true, true, true),
     ('account_requests', 't90_bump_version', 'private.tg_bump_version()', '', true, false, true),
     ('profiles', 't10_profile_guard', 'private.tg_profile_guard()', '', true, false, true),
     ('profiles', 't12_deleted_guard', 'private.tg_profile_deleted_guard()', '', true, false, true),
     ('profiles', 't20_immutable_markers', 'private.tg_immutable_markers()', '', true, false, true),
     ('profiles', 't30_one_way', 'private.tg_one_way_people()', 'created_by\000updated_by\000', true, true, true),
     ('profiles', 't31_one_way_deleted', 'private.tg_one_way_people()', 'deleted_by\000', true, true, true),
     ('profiles', 't90_bump_version', 'private.tg_bump_version()', '', true, false, true),
     ('technicians', 't10_technician_guard', 'private.tg_technician_guard()', '', true, true, true),
     ('technicians', 't11_deleted_profile', 'private.tg_technician_deleted_guard()', '', true, true, true),
     ('technicians', 't20_immutable_markers', 'private.tg_immutable_markers()', '', true, false, true),
     ('technicians', 't30_one_way', 'private.tg_one_way_people()', 'created_by\000updated_by\000', true, true, true),
     ('technicians', 't90_bump_version', 'private.tg_bump_version()', '', true, false, true) $$,
  'the BEFORE row triggers on insert or update, in firing order (name, function, arguments, insert, update): the four PR 1.8 triggers sit beside the PR 1.3 ones');

-- Deletion as the owner's role: the CHECKs, the server time and the foreign key ----------------------
select throws_ok(
  $$ update public.profiles set is_active = false, deleted_at = now() where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '23514', null, 'deleted_at needs deleted_by (CHECK profiles_deleted_check), even as postgres');
select throws_ok(
  $$ update public.profiles set deleted_at = now(), deleted_by = '00000000-0000-4000-8000-0000000000c1'
     where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_deleted_inactive_check"',
  'a deleted account is never active (the reactivation guard for every writer), even as postgres');
select throws_ok(
  $$ update public.profiles set is_active = false, deleted_at = now(), deleted_by = id where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_deleted_self_check"',
  'an account is never marked deleted by itself');
select throws_ok(
  $$ update public.profiles set deleted_at = now(), deleted_by = '00000000-0000-4000-8000-00000000ffff'
     where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '23503', null, 'deleted_by must name a profile (foreign key)');
select throws_ok(
  $$ update public.profiles set is_active = false, deleted_at = now(), deleted_by = '00000000-0000-4000-8000-0000000000a1'
     where id = '00000000-0000-4000-8000-0000000000b9' $$,
  '23514', 'profiles: a real record cannot reference a test profile (D47)',
  'D47 one-way rule (t31): a real account is never marked deleted by a test profile');
update public.profiles set deleted_at = '2001-01-01 00:00:00+00', deleted_by = '00000000-0000-4000-8000-0000000000c1'
where id = '00000000-0000-4000-8000-0000000000b2';
select ok(
  (select deleted_at = now() and deleted_by = '00000000-0000-4000-8000-0000000000c1' and not is_active and version = 2
   from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'),
  'a deletion takes the server time (D45), whatever the writer sent; the version is raised');

-- A deleted account never changes again (OQ-2), for every writer -------------------------------------
select throws_ok(
  $$ update public.profiles set is_active = true where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'no reactivation, even as postgres');
select throws_ok(
  $$ update public.profiles set is_active = true, deleted_at = null, deleted_by = null where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'no undelete, even as postgres');
select throws_ok(
  $$ update public.profiles set full_name = 'שם אחר' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'no rename (the attribution keeps the name)');
select throws_ok(
  $$ update public.profiles set role = 'technician' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'no role change');
select throws_ok(
  $$ update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'the deletion time is never rewritten');
select throws_ok(
  $$ update public.profiles set full_name = full_name where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: a deleted account never changes (D60 (7))', 'not even an update that changes nothing');
select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '55000', 'profiles: rows are never deleted', 'a deleted account''s row is never removed (Option A: no physical deletion)');

-- The field profile of a deleted Technician (OQ-2) ----------------------------------------------------
update public.profiles set is_active = false, deleted_at = now(), deleted_by = '00000000-0000-4000-8000-0000000000c1'
where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2');
select throws_ok(
  $$ update public.technicians set color = 't-s' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '55000', 'technicians: the account is deleted (D60 (7))', 'a deleted Technician''s field profile never changes, even as postgres');
select throws_ok(
  $$ update public.technicians set accepts_invitations = false where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '55000', 'technicians: the account is deleted (D60 (7))', 'also not its "פעיל" flag');
select throws_ok(
  $$ insert into public.technicians (profile_id, is_test, display_name, color, outlook_email)
     values ('00000000-0000-4000-8000-0000000000d2', true, 'x', 't-s', 'tech-x@example.test') $$,
  '55000', 'technicians: the account is deleted (D60 (7))', 'a deleted Technician never gets a field profile');
select ok(
  (select display_name = 'טכנאי א' and color = 't-y' and outlook_email = 'tech-a@example.test' and version = 1
   from public.technicians where id = '00000000-0000-4000-8000-0000000000e1'),
  'the field profile keeps its values (the attribution of history)');

-- account_requests: only creation intents are new rows (the request types: 050) -------------------------
select lives_ok(
  $$ insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by, decided_at, is_test)
     values ('direct_create', 'customer_service', 'intent@example.test', 'x', '00000000-0000-4000-8000-0000000000a1', 'approved',
             '00000000-0000-4000-8000-0000000000a1', now(), true) $$,
  'a creation intent (direct_create) still passes t05_requests_retired');

-- Audit: the action CHECK and the unchanged anchor ------------------------------------------------------
select is(
  (select pg_get_constraintdef(k.oid) from pg_constraint k
   where k.conrelid = 'public.audit_logs'::regclass and k.conname = 'audit_logs_action_check'),
  'CHECK ((action = ANY (ARRAY[''matrix.value_set''::text, ''matrix.value_approved''::text, ''account_request.created''::text, ''account_request.approved''::text, ''account_request.rejected''::text, ''account_request.cancelled''::text, ''account_creation.authorized''::text, ''profile.created''::text, ''profile.role_changed''::text, ''profile.activated''::text, ''profile.deactivated''::text, ''profile.updated''::text, ''technician.created''::text, ''technician.updated''::text, ''technician.outlook_email_changed''::text, ''credentials.change_authorized''::text, ''creator.bootstrapped''::text, ''call_type.created''::text, ''call_type.activated''::text, ''call_type.deactivated''::text, ''followup_reason.created''::text, ''followup_reason.activated''::text, ''followup_reason.deactivated''::text, ''followup_reason.deleted''::text, ''collection_location.created''::text, ''collection_location.activated''::text, ''collection_location.deactivated''::text, ''collection_location.deleted''::text, ''visit.corrected''::text, ''review_item.resolved''::text, ''profile.deleted''::text])))',
  'the audit action CHECK keeps the 30 actions of Migrations 1 to 4 (the request actions too) and adds profile.deleted');
select is(
  (select pg_get_constraintdef(k.oid) from pg_constraint k
   where k.conrelid = 'public.audit_logs'::regclass and k.conname = 'audit_logs_target_table_check'),
  'CHECK ((target_table = ANY (ARRAY[''profiles''::text, ''technicians''::text, ''account_requests''::text, ''role_permissions''::text, ''call_types''::text, ''followup_reasons''::text, ''collection_locations''::text, ''visits''::text, ''review_items''::text])))',
  'the audit target tables are unchanged (a deletion targets profiles)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select throws_ok(
  $$ select private.write_audit('profile.purged', 'profiles', '00000000-0000-4000-8000-0000000000b1', '{}') $$,
  '23514', 'new row for relation "audit_logs" violates check constraint "audit_logs_action_check"',
  'an action outside the list is still refused (there is no purge)');
select lives_ok(
  $$ select private.write_audit('profile.deleted', 'profiles', '00000000-0000-4000-8000-0000000000b2', '{"role": "customer_service"}') $$,
  'profile.deleted is accepted, target_is_test derived from the profile');
select set_config('request.jwt.claims', '', true);
select is(private.audit_chain_verify(), null::bigint, 'the audit chain verifies');
select results_eq(
  $$ select (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
             from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private'
               and p.proname = any (array['audit_row_hash', 'audit_chain_verify', 'write_audit', 'tg_audit_target',
                                          'tg_audit_chain', 'tg_reject_update_delete', 'tg_reject_truncate',
                                          'tg_one_way_people']::name[])) collate "default",
            (select md5(p.prosrc) from pg_proc p where p.oid = 'private.tg_audit_target()'::regprocedure) collate "default" $$,
  $$ values ('9c962b84a36e6218412e234d9042eb44'::text, '175c9ba2bc2afd655f122bbb288b0605'::text) $$,
  'no audit function changed: the anchor''s functions_md5 and tg_audit_target are the Migrations 1-4 values (docs/review/step1-pr16 section 9)');

-- The matrix ------------------------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(k.oid) from pg_constraint k
   where k.conrelid = 'public.permissions'::regclass and k.conname = 'permissions_enforcement_by_key'),
  'CHECK (((enforcement = ''data''::text) = (key = ANY (ARRAY[''calls''::text, ''card''::text, ''settings''::text, ''products''::text, ''conflicts''::text, ''cancel''::text, ''recordings''::text, ''reasons''::text, ''callTypes''::text, ''ackText''::text]))))',
  'the three narrow keys are data keys (enforced on the data, D33)');
select throws_ok(
  $$ insert into public.permissions (key, label_he, enforcement, sort_order) values ('ackText', 'x', 'screen', 99) $$,
  '23514', 'new row for relation "permissions" violates check constraint "permissions_enforcement_by_key"',
  'a narrow key can never be a screen key');
select results_eq(
  $$ select rp.role, rp.permission_key, rp.allowed, rp.value_status, rp.version, rp.updated_by is null and rp.approved_by is null
     from public.role_permissions rp join public.permissions k on k.key = rp.permission_key
     where k.sort_order >= 14 order by rp.role, k.sort_order $$,
  $$ values ('customer_service', 'reasons', false, 'temporary', 1, true), ('customer_service', 'callTypes', false, 'temporary', 1, true),
            ('customer_service', 'ackText', false, 'temporary', 1, true), ('manager', 'reasons', true, 'temporary', 1, true),
            ('manager', 'callTypes', true, 'temporary', 1, true), ('manager', 'ackText', true, 'temporary', 1, true) $$,
  'the six narrow-key values: TEMPORARY (D51), unchanged and unapproved; Manager on, Customer Service off (D60 (8))');
select throws_ok(
  $$ update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'usage' $$,
  '23514', 'new row for relation "role_permissions" violates check constraint "role_permissions_pending_decisions"',
  'usage stays off for Customer Service too, even as postgres (D60 (9))');
select is(
  (select obj_description(k.oid, 'pg_constraint') from pg_constraint k
   where k.conrelid = 'public.role_permissions'::regclass and k.conname = 'role_permissions_pending_decisions'),
  'Customer Service cancel stays off until open decision 5 (d08). usage is off for both matrix roles for good: a Creator-only fixed capability since D60 (9).',
  'the lock''s comment says that usage is now off for good (DEV-5)');

-- The replaced functions keep their ACLs, owner and options; the Settings bodies check the narrow keys --
select results_eq(
  $$ select p.oid::regprocedure::text collate "default", p.prosecdef, p.provolatile::text, p.proowner = 'postgres'::regrole,
            coalesce(p.proconfig, '{}') = array['search_path=pg_catalog, pg_temp'],
            has_function_privilege('authenticated', p.oid, 'execute'),
            has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
     from pg_proc p
     where p.oid in ('private.has_permission(text)'::regprocedure, 'private.assert_can_change_credentials(uuid,text)'::regprocedure,
                     'private.authorize_account_creation(text,text,text)'::regprocedure,
                     'private.admin_create_profile(uuid,text,text,text,text,uuid)'::regprocedure,
                     'private.admin_set_user_active(uuid,boolean,integer,text)'::regprocedure,
                     'private.add_call_type(text)'::regprocedure, 'private.set_call_type_active(uuid,boolean,integer)'::regprocedure,
                     'private.add_followup_reason(text)'::regprocedure,
                     'private.set_followup_reason_active(uuid,boolean,integer)'::regprocedure,
                     'private.delete_followup_reason(uuid,integer)'::regprocedure)
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values ('private.add_call_type(text)', true, 'v', true, true, true, false),
            ('private.add_followup_reason(text)', true, 'v', true, true, true, false),
            ('private.admin_create_profile(uuid,text,text,text,text,uuid)', true, 'v', true, true, true, false),
            ('private.admin_set_user_active(uuid,boolean,integer,text)', true, 'v', true, true, true, false),
            ('private.assert_can_change_credentials(uuid,text)', true, 'v', true, true, true, false),
            ('private.authorize_account_creation(text,text,text)', true, 'v', true, true, true, false),
            ('private.delete_followup_reason(uuid,integer)', true, 'v', true, true, true, false),
            ('private.has_permission(text)', true, 's', true, true, true, false),
            ('private.set_call_type_active(uuid,boolean,integer)', true, 'v', true, true, true, false),
            ('private.set_followup_reason_active(uuid,boolean,integer)', true, 'v', true, true, true, false) $$,
  'the ten replaced bodies keep SECURITY DEFINER, their volatility, owner postgres, the pinned search_path and EXECUTE for authenticated only');
select results_eq(
  $$ select p.proname::text collate "default",
            (regexp_match(p.prosrc, 'private\.has_permission\(''(\w+)''\)'))[1] collate "default",
            p.prosrc like '%''settings''%'
     from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('add_call_type', 'set_call_type_active', 'add_followup_reason', 'set_followup_reason_active',
                         'delete_followup_reason', 'add_collection_location', 'set_collection_location_active',
                         'delete_collection_location')
     order by p.proname::text collate "C" $$,
  $$ values ('add_call_type', 'callTypes', false), ('add_collection_location', 'settings', true),
            ('add_followup_reason', 'reasons', false), ('delete_collection_location', 'settings', true),
            ('delete_followup_reason', 'reasons', false), ('set_call_type_active', 'callTypes', false),
            ('set_collection_location_active', 'settings', true), ('set_followup_reason_active', 'reasons', false) $$,
  'call types check callTypes and continuation reasons check reasons (D60 (8)), neither names settings any more; pickup places keep settings');
select ok(
  (select prosrc like '%p_key <> ''usage''%' and prosrc not like '%p_key <> ''usage'' and exists%'
   from pg_proc where oid = 'private.has_permission(text)'::regprocedure),
  'has_permission: the matrix roles never get usage; the Creator''s branch no longer excludes it (D60 (9))');

-- Comments ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", obj_description(c.oid, 'pg_class') collate "default" from pg_class c
     where c.oid in ('public.profiles'::regclass, 'public.account_requests'::regclass, 'public.call_types'::regclass,
                     'public.followup_reasons'::regclass)
     order by c.relname::text collate "C" $$,
  $$ values
     ('account_requests', 'D34 a account requests: retired by D60 (7) (C-02), kept read-only as history; and the audited phase-1 authorization of direct creations (direct_create, §8.5), the only new rows. Written only through RPCs; never deleted.'),
     ('call_types', 'Call types (D35, D48). Written only by private.add_call_type and private.set_call_type_active (key callTypes, D60 (8)). Never deleted.'),
     ('followup_reasons', 'Continuation reasons (D35, D48, SE-07). Written only by private.add_followup_reason, private.set_followup_reason_active and private.delete_followup_reason (key reasons, D60 (8)). At least one stays active.'),
     ('profiles', 'Accounts (D34, D60 (7)). Role from this table only, never from Auth metadata. Written only through RPCs. Never removed: a deleted account (Option A: deleted_at, the server time of the Creator''s deletion, and deleted_by, set once together) keeps its row, inactive and frozen.') $$,
  'the table comments describe the D60 rules');
select results_eq(
  $$ select p.oid::regprocedure::text collate "default", obj_description(p.oid, 'pg_proc') collate "default" from pg_proc p
     where p.oid in ('public.request_account_change(text,uuid,text,text,text)'::regprocedure,
                     'public.decide_account_request(uuid,text,integer,text)'::regprocedure)
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values ('decide_account_request(uuid,text,integer,text)', 'Retired by Migration 5 (D60 (7), C-02): no role may run it. Kept unchanged for the rollback.'),
            ('request_account_change(text,uuid,text,text,text)', 'Retired by Migration 5 (D60 (7), C-02): no role may run it. Kept unchanged for the rollback.') $$,
  'the two retired wrappers say so');

-- No new table, view or sequence; no new grant on a table ---------------------------------------------
-- Step 6 (Migration 6) adds three tables and Step 4 (Migration 7) one (no sequence); they are left out of this PR 1.8 count.
select is(
  (select count(*) from pg_class c where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
     and c.relkind in ('r', 'p', 'v', 'm', 'S')
     and c.oid not in ('public.external_calendar_events'::regclass, 'public.calendar_event_changes'::regclass,
                       'public.calendar_ingestion_errors'::regclass, 'public.visit_media'::regclass)),
  28::bigint, 'PR 1.8 adds no table, view or sequence (23 tables, 1 view and 4 identity sequences, as after Migration 4)');
select is(
  (select array_agg(a.privilege_type::text order by a.privilege_type)
   from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid = 'public.profiles'::regclass and a.grantee = 'authenticated'::regrole),
  array['SELECT'], 'profiles stays SELECT-only for authenticated (every change goes through a writer)');

select * from finish();
rollback;
