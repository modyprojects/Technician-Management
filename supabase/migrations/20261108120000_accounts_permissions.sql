-- Step 1 / PR 1.8 — Migration 5: accounts and permissions.
--
-- Sources: decisions D60 (7) user administration, D60 (8) Manager settings and D60 (9) usage
-- analytics (QA corrections 01), with D33, D34 (as superseded by D60 (7)), D43, D47, D49, D51;
-- docs/qa-corrections-01-integration.md §4 and §5 "Migration 5" (rows M-06, M-07, M-10, C-01,
-- C-02, C-03 to C-06); docs/database-schema.md §8 and "Planned changes from D60";
-- docs/security.md §5, §8; docs/architecture-data-access.md and the account and Settings ports
-- (features/accounts/data, features/settings/data). docs/review/step1-pr18/README.md lists the
-- deviations DEV-1 to DEV-9 and the TEMPORARY behaviours OQ-1 to OQ-10.
--
-- Content:
--   - Creator-only deletion, Option A (C-01, M-10): two nullable columns on profiles (deleted_at,
--     deleted_by) with three CHECKs and a foreign key; a permanence trigger on profiles, a freeze
--     trigger on technicians and a one-way trigger for deleted_by; the writer admin_delete_user
--     (which also turns a deleted Technician's "פעיל" off) and its wrapper; the audit action
--     profile.deleted.
--   - Direct Manager administration of Technician and Customer Service accounts (D60 (7), M-06):
--     new bodies for authorize_account_creation, admin_create_profile and admin_set_user_active;
--     assert_can_change_credentials and admin_set_user_active refuse a deleted account (the
--     reactivation guard). assert_can_manage and admin_set_user_role already follow D60 (7) and
--     are unchanged (DEV-1).
--   - The account-request path retired (C-02): EXECUTE on request_account_change and
--     decide_account_request revoked from every role; a trigger refuses any new row but the
--     phase-1 creation intent (direct_create); the table stays readable as history under the
--     PR 1.3 policies.
--   - The narrow matrix keys reasons, callTypes and ackText (D60 (8), M-07; TEMPORARY values, D51)
--     and the five Migration 2 call-type and continuation-reason RPCs switched to them.
--   - usage as a Creator-only fixed capability (D60 (9), C-03): has_permission grants it to the
--     Creator and never through the matrix.
--   - The fail-closed hardening check (section 14, a byte-identical copy of Migration 4 section 12),
--     and a read-only pre-apply check (section 0b) that refuses to retire the request path while a
--     legacy request would be stranded.
--
-- Data: schema plus the owner-approved D60 (8) catalogue rows (3 keys) and their TEMPORARY default
-- values (6 values, D51). No test or fictitious rows (D47). No row of an earlier migration changes.
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step1-pr18 section 13;
-- each question is "PR 1.8 OQ-n"):
--   OQ-1  a Creator account is never deleted (one Creator exists; nothing creates another, D49,
--         PR 1.3 Q11).
--   OQ-2  a deleted account is frozen for every writer: its profile and its field profile never
--         change again (no reactivation, edit, role change, credential change or undelete); its
--         unique Outlook email and invitation alias stay taken.
--   OQ-3  deleted profiles stay readable under the PR 1.3 policies, like deactivated ones (the
--         attribution of history needs them); lists and pickers leave them out (Step 2 queries).
--   OQ-4  the retired request path: no new request rows; earlier rows stay as history;
--         cancel_account_request is unchanged (a requester may still cancel his own pending request,
--         the Creator an approved, unfulfilled creation); admin_create_profile no longer binds an
--         approved Customer Service 'create' request (the Creator cancels it and authorizes a
--         direct creation).
--   OQ-5  `settings` stays an editable TEMPORARY matrix key (off for Manager and Customer Service,
--         D51) and gates pickup places only; it is not locked like `usage`.
--   OQ-6  the narrow-key defaults (Manager on, Customer Service off), labels and sort order
--         (14-16) are TEMPORARY until Step 10 (D51; labels until the SE-02 visual approval).
--   OQ-7  `ackText` is a data key with no table or function yet (Step 4, ack_text_versions, D43).
--   OQ-8  the Manager's audit view is unchanged: he reads profile.deleted rows of Technician and
--         Customer Service accounts (actor: the Creator).
--   OQ-9  deleting an account changes nothing else but a Technician's "פעיל", which it turns off
--         (review S-2): open visits and open creation intents stay as they were (as for a
--         deactivation; the office reassigns).
--   OQ-10 deletion takes no confirmation token: the explicit confirmation is the screen's, and the
--         expected version makes a stale screen fail (PT409).
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53), after
-- Migration 4 is applied and merged.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified. No function builds or runs SQL text.
--
-- Definer-writer invariant (restated from Migration 1, section 4): every writer of profiles,
-- technicians, account_requests and the matrix is a SECURITY DEFINER body owned by postgres, so the
-- SECURITY INVOKER triggers read consistent data.
--
-- Error codes (as in Migrations 1 to 4):
--   42501 "not authorized" (generic, also for unknown targets and a test caller with a real target)
--   22023 "invalid input"
--   55000 wrong state ("the account is deleted"; the triggers' texts for every other writer)
--   PT409 version conflict (PostgREST answers HTTP 409)
--   23514 integrity rule (CHECKs, the D47 one-way rule)

-- ---------------------------------------------------------------------------------------------
-- 0. Apply as postgres (see the PR 1.3 migration, section 0).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'apply this migration as postgres (current role: %)', current_user;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 0b. Fail closed when the retirement would strand a legacy request (independent review N-4).
--     Read-only; it raises before anything is changed, and the whole migration then rolls back.
--     The retired path (section 10) leaves a request row only cancel_account_request, which is
--     unchanged (OQ-4): a pending request can be cancelled by its requester while his profile is
--     active, and an approved, unfulfilled creation request by an active real Creator. A row that
--     nobody could close any more would be stranded: a pending request whose requester is not
--     active, or an approved, unfulfilled creation request while no active real Creator exists.
--     Creation intents (direct_create) are not changed by the retirement and are not counted. A
--     pending request of an active requester stays as history he can cancel. The remote project
--     holds no request (no profile exists before the D49 bootstrap); the README's pre-apply check
--     confirms it read-only. tests/db/310 runs a copy of this block (kept identical by
--     tests/ci/hardening-assertion.test.mjs) against injected rows.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_stranded bigint;
begin
  select pg_catalog.count(*) into v_stranded
  from public.account_requests r
  where r.request_type <> 'direct_create'
    and ((r.status = 'pending'
          and not exists (select 1 from public.profiles p where p.id = r.requested_by and p.is_active))
         or (r.status = 'approved' and r.target_profile_id is null
             and not exists (select 1 from public.profiles p where p.role = 'creator' and p.is_active and not p.is_test)));

  if v_stranded > 0 then
    raise exception 'pre-apply check failed, nothing is applied: % legacy account request(s) would be stranded by the retired request path (D60 (7), C-02); close them under Migration 4 first', v_stranded;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. profiles: deletion, Option A (D60 (7); C-01, M-10). Two nullable columns without a default
--    (no row changes); deleted_at and deleted_by are set together, only on an inactive row, and
--    deleted_by names a profile (ON DELETE RESTRICT, as every foreign key). Nothing is ever removed:
--    history and attribution (the name too) stay with the row.
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid;
alter table public.profiles
  add constraint profiles_deleted_by_fkey foreign key (deleted_by) references public.profiles (id) on delete restrict,
  add constraint profiles_deleted_check check ((deleted_at is null) = (deleted_by is null)),
  -- The reactivation guard for every writer: a deleted account is never active.
  add constraint profiles_deleted_inactive_check check (deleted_at is null or not is_active),
  add constraint profiles_deleted_self_check check (deleted_by is distinct from id);
-- (No column comments: the migration guard refuses three-part names such as table.column.)
comment on table public.profiles is
  'Accounts (D34, D60 (7)). Role from this table only, never from Auth metadata. Written only through RPCs. Never removed: a deleted account (Option A: deleted_at, the server time of the Creator''s deletion, and deleted_by, set once together) keeps its row, inactive and frozen.';

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger functions (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants: EXECUTE is checked only when a trigger is created).
-- ---------------------------------------------------------------------------------------------

-- profiles (D60 (7), Option A; TEMPORARY OQ-2): a deletion is permanent. Once deleted_at is set,
-- the row never changes again for any writer (no reactivation, edit, role change or undelete).
-- The deletion itself takes the server time (D45), whatever the writer sent.
create function private.tg_profile_deleted_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.deleted_at is not null then
    raise exception using errcode = '55000', message = 'profiles: a deleted account never changes (D60 (7))';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end
$$;

-- technicians (D60 (7), Option A; TEMPORARY OQ-2): the field profile of a deleted account keeps
-- its values (the attribution of history); it is never created or changed after the deletion. The
-- profile row is locked as tg_technician_guard locks it, so a concurrent deletion is seen.
create function private.tg_technician_deleted_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted_at timestamptz;
begin
  select p.deleted_at into v_deleted_at from public.profiles p where p.id = new.profile_id for share;
  if v_deleted_at is not null then
    raise exception using errcode = '55000', message = 'technicians: the account is deleted (D60 (7))';
  end if;
  return new;
end
$$;

-- account_requests (D60 (7), C-02): the request path is retired. The only new rows are the phase-1
-- creation intents of authorize_account_creation (direct_create, §8.5); the earlier request types
-- stay as history (TEMPORARY OQ-4).
create function private.tg_account_requests_retired()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.request_type is distinct from 'direct_create' then
    raise exception using errcode = '55000', message = 'account_requests: account requests are retired (D60 (7))';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Attach the triggers beside the PR 1.3 ones (DEV-6). Name prefixes fix the firing order
--    (BEFORE triggers run by name): on profiles t10_profile_guard, t12_deleted_guard,
--    t20_immutable_markers, t30_one_way, t31_one_way_deleted, t90_bump_version; on technicians
--    t10_technician_guard, t11_deleted_profile, ...; on account_requests t05_requests_retired
--    first.
-- ---------------------------------------------------------------------------------------------
create trigger t12_deleted_guard before update on public.profiles
  for each row execute function private.tg_profile_deleted_guard();
create trigger t31_one_way_deleted before insert or update on public.profiles
  for each row execute function private.tg_one_way_people('deleted_by');
create trigger t11_deleted_profile before insert or update on public.technicians
  for each row execute function private.tg_technician_deleted_guard();
create trigger t05_requests_retired before insert on public.account_requests
  for each row execute function private.tg_account_requests_retired();

-- ---------------------------------------------------------------------------------------------
-- 4. Audit extension: the deletion. The action CHECK keeps the 30 actions of Migrations 1 to 4
--    unchanged (the request actions too: earlier rows keep them); the target tables are
--    unchanged, so private.tg_audit_target and the audit anchor's functions stay as they are.
--    Existing rows are only re-validated, never rewritten.
-- ---------------------------------------------------------------------------------------------
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
    'collection_location.deleted',
    'visit.corrected', 'review_item.resolved',
    'profile.deleted'));

-- ---------------------------------------------------------------------------------------------
-- 5. The permission catalogue (D33, D60 (8)): the closed key list gains the three narrow data keys
--    that govern the Manager's Settings areas. Their rows are the last writes of the file (section
--    12). `usage` stays a key (the Step 10 matrix screen shows it) but is a Creator-only fixed
--    capability (D60 (9)): Migration 1's CHECK role_permissions_pending_decisions keeps it off for
--    both matrix roles, now for good (DEV-5), and has_permission never grants it through the
--    matrix (section 6).
-- ---------------------------------------------------------------------------------------------
alter table public.permissions
  drop constraint permissions_key_check,
  add constraint permissions_key_check check (key in (
    'cal', 'calls', 'card', 'cancel', 'dashGen', 'dashTech', 'dashProd', 'export', 'settings', 'usage',
    'products', 'conflicts', 'recordings', 'reasons', 'callTypes', 'ackText')),
  drop constraint permissions_enforcement_by_key,
  add constraint permissions_enforcement_by_key check (
    (enforcement = 'data') = (key in ('calls', 'card', 'settings', 'products', 'conflicts', 'cancel', 'recordings',
                                      'reasons', 'callTypes', 'ackText')));
comment on constraint role_permissions_pending_decisions on public.role_permissions is
  'Customer Service cancel stays off until open decision 5 (d08). usage is off for both matrix roles for good: a Creator-only fixed capability since D60 (9).';

-- ---------------------------------------------------------------------------------------------
-- 6. has_permission (replaces the PR 1.3 helper; same signature, ACL, owner and options). D33,
--    D60 (9): the Creator has every catalogue key, `usage` included (open decision 10 is resolved:
--    a Creator-only fixed capability); Manager and Customer Service follow the matrix (a missing
--    value is denied, D51) and never get `usage`, whatever a value says; a Technician has none.
-- ---------------------------------------------------------------------------------------------
create or replace function private.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((
    select case
      when p.role = 'creator' then
        exists (select 1 from public.permissions k where k.key = p_key)
      when p.role in ('manager', 'customer_service') then
        p_key <> 'usage'
        and coalesce((select rp.allowed from public.role_permissions rp
                      where rp.role = p.role and rp.permission_key = p_key), false)
      else false
    end
    from public.profiles p
    where p.id = auth.uid() and p.is_active), false)
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Account bodies (D60 (7); replace the PR 1.3 bodies, same signatures, ACLs, owner and
--    options; one new writer). SECURITY DEFINER plpgsql in private, every reference
--    schema-qualified, no dynamic SQL. Each checks the caller in profiles (never in Auth metadata
--    or the matrix) and writes its audit row in the same transaction. Unchanged from PR 1.3:
--    assert_can_manage (the Creator manages every role, a Manager Technician and Customer Service
--    accounts), admin_set_user_role (Creator only; a Manager never changes a role), admin_update_profile,
--    admin_create_technician, admin_update_technician (routine updates, D34 d) and
--    cancel_account_request (the creation intents need it; OQ-4).
-- ---------------------------------------------------------------------------------------------

-- Runs before any Auth Admin call that sets a password or changes an email: Creator only (D34 e,
-- kept by D60 (7)). D60 (7), Option A: never for a deleted account (OQ-2).
create or replace function private.assert_can_change_credentials(p_target_profile_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('password', 'email') or p_target_profile_id is null
     or not exists (select 1 from public.profiles p where p.id = p_target_profile_id) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_target_profile_id and p.deleted_at is not null) then
    raise exception using errcode = '55000', message = 'the account is deleted';
  end if;
  perform private.write_audit('credentials.change_authorized', 'profiles', p_target_profile_id,
    jsonb_build_object('kind', p_kind));
end
$$;

-- Phase 1 of a creation (§8.5), before any Auth Admin call, under the caller's own session: D60 (7)
-- (M-06): a Manager authorizes Technician and Customer Service creations directly, with no
-- Creator approval; the Creator authorizes Technician, Customer Service and Manager creations.
-- Nothing creates a Creator (D49, TEMPORARY PR 1.3 Q11). The intent stays in account_requests
-- (direct_create, approved by its own requester; DEV-2), and phase 3 (admin_create_profile) binds
-- the Auth user to it.
create or replace function private.authorize_account_creation(p_role text, p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_full_name);
  v_id uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_role = 'creator' or (v_caller.role = 'manager' and p_role = 'manager') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_role is null or p_role not in ('technician', 'customer_service', 'manager')
     or coalesce(v_email, '') = '' or coalesce(v_name, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if exists (select 1 from public.account_requests r
             where r.email = v_email and r.request_type in ('create', 'direct_create')
               and r.status in ('pending', 'approved') and r.target_profile_id is null) then
    raise exception using errcode = '55000', message = 'an open request exists';
  end if;
  -- TEMPORARY until go-live (D47): every new user is a test user (so its email is in example.test,
  -- CHECK account_requests_test_email, owner question Q12).
  insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status,
                                       decided_by, decided_at, is_test)
  values ('direct_create', p_role, v_email, v_name, v_caller.id, 'approved', v_caller.id, now(), true)
  returning id into v_id;
  perform private.write_audit('account_creation.authorized', 'account_requests', v_id,
    jsonb_build_object('requested_role', p_role, 'actor_role', v_caller.role));
  return v_id;
end
$$;

-- Phase 3 (§8.5; re-review R-S1, S5, S12 of PR 1.3 unchanged): the Auth user must match an open
-- creation intent of the same caller (approved 'direct_create', same role and email, the intent id
-- as app_metadata.account_request_id, created after the authorization, not anonymous, SSO or
-- deleted). D60 (7): a Manager binds Technician and Customer Service accounts. The retired request
-- path is no longer bound (TEMPORARY OQ-4). Every binding failure returns the same error. Never
-- through service_role.
create or replace function private.admin_create_profile(
  p_user_id uuid, p_role text, p_full_name text, p_work_phone text default null,
  p_invitation_rep_name text default null, p_request_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_request public.account_requests;
  v_user_email text;
  v_user_created_at timestamptz;
  v_user_nonce text;
  v_user_anonymous boolean;
  v_user_sso boolean;
  v_user_deleted_at timestamptz;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_role = 'creator' or (v_caller.role = 'manager' and p_role not in ('technician', 'customer_service')) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_user_id is null or p_role is null or p_role not in ('technician', 'customer_service', 'manager')
     or p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select r.* into v_request from public.account_requests r where r.id = p_request_id for update;
  select u.email, u.created_at, u.raw_app_meta_data ->> 'account_request_id', u.is_anonymous, u.is_sso_user, u.deleted_at
  into v_user_email, v_user_created_at, v_user_nonce, v_user_anonymous, v_user_sso, v_user_deleted_at
  from auth.users u where u.id = p_user_id;
  if v_request.id is null or v_user_created_at is null
     or v_request.status <> 'approved' or v_request.target_profile_id is not null
     or v_request.requested_role <> p_role
     or v_request.request_type <> 'direct_create' or v_request.requested_by <> v_caller.id
     or lower(coalesce(v_user_email, '')) <> v_request.email
     or v_user_nonce is distinct from p_request_id::text
     or v_user_created_at < v_request.decided_at
     or v_user_anonymous is distinct from false or v_user_sso is distinct from false or v_user_deleted_at is not null
     or exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  -- TEMPORARY until go-live (D47, §2): every new user is a test user. The caller manages only
  -- test targets when he is a test user himself, which holds because the target is a test user.
  begin
    insert into public.profiles (id, role, full_name, work_phone, invitation_rep_name, is_active, is_test, created_by, updated_by)
    values (p_user_id, p_role, coalesce(nullif(btrim(p_full_name), ''), v_request.full_name), nullif(btrim(p_work_phone), ''),
            nullif(btrim(p_invitation_rep_name), ''), true, true, v_caller.id, v_caller.id);
  exception when unique_violation then
    -- S12: no detail, so the aliases of accounts the caller cannot read are not revealed.
    raise exception using errcode = '23505', message = 'the value is already in use';
  end;
  perform private.write_audit('profile.created', 'profiles', p_user_id,
    jsonb_build_object('role', p_role, 'request_id', p_request_id));
  update public.account_requests r set target_profile_id = p_user_id where r.id = p_request_id;
  return p_user_id;
end
$$;

-- Activation and deactivation (D60 (7), superseding D34 a and c here): a Manager activates,
-- reactivates and deactivates Technician and Customer Service accounts immediately, with no Creator
-- approval (audited; the Creator's notice in Step 2 reads these rows); the Creator any account but
-- his own. Nobody changes his own state. A deleted account is never activated again, nor
-- deactivated (the reactivation guard, Option A; also CHECK profiles_deleted_inactive_check and
-- t12_deleted_guard for every writer).
create or replace function private.admin_set_user_active(
  p_profile_id uuid, p_active boolean, p_expected_version integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_reason text := nullif(btrim(p_reason), '');
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_profile_id is null or p_active is null or p_expected_version is null or char_length(v_reason) > 300 then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if p_profile_id = v_caller.id then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found or (v_caller.is_test and not v_target.is_test)
     or (v_caller.role = 'manager' and v_target.role not in ('technician', 'customer_service')) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.deleted_at is not null then
    raise exception using errcode = '55000', message = 'the account is deleted';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  update public.profiles p set is_active = p_active, updated_by = v_caller.id
  where p.id = p_profile_id
  returning p.version into v_version;
  perform private.write_audit(case when p_active then 'profile.activated' else 'profile.deactivated' end,
    'profiles', p_profile_id, jsonb_build_object('actor_role', v_caller.role, 'reason', v_reason));
  return v_version;
end
$$;

-- Deletion, Option A (D60 (7); C-01, M-10): the Creator only, after the screen's explicit
-- confirmation (OQ-10), never his own account and never a Creator account (TEMPORARY OQ-1). It
-- revokes access in the database at once and for good: the profile becomes inactive and is marked
-- deleted (deleted_at at server time, deleted_by), and it never changes again (t12_deleted_guard;
-- the field profile too, t11_deleted_profile). Review S-2: a deleted Technician also stops
-- receiving new work: his field profile's "פעיל" (accepts_invitations) is turned off first, while
-- t11 still allows it, and audited (technician.updated); t11 then keeps it off. No row is removed:
-- history, attribution and the name stay (every foreign key is ON DELETE RESTRICT). Audited in the
-- same transaction. Step 2 hand-off (section 13): only after this call commits does the server
-- revoke the Auth side with the secret key.
create function private.admin_delete_user(p_profile_id uuid, p_expected_version integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_reason text := nullif(btrim(p_reason), '');
  v_version integer;
  v_technician_id uuid;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test or p_profile_id = v_caller.id then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_profile_id is null or p_expected_version is null or char_length(v_reason) > 300 then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found or v_target.role = 'creator' then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.deleted_at is not null then
    raise exception using errcode = '55000', message = 'the account is deleted';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  update public.technicians t set accepts_invitations = false, updated_by = v_caller.id
  where t.profile_id = p_profile_id and t.accepts_invitations
  returning t.id into v_technician_id;
  if v_technician_id is not null then
    perform private.write_audit('technician.updated', 'technicians', v_technician_id,
      jsonb_build_object('fields', jsonb_build_array('accepts_invitations'), 'cause', 'profile.deleted'));
  end if;
  update public.profiles p
  set is_active = false, deleted_at = now(), deleted_by = v_caller.id, updated_by = v_caller.id
  where p.id = p_profile_id
  returning p.version into v_version;
  perform private.write_audit('profile.deleted', 'profiles', p_profile_id,
    jsonb_build_object('role', v_target.role, 'was_active', v_target.is_active, 'reason', v_reason));
  return v_version;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Call types and continuation reasons (D60 (8), M-07): the five Migration 2 bodies, byte for
--    byte, with the key check switched from `settings` to the narrow keys (callTypes for call
--    types, reasons for continuation reasons). Same signatures, ACLs, owner and options; the
--    migration guard's ALLOWED_WRITERS entries of add_call_type and add_followup_reason are
--    unchanged. Pickup places keep `settings` (D60 (8): they stay Creator-only by default, OQ-5).
-- ---------------------------------------------------------------------------------------------
create or replace function private.add_call_type(p_label text)
returns table (created_id uuid, created_is_test boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_label text := btrim(p_label);
  v_sort integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('callTypes') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(v_label, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.call_types.sort_order', 0));
  if (select count(*) from public.call_types c) >= 100 then
    raise exception using errcode = '55000', message = 'the list is full';
  end if;
  select coalesce(max(c.sort_order), 0) + 1 into v_sort from public.call_types c;
  begin
    insert into public.call_types as c (label_he, sort_order, is_active, is_test, created_by, updated_by)
    values (v_label, v_sort, true, true, v_caller.id, v_caller.id)
    returning c.id, c.is_test into created_id, created_is_test;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'the value is already in use';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  perform private.write_audit('call_type.created', 'call_types', created_id, '{}'::jsonb);
  return next;
end
$$;

create or replace function private.set_call_type_active(p_call_type_id uuid, p_active boolean, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.call_types;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('callTypes') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_call_type_id is null or p_active is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select c.* into v_target from public.call_types c where c.id = p_call_type_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  update public.call_types c set is_active = p_active, updated_by = v_caller.id
  where c.id = p_call_type_id
  returning c.version into v_version;
  perform private.write_audit(case when p_active then 'call_type.activated' else 'call_type.deactivated' end,
    'call_types', p_call_type_id, '{}'::jsonb);
  return v_version;
end
$$;

create or replace function private.add_followup_reason(p_label text)
returns table (created_id uuid, created_is_test boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_label text := btrim(p_label);
  v_sort integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('reasons') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(v_label, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.sort_order', 0));
  if (select count(*) from public.followup_reasons r) >= 100 then
    raise exception using errcode = '55000', message = 'the list is full';
  end if;
  select coalesce(max(r.sort_order), 0) + 1 into v_sort from public.followup_reasons r;
  begin
    insert into public.followup_reasons as r (label_he, sort_order, is_active, is_user_added, is_test, created_by, updated_by)
    values (v_label, v_sort, true, true, true, v_caller.id, v_caller.id)
    returning r.id, r.is_test into created_id, created_is_test;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'the value is already in use';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  perform private.write_audit('followup_reason.created', 'followup_reasons', created_id, '{}'::jsonb);
  return next;
end
$$;

create or replace function private.set_followup_reason_active(p_reason_id uuid, p_active boolean, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.followup_reasons;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('reasons') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_reason_id is null or p_active is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if not p_active then
    perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.active', 0));
  end if;
  select r.* into v_target from public.followup_reasons r where r.id = p_reason_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  if not p_active
     and not exists (select 1 from public.followup_reasons r where r.is_active and r.id <> p_reason_id) then
    raise exception using errcode = '55000', message = 'at least one continuation reason must stay active';
  end if;
  update public.followup_reasons r set is_active = p_active, updated_by = v_caller.id
  where r.id = p_reason_id
  returning r.version into v_version;
  perform private.write_audit(case when p_active then 'followup_reason.activated' else 'followup_reason.deactivated' end,
    'followup_reasons', p_reason_id, '{}'::jsonb);
  return v_version;
end
$$;

create or replace function private.delete_followup_reason(p_reason_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.followup_reasons;
  v_deleted uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('reasons') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_reason_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.active', 0));
  select r.* into v_target from public.followup_reasons r where r.id = p_reason_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if not v_target.is_user_added then
    raise exception using errcode = '55000', message = 'the initial reasons are never deleted; deactivate it instead';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active
     and not exists (select 1 from public.followup_reasons r where r.is_active and r.id <> p_reason_id) then
    raise exception using errcode = '55000', message = 'at least one continuation reason must stay active';
  end if;
  begin
    perform private.write_audit('followup_reason.deleted', 'followup_reasons', p_reason_id,
      jsonb_build_object('label', v_target.label_he));
    delete from public.followup_reasons r where r.id = p_reason_id
    returning r.id into v_deleted;
  exception
    when foreign_key_violation then
      raise exception using errcode = '55000', message = 'in use; deactivate it instead';
  end;
  if v_deleted is null then
    raise exception using errcode = '55000', message = 'the reason was not deleted';
  end if;
end
$$;

comment on table public.call_types is
  'Call types (D35, D48). Written only by private.add_call_type and private.set_call_type_active (key callTypes, D60 (8)). Never deleted.';
comment on table public.followup_reasons is
  'Continuation reasons (D35, D48, SE-07). Written only by private.add_followup_reason, private.set_followup_reason_active and private.delete_followup_reason (key reasons, D60 (8)). At least one stays active.';

-- ---------------------------------------------------------------------------------------------
-- 9. Public API: the thin SECURITY INVOKER wrapper of the new writer (same name and arguments).
-- ---------------------------------------------------------------------------------------------
create function public.admin_delete_user(p_profile_id uuid, p_expected_version integer, p_reason text default null)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.admin_delete_user(p_profile_id, p_expected_version, p_reason) $$;

-- ---------------------------------------------------------------------------------------------
-- 10. The account-request path retired (D60 (7), C-02): no role may run the request or decision
--     functions any more (Creator included). Their bodies stay as PR 1.3 wrote them, so the
--     rollback only grants them again. account_requests keeps its PR 1.3 policies (the Creator
--     reads every row, a Manager his own) as history.
-- ---------------------------------------------------------------------------------------------
revoke all on function private.request_account_change(text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.request_account_change(text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.decide_account_request(uuid, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.decide_account_request(uuid, text, integer, text) from public, anon, authenticated, service_role;
comment on function public.request_account_change(text, uuid, text, text, text) is
  'Retired by Migration 5 (D60 (7), C-02): no role may run it. Kept unchanged for the rollback.';
comment on function public.decide_account_request(uuid, text, integer, text) is
  'Retired by Migration 5 (D60 (7), C-02): no role may run it. Kept unchanged for the rollback.';
comment on table public.account_requests is
  'D34 a account requests: retired by D60 (7) (C-02), kept read-only as history; and the audited phase-1 authorization of direct creations (direct_create, §8.5), the only new rows. Written only through RPCs; never deleted.';

-- ---------------------------------------------------------------------------------------------
-- 11. Grants, per object (never PR 1.3's blanket revokes, which would strip its grants). Functions:
--     EXECUTE for authenticated on the new wrapper and the body it calls (the body checks its
--     caller); none on the three trigger functions. Nothing for anon, service_role or PUBLIC. The
--     replaced functions keep their ACLs (CREATE OR REPLACE keeps them). No table, sequence or
--     column grant changes: profiles stays SELECT for authenticated.
-- ---------------------------------------------------------------------------------------------
revoke all on function private.tg_profile_deleted_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_technician_deleted_guard() from public, anon, authenticated, service_role;
revoke all on function private.tg_account_requests_retired() from public, anon, authenticated, service_role;
revoke all on function private.admin_delete_user(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_user(uuid, integer, text) from public, anon, authenticated, service_role;

grant execute on function
  private.admin_delete_user(uuid, integer, text),
  public.admin_delete_user(uuid, integer, text)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 12. Owner-approved reference data (D60 (8)), the last writes in the file: the three narrow keys
--     and their default values. TEMPORARY (D51, OQ-6): every value has value_status 'temporary'
--     until the owner approves the final matrix in Step 10 (pre-pilot gate); Manager on, Customer
--     Service off. Labels TEMPORARY until the SE-02 visual approval, in the QA document's words.
-- ---------------------------------------------------------------------------------------------
insert into public.permissions (key, label_he, enforcement, sort_order) values
  ('reasons', 'סיבות המשך טיפול', 'data', 14),
  ('callTypes', 'סוגי קריאה', 'data', 15),
  ('ackText', 'נוסח אישור ״טופל״', 'data', 16);

insert into public.role_permissions (role, permission_key, allowed, value_status) values
  ('manager', 'reasons', true, 'temporary'),
  ('manager', 'callTypes', true, 'temporary'),
  ('manager', 'ackText', true, 'temporary'),
  ('customer_service', 'reasons', false, 'temporary'),
  ('customer_service', 'callTypes', false, 'temporary'),
  ('customer_service', 'ackText', false, 'temporary');

-- ---------------------------------------------------------------------------------------------
-- 13. Hand-offs (no statement).
--     Step 2 (Auth admin actions and screens):
--     - Creation (D60 (7)): authorize_account_creation (phase 1, under the caller's session) ->
--       the Auth user with app_metadata.account_request_id = the intent id (secret key) ->
--       admin_create_profile (phase 3, under the caller's session); for a Technician then
--       admin_create_technician. A Manager does this for Technician and Customer Service accounts.
--     - Deletion (Option A): admin_delete_user under the Creator's session first; only after it
--       commits, the server revokes the Auth side with the secret key: it bans the Auth user (or
--       soft-deletes it) and ends its sessions. A hard delete of the Auth user cannot succeed
--       (profiles.id references auth.users ON DELETE RESTRICT). Until then the database already
--       refuses the account everything (every policy and function requires an active profile).
--       A retry of the Auth step re-reads the profile under the Creator's session (deleted_at set)
--       before the Auth call. Lists and pickers leave deleted accounts out (OQ-3).
--     - Password and email changes call assert_can_change_credentials first (refused for a
--       deleted account). New 55000 texts to map: 'the account is deleted' and the trigger texts.
--     Step 3 (telemetry, C-03 to C-06): the telemetry migration adds usage_events and its Creator-
--     only functions, gated by private.is_creator() or has_permission('usage') (Creator only).
--     Step 4: ack_text_versions (D43) and its writer, gated by `ackText`.
--     Step 6 (acceptance rule): the ingestion assigns a visit only to an eligible technician:
--     technicians.accepts_invitations AND the profile is active AND the profile is not deleted.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- 14. Fail closed when the hardening did not take effect (owner, 2026-11-11 and 2026-11-12: as
--     in Migration 4, section 12, byte for byte). Read-only; any leftover raises, and the whole
--     migration then rolls back. tests/db/270 runs a copy of this block (kept identical by
--     tests/ci/hardening-assertion.test.mjs) against injected leaks on the new objects.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_api oid[];
  v_authenticated oid;
  v_leaks text;
begin
  select pg_catalog.array_agg(r.oid) into v_api
  from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
  select r.oid into v_authenticated from pg_catalog.pg_roles r where r.rolname = 'authenticated';

  select pg_catalog.string_agg(x.leak, '; ' order by x.leak) into v_leaks
  from (
    select 'schema ' || n.nspname || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text as leak
    from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a
    where n.nspname in ('public', 'private') and a.privilege_type = 'CREATE'
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'relation ' || c.oid::regclass::text || ' ' || a.privilege_type || ' to ' || a.grantee::regrole::text
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated)
           or (a.grantee = v_authenticated and (c.relkind = 'S' or a.privilege_type <> 'SELECT')))
    union all
    select 'column ' || c.oid::regclass::text || '.' || t.attname || ' ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_attribute t
    join pg_catalog.pg_class c on c.oid = t.attrelid
    cross join lateral pg_catalog.aclexplode(t.attacl) a
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and t.attacl is not null
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    select 'function ' || p.oid::regprocedure::text || ' EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))) a
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (a.grantee = 0 or (a.grantee = any (v_api) and a.grantee <> v_authenticated))
    union all
    select 'default privileges of postgres (' || d.defaclobjtype::text || ') ' || a.privilege_type || ' to '
           || a.grantee::regrole::text
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and (a.grantee = 0 or a.grantee = any (v_api))
    union all
    -- No global entry means the built-in default (EXECUTE for PUBLIC), so a missing row is a leak.
    select 'global default privileges of postgres (f) EXECUTE to ' || a.grantee::regrole::text
    from pg_catalog.aclexplode(coalesce(
      (select d.defaclacl from pg_catalog.pg_default_acl d
       where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'),
      pg_catalog.acldefault('f'::"char", 'postgres'::regrole))) a
    where a.grantee = 0 or a.grantee = any (v_api)
    union all
    select 'table ' || c.oid::regclass::text || ' without row level security'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    select 'relation ' || c.oid::regclass::text || ' owned by ' || c.relowner::regrole::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.relowner <> 'postgres'::regrole
    union all
    select 'function ' || p.oid::regprocedure::text || ' owned by ' || p.proowner::regrole::text
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proowner <> 'postgres'::regrole
    union all
    select 'policy ' || o.polname || ' on ' || o.polrelid::regclass::text || ' for a role other than authenticated'
    from pg_catalog.pg_policy o
    join pg_catalog.pg_class c on c.oid = o.polrelid
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and o.polroles is distinct from array[v_authenticated]::oid[]
    union all
    select 'function ' || p.oid::regprocedure::text || ' without search_path pg_catalog, pg_temp'
    from pg_catalog.pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.proconfig is distinct from array['search_path=pg_catalog, pg_temp']::text[]
    union all
    -- A view runs with its owner's rights unless security_invoker is on; a materialized view
    -- has no such option. Only invoker-rights views (the RLS of the reader applies) pass.
    select 'view ' || c.oid::regclass::text || ' without security_invoker'
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'v'
      and not coalesce((select o.option_value::boolean from pg_catalog.pg_options_to_table(c.reloptions) o
                        where o.option_name = 'security_invoker'), false)
    union all
    select 'materialized view ' || c.oid::regclass::text
    from pg_catalog.pg_class c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'm'
  ) x;

  if v_leaks is not null then
    raise exception 'hardening check failed, nothing is applied: %', v_leaks;
  end if;
end
$$;
