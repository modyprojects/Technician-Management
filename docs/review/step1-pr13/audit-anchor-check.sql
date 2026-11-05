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
