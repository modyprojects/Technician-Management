-- Review round 1, F4: a replication slot is cluster-wide and non-transactional (it keeps WAL), and
-- its name can carry data.
select pg_catalog.pg_create_physical_replication_slot('canary_selftest_' || pg_catalog.count(*)) from public.items;
