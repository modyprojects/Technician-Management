-- PR 1.5: the call status (D38; docs/database-schema.md §6, §10; plan §3; docs/testing.md categories 8
-- and 13). private.compute_call_status decides: any open visit -> open; otherwise the closed visit
-- with the highest visit number (never the sync or closure time) -> resolved (done) or
-- awaiting_followup (followup); otherwise -> awaiting_scheduling; cancelled visits never cancel the
-- call. private.recalc_call_status is the only writer of status changes: it locks the call, writes
-- only when a value changes, records each changed field in entity_changes (source 'system') and
-- takes the actor from the session. The deferred checks (c10, c20) reject at COMMIT any
-- transaction that changes a visit without recalculating after its last visit change.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   OQ-3  resolved_at = closed_at of the resolving visit; NULL whenever the call is not resolved;
--   OQ-14 no outcome-correction writer: done -> followup recalculates, followup -> done needs a
--         signature (c10 rule a); a closure accepted after cancellation (D44) resolves the call.
-- Writers are simulated as postgres (no write RPC exists in PR 1.5); "at COMMIT" is checked with
-- SET CONSTRAINTS ALL IMMEDIATE (V4). Negative cases run in subtransactions that are always undone;
-- the role-specific checks (Technician, Manager without `card`, service_role) are in 170.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Test-only helpers (pg_temp, rolled back) --------------------------------------------------------
-- tm_try: see 100_reference_schema.test.sql (always undone; 'ok' or the SQLSTATE and the constraint
-- name, the column or the message). A probe that ends with SET CONSTRAINTS ALL IMMEDIATE and
-- succeeds would leave the whole transaction in immediate mode although the probe is undone:
-- PostgreSQL drops the saved constraint mode when the inner block commits into the outer one, so
-- the outer rollback has nothing to restore. The probe therefore restores the file's mode (every
-- constraint trigger is INITIALLY DEFERRED and no other constraint is deferrable) before its undo.
create function pg_temp.tm_try(p_sql text)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
  v_column text;
  v_message text;
begin
  begin
    begin
      execute p_sql;
      set constraints all deferred;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name,
        v_column = column_name, v_message = message_text;
      return v_state || ' ' || case when v_state = '23502' then v_column
                                    else coalesce(nullif(v_constraint, ''), v_message) end;
    end;
    raise exception using errcode = 'TM001', message = 'undo the probe';
  exception when sqlstate 'TM001' then
    return 'ok';
  end;
end
$f$;

-- Call n is 00000000-0000-4000-8000-0000000c00nn; its visit v is ...-0000000b nn vv.
create function pg_temp.tm_call(p_n integer)
returns uuid
language sql
immutable
as $f$ select ('00000000-0000-4000-8000-0000000c' || lpad(p_n::text, 4, '0'))::uuid $f$;
create function pg_temp.tm_visit(p_n integer, p_v integer)
returns uuid
language sql
immutable
as $f$ select ('00000000-0000-4000-8000-0000000b' || lpad(p_n::text, 2, '0') || lpad(p_v::text, 2, '0'))::uuid $f$;

-- tm_open_call: the Step 6 ingestion shape (plan §3.3): a call with status 'open' and
-- next_visit_number 2, its visit 1 (scheduled, Technician A) and the visit's 'created' event; no
-- status history row (DEV-13).
create function pg_temp.tm_open_call(p_n integer)
returns void
language plpgsql
as $f$
begin
  insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
    handling_rep_name, status, next_visit_number, data_source, source_ref)
  values (pg_temp.tm_call(p_n), 'REQ-16' || lpad(p_n::text, 2, '0'), '00000000-0000-4000-8000-000000000601',
          '00000000-0000-4000-8000-000000000501', (select t.id from public.call_types t where t.sort_order = 1), 'לא מקרר',
          'נציג א', 'open', 2, 'automated_test', 'pr15-160-' || p_n);
  insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
    status, city, street, source_ref, is_test)
  values (pg_temp.tm_visit(p_n, 1), pg_temp.tm_call(p_n), '00000000-0000-4000-8000-0000000000e1', 1, 'T-16' || p_n,
          now() + interval '1 hour', now() + interval '2 hours', 'scheduled', 'חיפה', 'הנמל 1', 'pr15-160-' || p_n || '-1', true);
  insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values (pg_temp.tm_visit(p_n, 1), 1, 'created', 'scheduled');
end
$f$;

-- tm_add_visit: a new visit on an existing call (the writer raises next_visit_number first; t35
-- allocates in creation order), scheduled, Technician B, with its 'created' event.
create function pg_temp.tm_add_visit(p_n integer, p_v integer)
returns void
language plpgsql
as $f$
begin
  update public.service_calls set next_visit_number = p_v + 1 where id = pg_temp.tm_call(p_n);
  insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
    status, city, street, source_ref, is_test)
  values (pg_temp.tm_visit(p_n, p_v), pg_temp.tm_call(p_n), '00000000-0000-4000-8000-0000000000e2', p_v, 'T-16' || p_n || '-' || p_v,
          now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'חיפה', 'הנמל 1',
          'pr15-160-' || p_n || '-' || p_v, true);
  insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values (pg_temp.tm_visit(p_n, p_v), 1, 'created', 'scheduled');
end
$f$;

-- tm_move: a visit status change as a writer makes it (plan §3.2 step 2): the status (a follow-up
-- with its reason and notes), its status event, and at a closure the summary and, for done, the
-- customer signature when missing. p_closed_at is the original receipt time of a closure accepted
-- after cancellation (D44), or a back-dated closure while t12 is disabled. No recalculation.
create function pg_temp.tm_move(p_n integer, p_v integer, p_status text, p_closed_at timestamptz default null,
                                p_sign boolean default true)
returns void
language plpgsql
as $f$
declare
  v_id uuid := pg_temp.tm_visit(p_n, p_v);
  v_from text;
  v_version integer;
begin
  select v.status, v.version into v_from, v_version from public.visits v where v.id = v_id;
  update public.visits v
  set status = p_status,
      closed_at = coalesce(p_closed_at, v.closed_at),
      followup_reason_id = case when p_status = 'followup' then (select r.id from public.followup_reasons r where r.sort_order = 1)
                                else v.followup_reason_id end,
      next_visit_notes = case when p_status = 'followup' then 'להביא חלק חילוף' else v.next_visit_notes end
  where v.id = v_id;
  if p_status in ('done', 'followup') and not exists (select 1 from public.visit_reports r where r.visit_id = v_id) then
    insert into public.visit_reports (visit_id, summary_text, summary_source) values (v_id, 'טופל בביקור ' || p_v, 'written');
  end if;
  if p_status = 'done' and p_sign and not exists (select 1 from public.visit_signatures s where s.visit_id = v_id) then
    insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
    values (v_id, 'ישראל ישראלי', 'אני מאשר שהעבודה בוצעה', encode(sha256(convert_to('אני מאשר שהעבודה בוצעה', 'UTF8')), 'hex'),
            gen_random_uuid());
  end if;
  insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
  values (v_id, v_version + 1, 'status_changed', v_from, p_status);
end
$f$;

-- tm_history: the status history of call n, oldest first (field, old, new, source, actor).
create function pg_temp.tm_history(p_n integer)
returns table (field text, old_value jsonb, new_value jsonb, source text, actor uuid)
language sql
as $f$
  select c.field, c.old_value, c.new_value, c.source, c.actor_profile_id
  from public.entity_changes c
  where c.entity_table = 'service_calls' and c.entity_id = pg_temp.tm_call(p_n)
  order by c.id
$f$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (local, rolled back; fictional, example.test; D47)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'd1', 'd2']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000601', 'C-1601', 'לקוח בדיקה', '050-000-0001', 'automated_test', 'pr15-160-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000501', 'kt-1601', 'KT-1601', 'מוצר בדיקה', 'automated_test', 'pr15-160-1');

-- ---------------------------------------------------------------------------------------------
-- 1. A new call is open; moves among open statuses change nothing (call 1)
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(1);
select results_eq(
  $$ select s.status, s.resolved_at from private.compute_call_status(pg_temp.tm_call(1)) s $$,
  $$ values ('open'::text, null::timestamptz) $$,
  'a call whose only visit is scheduled computes as open, not resolved');
select pg_temp.tm_move(1, 1, 'en_route');
select pg_temp.tm_move(1, 1, 'in_progress');
select is(private.recalc_call_status(pg_temp.tm_call(1)), 'open', 'en route and in progress keep the call open');
select results_eq(
  $$ select c.status, c.resolved_at, c.version, c.updated_by, (select count(*) from pg_temp.tm_history(1))
     from public.service_calls c where c.id = pg_temp.tm_call(1) $$,
  $$ values ('open'::text, null::timestamptz, 1, null::uuid, 0::bigint) $$,
  'a recalculation without a change writes nothing: no update (version 1) and no history row; creation writes no history row either (DEV-13)');
-- opened_at is the server's creation time (D45, D57 (9); t35): a writer's value is ignored.
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, status, next_visit_number, data_source, source_ref, opened_at)
values (pg_temp.tm_call(14), 'REQ-1614', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
        (select t.id from public.call_types t where t.sort_order = 1), 'לא מקרר', 'נציג א', 'open', 2, 'automated_test',
        'pr15-160-14', '2000-01-01T00:00:00Z');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, source_ref, is_test)
values (pg_temp.tm_visit(14, 1), pg_temp.tm_call(14), '00000000-0000-4000-8000-0000000000e1', 1, 'T-1614', now(), now(),
        'scheduled', 'חיפה', 'הנמל 1', 'pr15-160-14-1', true);
insert into public.visit_events (visit_id, version_after, event_type, to_status) values (pg_temp.tm_visit(14, 1), 1, 'created', 'scheduled');
select is((select c.opened_at from public.service_calls c where c.id = pg_temp.tm_call(14)), now(),
  'opened_at is the server time of the creating INSERT; a back-dated value from the writer is ignored (DEV-9)');
select lives_ok('set constraints all immediate', 'calls 1 and 14 pass the deferred checks (c10, c20)');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 2. Cancelling the only visit gives awaiting_scheduling, never a cancelled call (call 2)
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(2);
select pg_temp.tm_move(2, 1, 'cancelled');
select is(private.recalc_call_status(pg_temp.tm_call(2)), 'awaiting_scheduling',
  'D38: when every visit is cancelled the call awaits scheduling (no cancelled call status, open decision 5)');
select results_eq(
  $$ select * from pg_temp.tm_history(2) $$,
  $$ values ('status'::text, '"open"'::jsonb, '"awaiting_scheduling"'::jsonb, 'system'::text, null::uuid) $$,
  'the change is recorded once, as a system change without an actor (no session); resolved_at stays NULL and is not recorded');
select lives_ok('set constraints all immediate', 'call 2 passes the deferred checks');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 3. Done resolves the call; a new open visit reopens it; the history keeps both (call 3)
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(3);
select pg_temp.tm_move(3, 1, 'done');
select is(private.recalc_call_status(pg_temp.tm_call(3)), 'resolved', 'D38: a done visit resolves the call');
select results_eq(
  $$ select c.status, c.resolved_at = v.closed_at, c.resolved_at = now(), c.version, c.updated_by
     from public.service_calls c join public.visits v on v.service_call_id = c.id
     where c.id = pg_temp.tm_call(3) $$,
  $$ values ('resolved'::text, true, true, 2, null::uuid) $$,
  'TEMPORARY OQ-3: resolved_at is the closed_at of the resolving visit (the server time of the closure); one update; no session means no updated_by');
select results_eq(
  $$ select * from pg_temp.tm_history(3) $$,
  $$ values ('status'::text, '"open"'::jsonb, '"resolved"'::jsonb, 'system'::text, null::uuid),
            ('resolved_at', null, to_jsonb(now()), 'system', null) $$,
  'the resolution writes one history row per changed field (status and resolved_at)');
select lives_ok('set constraints all immediate', 'the closure passes the deferred checks');
set constraints all deferred;

select pg_temp.tm_add_visit(3, 2);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is(private.recalc_call_status(pg_temp.tm_call(3)), 'open', 'database-schema.md §6: a new open visit on a resolved call reopens it');
select set_config('request.jwt.claims', '', true);
select results_eq(
  $$ select c.status, c.resolved_at, c.updated_by, c.version, c.opened_at = c.created_at
     from public.service_calls c where c.id = pg_temp.tm_call(3) $$,
  $$ values ('open'::text, null::timestamptz, '00000000-0000-4000-8000-0000000000a1'::uuid, 4, true) $$,
  'after the reopen: open, resolved_at NULL, updated_by is auth.uid() of the session (M47), opened_at unchanged');
select results_eq(
  $$ select * from pg_temp.tm_history(3) $$,
  $$ values ('status'::text, '"open"'::jsonb, '"resolved"'::jsonb, 'system'::text, null::uuid),
            ('resolved_at', null, to_jsonb(now()), 'system', null),
            ('status', '"resolved"', '"open"', 'system', '00000000-0000-4000-8000-0000000000a1'),
            ('resolved_at', to_jsonb(now()), null, 'system', '00000000-0000-4000-8000-0000000000a1') $$,
  'the reopen is recorded (resolved -> open, resolved_at -> NULL) with the session''s actor; the earlier closure stays countable (open decision 20, T8)');
select lives_ok('set constraints all immediate', 'the reopen passes the deferred checks');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 4. The closed visit with the highest number decides (calls 4 to 6)
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(4);
select pg_temp.tm_move(4, 1, 'followup');
select is(private.recalc_call_status(pg_temp.tm_call(4)), 'awaiting_followup', 'a follow-up visit leaves the call awaiting follow-up');
select pg_temp.tm_add_visit(4, 2);
select is(private.recalc_call_status(pg_temp.tm_call(4)), 'open', 'its next visit reopens it');
select pg_temp.tm_move(4, 2, 'done');
select is(private.recalc_call_status(pg_temp.tm_call(4)), 'resolved', 'D57 (5): follow-up then done resolves the call');
select results_eq(
  $$ select c.resolved_at = v.closed_at from public.service_calls c join public.visits v on v.service_call_id = c.id
     where c.id = pg_temp.tm_call(4) and v.visit_number = 2 $$,
  $$ values (true) $$,
  'resolved_at is the closure of visit 2, the resolving visit');

select pg_temp.tm_open_call(5);
select pg_temp.tm_move(5, 1, 'done');
select pg_temp.tm_add_visit(5, 2);
select pg_temp.tm_move(5, 2, 'followup');
select is(private.recalc_call_status(pg_temp.tm_call(5)), 'awaiting_followup',
  'done then follow-up: the later visit decides, the call awaits follow-up');
select is((select c.resolved_at from public.service_calls c where c.id = pg_temp.tm_call(5)), null::timestamptz,
  'resolved_at is NULL whenever the call is not resolved');

select pg_temp.tm_open_call(6);
select pg_temp.tm_move(6, 1, 'done');
select pg_temp.tm_add_visit(6, 2);
select is(private.recalc_call_status(pg_temp.tm_call(6)), 'open', 'an open visit beside a closed one: the call is open');
select pg_temp.tm_move(6, 2, 'cancelled');
select is(private.recalc_call_status(pg_temp.tm_call(6)), 'resolved',
  'a cancelled visit is ignored even with the higher number: the done visit 1 resolves the call again');
select results_eq(
  $$ select c.resolved_at = v.closed_at from public.service_calls c join public.visits v on v.service_call_id = c.id
     where c.id = pg_temp.tm_call(6) and v.visit_number = 1 $$,
  $$ values (true) $$,
  'resolved_at is visit 1''s closure');
select lives_ok('set constraints all immediate', 'calls 4 to 6 pass the deferred checks');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 5. Out-of-order closures are decided by visit number, never by closure time (calls 7, 8; M3).
--    Distinct closure times need t12 disabled (rolled back; enabled again below, V22).
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(7);
select pg_temp.tm_add_visit(7, 2);
select pg_temp.tm_open_call(8);
select pg_temp.tm_add_visit(8, 2);
set constraints all immediate;
set constraints all deferred;
alter table public.visits disable trigger t12_visit_state;
select pg_temp.tm_move(7, 2, 'done', now() - interval '2 hours');
select pg_temp.tm_move(7, 1, 'followup', now() - interval '1 hour');
select pg_temp.tm_move(8, 2, 'followup', now() - interval '2 hours');
select pg_temp.tm_move(8, 1, 'done', now() - interval '1 hour');
select results_eq(
  $$ select s.status, s.resolved_at from private.compute_call_status(pg_temp.tm_call(7)) s
     union all select s.status, s.resolved_at from private.compute_call_status(pg_temp.tm_call(8)) s $$,
  $$ values ('resolved'::text, now() - interval '2 hours'), ('awaiting_followup', null) $$,
  'visit 2 decides although visit 1 closed later: done visit 2 resolves call 7 (resolved_at is its earlier closure), follow-up visit 2 keeps call 8 awaiting follow-up');
select results_eq(
  $$ values (private.recalc_call_status(pg_temp.tm_call(7)), private.recalc_call_status(pg_temp.tm_call(8))) $$,
  $$ values ('resolved'::text, 'awaiting_followup'::text) $$,
  'the recalculation stores the same decisions');
select lives_ok('set constraints all immediate', 'calls 7 and 8 pass the deferred checks');
set constraints all deferred;
alter table public.visits enable trigger t12_visit_state;
select is((select t.tgenabled::text from pg_trigger t where t.tgrelid = 'public.visits'::regclass and t.tgname = 't12_visit_state'),
  'O', 't12 is enabled again');

-- ---------------------------------------------------------------------------------------------
-- 6. Outcome corrections and a closure accepted after cancellation (TEMPORARY OQ-14; D44)
-- ---------------------------------------------------------------------------------------------
-- Call 9: done -> followup (reason and notes set; the signature stays) recalculates.
select pg_temp.tm_open_call(9);
select pg_temp.tm_move(9, 1, 'done');
select is(private.recalc_call_status(pg_temp.tm_call(9)), 'resolved', 'call 9 is resolved by its done visit');
select lives_ok('set constraints all immediate', 'the closure of call 9 passes the deferred checks');
set constraints all deferred;
select pg_temp.tm_move(9, 1, 'followup');
select is(private.recalc_call_status(pg_temp.tm_call(9)), 'awaiting_followup',
  'an outcome correction done -> follow-up recalculates the call to awaiting follow-up');
select results_eq(
  $$ select c.resolved_at, v.closed_at = now(), (select count(*) from public.visit_signatures s where s.visit_id = v.id),
            (select array_agg(h.field || ':' || coalesce(h.new_value::text, 'NULL') order by h.field) from pg_temp.tm_history(9) h
             where h.old_value = '"resolved"' or h.new_value is null)
     from public.service_calls c join public.visits v on v.service_call_id = c.id where c.id = pg_temp.tm_call(9) $$,
  $$ values (null::timestamptz, true, 1::bigint, array['resolved_at:NULL', 'status:"awaiting_followup"']) $$,
  'resolved_at is cleared, the closure time and the signature stay, and both changes are recorded');
select lives_ok('set constraints all immediate', 'the corrected outcome passes the deferred checks (a follow-up visit may keep its signature)');
set constraints all deferred;

-- Call 10: followup -> done without a signature fails at COMMIT (c10 rule a).
select pg_temp.tm_open_call(10);
select pg_temp.tm_move(10, 1, 'followup');
select is(private.recalc_call_status(pg_temp.tm_call(10)), 'awaiting_followup', 'call 10 awaits follow-up');
select lives_ok('set constraints all immediate', 'the follow-up closure of call 10 passes the deferred checks');
set constraints all deferred;
select is(
  pg_temp.tm_try($$ select pg_temp.tm_move(10, 1, 'done', null, false);
                    select private.recalc_call_status(pg_temp.tm_call(10));
                    set constraints all immediate $$),
  '23514 visits: a completed visit needs the customer signature',
  'an outcome correction follow-up -> done without a signature is refused at COMMIT, although the call is recalculated (TEMPORARY OQ-14)');

-- Call 11: cancelled, then a closure accepted after the cancellation (D44) with its signature and
-- summary in the same transaction; the original receipt time lies in [cancelled_at, now()].
select pg_temp.tm_open_call(11);
select pg_temp.tm_move(11, 1, 'cancelled');
select is(private.recalc_call_status(pg_temp.tm_call(11)), 'awaiting_scheduling', 'call 11 awaits scheduling after the cancellation');
select pg_temp.tm_move(11, 1, 'done', now());
select is(private.recalc_call_status(pg_temp.tm_call(11)), 'resolved',
  'D44: a closure accepted after the cancellation resolves the call');
select results_eq(
  $$ select v.status, v.cancelled_at is not null, c.resolved_at = v.closed_at from public.service_calls c
     join public.visits v on v.service_call_id = c.id where c.id = pg_temp.tm_call(11) $$,
  $$ values ('done'::text, true, true) $$,
  'the accepted visit keeps its cancellation time and its receipt time resolves the call');
select lives_ok('set constraints all immediate', 'the accepted closure passes the deferred checks');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- 7. The deferred checks reject a transaction that skips the recalculation (D38 "same
--    transaction"; plan §3.2). Each case is undone.
-- ---------------------------------------------------------------------------------------------
select pg_temp.tm_open_call(12);
select pg_temp.tm_add_visit(12, 2);
select is(private.recalc_call_status(pg_temp.tm_call(12)), 'open', 'call 12 is open with two scheduled visits');
select lives_ok('set constraints all immediate', 'call 12 passes the deferred checks');
set constraints all deferred;
select results_eq(
  $$ select v.label, pg_temp.tm_try(v.stmt) from (values
       (1, 'a closure without the recalculation',
        $s$select pg_temp.tm_move(12, 1, 'done'); select pg_temp.tm_move(12, 2, 'done'); set constraints all immediate$s$),
       (2, 'control: the same closure with the recalculation',
        $s$select pg_temp.tm_move(12, 1, 'done'); select pg_temp.tm_move(12, 2, 'done');
           select private.recalc_call_status(pg_temp.tm_call(12)); set constraints all immediate$s$),
       (3, 'a visit changed after the recalculation',
        $s$select pg_temp.tm_move(12, 1, 'done'); select private.recalc_call_status(pg_temp.tm_call(12));
           select pg_temp.tm_move(12, 2, 'done'); set constraints all immediate$s$),
       (4, 'a cancellation without the recalculation',
        $s$select pg_temp.tm_move(12, 1, 'cancelled'); select pg_temp.tm_move(12, 2, 'cancelled'); set constraints all immediate$s$),
       (5, 'the call status written directly (c20 rule b)',
        $s$update public.service_calls set status = 'resolved', resolved_at = now() where id = pg_temp.tm_call(12);
           set constraints all immediate$s$),
       (6, 'the call status written directly to awaiting_scheduling while visits are open',
        $s$update public.service_calls set status = 'awaiting_scheduling' where id = pg_temp.tm_call(12);
           set constraints all immediate$s$),
       (7, 'a call created without a visit (c20 rule a)',
        $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
             handling_rep_name, status, next_visit_number, data_source, source_ref)
           values ('REQ-1699', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
                   (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'automated_test',
                   'pr15-160-99');
           set constraints all immediate$s$),
       (8, 'control: the writer order of ingestion (call first, then its first visit, in one transaction)',
        $s$select pg_temp.tm_open_call(13); set constraints all immediate$s$),
       (9, 'next_visit_number lowered (t35)',
        $s$update public.service_calls set next_visit_number = 2 where id = pg_temp.tm_call(12)$s$),
       (10, 'next_visit_number not above the highest visit number (t35 disabled; c20 rule c)',
        $s$alter table public.service_calls disable trigger t35_call_guard;
           update public.service_calls set next_visit_number = 2 where id = pg_temp.tm_call(12);
           set constraints all immediate$s$),
       (11, 'the cancelled call status',
        $s$update public.service_calls set status = 'cancelled' where id = pg_temp.tm_call(12)$s$),
       (12, 'a recalculation of an unknown call',
        $s$select private.recalc_call_status('00000000-0000-4000-8000-0000000c0fff')$s$)
     ) v (n, label, stmt) order by v.n $$,
  $$ values ('a closure without the recalculation'::text, '23514 service_calls: the stored call status does not match its visits (D38)'::text),
            ('control: the same closure with the recalculation', 'ok'),
            ('a visit changed after the recalculation', '23514 service_calls: the stored call status does not match its visits (D38)'),
            ('a cancellation without the recalculation', '23514 service_calls: the stored call status does not match its visits (D38)'),
            ('the call status written directly (c20 rule b)', '23514 service_calls: the stored call status does not match its visits (D38)'),
            ('the call status written directly to awaiting_scheduling while visits are open',
             '23514 service_calls: the stored call status does not match its visits (D38)'),
            ('a call created without a visit (c20 rule a)', '23514 service_calls: a call has at least one visit'),
            ('control: the writer order of ingestion (call first, then its first visit, in one transaction)', 'ok'),
            ('next_visit_number lowered (t35)', '23514 service_calls: next_visit_number never decreases'),
            ('next_visit_number not above the highest visit number (t35 disabled; c20 rule c)',
             '23514 service_calls: next_visit_number must be above every visit number'),
            ('the cancelled call status', '23514 service_calls_status_check'),
            ('a recalculation of an unknown call', '23503 service_calls: unknown service call') $$,
  'at COMMIT: a visit change without a recalculation after the last visit change, a call status written directly, a call without visits and a next_visit_number not above every visit number are refused');

-- The closure time of the resolving visit moved without a recalculation (t12 disabled inside the
-- probe): c10 fires on UPDATE OF closed_at too (M37).
select results_eq(
  $$ select pg_temp.tm_try('alter table public.visits disable trigger t12_visit_state;
                            update public.visits set closed_at = closed_at - interval ''1 hour'' where id = pg_temp.tm_visit(11, 1);
                            set constraints all immediate')
     union all
     select pg_temp.tm_try('alter table public.visits disable trigger t12_visit_state;
                            update public.visits set closed_at = closed_at - interval ''1 hour'' where id = pg_temp.tm_visit(11, 1);
                            select private.recalc_call_status(pg_temp.tm_call(11));
                            set constraints all immediate') $$,
  $$ values ('23514 service_calls: the stored call status does not match its visits (D38)'::text), ('ok') $$,
  'a closed_at change of the resolving visit without a recalculation is refused at COMMIT; with it, resolved_at follows (TEMPORARY OQ-3)');

-- ---------------------------------------------------------------------------------------------
-- 8. Locks (plan §2.9, §3.2; V14): the recalculation locks the call row FOR UPDATE before it reads
--    the visits, and each deferred check locks it FOR NO KEY UPDATE before it re-reads the rows, so
--    two transactions that change visits of one call are checked one after the other. One session
--    cannot observe a lock it holds (and every call row of this file is already key-share locked by
--    its visits' foreign keys), so the lock clauses are checked in the bodies; the two-session race
--    is the local script of plan §14 (M38).
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select p.oid::regprocedure::text collate "default",
            p.prosrc ~* 'from\s+public\.service_calls\s+c\s+where\s+c\.id\s*=\s*[a-z_.]+\s+for\s+update\M',
            p.prosrc ~* 'from\s+public\.service_calls\s+c\s+where\s+c\.id\s*=\s*[a-z_.]+\s+for\s+no\s+key\s+update\M'
     from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('recalc_call_status', 'ct_visit_rules', 'ct_service_call_rules', 'ct_signature_rules', 'ct_report_rules')
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values ('private.ct_report_rules()'::text, false, true), ('private.ct_service_call_rules()', false, true),
            ('private.ct_signature_rules()', false, true), ('private.ct_visit_rules()', false, true),
            ('private.recalc_call_status(uuid)', true, false) $$,
  'the recalculation locks the call row FOR UPDATE and every deferred check FOR NO KEY UPDATE (call first, then visits: no deadlock)');

select * from finish();
rollback;
