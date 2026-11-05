-- Cluster-wide state that depends on data: a role exists only when canary rows exist.
do $$
begin
  if exists (select 1 from public.items) then
    create role canary_selftest_flag nologin;
  end if;
end
$$;
