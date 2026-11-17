-- Rollback (down) script for supabase/migrations/20261108120000_accounts_permissions.sql
-- (Step 1 / PR 1.8). Not a migration: the Supabase CLI never applies files in this folder.
--
-- When: only before any PR 1.8 data exists. It refuses to run when a profile is marked deleted,
-- when an audit row records a deletion or names a narrow key (reasons, callTypes, ackText), when a
-- narrow-key value was changed or approved (its version is not 1 or its status not temporary),
-- when a later migration is recorded in the history (roll that one back first), or when the
-- history table exists without a row for this migration. Rows written under the D60 (7) rules that
-- Migration 1 refused (a Manager's Customer Service creation intent, profile or activation, a call
-- type or reason added with a narrow key) are valid rows of the earlier schema and do not block it;
-- after the rollback the D34 rules and the `settings` key apply again to everything that follows.
-- How: as postgres, with the owner's separate approval for any remote run (D52 rule 4, D53;
-- PR 1.3 B6). Locally:
--   psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- The whole script is one DO block (PR 1.3 re-review R-S3): the refusals, every DROP, the restores
-- and the history delete are one statement, so a refusal or any error cancels all of it whatever
-- the client flags. Static DDL only (no dynamic SQL).
-- It restores the ten functions that the migration replaced (private.has_permission,
-- assert_can_change_credentials, authorize_account_creation, admin_create_profile and
-- admin_set_user_active to their PR 1.3 text; add_call_type, set_call_type_active,
-- add_followup_reason, set_followup_reason_active and delete_followup_reason to their PR 1.4 text:
-- byte-identical bodies; CREATE OR REPLACE keeps their grants), grants the four request functions
-- to authenticated again (GRANT ALL on a function is its EXECUTE privilege; a down script may not
-- contain the execute token, tests/ci/rollback.test.mjs), restores the comments, drops the PR 1.8
-- objects in reverse order with no CASCADE (an unexpected dependent object makes it fail instead
-- of silently dropping more), drops the two profiles columns (all NULL then), removes the three
-- narrow keys and their six values (the two reject-delete triggers are disabled only around those
-- deletes, which must remove exactly 6 and 3 rows), and restores the two permissions CHECKs
-- (PR 1.3) and the audit action CHECK (PR 1.6). The PR 1.3 to PR 1.6 objects, their grants and the
-- hardening stay. Run it before the PR 1.6 down script.
-- It also removes the migration history row (the CLI version, or an MCP apply's name, step 9) and
-- refuses to run when the history table exists without one.
-- tests/db/990_rollback.test.sql carries byte-identical copies (checked by tests/ci): one runs it
-- on the empty tables; the other proves that each refusal condition stops it.

do $down$
declare
  v_history_rows bigint;
  v_rows bigint;
begin
  -- 0. Fail closed, before anything is dropped. A later migration may depend on these objects:
  --    refuse, with a clear message instead of a dependency error at DROP time. The history table
  --    must hold this migration's row (the CLI version or the MCP name).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if not exists (
      select 1 from supabase_migrations.schema_migrations h
      where h.version = '20261108120000' or h.name = 'accounts_permissions') then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261108120000 or name accounts_permissions; nothing was dropped';
    end if;
    if exists (
      select 1 from supabase_migrations.schema_migrations m
      where m.version > (select max(h.version) from supabase_migrations.schema_migrations h
                         where h.version = '20261108120000' or h.name = 'accounts_permissions')) then
      raise exception using errcode = '55000',
        message = 'rollback refused: a later migration is recorded; roll it back first';
    end if;
  end if;
  -- Any PR 1.8 data (a deleted account, a deletion audit row, a narrow-key value that changed or was
  -- approved, an audit row about a narrow key): nothing is dropped. Dropping the columns would turn
  -- a deleted account into a deactivated one that could be activated again, and deleting the
  -- narrow keys would orphan their history, so the script is valid only before any PR 1.8 data.
  if exists (select 1 from public.profiles p where p.deleted_at is not null or p.deleted_by is not null)
     or exists (select 1 from public.audit_logs a
                where a.action = 'profile.deleted'
                   or (a.target_table = 'role_permissions'
                       and a.details ->> 'key' in ('reasons', 'callTypes', 'ackText')))
     or exists (select 1 from public.role_permissions rp
                where rp.permission_key in ('reasons', 'callTypes', 'ackText')
                  and (rp.version <> 1 or rp.value_status <> 'temporary')) then
    raise exception using errcode = '55000',
      message = 'rollback refused: PR 1.8 data exists (deleted accounts, their audit rows or changed narrow-key values); this down script is valid only before any PR 1.8 data';
  end if;

  -- 1. The functions the migration replaced, restored to their earlier text (same ACL). Their
  --    bodies are copied byte for byte from the PR 1.3 and PR 1.4 migrations, so they are not
  --    indented.
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
        p_key <> 'usage' and exists (select 1 from public.permissions k where k.key = p_key)
      when p.role in ('manager', 'customer_service') then
        coalesce((select rp.allowed from public.role_permissions rp
                  where rp.role = p.role and rp.permission_key = p_key), false)
      else false
    end
    from public.profiles p
    where p.id = auth.uid() and p.is_active), false)
$$;
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
  perform private.write_audit('credentials.change_authorized', 'profiles', p_target_profile_id,
    jsonb_build_object('kind', p_kind));
end
$$;
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
  if p_role = 'creator' or (v_caller.role = 'manager' and p_role in ('customer_service', 'manager')) then
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
  if p_role = 'creator' or (v_caller.role = 'manager' and p_role <> 'technician') then
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
     or not ((v_request.request_type = 'direct_create' and v_request.requested_by = v_caller.id)
             or (v_request.request_type = 'create' and v_caller.role = 'creator'))
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
  if v_caller.role = 'manager' and p_active and not v_target.is_active and v_target.role = 'customer_service' then
    raise exception using errcode = '55000', message = 'requires the Creator''s approval';
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
  if not private.has_permission('settings') then
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
  if not private.has_permission('settings') then
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
  if not private.has_permission('settings') then
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
  if not private.has_permission('settings') then
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
  if not private.has_permission('settings') then
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

  -- 2. The request path back: the four functions are executable by authenticated again (GRANT ALL
  --    on a function is EXECUTE, its only privilege), their comments removed.
  grant all on function
    private.request_account_change(text, uuid, text, text, text),
    public.request_account_change(text, uuid, text, text, text),
    private.decide_account_request(uuid, text, integer, text),
    public.decide_account_request(uuid, text, integer, text)
  to authenticated;
  comment on function public.request_account_change(text, uuid, text, text, text) is null;
  comment on function public.decide_account_request(uuid, text, integer, text) is null;

  -- 3. The table and constraint comments back to their PR 1.3 and PR 1.4 text.
  comment on table public.profiles is
    'Accounts (D34). Role from this table only, never from Auth metadata. Written only through RPCs.';
  comment on table public.account_requests is
    'D34 a: Manager-initiated Customer Service creation, activation, reactivation and role changes (nothing changes while pending), and the audited phase-1 authorization of direct creations (direct_create, §8.5). Written only through RPCs; never deleted.';
  comment on table public.call_types is
    'Call types (D35, D48). Written only by private.add_call_type and private.set_call_type_active (key settings). Never deleted.';
  comment on table public.followup_reasons is
    'Continuation reasons (D35, D48, SE-07). Written only by private.add_followup_reason, private.set_followup_reason_active and private.delete_followup_reason (key settings). At least one stays active.';
  comment on constraint role_permissions_pending_decisions on public.role_permissions is null;

  -- 4. The deletion writer: the public wrapper, then the body.
  drop function public.admin_delete_user(uuid, integer, text);
  drop function private.admin_delete_user(uuid, integer, text);

  -- 5. The four triggers, then their three functions.
  drop trigger t12_deleted_guard on public.profiles;
  drop trigger t31_one_way_deleted on public.profiles;
  drop trigger t11_deleted_profile on public.technicians;
  drop trigger t05_requests_retired on public.account_requests;
  drop function private.tg_profile_deleted_guard();
  drop function private.tg_technician_deleted_guard();
  drop function private.tg_account_requests_retired();

  -- 6. profiles back to PR 1.3: the four deletion constraints, then the two columns (every value is
  --    NULL, step 0).
  alter table public.profiles
    drop constraint profiles_deleted_by_fkey,
    drop constraint profiles_deleted_check,
    drop constraint profiles_deleted_inactive_check,
    drop constraint profiles_deleted_self_check;
  alter table public.profiles
    drop column deleted_at,
    drop column deleted_by;

  -- 7. The narrow keys: their six values, then the three keys (the rows are never deleted
  --    otherwise: the reject-delete triggers are disabled only around these two deletes), then the
  --    two permissions CHECKs back to the 13 D33 keys (PR 1.3).
  alter table public.role_permissions disable trigger t95_reject_delete;
  delete from public.role_permissions where permission_key in ('reasons', 'callTypes', 'ackText');
  get diagnostics v_rows = row_count;
  alter table public.role_permissions enable trigger t95_reject_delete;
  if v_rows <> 6 then
    raise exception using errcode = '55000',
      message = 'rollback refused: the narrow-key values are not the six the migration inserted; nothing was dropped';
  end if;
  alter table public.permissions disable trigger t95_reject_delete;
  delete from public.permissions where key in ('reasons', 'callTypes', 'ackText');
  get diagnostics v_rows = row_count;
  alter table public.permissions enable trigger t95_reject_delete;
  if v_rows <> 3 then
    raise exception using errcode = '55000',
      message = 'rollback refused: the narrow keys are not the three the migration inserted; nothing was dropped';
  end if;
  alter table public.permissions
    drop constraint permissions_key_check,
    add constraint permissions_key_check check (key in (
      'cal', 'calls', 'card', 'cancel', 'dashGen', 'dashTech', 'dashProd', 'export', 'settings', 'usage',
      'products', 'conflicts', 'recordings')),
    drop constraint permissions_enforcement_by_key,
    add constraint permissions_enforcement_by_key check (
      (enforcement = 'data') = (key in ('calls', 'card', 'settings', 'products', 'conflicts', 'cancel', 'recordings')));

  -- 8. The audit action CHECK back to PR 1.6 (no row uses profile.deleted, step 0).
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
      'visit.corrected', 'review_item.resolved'));

  -- 9. The migration history (PR 1.3 review OPS-1): the CLI records the file's version; MCP
  --    apply_migration records a version the server assigns, with the name passed to it, which must
  --    be 'accounts_permissions'. Every row with either is removed (step 0 refused when none exists;
  --    the count is checked again here).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations
    where version = '20261108120000' or name = 'accounts_permissions';
    get diagnostics v_history_rows = row_count;
    if v_history_rows = 0 then
      raise exception using errcode = '55000',
        message = 'rollback refused: no migration history row with version 20261108120000 or name accounts_permissions; nothing was dropped';
    end if;
  end if;
end
$down$;
