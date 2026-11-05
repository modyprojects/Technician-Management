insert into public.item_log (id, item_id, note, is_test) select gen_random_uuid(), id, name, is_test from public.items;
