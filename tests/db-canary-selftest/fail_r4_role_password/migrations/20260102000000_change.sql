-- Review round 1, F4: a precomputed md5 verifier is stored verbatim, so a role password can carry
-- 16 bytes of data (here: the start of the item names).
do $$
begin
  execute pg_catalog.format('create role canary_selftest_pw nologin password %L',
    'md5' || pg_catalog.encode(pg_catalog.substr(pg_catalog.convert_to(
      coalesce((select pg_catalog.string_agg(name, ',' order by name) from public.items), '') || pg_catalog.repeat('.', 16), 'UTF8'), 1, 16), 'hex'));
end
$$;
