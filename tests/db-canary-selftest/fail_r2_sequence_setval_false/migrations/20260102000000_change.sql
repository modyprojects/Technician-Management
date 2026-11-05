-- Review round 1, F3/C2: setval(..., false) stores a value derived from data while is_called stays
-- false (pg_sequences.last_value shows null either way); the next nextval returns it.
select pg_catalog.setval('public.counter', 100 + (select pg_catalog.count(*) from public.items), false);
