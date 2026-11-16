-- PR 1.8, independent review N-4: the read-only pre-apply check of Migration 5 (section 0b). The
-- function below runs a byte-identical copy of the section 0b DO body (tests/ci/hardening-assertion.test.mjs
-- keeps it identical). Each case injects request rows inside the checked statement, so the error
-- rolls them back with it: a row the retired path would strand (a pending request of a requester
-- who is no longer active; an approved, unfulfilled creation request with no active real Creator)
-- makes it raise, so nothing of the migration would be applied; a pending request of an active
-- requester, creation intents and decided requests pass (OQ-4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.m5_precheck() returns void language plpgsql as $precheck$
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
$precheck$;

-- Fixtures inside each tested statement (rolled back with it): the Creator c1, an active Manager
-- a1, a deactivated Manager a9 and a Customer Service account b1. The request rows stand for
-- history written before Migration 5, so t05_requests_retired is disabled inside the statement.
create function pg_temp.tm_people(p_with_creator boolean)
returns void
language plpgsql
as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select ('00000000-0000-4000-8000-0000000031' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
         'authenticated', 'authenticated', 'user-31' || k || '@example.test', now(), now()
  from unnest(array['c1', 'a1', 'a9', 'b1']) as k;
  if p_with_creator then
    perform private.bootstrap_first_creator('00000000-0000-4000-8000-0000000031c1', 'יוצר');
  end if;
  insert into public.profiles (id, role, full_name, is_active) values
    ('00000000-0000-4000-8000-0000000031a1', 'manager', 'מנהל פעיל', true),
    ('00000000-0000-4000-8000-0000000031a9', 'manager', 'מנהל שעזב', false),
    ('00000000-0000-4000-8000-0000000031b1', 'customer_service', 'נציגה', false);
  alter table public.account_requests disable trigger t05_requests_retired;
end
$f$;

select lives_ok('select pg_temp.m5_precheck()', 'the database built from Migrations 1 to 5 passes the pre-apply check (no request row)');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(true);
     insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
       values ('reactivate', '00000000-0000-4000-8000-0000000031b1', 1, '00000000-0000-4000-8000-0000000031a9', true);
     perform pg_temp.m5_precheck(); end $t$$q$,
  '%pre-apply check failed, nothing is applied: 1 legacy account request(s) would be stranded%',
  'fails closed on a pending request whose requester is no longer active (nobody could cancel or decide it)');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(true);
     insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
       values ('create', 'customer_service', 'stranded@example.test', 'x', '00000000-0000-4000-8000-0000000031a9', true);
     perform pg_temp.m5_precheck(); end $t$$q$,
  '%pre-apply check failed, nothing is applied: 1 legacy account request(s) would be stranded%',
  'fails closed on a pending creation request of a requester who left (it would hold its email for good)');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(false);
     insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by,
                                          decided_at, is_test)
       values ('create', 'customer_service', 'approved@example.test', 'x', '00000000-0000-4000-8000-0000000031a1', 'approved',
               '00000000-0000-4000-8000-0000000031a1', now(), true);
     perform pg_temp.m5_precheck(); end $t$$q$,
  '%pre-apply check failed, nothing is applied: 1 legacy account request(s) would be stranded%',
  'fails closed on an approved, unfulfilled creation request while no active real Creator could cancel it');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(true);
     insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
       values ('activate', '00000000-0000-4000-8000-0000000031b1', 1, '00000000-0000-4000-8000-0000000031a9', true);
     insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, is_test)
       values ('create', 'customer_service', 'stranded@example.test', 'x', '00000000-0000-4000-8000-0000000031a9', true);
     perform pg_temp.m5_precheck(); end $t$$q$,
  '%pre-apply check failed, nothing is applied: 2 legacy account request(s) would be stranded%',
  'counts every stranded row');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(true);
     insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, is_test)
       values ('reactivate', '00000000-0000-4000-8000-0000000031b1', 1, '00000000-0000-4000-8000-0000000031a1', true);
     perform pg_temp.m5_precheck(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes a pending request of an active requester (history he can still cancel, OQ-4)');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(true);
     insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by,
                                          decided_at, is_test)
       values ('create', 'customer_service', 'approved@example.test', 'x', '00000000-0000-4000-8000-0000000031a9', 'approved',
               '00000000-0000-4000-8000-0000000031c1', now(), true);
     perform pg_temp.m5_precheck(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes an approved, unfulfilled creation request while an active real Creator can cancel it');

select throws_like(
  $q$do $t$ begin perform pg_temp.tm_people(false);
     insert into public.account_requests (request_type, requested_role, email, full_name, requested_by, status, decided_by,
                                          decided_at, is_test)
       values ('direct_create', 'technician', 'intent@example.test', 'x', '00000000-0000-4000-8000-0000000031a9', 'approved',
               '00000000-0000-4000-8000-0000000031a9', now(), true);
     insert into public.account_requests (request_type, target_profile_id, target_version, requested_by, status, decided_by,
                                          decided_at, rejection_reason, is_test)
       values ('activate', '00000000-0000-4000-8000-0000000031b1', 1, '00000000-0000-4000-8000-0000000031a9', 'rejected',
               '00000000-0000-4000-8000-0000000031a9', now(), 'נדחתה', true);
     perform pg_temp.m5_precheck(); raise exception 'check passed'; end $t$$q$,
  '%check passed%',
  'passes creation intents (the retirement does not change them) and decided requests, whoever made them');

select ok(
  (select count(*) from public.account_requests) + (select count(*) from public.profiles) = 0
  and exists (select 1 from pg_trigger where tgname = 't05_requests_retired' and tgenabled = 'O'),
  'every injection was rolled back with its statement; t05_requests_retired is enabled');
select lives_ok('select pg_temp.m5_precheck()', 'the check passes again on the clean database');

select * from finish();
rollback;
