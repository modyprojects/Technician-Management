-- Step 4 (Version 1) — Migration 7: the technician's field writers and visit media.
--
-- Sources: docs/database-schema.md (§1, §3 "Storage", §4 "Step 4", §6, §8.3, §9), docs/security.md
-- (§5, §6, §7), decisions D06, D12, D13, D14, D36, D38, D43, D44, D45, D46, D47, D60 (1), (2),
-- docs/demo-deviations.md (TE-02, TE-13, TE-14, TE-18 to TE-23, OF-06, SIM-19), QA corrections 01
-- (T-02, T-03, T-09), the Migration 3 hand-off ("the writers arrive with Step 4: field closure,
-- times, summary, signature") and the Migration 4 helpers (offline_operation_replay,
-- record_offline_operation: "called by the Step 4 writers"). Version 1 is online only.
--
-- Content: one table (visit_media: photos and the customer's signature image, D13, D43, OF-06), one
-- nullable column with its composite foreign key on visit_signatures (signature_media_id, Migration
-- 3 OQ-15 / DEV-2), one trigger function (the media state and server times), four read helpers
-- (the payload hash, the device values, and the two Storage object checks), five SECURITY DEFINER
-- writers with their SECURITY INVOKER wrappers in public (depart_visit, arrive_visit, close_visit,
-- add_visit_media, confirm_visit_media), two SELECT policies on visit_media, three policies on
-- storage.objects for the private bucket 'visit-media', per-object grants, the census extension
-- and the fail-closed hardening check (section 11, Migration 6 section 11 byte for byte).
--
-- Data: schema only. No reference, test or fictitious rows (D47). The Storage bucket row is NOT
-- created here (a bucket is a row in storage.buckets, outside public and private: the canary-rows
-- check refuses it by design, D54 (2)); it is a separate owner-approved operation
-- (docs/review/step4-migration7/storage-bucket.sql). The writers and policies name the bucket id;
-- without the bucket no object can be stored, so add_visit_media rows stay 'pending' and a "טופל"
-- closure (which needs a stored signature) is refused: fail closed.
--
-- The writers (order in every body, as Migrations 4 and 6): the caller (require_caller, an active
-- Technician, profile locked FOR SHARE; his technician record from my_technician_id()), the input
-- (22023), the call locked FOR UPDATE and then the visit FOR UPDATE (as recalc_call_status and the
-- deferred checks lock the call first), the ownership (the visit's current technician is the
-- caller's record; anything else, also unknown, cancelled-and-gone or a test caller on a real
-- visit, is the generic 42501), the operation (offline_operation_replay, only after the ownership
-- check: a replay returns the stored outcome, the same id with another payload or user is refused),
-- the state (55000), the field version (PT409),
-- the write, the status event, the device time report (D45), the call status (D38,
-- recalc_call_status), and the operation's stored outcome (record_offline_operation), all in the
-- caller's transaction, so the deferred constraint triggers of Migration 3 (c10 to c40) pass at
-- COMMIT. Server times are set by the Migration 3 triggers (closed_at, received_at, recorded_at;
-- D45): a writer never takes a server time from the device.
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step4-migration7; each
-- question is "M7 OQ-n"):
--   OQ-1  allowed transitions only: scheduled -> en_route (depart), en_route -> in_progress
--         (arrive), in_progress -> done | followup (close). No skip (a scheduled visit is departed
--         first), no return, no change of a closed or cancelled visit (D14: a closed visit is
--         read-only to the technician; 55000).
--   OQ-2  the fixed Version 1 approval text of "טופל" (D43 versioned texts come with Version 2): the
--         server keeps it as a constant, the device sends its sha256 and a mismatch is refused
--         (22023; Version 2 routes it to review, D43). The text is the demo's
--         'קריאת השירות טופלה לשביעות רצון הלקוח'.
--   OQ-3  a "טופל" closure needs the signer's name and a stored signature image of the same visit
--         uploaded by the caller; "המשך טיפול" needs an active continuation reason and the next-visit
--         notes and carries no signature. Both need the written treatment summary (open decision 3:
--         no voice-only closure; summary_source 'written').
--   OQ-4  media: kinds photo (phase before or after) and signature (PNG); JPEG, PNG or WebP; 1 byte
--         to 10 MiB; at most 30 media rows per visit (pending and stored); only while the visit is
--         in progress (open decision 4 decides the final caps and counts, D13 PROVISIONAL). No
--         photo is required for a closure here (the screens decide what they ask for).
--   OQ-5  media objects live under '<test|live>/<visit id>/<media id>.<ext>' in the private bucket
--         'visit-media' (database-schema.md §3 prefixes; D47: test/ for test visits). A pending
--         row becomes 'stored' only after confirm_visit_media finds the object with the declared
--         size and type. Nothing is deleted: a pending row whose upload never happened stays pending.
--   OQ-6  Storage access: INSERT only by the visit's current technician, for his own pending row,
--         while the visit is in progress; SELECT by the visit's current technician and by office
--         users with `card` and (`cal` or `calls`) (as Migration 3 OQ-4); no UPDATE or DELETE
--         policy (objects are immutable; no upsert). Reads leave the database only as short-lived
--         signed links issued by the server under the user's session.
--   OQ-7  no audit_logs rows: visit_events (actor, operation) and offline_operations are the
--         record of these field actions (Migration 6 writes none either).
--   OQ-8  the operation types: depart and arrive are 'time_report', the closure 'close', a media row
--         'media' (Migration 4 OQ-9 codes); each records the visit's field_version it started from.
--   OQ-9  open decision 2 (d05) is unchanged: the technician still reads no time report.
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53), after
-- Migrations 3 to 6 are applied. Its writers need the owner's acceptance in the migration guard
-- (scripts/check-migrations.mjs ALLOWED_WRITERS; protected, D55 (8)): see the proposal in
-- docs/review/step4-migration7.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified. No function builds or runs SQL text.
--
-- Definer-writer invariant (as in Migrations 1 to 6): every writer of visit_media and of the
-- Migration 3 visit tables it touches is a SECURITY DEFINER body owned by postgres, so the SECURITY
-- INVOKER triggers read consistent data; they read each referenced row with SELECT ... INTO and raise
-- 23503 when it is missing (fail closed).
--
-- Error codes:
--   42501 "not authorized" (not an active Technician; not his visit, unknown, or a test caller on a
--         real visit: generic)
--   22023 "invalid input" (a missing or malformed value, a value refused by a column's CHECK, an
--         inactive reason, a wrong approval-text hash, a signature that is not his stored one)
--   55000 wrong state (a transition that is not allowed, a closed visit, the media limit, an object
--         that is not stored yet)
--   PT409 the visit changed since the device read it (field_version)
--   23505 an operation id already used for another payload
--   23503 a referenced row is missing (triggers)
--   23514 integrity rule (CHECKs, the D47 one-way rule, the deferred constraints)

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
-- 1. Tables and columns. RLS on every table (no FORCE), every foreign key ON DELETE RESTRICT, no
--    direct writes for any API role (no grants), no DELETE or TRUNCATE for anyone (triggers).
--    Codes are permanent once rows exist: later migrations may only add codes.
-- ---------------------------------------------------------------------------------------------

-- 1.1 visit_media (D13, D43, D45, D47; OF-06, SIM-19): one row per photo or signature image of a
--     visit. The file itself is an object in the private bucket 'visit-media' at storage_path; the
--     row is created 'pending' by add_visit_media and becomes 'stored' once (confirm_visit_media).
--     Only the state changes, once; the row is never deleted.
create table public.visit_media (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  kind text not null
    constraint visit_media_kind_check check (kind in ('photo', 'signature')),
  -- TE-14: before or after the treatment, for a photo; NULL for the signature.
  phase text
    constraint visit_media_phase_check check (phase in ('before', 'after')),
  -- OQ-5: '<test|live>/<visit id>/<media id>.<ext>'.
  storage_path text not null
    constraint visit_media_storage_path_key unique
    constraint visit_media_storage_path_check check (
      storage_path ~ '^(test|live)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  mime_type text not null
    constraint visit_media_mime_type_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  -- OQ-4 (TEMPORARY, open decision 4).
  size_bytes integer not null
    constraint visit_media_size_bytes_check check (size_bytes between 1 and 10485760),
  state text not null
    constraint visit_media_state_check check (state in ('pending', 'stored')),
  -- Server times (t12).
  received_at timestamptz not null default now(),
  stored_at timestamptz,
  -- D45: the device's capture time and its clock values (reported, not proof).
  captured_at timestamptz not null
    constraint visit_media_captured_at_check check (isfinite(captured_at)),
  device_tz text not null
    constraint visit_media_device_tz_check check (
      char_length(device_tz) <= 64 and device_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  device_utc_offset_min integer not null
    constraint visit_media_device_utc_offset_min_check check (device_utc_offset_min between -840 and 840),
  device_sent_at timestamptz not null
    constraint visit_media_device_sent_at_check check (isfinite(device_sent_at)),
  -- The device operation that created the row (D46; unique: one row per operation).
  operation_id uuid not null
    constraint visit_media_operation_id_key unique,
  created_by uuid not null
    constraint visit_media_created_by_fkey references public.profiles (id) on delete restrict,
  -- D47: copied from the visit by t15.
  is_test boolean not null,
  -- Parent of the composite foreign key of visit_signatures.signature_media_id.
  constraint visit_media_id_is_test_key unique (id, is_test),
  constraint visit_media_visit_id_fkey foreign key (visit_id, is_test)
    references public.visits (id, is_test) on delete restrict,
  constraint visit_media_phase_kind_check check ((kind = 'photo') = (phase is not null)),
  constraint visit_media_signature_type_check check (kind <> 'signature' or mime_type = 'image/png'),
  constraint visit_media_extension_check check (
    (mime_type = 'image/jpeg' and storage_path like '%.jpg') or (mime_type = 'image/png' and storage_path like '%.png')
    or (mime_type = 'image/webp' and storage_path like '%.webp')),
  -- D47: test media under test/, real media under live/.
  constraint visit_media_prefix_check check ((storage_path like 'test/%') = is_test),
  constraint visit_media_stored_check check ((state = 'stored') = (stored_at is not null))
);
create index visit_media_visit_id_kind_idx on public.visit_media (visit_id, kind);
create index visit_media_created_by_idx on public.visit_media (created_by);
comment on table public.visit_media is
  'Photos and signature images of visits (D13, D43, OF-06). The file is an object in the private bucket visit-media at storage_path. Written only by private.add_visit_media and private.confirm_visit_media. Never deleted.';
alter table public.visit_media enable row level security;

-- 1.2 visit_signatures.signature_media_id (Migration 3 OQ-15, DEV-2): the stored signature image of
--     a "טופל" closure. Nullable without a default (no existing row changes); the composite key
--     keeps the test marking consistent (D47). One signature row per image.
alter table public.visit_signatures add column signature_media_id uuid;
alter table public.visit_signatures
  add constraint visit_signatures_signature_media_id_fkey foreign key (signature_media_id, is_test)
    references public.visit_media (id, is_test) on delete restrict;
create unique index visit_signatures_signature_media_id_key on public.visit_signatures (signature_media_id)
  where signature_media_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger function (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants). It sets or checks NEW only. Messages are generic.
-- ---------------------------------------------------------------------------------------------

-- t12 on visit_media (BEFORE INSERT OR UPDATE): a row is created 'pending' with the server's receipt
-- time; it becomes 'stored' once (stored_at = now()); a stored row never changes again. Every other
-- column is frozen by t10.
create function private.tg_visit_media_state()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.state is distinct from 'pending' then
      raise exception using errcode = '55000', message = 'visit_media: a row is created pending';
    end if;
    new.received_at := now();
    new.stored_at := null;
    return new;
  end if;
  if old.state = 'stored' then
    raise exception using errcode = '55000', message = 'visit_media: a stored row never changes';
  end if;
  if new.state = 'stored' then
    new.stored_at := now();
  elsif new.stored_at is distinct from old.stored_at then
    raise exception using errcode = '55000', message = 'visit_media: stored_at is set by the server';
  end if;
  return new;
end
$$;

create trigger t10_immutable before update on public.visit_media
  for each row execute function private.tg_immutable_except('state', 'stored_at');
create trigger t12_media_state before insert or update on public.visit_media
  for each row execute function private.tg_visit_media_state();
create trigger t15_marker_from_visit before insert on public.visit_media
  for each row execute function private.tg_visit_child_marker();
create trigger t30_one_way before insert on public.visit_media
  for each row execute function private.tg_one_way_people('created_by');
create trigger t95_reject_delete before delete on public.visit_media
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.visit_media
  for each statement execute function private.tg_reject_truncate();

-- ---------------------------------------------------------------------------------------------
-- 3. Read helpers. field_payload_sha256 and field_device_ok are SECURITY INVOKER (their only
--    callers are the postgres-owned writers). The two Storage checks are SECURITY DEFINER and
--    STABLE: the storage.objects policies call them in the caller's context (EXECUTE for
--    authenticated); each reads only visit_media and visits and returns a boolean.
-- ---------------------------------------------------------------------------------------------

-- The sha256 of an operation's canonical payload (jsonb text: keys sorted, D46 replay check). The
-- writers build the payload from the action's own values only: device_sent_at is left out (a retry
-- of the same action is sent again later) and every time is its UTC epoch number, so the text does
-- not depend on the session's TimeZone; a retry hashes the same and returns the stored outcome.
create function private.field_payload_sha256(p_payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex') $$;

-- D45: the device's values are present and well-formed (they are reported values, not proof; a
-- suspicious clock is flagged by the time-report trigger, never refused).
create function private.field_device_ok(p_reported_at timestamptz, p_device_tz text, p_device_utc_offset_min integer,
  p_device_sent_at timestamptz)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_reported_at is not null and isfinite(p_reported_at)
     and p_device_sent_at is not null and isfinite(p_device_sent_at)
     and p_device_tz is not null and char_length(p_device_tz) <= 64
     and p_device_tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
     and p_device_utc_offset_min is not null and p_device_utc_offset_min between -840 and 840
$$;

-- OQ-6: may the caller store an object at p_name? Only his own pending row of a visit in progress
-- whose current technician he is (an active Technician).
create function private.visit_media_object_writable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.visit_media m
    join public.visits v on v.id = m.visit_id
    where m.storage_path = p_name and m.state = 'pending' and m.created_by = (select auth.uid())
      and v.status = 'in_progress' and v.technician_id = (select private.my_technician_id()))
$$;

-- OQ-6: may the caller read the object at p_name? The visit's current technician, or an office
-- user with `card` and (`cal` or `calls`) (the Creator always).
create function private.visit_media_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.visit_media m
    join public.visits v on v.id = m.visit_id
    where m.storage_path = p_name
      and (v.technician_id = (select private.my_technician_id())
           or ((select private.has_permission('card'))
               and ((select private.has_permission('cal')) or (select private.has_permission('calls'))))))
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Writers (D14, D38, D43, D44, D45, D46; T-02, T-03, T-09). SECURITY DEFINER plpgsql in
--    private, every reference schema-qualified, no dynamic SQL. Order: see the header. Errors from a
--    write carry no DETAIL (the statement runs as the owner).
-- ---------------------------------------------------------------------------------------------

-- "יוצא · Waze" (TE-02): scheduled -> en_route, with the device's departure time (D45). Returns the
-- visit's status and field_version after it, and whether it was a replay.
create function private.depart_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_reported_at timestamptz,
  p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_replay boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_tech uuid;
  v_sha text;
  v_op public.offline_operations;
  v_call_id uuid;
  v_visit public.visits;
  v_version integer;
  v_field_version integer;
begin
  v_caller := private.require_caller(array['technician']);
  v_tech := private.my_technician_id();
  if v_tech is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_visit_id is null or p_operation_id is null or p_expected_field_version is null or p_expected_field_version < 1
     or not private.field_device_ok(p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  v_sha := private.field_payload_sha256(jsonb_build_object(
    'action', 'depart', 'visit_id', p_visit_id, 'expected_field_version', p_expected_field_version,
    'reported_at', extract(epoch from p_reported_at), 'device_tz', p_device_tz,
    'device_utc_offset_min', p_device_utc_offset_min));
  select v.service_call_id into v_call_id from public.visits v where v.id = p_visit_id;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  perform 1 from public.service_calls c where c.id = v_call_id for update;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or v_visit.technician_id is distinct from v_tech or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_op := private.offline_operation_replay(p_operation_id, p_visit_id, 'time_report', v_sha);
  if v_op.operation_id is not null then
    out_status := v_visit.status;
    out_field_version := v_op.resulting_field_version;
    out_replay := true;
    return next;
    return;
  end if;
  if v_visit.status <> 'scheduled' then
    raise exception using errcode = '55000', message = 'invalid status change';
  end if;
  if v_visit.field_version <> p_expected_field_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  update public.visits v set status = 'en_route', updated_by = v_caller.id where v.id = v_visit.id
  returning v.version, v.field_version into v_version, v_field_version;
  insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id, operation_id)
  values (v_visit.id, v_version, 'status_changed', 'scheduled', 'en_route', v_caller.id, p_operation_id);
  insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                         device_utc_offset_min, device_sent_at, source, operation_id)
  values (v_visit.id, v_caller.id, v_tech, 'departed', p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at,
          'device', p_operation_id);
  perform private.recalc_call_status(v_call_id);
  perform private.record_offline_operation(p_operation_id, v_visit.id, 'time_report', v_sha, p_expected_field_version,
    p_device_sent_at, p_device_tz, p_device_utc_offset_min, 'applied', v_field_version, null);
  out_status := 'en_route';
  out_field_version := v_field_version;
  out_replay := false;
  return next;
end
$$;

-- "הגעתי · התחלת טיפול" (TE-13): en_route -> in_progress, with the device's arrival time (D45).
create function private.arrive_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_reported_at timestamptz,
  p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_replay boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_tech uuid;
  v_sha text;
  v_op public.offline_operations;
  v_call_id uuid;
  v_visit public.visits;
  v_version integer;
  v_field_version integer;
begin
  v_caller := private.require_caller(array['technician']);
  v_tech := private.my_technician_id();
  if v_tech is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_visit_id is null or p_operation_id is null or p_expected_field_version is null or p_expected_field_version < 1
     or not private.field_device_ok(p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  v_sha := private.field_payload_sha256(jsonb_build_object(
    'action', 'arrive', 'visit_id', p_visit_id, 'expected_field_version', p_expected_field_version,
    'reported_at', extract(epoch from p_reported_at), 'device_tz', p_device_tz,
    'device_utc_offset_min', p_device_utc_offset_min));
  select v.service_call_id into v_call_id from public.visits v where v.id = p_visit_id;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  perform 1 from public.service_calls c where c.id = v_call_id for update;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or v_visit.technician_id is distinct from v_tech or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_op := private.offline_operation_replay(p_operation_id, p_visit_id, 'time_report', v_sha);
  if v_op.operation_id is not null then
    out_status := v_visit.status;
    out_field_version := v_op.resulting_field_version;
    out_replay := true;
    return next;
    return;
  end if;
  if v_visit.status <> 'en_route' then
    raise exception using errcode = '55000', message = 'invalid status change';
  end if;
  if v_visit.field_version <> p_expected_field_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  update public.visits v set status = 'in_progress', updated_by = v_caller.id where v.id = v_visit.id
  returning v.version, v.field_version into v_version, v_field_version;
  insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id, operation_id)
  values (v_visit.id, v_version, 'status_changed', 'en_route', 'in_progress', v_caller.id, p_operation_id);
  insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                         device_utc_offset_min, device_sent_at, source, operation_id)
  values (v_visit.id, v_caller.id, v_tech, 'arrived', p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at,
          'device', p_operation_id);
  perform private.recalc_call_status(v_call_id);
  perform private.record_offline_operation(p_operation_id, v_visit.id, 'time_report', v_sha, p_expected_field_version,
    p_device_sent_at, p_device_tz, p_device_utc_offset_min, 'applied', v_field_version, null);
  out_status := 'in_progress';
  out_field_version := v_field_version;
  out_replay := false;
  return next;
end
$$;

-- The closure (TE-18 to TE-22, D60 (2), T-02, T-03, T-09): in_progress -> done ("טופל") or followup
-- ("המשך טיפול"). Both complete the visit; the call status follows D38 in the same transaction
-- ("המשך טיפול" leaves the call awaiting follow-up). The summary row, the signature row (done; the
-- fixed Version 1 approval text, OQ-2, D43), the end time and, for done, the signing time (D45),
-- the status event and the stored outcome of the operation. A second submission with the same
-- operation id returns the stored outcome; with another id the closed visit refuses it (55000), so a
-- double submission closes the visit once. Returns the visit's status, field_version, the call's
-- status after it, and whether it was a replay.
create function private.close_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_outcome text, p_summary text,
  p_signer_name text, p_ack_text_sha256 text, p_signature_media_id uuid, p_followup_reason_id uuid,
  p_next_visit_notes text, p_reported_at timestamptz, p_device_tz text, p_device_utc_offset_min integer,
  p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_call_status text, out_replay boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- OQ-2: the fixed Version 1 approval text of "טופל" (the demo's text).
  v_ack_text constant text := 'קריאת השירות טופלה לשביעות רצון הלקוח';
  v_caller public.profiles;
  v_tech uuid;
  v_sha text;
  v_op public.offline_operations;
  v_call_id uuid;
  v_visit public.visits;
  v_version integer;
  v_field_version integer;
  v_call_status text;
begin
  v_caller := private.require_caller(array['technician']);
  v_tech := private.my_technician_id();
  if v_tech is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_visit_id is null or p_operation_id is null or p_expected_field_version is null or p_expected_field_version < 1
     or p_outcome is null or p_outcome not in ('done', 'followup')
     or coalesce(p_summary, '') = ''
     or not private.field_device_ok(p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if p_outcome = 'done'
     and (coalesce(p_signer_name, '') = '' or p_signature_media_id is null
          or p_ack_text_sha256 is distinct from encode(sha256(convert_to(v_ack_text, 'UTF8')), 'hex')
          or p_followup_reason_id is not null or p_next_visit_notes is not null) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if p_outcome = 'followup'
     and (p_followup_reason_id is null or coalesce(p_next_visit_notes, '') = ''
          or p_signer_name is not null or p_signature_media_id is not null or p_ack_text_sha256 is not null) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  v_sha := private.field_payload_sha256(jsonb_build_object(
    'action', 'close', 'visit_id', p_visit_id, 'expected_field_version', p_expected_field_version, 'outcome', p_outcome,
    'summary', p_summary, 'signer_name', p_signer_name, 'ack_text_sha256', p_ack_text_sha256,
    'signature_media_id', p_signature_media_id, 'followup_reason_id', p_followup_reason_id,
    'next_visit_notes', p_next_visit_notes, 'reported_at', extract(epoch from p_reported_at), 'device_tz', p_device_tz,
    'device_utc_offset_min', p_device_utc_offset_min));
  select v.service_call_id into v_call_id from public.visits v where v.id = p_visit_id;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  perform 1 from public.service_calls c where c.id = v_call_id for update;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or v_visit.technician_id is distinct from v_tech or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_op := private.offline_operation_replay(p_operation_id, p_visit_id, 'close', v_sha);
  if v_op.operation_id is not null then
    out_status := v_visit.status;
    out_call_status := (select c.status from public.service_calls c where c.id = v_call_id);
    out_field_version := v_op.resulting_field_version;
    out_replay := true;
    return next;
    return;
  end if;
  if v_visit.status <> 'in_progress' then
    raise exception using errcode = '55000', message = 'invalid status change';
  end if;
  if v_visit.field_version <> p_expected_field_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if p_outcome = 'followup'
     and not exists (select 1 from public.followup_reasons r where r.id = p_followup_reason_id and r.is_active) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if p_outcome = 'done'
     and not exists (select 1 from public.visit_media m
                     where m.id = p_signature_media_id and m.visit_id = v_visit.id and m.kind = 'signature'
                       and m.state = 'stored' and m.created_by = v_caller.id) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  begin
    update public.visits v
    set status = p_outcome, followup_reason_id = p_followup_reason_id, next_visit_notes = p_next_visit_notes,
        updated_by = v_caller.id
    where v.id = v_visit.id
    returning v.version, v.field_version into v_version, v_field_version;
    insert into public.visit_reports (visit_id, summary_text, summary_source, created_by, updated_by)
    values (v_visit.id, p_summary, 'written', v_caller.id, v_caller.id);
    if p_outcome = 'done' then
      insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, created_by,
                                           signature_media_id)
      values (v_visit.id, p_signer_name, v_ack_text, p_ack_text_sha256, p_operation_id, v_caller.id, p_signature_media_id);
    end if;
  exception
    when check_violation or not_null_violation or foreign_key_violation or unique_violation or data_exception then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, actor_profile_id, operation_id)
  values (v_visit.id, v_version, 'status_changed', 'in_progress', p_outcome, v_caller.id, p_operation_id);
  insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                         device_utc_offset_min, device_sent_at, source, operation_id)
  values (v_visit.id, v_caller.id, v_tech, 'ended', p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at,
          'device', p_operation_id);
  if p_outcome = 'done' then
    insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                           device_utc_offset_min, device_sent_at, source, operation_id)
    values (v_visit.id, v_caller.id, v_tech, 'signed', p_reported_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at,
            'device', p_operation_id);
  end if;
  v_call_status := private.recalc_call_status(v_call_id);
  perform private.record_offline_operation(p_operation_id, v_visit.id, 'close', v_sha, p_expected_field_version,
    p_device_sent_at, p_device_tz, p_device_utc_offset_min, 'applied', v_field_version, null);
  out_status := p_outcome;
  out_field_version := v_field_version;
  out_call_status := v_call_status;
  out_replay := false;
  return next;
end
$$;

-- A photo or the signature image of the caller's visit in progress (TE-14, TE-19; OQ-4, OQ-5): a
-- pending visit_media row and the object path the caller may then upload to (the storage.objects
-- INSERT policy admits exactly that path). A replay of the same operation returns the same row.
create function private.add_visit_media(
  p_visit_id uuid, p_operation_id uuid, p_kind text, p_phase text, p_mime_type text, p_size_bytes integer,
  p_captured_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_media_id uuid, out_storage_path text, out_replay boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_tech uuid;
  v_sha text;
  v_op public.offline_operations;
  v_call_id uuid;
  v_visit public.visits;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  v_caller := private.require_caller(array['technician']);
  v_tech := private.my_technician_id();
  if v_tech is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_visit_id is null or p_operation_id is null or p_kind is null or p_mime_type is null or p_size_bytes is null
     or p_kind not in ('photo', 'signature')
     or (p_kind = 'photo' and (p_phase is null or p_phase not in ('before', 'after')))
     or (p_kind = 'signature' and (p_phase is not null or p_mime_type <> 'image/png'))
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_size_bytes < 1 or p_size_bytes > 10485760
     or not private.field_device_ok(p_captured_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at) then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  v_sha := private.field_payload_sha256(jsonb_build_object(
    'action', 'media', 'visit_id', p_visit_id, 'kind', p_kind, 'phase', p_phase, 'mime_type', p_mime_type,
    'size_bytes', p_size_bytes, 'captured_at', extract(epoch from p_captured_at), 'device_tz', p_device_tz,
    'device_utc_offset_min', p_device_utc_offset_min));
  select v.service_call_id into v_call_id from public.visits v where v.id = p_visit_id;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  perform 1 from public.service_calls c where c.id = v_call_id for update;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or v_visit.technician_id is distinct from v_tech or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  v_op := private.offline_operation_replay(p_operation_id, p_visit_id, 'media', v_sha);
  if v_op.operation_id is not null then
    select m.id, m.storage_path into out_media_id, out_storage_path
    from public.visit_media m where m.operation_id = p_operation_id;
    out_replay := true;
    return next;
    return;
  end if;
  if v_visit.status <> 'in_progress' then
    raise exception using errcode = '55000', message = 'invalid status change';
  end if;
  if (select count(*) from public.visit_media m where m.visit_id = v_visit.id) >= 30 then
    raise exception using errcode = '55000', message = 'media limit reached';
  end if;
  v_path := case when v_visit.is_test then 'test/' else 'live/' end || v_visit.id::text || '/' || v_id::text
            || case p_mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  insert into public.visit_media (id, visit_id, kind, phase, storage_path, mime_type, size_bytes, state, captured_at,
                                  device_tz, device_utc_offset_min, device_sent_at, operation_id, created_by)
  values (v_id, v_visit.id, p_kind, p_phase, v_path, p_mime_type, p_size_bytes, 'pending', p_captured_at, p_device_tz,
          p_device_utc_offset_min, p_device_sent_at, p_operation_id, v_caller.id);
  perform private.record_offline_operation(p_operation_id, v_visit.id, 'media', v_sha, v_visit.field_version,
    p_device_sent_at, p_device_tz, p_device_utc_offset_min, 'applied', v_visit.field_version, null);
  out_media_id := v_id;
  out_storage_path := v_path;
  out_replay := false;
  return next;
end
$$;

-- The caller's pending media row becomes 'stored' once its object is in the bucket with the
-- declared size and type (OQ-5), only while its visit is in progress (OQ-4; the visit is locked FOR
-- SHARE before the media row, so a closure cannot commit in between). A stored row answers 'stored'
-- again (idempotent). 55000 when the visit is not in progress or the object is missing or differs.
create function private.confirm_visit_media(p_media_id uuid)
returns table (out_state text)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_tech uuid;
  v_visit_id uuid;
  v_visit public.visits;
  v_media public.visit_media;
begin
  v_caller := private.require_caller(array['technician']);
  v_tech := private.my_technician_id();
  if v_tech is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_media_id is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select m.visit_id into v_visit_id from public.visit_media m where m.id = p_media_id;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  select v.* into v_visit from public.visits v where v.id = v_visit_id for share;
  select m.* into v_media from public.visit_media m where m.id = p_media_id for update;
  if v_visit.id is null or v_media.id is null or v_media.created_by is distinct from v_caller.id
     or v_visit.technician_id is distinct from v_tech or (v_caller.is_test and not v_visit.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_media.state = 'stored' then
    out_state := 'stored';
    return next;
    return;
  end if;
  if v_visit.status <> 'in_progress' then
    raise exception using errcode = '55000', message = 'invalid status change';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'visit-media' and o.name = v_media.storage_path
                   and o.metadata ->> 'size' = v_media.size_bytes::text
                   and o.metadata ->> 'mimetype' = v_media.mime_type) then
    raise exception using errcode = '55000', message = 'the object is not stored';
  end if;
  update public.visit_media m set state = 'stored' where m.id = v_media.id;
  out_state := 'stored';
  return next;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Public API: thin SECURITY INVOKER wrappers, same names and arguments as the bodies. Each body
--    checks its caller (an active Technician, his own visit).
-- ---------------------------------------------------------------------------------------------
create function public.depart_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_reported_at timestamptz,
  p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_replay boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select * from private.depart_visit(p_visit_id, p_operation_id, p_expected_field_version, p_reported_at, p_device_tz,
    p_device_utc_offset_min, p_device_sent_at)
$$;

create function public.arrive_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_reported_at timestamptz,
  p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_replay boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select * from private.arrive_visit(p_visit_id, p_operation_id, p_expected_field_version, p_reported_at, p_device_tz,
    p_device_utc_offset_min, p_device_sent_at)
$$;

create function public.close_visit(
  p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_outcome text, p_summary text,
  p_signer_name text, p_ack_text_sha256 text, p_signature_media_id uuid, p_followup_reason_id uuid,
  p_next_visit_notes text, p_reported_at timestamptz, p_device_tz text, p_device_utc_offset_min integer,
  p_device_sent_at timestamptz)
returns table (out_status text, out_field_version integer, out_call_status text, out_replay boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select * from private.close_visit(p_visit_id, p_operation_id, p_expected_field_version, p_outcome, p_summary,
    p_signer_name, p_ack_text_sha256, p_signature_media_id, p_followup_reason_id, p_next_visit_notes, p_reported_at,
    p_device_tz, p_device_utc_offset_min, p_device_sent_at)
$$;

create function public.add_visit_media(
  p_visit_id uuid, p_operation_id uuid, p_kind text, p_phase text, p_mime_type text, p_size_bytes integer,
  p_captured_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz)
returns table (out_media_id uuid, out_storage_path text, out_replay boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select * from private.add_visit_media(p_visit_id, p_operation_id, p_kind, p_phase, p_mime_type, p_size_bytes,
    p_captured_at, p_device_tz, p_device_utc_offset_min, p_device_sent_at)
$$;

create function public.confirm_visit_media(p_media_id uuid)
returns table (out_state text)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select * from private.confirm_visit_media(p_media_id) $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Test-data census (replaces the Step 6 function; same signature, ACL and caller rule): one
--    'all sources' row for visit_media; the Storage row (no marker column) now says that the
--    objects of the bucket visit-media are counted through their visit_media rows (OQ-5).
-- ---------------------------------------------------------------------------------------------
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
    select 'review_items', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.review_items x
    union all
    select 'visit_corrections', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_corrections x
    union all
    select 'offline_operations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.offline_operations x
    union all
    select 'external_calendar_events', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'automated_test',
           count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.external_calendar_events x
    union all
    select 'external_calendar_events', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.external_calendar_events x
    union all
    select 'calendar_event_changes', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_event_changes x
    union all
    select 'calendar_ingestion_errors', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.calendar_ingestion_errors x
    union all
    select 'visit_media', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.visit_media x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'bucket visit-media: its objects are counted as visit_media rows (D47 prefix test/)', 0::bigint;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. RLS policies on visit_media: SELECT only, TO authenticated only, every one requires an active
--    profile (through the helpers). No write or anon policies. The visit's current technician
--    (his own visits, any status; Migration 3 OQ-1) and office users with `card` and (`cal` or
--    `calls`) (as visit_reports and visit_signatures, Migration 3 OQ-4).
-- ---------------------------------------------------------------------------------------------
create policy visit_media_select_technician on public.visit_media for select to authenticated
  using (exists (select 1 from public.visits v
                 where v.id = visit_media.visit_id and v.technician_id = (select private.my_technician_id())));
create policy visit_media_select_office on public.visit_media for select to authenticated
  using ((select private.has_permission('card'))
         and ((select private.has_permission('cal')) or (select private.has_permission('calls'))));

-- ---------------------------------------------------------------------------------------------
-- 8. Storage policies for the private bucket 'visit-media' (OQ-6). The bucket row itself is a
--    separate owner-approved operation (header). INSERT: the technician's own pending object path
--    only; SELECT: the visit's current technician and office users with `card` and (`cal` or
--    `calls`); no UPDATE or DELETE policy, so an object is never replaced or removed through the API.
-- ---------------------------------------------------------------------------------------------
create policy visit_media_objects_insert_technician on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-media' and (select private.visit_media_object_writable(name)));
create policy visit_media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'visit-media' and (select private.visit_media_object_readable(name)));

-- ---------------------------------------------------------------------------------------------
-- 9. Grants, per object (never PR 1.3's blanket revokes). Table: SELECT for authenticated, nothing
--    else for anyone. Functions: EXECUTE for authenticated on the five wrappers and the five bodies
--    they call (each body checks its caller) and on the two Storage checks (the storage.objects
--    policies run them in the caller's context); none on the trigger function or the two other
--    helpers. Nothing for anon, service_role or PUBLIC. test_data_census() keeps its ACL.
-- ---------------------------------------------------------------------------------------------
revoke all on table public.visit_media from public, anon, authenticated, service_role;
grant select on public.visit_media to authenticated;

revoke all on function private.tg_visit_media_state() from public, anon, authenticated, service_role;
revoke all on function private.field_payload_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.field_device_ok(timestamptz, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.visit_media_object_writable(text) from public, anon, authenticated, service_role;
revoke all on function private.visit_media_object_readable(text) from public, anon, authenticated, service_role;
revoke all on function private.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text,
  integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.confirm_visit_media(uuid) from public, anon, authenticated, service_role;
revoke all on function public.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text,
  integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_visit_media(uuid) from public, anon, authenticated, service_role;

grant execute on function
  private.visit_media_object_writable(text),
  private.visit_media_object_readable(text),
  private.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz),
  private.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz),
  private.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text, integer, timestamptz),
  private.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz),
  private.confirm_visit_media(uuid),
  public.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz),
  public.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz),
  public.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text, integer, timestamptz),
  public.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz),
  public.confirm_visit_media(uuid)
to authenticated;

comment on function private.depart_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz) is
  'Step 4: the technician leaves for his scheduled visit (scheduled -> en_route) with the device departure time (D45); idempotent per operation id (D46). Never called by a migration.';
comment on function private.arrive_visit(uuid, uuid, integer, timestamptz, text, integer, timestamptz) is
  'Step 4: the technician arrives (en_route -> in_progress) with the device arrival time (D45); idempotent per operation id (D46). Never called by a migration.';
comment on function private.close_visit(uuid, uuid, integer, text, text, text, text, uuid, uuid, text, timestamptz, text, integer, timestamptz) is
  'Step 4: the closure of a visit in progress as done or followup (D38, D43, D45, D60 (2)) with its summary and, for done, the signature; idempotent per operation id (D46). Never called by a migration.';
comment on function private.add_visit_media(uuid, uuid, text, text, text, integer, timestamptz, text, integer, timestamptz) is
  'Step 4: a pending photo or signature image of the caller''s visit in progress and its object path in the private bucket visit-media. Never called by a migration.';
comment on function private.confirm_visit_media(uuid) is
  'Step 4: a pending media row of a visit in progress becomes stored once its object exists with the declared size and type. Never called by a migration.';

-- ---------------------------------------------------------------------------------------------
-- 10. Hand-offs (no statement).
--     Before the first upload on a project: the private bucket 'visit-media' (public false, 10 MiB,
--     image/jpeg, image/png, image/webp) through a separately approved operation
--     (docs/review/step4-migration7/storage-bucket.sql); its absence fails closed (header).
--     Version 2: offline sync (the device keeps the work queue, D46; the same writers and operation
--     ids), D43 versioned approval texts (ack_text_versions; a mismatch goes to review), voice
--     summaries and transcripts (open decision 3), parts (visit_parts), videos, the D36 earlier
--     visits' media for a follow-up technician (previous_visits gains media), and the D44 review
--     paths of device submissions (edit conflicts, a closure after cancellation).
--     Open decision 4: the final media caps and counts (OQ-4). Open decision 2: field times for the
--     technician (OQ-9).
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- 11. Fail closed when the hardening did not take effect (owner, 2026-11-11 and 2026-11-12: as
--     in Migration 6, section 11, byte for byte). Read-only; any leftover raises, and the whole
--     migration then rolls back. tests/db/350 runs a copy of this block (kept identical by
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
