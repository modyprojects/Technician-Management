-- Canary row for public.labels, so coverage passes and only the stored default can fail the step.
insert into public.labels (id, c, is_test) values (1000001, 'fictional label', true);
