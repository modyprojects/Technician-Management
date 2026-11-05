-- PR 1.3: the rollback (down) script, tested inside this transaction and rolled back
-- (docs/database-schema.md "Migration order and approval checklist" item 6). The three blocks
-- between the markers are byte-identical copies of the down script; tests/ci/rollback.test.mjs
-- fails if they differ. A manual run on the local stack (down, catalog checks, re-apply) is in
-- docs/review/step1-pr13/README.md.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select ok(to_regnamespace('private') is not null and to_regclass('public.profiles') is not null,
  'positive control: the migration is applied before the rollback runs');

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
