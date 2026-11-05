-- Draws one value per canary row (no table row changes).
select nextval('public.counter') from public.items;
