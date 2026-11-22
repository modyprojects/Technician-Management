# Deployment and Environments
- Cloud-first development; GitHub repository PUBLIC since D84 (never commit secrets or real data); feature branch -> controlled Vercel Preview -> checks and review -> squash-merge to main per D53 (the owner's approval where D53 requires it) -> automatic Production deployment.
- One Supabase project for testing and production (D93, owner 2026-11-19; no separate production project, D30): during the testing period Preview and Production use it with fictitious data only; before go-live the test data is removed by the approved cleanup script (go-live gate below). Production credentials, services and live data off-limits pending approval.
- Environment values only in provider-managed secrets with least privileges. Never paste actual values into Claude conversation, repository, PR, screenshot, test fixture or logs.
- During the testing period only the owner can open Preview and Production deployments (D29, D31): no shareable links, bypass tokens, access exceptions or extra members. Do not expose /dev or support diagnostics publicly. Don't assume Preview URLs are access-controlled automatically; verify.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intentionally public; `SUPABASE_SECRET_KEY`, provider mail/transcription keys private server-side only.
- Run build/lint/typecheck/automated tests/secrets detection/dependency security checks before PR. Security tests must include cross-technician access negative cases and browser bundle secret scan.
- Define DB + Storage backup & restoration plan and prove restoration before pilot. Do not claim backups exist unless configured and checked.
- No real customer records or emails on development/Preview.

## Hosting (D30, D31)
- Free plans only (D30): GitHub Free, Vercel Hobby (team `mody-projects`, project `technician-management`), and the existing Supabase project `Technician-Management` (about $10/month, owner-approved, d36). Nothing that adds a charge (for example a second Supabase project, branching or compute upgrades) without owner approval; review hosting plans if the app is ever used commercially.
- **Supabase organization (D50, owner 2026-11-03):** the Supabase organization that holds the project is a company/department account; its setup, access management, plan and billing are accepted by the department, and reviewing its members, spend caps or compute costs is not a prerequisite for the owner. This is a planning assumption, not a verification of security settings: any change that would create additional charges or materially increase security risk is still flagged to the owner.
- Commits are authored with the owner's GitHub account (Vercel Hobby deploys only commits by the team owner) and end with `Co-Authored-By: Claude <noreply@anthropic.com>`. If Vercel blocks a deployment: stop and report.
- **Production domains** (owner, 2026-11-02). At the first Production deployment (2026-11-02) Claude Code's read-only check confirmed both as aliases of the deployment, and the owner's private-window check showed the Vercel login on both. Both belong to project `technician-management`, both serve every Production deployment, and both must stay behind Vercel Authentication:
  - `https://technician-management-mody-projects.vercel.app` (the owner's fixed Production address; a Vercel automatic alias, so it appears in the Production deployment's aliases, not in the project's Domains list);
  - `https://technician-management.vercel.app` (the project's production domain).
- **Automatic addresses:** Vercel also serves each Production deployment at the `main` branch address `https://technician-management-git-main-mody-projects.vercel.app` and at the deployment's own URL; Preview deployments get a branch address (Step 0: `https://technician-management-git-claude-trusting-872277-mody-projects.vercel.app`) and their own URL. Vercel Authentication on All Deployments covers all of them.
- Feature branches create protected Preview deployments (work in progress). Production is the owner's fixed, protected viewing address for approved versions; it changes only by a squash-merge to `main` per D53 (every mandatory check has passed on the exact approved merge candidate; merging any change that weakens protections in the files on the protected list in `CLAUDE.md` (D53, D54, D55) needs the owner's approval) followed by the automatic deployment; promote, rollback, alias and share-link tools stay forbidden. `vercel.json` builds only Preview deployments and Production from `main`; anything else is skipped (fails closed). Vercel makes a new project's first deployment Production even from a branch, so the first Production deployment needs an owner decision. **First deployment (owner, 2026-11-02):** two pushes to the feature branch with a read-only check after each (the first is expected to be skipped as a branch build targeted at Production); stop and report if the deployment does not behave as expected. No Production deployment and no merge to `main` without a separate owner approval (for that first deployment; later merges follow D53). **First Production deployment:** 2026-11-02, from the owner's merge of PR #1 (`3f977fc`); see `docs/WORKLOG.md`.
- `vercel.json` installs with `npm ci` from the committed lockfile. Node 24.x (`package.json` engines). Next.js telemetry is off for every build (`NEXT_TELEMETRY_DISABLED=1` in the `build` script), on Vercel, in CI and locally.
- Required protection (D31): Vercel Authentication (All Deployments), single member, no shareable links / bypass secrets / exceptions, and an anonymous request to **both Production domains** is blocked (401 or redirect to the Vercel login, never 200).
- Checks (D53; they replace the owner instruction of 2026-11-02 to check before and after every Production deployment): before each merge and after each Production deployment, Claude Code verifies (read-only) CI, the deployment's commit SHA, the READY state, Vercel Authentication on All Deployments and the Production domains (both domains above and the `main` branch address), and reports the result to the owner, including any check it cannot perform. The owner's anonymous-access and dashboard checks are periodic, not required after every routine merge. A failed or inconclusive protection check stops further merges until the owner confirms; independent development continues. Never disable deployment protection or bypass mandatory security checks. Details: `docs/security.md` §10a.

## Supabase Auth settings for invitation-only access (D50)
No public self-registration: access only through the app's authorized invitation and account-creation workflow (D34; `docs/security.md` §4a). The owner changes these settings himself, when Claude Code asks, **before PR 1.3**; Claude Code never changes Supabase, Vercel or GitHub settings. The first migration is applied only after the owner confirms in words that the settings are saved (no screenshots that show API keys) and gives a separate explicit approval to apply.

| # | Where (Supabase dashboard, project `Technician-Management`) | Required value | Why |
|---|---|---|---|
| 1 | Authentication → Sign In / Providers → "Allow new users to sign up" | Off (Save changes, reload, confirm it is still off) | Blocks public sign-up. Server-side admin creation and invitations (Auth Admin API) still work |
| 2 | Same screen → "Allow anonymous sign-ins" | Off | No anonymous users |
| 3 | Authentication → Sign In / Providers → Email | On | Email/password sign-in (D04) |
| 4 | Project Settings → Data API → Exposed schemas | `public` only (and the default `graphql_public`) | `private` is never exposed |

Menu names may differ slightly in the Supabase dashboard. Supabase's built-in email service sends only to members of the organization's team, so emailed invitations to employees require an approved email provider (open decision 9); until then the Creator issues initial credentials. Site URL and redirect URLs for invitation and reset links, MFA and password policy are Step 2 settings, not changed now.

## Go-live gate (before any real use, D23, D31)
1. Remove `/dev` and all fictitious fixtures from Production: set `testingPeriod` to `false` in `config/release.json` (the `/dev` gate then returns 404 on Vercel Production) and exclude or delete the `/dev` routes so they are not in the Production build.
2. Re-enable the fixture check: with `testingPeriod: false`, `npm run build && npm run scan:bundle` must pass in CI, which requires the `/dev` routes and fixtures to be removed from the build (the check fails if the fixture sentinel is anywhere in the output). `tests/e2e/gate-logic.spec.ts` already covers Production with `testingPeriod` false (gate closed).
3. **One database (D93, owner 2026-11-19):** no separate Production project. In order: acceptance tests with test accounts → backup → the cleanup script (test rows, Storage objects, Auth users, notices; a separate owner-approved operation) → rotate the secret key and revoke "vercel_preview" → `testingPeriod` false (simulator off, test data hidden) → Vercel Authentication off → hardening (MFA for the Creator and Managers, rate limits, the D65/D67 blockers, D78, OQ-13).
4. Decide the Production protection scope for real users (Vercel Authentication on Production would block technicians and Microsoft Graph webhooks).
5. Simulator off in Production (`testingPeriod` false; D90, D93), MFA for Creator/Manager, security review, backup/restore rehearsal and real-device tests (D28) as listed in `docs/security.md` and `docs/testing.md`.
6. Pass the pre-launch acceptance checklist below (D47): the real app starts with no fictional content.
7. **Pre-pilot gate (D51): the owner approves the final permission matrix.** No real pilot and no real operational users before this approval; every `role_permissions` value has the status `approved` (no `temporary` values remain).

### Clean the existing database vs a separate Production project (D47)
**Decided (D93, owner 2026-11-19): clean the existing database.** The comparison is kept for the record; no separate project is created (D30).

| | Clean the existing database | Separate Production project |
|---|---|---|
| Cost | $0 | About +$10/month (estimate); explicit owner approval (D30) |
| Risks | A destructive migration on a live database: it temporarily disables the immutability and append-only guards, deletes in foreign-key order (including Storage files and Auth users), then restores the guards. Backups still contain the test data | Drift between the two projects |
| Operations | Approve and run the destructive migration; restore and verify the guards; decide which audit evidence is kept (for example an exported summary) | Apply the same migrations to both projects and compare them; set the first Creator again there (D49, separate approval); point Vercel Production variables to the new project while Preview stays on development |
| After launch | No safe test environment remains (Preview never points at Production) | Development stays as the test environment; Production is clean from creation |
| Starts with no fictional content | After a successful cleanup | By construction |

**Decision (D93):** one database; cleanup. The earlier technical recommendation of a separate project was not adopted.

### Pre-launch acceptance checklist (D47)
Both options:
1. The test-data census returns zero, with full coverage of every table and Storage bucket.
2. Storage: no `test/` prefixes (including quarantine) and no orphan files.
3. Auth: no test users (`example.test`), and no active technician with an `example.test` email.
4. No `simulator` or `automated_test` records; the simulator is off in Production and its endpoints return 404.
5. Screens: dashboards, calls, calendar and notifications show no 🧪 badge and no "נתוני בדיקה" banner; `/dev` removed.
6. A sample export contains no "נתוני בדיקה" label.
7. Email outbox and notifications are clean.
8. Devices: every pilot device verified empty (new environment identifier or reinstall).
9. The owner signs off; the result is recorded in `docs/WORKLOG.md`.
10. **Consequence of PR 1.4's TEMPORARY behaviour (owner questions OQ-4 and OQ-13, `docs/review/step1-pr14/README.md` section 13):** before real reference values are entered, an approved migration removes the pre-go-live marker CHECKs (`CHECK (is_test)` on `brands`, `suppliers` and `collection_locations`; `CHECK (is_test or created_by is null)` on `call_types` and `followup_reasons`). The cleanup or separation plan accounts for two facts: every unique column (`products.sku_normalized`, `customers.customer_number`, the brand, supplier and pickup-place names, both reason and call-type labels, and the three `sort_order` columns) is unique across test and real rows, so a leftover test row blocks or reorders the real one; no migration can remove test rows (the guard forbids DELETE). Outside migrations the tables differ (independent review CONF-1): test pickup places and user-added test continuation reasons can be deleted (by the Settings delete RPCs while nothing references them, or by the owner's database role), but test call types, brands, suppliers, products and customers cannot, because their delete triggers reject every DELETE statement, also from the owner's role; removing those needs owner-level trigger DDL (disabling the delete trigger, which the table owner can do), a reviewed exception, or a separate project (final check nit). The 100-row cap of each Settings list counts test rows too, and call types are never deleted, so test call types also use up the real call-type list (review SEC-3). A separate Production project built from the same migrations inherits these CHECKs, so it cannot hold real pickup places, brands or suppliers until that migration runs. The "at least one active continuation reason" rule also counts test rows (pre-apply review F-5): before test reasons are removed, at least one real reason must be active, or after the cleanup no active reason remains.

By option:
- Separate project: Vercel Production variables point to the production project; Preview variables still point to the development project.
- Cleanup: the destructive migration was approved and run, and the guards were restored and verified.
