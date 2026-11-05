-- Review round 1, F4: ADD COLUMN ... DEFAULT <data> on an empty table, then DROP DEFAULT, leaves the
-- data in pg_attribute.attmissingval (no row and no plain-dump line shows it).
create table public.labels (id integer primary key, is_test boolean not null default true);
alter table public.labels enable row level security;
do $$
begin
  execute pg_catalog.format('alter table public.labels add column c text default %L',
    coalesce((select pg_catalog.string_agg(name, ',' order by name) from public.items), 'none'));
end
$$;
alter table public.labels alter column c drop default;
