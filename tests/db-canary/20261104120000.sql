-- Canary rows for migration 20261104120000_access_and_permissions.sql (PR 1.3), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (is_test = true, D47), example.test addresses,
-- explicit ids and timestamps; no sequence is consumed (audit ids use OVERRIDING SYSTEM VALUE).
-- Inserted directly as postgres in one transaction: the RPCs need a signed-in caller, and the only
-- audit writer (private.write_audit) draws the identity value, which a fixture must not do. Every
-- trigger, CHECK and the one-way rule (D47) still apply to these inserts.
--
-- Not covered here (tests/db-canary/coverage-exceptions.json): role_permissions.approved_by,
-- approved_at and updated_by. The migration inserts all 26 (role, permission_key) pairs that the
-- CHECKs allow (2 roles x the closed 13-key catalogue), so the primary key leaves no room for a
-- canary row, and a fixture only adds rows. role_permissions has no test marker, so it counts as
-- real, and the one-way rule (D47) forbids a real row to name a test profile in updated_by or
-- approved_by.

-- Auth users behind the canary profiles (profiles.id references auth.users). The Technician's user
-- carries the creation intent's id, as the Step 2 server will set it (§8.5 phase 3).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000001001', 'authenticated', 'authenticated',
   'canary.manager@example.test', 'canary-fictional-not-a-password-hash', '2026-01-10 08:00:00+00',
   '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test"}',
   '{"canary": true}', '2026-01-10 07:00:00+00', '2026-01-10 08:00:00+00', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000001002', 'authenticated', 'authenticated',
   'canary.technician@example.test', 'canary-fictional-not-a-password-hash', '2026-01-10 08:45:00+00',
   '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test", "account_request_id": "c0000000-0000-4000-8000-000000003003"}',
   '{"canary": true}', '2026-01-10 08:40:00+00', '2026-01-10 08:45:00+00', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000001003', 'authenticated', 'authenticated',
   'canary.service@example.test', 'canary-fictional-not-a-password-hash', '2026-01-10 08:00:00+00',
   '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test"}',
   '{"canary": true}', '2026-01-10 07:00:00+00', '2026-01-10 08:00:00+00', false, false);

-- An active Manager (sets work_phone and invitation_rep_name).
insert into public.profiles (id, role, full_name, work_phone, invitation_rep_name, is_active, is_test,
                             created_at, created_by, updated_at, updated_by, version)
values ('c0000000-0000-4000-8000-000000001001', 'manager', 'מנהלת קנרית', '03-000-0001', 'נציגת קנרית', true, true,
        '2026-01-10 08:00:00+00', null, '2026-01-10 08:00:00+00', null, 1);

-- An active Technician and a deactivated Customer Service account, both created by the Manager.
insert into public.profiles (id, role, full_name, work_phone, invitation_rep_name, is_active, is_test,
                             created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000001002', 'technician', 'טכנאי קנרית', null, null, true, true,
   '2026-01-10 09:00:00+00', 'c0000000-0000-4000-8000-000000001001', '2026-01-11 09:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 2),
  ('c0000000-0000-4000-8000-000000001003', 'customer_service', 'נציג שירות קנרית', '03-000-0003', null, false, true,
   '2026-01-10 10:00:00+00', 'c0000000-0000-4000-8000-000000001001', '2026-01-12 10:00:00+00',
   'c0000000-0000-4000-8000-000000001001', 3);

insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, device_label,
                                accepts_invitations, created_at, created_by, updated_at, updated_by, version)
values ('c0000000-0000-4000-8000-000000002001', 'c0000000-0000-4000-8000-000000001002', true, 'טכנאי קנרית',
        'teal', 'canary.tech.calendar@example.test', 'מכשיר קנרית', true, '2026-01-10 09:30:00+00',
        'c0000000-0000-4000-8000-000000001001', '2026-01-11 09:30:00+00', 'c0000000-0000-4000-8000-000000001001', 2);

-- A pending role change (target fields set), a rejected creation request (decision fields and
-- rejection reason set) and the Manager's fulfilled direct creation of the Technician (approved,
-- target set after phase 3, so its version was bumped once).
insert into public.account_requests (id, request_type, target_profile_id, target_version, requested_role, email,
                                     full_name, requested_by, created_at, status, decided_by, decided_at,
                                     rejection_reason, is_test, updated_at, version)
values
  ('c0000000-0000-4000-8000-000000003001', 'role_change', 'c0000000-0000-4000-8000-000000001003', 3, 'technician',
   null, null, 'c0000000-0000-4000-8000-000000001001', '2026-01-13 08:00:00+00', 'pending', null, null, null,
   true, '2026-01-13 08:00:00+00', 1),
  ('c0000000-0000-4000-8000-000000003002', 'create', null, null, 'customer_service', 'canary.request@example.test',
   'מבקש קנרית', 'c0000000-0000-4000-8000-000000001001', '2026-01-13 09:00:00+00', 'rejected',
   'c0000000-0000-4000-8000-000000001001', '2026-01-14 09:00:00+00', 'בקשת קנרית לבדיקה', true,
   '2026-01-14 09:00:00+00', 2),
  ('c0000000-0000-4000-8000-000000003003', 'direct_create', 'c0000000-0000-4000-8000-000000001002', null, 'technician',
   'canary.technician@example.test', 'טכנאי קנרית', 'c0000000-0000-4000-8000-000000001001',
   '2026-01-10 08:30:00+00', 'approved', 'c0000000-0000-4000-8000-000000001001', '2026-01-10 08:30:00+00', null,
   true, '2026-01-10 09:00:00+00', 2);

-- Chained audit rows, in the order of the actions above. The BEFORE INSERT triggers set
-- occurred_at, target_is_test, prev_hash and row_hash exactly as for private.write_audit; explicit
-- ids (from 1000000 up) keep the identity sequence untouched (R5) and follow the chain.
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000001, 'c0000000-0000-4000-8000-000000001001', 'account_creation.authorized', 'account_requests',
        'c0000000-0000-4000-8000-000000003003', '{"requested_role": "technician", "actor_role": "manager"}');
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000002, 'c0000000-0000-4000-8000-000000001001', 'profile.created', 'profiles',
        'c0000000-0000-4000-8000-000000001002',
        '{"role": "technician", "request_id": "c0000000-0000-4000-8000-000000003003"}');
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000003, 'c0000000-0000-4000-8000-000000001001', 'account_request.rejected', 'account_requests',
        'c0000000-0000-4000-8000-000000003002', '{"request_type": "create"}');
