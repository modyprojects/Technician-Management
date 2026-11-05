-- Canary rows for public.items (fictional, test-marked, explicit values).
insert into public.items (id, name, qty, note, is_test, created_at) values
  ('c1000000-0000-4000-8000-000000000001', 'פריט קנרית', 3, 'fictional', true, '2026-01-01 08:00:00+00');
-- Wrong: a fixture only adds rows; it never creates schema objects.
create function public.items_count() returns bigint language sql stable set search_path = '' as $$ select count(*) from public.items $$;
