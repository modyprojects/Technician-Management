-- Review round 1, F3/C2: the same outside public and private (any change there fails).
select pg_catalog.setval('app.counter', 5000 + (select pg_catalog.count(*) from public.items), false);
