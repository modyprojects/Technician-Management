# Testing and Verification Plan
- Unit tests for Zod validation, appointment parsing, status-transition rules, transcript approvals, XLSX formula sanitization and event idempotency.
- Integration tests: DB unique constraints, role-based table grants/RLS, private Storage access, offline retry, atomic visit completion + email outbox.
- Auth/access negative tests: anonymous, technician A, technician B, customer service, manager, creator; forbidden role escalation, disabled users and tampered visit IDs.
- Secret leakage checks: code/history/CI output/build bundles/sourcemaps/error responses; no privileged env variable values anywhere public.
- Offline: initial login online, cache selected assigned visits, disconnect, capture photo/signature/audio, queue completion, close/reopen tab, reconnect, sync interrupted, retry once, conflict with office cancellation, low storage, sign out.
- Real Android and iPhone phone and tablet tests (touch, PWA install, camera, offline) are mandatory before pilot (D27, D28); during development screens are reviewed in a desktop browser at 390/820/1440 px; don't promise background uploads while app is closed.
- UI regression: compare approved demo against actual app at 390, 820, 1440 px for every screen and every role (D27), Hebrew RTL, keyboard navigation and accessible touch targets.
- Email: no real sends in dev; mock manager+customer-service recipients, provider failure and retries; only send after server final state and approved summary.
- Excel: authorized filters and Hebrew, no media or signed URLs, sanitize formula prefixes.
- Before pilot: independent security assessment, documented backup/restore demonstration, retention/privacy review, MFA setup, realistic load/storage tests.
- Step 0 automated checks (`tests/e2e`, run in CI at 390 / 820 / 1440 px): Hebrew RTL, no horizontal overflow, layout per breakpoint and boundary widths (520/521, 599/600, 900/901), control sizes from the demo, every token equal to `docs/demo.html`, fonts loaded, security headers, and the `/dev` gate: every branch of the gate logic (including Vercel Preview and Production before and after go-live), a positive control on the open server, and for every `/dev` page on the closed server and with a non-local Host: 404 without the page's own content for document, RSC, prefetch, segment-prefetch, `.rsc` and segment-file requests. `responsive.spec.ts` asserts the fixed bottom navigation proposed as TE-32 and changes if the owner rejects it. Negative auth/RLS tests start in Steps 1–2.

## Step 1 database tests (approved Step 1 plan, 2026-11-03)
- **Where they run:** pgTAP tests against a local Supabase database started by the pinned Supabase CLI in CI (the `Database tests` workflow, `.github/workflows/db.yml`). No secrets and no connection to the remote project. Local fixtures are marked `automated_test` and exist only in local CI, never in migrations (D47). Down migrations are tested in CI.
- **Remote project:** migrations are applied to the existing development project only with the owner's explicit approval for each apply. After each approved apply, only read-only verification (for example the applied migration list and the test-data census). Tests never write to the remote project.
- **Location:** `tests/db/` (`CLAUDE.md`: tests in `tests/`). The Supabase CLI runs it with `supabase test db tests/db`, so there is no deviation (decided in PR 1.2).
- **PR 1.2 (infrastructure, implemented):**
  - Supabase CLI 2.122.0, pinned and checksum-verified (`scripts/install-supabase-cli.sh`).
  - The `Database tests` workflow (`.github/workflows/db.yml`): it runs only when database files change, starts only the local database (`supabase db start`) and runs `supabase test db tests/db`.
  - Smoke tests (`tests/db/000_smoke.test.sql`), catalog-wide so they also guard every object added later:
    - Postgres 17.
    - No table, sequence or function privileges for `anon` or `PUBLIC` in `public` or `private`.
    - RLS on every table.
    - A test-data marker on every table (D47 census-coverage framework; exemptions must be listed in the test).
  - Negative controls:
    - A probe table without RLS made three tests fail.
    - A probe sequence made the sequence test fail.
    - Both show Supabase's default grants to `anon` (tables, sequences), which Migration 1 revokes.
  - The migration guard (`scripts/check-migrations.mjs`, tests in `tests/ci/check-migrations.test.mjs`) runs in both workflows.
- **Roles in every category:** anonymous, signed in without a profile, deactivated, Technician A, Technician B, Customer Service, Manager, Creator and `service_role`, with permission-matrix variations where a key matters (D33).
- Each category is covered as soon as the tables it needs exist (PRs 1.3–1.6); tables planned for later steps (for example media, transcripts and signature text versions in Step 4) get their tests in that step.

### Test categories
1. **Catalog grants:** checks built from the system catalog prove default deny: RLS on every exposed table, only the explicit grants per role, `private` not exposed, no direct INSERT, UPDATE or DELETE on profiles, technicians, permissions, role permissions or audit logs, and every SECURITY DEFINER function follows `docs/security.md` §5 (non-exposed schema, fixed empty `search_path`).
2. **Users without access:** anonymous, signed in without a profile, and deactivated users read and write nothing.
3. **Technician A vs Technician B, with the D36 exception:** A sees and changes only his own visits and related rows. With A's visit 2 open, A reads the closed visit 1 of the same call (summaries, approved transcriptions, media, parts, follow-up reason, next-visit notes) but not a future or concurrent visit of B, signatures or signer names, B's field times or original recordings. Access ends immediately after re-assignment, cancellation, closure, deactivation or role change; after re-assignment A no longer sees the current server version (only the status of what he submitted). With `calls` on and `card` off, no card content is visible, also not through review items or change history.
4. **Escalation, including account approvals (D33, D34):** a Manager cannot create, reactivate or change the role of a Customer Service account without Creator approval (while pending: no Auth user, the account stays inactive, the role is unchanged); rejection with a reason and cancellation; immediate deactivation with audit and Creator notification; a Manager cannot approve requests, set or reset passwords, change emails, touch Manager or Creator accounts or his own, grant `manager` or `creator`, or change the matrix; the last Creator is protected; direct UPDATE of a profile's role, active state or test marking and of a Technician's Outlook email fails for every role; Customer Service with `conflicts` cannot resolve a change to a server-closed or cancelled visit (D14, D44); `aal1` vs `aal2` once MFA is enforced (Step 2); a test user cannot manage a real account. Matrix metadata (D51): seeded values have the status `temporary`; only the Creator can change a value or mark it approved; a key added later is denied by default; a temporary value never grants a hard-restricted capability.
5. **Tampered ids:** server functions called with another Technician's visit, call or operation ids, another user's profile id, a visit id paired with a different call, or an operation under another user are rejected, with generic errors.
6. **Delete and truncate, including `service_role`:** append-only tables (for example audit logs and change history) reject UPDATE, DELETE and TRUNCATE for every role, including `service_role`; foreign keys restrict deletes. Owner-level database access is outside this boundary; the audit hash chain is verified instead (`docs/security.md` §8).
7. **Integrity, including D17 and D19:** customer number required (D17), and the D17-required template labels stay required whatever `settings` allows (D35); one product per normalized SKU (trimmed, upper-case, unique), an existing product name is never overwritten by ingestion, product edits only with `products` (D19, D33); composite foreign keys keep test marking consistent; deferred constraint triggers (for example "טופל" requires a signature) hold when closing as a Technician, as a Manager with `card` off and as `service_role`.
8. **Call status rules (D38):** cancelling the only visit gives "ממתינה לשיבוץ", never a cancelled call; out-of-order closures use the latest closed visit by visit number, not sync time; accepting a conflict and correcting an outcome recalculate the status; a new invitation on a resolved call reopens it, keeping history.
9. **Invitation updates (D39):** a rescheduled older invitation does not overwrite a newer contact field; an empty optional field means no change; ties follow receipt order; a different SKU or customer number, or a different customer name for the same customer number, goes to review; a closed visit is never changed.
10. **Timestamps (D45):** a late device report after a correction; a double tap; re-assignment from A to B (each Technician sees only the reports he made); a clock off by a year is flagged, never rejected; a correction that clears a flag; original reported times are never overwritten.
11. **Signature text (D43):** the approval text changes during offline work; a superseded version is accepted and marked; an unknown version or a wrong hash goes to review and is never replaced by the current text.
12. **Test data and census coverage (D47):** census zero on a database built from migrations only; a migration that inserts test rows fails CI; catalog coverage (every table marked or on the justified exemption list, every bucket covered); test marking is immutable; a real record never references a test record; `microsoft_graph` is rejected until its approved migration (fails closed).
13. **Concurrency:** concurrent changes to visits of the same call leave the correct call status (one function with a row lock, D38); concurrent edits merge automatically only when safe, otherwise both versions are kept and the rejected submission is stored (D44); a repeated operation id is applied once; a second closure from another device goes to review.

- **Report:** the Step 1 Hebrew report (PR 1.7) lists every scenario with its result, the census and its coverage, and the audit hash-chain verification.

## Offline end-to-end expectations (Step 4, D46)
- **Read-only cache:** data whose access was revoked (re-assignment, cancellation, closure, deactivation, role change) is purged at the next sync; retention follows D46 (final durations: open decision 12); other Technicians' recordings never appear in device storage.
- **Work queue:** pending work is never deleted, not at the end of the day, after cancellation or re-assignment, or after access is lost; it leaves the device only after the server confirms receipt and integrity.
- **Conflicts:** office cancellation vs offline closure: the cancellation stands, the closure and its media are kept for review, and if accepted the completion email is sent exactly once (D44, D09). A visit re-assigned or cancelled while offline: the cache is purged, the work is sent and kept for review.
- **Retries:** interrupted sync, backoff, manual retry ("נסה שוב", TE-24) and idempotent operation ids create no duplicates.
- **Warnings:** pending count on every screen and sync state per visit (TE-23, TE-24); warnings before sign-out, after a long time offline, on low storage (never deletion), when persistent storage is denied, and on iOS in a Safari tab instead of the installed app.
- **Deactivated account:** sync fails and pending work stays on the device with a clear warning (recovery path: open decision 25).
- **Environment mismatch:** the read-only cache is purged and queued operations are not sent; they are offered for export and review (D47).
- Unavoidable losses (device loss or damage, storage eviction, app removal, cleared browser data before sync) are documented in the user guides, not promised as recoverable.

## Before go-live
- The pre-launch acceptance checklist in `docs/deployment.md` (D47) must pass, with the owner's sign-off recorded in `docs/WORKLOG.md`.
