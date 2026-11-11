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
