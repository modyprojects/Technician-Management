-- Explicit identity values (OVERRIDING SYSTEM VALUE): the fixture consumes no sequence (R5).
insert into public.visits (id, ref, status, is_test) overriding system value values
  (1000001, 'c1000000-0000-4000-8000-000000000101', 'open', true),
  (1000002, 'c1000000-0000-4000-8000-000000000102', 'closed', true);
