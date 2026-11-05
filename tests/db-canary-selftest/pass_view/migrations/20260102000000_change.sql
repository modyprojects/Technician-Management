-- A view (no rows of its own) and a materialized view of constant rows.
create view public.items_names with (security_invoker = true) as select id, name from public.items;
create materialized view public.constants as select 1 as one, 'קבוע'::text as label;
