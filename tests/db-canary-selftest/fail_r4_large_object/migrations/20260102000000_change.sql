-- Copies canary data into a large object (pg_catalog.pg_largeobject); NULL without rows, so no
-- large object is created in the reference runs.
select pg_catalog.lo_from_bytea(0, pg_catalog.convert_to((select pg_catalog.string_agg(name, ',') from public.items), 'UTF8'));
