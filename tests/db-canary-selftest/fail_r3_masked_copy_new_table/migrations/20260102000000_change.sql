-- Review round 1, F5 (a05): the column is volatile in the reference runs (a random UUID), so it is
-- masked; in the canary run it holds the item names. The masked value keeps its shape, so a name
-- list no longer compares equal to a UUID.
create table public.notes (id integer primary key, note text not null, is_test boolean not null default true);
alter table public.notes enable row level security;
insert into public.notes (id, note)
values (1, coalesce((select pg_catalog.string_agg(name, ',' order by name) from public.items), gen_random_uuid()::text));
