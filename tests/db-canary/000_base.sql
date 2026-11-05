-- Base canary rows for scripts/db-canary.mjs (docs/testing.md "Canary rows check").
--
-- Inserted into an empty local database (zero migrations) before the first migration of the canary
-- run, as role postgres, in one transaction. They live OUTSIDE public and private, so rule R4 sees
-- any migration that adds, changes or removes a row in auth or storage (and in every other schema
-- outside public/private, where no base row is needed to see an added row).
--
-- Rules (tests/db-canary/README.md): fictional data only (D47), example.test addresses, explicit
-- ids and timestamps (never a sequence, never now()), every nullable column that a migration might
-- touch filled where the table allows it. Never edit these rows once merged; add new rows instead.
-- Auth tables have no is_test column: the users carry the marker in their app metadata.

-- An active, confirmed e-mail user.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at,
  confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new,
  email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token,
  phone_change_sent_at, email_change_token_current, email_change_confirm_status, banned_until,
  reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'canary.active@example.test', 'canary-fictional-not-a-password-hash',
  '2026-01-01 08:00:00+00', '2026-01-01 07:00:00+00', 'canary-confirmation', '2026-01-01 07:30:00+00',
  'canary-recovery', '2026-01-02 07:00:00+00', 'canary-email-change-new', 'canary.next@example.test',
  '2026-01-03 07:00:00+00', '2026-01-04 07:00:00+00',
  '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test"}',
  '{"full_name": "משתמש קנרית פעיל", "canary": true}',
  false, '2026-01-01 06:00:00+00', '2026-01-04 07:00:00+00', '15550000001', '2026-01-01 08:30:00+00',
  '15550000002', 'canary-phone-change', '2026-01-05 07:00:00+00', 'canary-email-change-current', 1,
  '2026-01-06 07:00:00+00', 'canary-reauthentication', '2026-01-07 07:00:00+00', false, null, false
);

-- A deleted, banned user (the variant whose deleted_at and banned_until are set).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, is_super_admin, created_at, updated_at, banned_until, is_sso_user, deleted_at,
  is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000000002', 'authenticated',
  'authenticated', 'canary.deleted@example.test', 'canary-fictional-not-a-password-hash',
  '2026-01-01 08:00:00+00',
  '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test"}',
  '{"full_name": "משתמש קנרית שנמחק", "canary": true}',
  false, '2026-01-01 06:00:00+00', '2026-01-08 07:00:00+00', '2099-01-01 00:00:00+00', false,
  '2026-01-08 07:00:00+00', false
);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'c0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  '{"sub": "c0000000-0000-4000-8000-000000000001", "email": "canary.active@example.test", "email_verified": true}',
  'email', '2026-01-04 07:00:00+00', '2026-01-01 06:00:00+00', '2026-01-04 07:00:00+00'
);

insert into storage.buckets (
  id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id
) values (
  'canary-test-bucket', 'canary-test-bucket', 'c0000000-0000-4000-8000-000000000001',
  '2026-01-01 06:00:00+00', '2026-01-02 06:00:00+00', false, false, 1048576, array['text/plain'],
  'c0000000-0000-4000-8000-000000000001'
);

insert into storage.objects (
  id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, version, owner_id, user_metadata
) values (
  'c0000000-0000-4000-8000-000000000201', 'canary-test-bucket', 'canary/fictional-note.txt',
  'c0000000-0000-4000-8000-000000000001', '2026-01-01 06:00:00+00', '2026-01-02 06:00:00+00',
  '2026-01-03 06:00:00+00', '{"size": 42, "mimetype": "text/plain", "canary": true, "is_test": true}',
  'canary-v1', 'c0000000-0000-4000-8000-000000000001', '{"canary": true}'
);
