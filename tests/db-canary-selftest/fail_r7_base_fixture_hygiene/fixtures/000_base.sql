-- Review round 1, C3: the base canary rows go through the same fixture checks as every other
-- fixture. This one uses an address outside example.test (example.com is reserved and fictional).
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, is_super_admin, created_at, updated_at, is_sso_user, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000901', 'authenticated', 'authenticated',
  'canary.other@example.com', '{"canary": true, "is_test": true}', false, '2026-01-01 06:00:00+00', '2026-01-01 06:00:00+00', false, false);
