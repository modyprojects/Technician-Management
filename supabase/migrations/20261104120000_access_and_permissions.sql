-- Step 1 / PR 1.3 — Migration 1: access and permissions.
--
-- Sources: docs/database-schema.md (§1, §2, §4 "Migration 1", §8, §9, "Explicitly prohibited"),
-- docs/security.md (§5, §8, §9), decisions D33, D34, D47, D49, D50, D51 and the PR 1.3 mandatory
-- security requirement in docs/ROADMAP.md.
--
-- Content: privilege hardening, the `private` schema, shared triggers, profiles, technicians, the
-- permission matrix (D33; values TEMPORARY, D51), account requests and creation intents (D34,
-- §8.5 two-phase creation), audit_logs with a hash chain, helpers, account and matrix RPCs,
-- test_data_census() and bootstrap_first_creator() (created, never run here, D49).
--
-- Data: schema plus the owner-approved D33 permission catalogue and its TEMPORARY default values
-- only (D47, D51). No test or fictitious rows.
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53) and,
-- before that, the owner's D50 Auth settings change.
--
-- Error codes raised by the functions:
--   42501 "not authorized" (generic, also for unknown targets)
--   22023 "invalid input"
--   55000 wrong state
--   PT409 version conflict (PostgREST answers HTTP 409)
--   23514 integrity rule

-- ---------------------------------------------------------------------------------------------
-- 0. Apply as postgres. The hardening below changes the default privileges of `postgres`, and
--    every object must be owned by `postgres`; any other role fails closed.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'apply this migration as postgres (current role: %)', current_user;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Hardening (PR 1.3 mandatory security requirement)
--    Revoke what exists now and Supabase's permissive default privileges for objects that
--    postgres creates. Kept for Supabase-managed components: USAGE on schema public for anon,
--    authenticated and service_role (PostgREST), everything in auth, storage, realtime, graphql,
--    graphql_public, extensions and vault, and the default privileges of supabase_admin (postgres
--    cannot change them; objects here are created by postgres, which tests/db/010 asserts).
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;
-- Global (cannot be set per schema): functions that postgres creates no longer get EXECUTE for
-- PUBLIC. Extension functions are owned by supabase_admin and keep their own defaults.
alter default privileges for role postgres
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- 2. The private schema: never exposed through the Data API (D50; supabase/config.toml lists
--    public and graphql_public only). authenticated needs USAGE because the SECURITY INVOKER
--    wrappers in public and the RLS policies call private functions.
-- ---------------------------------------------------------------------------------------------
create schema private;
comment on schema private is
  'Internal helpers, RPC bodies and trigger functions. Never exposed through the Data API (D50).';
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Tables. RLS on every table (no FORCE: the SECURITY DEFINER bodies run as the owner), every
--    foreign key ON DELETE RESTRICT, no DELETE for anyone (triggers), no direct writes for any
--    API role (no grants).
-- ---------------------------------------------------------------------------------------------

-- 3.1 profiles: one account per Auth user (role, name, work phone D40, invitation alias, active).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  role text not null
    constraint profiles_role_check check (role in ('technician', 'customer_service', 'manager', 'creator')),
  full_name text not null
    constraint profiles_full_name_check check (full_name = btrim(full_name) and char_length(full_name) between 1 and 60),
  work_phone text
    constraint profiles_work_phone_check check (work_phone ~ '^[0-9+ -]{3,20}$'),
  invitation_rep_name text
    constraint profiles_invitation_rep_name_key unique
    constraint profiles_invitation_rep_name_check
      check (invitation_rep_name = btrim(invitation_rep_name) and char_length(invitation_rep_name) between 1 and 60),
  is_active boolean not null default false,
  -- Set by the server; true for every new user until go-live (D47), except the first Creator (D49).
  -- The default fails safe.
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint profiles_version_check check (version >= 1),
  constraint profiles_id_is_test_key unique (id, is_test),
  -- No test Creator (docs/database-schema.md §2, §8.4 rule 9).
  constraint profiles_no_test_creator check (not (is_test and role = 'creator'))
);
comment on table public.profiles is
  'Accounts (D34). Role from this table only, never from Auth metadata. Written only through RPCs.';
alter table public.profiles enable row level security;

-- 3.2 technicians: field profile of a Technician account (SE-05).
create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null constraint technicians_profile_id_key unique,
  -- Equals the profile's marker (composite foreign key below).
  is_test boolean not null,
  display_name text not null
    constraint technicians_display_name_check check (display_name = btrim(display_name) and char_length(display_name) between 1 and 60),
  color text not null constraint technicians_color_check check (color ~ '^[a-z0-9-]{1,32}$'),
  outlook_email text not null
    constraint technicians_outlook_email_key unique
    constraint technicians_outlook_email_check check (
      outlook_email = lower(btrim(outlook_email))
      and char_length(outlook_email) <= 254
      and outlook_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  device_label text
    constraint technicians_device_label_check check (device_label = btrim(device_label) and char_length(device_label) between 1 and 40),
  -- SE-05 "פעיל": eligibility for new invitations only; never access (D36).
  accepts_invitations boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint technicians_version_check check (version >= 1),
  constraint technicians_profile_fk foreign key (profile_id, is_test)
    references public.profiles (id, is_test) on delete restrict,
  -- D47: a test user's Outlook email is in the reserved example.test domain.
  constraint technicians_test_outlook_email check (not is_test or outlook_email like '%@example.test')
);
comment on table public.technicians is
  'Technician field profile (SE-05). profile_id links only to a Technician profile. Written only through RPCs.';
alter table public.technicians enable row level security;

-- 3.3 permissions: the closed D33 key catalogue. Census exemption: configuration, no test variants.
create table public.permissions (
  key text primary key
    constraint permissions_key_check check (key in (
      'cal', 'calls', 'card', 'cancel', 'dashGen', 'dashTech', 'dashProd', 'export', 'settings', 'usage',
      'products', 'conflicts', 'recordings')),
  -- TEMPORARY labels (SE-02 visual approval pending for products, conflicts, recordings and card).
  label_he text not null
    constraint permissions_label_he_check check (label_he = btrim(label_he) and char_length(label_he) between 1 and 80),
  enforcement text not null constraint permissions_enforcement_check check (enforcement in ('data', 'screen')),
  sort_order smallint not null constraint permissions_sort_order_key unique
    constraint permissions_sort_order_check check (sort_order > 0),
  -- D33: data keys are enforced on the data; screen keys gate screens and server functions.
  constraint permissions_enforcement_by_key check (
    (enforcement = 'data') = (key in ('calls', 'card', 'settings', 'products', 'conflicts', 'cancel', 'recordings')))
);
comment on table public.permissions is
  'Closed D33 permission-key catalogue. Fixed capabilities are never keys. Census exemption: configuration.';
alter table public.permissions enable row level security;

-- 3.4 role_permissions: editable matrix values (D33) for Manager and Customer Service only.
create table public.role_permissions (
  role text not null constraint role_permissions_role_check check (role in ('manager', 'customer_service')),
  permission_key text not null references public.permissions (key) on delete restrict,
  -- A value that is missing or not set is denied (D51).
  allowed boolean not null default false,
  -- D51: temporary until the owner approves the final values in Step 10.
  value_status text not null default 'temporary'
    constraint role_permissions_value_status_check check (value_status in ('temporary', 'approved')),
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint role_permissions_version_check check (version >= 1),
  primary key (role, permission_key),
  constraint role_permissions_approval_check
    check ((value_status = 'approved') = (approved_by is not null and approved_at is not null)),
  -- TEMPORARY hard restrictions while open decisions are pending (D33, SE-04, OF-15):
  -- Customer Service `cancel` stays off until d08; `usage` stays off for every role until d13.
  constraint role_permissions_pending_decisions
    check (not (allowed and ((role = 'customer_service' and permission_key = 'cancel') or permission_key = 'usage')))
);
create index role_permissions_permission_key_idx on public.role_permissions (permission_key);
comment on table public.role_permissions is
  'Permission-matrix values (D33). Written only by admin_set_role_permission (Creator); admin_approve_role_permission has no grant until owner question Q6 is decided. Values TEMPORARY until approved (D51). Census exemption: configuration.';
alter table public.role_permissions enable row level security;

-- 3.5 account_requests: Manager-initiated Customer Service changes awaiting the Creator (D34 a),
--     and the audited phase-1 authorization of every direct account creation ('direct_create',
--     §8.5 two-phase creation; TEMPORARY design choice, owner question Q16).
create table public.account_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null
    constraint account_requests_request_type_check
      check (request_type in ('create', 'activate', 'reactivate', 'role_change', 'direct_create')),
  target_profile_id uuid,
  -- The target profile's version when the request was made; approval fails if it changed (stale).
  target_version integer constraint account_requests_target_version_check check (target_version >= 1),
  requested_role text
    constraint account_requests_requested_role_check check (requested_role in ('customer_service', 'technician', 'manager')),
  email text
    constraint account_requests_email_check check (
      email = lower(btrim(email)) and char_length(email) <= 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name text
    constraint account_requests_full_name_check check (full_name = btrim(full_name) and char_length(full_name) between 1 and 60),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    constraint account_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  rejection_reason text
    constraint account_requests_rejection_reason_check
      check (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 300),
  -- Set by the server: from the target, or true for a create (every new user is a test user
  -- until go-live, D47).
  is_test boolean not null,
  updated_at timestamptz not null default now(),
  version integer not null default 1 constraint account_requests_version_check check (version >= 1),
  constraint account_requests_target_fk foreign key (target_profile_id, is_test)
    references public.profiles (id, is_test) on delete restrict,
  constraint account_requests_shape_check check (
    case request_type
      -- A create has no target until the approved request is fulfilled (admin_create_profile).
      when 'create' then email is not null and full_name is not null and requested_role = 'customer_service'
                         and target_version is null and (target_profile_id is null or status = 'approved')
      -- Authorized by its own requester (a Creator, or a Manager for a Technician): never pending.
      when 'direct_create' then email is not null and full_name is not null and requested_role is not null
                                and status in ('approved', 'cancelled') and target_version is null
                                and (target_profile_id is null or status = 'approved')
      when 'role_change' then target_profile_id is not null and target_version is not null and email is null
                              and full_name is null and requested_role is not null
      else target_profile_id is not null and target_version is not null and email is null and full_name is null
           and requested_role is null
    end),
  -- A Manager never asks for the manager role (§8.4 rule 4): only the Creator's direct creation names it.
  constraint account_requests_manager_role_check check (requested_role is distinct from 'manager' or request_type = 'direct_create'),
  constraint account_requests_decision_check
    check ((status = 'pending') = (decided_by is null and decided_at is null)),
  constraint account_requests_rejection_check check ((status = 'rejected') = (rejection_reason is not null)),
  -- TEMPORARY (owner question Q12, docs/review/step1-pr13): a test request's sign-in email is in the reserved example.test
  -- domain, as for test users' Outlook emails (D47).
  constraint account_requests_test_email check (not is_test or email is null or email like '%@example.test')
);
create index account_requests_status_created_idx on public.account_requests (status, created_at desc);
create index account_requests_requested_by_idx on public.account_requests (requested_by, created_at desc);
create unique index account_requests_one_pending_per_target
  on public.account_requests (target_profile_id) where status = 'pending';
-- One open creation per email (pending, or approved and not yet fulfilled), so an in-flight
-- creation cannot be bound by anyone else.
create unique index account_requests_one_open_create_per_email
  on public.account_requests (email)
  where request_type in ('create', 'direct_create') and status in ('pending', 'approved') and target_profile_id is null;
comment on table public.account_requests is
  'D34 a: Manager-initiated Customer Service creation, activation, reactivation and role changes (nothing changes while pending), and the audited phase-1 authorization of direct creations (direct_create, §8.5). Written only through RPCs; never deleted.';
alter table public.account_requests enable row level security;

-- 3.6 audit_logs: append-only with a hash chain (docs/security.md §8).
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- NULL only for the owner's database role (bootstrap, D49): CHECK audit_logs_actor_check.
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  action text not null constraint audit_logs_action_check check (action in (
    'matrix.value_set', 'matrix.value_approved',
    'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
    'account_creation.authorized',
    'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
    'technician.created', 'technician.updated', 'technician.outlook_email_changed',
    'credentials.change_authorized', 'creator.bootstrapped')),
  target_table text not null
    constraint audit_logs_target_table_check check (target_table in ('profiles', 'technicians', 'account_requests', 'role_permissions')),
  target_id uuid,
  -- Derived from the target row by trigger (D47).
  target_is_test boolean not null,
  -- Minimal metadata: codes, field names and reasons; no emails and no customer data.
  details jsonb not null default '{}'::jsonb constraint audit_logs_details_check check (jsonb_typeof(details) = 'object'),
  prev_hash text not null constraint audit_logs_prev_hash_key unique
    constraint audit_logs_prev_hash_check check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null constraint audit_logs_row_hash_key unique
    constraint audit_logs_row_hash_check check (row_hash ~ '^[0-9a-f]{64}$'),
  -- role_permissions has a composite key: its rows are identified in details (role, key).
  constraint audit_logs_target_id_check check ((target_table = 'role_permissions') = (target_id is null)),
  constraint audit_logs_actor_check check ((actor_profile_id is null) = (action = 'creator.bootstrapped'))
);
create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at);
create index audit_logs_target_idx on public.audit_logs (target_table, target_id);
create index audit_logs_actor_idx on public.audit_logs (actor_profile_id);
comment on table public.audit_logs is
  'Append-only audit with a hash chain. Written only by private.write_audit in the same transaction as the action. UPDATE, DELETE and TRUNCATE are rejected for every role.';
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 4. Shared trigger functions (SECURITY INVOKER, empty search_path, no dynamic SQL, no grants:
--    EXECUTE is checked only when a trigger is created). Every writer is a SECURITY DEFINER body
--    owned by postgres, so the triggers read consistent data.
-- ---------------------------------------------------------------------------------------------
create function private.tg_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end
$$;

-- is_test, target_is_test and data_source never change after insert (D47), for every role.
create function private.tg_immutable_markers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
begin
  if (v_new -> 'is_test') is distinct from (v_old -> 'is_test')
     or (v_new -> 'target_is_test') is distinct from (v_old -> 'target_is_test')
     or (v_new -> 'data_source') is distinct from (v_old -> 'data_source') then
    raise exception using errcode = '55000', message = tg_table_name || ': test-data markers are immutable (D47)';
  end if;
  return new;
end
$$;

create function private.tg_reject_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = tg_table_name || ' is append-only';
end
$$;

create function private.tg_reject_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = tg_table_name || ': rows are never deleted';
end
$$;

create function private.tg_reject_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = tg_table_name || ' cannot be truncated';
end
$$;

-- One-way rule (D47): a real record never references a test profile. TG_ARGV lists the person
-- columns. A table without a marker (role_permissions) counts as real.
create function private.tg_one_way_people()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_column text;
  v_ref uuid;
begin
  if coalesce((v_row ->> 'is_test')::boolean, (v_row ->> 'target_is_test')::boolean, false) then
    return new;
  end if;
  foreach v_column in array tg_argv loop
    v_ref := (v_row ->> v_column)::uuid;
    if v_ref is not null and exists (select 1 from public.profiles p where p.id = v_ref and p.is_test) then
      raise exception using errcode = '23514',
        message = tg_table_name || ': a real record cannot reference a test profile (D47)';
    end if;
  end loop;
  return new;
end
$$;

-- profiles: immutable identity, no promotion to Creator, no role change while a technicians row
-- exists (§8.4 rule 5; rows are never deleted), last active Creator protected by a lock.
create function private.tg_profile_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception using errcode = '55000', message = 'profiles: id and creation fields are immutable';
  end if;
  if new.role <> old.role then
    if new.role = 'creator' then
      raise exception using errcode = '55000', message = 'profiles: no user is promoted to Creator (D49)';
    end if;
    if exists (select 1 from public.technicians t where t.profile_id = old.id) then
      raise exception using errcode = '55000', message = 'profiles: a profile with a technician record keeps its role';
    end if;
  end if;
  if old.role = 'creator' and old.is_active and (new.role <> 'creator' or not new.is_active) then
    perform pg_advisory_xact_lock(hashtextextended('tm.last_creator', 0));
    if not exists (
      select 1 from public.profiles p where p.role = 'creator' and p.is_active and p.id <> old.id
    ) then
      raise exception using errcode = '55000', message = 'profiles: the last active Creator cannot be demoted or deactivated';
    end if;
  end if;
  return new;
end
$$;

-- technicians: profile_id links only to a Technician profile (§8.4 rule 5); identity immutable.
-- The profile row is locked so a concurrent role change cannot slip through.
create function private.tg_technician_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.profile_id <> old.profile_id
                           or new.created_at <> old.created_at or new.created_by is distinct from old.created_by) then
    raise exception using errcode = '55000', message = 'technicians: id, profile and creation fields are immutable';
  end if;
  perform 1 from public.profiles p where p.id = new.profile_id and p.role = 'technician' for share;
  if not found then
    raise exception using errcode = '23514', message = 'technicians: the profile must have the technician role';
  end if;
  return new;
end
$$;

-- account_requests: only pending -> approved / rejected / cancelled; everything else is fixed,
-- except, for an approved create or direct_create that is not fulfilled yet, the one-time
-- fulfilment link (target_profile_id null -> value) or its cancellation (the decision fields keep
-- the original decider; the audit records who cancelled).
create function private.tg_account_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['status', 'decided_by', 'decided_at', 'rejection_reason', 'target_profile_id', 'version', 'updated_at'];
begin
  if (to_jsonb(new) - v_mutable) <> (to_jsonb(old) - v_mutable) then
    raise exception using errcode = '55000', message = 'account_requests: request fields are immutable';
  end if;
  if old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled')
     and new.target_profile_id is not distinct from old.target_profile_id then
    return new;
  end if;
  if old.status = 'approved' and old.request_type in ('create', 'direct_create') and old.target_profile_id is null
     and new.decided_by is not distinct from old.decided_by and new.decided_at is not distinct from old.decided_at
     and new.rejection_reason is null
     and ((new.status = 'approved' and new.target_profile_id is not null)
          or (new.status = 'cancelled' and new.target_profile_id is null)) then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'account_requests: invalid status change';
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Audit hash chain
-- ---------------------------------------------------------------------------------------------
create function private.audit_row_hash(
  p_prev_hash text, p_id bigint, p_occurred_at timestamptz, p_actor_profile_id uuid, p_action text,
  p_target_table text, p_target_id uuid, p_target_is_test boolean, p_details jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev_hash,
    p_id::text,
    to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor_profile_id::text, ''),
    p_action,
    p_target_table,
    coalesce(p_target_id::text, ''),
    p_target_is_test::text,
    p_details::text), 'UTF8')), 'hex')
$$;

-- BEFORE INSERT on audit_logs, first: server time and target_is_test from the target row (the
-- one-way check runs next and reads target_is_test).
create function private.tg_audit_target()
returns trigger
language plpgsql
set search_path = ''
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

-- BEFORE INSERT on audit_logs, last (S13): the chain link and the row hash, computed after every
-- other BEFORE INSERT trigger, so the hash covers the row exactly as stored.
create function private.tg_audit_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_id bigint;
  v_last_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('tm.audit_chain', 0));
  select a.id, a.row_hash into v_last_id, v_last_hash from public.audit_logs a order by a.id desc limit 1;
  if v_last_id is not null and new.id <= v_last_id then
    raise exception using errcode = '55000', message = 'audit_logs: ids must follow the chain';
  end if;
  new.prev_hash := coalesce(v_last_hash, repeat('0', 64));
  new.row_hash := private.audit_row_hash(new.prev_hash, new.id, new.occurred_at, new.actor_profile_id, new.action,
                                         new.target_table, new.target_id, new.target_is_test, new.details);
  return new;
end
$$;

-- The only writer of audit_logs; called by the RPC bodies in the same transaction as the action.
-- The lock is taken before the identity value is drawn, so ids follow the chain. No grants.
create function private.write_audit(p_action text, p_target_table text, p_target_id uuid, p_details jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('tm.audit_chain', 0));
  insert into public.audit_logs (actor_profile_id, action, target_table, target_id, details)
  values (auth.uid(), p_action, p_target_table, p_target_id, coalesce(jsonb_strip_nulls(p_details), '{}'::jsonb))
  returning id into v_id;
  return v_id;
end
$$;

-- Owner-only verification (docs/security.md §8): the id of the first broken row, or NULL.
-- Limitation (S3): the hash has no secret key, so someone with owner-level access who rewrites a
-- row and recomputes every later hash, or deletes the newest rows, leaves a chain that verifies.
-- Detection then needs an anchor recorded outside the database (the newest row's id and
-- row_hash, docs/review/step1-pr13 "Audit anchoring"): given one, the anchored row must still
-- exist with the same hash; otherwise its id is returned. Owner-level access can also replace
-- this function (re-review R-S4), so the authoritative anchor check is the self-contained query
-- kept in the repository (docs/review/step1-pr13/audit-anchor-check.sql), which calls nothing here.
create function private.audit_chain_verify(p_anchor_id bigint default null, p_anchor_row_hash text default null)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row record;
  v_prev text := repeat('0', 64);
begin
  if (p_anchor_id is null) <> (p_anchor_row_hash is null) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  for v_row in select a.* from public.audit_logs a order by a.id loop
    if v_row.prev_hash <> v_prev
       or v_row.row_hash <> private.audit_row_hash(v_prev, v_row.id, v_row.occurred_at, v_row.actor_profile_id,
                                                    v_row.action, v_row.target_table, v_row.target_id,
                                                    v_row.target_is_test, v_row.details) then
      return v_row.id;
    end if;
    v_prev := v_row.row_hash;
  end loop;
  if p_anchor_id is not null
     and not exists (select 1 from public.audit_logs a where a.id = p_anchor_id and a.row_hash = p_anchor_row_hash) then
    return p_anchor_id;
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Attach the triggers. Name prefixes fix the firing order (BEFORE triggers run by name).
-- ---------------------------------------------------------------------------------------------
create trigger t10_profile_guard before update on public.profiles
  for each row execute function private.tg_profile_guard();
create trigger t20_immutable_markers before update on public.profiles
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.profiles
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.profiles
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.profiles
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.profiles
  for each statement execute function private.tg_reject_truncate();

create trigger t10_technician_guard before insert or update on public.technicians
  for each row execute function private.tg_technician_guard();
create trigger t20_immutable_markers before update on public.technicians
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.technicians
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.technicians
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.technicians
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.technicians
  for each statement execute function private.tg_reject_truncate();

create trigger t95_reject_delete before delete on public.permissions
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.permissions
  for each statement execute function private.tg_reject_truncate();

create trigger t30_one_way before insert or update on public.role_permissions
  for each row execute function private.tg_one_way_people('updated_by', 'approved_by');
create trigger t90_bump_version before update on public.role_permissions
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.role_permissions
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.role_permissions
  for each statement execute function private.tg_reject_truncate();

create trigger t10_account_request_guard before update on public.account_requests
  for each row execute function private.tg_account_request_guard();
create trigger t20_immutable_markers before update on public.account_requests
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.account_requests
  for each row execute function private.tg_one_way_people('requested_by', 'decided_by');
create trigger t90_bump_version before update on public.account_requests
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.account_requests
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.account_requests
  for each statement execute function private.tg_reject_truncate();

create trigger t10_reject_update_delete before update or delete on public.audit_logs
  for each row execute function private.tg_reject_update_delete();
-- t20 derives target_is_test, which the one-way check (t30) reads; t90 hashes the final row last.
create trigger t20_audit_target before insert on public.audit_logs
  for each row execute function private.tg_audit_target();
create trigger t30_one_way before insert on public.audit_logs
  for each row execute function private.tg_one_way_people('actor_profile_id');
create trigger t90_audit_chain before insert on public.audit_logs
  for each row execute function private.tg_audit_chain();
create trigger t99_reject_truncate before truncate on public.audit_logs
  for each statement execute function private.tg_reject_truncate();

-- ---------------------------------------------------------------------------------------------
-- 7. Helpers for RLS and the app (§9): SECURITY DEFINER (a policy on profiles reads profiles),
--    return a boolean or the caller's own id, empty search_path, no dynamic SQL, in private,
--    owned by postgres. Every one requires an active profile.
-- ---------------------------------------------------------------------------------------------
create function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = p_role)
$$;

create function private.is_creator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'creator')
$$;

create function private.is_office_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('creator', 'manager', 'customer_service'))
$$;

-- D33: the Creator has every catalogue key, Manager and Customer Service follow the matrix (a
-- missing value is denied, D51), a Technician has none. TEMPORARY (owner question Q7): `usage` is
-- denied to the Creator too until open decision d13 (OF-15), as in the UI demo.
create function private.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
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

-- From the active Technician profile only; never from accepts_invitations (§9).
create function private.my_technician_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = auth.uid() and p.is_active and p.role = 'technician'
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Account and matrix RPC bodies (D33, D34; §8.4, §8.5). SECURITY DEFINER plpgsql in private,
--    every reference schema-qualified, no dynamic SQL. Each one checks the caller in profiles
--    (never in Auth metadata or the matrix) and writes its audit row in the same transaction.
--    The public wrappers (section 9) are SECURITY INVOKER, so every call runs under the caller's
--    own session first.
-- ---------------------------------------------------------------------------------------------

-- The caller's active profile, locked against a concurrent deactivation; 42501 otherwise.
-- Internal: called only from the SECURITY DEFINER bodies; no grants.
create function private.require_caller(p_roles text[])
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  v_caller public.profiles;
begin
  select p.* into v_caller from public.profiles p where p.id = auth.uid() and p.is_active for share;
  if not found or not (v_caller.role = any (p_roles)) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return v_caller;
end
$$;

-- 8.1 Matrix (D33, D51): Creator only, effective immediately, audited.
create function private.admin_set_role_permission(
  p_role text, p_key text, p_allowed boolean, p_expected_version integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_row public.role_permissions;
  v_reason text := nullif(btrim(p_reason), '');
  v_version integer;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_role is null or p_role not in ('manager', 'customer_service') or p_key is null or p_allowed is null
     or p_expected_version is null or char_length(v_reason) > 300 then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select rp.* into v_row from public.role_permissions rp
  where rp.role = p_role and rp.permission_key = p_key
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  -- TEMPORARY (D33, SE-04, OF-15): the same rule as the CHECK role_permissions_pending_decisions.
  if p_allowed and ((p_role = 'customer_service' and p_key = 'cancel') or p_key = 'usage') then
    raise exception using errcode = '55000', message = 'value locked until an open owner decision';
  end if;
  if v_row.allowed = p_allowed then
    return v_row.version;
  end if;
  -- Any change makes the value temporary again until the owner approves it (D51).
  update public.role_permissions rp
  set allowed = p_allowed, value_status = 'temporary', approved_by = null, approved_at = null, updated_by = v_caller.id
  where rp.role = p_role and rp.permission_key = p_key
  returning rp.version into v_version;
  perform private.write_audit('matrix.value_set', 'role_permissions', null,
    jsonb_build_object('role', p_role, 'key', p_key, 'from', v_row.allowed, 'to', p_allowed, 'reason', v_reason));
  return v_version;
end
$$;

-- D51: the owner (the Creator) marks a value approved; any later change resets it to temporary.
-- TEMPORARY (owner question Q6, deny by default): §4 says role_permissions is written only by
-- admin_set_role_permission and D51 places the approval of the final values in Step 10, so no API
-- role may execute this function (no grant, section 13) until the owner decides who approves and
-- when. Only the owner's database role can run it until then.
create function private.admin_approve_role_permission(p_role text, p_key text, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_row public.role_permissions;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_role is null or p_key is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select rp.* into v_row from public.role_permissions rp
  where rp.role = p_role and rp.permission_key = p_key
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_row.value_status = 'approved' then
    raise exception using errcode = '55000', message = 'value already approved';
  end if;
  update public.role_permissions rp
  set value_status = 'approved', approved_by = v_caller.id, approved_at = now(), updated_by = v_caller.id
  where rp.role = p_role and rp.permission_key = p_key
  returning rp.version into v_version;
  perform private.write_audit('matrix.value_approved', 'role_permissions', null,
    jsonb_build_object('role', p_role, 'key', p_key, 'allowed', v_row.allowed));
  return v_version;
end
$$;

-- 8.2 Checks (§8.5). assert_can_manage: the Creator manages every role, a Manager only
-- Technician and Customer Service accounts (D34). A read-only pre-check (no audit row): the
-- audited phase 1 of a creation is authorize_account_creation or an approved request (8.3).
create function private.assert_can_manage(p_target_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_target_role is null or p_target_role not in ('technician', 'customer_service', 'manager', 'creator') then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if v_caller.role = 'manager' and p_target_role not in ('technician', 'customer_service') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
end
$$;

-- Runs before any Auth Admin call that sets a password or changes an email: Creator only (D34 e).
create function private.assert_can_change_credentials(p_target_profile_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
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

-- 8.3 Profiles: two-phase creation (§8.5, security.md §5, D34).
-- Phase 1, before any Auth Admin call, under the caller's own session: the D34 rules and the audit.
--   - Manager-initiated Customer Service creation: request_account_change('create'), then the
--     Creator's approval (decide_account_request).
--   - Every direct creation (a Manager's Technician; the Creator's Technician, Customer Service or
--     Manager): authorize_account_creation, which stores an approved 'direct_create' intent and
--     audits it. TEMPORARY design choice (owner question Q16): the intent reuses account_requests.
-- Phase 2: the Step 2 server creates the Auth user with the secret key (never a profile), with
--   app_metadata.account_request_id set to the intent id (the binding nonce, re-review R-S1).
-- Phase 3: admin_create_profile binds that Auth user to the intent, under the caller's session.

-- D34: a Manager creates Technicians directly (Customer Service only through a request); the
-- Creator creates Technicians, Customer Service and Managers. D49, TEMPORARY until go-live
-- (owner question Q11): nothing creates a Creator.
create function private.authorize_account_creation(p_role text, p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
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

-- Phase 3. The Auth user must match an open intent: an approved 'direct_create' of the same
-- caller, or an approved Customer Service 'create' request completed by the Creator (owner
-- question Q14); same role and email. Re-review R-S1: the binding is a nonce, not a clock window.
-- The Step 2 server creates the Auth user with app_metadata.account_request_id = the intent id
-- (as phase 1 returned it); only the secret key can write app_metadata, so an Auth user made by
-- any other path (sign-up, another intent, a cancelled intent) never carries it. In addition the
-- Auth user must be created after the authorization (no clock tolerance: a false refusal fails
-- closed and the intent is cancelled and authorized again), and must not be anonymous, SSO or
-- deleted. Every binding failure returns the same error (S5, S12). Never through service_role.
create function private.admin_create_profile(
  p_user_id uuid, p_role text, p_full_name text, p_work_phone text default null,
  p_invitation_rep_name text default null, p_request_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
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

-- Role changes: Creator only (a Manager's change of a Customer Service role is a request, D34 a).
create function private.admin_set_user_role(
  p_profile_id uuid, p_new_role text, p_expected_version integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_reason text := nullif(btrim(p_reason), '');
  v_version integer;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test or p_new_role = 'creator' or p_profile_id = v_caller.id then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_profile_id is null or p_new_role is null or p_new_role not in ('technician', 'customer_service', 'manager')
     or p_expected_version is null or char_length(v_reason) > 300 then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.role = p_new_role then
    return v_target.version;
  end if;
  update public.profiles p set role = p_new_role, updated_by = v_caller.id
  where p.id = p_profile_id
  returning p.version into v_version;
  perform private.write_audit('profile.role_changed', 'profiles', p_profile_id,
    jsonb_build_object('from', v_target.role, 'to', p_new_role, 'reason', v_reason));
  return v_version;
end
$$;

-- Activation and deactivation (D34 b, c): a Manager deactivates Customer Service and Technician
-- accounts immediately (audited; the Creator's notice in Step 2 reads these rows) and activates
-- Technicians immediately; a Customer Service activation by a Manager needs a request. Nobody
-- changes his own state.
create function private.admin_set_user_active(
  p_profile_id uuid, p_active boolean, p_expected_version integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
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

-- Routine profile updates (D34 d): name, work phone, invitation alias. Never the email.
create function private.admin_update_profile(
  p_profile_id uuid, p_expected_version integer, p_full_name text, p_work_phone text, p_invitation_rep_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_name text := btrim(p_full_name);
  v_phone text := nullif(btrim(p_work_phone), '');
  v_alias text := nullif(btrim(p_invitation_rep_name), '');
  v_fields text[] := array[]::text[];
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_profile_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found or (v_caller.is_test and not v_target.is_test)
     or (v_caller.role = 'manager' and (v_target.role not in ('technician', 'customer_service') or v_target.id = v_caller.id)) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_name is distinct from v_target.full_name then v_fields := array_append(v_fields, 'full_name'); end if;
  if v_phone is distinct from v_target.work_phone then v_fields := array_append(v_fields, 'work_phone'); end if;
  if v_alias is distinct from v_target.invitation_rep_name then v_fields := array_append(v_fields, 'invitation_rep_name'); end if;
  if cardinality(v_fields) = 0 then
    return v_target.version;
  end if;
  begin
    update public.profiles p
    set full_name = v_name, work_phone = v_phone, invitation_rep_name = v_alias, updated_by = v_caller.id
    where p.id = p_profile_id
    returning p.version into v_version;
  exception when unique_violation then
    -- S12: no detail, so the aliases of accounts the caller cannot read are not revealed.
    raise exception using errcode = '23505', message = 'the value is already in use';
  end;
  perform private.write_audit('profile.updated', 'profiles', p_profile_id, jsonb_build_object('fields', to_jsonb(v_fields)));
  return v_version;
end
$$;

-- 8.4 Technician field profiles (§8.3: written by Manager and Creator).
create function private.admin_create_technician(
  p_profile_id uuid, p_display_name text, p_color text, p_outlook_email text,
  p_device_label text default null, p_accepts_invitations boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_id uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_profile_id is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select p.* into v_target from public.profiles p where p.id = p_profile_id for share;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.role <> 'technician' then
    raise exception using errcode = '55000', message = 'the profile is not a Technician';
  end if;
  if exists (select 1 from public.technicians t where t.profile_id = p_profile_id) then
    raise exception using errcode = '55000', message = 'the Technician already has a field profile';
  end if;
  insert into public.technicians (profile_id, is_test, display_name, color, outlook_email, device_label,
                                  accepts_invitations, created_by, updated_by)
  values (p_profile_id, v_target.is_test, btrim(p_display_name), p_color, lower(btrim(p_outlook_email)),
          nullif(btrim(p_device_label), ''), coalesce(p_accepts_invitations, true), v_caller.id, v_caller.id)
  returning id into v_id;
  perform private.write_audit('technician.created', 'technicians', v_id, jsonb_build_object('profile_id', p_profile_id));
  return v_id;
end
$$;

-- Every Outlook-email change is audited separately for the Creator's notice (D34 f).
create function private.admin_update_technician(
  p_technician_id uuid, p_expected_version integer, p_display_name text, p_color text, p_outlook_email text,
  p_device_label text, p_accepts_invitations boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_target public.technicians;
  v_name text := btrim(p_display_name);
  v_email text := lower(btrim(p_outlook_email));
  v_device text := nullif(btrim(p_device_label), '');
  v_fields text[] := array[]::text[];
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager']);
  if p_technician_id is null or p_expected_version is null or p_accepts_invitations is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select t.* into v_target from public.technicians t where t.id = p_technician_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_name is distinct from v_target.display_name then v_fields := array_append(v_fields, 'display_name'); end if;
  if p_color is distinct from v_target.color then v_fields := array_append(v_fields, 'color'); end if;
  if v_email is distinct from v_target.outlook_email then v_fields := array_append(v_fields, 'outlook_email'); end if;
  if v_device is distinct from v_target.device_label then v_fields := array_append(v_fields, 'device_label'); end if;
  if p_accepts_invitations is distinct from v_target.accepts_invitations then
    v_fields := array_append(v_fields, 'accepts_invitations');
  end if;
  if cardinality(v_fields) = 0 then
    return v_target.version;
  end if;
  update public.technicians t
  set display_name = v_name, color = p_color, outlook_email = v_email, device_label = v_device,
      accepts_invitations = p_accepts_invitations, updated_by = v_caller.id
  where t.id = p_technician_id
  returning t.version into v_version;
  perform private.write_audit('technician.updated', 'technicians', p_technician_id, jsonb_build_object('fields', to_jsonb(v_fields)));
  if 'outlook_email' = any (v_fields) then
    perform private.write_audit('technician.outlook_email_changed', 'technicians', p_technician_id, '{}'::jsonb);
  end if;
  return v_version;
end
$$;

-- 8.5 Account requests (D34 a): a Manager asks; nothing changes while pending.
create function private.request_account_change(
  p_request_type text, p_target_profile_id uuid default null, p_requested_role text default null,
  p_email text default null, p_full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_target public.profiles;
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_full_name);
  v_id uuid;
begin
  v_caller := private.require_caller(array['manager']);
  -- A Manager never grants manager or creator (§8.4 rule 4).
  if p_requested_role in ('manager', 'creator') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_request_type is null or p_request_type not in ('create', 'activate', 'reactivate', 'role_change') then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if p_request_type = 'create' then
    if p_target_profile_id is not null or coalesce(p_requested_role, 'customer_service') <> 'customer_service'
       or coalesce(v_email, '') = '' or coalesce(v_name, '') = '' then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
    if exists (select 1 from public.account_requests r
               where r.email = v_email and r.request_type in ('create', 'direct_create')
                 and r.status in ('pending', 'approved') and r.target_profile_id is null) then
      raise exception using errcode = '55000', message = 'an open request exists';
    end if;
    -- TEMPORARY until go-live (D47): every new user is a test user.
    insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
    values ('create', 'customer_service', v_email, v_name, v_caller.id, true)
    returning id into v_id;
  else
    if p_target_profile_id is null or p_email is not null or p_full_name is not null then
      raise exception using errcode = '22023', message = 'invalid input';
    end if;
    select p.* into v_target from public.profiles p where p.id = p_target_profile_id for update;
    if not found or v_target.role not in ('technician', 'customer_service')
       or (v_caller.is_test and not v_target.is_test) then
      raise exception using errcode = '42501', message = 'not authorized';
    end if;
    if p_request_type in ('activate', 'reactivate') then
      if p_requested_role is not null then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      -- A Technician is activated immediately (D34 c), not through a request.
      if v_target.role <> 'customer_service' or v_target.is_active then
        raise exception using errcode = '55000', message = 'the request does not apply';
      end if;
    else
      if p_requested_role is null then
        raise exception using errcode = '22023', message = 'invalid input';
      end if;
      if p_requested_role = v_target.role
         or exists (select 1 from public.technicians t where t.profile_id = v_target.id) then
        raise exception using errcode = '55000', message = 'the request does not apply';
      end if;
    end if;
    if exists (select 1 from public.account_requests r where r.target_profile_id = v_target.id and r.status = 'pending') then
      raise exception using errcode = '55000', message = 'a pending request exists';
    end if;
    insert into public.account_requests (request_type, target_profile_id, target_version, requested_role, requested_by, is_test)
    values (p_request_type, v_target.id, v_target.version, p_requested_role, v_caller.id, v_target.is_test)
    returning id into v_id;
  end if;
  perform private.write_audit('account_request.created', 'account_requests', v_id,
    jsonb_build_object('request_type', p_request_type, 'requested_role',
                       case when p_request_type = 'create' then 'customer_service' else p_requested_role end));
  return v_id;
end
$$;

-- The Creator decides (D34 a); the target's current state is checked again. An approved create
-- changes nothing yet: the Auth user is created in Step 2, then linked by admin_create_profile.
-- S6, TEMPORARY deny by default (owner question Q17): an approval fails ("no longer applies")
-- when the target profile changed after the request (its version differs, for example the
-- Creator acted on the account directly) or the requester is no longer an active Manager; the
-- Creator can still reject it or act directly.
create function private.decide_account_request(
  p_request_id uuid, p_decision text, p_expected_version integer, p_rejection_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_request public.account_requests;
  v_target public.profiles;
  v_reason text := nullif(btrim(p_rejection_reason), '');
  v_version integer;
begin
  v_caller := private.require_caller(array['creator']);
  if v_caller.is_test then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approve', 'reject') or p_expected_version is null
     or (p_decision = 'reject' and (v_reason is null or char_length(v_reason) > 300)) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select r.* into v_request from public.account_requests r where r.id = p_request_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if v_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'the request is not pending';
  end if;
  if v_request.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if p_decision = 'reject' then
    update public.account_requests r
    set status = 'rejected', decided_by = v_caller.id, decided_at = now(), rejection_reason = v_reason
    where r.id = p_request_id
    returning r.version into v_version;
    perform private.write_audit('account_request.rejected', 'account_requests', p_request_id,
      jsonb_build_object('request_type', v_request.request_type));
    return v_version;
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = v_request.requested_by and p.is_active and p.role = 'manager') then
    raise exception using errcode = '55000', message = 'the request no longer applies';
  end if;
  if v_request.request_type <> 'create' then
    select p.* into v_target from public.profiles p where p.id = v_request.target_profile_id for update;
    if v_target.version <> v_request.target_version then
      raise exception using errcode = '55000', message = 'the request no longer applies';
    end if;
    if v_request.request_type in ('activate', 'reactivate') then
      if v_target.role <> 'customer_service' or v_target.is_active then
        raise exception using errcode = '55000', message = 'the request no longer applies';
      end if;
      update public.profiles p set is_active = true, updated_by = v_caller.id where p.id = v_target.id;
      perform private.write_audit('profile.activated', 'profiles', v_target.id,
        jsonb_build_object('actor_role', v_caller.role, 'request_id', p_request_id));
    else
      if v_target.role not in ('technician', 'customer_service') or v_target.role = v_request.requested_role then
        raise exception using errcode = '55000', message = 'the request no longer applies';
      end if;
      update public.profiles p set role = v_request.requested_role, updated_by = v_caller.id where p.id = v_target.id;
      perform private.write_audit('profile.role_changed', 'profiles', v_target.id,
        jsonb_build_object('from', v_target.role, 'to', v_request.requested_role, 'request_id', p_request_id));
    end if;
  end if;
  update public.account_requests r
  set status = 'approved', decided_by = v_caller.id, decided_at = now()
  where r.id = p_request_id
  returning r.version into v_version;
  perform private.write_audit('account_request.approved', 'account_requests', p_request_id,
    jsonb_build_object('request_type', v_request.request_type));
  return v_version;
end
$$;

-- The requester cancels his own pending request. An approved creation that is not fulfilled yet
-- (no profile was bound to it) can be cancelled by its requester or by the Creator, so an Auth
-- creation that failed never blocks the email for good (one open creation per email). TEMPORARY
-- (owner question Q16).
create function private.cancel_account_request(p_request_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.profiles;
  v_request public.account_requests;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service', 'technician']);
  if p_request_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select r.* into v_request from public.account_requests r where r.id = p_request_id for update;
  if not found or (v_request.requested_by <> v_caller.id
                   and not (v_caller.role = 'creator' and not v_caller.is_test and v_request.status = 'approved')) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if not (v_request.status = 'pending'
          or (v_request.status = 'approved' and v_request.request_type in ('create', 'direct_create')
              and v_request.target_profile_id is null)) then
    raise exception using errcode = '55000', message = 'the request cannot be cancelled';
  end if;
  if v_request.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_request.status = 'pending' then
    update public.account_requests r
    set status = 'cancelled', decided_by = v_caller.id, decided_at = now()
    where r.id = p_request_id
    returning r.version into v_version;
  else
    update public.account_requests r set status = 'cancelled'
    where r.id = p_request_id
    returning r.version into v_version;
  end if;
  perform private.write_audit('account_request.cancelled', 'account_requests', p_request_id,
    jsonb_build_object('request_type', v_request.request_type, 'from_status', v_request.status));
  return v_version;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. Public API: thin SECURITY INVOKER wrappers (docs/security.md §5), so every call runs under
--    the caller's own session first. Same names and arguments as the bodies.
-- ---------------------------------------------------------------------------------------------
create function public.has_permission(p_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.has_permission(p_key) $$;

create function public.is_creator()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_creator() $$;

create function public.my_technician_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$ select private.my_technician_id() $$;

create function public.admin_set_role_permission(
  p_role text, p_key text, p_allowed boolean, p_expected_version integer, p_reason text default null)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_set_role_permission(p_role, p_key, p_allowed, p_expected_version, p_reason) $$;

create function public.admin_approve_role_permission(p_role text, p_key text, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_approve_role_permission(p_role, p_key, p_expected_version) $$;

create function public.assert_can_manage(p_target_role text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.assert_can_manage(p_target_role) $$;

create function public.assert_can_change_credentials(p_target_profile_id uuid, p_kind text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.assert_can_change_credentials(p_target_profile_id, p_kind) $$;

create function public.authorize_account_creation(p_role text, p_email text, p_full_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.authorize_account_creation(p_role, p_email, p_full_name) $$;

create function public.admin_create_profile(
  p_user_id uuid, p_role text, p_full_name text, p_work_phone text default null,
  p_invitation_rep_name text default null, p_request_id uuid default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.admin_create_profile(p_user_id, p_role, p_full_name, p_work_phone, p_invitation_rep_name, p_request_id) $$;

create function public.admin_set_user_role(
  p_profile_id uuid, p_new_role text, p_expected_version integer, p_reason text default null)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_set_user_role(p_profile_id, p_new_role, p_expected_version, p_reason) $$;

create function public.admin_set_user_active(
  p_profile_id uuid, p_active boolean, p_expected_version integer, p_reason text default null)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_set_user_active(p_profile_id, p_active, p_expected_version, p_reason) $$;

create function public.admin_update_profile(
  p_profile_id uuid, p_expected_version integer, p_full_name text, p_work_phone text, p_invitation_rep_name text)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_update_profile(p_profile_id, p_expected_version, p_full_name, p_work_phone, p_invitation_rep_name) $$;

create function public.admin_create_technician(
  p_profile_id uuid, p_display_name text, p_color text, p_outlook_email text,
  p_device_label text default null, p_accepts_invitations boolean default true)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.admin_create_technician(p_profile_id, p_display_name, p_color, p_outlook_email, p_device_label, p_accepts_invitations) $$;

create function public.admin_update_technician(
  p_technician_id uuid, p_expected_version integer, p_display_name text, p_color text, p_outlook_email text,
  p_device_label text, p_accepts_invitations boolean)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.admin_update_technician(p_technician_id, p_expected_version, p_display_name, p_color, p_outlook_email, p_device_label, p_accepts_invitations) $$;

create function public.request_account_change(
  p_request_type text, p_target_profile_id uuid default null, p_requested_role text default null,
  p_email text default null, p_full_name text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_account_change(p_request_type, p_target_profile_id, p_requested_role, p_email, p_full_name) $$;

create function public.decide_account_request(
  p_request_id uuid, p_decision text, p_expected_version integer, p_rejection_reason text default null)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.decide_account_request(p_request_id, p_decision, p_expected_version, p_rejection_reason) $$;

create function public.cancel_account_request(p_request_id uuid, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.cancel_account_request(p_request_id, p_expected_version) $$;

-- ---------------------------------------------------------------------------------------------
-- 10. Test-data census (D47, §2). SECURITY INVOKER: the Creator sees every row through RLS; the
--     owner's database role (no JWT) bypasses RLS. Everyone else: 42501. The list of tables and
--     buckets it covers is part of the result; tests/db/070 compares it with the catalogue.
-- ---------------------------------------------------------------------------------------------
create function public.test_data_census()
returns table (table_name text, marker text, bucket text, test_rows bigint)
language plpgsql
stable
security invoker
set search_path = ''
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

-- ---------------------------------------------------------------------------------------------
-- 11. First Creator (D49). Created here, NEVER run by a migration. It runs once in Step 2, only
--     with the owner's separate explicit approval and only by the owner's database role (no JWT).
-- ---------------------------------------------------------------------------------------------
create function private.bootstrap_first_creator(p_user_id uuid, p_full_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     or nullif(current_setting('request.jwt.claim.sub', true), '') is not null
     or current_user in ('authenticated', 'anon', 'service_role') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  lock table public.profiles in share row exclusive mode;
  if exists (select 1 from public.profiles p where p.role = 'creator') then
    raise exception using errcode = '55000', message = 'a Creator already exists';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception using errcode = '22023', message = 'unknown user';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '55000', message = 'the user already has a profile';
  end if;
  insert into public.profiles (id, role, full_name, is_active, is_test)
  values (p_user_id, 'creator', btrim(p_full_name), true, false);
  perform private.write_audit('creator.bootstrapped', 'profiles', p_user_id, '{}'::jsonb);
  return p_user_id;
end
$$;
comment on function private.bootstrap_first_creator(uuid, text) is
  'D49: run once in Step 2, only with the owner''s separate explicit approval, by the owner''s database role. Never called by a migration.';

-- ---------------------------------------------------------------------------------------------
-- 12. RLS policies: SELECT only, TO authenticated only, every one requires an active profile
--     (through the helpers). No INSERT, UPDATE or DELETE policies and no anon policies.
-- ---------------------------------------------------------------------------------------------
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()));
create policy profiles_select_creator on public.profiles for select to authenticated
  using ((select private.is_creator()));
create policy profiles_select_manager on public.profiles for select to authenticated
  using ((select private.has_role('manager')) and role in ('technician', 'customer_service'));

create policy technicians_select_own on public.technicians for select to authenticated
  using (id = (select private.my_technician_id()));
create policy technicians_select_office on public.technicians for select to authenticated
  using ((select private.is_creator()) or (select private.has_role('manager'))
         or (select private.has_permission('cal')) or (select private.has_permission('calls')));

create policy permissions_select_office on public.permissions for select to authenticated
  using ((select private.is_office_user()));

-- Manager and Customer Service read the values of their own role only (owner question Q8).
create policy role_permissions_select_creator on public.role_permissions for select to authenticated
  using ((select private.is_creator()));
create policy role_permissions_select_own_role on public.role_permissions for select to authenticated
  using ((role = 'manager' and (select private.has_role('manager')))
         or (role = 'customer_service' and (select private.has_role('customer_service'))));

create policy account_requests_select_creator on public.account_requests for select to authenticated
  using ((select private.is_creator()));
create policy account_requests_select_requester on public.account_requests for select to authenticated
  using (requested_by = (select auth.uid()) and (select private.has_role('manager')));

-- Manager (owner question Q8): his own actions and the accounts he manages (Technician and
-- Customer Service profiles, technician records, his own requests); never matrix rows. The
-- profile rule follows the target's current role, so it includes that account's earlier rows.
-- Columns are qualified with audit_logs (S8), so a later column in profiles or account_requests
-- cannot change what the policy means.
create policy audit_logs_select_creator on public.audit_logs for select to authenticated
  using ((select private.is_creator()));
create policy audit_logs_select_manager on public.audit_logs for select to authenticated
  using (
    (select private.has_role('manager'))
    and audit_logs.target_table <> 'role_permissions'
    and (
      audit_logs.actor_profile_id = (select auth.uid())
      or (audit_logs.target_table = 'profiles' and exists (
            select 1 from public.profiles p
            where p.id = audit_logs.target_id and p.role in ('technician', 'customer_service')))
      or audit_logs.target_table = 'technicians'
      or (audit_logs.target_table = 'account_requests' and exists (
            select 1 from public.account_requests r
            where r.id = audit_logs.target_id and r.requested_by = (select auth.uid())))
    ));

-- ---------------------------------------------------------------------------------------------
-- 13. Grants: revoke everything again (whatever created the objects), then grant explicitly and
--     minimally. Tables: SELECT for authenticated, nothing else for anyone. Sequences: none.
--     Functions: EXECUTE for authenticated on the public API and the private helpers and bodies
--     it calls; never on write_audit, require_caller, the trigger and hash functions,
--     audit_chain_verify, bootstrap_first_creator or (TEMPORARY, Q6) admin_approve_role_permission.
--     Nothing for anon or service_role.
--     The SECURITY DEFINER admin bodies return row versions and created ids, not only booleans:
--     §9 allows admin bodies in private behind SECURITY INVOKER wrappers. authenticated must hold
--     EXECUTE on the private bodies too, so the wrappers are not a security boundary; every body
--     checks its caller itself (require_caller). Reported as a doc deviation (S11).
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public, private from public, anon, authenticated, service_role;
revoke all on all sequences in schema public, private from public, anon, authenticated, service_role;
revoke all on all functions in schema public, private from public, anon, authenticated, service_role;

grant select on public.profiles, public.technicians, public.permissions, public.role_permissions,
  public.account_requests, public.audit_logs to authenticated;

grant execute on function
  private.is_active_user(),
  private.has_role(text),
  private.is_creator(),
  private.is_office_user(),
  private.has_permission(text),
  private.my_technician_id(),
  private.admin_set_role_permission(text, text, boolean, integer, text),
  private.assert_can_manage(text),
  private.assert_can_change_credentials(uuid, text),
  private.authorize_account_creation(text, text, text),
  private.admin_create_profile(uuid, text, text, text, text, uuid),
  private.admin_set_user_role(uuid, text, integer, text),
  private.admin_set_user_active(uuid, boolean, integer, text),
  private.admin_update_profile(uuid, integer, text, text, text),
  private.admin_create_technician(uuid, text, text, text, text, boolean),
  private.admin_update_technician(uuid, integer, text, text, text, text, boolean),
  private.request_account_change(text, uuid, text, text, text),
  private.decide_account_request(uuid, text, integer, text),
  private.cancel_account_request(uuid, integer),
  public.has_permission(text),
  public.is_creator(),
  public.my_technician_id(),
  public.admin_set_role_permission(text, text, boolean, integer, text),
  public.assert_can_manage(text),
  public.assert_can_change_credentials(uuid, text),
  public.authorize_account_creation(text, text, text),
  public.admin_create_profile(uuid, text, text, text, text, uuid),
  public.admin_set_user_role(uuid, text, integer, text),
  public.admin_set_user_active(uuid, boolean, integer, text),
  public.admin_update_profile(uuid, integer, text, text, text),
  public.admin_create_technician(uuid, text, text, text, text, boolean),
  public.admin_update_technician(uuid, integer, text, text, text, text, boolean),
  public.request_account_change(text, uuid, text, text, text),
  public.decide_account_request(uuid, text, integer, text),
  public.cancel_account_request(uuid, integer),
  public.test_data_census()
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 14. Owner-approved reference data (D33): the closed key catalogue and the default values.
--     TEMPORARY (D51): every value has value_status 'temporary'; the owner approves the final
--     Manager and Customer Service values in Step 10 (pre-pilot gate). Labels: the demo's PERMS,
--     `card` without recordings (D37) and the new labels of products, conflicts and recordings,
--     TEMPORARY until the SE-02 visual approval.
-- ---------------------------------------------------------------------------------------------
insert into public.permissions (key, label_he, enforcement, sort_order) values
  ('cal', 'יומן טכנאים', 'screen', 1),
  ('calls', 'קריאות – צפייה וחיפוש', 'data', 2),
  ('card', 'כרטיס קריאה – תמונות, חתימה', 'data', 3),
  ('cancel', 'ביטול קריאה', 'data', 4),
  ('dashGen', 'דשבורד · כללי', 'screen', 5),
  ('dashTech', 'דשבורד · טכנאים', 'screen', 6),
  ('dashProd', 'דשבורד · מוצרים וספקים', 'screen', 7),
  ('export', 'ייצוא ל-Excel', 'screen', 8),
  ('settings', 'הגדרות', 'data', 9),
  ('usage', 'מדדי שימוש', 'screen', 10),
  ('products', 'עריכת מוצרים', 'data', 11),
  ('conflicts', 'טיפול בפריטים לבדיקה', 'data', 12),
  ('recordings', 'הקלטות מקוריות', 'data', 13);

-- D33 defaults. Manager: every key except settings and usage. Customer Service: cal, calls and
-- card only (cancel off until d08, usage off until d13).
insert into public.role_permissions (role, permission_key, allowed, value_status) values
  ('manager', 'cal', true, 'temporary'),
  ('manager', 'calls', true, 'temporary'),
  ('manager', 'card', true, 'temporary'),
  ('manager', 'cancel', true, 'temporary'),
  ('manager', 'dashGen', true, 'temporary'),
  ('manager', 'dashTech', true, 'temporary'),
  ('manager', 'dashProd', true, 'temporary'),
  ('manager', 'export', true, 'temporary'),
  ('manager', 'settings', false, 'temporary'),
  ('manager', 'usage', false, 'temporary'),
  ('manager', 'products', true, 'temporary'),
  ('manager', 'conflicts', true, 'temporary'),
  ('manager', 'recordings', true, 'temporary'),
  ('customer_service', 'cal', true, 'temporary'),
  ('customer_service', 'calls', true, 'temporary'),
  ('customer_service', 'card', true, 'temporary'),
  ('customer_service', 'cancel', false, 'temporary'),
  ('customer_service', 'dashGen', false, 'temporary'),
  ('customer_service', 'dashTech', false, 'temporary'),
  ('customer_service', 'dashProd', false, 'temporary'),
  ('customer_service', 'export', false, 'temporary'),
  ('customer_service', 'settings', false, 'temporary'),
  ('customer_service', 'usage', false, 'temporary'),
  ('customer_service', 'products', false, 'temporary'),
  ('customer_service', 'conflicts', false, 'temporary'),
  ('customer_service', 'recordings', false, 'temporary');
