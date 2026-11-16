-- PR 1.6: the two writers of Migration 4 (D14, D44; docs/database-schema.md §1, §4, §6, §8.1, §8.3;
-- docs/architecture-data-access.md visits.correct and review.resolve; docs/testing.md categories 2,
-- 3, 4, 5, 8, 10 and 13). Covered, per caller (the Creator, a Manager, Customer Service, a
-- Technician, a deactivated Manager, a user without a profile, no JWT, anon, service_role, and a
-- Manager or Customer Service user with matrix keys turned off or on):
--   correct_visit (D14, OF-10): only the Manager and the Creator (a fixed capability, never a
--   matrix key alone); TEMPORARY (OQ-1) also `card` and (`cal` or `calls`); the input, the field set
--   (OQ-5: no parts, no signature, no outcome, OQ-6), a closed visit only, the version (PT409,
--   OQ-8), the follow-up fields only on a followup visit, an active continuation reason, a field
--   time with its UTC offset, no change refused; the effects: an append-only visit_corrections row
--   with the old and new value and versions, the visit's version raised by one, the as-closed
--   values untouched (OQ-7), a correction time report that visit_time_current prefers (D45), an
--   entity_changes row for the non-card visit fields, an audit row, the call status unchanged, the
--   deferred checks and the audit chain still valid.
--   resolve_review_item (D44): who decides (OQ-3: a closed or cancelled visit by a Manager or the
--   Creator with a note, others with `conflicts`; Customer Service with `conflicts` cannot decide a
--   D14 item), the input, the item's state and version, which decisions PR 1.6 applies (OQ-4), an
--   invitation never changes a closed visit (D39), the effects (an accepted second device report
--   becomes a correction time report that keeps its original receipt time, OQ-13; keep_current
--   changes nothing; both versions stay stored), an audit row, the call status unchanged.
--   Independent review S1: a second device report accepted after an office correction of the same
--   field time is refused like a stale version (PT409).
--   D47: a test caller never corrects or decides a real record (simulated go-live, section 7).
-- Mechanics: each scenario runs in a subtransaction that is always undone (tm_run_as), as the role
-- under test with its JWT claims; its effects are read back as postgres in the same scenario.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test, automated_test; D47): the real Creator
-- c1, Managers a1 and a2, Customer Service b1, Technicians A (d1, e1) and B (d2, e2), a signed-in
-- user f0 without a profile. Call K (R-2401, open) has visit 1 (done, Technician A, with its
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
  ('00000000-0000-4000-8000-000000240c01', 'C-2401', 'לקוח בדיקה', '050-000-2401', 'automated_test', 'pr16-240');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000240d01', 'kt-2401', 'KT-2401', 'מוצר בדיקה', 'automated_test', 'pr16-240');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-000000240a01', 'R-2401', '00000000-0000-4000-8000-000000240c01',
        '00000000-0000-4000-8000-000000240d01', (select c.id from public.call_types c where c.sort_order = 1),
        'תקלת בדיקה', 'נציג בדיקה', 'open', 5, 'automated_test', 'pr16-240-k');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, followup_reason_id, next_visit_notes, source_ref) values
  ('00000000-0000-4000-8000-000000240b01', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-0000000000e1',
   1, 'K1', now() - interval '3 hours', now() - interval '2 hours', 'done', 'עיר בדיקה', 'רחוב הבדיקה 1', null, null, 'pr16-240-k1'),
  ('00000000-0000-4000-8000-000000240b02', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-0000000000e1',
   2, 'K2', now() - interval '2 hours', now() - interval '1 hour', 'followup', 'עיר בדיקה', 'רחוב הבדיקה 2',
   (select r.id from public.followup_reasons r where r.sort_order = 1), 'להביא חלק', 'pr16-240-k2'),
  ('00000000-0000-4000-8000-000000240b03', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-0000000000e2',
   3, 'K3', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'עיר בדיקה', 'רחוב הבדיקה 3', null, null,
   'pr16-240-k3'),
  ('00000000-0000-4000-8000-000000240b04', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-0000000000e1',
   4, 'K4', now() + interval '2 days', now() + interval '2 days 1 hour', 'cancelled', 'עיר בדיקה', 'רחוב הבדיקה 4', null, null,
   'pr16-240-k4');
insert into public.visit_reports (visit_id, summary_text, summary_source) values
  ('00000000-0000-4000-8000-000000240b01', 'הוחלף חלק', 'written'),
  ('00000000-0000-4000-8000-000000240b02', 'נדרש חלק', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-000000240b01', 'חותם בדיקה', 'נוסח בדיקה', encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'),
          '00000000-0000-4000-8000-000000240e00');
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr16-240-k%';
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
select '00000000-0000-4000-8000-000000240b01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
       x.kind, x.at, 'Asia/Jerusalem', 120, x.at + interval '1 minute', 'device', x.op::uuid
from (values ('departed', now() - interval '3 hours', '00000000-0000-4000-8000-000000240e01'),
             ('arrived', now() - interval '150 minutes', '00000000-0000-4000-8000-000000240e02'),
             ('ended', now() - interval '130 minutes', '00000000-0000-4000-8000-000000240e03')) as x (kind, at, op);
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;

-- Review items, stored through create_review_item as the Step 4 and Step 6 writers will store them
-- (device items under Technician A's or B's session, invitation items without a session):
--   r1 reassignment of the scheduled visit 3 (invitation; `conflicts`);
--   r2 a second departure report of the done visit 1 (Technician A; D14: Manager or Creator);
--   r3 a closure of the cancelled visit 4 (Technician A; D14);
--   r4 a different SKU on the call (invitation, call level; `conflicts`);
--   r5 an address change of the done visit 1 (invitation; D14, and D39: keep_current only);
--   r6 a second arrival report of the scheduled visit 3 (Technician B; `conflicts`).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
select private.create_review_item('duplicate_time_report', 'pr16-240-r2', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-000000240b01', 'device',
  null, '00000000-0000-4000-8000-000000240f02',
  jsonb_build_object('kind', 'departed', 'reported_at', now() - interval '170 minutes', 'device_tz', 'Asia/Jerusalem',
                     'device_utc_offset_min', 120, 'device_sent_at', now() - interval '160 minutes'),
  jsonb_build_object('kind', 'departed', 'reported_at', now() - interval '3 hours'), null);
select private.create_review_item('closure_of_cancelled_visit', 'pr16-240-r3', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-000000240b04',
  'device', null, '00000000-0000-4000-8000-000000240f03', '{"status": "done"}', '{"status": "cancelled"}', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
select private.create_review_item('duplicate_time_report', 'pr16-240-r6', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-000000240b03', 'device',
  null, '00000000-0000-4000-8000-000000240f06',
  jsonb_build_object('kind', 'arrived', 'reported_at', now() - interval '5 minutes', 'device_tz', 'Asia/Jerusalem',
                     'device_utc_offset_min', 120, 'device_sent_at', now() - interval '4 minutes'),
  '{}', null);
select set_config('request.jwt.claims', '', true);
select private.create_review_item('reassignment', 'pr16-240-r1', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-000000240b03', 'invitation',
  'pr16-240-evt-1', null, '{"technician": "טכנאי א"}', '{"technician": "טכנאי ב"}', '{"technician": "טכנאי ב"}');
select private.create_review_item('sku_change', 'pr16-240-r4', '00000000-0000-4000-8000-000000240a01', null, 'invitation',
  'pr16-240-evt-4', null, '{"sku": "KT-9"}', '{"sku": "KT-2401"}', null);
select private.create_review_item('address_change', 'pr16-240-r5', '00000000-0000-4000-8000-000000240a01', '00000000-0000-4000-8000-000000240b01', 'invitation',
  'pr16-240-evt-5', null, '{"street": "רחוב אחר"}', '{"street": "רחוב הבדיקה 1"}', null);
select is((select count(*) from public.review_items where status = 'open' and version = 1 and is_test), 6::bigint,
  'six open test review items exist (the fixture of this file)');

-- ---------------------------------------------------------------------------------------------
-- 1. correct_visit: who may correct (D14 fixed capability; TEMPORARY OQ-1 keys)
-- ---------------------------------------------------------------------------------------------
create temporary table tm_case (n serial primary key, grp text not null, label text not null, setup text,
                                sub uuid, role text not null default 'authenticated', stmt text not null,
                                expected text not null) on commit drop;
grant all on tm_case to public;
insert into tm_case (grp, label, setup, sub, role, stmt, expected) values
  ('cv_who', 'the Creator', null, '00000000-0000-4000-8000-0000000000c1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, 'ok'),
  ('cv_who', 'a Manager', null, '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, 'ok'),
  ('cv_who', 'Customer Service (never a D14 correction, whatever its keys)',
   $s$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'Technician A on his own closed visit (D14)', null, '00000000-0000-4000-8000-0000000000d1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'a signed-in user without a profile', null, '00000000-0000-4000-8000-0000000000f0', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'authenticated without a JWT', null, null, 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'a deactivated Manager',
   $s$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000a2'$s$, '00000000-0000-4000-8000-0000000000a2', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'a Manager with card off (TEMPORARY OQ-1)',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key = 'card'$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'a Manager with cal and calls off (TEMPORARY OQ-1)',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key in ('cal', 'calls')$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, '42501 not authorized'),
  ('cv_who', 'a Manager with only cal of the two (positive control)',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key = 'calls'$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות הקלדה', 1)$s$, 'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_run_as(c.setup, c.sub, c.role, c.stmt) from tm_case c where c.grp = 'cv_who' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'cv_who' order by c.n $$,
  'correct_visit: the Manager and the Creator only (fixed D14 capability; Customer Service never, also with conflicts); TEMPORARY: card and (cal or calls); deactivated, profile-less and claim-less callers refused');
select results_eq(
  $$ select x.r, left(pg_temp.tm_run_as(null, null, x.r,
       $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות', 1)$q$), 5)
     from (values ('anon'), ('service_role')) as x (r) $$,
  $$ values ('anon', '42501'), ('service_role', '42501') $$,
  'anon and service_role cannot execute correct_visit (no grant)');

-- ---------------------------------------------------------------------------------------------
-- 2. correct_visit: input, state, version and value rules (as the Manager)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, setup, sub, stmt, expected) values
  ('cv_rules', 'parts: not correctable before Step 4 (TEMPORARY OQ-5)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'parts', 'חלק', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'the signature is never corrected (D43)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'signature', 'אחר', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'the outcome is not corrected (TEMPORARY OQ-6, PR 1.5 OQ-14)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'status', 'followup', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'a reason of spaces only', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', '   ', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'no new value', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', null, 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'no version', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'סיבה', null)$s$, '22023 invalid input'),
  ('cv_rules', 'a reason of 501 characters (TEXT-SAFE-ML, 1-500)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', repeat('א', 501), 1)$s$, '22023 invalid input'),
  ('cv_rules', 'a summary with a control character (TEXT-SAFE-ML)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום' || chr(7) || 'מתוקן', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'a summary of 4001 characters', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', repeat('א', 4001), 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'an unknown visit (generic)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit(gen_random_uuid(), 'summary', 'סיכום מתוקן', 'סיבה', 1)$s$, '42501 not authorized'),
  ('cv_rules', 'a scheduled visit is not server-closed', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b03', 'summary', 'סיכום מתוקן', 'סיבה', 1)$s$, '55000 the visit is not closed'),
  ('cv_rules', 'a cancelled visit is not corrected', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b04', 'summary', 'סיכום מתוקן', 'סיבה', 1)$s$, '55000 the visit is not closed'),
  ('cv_rules', 'a stale version (D44)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'סיבה', 2)$s$, 'PT409 version conflict'),
  ('cv_rules', 'the continuation reason of a done visit', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'followup_reason', (select r.id::text from public.followup_reasons r where r.sort_order = 2), 'סיבה', 1)$s$,
   '55000 the field cannot be corrected for this visit'),
  ('cv_rules', 'the next-visit notes of a done visit', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'next_visit_notes', 'הערה', 'סיבה', 1)$s$,
   '55000 the field cannot be corrected for this visit'),
  ('cv_rules', 'an inactive continuation reason',
   $s$update public.followup_reasons set is_active = false where sort_order = 3$s$, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b02', 'followup_reason', (select r.id::text from public.followup_reasons r where r.sort_order = 3), 'סיבה', 1)$s$,
   '22023 invalid input'),
  ('cv_rules', 'a continuation reason that is not an id', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b02', 'followup_reason', 'סיבה אחרת', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'an unknown continuation reason', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b02', 'followup_reason', gen_random_uuid()::text, 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'a field time without a UTC offset', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', '2026-11-16 08:00', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'a field time that is not a time', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', 'בבוקר', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'an infinite field time', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', 'infinity', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'an impossible date', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', '2026-02-30T08:00:00+02:00', 'סיבה', 1)$s$, '22023 invalid input'),
  ('cv_rules', 'no change of the summary', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', ' הוחלף חלק ', 'סיבה', 1)$s$, '22023 no change'),
  ('cv_rules', 'no change of a field time (the same instant in another offset)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'departed', to_char((select t.reported_at from public.visit_time_reports t where t.operation_id = '00000000-0000-4000-8000-000000240e01') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z', 'סיבה', 1)$s$,
   '22023 no change');
select results_eq(
  $$ select c.label, pg_temp.tm_run_as(c.setup, c.sub, c.role, c.stmt) from tm_case c where c.grp = 'cv_rules' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'cv_rules' order by c.n $$,
  'correct_visit: the field set, the input, a closed visit, the version, the follow-up fields, the reason, the time format and no change, each refused with its code');

-- ---------------------------------------------------------------------------------------------
-- 3. correct_visit: effects (append-only, versions, history, audit; call status unchanged)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', ' סיכום מתוקן ', 'טעות הקלדה', 1) $$,
  $$ select concat_ws(' | ', c.field, c.old_value::text, c.new_value::text, c.reason, c.version_before, c.version_after,
                      c.corrected_by = '00000000-0000-4000-8000-0000000000a1', c.recorded_at = now(), c.is_test,
                      (select r.summary_text || '/' || r.version from public.visit_reports r where r.visit_id = '00000000-0000-4000-8000-000000240b01'),
                      (select v.version || '/' || v.field_version || '/' || (v.updated_by = '00000000-0000-4000-8000-0000000000a1') from public.visits v where v.id = '00000000-0000-4000-8000-000000240b01'),
                      (select count(*) from public.entity_changes e where e.entity_id = '00000000-0000-4000-8000-000000240b01'))
     from public.visit_corrections c $$),
  'summary | "הוחלף חלק" | "סיכום מתוקן" | טעות הקלדה | 1 | 2 | t | t | t | הוחלף חלק/1 | 2/1/true | 0',
  'a summary correction: one append-only row (old and new value trimmed, reason, versions 1 -> 2, the Manager, server time, test-marked); the treatment summary keeps the as-closed text (OQ-7); the visit''s version rises, not its field_version; no entity_changes row (card content)');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'טעות', 1) $$,
  $$ select concat_ws(' | ', a.action, a.target_table, a.target_id = '00000000-0000-4000-8000-000000240b01', a.target_is_test, a.actor_profile_id = '00000000-0000-4000-8000-0000000000a1',
                      a.details ->> 'field', a.details ->> 'version_before', a.details ->> 'version_after',
                      (a.details ->> 'correction_id')::uuid = (select c.id from public.visit_corrections c),
                      private.audit_chain_verify() is null)
     from public.audit_logs a where a.action = 'visit.corrected' $$),
  'visit.corrected | visits | t | t | t | summary | 1 | 2 | t | t',
  'the correction is audited in the same transaction (target the visit, its test marker, the actor, field, versions and correction id; no value or reason) and the audit chain verifies');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', to_char(now() - interval '140 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'לפי יומן הרכב', 1) $$,
  $$ select concat_ws(' | ', c.old_value = to_jsonb((select t.reported_at from public.visit_time_reports t where t.operation_id = '00000000-0000-4000-8000-000000240e02')),
                      (c.new_value #>> '{}')::timestamptz = date_trunc('second', now() - interval '140 minutes'),
                      t.source, t.kind, t.reported_by_profile_id = '00000000-0000-4000-8000-0000000000a1', t.technician_id = '00000000-0000-4000-8000-0000000000e1',
                      t.device_tz is null and t.device_sent_at is null and t.operation_id is null and t.clock_skew_ms is null,
                      t.row_flags::text, t.received_at = now(),
                      (select cur.source || '/' || (cur.report_id = t.id) || '/' || cur.sequence_flags::text from public.visit_time_current cur
                       where cur.visit_id = '00000000-0000-4000-8000-000000240b01' and cur.kind = 'arrived'),
                      (select count(*) from public.visit_time_reports d where d.visit_id = '00000000-0000-4000-8000-000000240b01' and d.source = 'device'))
     from public.visit_corrections c join public.visit_time_reports t on t.correction_id = c.id $$),
  't | t | correction | arrived | t | t | t | {} | t | correction/true/{} | 3',
  'a field-time correction (D45): the old value is the device report, a new time report (source correction, the Manager, the credited technician, no device values) that visit_time_current prefers; the three device reports stay (originals never overwritten)');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'ended', to_char(now() - interval '125 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'סיבה א', 1);
     select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'ended', to_char(now() - interval '120 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'סיבה ב', 2) $$,
  $$ select concat_ws(' | ', string_agg(c.version_before || '->' || c.version_after, ',' order by c.version_after),
                      (select c2.old_value = c1.new_value from public.visit_corrections c1, public.visit_corrections c2
                       where c1.version_after = 2 and c2.version_after = 3),
                      (select cur.reported_at = date_trunc('second', now() - interval '120 minutes') from public.visit_time_current cur
                       where cur.visit_id = '00000000-0000-4000-8000-000000240b01' and cur.kind = 'ended'),
                      (select v.version from public.visits v where v.id = '00000000-0000-4000-8000-000000240b01'))
     from public.visit_corrections c $$),
  '1->2,2->3 | t | t | 3',
  'a second correction of the same field starts from the first one''s value and wins (the newest correction is current); each raises the visit''s version');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b02', 'followup_reason', (select r.id::text from public.followup_reasons r where r.sort_order = 2), 'סיבה', 1);
     select * from public.correct_visit('00000000-0000-4000-8000-000000240b02', 'next_visit_notes', ' להביא חלק ומדחס ', 'סיבה', 2) $$,
  $$ select concat_ws(' | ', string_agg(e.field || ':' || e.old_value::text || '->' || e.new_value::text || ':' || e.source || ':'
                                        || (e.actor_profile_id = '00000000-0000-4000-8000-0000000000a1') || ':' || e.is_test, ', ' order by e.id),
                      (select (v.followup_reason_id = (select r.id from public.followup_reasons r where r.sort_order = 1))
                              || '/' || v.next_visit_notes from public.visits v where v.id = '00000000-0000-4000-8000-000000240b02'))
     from public.entity_changes e where e.entity_id = '00000000-0000-4000-8000-000000240b02' $$),
  (select concat_ws(' | ',
     'followup_reason_id:' || to_jsonb(r1.id)::text || '->' || to_jsonb(r2.id)::text || ':correction:true:true, '
     || 'next_visit_notes:"להביא חלק"->"להביא חלק ומדחס":correction:true:true', 'true/להביא חלק')
   from public.followup_reasons r1, public.followup_reasons r2 where r1.sort_order = 1 and r2.sort_order = 2),
  'the non-card follow-up fields of a followup visit: an entity_changes row each (source correction, the actor), so `calls` shows the current value; the visit row keeps the as-closed values (OQ-7)');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'סיבה', 1);
     select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'departed', to_char(now() - interval '175 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'סיבה', 2);
     set constraints all immediate $$,
  $$ select concat_ws(' | ', c.status, c.version, c.resolved_at is null,
                      (select count(*) from public.entity_changes e where e.entity_table = 'service_calls'))
     from public.service_calls c where c.id = '00000000-0000-4000-8000-000000240a01' $$),
  'open | 1 | t | 0',
  'corrections never change a visit''s status or outcome (OQ-6), so the call status stays (no recalculation, no history row) and every deferred check passes at COMMIT');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000c1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום של היוצר', 'סיבה', 1) $$,
  $$ select c.corrected_by = '00000000-0000-4000-8000-0000000000c1' and (select a.actor_profile_id = '00000000-0000-4000-8000-0000000000c1' from public.audit_logs a where a.action = 'visit.corrected')
     from public.visit_corrections c $$),
  'true', 'the real Creator corrects a test visit (a real actor may touch test data; the reverse is refused, section 6)');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ create temporary table tm_out on commit drop as
       select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'summary', 'סיכום מתוקן', 'סיבה', 1) $$,
  $$ select concat_ws(' | ', o.correction_id = (select c.id from public.visit_corrections c), o.version_after)
     from tm_out o $$),
  't | 2', 'the wrapper returns the correction id and the visit''s version after it (VersionedResult)');

-- ---------------------------------------------------------------------------------------------
-- 4. resolve_review_item: who decides (D14, D44; TEMPORARY OQ-1, OQ-3)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, setup, sub, role, stmt, expected) values
  ('ri_who', 'the Creator, an open-visit item', null, '00000000-0000-4000-8000-0000000000c1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, 'ok'),
  ('ri_who', 'a Manager (conflicts on by default), an open-visit item', null, '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, 'ok'),
  ('ri_who', 'a Manager, a done-visit item with a note (D14)', null, '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, 'הדיווח הראשון נכון')$s$, 'ok'),
  ('ri_who', 'a Manager, a cancelled-visit item with a note (D14)', null, '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r3'), 1, 'keep_current', null, 'הביטול עומד')$s$, 'ok'),
  ('ri_who', 'Customer Service (conflicts off by default)', null, '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'Customer Service with conflicts on, an open-visit item',
   $s$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, 'ok'),
  ('ri_who', 'Customer Service with conflicts on, a call-level item',
   $s$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r4'), 1, 'keep_current', null, null)$s$, 'ok'),
  ('ri_who', 'Customer Service with conflicts on, a done-visit item (D14: conflicts is not enough)',
   $s$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, 'הערה')$s$, '42501 not authorized'),
  ('ri_who', 'Customer Service with conflicts on, a cancelled-visit item (D14)',
   $s$update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000b1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r3'), 1, 'keep_current', null, 'הערה')$s$, '42501 not authorized'),
  ('ri_who', 'a Manager with conflicts off, an open-visit item',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'a Manager with conflicts off, a done-visit item (TEMPORARY OQ-3)',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key = 'conflicts'$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, 'הערה')$s$, '42501 not authorized'),
  ('ri_who', 'a Manager with card off (TEMPORARY OQ-1)',
   $s$update public.role_permissions set allowed = false where role = 'manager' and permission_key = 'card'$s$,
   '00000000-0000-4000-8000-0000000000a1', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'Technician B, his own submission', null, '00000000-0000-4000-8000-0000000000d2', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r6'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'a deactivated Manager',
   $s$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000a2'$s$, '00000000-0000-4000-8000-0000000000a2', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'a signed-in user without a profile', null, '00000000-0000-4000-8000-0000000000f0', 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_who', 'authenticated without a JWT', null, null, 'authenticated',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null)$s$, '42501 not authorized');
select results_eq(
  $$ select c.label, pg_temp.tm_run_as(c.setup, c.sub, c.role, c.stmt) from tm_case c where c.grp = 'ri_who' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'ri_who' order by c.n $$,
  'resolve_review_item: a D14 item (closed or cancelled visit) by a Manager or the Creator only, never Customer Service with conflicts; other items with conflicts; TEMPORARY: card and conflicts also for D14 items; Technicians, deactivated, profile-less and claim-less callers refused');
select results_eq(
  $$ select x.r, left(pg_temp.tm_run_as(null, null, x.r,
       $q$select public.resolve_review_item(gen_random_uuid(), 1, 'keep_current', null, null)$q$), 5)
     from (values ('anon'), ('service_role')) as x (r) $$,
  $$ values ('anon', '42501'), ('service_role', '42501') $$,
  'anon and service_role cannot execute resolve_review_item (no grant)');

-- ---------------------------------------------------------------------------------------------
-- 5. resolve_review_item: input, state, version and the decisions of PR 1.6 (as the Manager)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, setup, sub, stmt, expected) values
  ('ri_rules', 'an unknown decision', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'approve', null, null)$s$, '22023 invalid input'),
  ('ri_rules', 'per_field without choices', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'per_field', null, null)$s$, '22023 invalid input'),
  ('ri_rules', 'choices without per_field', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', '{"technician": "current"}', null)$s$, '22023 invalid input'),
  ('ri_rules', 'no item id', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item(null, 1, 'keep_current', null, null)$s$, '22023 invalid input'),
  ('ri_rules', 'an unknown item (generic)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item(gen_random_uuid(), 1, 'keep_current', null, null)$s$, '42501 not authorized'),
  ('ri_rules', 'a stale version (D44)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 2, 'keep_current', null, null)$s$, 'PT409 version conflict'),
  ('ri_rules', 'an item already decided', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null);
      select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 2, 'keep_current', null, null)$s$, '55000 the item is already decided'),
  ('ri_rules', 'per_field is not applied yet (TEMPORARY OQ-4)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'per_field', '{"technician": "incoming"}', null)$s$,
   '55000 the decision is not available for this item'),
  ('ri_rules', 'apply_incoming of a re-assignment comes with Step 6 (TEMPORARY OQ-4)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'apply_incoming', null, null)$s$,
   '55000 the decision is not available for this item'),
  ('ri_rules', 'apply_incoming of a SKU change comes with Step 6 (TEMPORARY OQ-4)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r4'), 1, 'apply_incoming', null, null)$s$,
   '55000 the decision is not available for this item'),
  ('ri_rules', 'apply_incoming of a closure of a cancelled visit comes with Step 4 (TEMPORARY OQ-4)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r3'), 1, 'apply_incoming', null, 'לקבל')$s$,
   '55000 the decision is not available for this item'),
  ('ri_rules', 'an invitation never changes a closed visit (D39)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r5'), 1, 'apply_incoming', null, 'לעדכן')$s$,
   '55000 the decision is not available for this item'),
  ('ri_rules', 'a D14 item without a note', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r5'), 1, 'keep_current', null, '  ')$s$, '22023 invalid input'),
  ('ri_rules', 'a D14 item with a note (keep_current)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r5'), 1, 'keep_current', null, 'זימון לא משנה ביקור סגור')$s$, 'ok'),
  ('ri_rules', 'a note with a control character (TEXT-SAFE-ML)', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, 'הערה' || chr(7))$s$, '22023 invalid input'),
  ('ri_rules', 'a note of 501 characters', null, '00000000-0000-4000-8000-0000000000a1',
   $s$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, repeat('א', 501))$s$, '22023 invalid input');
select results_eq(
  $$ select c.label, pg_temp.tm_run_as(c.setup, c.sub, c.role, c.stmt) from tm_case c where c.grp = 'ri_rules' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'ri_rules' order by c.n $$,
  'resolve_review_item: the input, an unknown or decided item, the version, the decisions PR 1.6 applies, D39 for invitations on a closed visit, and the D14 note, each refused with its code');

-- ---------------------------------------------------------------------------------------------
-- 6. resolve_review_item: effects
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r1'), 1, 'keep_current', null, null) $$,
  $$ select concat_ws(' | ', r.status, r.resolution, r.resolved_by = '00000000-0000-4000-8000-0000000000a1', r.resolved_at = now(), r.resolution_note is null,
                      r.version, r.updated_by = '00000000-0000-4000-8000-0000000000a1', r.submitted_version ->> 'technician', r.current_version ->> 'technician',
                      r.base_version ->> 'technician',
                      (select v.technician_id = '00000000-0000-4000-8000-0000000000e2' and v.version = 1 from public.visits v where v.id = '00000000-0000-4000-8000-000000240b03'),
                      (select a.details::text from public.audit_logs a where a.action = 'review_item.resolved' and a.target_id = r.id))
     from public.review_items r where r.dedupe_key = 'pr16-240-r1' $$),
  'resolved | keep_current | t | t | t | 2 | t | טכנאי א | טכנאי ב | טכנאי ב | t | {"decision": "keep_current", "review_type": "reassignment", "closed_visit": false}',
  'keep_current: the item is decided once (server time, the Manager, version 2); both versions and the base stay as stored (D44); the visit is unchanged; audited');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'apply_incoming', null, 'הדיווח השני נכון') $$,
  $$ select concat_ws(' | ', t.source, t.kind, t.reported_by_profile_id = '00000000-0000-4000-8000-0000000000d1', t.technician_id = '00000000-0000-4000-8000-0000000000e1',
                      t.operation_id = '00000000-0000-4000-8000-000000240f02', t.received_at = r.created_at,
                      t.reported_at = (r.submitted_version ->> 'reported_at')::timestamptz,
                      t.device_tz || '/' || t.device_utc_offset_min, t.clock_skew_ms is not null,
                      (select cur.report_id = t.id from public.visit_time_current cur where cur.visit_id = '00000000-0000-4000-8000-000000240b01' and cur.kind = 'departed'),
                      (select count(*) from public.visit_time_reports d where d.visit_id = '00000000-0000-4000-8000-000000240b01' and d.kind = 'departed' and d.source = 'device'),
                      (select v.version || '/' || v.field_version || '/' || v.status from public.visits v where v.id = '00000000-0000-4000-8000-000000240b01'),
                      r.resolution_note,
                      (select a.details::text from public.audit_logs a where a.action = 'review_item.resolved'))
     from public.review_items r join public.visit_time_reports t on t.accepted_review_id = r.id
     where r.dedupe_key = 'pr16-240-r2' $$),
  'correction | departed | t | t | t | t | t | Asia/Jerusalem/120 | t | t | 1 | 2/1/done | הדיווח השני נכון | {"decision": "apply_incoming", "review_type": "duplicate_time_report", "closed_visit": true}',
  'apply_incoming of a second departure report on a done visit (PR 1.5 OQ-11, D14 with a note): a correction time report credited to the reporting Technician with his operation id and device values, its original receipt time kept (OQ-13) and its skew computed; visit_time_current prefers it, the device report stays; the visit''s version rises (status and field_version unchanged); audited as a closed-visit decision');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r6'), 1, 'apply_incoming', null, null) $$,
  $$ select concat_ws(' | ', t.reported_by_profile_id = '00000000-0000-4000-8000-0000000000d2', t.technician_id = '00000000-0000-4000-8000-0000000000e2',
                      (select cur.source from public.visit_time_current cur where cur.visit_id = '00000000-0000-4000-8000-000000240b03' and cur.kind = 'arrived'),
                      r.resolution_note is null, (select v.status from public.visits v where v.id = '00000000-0000-4000-8000-000000240b03'))
     from public.review_items r join public.visit_time_reports t on t.accepted_review_id = r.id
     where r.dedupe_key = 'pr16-240-r6' $$),
  't | t | correction | t | scheduled',
  'a second device report on an open visit is accepted with conflicts and no note; it becomes the current arrival, credited to Technician B, and the visit keeps its status');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1',
  $$ select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r3'), 1, 'keep_current', null, 'הביטול עומד');
     select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'apply_incoming', null, 'אושר');
     set constraints all immediate $$,
  $$ select concat_ws(' | ', c.status, c.version, (select v.status from public.visits v where v.id = '00000000-0000-4000-8000-000000240b04'),
                      (select count(*) from public.entity_changes e where e.entity_table = 'service_calls'),
                      private.audit_chain_verify() is null)
     from public.service_calls c where c.id = '00000000-0000-4000-8000-000000240a01' $$),
  'open | 1 | cancelled | 0 | t',
  'no decision of PR 1.6 changes a visit''s status (the cancellation stands, D44), so the call status stays, every deferred check passes and the audit chain verifies');

-- Independent review S1: a second device report never silently supersedes an office correction of
-- the same field time recorded after the report was received (both happen in this transaction,
-- after the fixture created r2, so the correction counts as later).
select results_eq(
  $$ select x.label, pg_temp.tm_as('00000000-0000-4000-8000-0000000000a1', x.stmt)
     from (values
       (1, 'a correction of the departure, then the second departure report accepted',
        $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'departed', to_char(now() - interval '176 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'לפי יומן', 1);
           select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'apply_incoming', null, 'אושר')$q$),
       (2, 'the same, then kept as it was (keep_current stays possible)',
        $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'departed', to_char(now() - interval '176 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'לפי יומן', 1);
           select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'keep_current', null, 'התיקון נשאר')$q$),
       (3, 'a correction of another field (the arrival) does not block it',
        $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b01', 'arrived', to_char(now() - interval '141 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'לפי יומן', 1);
           select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-r2'), 1, 'apply_incoming', null, 'אושר')$q$)
     ) as x (n, label, stmt) order by x.n $$,
  $$ values ('a correction of the departure, then the second departure report accepted', 'PT409 version conflict'),
            ('the same, then kept as it was (keep_current stays possible)', 'ok'),
            ('a correction of another field (the arrival) does not block it', 'ok') $$,
  'review S1: accepting a second device report after an office correction of the same field time is refused like a stale version (PT409); keep_current and other fields are unaffected');

-- ---------------------------------------------------------------------------------------------
-- 7. Simulated go-live (rolled back): a real call and visit (the pre-go-live CHECKs are relaxed
--    here only, PR 1.3 Q3 reading). D47: a test caller never corrects or decides a real record;
--    the real Creator does.
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
insert into public.customers (id, customer_number, name, phone, data_source, source_ref, created_by)
  values ('00000000-0000-4000-8000-000000240c09', 'R-2409', 'לקוח אמיתי', '050-000-2409', 'microsoft_graph', 'graph-240',
          '00000000-0000-4000-8000-0000000000c1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref, created_by)
  values ('00000000-0000-4000-8000-000000240d09', 'rp-2409', 'RP-2409', 'מוצר אמיתי', 'microsoft_graph', 'graph-240',
          '00000000-0000-4000-8000-0000000000c1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, resolved_at, data_source, source_ref, created_by)
values ('00000000-0000-4000-8000-000000240a09', 'REQ-240R', '00000000-0000-4000-8000-000000240c09',
        '00000000-0000-4000-8000-000000240d09', (select c.id from public.call_types c where c.sort_order = 1), 'לא מקרר',
        'נציג', 'resolved', 2, now(), 'microsoft_graph', 'graph-evt-240', '00000000-0000-4000-8000-0000000000c1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
values ('00000000-0000-4000-8000-000000240b09', '00000000-0000-4000-8000-000000240a09', '00000000-0000-4000-8000-0000000000e9',
        1, 'KR1', now() - interval '2 hours', now() - interval '1 hour', 'done', 'חיפה', 'הנמל 1', 'graph-evt-240');
insert into public.visit_reports (visit_id, summary_text, summary_source)
  values ('00000000-0000-4000-8000-000000240b09', 'טופל', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-000000240b09', 'חותם', 'נוסח', encode(sha256(convert_to('נוסח', 'UTF8')), 'hex'), gen_random_uuid());
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-000000240b09', 1, 'created', 'done');
select private.create_review_item('sku_change', 'pr16-240-real', '00000000-0000-4000-8000-000000240a09', null, 'invitation',
  'graph-evt-240-2', null, '{"sku": "RP-9"}', '{"sku": "RP-2409"}', null);
select lives_ok('set constraints all immediate', 'simulated go-live: the real call, its done visit and a real review item pass every deferred check');
set constraints all deferred;
select results_eq(
  $$ select x.label, pg_temp.tm_as(x.sub::uuid, x.stmt)
     from (values
       (1, 'a test Manager corrects a real visit', '00000000-0000-4000-8000-0000000000a1',
        $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b09', 'summary', 'טופל היטב', 'סיבה', 1)$q$),
       (2, 'a test Manager decides a real review item', '00000000-0000-4000-8000-0000000000a1',
        $q$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-real'), 1, 'keep_current', null, null)$q$),
       (3, 'the real Creator corrects a real visit', '00000000-0000-4000-8000-0000000000c1',
        $q$select * from public.correct_visit('00000000-0000-4000-8000-000000240b09', 'summary', 'טופל היטב', 'סיבה', 1)$q$),
       (4, 'the real Creator decides a real review item', '00000000-0000-4000-8000-0000000000c1',
        $q$select public.resolve_review_item((select r.id from public.review_items r where r.dedupe_key = 'pr16-240-real'), 1, 'keep_current', null, null)$q$)
     ) as x (n, label, sub, stmt) order by x.n $$,
  $$ values ('a test Manager corrects a real visit', '42501 not authorized'),
            ('a test Manager decides a real review item', '42501 not authorized'),
            ('the real Creator corrects a real visit', 'ok'), ('the real Creator decides a real review item', 'ok') $$,
  'D47: a test caller never corrects or decides a real record (generic 42501); the real Creator does');
select is(pg_temp.tm_as('00000000-0000-4000-8000-0000000000c1',
  $$ select * from public.correct_visit('00000000-0000-4000-8000-000000240b09', 'summary', 'טופל היטב', 'סיבה', 1) $$,
  $$ select concat_ws(' | ', c.is_test, (select a.target_is_test from public.audit_logs a where a.action = 'visit.corrected'))
     from public.visit_corrections c $$),
  'f | f', 'a correction of a real visit is real-marked (from the visit), and so is its audit row');

select * from finish();
rollback;
