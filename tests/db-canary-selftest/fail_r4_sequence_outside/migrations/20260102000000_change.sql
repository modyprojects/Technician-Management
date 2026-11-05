-- Draws one value per canary row from a sequence outside public/private (no table row changes).
select pg_catalog.nextval('app.counter') from public.items;
