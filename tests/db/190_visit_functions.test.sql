-- PR 1.5: the narrow read functions (docs/database-schema.md §8, §9; plan §6.1, §6.3; D36, D40;
-- docs/testing.md categories 3 and 5; D58 (5): permissions and role isolation first). Covered:
-- the exact result columns of previous_visits, visit_rep_contact and my_visit_details; EXECUTE
-- privileges (only authenticated, only the three wrappers and their bodies); can_read_visit per
-- branch (office keys, own visit, D36 earlier closed visit of the same call; never a later,
-- concurrent or cancelled visit or another call); previous_visits for the caller's own open visit
-- only, with its revocation on re-assignment, closure, cancellation and deactivation;
-- visit_rep_contact and my_visit_details for the caller's own open visit or own visit closed today
-- only, NULL phone for an inactive or Technician-role representative, deactivated labels returned;
-- 42501 for office callers, other Technicians, users without a profile and tampered ids.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   OQ-1  D36 earlier visits only through previous_visits, only for the caller's own open visit;
--   OQ-8  the representative's work phone only while his profile is active with an office role;
--   OQ-9  no second customer phone; PR 1.4 OQ-12: no brand or supplier; OQ-7: no raw warranty text;
--   OQ-10 the call details and the representative of a visit closed today (Asia/Jerusalem) stay
--         available to its Technician; a visit closed before today or cancelled does not.
--
-- Fixture (fictional, example.test, automated_test; D47):
--   call P (open, rep = active Manager with a work phone): P1 B followup (reason later
--     deactivated, next-visit notes, summary), P2 B cancelled, P3 A scheduled (pickup place later
--     deactivated), P4 B scheduled, P5 B done (summary, signature);
--   call Q (resolved, rep = inactive Manager with a work phone): Q1 A done today;
--   call Y (resolved, rep = active Manager): Y1 A done two days ago (back-dated with t12 disabled);
--   call R (awaiting_scheduling): R1 A cancelled;
--   call U (open, rep = Technician B's profile): U1 A scheduled.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_call: runs p_setup as postgres, then p_query (one text value) as the given authenticated
-- user (or anon when p_sub is null), in one subtransaction that is always undone; returns the
-- query's value or the SQLSTATE of the first error.
create function pg_temp.tm_call(p_sub text, p_query text, p_setup text default 'select 1')
returns text
language plpgsql
as $f$
declare
  v_result text;
  v_done boolean := false;
begin
  begin
    execute p_setup;
    if p_sub is null then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute p_query into v_result;
    v_done := true;
    raise exception using errcode = 'TM001', message = 'undo the scenario';
  exception when others then
    if not v_done then
      v_result := sqlstate;
    end if;
  end;
  return coalesce(v_result, '-');
end
$f$;

-- tm_id: fixture ids by short name.
create function pg_temp.tm_id(p_name text)
returns uuid
language sql
immutable
as $f$
  select v.id from (values
    ('creator', '00000000-0000-4000-8000-0000000000c1'::uuid), ('manager', '00000000-0000-4000-8000-0000000000a1'::uuid),
    ('manager_off', '00000000-0000-4000-8000-0000000000a9'::uuid), ('cs', '00000000-0000-4000-8000-0000000000b1'::uuid),
    ('tech_a_profile', '00000000-0000-4000-8000-0000000000d1'::uuid), ('tech_b_profile', '00000000-0000-4000-8000-0000000000d2'::uuid),
    ('no_profile', '00000000-0000-4000-8000-0000000000f1'::uuid),
    ('tech_a', '00000000-0000-4000-8000-0000000000e1'::uuid), ('tech_b', '00000000-0000-4000-8000-0000000000e2'::uuid),
    ('customer', '00000000-0000-4000-8000-000000190c01'::uuid), ('product', '00000000-0000-4000-8000-000000190d01'::uuid),
    ('reason', '00000000-0000-4000-8000-000000190f01'::uuid), ('place', '00000000-0000-4000-8000-000000190e01'::uuid),
    ('P', '00000000-0000-4000-8000-000000190a01'::uuid), ('Q', '00000000-0000-4000-8000-000000190a02'::uuid),
    ('Y', '00000000-0000-4000-8000-000000190a03'::uuid), ('R', '00000000-0000-4000-8000-000000190a04'::uuid),
    ('U', '00000000-0000-4000-8000-000000190a05'::uuid),
    ('P1', '00000000-0000-4000-8000-000000190b11'::uuid), ('P2', '00000000-0000-4000-8000-000000190b12'::uuid),
    ('P3', '00000000-0000-4000-8000-000000190b13'::uuid), ('P4', '00000000-0000-4000-8000-000000190b14'::uuid),
    ('P5', '00000000-0000-4000-8000-000000190b15'::uuid), ('Q1', '00000000-0000-4000-8000-000000190b21'::uuid),
    ('Y1', '00000000-0000-4000-8000-000000190b31'::uuid), ('R1', '00000000-0000-4000-8000-000000190b41'::uuid),
    ('U1', '00000000-0000-4000-8000-000000190b51'::uuid),
    ('random', '00000000-0000-4000-8000-000000190999'::uuid)) v (name, id)
  where v.name = p_name
$f$;

-- tm_readable: as postgres with the given user's claims, the fixture visits can_read_visit allows.
create function pg_temp.tm_readable(p_sub uuid)
returns text
language plpgsql
as $f$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(v.task_number, ',' order by v.task_number collate "C"), '-') into v_result
  from public.visits v where v.source_ref like 'pr15-190-%' and private.can_read_visit(v.id);
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end
$f$;
grant execute on function pg_temp.tm_id(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Fixtures (local, rolled back)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a9', 'b1', 'd1', 'd2', 'f1']) as k;
select private.bootstrap_first_creator(pg_temp.tm_id('creator'), 'יוצר');
insert into public.profiles (id, role, full_name, is_active, work_phone) values
  (pg_temp.tm_id('manager'), 'manager', 'מנהל א', true, '03-000-0190'),
  (pg_temp.tm_id('manager_off'), 'manager', 'מנהל לא פעיל', false, '03-000-0199'),
  (pg_temp.tm_id('cs'), 'customer_service', 'נציגה א', true, null),
  (pg_temp.tm_id('tech_a_profile'), 'technician', 'טכנאי א', true, null),
  (pg_temp.tm_id('tech_b_profile'), 'technician', 'טכנאי ב', true, '050-000-1902');
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  (pg_temp.tm_id('tech_a'), pg_temp.tm_id('tech_a_profile'), true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  (pg_temp.tm_id('tech_b'), pg_temp.tm_id('tech_b_profile'), true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, phone_alt, data_source, source_ref) values
  (pg_temp.tm_id('customer'), 'C-1901', 'לקוח בדיקה', '050-000-1901', '050-000-1909', 'automated_test', 'pr15-190-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  (pg_temp.tm_id('product'), 'kt-1901', 'KT-1901', 'מוצר בדיקה', 'automated_test', 'pr15-190-1');
insert into public.followup_reasons (id, label_he, sort_order, is_active, is_user_added, is_test, created_by) values
  (pg_temp.tm_id('reason'), 'סיבת בדיקה', 6, true, true, true, pg_temp.tm_id('creator'));
insert into public.collection_locations (id, name, place_type, sort_order, address, created_by) values
  (pg_temp.tm_id('place'), 'מחסן בדיקה', 'logistics_center', 1, 'רחוב המחסן 1', pg_temp.tm_id('creator'));

insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  warranty_status, warranty_until, warranty_raw, handling_rep_name,
                                  handling_rep_profile_id, status, next_visit_number, resolved_at, data_source, source_ref)
select pg_temp.tm_id(x.name), x.req, pg_temp.tm_id('customer'), pg_temp.tm_id('product'),
       (select t.id from public.call_types t where t.sort_order = 1), 'תקלת בדיקה',
       x.w_status, x.w_until::date, x.w_raw, x.rep_name, pg_temp.tm_id(x.rep), x.status, x.next_n,
       case when x.status = 'resolved' then now() end, 'automated_test', 'pr15-190-' || lower(x.name)
from (values
  ('P', 'R-1901', 'yes', '2027-05-01', 'כן עד 05/27', 'נציג פעיל', 'manager', 'open', 6),
  ('Q', 'R-1902', null, null, null, 'נציג לא פעיל', 'manager_off', 'resolved', 2),
  ('Y', 'R-1903', null, null, null, 'נציג פעיל', 'manager', 'resolved', 2),
  ('R', 'R-1904', null, null, null, 'נציג', null, 'awaiting_scheduling', 2),
  ('U', 'R-1905', null, null, null, 'טכנאי כנציג', 'tech_b_profile', 'open', 2)
) as x (name, req, w_status, w_until, w_raw, rep_name, rep, status, next_n);
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, pickup_location_id, followup_reason_id, next_visit_notes, cancelled_by,
                           source_ref)
select pg_temp.tm_id(x.name), pg_temp.tm_id(x.call), pg_temp.tm_id(x.tech), x.n, x.name, x.day::timestamptz,
       x.day::timestamptz + interval '1 hour', x.status, 'עיר בדיקה', 'רחוב הבדיקה 1', pg_temp.tm_id(x.place),
       pg_temp.tm_id(x.reason), x.notes, case when x.status = 'cancelled' then pg_temp.tm_id('manager') end,
       'pr15-190-' || lower(x.name)
from (values
  ('P1', 'P', 'tech_b', 1, '2026-11-02 08:00:00+00', 'followup', null, 'reason', 'להביא חלק חילוף'),
  ('P2', 'P', 'tech_b', 2, '2026-11-04 08:00:00+00', 'cancelled', null, null, null),
  ('P3', 'P', 'tech_a', 3, '2026-11-20 08:00:00+00', 'scheduled', 'place', null, null),
  ('P4', 'P', 'tech_b', 4, '2026-11-21 08:00:00+00', 'scheduled', null, null, null),
  ('P5', 'P', 'tech_b', 5, '2026-11-05 08:00:00+00', 'done', null, null, null),
  ('Q1', 'Q', 'tech_a', 1, '2026-11-10 08:00:00+00', 'done', null, null, null),
  ('Y1', 'Y', 'tech_a', 1, '2026-11-08 08:00:00+00', 'done', null, null, null),
  ('R1', 'R', 'tech_a', 1, '2026-11-23 08:00:00+00', 'cancelled', null, null, null),
  ('U1', 'U', 'tech_a', 1, '2026-11-24 08:00:00+00', 'scheduled', null, null, null)
) as x (name, call, tech, n, day, status, place, reason, notes);
insert into public.visit_reports (visit_id, summary_text, summary_source)
select pg_temp.tm_id(x.name), x.summary, 'written'
from (values ('P1', 'אובחנה תקלה; נדרש חלק'), ('P5', 'סיכום מאוחר של טכנאי ב'), ('Q1', 'סיכום של טכנאי א'),
             ('Y1', 'סיכום ישן של טכנאי א')) as x (name, summary);
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
select pg_temp.tm_id(x.name), 'חותם בדיקה', 'אני מאשר/ת שהטיפול בוצע.',
       encode(sha256(convert_to('אני מאשר/ת שהטיפול בוצע.', 'UTF8')), 'hex'), x.op::uuid
from (values ('P5', '00000000-0000-4000-8000-000000190f15'), ('Q1', '00000000-0000-4000-8000-000000190f21'),
             ('Y1', '00000000-0000-4000-8000-000000190f31')) as x (name, op);
insert into public.visit_events (visit_id, version_after, event_type, to_status)
select v.id, 1, 'created', v.status from public.visits v where v.source_ref like 'pr15-190-%';
-- Deactivated after use: their labels must still be returned.
update public.followup_reasons r set is_active = false where r.id = pg_temp.tm_id('reason');
update public.collection_locations l set is_active = false where l.id = pg_temp.tm_id('place');
select lives_ok('set constraints all immediate', 'the fixture passes every deferred check');
set constraints all deferred;
-- Y1 was closed two days ago (no writer can set a past server time; t12 disabled, V22).
alter table public.visits disable trigger t12_visit_state;
update public.visits v set closed_at = now() - interval '2 days' where v.id = pg_temp.tm_id('Y1');
update public.service_calls c set resolved_at = now() - interval '2 days' where c.id = pg_temp.tm_id('Y');
select lives_ok('set constraints all immediate', 'the back-dated fixture still passes every deferred check');
alter table public.visits enable trigger t12_visit_state;
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 2. Catalog: result columns and EXECUTE privileges
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select f.f, pg_get_function_result(f.f::regprocedure)
     from unnest(array['public.previous_visits(uuid)', 'public.visit_rep_contact(uuid)', 'public.my_visit_details(uuid)'])
          with ordinality as f (f, n) order by f.n $$,
  $$ values
     ('public.previous_visits(uuid)', 'TABLE(visit_number integer, scheduled_start timestamp with time zone, status text, technician_name text, technician_color text, followup_reason_label text, next_visit_notes text, summary_text text, summary_source text, is_test boolean)'),
     ('public.visit_rep_contact(uuid)', 'TABLE(rep_name text, work_phone text)'),
     ('public.my_visit_details(uuid)', 'TABLE(request_number text, call_type_label text, fault_description text, warranty_status text, warranty_until date, is_test boolean, customer_number text, customer_name text, customer_phone text, product_sku_display text, product_name text, pickup_location_name text, pickup_location_type text, pickup_location_address text, followup_reason_label text)') $$,
  'exact result columns: no technician id, scheduled end, signer, times or address in previous_visits; no second phone, brand, supplier or raw warranty text in my_visit_details');
select results_eq(
  $$ select f.f, has_function_privilege('anon', f.f, 'execute'), has_function_privilege('authenticated', f.f, 'execute'),
            has_function_privilege('service_role', f.f, 'execute')
     from unnest(array['public.previous_visits(uuid)', 'public.visit_rep_contact(uuid)', 'public.my_visit_details(uuid)',
                       'private.previous_visits(uuid)', 'private.visit_rep_contact(uuid)', 'private.my_visit_details(uuid)',
                       'private.can_read_visit(uuid)', 'private.compute_call_status(uuid)', 'private.recalc_call_status(uuid)',
                       'private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)']) with ordinality as f (f, n)
     order by f.n $$,
  $$ values ('public.previous_visits(uuid)', false, true, false), ('public.visit_rep_contact(uuid)', false, true, false),
            ('public.my_visit_details(uuid)', false, true, false), ('private.previous_visits(uuid)', false, true, false),
            ('private.visit_rep_contact(uuid)', false, true, false), ('private.my_visit_details(uuid)', false, true, false),
            ('private.can_read_visit(uuid)', false, false, false), ('private.compute_call_status(uuid)', false, false, false),
            ('private.recalc_call_status(uuid)', false, false, false),
            ('private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)', false, false, false) $$,
  'EXECUTE: only authenticated, only the three wrappers and their bodies; can_read_visit, the status functions and the history writer are not callable by any API role');
select results_eq(
  $$ select x.who, pg_temp.tm_call(x.sub, x.q)
     from (values
       ('anon', null::text, $q$ select count(*)::text from public.previous_visits(pg_temp.tm_id('P3')) $q$),
       ('authenticated can_read_visit', '00000000-0000-4000-8000-0000000000d1', $q$ select private.can_read_visit(pg_temp.tm_id('P3'))::text $q$),
       ('authenticated recalc_call_status', '00000000-0000-4000-8000-0000000000c1', $q$ select private.recalc_call_status(pg_temp.tm_id('P')) $q$)
     ) as x (who, sub, q) $$,
  $$ values ('anon', '42501'), ('authenticated can_read_visit', '42501'), ('authenticated recalc_call_status', '42501') $$,
  'anon cannot call the wrappers; no signed-in user (the Creator included) can call can_read_visit or the status writer');

-- ---------------------------------------------------------------------------------------------
-- 3. can_read_visit per branch (called as its owner with each user's claims)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.who, pg_temp.tm_readable(pg_temp.tm_id(x.who))
     from unnest(array['tech_a_profile', 'tech_b_profile', 'manager', 'cs', 'creator', 'manager_off', 'no_profile'])
          with ordinality as x (who, n) order by x.n $$,
  $$ values ('tech_a_profile', 'P1,P3,Q1,R1,U1,Y1'), ('tech_b_profile', 'P1,P2,P4,P5'),
            ('manager', 'P1,P2,P3,P4,P5,Q1,R1,U1,Y1'), ('cs', 'P1,P2,P3,P4,P5,Q1,R1,U1,Y1'),
            ('creator', 'P1,P2,P3,P4,P5,Q1,R1,U1,Y1'), ('manager_off', '-'), ('no_profile', '-') $$,
  'can_read_visit: Technician A reads his own visits and B''s earlier closed P1 (D36), never B''s cancelled P2, open P4 or later closed P5; office keys read all; inactive or profile-less users nothing');

-- ---------------------------------------------------------------------------------------------
-- 4. previous_visits (D36, TEMPORARY OQ-1)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
  $q$ select string_agg(concat_ws(' / ', p.visit_number, p.scheduled_start = '2026-11-02 08:00:00+00', p.status,
                                  p.technician_name, p.technician_color, p.followup_reason_label, p.next_visit_notes,
                                  p.summary_text, p.summary_source, p.is_test), ' ; ' order by p.visit_number)
     from public.previous_visits(pg_temp.tm_id('P3')) p $q$),
  '1 / t / followup / טכנאי ב / t-e / סיבת בדיקה / להביא חלק חילוף / אובחנה תקלה; נדרש חלק / written / t',
  'Technician A''s open P3: exactly B''s earlier closed P1 with its summary and the deactivated reason''s label; not the cancelled P2, the open P4 or the later P5');
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d2',
  $q$ select string_agg(p.visit_number::text || ' ' || p.status, ', ' order by p.visit_number)
     from public.previous_visits(pg_temp.tm_id('P4')) p $q$),
  '1 followup',
  'Technician B''s open P4: the earlier closed P1 only (A''s open P3 is not closed)');
select results_eq(
  $$ select x.case_name, pg_temp.tm_call(x.sub, $q$ select count(*)::text from public.previous_visits(pg_temp.tm_id('$q$ || x.visit || $q$')) $q$)
     from (values
       ('own closed visit', '00000000-0000-4000-8000-0000000000d1', 'Q1'),
       ('own cancelled visit', '00000000-0000-4000-8000-0000000000d1', 'R1'),
       ('another technician''s open visit', '00000000-0000-4000-8000-0000000000d1', 'P4'),
       ('a random id', '00000000-0000-4000-8000-0000000000d1', 'random'),
       ('the Manager', '00000000-0000-4000-8000-0000000000a1', 'P3'),
       ('the Creator', '00000000-0000-4000-8000-0000000000c1', 'P3'),
       ('Customer Service', '00000000-0000-4000-8000-0000000000b1', 'P3'),
       ('a user without a profile', '00000000-0000-4000-8000-0000000000f1', 'P3')
     ) as x (case_name, sub, visit) $$,
  $$ values ('own closed visit', '42501'), ('own cancelled visit', '42501'), ('another technician''s open visit', '42501'),
            ('a random id', '42501'), ('the Manager', '42501'), ('the Creator', '42501'), ('Customer Service', '42501'),
            ('a user without a profile', '42501') $$,
  'previous_visits answers 42501 for anything but the caller''s own open visit (office callers included)');
select results_eq(
  $$ select x.case_name, pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
       $q$ select count(*)::text from public.previous_visits(pg_temp.tm_id('P3')) $q$, x.setup)
     from (values
       ('re-assigned to B', $s$ update public.visits v set technician_id = pg_temp.tm_id('tech_b') where v.id = pg_temp.tm_id('P3') $s$),
       ('closed', $s$ update public.visits v set status = 'done' where v.id = pg_temp.tm_id('P3') $s$),
       ('cancelled', $s$ update public.visits v set status = 'cancelled', cancelled_by = pg_temp.tm_id('manager') where v.id = pg_temp.tm_id('P3') $s$),
       ('deactivated', $s$ update public.profiles p set is_active = false where p.id = pg_temp.tm_id('tech_a_profile') $s$),
       ('unchanged', 'select 1')
     ) as x (case_name, setup) $$,
  $$ values ('re-assigned to B', '42501'), ('closed', '42501'), ('cancelled', '42501'), ('deactivated', '42501'),
            ('unchanged', '1') $$,
  'D36 revocation is immediate: after re-assignment, closure, cancellation or deactivation Technician A gets 42501 (positive control: 1 row unchanged)');

-- ---------------------------------------------------------------------------------------------
-- 5. visit_rep_contact (D40, TEMPORARY OQ-8, OQ-10)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.visit, pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
       $q$ select coalesce(string_agg(concat_ws(' / ', c.rep_name, coalesce(c.work_phone, 'NULL')), ' ; '), '-')
           from public.visit_rep_contact(pg_temp.tm_id('$q$ || x.visit || $q$')) c $q$)
     from unnest(array['P3', 'Q1', 'U1', 'Y1', 'R1', 'P4', 'random']) with ordinality as x (visit, n) order by x.n $$,
  $$ values ('P3', 'נציג פעיל / 03-000-0190'), ('Q1', 'נציג לא פעיל / NULL'), ('U1', 'טכנאי כנציג / NULL'),
            ('Y1', '42501'), ('R1', '42501'), ('P4', '42501'), ('random', '42501') $$,
  'visit_rep_contact for Technician A: name and work phone for his open visit; NULL phone for an inactive or Technician-role representative (visit closed today, open visit); 42501 for his visit closed two days ago, his cancelled visit, B''s visit and a random id');
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
  $q$ select concat_ws(' / ', c.rep_name, coalesce(c.work_phone, 'NULL')) from public.visit_rep_contact(pg_temp.tm_id('P3')) c $q$,
  $s$ update public.profiles p set is_active = false where p.id = pg_temp.tm_id('manager') $s$),
  'נציג פעיל / NULL', 'the representative''s phone disappears at once when his profile is deactivated');
select results_eq(
  $$ select x.sub, pg_temp.tm_call(x.sub, $q$ select count(*)::text from public.visit_rep_contact(pg_temp.tm_id('P3')) $q$)
     from unnest(array['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',
                       '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000f1']) with ordinality as x (sub, n)
     order by x.n $$,
  $$ values ('00000000-0000-4000-8000-0000000000a1', '42501'), ('00000000-0000-4000-8000-0000000000c1', '42501'),
            ('00000000-0000-4000-8000-0000000000d2', '42501'), ('00000000-0000-4000-8000-0000000000f1', '42501') $$,
  'visit_rep_contact: 42501 for the Manager, the Creator, Technician B and a user without a profile');

-- ---------------------------------------------------------------------------------------------
-- 6. my_visit_details (TEMPORARY OQ-9, OQ-10, OQ-12)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
  $q$ select concat_ws(' / ', d.request_number, d.call_type_label, d.fault_description, d.warranty_status,
                       d.warranty_until, d.is_test, d.customer_number, d.customer_name, d.customer_phone,
                       d.product_sku_display, d.product_name, d.pickup_location_name, d.pickup_location_type,
                       d.pickup_location_address, coalesce(d.followup_reason_label, 'NULL'))
     from public.my_visit_details(pg_temp.tm_id('P3')) d $q$),
  'R-1901 / ' || (select t.label_he from public.call_types t where t.sort_order = 1)
    || ' / תקלת בדיקה / yes / 2027-05-01 / t / C-1901 / לקוח בדיקה / 050-000-1901 / kt-1901 / מוצר בדיקה / מחסן בדיקה / logistics_center / רחוב המחסן 1 / NULL',
  'my_visit_details for A''s open P3: call, customer (first phone only), product (no brand or supplier) and the deactivated pickup place''s details');
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
  $q$ select d.request_number from public.my_visit_details(pg_temp.tm_id('Q1')) d $q$),
  'R-1902', 'my_visit_details for A''s visit closed today (TEMPORARY OQ-10)');
select results_eq(
  $$ select x.case_name, pg_temp.tm_call(x.sub, $q$ select count(*)::text from public.my_visit_details(pg_temp.tm_id('$q$ || x.visit || $q$')) $q$)
     from (values
       ('own visit closed two days ago', '00000000-0000-4000-8000-0000000000d1', 'Y1'),
       ('own cancelled visit', '00000000-0000-4000-8000-0000000000d1', 'R1'),
       ('another technician''s visit', '00000000-0000-4000-8000-0000000000d1', 'P4'),
       ('a random id', '00000000-0000-4000-8000-0000000000d1', 'random'),
       ('the Manager', '00000000-0000-4000-8000-0000000000a1', 'P3'),
       ('the Creator', '00000000-0000-4000-8000-0000000000c1', 'P3'),
       ('a user without a profile', '00000000-0000-4000-8000-0000000000f1', 'P3'),
       ('anon', null, 'P3')
     ) as x (case_name, sub, visit) $$,
  $$ values ('own visit closed two days ago', '42501'), ('own cancelled visit', '42501'),
            ('another technician''s visit', '42501'), ('a random id', '42501'), ('the Manager', '42501'),
            ('the Creator', '42501'), ('a user without a profile', '42501'), ('anon', '42501') $$,
  'my_visit_details answers 42501 for anything but the caller''s own open visit or own visit closed today');
select is(pg_temp.tm_call('00000000-0000-4000-8000-0000000000d1',
  $q$ select count(*)::text from public.my_visit_details(pg_temp.tm_id('P3')) $q$,
  $s$ update public.profiles p set is_active = false where p.id = pg_temp.tm_id('tech_a_profile') $s$),
  '42501', 'my_visit_details: a deactivated Technician is refused at once');

-- ---------------------------------------------------------------------------------------------
-- 7. The functions never write and leak nothing into history
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select p.proname::text collate "default", p.provolatile::text collate "default", p.prosecdef
     from pg_proc p
     where p.oid in ('private.previous_visits(uuid)'::regprocedure, 'private.visit_rep_contact(uuid)'::regprocedure,
                     'private.my_visit_details(uuid)'::regprocedure, 'private.can_read_visit(uuid)'::regprocedure,
                     'public.previous_visits(uuid)'::regprocedure, 'public.visit_rep_contact(uuid)'::regprocedure,
                     'public.my_visit_details(uuid)'::regprocedure)
     order by p.pronamespace::regnamespace::text, p.proname $$,
  $$ values ('can_read_visit', 's', true), ('my_visit_details', 's', true), ('previous_visits', 's', true),
            ('visit_rep_contact', 's', true), ('my_visit_details', 's', false), ('previous_visits', 's', false),
            ('visit_rep_contact', 's', false) $$,
  'the bodies are STABLE SECURITY DEFINER (each checks its caller); the public wrappers are STABLE SECURITY INVOKER');
select is((select count(*)::integer from public.entity_changes), 0, 'no history row was written by any read');
select is((select count(*)::integer from public.visits v where v.source_ref like 'pr15-190-%' and v.technician_id = pg_temp.tm_id('tech_a')), 5,
  'every scenario was undone: Technician A still has his five fixture visits');

select * from finish();
rollback;
