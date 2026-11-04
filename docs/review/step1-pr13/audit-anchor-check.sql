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
