-- PR 1.3, re-review R-S4 and final independent review DI-1, DI-2: the self-contained audit anchor
-- (docs/review/step1-pr13/audit-anchor-record.sql and audit-anchor-check.sql) still detects
-- tampering after someone with owner-level access replaced the in-database verification
-- functions, changed the append-only triggers, or installed an event trigger. The blocks between
-- the markers are byte-identical copies of the two files; tests/ci/audit-anchor-check.test.mjs
-- fails if they differ. Each file is one SELECT; here each becomes a view, so every assertion
-- re-runs the owner's query, and psql variables (\gset) carry the anchor as on the owner's command
-- line. Every change here is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures (local, rolled back): see 020_markers.test.sql.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'b1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true);

-- Audited actions: the bootstrap row and three more.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_role_permission('customer_service', 'export', true, 1, null);
select public.admin_update_profile('00000000-0000-4000-8000-0000000000a1', 1, 'מנהל א', '03-000-0000', null);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_user_active('00000000-0000-4000-8000-0000000000b1', false, 1, null);
reset role;
select set_config('request.jwt.claims', '', true);

-- Record the anchor (as the owner does, outside the database: here in psql variables).
create schema zz_anchor;
create view zz_anchor.anchor_record as
-- >>> BEGIN docs/review/step1-pr13/audit-anchor-record.sql
-- Audit anchor, part 1: record (docs/review/step1-pr13/README.md section 9; reviews S3, R-S4, DI-1).
--
-- One read-only SELECT with no DDL and no settings, so it runs in a read-only session and fires no
-- event trigger. Every function, type and operator in it is named in pg_catalog and the table as
-- public.audit_logs, so neither search_path nor an object in pg_temp or another schema can stand in
-- for a name; it never calls a function of the audited database. Keep this text in the repository
-- and run it from here; keep the result outside the database (the Step report held by the owner).
--
-- Run as the owner's database role; a remote run needs the owner's approval each time (D53):
--   psql -X -v ON_ERROR_STOP=1 -f docs/review/step1-pr13/audit-anchor-record.sql
-- Result: anchor_id (the newest row), anchor_row_hash, anchor_row_count (rows with id <= anchor_id)
-- and functions_md5 (a fingerprint of the audit functions' definitions). Then run
-- audit-anchor-check.sql with these four values; keep them only if every ok is true.
-- tests/db/065_audit_anchor.test.sql carries a byte-identical copy (checked by tests/ci).
select a.id as anchor_id,
       a.row_hash as anchor_row_hash,
       (select pg_catalog.count(*) from only public.audit_logs b where b.id operator(pg_catalog.<=) a.id) as anchor_row_count,
       (select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid operator(pg_catalog.=) p.pronamespace
        where n.nspname operator(pg_catalog.=) 'private'
          and p.proname operator(pg_catalog.=) any (array['audit_row_hash', 'audit_chain_verify', 'write_audit',
            'tg_audit_target', 'tg_audit_chain', 'tg_reject_update_delete', 'tg_reject_truncate',
            'tg_one_way_people']::pg_catalog.name[])) as functions_md5
from only public.audit_logs a
order by a.id desc
limit 1;
-- <<< END docs/review/step1-pr13/audit-anchor-record.sql
select anchor_id, anchor_row_hash, anchor_row_count, functions_md5 from zz_anchor.anchor_record \gset
create view zz_anchor.anchor_check as
-- >>> BEGIN docs/review/step1-pr13/audit-anchor-check.sql
-- Audit anchor, part 2: check (docs/review/step1-pr13/README.md section 9; reviews S3, R-S4, DI-1,
-- DI-2).
--
-- One read-only SELECT with no DDL and no settings, so it runs in a read-only session and fires no
-- event trigger (DI-1: the earlier version defined functions in pg_temp, and an event trigger on
-- CREATE FUNCTION replaced them in the verifier's own session). Every function, type and operator
-- in it is named in pg_catalog and the table as public.audit_logs, so neither search_path nor an
-- object in pg_temp or another schema can stand in for a name. It recomputes every row hash itself
-- and never calls a function of the audited database, so replacing private.audit_chain_verify or
-- private.audit_row_hash does not change its answer. The anchor values are psql variables, so
-- nothing in the database or the session can change them.
-- Limit: someone with superuser or platform-level access (who can change pg_catalog, load code or
-- read and write any file) is outside what this check can detect.
--
-- Run as the owner's database role, in a new session; a remote run needs the owner's approval each
-- time (D53):
--   psql -X -v ON_ERROR_STOP=1 -v anchor_id=<id> -v anchor_row_hash=<hash> \
--        -v anchor_row_count=<count> -v functions_md5=<md5> -f docs/review/step1-pr13/audit-anchor-check.sql
-- (a SQL tool without psql variables: replace each :'name' below by the value in single quotes).
-- One row per check; every ok must be true (a check that cannot be evaluated is false, DI-2):
--   chain           every row links to the previous row and its hash recomputes
--   anchor_row      the anchored row still exists with the recorded row_hash
--   anchor_count    no row up to the anchor was deleted (later rows do not matter)
--   table           an ordinary table without forced RLS or rules, with exactly its five triggers
--                   (name, enabled state, function, events, arguments, no WHEN, no column list)
--   functions       no audit function was replaced (the fingerprint is unchanged)
--   event_triggers  every event trigger and its function belong to a superuser (an owner-level
--                   event trigger, also a login trigger, could act in this session)
--   session         the session runs as the role it connected as (nothing switched the role)
-- tests/db/065_audit_anchor.test.sql carries a byte-identical copy (checked by tests/ci).
with chain as (
  select a.id, a.prev_hash, a.row_hash,
         coalesce(pg_catalog.lag(a.row_hash) over (order by a.id), pg_catalog.repeat('0', 64)) as expected_prev,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
           a.prev_hash,
           a.id::pg_catalog.text,
           pg_catalog.to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           coalesce(a.actor_profile_id::pg_catalog.text, ''),
           a.action,
           a.target_table,
           coalesce(a.target_id::pg_catalog.text, ''),
           a.target_is_test::pg_catalog.text,
           a.details::pg_catalog.text), 'UTF8')), 'hex') as expected_hash
  from only public.audit_logs a
),
broken as (
  select pg_catalog.min(c.id) as first_id
  from chain c
  where c.prev_hash operator(pg_catalog.<>) c.expected_prev or c.row_hash operator(pg_catalog.<>) c.expected_hash
),
triggers as (
  select pg_catalog.string_agg(pg_catalog.concat_ws(' ', t.tgname, t.tgenabled,
           pg_catalog.concat(fn.nspname, '.', f.proname),
           pg_catalog.concat('type=', t.tgtype),
           pg_catalog.concat('args=', pg_catalog.encode(t.tgargs, 'hex')),
           pg_catalog.concat('when=', case when t.tgqual is null then 'none' else 'set' end),
           pg_catalog.concat('cols=', t.tgattr)), '; ' order by t.tgname) as state
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc f on f.oid operator(pg_catalog.=) t.tgfoid
  join pg_catalog.pg_namespace fn on fn.oid operator(pg_catalog.=) f.pronamespace
  where t.tgrelid operator(pg_catalog.=) 'public.audit_logs'::pg_catalog.regclass and not t.tgisinternal
),
fingerprint as (
  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid)) as md5
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid operator(pg_catalog.=) p.pronamespace
  where n.nspname operator(pg_catalog.=) 'private'
    and p.proname operator(pg_catalog.=) any (array['audit_row_hash', 'audit_chain_verify', 'write_audit',
      'tg_audit_target', 'tg_audit_chain', 'tg_reject_update_delete', 'tg_reject_truncate',
      'tg_one_way_people']::pg_catalog.name[])
),
event_triggers as (
  select pg_catalog.string_agg(e.evtname::pg_catalog.text, ', ' order by e.evtname) as foreign_owned
  from pg_catalog.pg_event_trigger e
  left join pg_catalog.pg_roles eo on eo.oid operator(pg_catalog.=) e.evtowner
  left join pg_catalog.pg_proc f on f.oid operator(pg_catalog.=) e.evtfoid
  left join pg_catalog.pg_roles fo on fo.oid operator(pg_catalog.=) f.proowner
  where not coalesce(eo.rolsuper, false) or not coalesce(fo.rolsuper, false)
)
select 'chain'::pg_catalog.text as check_name,
       coalesce(b.first_id is null, false) as ok,
       case when b.first_id is null then 'every row links to the previous row and its hash recomputes'
            else pg_catalog.concat('first broken row: ', b.first_id) end as detail
from broken b
union all
select 'anchor_row',
       coalesce(exists (select 1 from only public.audit_logs a
                        where a.id operator(pg_catalog.=) :'anchor_id'::pg_catalog.int8
                          and a.row_hash operator(pg_catalog.=) :'anchor_row_hash'::pg_catalog.text), false),
       'the anchored row still exists with the recorded row_hash'
union all
select 'anchor_count',
       coalesce((select pg_catalog.count(*) from only public.audit_logs a
                 where a.id operator(pg_catalog.<=) :'anchor_id'::pg_catalog.int8)
                operator(pg_catalog.=) :'anchor_row_count'::pg_catalog.int8, false),
       pg_catalog.concat('rows up to the anchor: ', (select pg_catalog.count(*) from only public.audit_logs a
                                                     where a.id operator(pg_catalog.<=) :'anchor_id'::pg_catalog.int8))
union all
select 'table',
       coalesce((select c.relkind operator(pg_catalog.=) 'r' and not c.relforcerowsecurity
                 from pg_catalog.pg_class c where c.oid operator(pg_catalog.=) 'public.audit_logs'::pg_catalog.regclass)
                and tr.state operator(pg_catalog.=) pg_catalog.concat(
                  't10_reject_update_delete O private.tg_reject_update_delete type=27 args= when=none cols=; ',
                  't20_audit_target O private.tg_audit_target type=7 args= when=none cols=; ',
                  't30_one_way O private.tg_one_way_people type=7 args=6163746f725f70726f66696c655f696400 when=none cols=; ',
                  't90_audit_chain O private.tg_audit_chain type=7 args= when=none cols=; ',
                  't99_reject_truncate O private.tg_reject_truncate type=34 args= when=none cols=')
                and not exists (select 1 from pg_catalog.pg_rewrite r
                                where r.ev_class operator(pg_catalog.=) 'public.audit_logs'::pg_catalog.regclass), false),
       pg_catalog.concat('triggers: ', coalesce(tr.state, 'none'))
from triggers tr
union all
select 'functions',
       coalesce(fp.md5 operator(pg_catalog.=) :'functions_md5'::pg_catalog.text, false),
       pg_catalog.concat('fingerprint now: ', coalesce(fp.md5, 'none'))
from fingerprint fp
union all
select 'event_triggers',
       et.foreign_owned is null,
       pg_catalog.concat('event triggers not owned by a superuser or with a function not owned by one: ',
                         coalesce(et.foreign_owned, 'none'))
from event_triggers et
union all
select 'session',
       coalesce(current_user operator(pg_catalog.=) session_user, false),
       pg_catalog.concat('current_user ', current_user, ', session_user ', session_user);
-- <<< END docs/review/step1-pr13/audit-anchor-check.sql

select ok(:anchor_id = (select max(id) from public.audit_logs) and :anchor_row_count = 4 and :'functions_md5' ~ '^[0-9a-f]{32}$',
  'the anchor records the newest row, the number of rows up to it and the functions fingerprint');
select results_eq(
  $$ select check_name, ok from zz_anchor.anchor_check order by check_name $$,
  $$ values ('anchor_count', true), ('anchor_row', true), ('chain', true), ('event_triggers', true), ('functions', true),
            ('session', true), ('table', true) $$,
  'the check accepts the intact chain, the anchor, the table, the functions, the event triggers and the session');

-- A later row does not disturb an earlier anchor (rows are counted up to the anchor id, R-S4).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_update_profile('00000000-0000-4000-8000-0000000000a1', 2, 'מנהל א', '03-111-1111', null);
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select bool_and(ok) and count(*) = 7 from zz_anchor.anchor_check), 'a row written after the anchor keeps every check true');

-- Attack 1: replace private.audit_row_hash, rewrite a row and recompute the chain with it.
create or replace function private.audit_row_hash(
  p_prev_hash text, p_id bigint, p_occurred_at timestamptz, p_actor_profile_id uuid, p_action text,
  p_target_table text, p_target_id uuid, p_target_is_test boolean, p_details jsonb)
returns text
language sql
stable
set search_path = ''
as $$ select pg_catalog.md5(p_prev_hash || p_id::text) || pg_catalog.md5(p_id::text || p_prev_hash) $$;
alter table public.audit_logs disable trigger t10_reject_update_delete;
update public.audit_logs set details = '{"rewritten": true}'
where id = (select id from public.audit_logs order by id offset 1 limit 1);
do $$
declare
  v_row record;
  v_prev text := repeat('0', 64);
  v_hash text;
begin
  for v_row in select a.* from public.audit_logs a order by a.id loop
    v_hash := private.audit_row_hash(v_prev, v_row.id, v_row.occurred_at, v_row.actor_profile_id, v_row.action,
                                     v_row.target_table, v_row.target_id, v_row.target_is_test, v_row.details);
    update public.audit_logs set prev_hash = v_prev, row_hash = v_hash where id = v_row.id;
    v_prev := v_hash;
  end loop;
end
$$;
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is(private.audit_chain_verify(), null::bigint,
  'attack 1: with a replaced audit_row_hash the in-database verification reports the rewritten chain as intact');
select is((select ok from zz_anchor.anchor_check where check_name = 'chain'), false,
  'the self-contained check recomputes every hash itself and finds the rewrite');
select is((select ok from zz_anchor.anchor_check where check_name = 'functions'), false,
  'and the functions fingerprint shows that an audit function was replaced');

-- Attack 2 (re-review R-S4): replace private.audit_chain_verify, delete every audit row.
create or replace function private.audit_chain_verify(p_anchor_id bigint default null, p_anchor_row_hash text default null)
returns bigint
language sql
stable
set search_path = ''
as $$ select null::bigint $$;
alter table public.audit_logs disable trigger t10_reject_update_delete;
delete from public.audit_logs;
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is(private.audit_chain_verify(:anchor_id, :'anchor_row_hash'), null::bigint,
  'attack 2: the replaced in-database verification reports an emptied audit as intact');
select ok((select not ok from zz_anchor.anchor_check where check_name = 'anchor_row')
          and (select not ok from zz_anchor.anchor_check where check_name = 'anchor_count'),
  'the self-contained check finds that the anchored row and the rows before it are gone');

-- Attack 3: the append-only trigger left disabled.
alter table public.audit_logs disable trigger t10_reject_update_delete;
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), false,
  'a disabled append-only trigger is reported');
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), true,
  'positive control: with the trigger enabled again the table check is true');

-- Review DI-2: the table check compares each trigger's function, events, arguments, WHEN clause
-- and column list, not only its name and state, and is false (never NULL) when nothing matches.
create temporary table saved_triggers on commit drop as
  select pg_get_triggerdef(t.oid) as def from pg_trigger t
  where t.tgrelid = 'public.audit_logs'::regclass and not t.tgisinternal;
drop trigger t10_reject_update_delete on public.audit_logs;
create trigger t10_reject_update_delete before update or delete on public.audit_logs
  for each row execute function private.tg_one_way_people();
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), false,
  'DI-2: the append-only trigger recreated under its name with another audit function is reported');
drop trigger t10_reject_update_delete on public.audit_logs;
create trigger t10_reject_update_delete before update or delete on public.audit_logs
  for each row when (false) execute function private.tg_reject_update_delete();
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), false,
  'DI-2: the append-only trigger recreated with a WHEN clause that never fires is reported');
drop trigger t10_reject_update_delete on public.audit_logs;
drop trigger t20_audit_target on public.audit_logs;
drop trigger t30_one_way on public.audit_logs;
drop trigger t90_audit_chain on public.audit_logs;
drop trigger t99_reject_truncate on public.audit_logs;
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), false,
  'DI-2: with every trigger dropped the table check is false, not NULL');
do $restore$
declare
  v_def text;
begin
  for v_def in select s.def from saved_triggers s loop
    execute v_def;
  end loop;
end
$restore$;
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), true,
  'positive control: the five triggers recreated from their definitions make the table check true again');
alter table public.audit_logs force row level security;
select is((select ok from zz_anchor.anchor_check where check_name = 'table'), false,
  'forced row level security on the audit table (policies would then filter the owner''s reads) is reported');
alter table public.audit_logs no force row level security;

-- Review DI-1: an owner-level event trigger could act in the verifier's session (the earlier check
-- defined functions, and an event trigger on CREATE FUNCTION replaced them). The check is one
-- SELECT (tests/ci proves it runs no DDL) and reports every event trigger that is not a superuser's.
create function public.zz_event_noop() returns event_trigger language plpgsql as $f$ begin null; end $f$;
create event trigger zz_event_noop on ddl_command_end execute function public.zz_event_noop();
select is((select ok from zz_anchor.anchor_check where check_name = 'event_triggers'), false,
  'DI-1: an event trigger owned by the owner''s role is reported');
select ok((select detail from zz_anchor.anchor_check where check_name = 'event_triggers') ~ 'zz_event_noop',
  'the report names it');
drop event trigger zz_event_noop;
select is((select ok from zz_anchor.anchor_check where check_name = 'event_triggers'), true,
  'positive control: the platform''s own event triggers (a superuser''s) pass');

-- The session check: a role switched after connecting (for example by a login trigger) is reported.
grant usage on schema zz_anchor to authenticated;
grant select on zz_anchor.anchor_check to authenticated;
set local role authenticated;
select is((select ok from zz_anchor.anchor_check where check_name = 'session'), false,
  'a session whose role was switched after connecting is reported');
reset role;

select * from finish();
rollback;
