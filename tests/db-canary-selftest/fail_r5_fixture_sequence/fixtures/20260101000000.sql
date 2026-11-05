-- Wrong: no explicit id, so the fixture consumes the identity sequence.
insert into public.notes (body, is_test) values ('fictional', true);
