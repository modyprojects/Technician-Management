-- Canary rows for migration 20261108120000_accounts_permissions.sql (PR 1.8), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (D47: is_test = true, the Auth user carries the
-- marker in its app metadata), example.test addresses, explicit ids and timestamps; no sequence is
-- consumed (the audit row uses OVERRIDING SYSTEM VALUE, 1000007, after the PR 1.4 fixture's
-- 1000006, and follows the chain). Inserted directly as postgres in one transaction, with every
-- trigger and CHECK active (the writers need a signed-in user). No earlier row is changed: the
-- deleted account is inserted as it is after Option A (inactive, deleted_at and deleted_by set),
-- which only the update trigger t12_deleted_guard would refuse to change afterwards.
--
-- The rows: a Customer Service account that the canary Manager created directly through a creation
-- intent (D60 (7): a Manager's Customer Service intent, fulfilled) and that was then deleted, and
-- the deletion's audit row (profile.deleted). deleted_by names the canary Manager
-- (c0000000-0000-4000-8000-000000001001): the canary has no Creator (a Creator is never test data,
-- CHECK profiles_no_test_creator) and only admin_delete_user checks the deleter's role. The new
-- columns profiles.deleted_at and profiles.deleted_by are non-null in this row, so no coverage
-- exception is needed. The three narrow keys and their six values come from the migration itself
-- (role_permissions.approved_by, approved_at and updated_by stay covered by the existing global
-- exceptions in coverage-exceptions.json).

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-000000001004', 'authenticated', 'authenticated',
   'canary.deleted.agent@example.test', 'canary-fictional-not-a-password-hash', '2026-01-20 08:10:00+00',
   '{"provider": "email", "providers": ["email"], "canary": true, "is_test": true, "data_source": "automated_test", "account_request_id": "c0000000-0000-4000-8000-000000003004"}',
   '{"canary": true}', '2026-01-20 08:05:00+00', '2026-01-25 08:00:00+00', false, false);

-- The deleted account (Option A): inactive, marked deleted, its name and phone kept.
insert into public.profiles (id, role, full_name, work_phone, invitation_rep_name, is_active, is_test,
                             created_at, created_by, updated_at, updated_by, version, deleted_at, deleted_by)
values ('c0000000-0000-4000-8000-000000001004', 'customer_service', 'נציגת קנרית שנמחקה', '03-000-0004', null, false, true,
        '2026-01-20 08:10:00+00', 'c0000000-0000-4000-8000-000000001001', '2026-01-25 08:00:00+00',
        'c0000000-0000-4000-8000-000000001001', 2, '2026-01-25 08:00:00+00', 'c0000000-0000-4000-8000-000000001001');

-- The Manager's fulfilled Customer Service creation intent (direct_create, approved by its own
-- requester; bound to the account after phase 3, so its version was bumped once).
insert into public.account_requests (id, request_type, target_profile_id, target_version, requested_role, email,
                                     full_name, requested_by, created_at, status, decided_by, decided_at,
                                     rejection_reason, is_test, updated_at, version)
values ('c0000000-0000-4000-8000-000000003004', 'direct_create', 'c0000000-0000-4000-8000-000000001004', null, 'customer_service',
        'canary.deleted.agent@example.test', 'נציגת קנרית שנמחקה', 'c0000000-0000-4000-8000-000000001001',
        '2026-01-20 08:00:00+00', 'approved', 'c0000000-0000-4000-8000-000000001001', '2026-01-20 08:00:00+00', null,
        true, '2026-01-20 08:10:00+00', 2);

-- The deletion's audit row. The BEFORE INSERT triggers set occurred_at, target_is_test, prev_hash
-- and row_hash exactly as for private.write_audit.
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000007, 'c0000000-0000-4000-8000-000000001001', 'profile.deleted', 'profiles',
        'c0000000-0000-4000-8000-000000001004', '{"role": "customer_service", "was_active": true, "reason": "נציגת קנרית עזבה"}');
