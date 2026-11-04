-- Rollback (down) script for supabase/migrations/20261104120000_access_and_permissions.sql
-- (Step 1 / PR 1.3). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before Step 2. After the first Creator is bootstrapped (D49) this script would
-- destroy the real Creator's profile and the audit evidence; its first statement refuses to run
-- as soon as any profile, technician, request or audit row exists.
-- How: as postgres, in one transaction, with the owner's separate approval for any remote run
-- (D52 rule 4, D53). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- Explicit drops in reverse order, no CASCADE: an unexpected dependent object makes it fail
-- instead of silently dropping more. It deliberately keeps the privilege hardening (revoked
-- default privileges and grants; owner question Q2 in docs/review/step1-pr13): restoring Supabase's permissive defaults
-- would reopen the known anon finding.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables, one proves that the precondition below refuses to run.

-- 0. Fail closed (S4): refuse to run once any account, request or audit row exists (for example
--    after the first Creator was bootstrapped, D49). Nothing is dropped then.
do $$
begin
  if exists (select 1 from public.profiles) or exists (select 1 from public.technicians)
     or exists (select 1 from public.account_requests) or exists (select 1 from public.audit_logs) then
    raise exception using errcode = '55000',
      message = 'rollback refused: accounts, requests or audit rows exist; this down script is valid only before Step 2';
  end if;
end
$$;

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

-- 6. The CLI's migration history, so the migration can be applied again.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261104120000';
  end if;
end
$$;
