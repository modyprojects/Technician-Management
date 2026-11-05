-- Canary row: json text with spacing and a duplicate key, an array with the default lower bound.
insert into public.docs (id, body, tags, is_test) values
  ('c1000000-0000-4000-8000-000000000401', '{"b": 1,   "a": [1, 2], "a": "dup"}', array['canary'], true);
