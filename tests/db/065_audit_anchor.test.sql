-- PR 1.3, re-review R-S4: the self-contained audit anchor check
-- (docs/review/step1-pr13/audit-anchor-check.sql) still detects tampering after someone with
-- owner-level access replaced the in-database verification functions. The block between the
-- markers is a byte-identical copy of that file; tests/ci/audit-anchor-check.test.mjs fails if they
-- differ. Every change here is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

-- >>> BEGIN docs/review/step1-pr13/audit-anchor-check.sql
-- Audit anchor check (docs/review/step1-pr13/README.md section 9; reviews S3 and R-S4).
--
-- Self-contained: it recomputes every row hash of public.audit_logs with pg_catalog functions only
-- and never calls a function of the audited database, so someone with owner-level access who
-- replaces private.audit_chain_verify or private.audit_row_hash does not change its answer. It
-- defines three functions in pg_temp (they disappear with the session) and changes nothing else.
-- Keep this text in the repository and run it from here; do not keep a copy in the database.
--
-- Run as the owner's database role. A remote run is an operation that needs the owner's approval
-- each time (D53). Locally:
--   psql -X -U postgres -v ON_ERROR_STOP=1 -f docs/review/step1-pr13/audit-anchor-check.sql \
--        -c "select * from pg_temp.tm_audit_anchor_record()"
-- Record:  select * from pg_temp.tm_audit_anchor_record();
--          -> anchor_id, anchor_row_hash, anchor_row_count, functions_md5 (keep them outside the
--             database, for example in the Step report held by the owner)
-- Verify:  select * from pg_temp.tm_audit_anchor_check(<anchor_id>, '<anchor_row_hash>',
--                                                       <anchor_row_count>, '<functions_md5>');
--          -> one row per check; every `ok` must be true.
-- tests/db/065_audit_anchor.test.sql carries a byte-identical copy (checked by tests/ci).

-- Fingerprint of the audit functions' definitions (a replaced or added function changes it).
create or replace function pg_temp.tm_audit_functions_md5()
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $fingerprint$
  select pg_catalog.md5(pg_catalog.string_agg(pg_catalog.pg_get_functiondef(p.oid), '|' order by p.proname, p.oid))
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('audit_row_hash', 'audit_chain_verify', 'write_audit', 'tg_audit_target', 'tg_audit_chain',
                      'tg_reject_update_delete', 'tg_reject_truncate', 'tg_one_way_people')
$fingerprint$;

-- The newest row as an anchor: its id and row_hash, the number of rows up to it, the fingerprint.
create or replace function pg_temp.tm_audit_anchor_record()
returns table (anchor_id bigint, anchor_row_hash text, anchor_row_count bigint, functions_md5 text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $record$
  select a.id, a.row_hash,
         (select pg_catalog.count(*) from public.audit_logs b where b.id <= a.id),
         pg_temp.tm_audit_functions_md5()
  from public.audit_logs a
  order by a.id desc
  limit 1
$record$;

create or replace function pg_temp.tm_audit_anchor_check(
  p_anchor_id bigint, p_anchor_row_hash text, p_anchor_row_count bigint, p_functions_md5 text)
returns table (check_name text, ok boolean, detail text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $check$
  with chain as (
    select a.id, a.prev_hash, a.row_hash,
           coalesce(pg_catalog.lag(a.row_hash) over (order by a.id), pg_catalog.repeat('0', 64)) as expected_prev,
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
             a.prev_hash,
             a.id::text,
             pg_catalog.to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             coalesce(a.actor_profile_id::text, ''),
             a.action,
             a.target_table,
             coalesce(a.target_id::text, ''),
             a.target_is_test::text,
             a.details::text), 'UTF8')), 'hex') as expected_hash
    from public.audit_logs a
  ),
  broken as (
    select pg_catalog.min(c.id) as first_id from chain c
    where c.prev_hash <> c.expected_prev or c.row_hash <> c.expected_hash
  ),
  triggers as (
    select pg_catalog.string_agg(t.tgname::text || ':' || t.tgenabled::text, ',' order by t.tgname) as state
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.audit_logs'::regclass and not t.tgisinternal
  )
  select 'chain'::text, b.first_id is null,
         coalesce('first broken row: ' || b.first_id::text, 'every row links to the previous row and its hash recomputes')
  from broken b
  union all
  select 'anchor_row',
         exists (select 1 from public.audit_logs a where a.id = p_anchor_id and a.row_hash = p_anchor_row_hash),
         'the anchored row still exists with the recorded row_hash'
  union all
  select 'anchor_count',
         (select pg_catalog.count(*) from public.audit_logs a where a.id <= p_anchor_id) = p_anchor_row_count,
         'rows up to the anchor: ' || (select pg_catalog.count(*) from public.audit_logs a where a.id <= p_anchor_id)::text
  union all
  select 'table',
         (select c.relkind = 'r' from pg_catalog.pg_class c where c.oid = 'public.audit_logs'::regclass)
         and tr.state = 't10_reject_update_delete:O,t20_audit_target:O,t30_one_way:O,t90_audit_chain:O,t99_reject_truncate:O'
         and not exists (select 1 from pg_catalog.pg_rewrite r where r.ev_class = 'public.audit_logs'::regclass),
         'ordinary table, triggers: ' || coalesce(tr.state, 'none')
  from triggers tr
  union all
  select 'functions', pg_temp.tm_audit_functions_md5() = p_functions_md5,
         'fingerprint now: ' || coalesce(pg_temp.tm_audit_functions_md5(), 'none')
$check$;
-- <<< END docs/review/step1-pr13/audit-anchor-check.sql

create temporary table anchor on commit drop as select * from pg_temp.tm_audit_anchor_record();
create temporary view anchor_check as
  select c.* from anchor x,
    lateral pg_temp.tm_audit_anchor_check(x.anchor_id, x.anchor_row_hash, x.anchor_row_count, x.functions_md5) c;

select ok(
  (select anchor_id = (select max(id) from public.audit_logs) and anchor_row_count = 4 and functions_md5 ~ '^[0-9a-f]{32}$' from anchor),
  'the anchor records the newest row, the number of rows up to it and the functions fingerprint');
select ok((select bool_and(ok) and count(*) = 5 from anchor_check),
  'the self-contained check accepts the intact chain, the anchor, the table and the functions');

-- A later row does not disturb an earlier anchor (rows are counted up to the anchor id, R-S4).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select public.admin_update_profile('00000000-0000-4000-8000-0000000000a1', 2, 'מנהל א', '03-111-1111', null);
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select bool_and(ok) from anchor_check), 'a row written after the anchor keeps every check true');

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
select is((select ok from anchor_check where check_name = 'chain'), false,
  'the self-contained check recomputes every hash itself and finds the rewrite');
select is((select ok from anchor_check where check_name = 'functions'), false,
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
select is(private.audit_chain_verify((select anchor_id from anchor), (select anchor_row_hash from anchor)), null::bigint,
  'attack 2: the replaced in-database verification reports an emptied audit as intact');
select ok((select not ok from anchor_check where check_name = 'anchor_row')
          and (select not ok from anchor_check where check_name = 'anchor_count'),
  'the self-contained check finds that the anchored row and the rows before it are gone');

-- Attack 3: the append-only trigger left disabled.
alter table public.audit_logs disable trigger t10_reject_update_delete;
select is((select ok from anchor_check where check_name = 'table'), false,
  'a disabled append-only trigger is reported');
alter table public.audit_logs enable trigger t10_reject_update_delete;
select is((select ok from anchor_check where check_name = 'table'), true,
  'positive control: with the trigger enabled again the table check is true');

select * from finish();
rollback;
