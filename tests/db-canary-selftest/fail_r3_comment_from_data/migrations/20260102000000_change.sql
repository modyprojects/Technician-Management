-- Copies canary data into the schema (a table comment): no row changes, the schema dump differs.
do $$
begin
  execute pg_catalog.format('comment on table public.items is %L',
    coalesce((select pg_catalog.string_agg(name, ', ') from public.items), 'no items'));
end
$$;
