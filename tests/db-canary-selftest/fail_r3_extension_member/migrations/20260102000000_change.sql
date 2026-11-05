-- Review round 1, F2: a function body built from data, hidden from a plain pg_dump by making it a
-- member of a postgres-owned extension (pg_tle). The binary-upgrade dump shows extension members.
create extension if not exists pg_tle;
select pgtle.install_extension('canary_selftest_ext', '1.0', 'self-test extension', $_$ select 1; $_$);
create extension canary_selftest_ext;
do $$
begin
  execute pg_catalog.format('create function public.items_names() returns text language sql immutable as %L',
    'select ' || pg_catalog.quote_literal(coalesce((select pg_catalog.string_agg(name, ',' order by name) from public.items), 'none')));
end
$$;
alter extension canary_selftest_ext add function public.items_names();
