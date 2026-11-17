-- Step 6: the ingestion writer private.ingest_calendar_event through its public wrapper (Migration 6;
-- D08, D17, D19, D24, D38, D39, D44, D47; X-01, X-03, S-05; docs/testing.md categories 2-5, 7-9, 12,
-- 13). Covered: who may call it (D24, SIM-10: Manager, Creator and Customer Service; not a
-- Technician, an inactive or profile-less user, anon or service_role); malformed commands (22023);
-- a new invitation creates the customer, the product, the call and visit 1, all test data from the
-- simulator (D47) with their source; a replay changes nothing and returns the stored outcome; the
-- same change key with other content is refused (23505); an older change is recorded as stale and
-- never applied; a new version reschedules and re-assigns a scheduled visit with field history;
-- a follow-up invitation with the same request number is the next visit of the same call (X-03)
-- and reopens a resolved call (D38); a closed visit is never changed (D39); the unparsed list keeps
-- one open row per invitation with machine-readable reasons, resolved by a later version (S-05);
-- the Settings lookups (technician, call type, pickup place) and the conflicts (a changed request
-- number, real records) are listed, not ingested; D39 for a visit en route (review items for a
-- re-assignment and an address change; schedule and notes applied); a deletion never cancels a
-- visit (TEMPORARY OQ-2); identity changes on an existing call go to review (OQ-4); contact details
-- follow the newest invitation field by field (D39); an existing product name is never overwritten
-- and the SKU is matched normalized (D19); the rate limit (OQ-8).
-- Mechanics: callers run as authenticated with their JWT claims and then run SET CONSTRAINTS ALL
-- IMMEDIATE themselves, so the deferred integrity checks of Migration 3 (c10, c20) hold for every
-- ingestion; closed visits are set up as postgres with their summary, signature and history.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ---------------------------------------------------------------------------------------------
-- Helpers (pg_temp, rolled back)
-- ---------------------------------------------------------------------------------------------
-- tm_cmd: an upsert command as features/calendar/ingestion/plan.ts toDatabaseCommand builds it, with
-- fields and event members replaced by p_fields and p_event.
create function pg_temp.tm_cmd(p_event text, p_key text, p_at text, p_fields jsonb default '{}'::jsonb,
                               p_event_part jsonb default '{}'::jsonb)
returns jsonb
language sql
as $f$
  select jsonb_build_object(
    'source', 'simulator', 'calendar_id', 'simulator', 'event_id', p_event, 'change_key', p_key, 'changed_at', p_at,
    'kind', 'upsert',
    'event', jsonb_build_object('subject', '[קריאת שירות] בדיקה', 'organizer_email', 'rep-340@example.test',
                                'attendee_emails', jsonb_build_array('tech-a-340@example.test'),
                                'start', '2026-11-18T07:00:00.000Z', 'end', '2026-11-18T09:00:00.000Z') || p_event_part,
    'fields', jsonb_build_object(
      'request_number', 'R-3401', 'task_number', 'T1', 'handling_rep_name', 'נציגת בדיקה', 'customer_number', 'C-3401',
      'customer_name', 'לקוח בדיקה', 'phone', '050-000-3401', 'phone_alt', null, 'city', 'עיר בדיקה',
      'street', 'רחוב בדיקה 1', 'building', null, 'floor', null, 'apartment', null, 'arrival_notes', null,
      'call_type', 'תיקון', 'product_name', 'מוצר בדיקה', 'sku', 'kt-3401', 'fault_description', 'תקלת בדיקה',
      'warranty_status', null, 'warranty_until', null, 'warranty_raw', null, 'pickup_item', null, 'pickup_location', null,
      'tech_notes', null) || p_fields,
    'problems', null, 'recognised', null)
$f$;
create function pg_temp.tm_del(p_event text, p_key text, p_at text)
returns jsonb
language sql
as $f$
  select jsonb_build_object('source', 'simulator', 'calendar_id', 'simulator', 'event_id', p_event, 'change_key', p_key,
                            'changed_at', p_at, 'kind', 'delete', 'event', null, 'fields', null, 'problems', null,
                            'recognised', null)
$f$;
create function pg_temp.tm_unparsed(p_event text, p_key text, p_at text, p_problems jsonb, p_req text default null)
returns jsonb
language sql
as $f$
  select jsonb_build_object('source', 'simulator', 'calendar_id', 'simulator', 'event_id', p_event, 'change_key', p_key,
                            'changed_at', p_at, 'kind', 'unparsed',
                            'event', jsonb_build_object('subject', '[קריאת שירות] בדיקה', 'organizer_email', null,
                                                        'attendee_emails', '[]'::jsonb, 'start', null, 'end', null),
                            'fields', null, 'problems', p_problems,
                            'recognised', jsonb_build_object('request_number', p_req, 'customer_name', null))
$f$;
-- tm_ingest: one call as p_sub (role authenticated), then SET CONSTRAINTS ALL IMMEDIATE as the same
-- caller; the answer is kept. An error is not caught (the test fails visibly).
create function pg_temp.tm_ingest(p_sub uuid, p_cmd jsonb)
returns jsonb
language plpgsql
as $f$
declare
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_answer := public.ingest_calendar_event(p_cmd);
  set constraints all immediate;
  set constraints all deferred;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_answer;
end
$f$;
-- tm_call: the same call as p_role with the claims of p_sub (none when NULL), undone; returns the
-- answer, or the SQLSTATE and message of the error.
create function pg_temp.tm_call(p_role text, p_sub uuid, p_cmd jsonb)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_message text;
  v_result text;
begin
  begin
    begin
      perform set_config('request.jwt.claims',
        case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
      execute 'set local role ' || quote_ident(p_role);
      v_result := public.ingest_calendar_event(p_cmd)::text;
      set constraints all immediate;
      -- The constraint mode outlives the undone subtransaction: back to deferred for the next call.
      set constraints all deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      return v_state || ' ' || v_message;
    end;
    raise exception using errcode = 'TM001', message = v_result;
  exception when sqlstate 'TM001' then
    get stacked diagnostics v_message = message_text;
    return v_message;
  end;
end
$f$;
create function pg_temp.tm_problems(p_role text, p_sub uuid, p_cmd jsonb)
returns text
language sql
as $f$ select coalesce((pg_temp.tm_call(p_role, p_sub, p_cmd)::jsonb -> 'problems')::text, '<error>') $f$;
-- tm_count_as: the rows of one table that p_sub reads (RLS).
create function pg_temp.tm_count_as(p_sub uuid, p_table text)
returns bigint
language plpgsql
as $f$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from public.%I', p_table) into v_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_count;
end
$f$;
-- The answers of the steps, by name.
create temporary table tm_r (k text primary key, v jsonb not null) on commit drop;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test; D47): the real Creator c1, Managers a1 and
-- a9 (inactive), Customer Service b1, Technicians A (d1, e1), B (d2, e2), C (d3, e3: not accepting
-- invitations) and D (d4, e4: inactive account), a signed-in user f0 without a profile; a test
-- pickup place and an inactive call type.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000034' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-34' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'a9', 'b1', 'd1', 'd2', 'd3', 'd4', 'f0']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000034c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active, invitation_rep_name) values
  ('00000000-0000-4000-8000-0000000034a1', 'manager', 'מנהל', true, null),
  ('00000000-0000-4000-8000-0000000034a9', 'manager', 'מנהל לא פעיל', false, null),
  ('00000000-0000-4000-8000-0000000034b1', 'customer_service', 'נציגה', true, 'נציגת בדיקה'),
  ('00000000-0000-4000-8000-0000000034d1', 'technician', 'טכנאי א', true, null),
  ('00000000-0000-4000-8000-0000000034d2', 'technician', 'טכנאי ב', true, null),
  ('00000000-0000-4000-8000-0000000034d3', 'technician', 'טכנאי ג', true, null),
  ('00000000-0000-4000-8000-0000000034d4', 'technician', 'טכנאי ד', false, null);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, accepts_invitations) values
  ('00000000-0000-4000-8000-0000000034e1', '00000000-0000-4000-8000-0000000034d1', true, 'טכנאי א', 't-y', 'tech-a-340@example.test', true),
  ('00000000-0000-4000-8000-0000000034e2', '00000000-0000-4000-8000-0000000034d2', true, 'טכנאי ב', 't-e', 'tech-b-340@example.test', true),
  ('00000000-0000-4000-8000-0000000034e3', '00000000-0000-4000-8000-0000000034d3', true, 'טכנאי ג', 't-b', 'tech-c-340@example.test', false),
  ('00000000-0000-4000-8000-0000000034e4', '00000000-0000-4000-8000-0000000034d4', true, 'טכנאי ד', 't-g', 'tech-d-340@example.test', true);
insert into public.collection_locations (name, place_type, sort_order, address, is_test)
values ('מרלוג בדיקה', 'logistics_center', 90, 'כתובת בדיקה 1', true);
insert into public.call_types (label_he, sort_order, is_active) values ('סוג לא פעיל', 90, false);

-- ---------------------------------------------------------------------------------------------
-- 1. Who may call it, and what a malformed command gets
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.who, pg_temp.tm_call(x.r, x.sub::uuid, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z'))
     from (values (1, 'technician', 'authenticated', '00000000-0000-4000-8000-0000000034d1'),
                  (2, 'inactive manager', 'authenticated', '00000000-0000-4000-8000-0000000034a9'),
                  (3, 'signed in without a profile', 'authenticated', '00000000-0000-4000-8000-0000000034f0'),
                  (4, 'authenticated without a session', 'authenticated', null),
                  (5, 'anon', 'anon', null),
                  (6, 'service_role', 'service_role', null)) x (n, who, r, sub)
     order by x.n $$,
  $$ values ('technician', '42501 not authorized'), ('inactive manager', '42501 not authorized'),
            ('signed in without a profile', '42501 not authorized'), ('authenticated without a session', '42501 not authorized'),
            ('anon', '42501 permission denied for function ingest_calendar_event'),
            ('service_role', '42501 permission denied for function ingest_calendar_event') $$,
  'refused (D24, SIM-10): a Technician, an inactive Manager, a user without a profile or session, anon and service_role');

select results_eq(
  $$ select x.who, pg_temp.tm_call('authenticated', x.sub::uuid, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z'))::jsonb ->> 'outcome'
     from (values (1, 'manager', '00000000-0000-4000-8000-0000000034a1'), (2, 'customer service', '00000000-0000-4000-8000-0000000034b1'),
                  (3, 'creator', '00000000-0000-4000-8000-0000000034c1')) x (n, who, sub)
     order by x.n $$,
  $$ values ('manager', 'applied'), ('customer service', 'applied'), ('creator', 'applied') $$,
  'allowed (a fixed capability, not a matrix key): Manager, Customer Service and the Creator');

select results_eq(
  $$ select x.n, pg_temp.tm_call('authenticated', '00000000-0000-4000-8000-0000000034a1', x.cmd)
     from (values
       (1, null::jsonb),
       (2, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z') || '{"extra": 1}'),
       (3, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z') || '{"source": "microsoft_graph"}'),
       (4, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z') || '{"kind": "merge"}'),
       (5, pg_temp.tm_cmd('sim-340-p', 'k1', to_char((now() + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
       (6, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10 08:00:00')),
       (7, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-02-30T08:00:00Z')),
       (8, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{"task_number": 5}')),
       (9, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{"customer_number": null}')),
       (10, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z') #- '{fields,tech_notes}'),
       (11, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{}', '{"attendee_emails": []}')),
       (12, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{}', '{"end": "2026-11-18T06:00:00.000Z"}')),
       (13, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{}', '{"attendee_emails": ["Tech-A-340@example.test"]}')),
       (14, pg_temp.tm_cmd('sim-340-p', 'with space', '2026-01-10T08:00:00.000Z')),
       (15, pg_temp.tm_unparsed('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '[]')),
       (16, pg_temp.tm_del('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z') || jsonb_build_object('fields', '{}'::jsonb)),
       (17, pg_temp.tm_cmd('sim-340-p', 'k1', '2026-01-10T08:00:00.000Z', '{"warranty_until": "2027-03-15", "warranty_status": "yes", "warranty_raw": "כן"}'))
     ) x (n, cmd)
     order by x.n $$,
  $$ select n, '22023 invalid input' from generate_series(1, 17) n $$,
  'a malformed command is refused before anything is written (22023): shape, source, kind, change time, field types and presence, attendees, schedule, keys, problems');

-- ---------------------------------------------------------------------------------------------
-- 2. A new invitation (X-01, D19, D47)
-- ---------------------------------------------------------------------------------------------
insert into tm_r values ('create', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k1', '2026-01-10T08:00:00.000Z', '{"building": "א", "pickup_item": "ברז", "pickup_location": "מרלוג בדיקה"}')));

select results_eq(
  $$ select v ->> 'outcome', v ->> 'replay', v ->> 'request_number', v ->> 'visit_number', v ->> 'review_items', v ->> 'problems'
     from tm_r where k = 'create' $$,
  $$ values ('applied', 'false', 'R-3401', '1', '0', '[]') $$,
  'a new invitation is applied: request number R-3401, visit 1, no review, no problem');

select results_eq(
  $$ select c.status, c.next_visit_number, c.data_source, c.is_test, c.created_by::text, c.source_ref = 'cal-event:' || e.id::text,
            c.fault_description, c.handling_rep_name, c.handling_rep_profile_id::text,
            (select t.label_he from public.call_types t where t.id = c.call_type_id)
     from public.service_calls c join public.external_calendar_events e on e.service_call_id = c.id
     where e.event_id = 'sim-340-e1' $$,
  $$ values ('open', 2, 'simulator', true, '00000000-0000-4000-8000-0000000034a1', true, 'תקלת בדיקה', 'נציגת בדיקה',
             '00000000-0000-4000-8000-0000000034b1', 'תיקון') $$,
  'the call: open, the next visit number 2, simulator test data with its creator and source, the call type from Settings, the representative linked by her invitation alias');

select results_eq(
  $$ select 'customer', x.data_source, x.is_test, x.created_by::text, x.source_ref like 'cal-event:%', x.name, x.phone
     from public.customers x where x.customer_number = 'C-3401'
     union all
     select 'product', x.data_source, x.is_test, x.created_by::text, x.source_ref like 'cal-event:%', x.name, x.sku_display || '/' || x.sku_normalized
     from public.products x where x.sku_normalized = 'KT-3401' $$,
  $$ values ('customer', 'simulator', true, '00000000-0000-4000-8000-0000000034a1', true, 'לקוח בדיקה', '050-000-3401'),
            ('product', 'simulator', true, '00000000-0000-4000-8000-0000000034a1', true, 'מוצר בדיקה', 'kt-3401/KT-3401') $$,
  'the customer and the product are created from the invitation (D19: SKU as written and normalized), simulator test data with their creator and source');

select results_eq(
  $$ select v.visit_number, v.technician_id::text, v.status, v.scheduled_start, v.scheduled_end, v.task_number, v.city, v.street,
            v.building, v.pickup_item, (select l.name from public.collection_locations l where l.id = v.pickup_location_id),
            v.is_test, v.field_version, v.source_ref like 'cal-event:%',
            (select string_agg(ev.event_type || ':' || ev.to_status, ',') from public.visit_events ev where ev.visit_id = v.id)
     from public.visits v join public.external_calendar_events e on e.visit_id = v.id where e.event_id = 'sim-340-e1' $$,
  $$ values (1, '00000000-0000-4000-8000-0000000034e1', 'scheduled', '2026-11-18 07:00:00+00'::timestamptz,
             '2026-11-18 09:00:00+00'::timestamptz, 'T1', 'עיר בדיקה', 'רחוב בדיקה 1', 'א', 'ברז', 'מרלוג בדיקה', true, 1, true,
             'created:scheduled') $$,
  'visit 1: the matched technician, the invitation''s own times, the address, the pickup place from Settings, test data with its source and its created event');

select results_eq(
  $$ select e.status, e.last_change_key, e.last_changed_at, e.is_test, c.outcome, c.received_by::text, c.change_type,
            c.snapshot is not null, c.customer_id is not null, c.is_test,
            (select count(*) from public.calendar_ingestion_errors x where x.calendar_event_id = e.id)
     from public.external_calendar_events e join public.calendar_event_changes c on c.calendar_event_id = e.id
     where e.event_id = 'sim-340-e1' $$,
  $$ values ('active', 'k1', '2026-01-10 08:00:00+00'::timestamptz, true, 'applied', '00000000-0000-4000-8000-0000000034a1', 'upsert',
             true, true, true, 0::bigint) $$,
  'the event row is linked and keeps the newest change; the change row records the caller, the outcome and the parsed fields (OQ-12)');

-- ---------------------------------------------------------------------------------------------
-- 3. Idempotency and ordering (database-schema.md §10)
-- ---------------------------------------------------------------------------------------------
create temporary table tm_counts on commit drop as
select (select count(*) from public.service_calls) calls, (select count(*) from public.visits) visits,
       (select count(*) from public.customers) customers, (select count(*) from public.products) products,
       (select count(*) from public.calendar_event_changes) changes, (select count(*) from public.entity_changes) history,
       (select count(*) from public.visit_events) events;

insert into tm_r values ('replay', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034b1',
  pg_temp.tm_cmd('sim-340-e1', 'k1', '2026-01-10T08:00:00.000Z', '{"building": "א", "pickup_item": "ברז", "pickup_location": "מרלוג בדיקה"}')));
select results_eq(
  $$ select r.v ->> 'replay', r.v ->> 'outcome', r.v ->> 'change_id' = c.v ->> 'change_id', r.v ->> 'visit_id' = c.v ->> 'visit_id'
     from tm_r r, tm_r c where r.k = 'replay' and c.k = 'create' $$,
  $$ values ('true', 'applied', true, true) $$,
  'a replay (the same change key and content, even from another user) returns the stored outcome');
select results_eq(
  $$ select (select count(*) from public.service_calls), (select count(*) from public.visits), (select count(*) from public.customers),
            (select count(*) from public.products), (select count(*) from public.calendar_event_changes),
            (select count(*) from public.entity_changes), (select count(*) from public.visit_events) $$,
  $$ select calls, visits, customers, products, changes, history, events from tm_counts $$,
  'a replay writes nothing: no second call, visit, customer, product, change, history or status row');

select is(
  pg_temp.tm_call('authenticated', '00000000-0000-4000-8000-0000000034a1',
    pg_temp.tm_cmd('sim-340-e1', 'k1', '2026-01-10T08:00:00.000Z', '{"task_number": "T9"}')),
  '23505 calendar_event_changes: the change key was received before with other content',
  'the same change key with other content is refused (23505) and changes nothing');

insert into tm_r values ('stale', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k0', '2026-01-10T07:00:00.000Z', '{"task_number": "T0"}', '{"attendee_emails": ["tech-b-340@example.test"]}')));
insert into tm_r values ('stale-equal', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k1b', '2026-01-10T08:00:00.000Z', '{"task_number": "T0"}')));
select results_eq(
  $$ select (select v ->> 'outcome' from tm_r where k = 'stale'), (select v ->> 'outcome' from tm_r where k = 'stale-equal'),
            v.task_number, v.technician_id::text, e.last_change_key,
            (select count(*) from public.calendar_event_changes c where c.calendar_event_id = e.id and c.outcome = 'stale'),
            (select count(*) from public.calendar_event_changes c where c.calendar_event_id = e.id and c.snapshot is not null)
     from public.external_calendar_events e join public.visits v on v.id = e.visit_id where e.event_id = 'sim-340-e1' $$,
  $$ values ('stale', 'stale', 'T1', '00000000-0000-4000-8000-0000000034e1', 'k1', 2::bigint, 1::bigint) $$,
  'an older change (out of order) or one at the same time with another key is recorded as stale and never applied (OQ-9)');

-- ---------------------------------------------------------------------------------------------
-- 4. A new version: reschedule and re-assignment of a scheduled visit (SIM-03; D39 contact details)
-- ---------------------------------------------------------------------------------------------
create temporary table tm_before on commit drop as
select v.assigned_at, v.field_version from public.visits v join public.external_calendar_events e on e.visit_id = v.id
where e.event_id = 'sim-340-e1';
insert into tm_r values ('update', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k2', '2026-01-10T09:00:00.000Z',
    '{"street": "רחוב בדיקה 2", "phone": "050-000-3402", "building": null, "pickup_item": null, "pickup_location": null}',
    '{"attendee_emails": ["tech-b-340@example.test"], "start": "2026-11-18T10:00:00.000Z", "end": "2026-11-18T12:00:00.000Z"}')));
select results_eq(
  $$ select v ->> 'outcome', v -> 'applied_fields' from tm_r where k = 'update' $$,
  $$ values ('applied', '["visits.technician_id", "visits.scheduled_start", "visits.scheduled_end", "visits.street", "customers.phone"]'::jsonb) $$,
  'a new version applies the re-assignment, the new times, the address and the changed phone; an empty optional field changes nothing (OQ-3)');
select results_eq(
  $$ select v.technician_id::text, v.scheduled_start, v.street, v.building, v.pickup_item, v.field_version - b.field_version,
            v.assigned_at > b.assigned_at or v.assigned_at = now(), x.phone
     from public.visits v join public.external_calendar_events e on e.visit_id = v.id
     join public.service_calls c on c.id = v.service_call_id join public.customers x on x.id = c.customer_id, tm_before b
     where e.event_id = 'sim-340-e1' $$,
  $$ values ('00000000-0000-4000-8000-0000000034e2', '2026-11-18 10:00:00+00'::timestamptz, 'רחוב בדיקה 2', 'א', 'ברז', 1, true,
             '050-000-3402') $$,
  'the visit is re-assigned (a new server assignment time, field_version raised once) and rescheduled; the kept optional fields stay; the customer''s phone changes');
select results_eq(
  $$ select h.entity_table, h.field, h.source, h.source_ref = 'cal-change:' || (r.v ->> 'change_id')
     from public.entity_changes h, tm_r r where r.k = 'update' and h.source_ref like 'cal-change:%'
     order by h.id $$,
  $$ values ('visits', 'technician_id', 'invitation', true), ('visits', 'scheduled_start', 'invitation', true),
            ('visits', 'scheduled_end', 'invitation', true), ('visits', 'street', 'invitation', true),
            ('customers', 'phone', 'invitation', true) $$,
  'every applied field has its history row (source invitation, the change''s reference)');

-- ---------------------------------------------------------------------------------------------
-- 5. A follow-up invitation (X-01, X-03) and D39 field ordering
-- ---------------------------------------------------------------------------------------------
-- A second event with the same request number, made before the latest change of the first: visit 2
-- of the same call; its older phone does not replace the newer one (D39).
insert into tm_r values ('followup', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034b1',
  pg_temp.tm_cmd('sim-340-e2', 'k1', '2026-01-10T08:30:00.000Z', '{"task_number": "T2", "phone": "050-000-3499", "phone_alt": "03-555-0001"}',
    '{"start": "2026-11-20T07:00:00.000Z", "end": "2026-11-20T09:00:00.000Z"}')));
select results_eq(
  $$ select r.v ->> 'outcome', r.v ->> 'visit_number', r.v ->> 'service_call_id' = c.v ->> 'service_call_id',
            (select count(*) from public.service_calls s where s.request_number = 'R-3401'),
            (select s.next_visit_number from public.service_calls s where s.request_number = 'R-3401'),
            (select x.phone || ' ' || x.phone_alt from public.customers x where x.customer_number = 'C-3401'),
            r.v -> 'applied_fields'
     from tm_r r, tm_r c where r.k = 'followup' and c.k = 'create' $$,
  $$ values ('applied', '2', true, 1::bigint, 3, '050-000-3402 03-555-0001', '["visits.created", "customers.phone_alt"]'::jsonb) $$,
  'a follow-up invitation is visit 2 of the same call (no second call); an older phone does not replace the newer one, a new second phone is added (D39)');

-- A resolved call reopens with a new invitation (D38): call R-3402, visit 1 closed as done.
insert into tm_r values ('r2', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e3', 'k1', '2026-01-10T08:00:00.000Z', '{"request_number": "R-3402", "sku": "KT-3401"}')));
insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
select (v ->> 'visit_id')::uuid, 'טופל בבדיקה', 'written', true from tm_r where k = 'r2';
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
select (v ->> 'visit_id')::uuid, 'חותם בדיקה', 'נוסח בדיקה', encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'), gen_random_uuid(), true
from tm_r where k = 'r2';
update public.visits set status = 'done' where id = (select (v ->> 'visit_id')::uuid from tm_r where k = 'r2');
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
select v.id, v.version, 'status_changed', 'scheduled', 'done', true from public.visits v
where v.id = (select (x.v ->> 'visit_id')::uuid from tm_r x where x.k = 'r2');
select private.recalc_call_status((select (v ->> 'service_call_id')::uuid from tm_r where k = 'r2'));
set constraints all immediate;
set constraints all deferred;
select is((select status from public.service_calls where request_number = 'R-3402'), 'resolved', 'set-up: call R-3402 is resolved');
insert into tm_r values ('reopen', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e4', 'k1', '2026-01-10T10:00:00.000Z', '{"request_number": "R-3402", "sku": "KT-3401", "task_number": "T2"}')));
select results_eq(
  $$ select s.status, s.resolved_at is null, (select v ->> 'visit_number' from tm_r where k = 'reopen'),
            (select count(*) from public.visits v where v.service_call_id = s.id)
     from public.service_calls s where s.request_number = 'R-3402' $$,
  $$ values ('open', true, '2', 2::bigint) $$,
  'a new invitation on a resolved call reopens it (D38: status open, resolved_at cleared) with visit 2');

-- A closed visit is never changed by an invitation (D39).
insert into tm_r values ('closed', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e3', 'k2', '2026-01-10T11:00:00.000Z', '{"request_number": "R-3402", "sku": "KT-3401", "street": "רחוב אחר"}',
    '{"attendee_emails": ["tech-b-340@example.test"]}')));
select results_eq(
  $$ select r.v ->> 'outcome', r.v -> 'applied_fields', v.status, v.street, v.technician_id::text
     from tm_r r join public.visits v on v.id = (r.v ->> 'visit_id')::uuid where r.k = 'closed' $$,
  $$ values ('no_effect', '[]'::jsonb, 'done', 'רחוב בדיקה 1', '00000000-0000-4000-8000-0000000034e1') $$,
  'a new version of the invitation of a closed visit has no effect (D39)');

-- ---------------------------------------------------------------------------------------------
-- 6. Unparsed invitations (S-05, IN-03, IN-04)
-- ---------------------------------------------------------------------------------------------
insert into tm_r values ('u1', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034b1',
  pg_temp.tm_unparsed('sim-340-e5', 'k1', '2026-01-10T08:00:00.000Z', '[{"kind":"missing","field":"customerNo"}]', 'R-3405')));
select results_eq(
  $$ select r.v ->> 'outcome', r.v ->> 'request_number', r.v -> 'problems', r.v ->> 'service_call_id',
            x.status, x.request_number, x.subject, x.attendee_emails, (select count(*) from public.service_calls s where s.request_number = 'R-3405')
     from tm_r r join public.calendar_ingestion_errors x on x.change_id = (r.v ->> 'change_id')::uuid where r.k = 'u1' $$,
  $$ values ('unparsed', 'R-3405', '[{"kind": "missing", "field": "customerNo"}]'::jsonb, null::text, 'open', 'R-3405',
             '[קריאת שירות] בדיקה', '[]'::jsonb, 0::bigint) $$,
  'an invitation with a parse problem is listed (open row with its reason and the request number read) and nothing is ingested');
insert into tm_r values ('u2', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034b1',
  pg_temp.tm_unparsed('sim-340-e5', 'k2', '2026-01-10T08:10:00.000Z', '[{"kind":"invalid","field":"phone","rule":"format","value":"abc"}]', 'R-3405')));
insert into tm_r values ('u-replay', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_unparsed('sim-340-e5', 'k1', '2026-01-10T08:00:00.000Z', '[{"kind":"missing","field":"customerNo"}]', 'R-3405')));
insert into tm_r values ('u-fixed', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034b1',
  pg_temp.tm_cmd('sim-340-e5', 'k3', '2026-01-10T08:20:00.000Z', '{"request_number": "R-3405"}')));
select results_eq(
  $$ select x.change_id = (select (v ->> 'change_id')::uuid from tm_r where k = 'u1'), x.status, x.resolution,
            x.resolved_by_change_id = (select (v ->> 'change_id')::uuid from tm_r where k = 'u2')
               or x.resolved_by_change_id = (select (v ->> 'change_id')::uuid from tm_r where k = 'u-fixed')
     from public.calendar_ingestion_errors x join public.external_calendar_events e on e.id = x.calendar_event_id
     where e.event_id = 'sim-340-e5' order by x.created_at, x.change_id = (select (v ->> 'change_id')::uuid from tm_r where k = 'u1') desc $$,
  $$ values (true, 'resolved', 'superseded', true), (false, 'resolved', 'ingested', true) $$,
  'a newer problem supersedes the open row (one open row per invitation); a valid version ingests and resolves it');
select results_eq(
  $$ select (select v ->> 'replay' from tm_r where k = 'u-replay'), (select v -> 'problems' from tm_r where k = 'u-replay'),
            (select v ->> 'outcome' from tm_r where k = 'u-fixed'), (select v ->> 'visit_number' from tm_r where k = 'u-fixed') $$,
  $$ values ('true', '[{"kind": "missing", "field": "customerNo"}]'::jsonb, 'applied', '1') $$,
  'a replay of an unparsed change returns its stored reasons; the corrected version creates the visit');

select results_eq(
  $$ select x.n, pg_temp.tm_problems('authenticated', '00000000-0000-4000-8000-0000000034a1',
       pg_temp.tm_cmd('sim-340-l' || x.n, 'k1', '2026-01-10T08:00:00.000Z', x.f::jsonb, x.e::jsonb))
     from (values
       (1, '{"request_number": "R-3471"}', '{"attendee_emails": ["nobody-340@example.test"]}'),
       (2, '{"request_number": "R-3472"}', '{"attendee_emails": ["tech-a-340@example.test", "tech-b-340@example.test"]}'),
       (3, '{"request_number": "R-3473"}', '{"attendee_emails": ["tech-c-340@example.test"]}'),
       (4, '{"request_number": "R-3474"}', '{"attendee_emails": ["tech-d-340@example.test"]}'),
       (5, '{"request_number": "R-3475", "call_type": "שירות"}', '{}'),
       (6, '{"request_number": "R-3476", "call_type": "סוג לא פעיל"}', '{}'),
       (7, '{"request_number": "R-3477", "pickup_location": "מחסן"}', '{}'),
       (8, '{"request_number": "R-3478", "call_type": "שירות", "pickup_location": "מחסן"}', '{"attendee_emails": ["nobody-340@example.test"]}')
     ) x (n, f, e)
     order by x.n $$,
  $$ values
     (1, '[{"kind": "unknown_technician", "field": "attendee", "value": "nobody-340@example.test"}]'),
     (2, '[{"kind": "ambiguous_technician", "field": "attendee", "value": "tech-a-340@example.test, tech-b-340@example.test"}]'),
     (3, '[{"kind": "inactive_technician", "field": "attendee", "value": "tech-c-340@example.test"}]'),
     (4, '[{"kind": "inactive_technician", "field": "attendee", "value": "tech-d-340@example.test"}]'),
     (5, '[{"kind": "invalid", "rule": "unknown_call_type", "field": "type", "value": "שירות"}]'),
     (6, '[{"kind": "invalid", "rule": "unknown_call_type", "field": "type", "value": "סוג לא פעיל"}]'),
     (7, '[{"kind": "unknown_place", "field": "collectFrom", "value": "מחסן"}]'),
     (8, '[{"kind": "unknown_technician", "field": "attendee", "value": "nobody-340@example.test"}, {"kind": "invalid", "rule": "unknown_call_type", "field": "type", "value": "שירות"}, {"kind": "unknown_place", "field": "collectFrom", "value": "מחסן"}]') $$,
  'the Settings lookups list readable reasons (S-05): unknown, ambiguous or ineligible technician (OQ-6), unknown or inactive call type, unknown pickup place (IN-03); all of them at once');

-- A changed request number on an ingested invitation, and real records (D47).
insert into tm_r values ('req-changed', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k3', '2026-01-10T09:30:00.000Z', '{"request_number": "R-3409"}',
    '{"attendee_emails": ["tech-b-340@example.test"], "start": "2026-11-18T10:00:00.000Z", "end": "2026-11-18T12:00:00.000Z"}')));
select results_eq(
  $$ select r.v ->> 'outcome', r.v ->> 'request_number', r.v -> 'problems',
            (select count(*) from public.service_calls s where s.request_number = 'R-3409'),
            (select s.request_number from public.service_calls s join public.external_calendar_events e on e.service_call_id = s.id
             where e.event_id = 'sim-340-e1')
     from tm_r r where r.k = 'req-changed' $$,
  $$ values ('unparsed', 'R-3409', '[{"kind": "conflict", "rule": "request_number_changed", "field": "req", "value": "R-3409"}]'::jsonb,
             0::bigint, 'R-3401') $$,
  'a changed request number on an ingested invitation is not ingested (OQ-7): the visit stays on its call');

-- Set-up: one real customer and one real product, possible only with the pre-go-live CHECKs
-- relaxed inside this rolled-back transaction (as 150 section 8).
alter table public.customers drop constraint customers_data_source_check;
alter table public.customers add constraint tm_relaxed_customers check (data_source in ('microsoft_graph', 'simulator', 'automated_test'));
alter table public.products drop constraint products_data_source_check;
alter table public.products add constraint tm_relaxed_products check (data_source in ('microsoft_graph', 'simulator', 'automated_test'));
insert into public.customers (customer_number, name, phone, data_source, source_ref) values ('C-REAL', 'לקוח אמיתי', '050-000-0000', 'microsoft_graph', 'run-340');
insert into public.products (sku_display, sku_normalized, name, data_source, source_ref) values ('KT-REAL', 'KT-REAL', 'מוצר אמיתי', 'microsoft_graph', 'run-340');
select results_eq(
  $$ select x.n, pg_temp.tm_problems('authenticated', '00000000-0000-4000-8000-0000000034a1',
       pg_temp.tm_cmd('sim-340-r' || x.n, 'k1', '2026-01-10T08:00:00.000Z', x.f::jsonb))
     from (values (1, '{"request_number": "R-3481", "customer_number": "C-REAL"}'), (2, '{"request_number": "R-3482", "sku": "KT-REAL"}')) x (n, f)
     order by x.n $$,
  $$ values (1, '[{"kind": "conflict", "rule": "real_customer", "field": "customerNo", "value": "C-REAL"}]'),
            (2, '[{"kind": "conflict", "rule": "real_product", "field": "sku", "value": "KT-REAL"}]') $$,
  'a real customer or product is never joined by simulator data (D47): the invitation is listed as a conflict');

-- ---------------------------------------------------------------------------------------------
-- 7. A visit en route (D39, OQ-5)
-- ---------------------------------------------------------------------------------------------
update public.visits set status = 'en_route' where id = (select (v ->> 'visit_id')::uuid from tm_r where k = 'create');
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
select v.id, v.version, 'status_changed', 'scheduled', 'en_route', true from public.visits v
where v.id = (select (x.v ->> 'visit_id')::uuid from tm_r x where x.k = 'create');
set constraints all immediate;
set constraints all deferred;
create temporary table tm_en_route on commit drop as
select v.technician_id, v.city, v.street, v.field_version from public.visits v where v.id = (select (x.v ->> 'visit_id')::uuid from tm_r x where x.k = 'create');
insert into tm_r values ('en-route', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k4', '2026-01-10T10:00:00.000Z', '{"city": "עיר אחרת", "street": "רחוב בדיקה 2", "tech_notes": "להתקשר", "phone": "050-000-3402"}',
    '{"attendee_emails": ["tech-a-340@example.test"], "start": "2026-11-18T11:00:00.000Z", "end": "2026-11-18T13:00:00.000Z"}')));
select results_eq(
  $$ select r.v ->> 'outcome', r.v ->> 'review_items', r.v -> 'applied_fields',
            v.technician_id = b.technician_id, v.city = b.city, v.scheduled_start, v.tech_notes, v.field_version = b.field_version
     from tm_r r join public.visits v on v.id = (r.v ->> 'visit_id')::uuid, tm_en_route b where r.k = 'en-route' $$,
  $$ values ('review', '2', '["visits.scheduled_start", "visits.scheduled_end", "visits.tech_notes"]'::jsonb, true, true,
             '2026-11-18 11:00:00+00'::timestamptz, 'להתקשר', true) $$,
  'a visit en route: the re-assignment and the address change wait for review; the new times and the technician''s note are applied (D39)');
select results_eq(
  $$ select i.review_type, i.status, i.source, i.source_ref = 'cal-change:' || (r.v ->> 'change_id'), i.visit_id::text = r.v ->> 'visit_id',
            i.submitted_version, i.is_test
     from public.review_items i, tm_r r where r.k = 'en-route' and i.source_ref = 'cal-change:' || (r.v ->> 'change_id')
     order by i.review_type $$,
  $$ values ('address_change', 'open', 'invitation', true, true,
             '{"city": "עיר אחרת", "street": "רחוב בדיקה 2", "building": "א"}'::jsonb, true),
            ('reassignment', 'open', 'invitation', true, true, '{"technician_id": "00000000-0000-4000-8000-0000000034e1"}'::jsonb, true) $$,
  'the review items keep the incoming version (D44), test-marked from the call');

-- ---------------------------------------------------------------------------------------------
-- 8. Deletion (TEMPORARY OQ-2, open decision 5)
-- ---------------------------------------------------------------------------------------------
insert into tm_r values ('delete', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1', pg_temp.tm_del('sim-340-e1', 'k5', '2026-01-10T11:00:00.000Z')));
insert into tm_r values ('after-delete', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e1', 'k6', '2026-01-10T12:00:00.000Z', '{"tech_notes": "שוב"}')));
select results_eq(
  $$ select (select v ->> 'outcome' from tm_r where k = 'delete'), (select v ->> 'review_items' from tm_r where k = 'delete'),
            (select v ->> 'outcome' from tm_r where k = 'after-delete'), e.status, e.last_change_key, v.status, v.tech_notes,
            (select count(*) from public.review_items i where i.review_type = 'cancellation' and i.visit_id = v.id and i.status = 'open')
     from public.external_calendar_events e join public.visits v on v.id = e.visit_id where e.event_id = 'sim-340-e1' $$,
  $$ values ('review', '1', 'no_effect', 'deleted', 'k6', 'en_route', 'להתקשר', 1::bigint) $$,
  'a deleted invitation never cancels the visit: a cancellation review item; later versions of a deleted event have no effect');
insert into tm_r values ('u-del-1', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_unparsed('sim-340-e6', 'k1', '2026-01-10T08:00:00.000Z', '[{"kind":"missing","field":"req"}]')));
insert into tm_r values ('u-del-2', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1', pg_temp.tm_del('sim-340-e6', 'k2', '2026-01-10T08:05:00.000Z')));
insert into tm_r values ('del-unknown', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1', pg_temp.tm_del('sim-340-e7', 'k1', '2026-01-10T08:05:00.000Z')));
select results_eq(
  $$ select (select v ->> 'outcome' from tm_r where k = 'u-del-2'),
            (select x.status || ' ' || x.resolution from public.calendar_ingestion_errors x
             where x.change_id = (select (v ->> 'change_id')::uuid from tm_r where k = 'u-del-1')),
            (select v ->> 'outcome' from tm_r where k = 'del-unknown'),
            (select e.status from public.external_calendar_events e where e.event_id = 'sim-340-e7') $$,
  $$ values ('no_effect', 'resolved deleted', 'no_effect', 'deleted') $$,
  'deleting an unparsed invitation resolves its row; deleting an unknown event records it as deleted');

-- ---------------------------------------------------------------------------------------------
-- 9. Call-level identity and fields on an existing call (D19, D39, OQ-3, OQ-4)
-- ---------------------------------------------------------------------------------------------
insert into tm_r values ('id-customer', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e8', 'k1', '2026-01-10T13:00:00.000Z', '{"customer_number": "C-3499", "customer_name": "לקוח אחר", "task_number": "T3"}')));
insert into tm_r values ('id-customer-again', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e8', 'k2', '2026-01-10T13:10:00.000Z', '{"customer_number": "C-3499", "customer_name": "לקוח אחר", "task_number": "T3b"}')));
insert into tm_r values ('id-sku', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e9', 'k1', '2026-01-10T13:20:00.000Z', '{"sku": "KT-3499", "product_name": "מוצר אחר", "task_number": "T4"}')));
insert into tm_r values ('id-name', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e10', 'k1', '2026-01-10T13:30:00.000Z', '{"customer_name": "שם חדש", "task_number": "T5", "fault_description": "תקלה מעודכנת"}')));
select results_eq(
  $$ select x.k, x.v ->> 'outcome', x.v ->> 'visit_number', x.v ->> 'review_items',
            (select string_agg(i.review_type, ',') from public.review_items i where i.source_ref = 'cal-change:' || (x.v ->> 'change_id'))
     from tm_r x where x.k in ('id-customer', 'id-customer-again', 'id-sku', 'id-name') order by x.k collate "C" $$,
  $$ values ('id-customer', 'review', '3', '1', 'customer_change'), ('id-customer-again', 'applied', '3', '0', null),
            ('id-name', 'review', '5', '1', 'customer_change'), ('id-sku', 'review', '4', '1', 'sku_change') $$,
  'a different customer number, SKU or customer name on an existing call opens one review item and the visit is still created; an unchanged difference opens no second one');
select results_eq(
  $$ select x.customer_number, x.name, p.sku_normalized, s.fault_description,
            (select count(*) from public.customers where customer_number = 'C-3499'),
            (select count(*) from public.products where sku_normalized = 'KT-3499')
     from public.service_calls s join public.customers x on x.id = s.customer_id join public.products p on p.id = s.product_id
     where s.request_number = 'R-3401' $$,
  $$ values ('C-3401', 'לקוח בדיקה', 'KT-3401', 'תקלה מעודכנת', 0::bigint, 0::bigint) $$,
  'the call keeps its customer, name and product (nothing silently overwritten, OQ-4); its fault description follows the newest invitation (OQ-3)');
insert into tm_r values ('d19', pg_temp.tm_ingest('00000000-0000-4000-8000-0000000034a1',
  pg_temp.tm_cmd('sim-340-e11', 'k1', '2026-01-10T14:00:00.000Z', '{"request_number": "R-3410", "sku": "KT-3401", "product_name": "שם אחר למוצר"}')));
select results_eq(
  $$ select (select count(*) from public.products where sku_normalized = 'KT-3401'), p.name, p.sku_display,
            (select count(*) from public.customers where customer_number = 'C-3401')
     from public.service_calls s join public.products p on p.id = s.product_id where s.request_number = 'R-3410' $$,
  $$ values (1::bigint, 'מוצר בדיקה', 'kt-3401', 1::bigint) $$,
  'D19: an existing SKU (matched normalized) links the existing product; its name is never overwritten; the customer is reused');

-- ---------------------------------------------------------------------------------------------
-- 10. Rate limit (OQ-8), test marking (D47) and visibility
-- ---------------------------------------------------------------------------------------------
-- Set-up: 30 changes received from Customer Service in the last minute (written as postgres).
insert into public.external_calendar_events (id, data_source, calendar_id, event_id)
values ('00000000-0000-4000-8000-000000340e99', 'automated_test', 'cal-340', 'evt-rl');
insert into public.calendar_event_changes (id, calendar_event_id, change_key, changed_at, received_by, change_type, payload_sha256,
                                           outcome, is_test)
select gen_random_uuid(), '00000000-0000-4000-8000-000000340e99', 'rl-' || n, now(), '00000000-0000-4000-8000-0000000034b1', 'upsert',
       repeat('0', 64), 'stale', true
from generate_series(1, 30) n;
select results_eq(
  $$ select pg_temp.tm_call('authenticated', '00000000-0000-4000-8000-0000000034b1', pg_temp.tm_cmd('sim-340-rl', 'k31', '2026-01-10T08:00:00.000Z'))
     union all
     select pg_temp.tm_call('authenticated', '00000000-0000-4000-8000-0000000034a1', pg_temp.tm_cmd('sim-340-rl', 'k31', '2026-01-10T08:00:00.000Z'))::jsonb ->> 'outcome' $$,
  $$ values ('PT429 too many invitation changes; try again in a minute'::text), ('applied') $$,
  'the rate limit is per user (OQ-8): Customer Service after 30 changes in a minute is refused (PT429); the Manager is not');

select results_eq(
  $$ select 'service_calls', count(*) filter (where not x.is_test or x.data_source <> 'simulator') from public.service_calls x
       where x.source_ref like 'cal-event:%'
     union all select 'customers', count(*) filter (where not x.is_test or x.data_source <> 'simulator') from public.customers x
       where x.source_ref like 'cal-event:%'
     union all select 'products', count(*) filter (where not x.is_test or x.data_source <> 'simulator') from public.products x
       where x.source_ref like 'cal-event:%'
     union all select 'visits', count(*) filter (where not x.is_test) from public.visits x
     union all select 'events', count(*) filter (where not x.is_test or x.data_source <> 'simulator') from public.external_calendar_events x
       where x.calendar_id = 'simulator'
     union all select 'changes', count(*) filter (where not x.is_test) from public.calendar_event_changes x
     union all select 'errors', count(*) filter (where not x.is_test) from public.calendar_ingestion_errors x
     union all select 'history', count(*) filter (where not x.is_test) from public.entity_changes x
     union all select 'reviews', count(*) filter (where not x.is_test) from public.review_items x $$,
  $$ values ('service_calls', 0::bigint), ('customers', 0::bigint), ('products', 0::bigint), ('visits', 0::bigint),
            ('events', 0::bigint), ('changes', 0::bigint), ('errors', 0::bigint), ('history', 0::bigint), ('reviews', 0::bigint) $$,
  'every row the writer created is simulator test data (D47)');

select results_eq(
  $$ select table_name, sum(test_rows)::bigint from public.test_data_census()
     where table_name in ('service_calls', 'visits', 'external_calendar_events', 'calendar_event_changes', 'calendar_ingestion_errors')
     group by table_name order by table_name collate "C" $$,
  $$ select x.t, x.c from (values
       ('calendar_event_changes', (select count(*) from public.calendar_event_changes)),
       ('calendar_ingestion_errors', (select count(*) from public.calendar_ingestion_errors)),
       ('external_calendar_events', (select count(*) from public.external_calendar_events)),
       ('service_calls', (select count(*) from public.service_calls)),
       ('visits', (select count(*) from public.visits))) x (t, c) order by x.t collate "C" $$,
  'the census counts every ingested row as test data');

select results_eq(
  $$ select x.who, x.n from (
       select 'manager calls' who, pg_temp.tm_count_as('00000000-0000-4000-8000-0000000034a1', 'service_calls') n
       union all select 'manager errors', pg_temp.tm_count_as('00000000-0000-4000-8000-0000000034a1', 'calendar_ingestion_errors')
       union all select 'technician A visits', pg_temp.tm_count_as('00000000-0000-4000-8000-0000000034d1', 'visits')
       union all select 'creator errors', pg_temp.tm_count_as('00000000-0000-4000-8000-0000000034c1', 'calendar_ingestion_errors')) x $$,
  $$ values ('manager calls', (select count(*) from public.service_calls)), ('manager errors', 0::bigint),
            ('technician A visits', (select count(*) from public.visits where technician_id = '00000000-0000-4000-8000-0000000034e1')),
            ('creator errors', (select count(*) from public.calendar_ingestion_errors)) $$,
  'ingested calls and visits follow the existing RLS (the Manager reads every call, a Technician his own visits); the unparsed list is the Creator''s (OQ-1)');

select * from finish();
rollback;
