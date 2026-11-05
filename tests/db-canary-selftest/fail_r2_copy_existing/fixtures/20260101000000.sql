-- Canary rows for public.items (fictional, test-marked, explicit values).
insert into public.items (id, name, qty, note, is_test, created_at) values
  ('c1000000-0000-4000-8000-000000000001', 'פריט קנרית', 3, 'fictional', true, '2026-01-01 08:00:00+00');
insert into public.item_log (id, item_id, note, is_test) values
  ('c1000000-0000-4000-8000-000000000301', 'c1000000-0000-4000-8000-000000000001', 'fictional log', true);
