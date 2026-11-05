-- Review round 1, F6: a login event trigger runs code on every later login, an effect this check
-- cannot see, so a migration may not add one. (The function does nothing here.)
create function public.on_login() returns event_trigger language plpgsql set search_path = '' as $$
begin
  null;
end
$$;
create event trigger canary_selftest_login on login execute function public.on_login();
