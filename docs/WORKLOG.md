# Work Log (English only)

## 2026-11-03/04 — PR #3 and PR #4 merged; D53; UI demo
- **PR #3 (Step 1 / PR 1.1, documentation)** squash-merged as `1c6926e` after the owner's explicit approval ("merge approved — PR #3 only"). CI run 41632343961 green. Production deployment `dpl_5NYYw1JugbbVYt2nEY7q4wTPfkpN` READY, built from `1c6926e`.
- **PR #4 (Step 1 / PR 1.2, database test infrastructure)** squash-merged as `76fed5f` after the owner's explicit approval ("merge approved — PR #4 only"). CI run 41639878074 green; `Database tests` run 41639878057 on `main`: 7/7 pass. Production deployment `dpl_6oeCxzJ91Fa1ErogtZgikcmjvFAM` READY, built from `76fed5f`.
- Read-only protection checks by Claude Code before and after each merge:
  - Vercel Authentication on All Deployments;
  - Password Protection and Trusted IPs off;
  - one team member (the owner);
  - the same three Production addresses, none new;
  - no custom firewall configuration.
- Checks Claude Code cannot perform, reported to the owner:
  - anonymous access: the environment's proxy blocks `*.vercel.app`;
  - shareable links and Protection Bypass for Automation secrets: not readable through the read-only tools used.
- Owner's manual checks after the PR #3 deployment (owner, 2026-11-03):
  - in an incognito window, all three Production URLs showed the Vercel login screen: `technician-management-mody-projects.vercel.app`, `technician-management.vercel.app` and `technician-management-git-main-mody-projects.vercel.app`;
  - dashboard: Vercel Authentication on All Deployments, no active Protection Bypass for Automation, no active Shareable Links, access restricted to the owner's account.
- Decisions:
  - D52 board reference set to d39.
  - **D53 (autonomous development) approved** (owner, 2026-11-03), recorded in `docs/decisions.md` and `CLAUDE.md` (commit `07cbd09`). It supersedes D52's start and merge approvals. Owner approval remains for weakening the listed protections, for every remote Supabase operation (per operation) and for open owner decisions.
  - D31 automation: research for an automated anonymous-access check documented in `docs/research/d31-anonymous-access-check.md`. Not implemented; it waits for owner decisions.
  - Owner architecture rule (2026-11-03): screens read data only through a typed data-access layer; fixture adapter now, Supabase adapter later (`docs/architecture-data-access.md`).
- PR 1.3 planning: the owner's mandatory security requirement (privilege hardening on tables, sequences and functions; negative tests) is recorded in `docs/ROADMAP.md`. Not started; every remote Supabase operation and every migration needs separate approval.
- **Interruption record.** The first UI build workflow was interrupted on 2026-11-03 at 14:50 UTC: two screen agents were interrupted and two never started. The lead did not notice until the owner's status request on 2026-11-04, about 19.5 hours without progress. Remedies:
  - checkpoint commits during long work;
  - verifying the actual state of agents instead of assuming progress;
  - progress reports every 30 minutes (two hourly scheduled tasks, at :07 and :37).
- **UI demo** on branch `claude/ui-demo-1` (fictional data only, `/dev/demo`):
  - done: foundation, calls list and call detail;
  - done: typed data-access layer (Phase A). Its independent review found no must-fix items; the five should-fix findings were addressed in checkpoint `39876b2`;
  - done: the remaining screens (Phase B, checkpoint `8e6f52d`): office homes, manager dashboards, technician home, visit card, work and close screens.
  - The demo has no Supabase connection, real data or real email; every action is simulated.
- **UI demo integration** (`claude/ui-demo-1`, 2026-11-04):
  - Fixes: the "ממתינה לשיבוץ" call is listed first on the manager home (it was capped out of the table); technician names on the manager home link to the dashboard drill-down when the matrix offers it; `TechLanes` takes an id prefix; `closeVisitError` requires "מה צריך בביקור הבא" for "המשך טיפול" (TE-21); simulated commands return `{ok: false, simulated: true, error}` on missing or malformed input instead of throwing; the technician home's bell and "הושלמו ›" say the screen is not in the demo; `README.md` "Start" follows D53.
  - Tests: every demo route added to the `/dev` gate tests (document, RSC, prefetch and segment variants, plus query-string views); new `tests/e2e/demo.spec.ts` (each route at 390 / 820 / 1440 without page overflow or console errors, sentinel and "נתוני בדיקה" strip, search and filters in the URL, call card, customer service denied dashboards and cancel, simulated depart / arrive / note / cancel / photo / recording / close, signature drawn with pointer events, follow-up note required). The overflow helper now skips visually hidden (`.sr-only`) text.
  - Results: `eslint` 0 problems; `typecheck` passed; `build` passed (483 pages); `test:ci` 8/8; `scan:bundle` passed (2903 files); local Gitleaks: no leaks; Playwright 550 passed, 0 failed, 674 skipped (tests that run in one screen-size project only, by design).
  - Screenshots: 63 images in `docs/review/ui-demo-1/` (11 app screens and 10 matching `docs/demo.html` screens at 390 / 820 / 1440), from a local production build; on demand only (`SCREENSHOTS=1`).
- **UI demo review fixes** (three independent reviews; architecture-security, visual fidelity, UX/accessibility): "נאסף" now runs `useCommands().visits.setPickupCollected` (simulated, optimistic with undo); the toast never takes taps and sits above the technician footer; the calls table fits 820 px like the demo (🧪 next to the request number, follow-up reason and "בוטל" under the pill); the call card follows the demo's header line, row order, two columns at 820 px and back button; "שינוי מועד" / "הוספת הערה" removed (not in demo, spec or deviations) and "ביטול ביקור" is a disabled placeholder pending d08 (OF-09); fixture visits default to "🧪 זימון בדיקה"; earlier visits show their photos (TE-06); office nav has "יומן טכנאים" (not in the demo) and "דשבורד"; the office home follows `dashGen`; technician statuses (depart, arrive, close) survive navigation (`tech/layout.tsx`); a sent close leads home; accessibility fixes (test-badge text, dark focus ring, headings, scrollable regions, signature pad focus and resize, focus after removals); fixture modules `server-only`; recording limit 180 s in the shared validator. Checks: eslint 0, typecheck, build (483 pages), test:ci 8/8, scan:bundle (2903 files), Playwright 587 passed, 0 failed, 700 skipped; 90 screenshots in `docs/review/ui-demo-1/`. Deferred: owner decisions (CLAUDE.md D53 merge approval, `decisions.md` D53 row formatting, cancel flow d08), V-13, V-17, N-02, N-09, N-13, F-09 (adapter TODO).

## 2026-11-03 — PR 1.2 (database test infrastructure)
- Branch `claude/step1-db-tests`; no migration, no change to the remote Supabase project.
- Synchronized with `main` after PR #3 was squash-merged (`1c6926e`, 2026-11-03), without force-push or history rewrite:
  - Merged the PR 1.1 branch head `6f71be5` first (it contains the revert `ed01d82` of the withdrawn docs-only Production-build skip), then `main`.
  - The skip is gone: no `scripts/vercel-ignore.sh`, no `tests/ci/vercel-ignore.test.mjs`, and `vercel.json` is identical to `main`.
  - `test:ci` and its CI step now run only the migration-guard tests.
  - Retargeted to `main`.
- The inaccurate `supabase/seed.sql` reference in `docs/database-schema.md` and `docs/PROJECT-MAP.md` is corrected: seeding is disabled in `supabase/config.toml` and there is no seed file.
- Independent review of the synchronized PR found that the smoke tests did not check sequence privileges, although the docs said they did. A seventh test now checks that `anon` and `PUBLIC` have no sequence privileges in `public` or `private` (`aclexplode`, because `information_schema.role_table_grants` does not list sequences).
  - Local run: 7/7 pass.
  - Negative control: a probe sequence created in `public` received Supabase's default `anon` grants (SELECT, UPDATE, USAGE) and made that test fail. After it was dropped, 7/7 pass.
  - Documentation wording aligned: PROJECT-MAP (`tests/db` row, header) and `testing.md` (workflow name). The location sentence in `database-schema.md` is also aligned: `tests/db`, no deviation.
- Supabase CLI 2.122.0 (released 2026-10-23, past the 7-day cooldown; 3.0.0 was one day old) is pinned with the SHA-256 from the release's `checksums.txt` (`scripts/install-supabase-cli.sh`).
- `supabase/config.toml` comes from `supabase init` of the pinned version, with three changes: `project_id`, seed disabled, and sign-ups off (invitation-only, D50). It is used only for local tests.
- New `Database tests` workflow (`.github/workflows/db.yml`): runs only when database files change.
- Smoke tests: `tests/db/000_smoke.test.sql`.
- Migration guard: `scripts/check-migrations.mjs`, with 8 tests; also runs in the main CI.
- `tests/db` works with the CLI, so there is no deviation from `CLAUDE.md`.
- Local run (Docker in the Claude Code environment): `supabase db start` and `supabase test db tests/db` passed 6/6. A probe table without RLS made three tests fail, as expected; after it was dropped, everything passed again. The local database is temporary and holds no data.

## 2026-11-03 — Step 1 plan approved; PR 1.1 (documentation)
- PR #2 (documentation) merged by Claude Code with the owner's explicit approval ("merge approved — PR #2 only"), using a merge commit: `465ffa2` at 16:24 Israel time (14:24:49 UTC), parents `3f977fc` and `2846bb2`. CI on the `main` push passed every step (run 41461711535).
- Production deployment `dpl_FhPTRffxN2GmDFQgvjwDQXMMY7xA`: target Production, READY, built from `main` at `465ffa2`, functions in `fra1`. The three Production addresses moved to it.
- Read-only protection checks by Claude Code before the merge and after the deployment: Vercel Authentication on All Deployments; Password Protection and Trusted IPs off; no custom firewall configuration; one team member (the owner); the same five known addresses, none new. An independent read-only re-verification confirmed every point.
- Owner anonymous-access check after the PR #2 deployment (private window): all three Production URLs show the Vercel login screen: `technician-management-mody-projects.vercel.app`, `technician-management.vercel.app` and `technician-management-git-main-mody-projects.vercel.app`.
- Step 1 planning (plan only, no changes):
  - Read-only inspection of the Supabase project `Technician-Management` found it empty: no tables, migrations, buckets, policies or users. Its default privileges in `public` grant `anon` and `authenticated` full access to new tables, sequences and functions; the first migration revokes them.
  - The plan went through six versions, each reviewed independently (security, requirements, data integrity).
  - The owner's decisions are recorded as D33–D50 (2026-11-03), plus D51 (board ref d40): permission-matrix values stay temporary until the owner approves the final values in Step 10, while Step 1 builds and tests the full enforcement; pre-pilot gate: the owner approves the final permission matrix.
  - The plan was approved to start with PR 1.1 (documentation) and PR 1.2 (database test infrastructure), stopping before PR 1.3. PR 1.3 waits for the owner's Supabase Auth settings change (D50) and a separate approval to apply.
- PR 1.1 (this PR):
  - D33–D51 and the related amendments across the documentation.
  - `CLAUDE.md`: Step 0 complete; every step needs a plan and the owner's approval; deployment protection verified before and after every Production deployment.
  - New `docs/PROJECT-MAP.md` and `.github/pull_request_template.md`.
  - A proposed docs-only Production-build skip was removed from this PR at the owner's request (2026-11-03): this PR is documentation only, and any deployment-behavior change needs its own PR and approval.
  - D52 (approval workflow, owner 2026-11-03) recorded in `docs/decisions.md`, `CLAUDE.md` and `docs/ROADMAP.md`, as a documentation-only scope extension of this PR that the owner approved:
    - Owner approval before each new PR starts.
    - Independent work within the approved scope.
    - Explicit approval for every merge into `main`, with no automatic merging.
    - Separate approval for each migration or precisely scoped migration batch.
    - D31 protection checks preserved.
    - Approvals never imply one another.
  - D39 is unchanged. The owner prefers Squash and merge for this PR, without rewriting the branch history.

## 2026-11-02 — PR #1 merged; first Production deployment
- PR #1 (Step 0) merged to `main` by the owner: merge commit `3f977fc` at 12:55 Israel time (10:55:50 UTC); parents `e70a33c` (previous `main`) and `6a05b4d` (Step 0 branch head). CI on `6a05b4d` had passed every step before the merge (run 41430037190); CI on the `main` push of `3f977fc` also passed every step (run 41432692571).
- First Production deployment (read-only check, 2026-11-02): `dpl_5h2HN7WLr7NHtuJoqooBCgwdsUXG`, target Production, READY, built from `main` at `3f977fc`, functions in `fra1`; `vercel.json` allowed the build because it is Production from `main`. Served at both Production domains, `technician-management-mody-projects.vercel.app` and `technician-management.vercel.app`, and at Vercel's automatic addresses for `main` (`technician-management-git-main-mody-projects.vercel.app`) and for the deployment itself.
- Protection, read-only checks by Claude Code. Before the merge: Vercel Authentication on All Deployments; Password Protection off; Trusted IPs off; one team member (the owner). After the deployment: the same, plus firewall IP bypass rules are not available on Vercel Hobby and there is no custom firewall configuration. Protection Bypass for Automation and shareable links cannot be read through the available tools; Claude Code created none.
- Owner anonymous-access check (2026-11-02, private window): both Production domains and `/dev/showcase` show the Vercel login screen, not the app.
- Owner manual security check in the Vercel dashboard (2026-11-02): Vercel Authentication on All Deployments; no active Protection Bypass for Automation; no active Shareable Links; access limited to the owner's account. In a private window the `main` branch address `technician-management-git-main-mody-projects.vercel.app` also shows the Vercel login screen.
- Claude Code used read-only tools only and changed no settings in GitHub, Vercel or Supabase.
- `README.md`, `START-HERE.md` and `docs/deployment.md` updated: Step 0 is deployed to the protected Production; both Production domains listed (`docs/deployment.md` also lists Vercel's automatic addresses and requires the anonymous check on both domains).
- D32 (local-only development or disabling Vercel deployments) was proposed by the owner and withdrawn the same day; D31 remains in force and the workflow is unchanged. No local commits, `vercel.json` changes or local-development documents were made for it.

## 2026-11-02 — Step 0 approved; pre-merge changes
- Owner visual approval recorded (2026-11-02): visual review round 1 approved and the Step 0 screens approved as they are (Preview of commit `e488b54`).
- Owner anonymous-access check (2026-11-02): opening the Preview in a private browser window showed the Vercel login screen, not the app. (The Claude Code environment cannot reach `*.vercel.app` because of its network policy.)
- Next.js telemetry disabled for every build: `NEXT_TELEMETRY_DISABLED=1` in the `build` script (Vercel, CI and local builds).
- PR #1 marked ready for review. No merge to `main` and no Production deployment until the owner explicitly approves the merge.

## 2026-11-02 — Step 0 first deployments and visual review round 1
- Push 1 (`0f62168`): Vercel targeted the project's first deployment at Production; `vercel.json` skipped it (CANCELED, nothing built or served). The owner-authored commit was accepted (no Hobby block). Push 2 (`36b772b`): Preview READY, functions in `fra1`, stable branch address `technician-management-git-claude-trusting-872277-mody-projects.vercel.app`. Draft PR #1 opened; CI passed (all steps, about 2 minutes); the superseded run was cancelled by the concurrency setting. Vercel Authentication still on All Deployments, single member, after the deployment.
- Anonymous-access check could not run from the Claude Code environment: its network policy denies `*.vercel.app` (proxy 403); not bypassed. The owner checks it in a private window or allows the hosts in the environment settings.
- Fixed Production address recorded (owner): `technician-management-mody-projects.vercel.app`; Vercel also lists `technician-management.vercel.app` as the project domain.
- Visual review round 1 (owner): next-visit card buttons 50/50 from 600 px, phone unchanged (demo-deviations TE-33); table rule for all tables: short columns centred and content-sized, long-text right-aligned, extra width to customer and product, tablet compact padding and wrapping headers so the calls table fits at 820 px (design-system.md "Tables", demo-deviations G-07). New tests in `tests/e2e/review-round1.spec.ts` (a removed sizing rule fails them).
- CI failed once on this round: at 820 px GitHub's Chromium rendered the table 4 px wider than the local build (790 > 786); the layout fitted to the pixel. Fixed at the cause: at tablet widths city and rep may wrap like customer and product, so the table now overflows only below a 770 px viewport (about 50 px headroom at 820 px).

## 2026-11-02 — Step 0 owner review before the first push
- Owner approved: commit identity option (a) (author and committer = owner's GitHub account `modyprojects`, Claude as co-author in every commit; GitHub shows "Unverified" because the environment signs with its own key; open decision 24 to find verified, transparent signing without the owner's private key); first deployment option (a) (two pushes to the feature branch, read-only check after each, stop and report if not as expected); the two pushes and a Draft PR.
- Owner checked himself: Protection Bypass for Automation is empty; no payment method on GitHub (Actions stop at the free quota instead of billing); Dependabot alerts enabled.
- Design: TE-32 fixed bottom navigation approved; TE-31 extended: above 900 px the header content and bottom-navigation buttons align with the 760 px card column, backgrounds stay full width. Test added; screenshots regenerated.

## 2026-11-01 — Step 0 foundation (feature branch `claude/trusting-brahmagupta-yel1it`)
- Owner approved the Step 0 plan with changes. Recorded D27–D29 (2026-10-26), D30 (personal non-commercial project, free plans only, Supabase project kept at about $10/month, commit identity) and D31 (protected Production as the owner's fixed viewing address; known deviation: Production will use the development Supabase project until go-live). `docs/demo-deviations.md` v1.2: X-03 dev-only size view, TE-31 technician layout above 900 px, TE-32 fixed bottom navigation (PENDING visual review).
- Aligned D27–D31 in `CLAUDE.md`, `START-HERE.md`, `prompts/STEP-0-PLAN.md`, `docs/spec.md`, `docs/THINKING-AHEAD.md`, `docs/ROADMAP.md`, `docs/design-system.md`, `docs/testing.md`, `docs/security.md` (Gitleaks replaces GitHub push protection, owner answer 6A), `docs/deployment.md` (hosting and go-live gate), `docs/architecture.md`.
- Commit identity (D30): commits are authored with the owner's GitHub account `modyprojects` and end with `Co-Authored-By: Claude <noreply@anthropic.com>`; PR descriptions state that Claude Code wrote the code under the owner's direction.
- Built: Next.js 16.4.3 App Router, React 19.3.1, TypeScript 6.0.3 strict, Tailwind 4.3.3 without preflight, ESLint 10.13.0, Playwright 1.63.0; exact versions, lockfile created with npm 11.19.1 and a 7-day release cooldown (`.npmrc`), install scripts blocked. Next 16.4.3 replaces the planned 16.4.2 because it passed the cooldown by install day; ESLint 10.14.0 was still inside it.
- Design tokens (46 demo `:root` properties, verbatim), component and shell styles copied from `docs/demo.html`, components only where the shells and showcase use them, technician and office shells with fictitious demo data under `/dev/showcase`, size view (390 / 820 / 1440), temporary Hebrew home and 404 pages (approved).
- `/dev` gate in `proxy.ts`: open on Vercel Preview, on Vercel Production only during the testing period (`config/release.json`), locally only with `ENABLE_DEV_ROUTES=1` on localhost. Found and fixed during testing: a `notFound()` gate in the `/dev` layout still streamed the page payload in the 404 body; the gate now runs before rendering and a test asserts no showcase content in closed-gate responses.
- `vercel.json`: `npm ci`; cancels Production builds that are not from `main` (Vercel makes a new project's first deployment Production even from a branch).
- CI (`.github/workflows/ci.yml`, read-only token, SHA-pinned actions, Node 24.22.1): Gitleaks 8.30.1 full history with checksum and `--redact`, lint, typecheck, build, browser bundle check, `npm audit --audit-level=high`, Playwright at 390 / 820 / 1440 (48 checks: RTL, overflow, breakpoints and boundaries, demo control sizes, tokens vs demo, fonts, headers, `/dev` gate negatives).
- Known findings: `npm audit` reports 15 moderate entries from one advisory (minimatch GHSA-g3hv-75wg-m249) in dev-only lint tooling, none high or critical, none in runtime dependencies; ESLint 10 prints 3 peer warnings for plugins bundled by eslint-config-next; local checks and screenshots ran on Node 22.22.0 (Vercel and CI use Node 24).
- Vercel (read-only, before any deployment): Vercel Authentication on All Deployments, one team member (owner), no deployments, aliases, domains or environment variables. The AI-training data preference could not be read through the available tools; the owner reported it is off.
- Independent pre-push review (security, demo fidelity, documentation, tests), each serious finding re-verified. Fixed: `vercel.json` guard is now an allow-list that fails closed (Preview, or Production from `main`); local servers bind to 127.0.0.1; gate logic takes the testing-period switch as a parameter and every branch is tested; gate e2e tests add a positive control and RSC, prefetch, segment and `.rsc` variants (a deliberately broken gate fails 33 of them); stricter overflow, width, token and font-face checks; bundle check also scans `.next/server/pages`, `.meta` and `public/`; CI audit runs after the tests, tighter timeouts; `npm run scan:secrets` makes the local Gitleaks run reproducible; G-05 and the Supabase-separation statements aligned with D31; Supabase cost noted in the D30 summaries; open decisions 21 (testing-period Production vs. simulator rules), 22 (TE-32) and 23 (first Vercel deployment).
- Open for the owner: first deployment bootstrap (open decision 23): with the guard, a new project's first deployment (Production even from a branch) is skipped and later branch pushes may be skipped too; no push until the owner decides.
- Pre-push secret scan: `npm run scan:secrets` (full history and every file to be published): no leaks.
- Not done in Step 0: no Supabase connection, keys or environment variables; no deployment until the owner approves the first push.

## 2026-10-26 — Documentation update before Step 0
- Added `docs/demo-deviations.md` (v1.1, approved): where production differs from `docs/demo.html`, with traceability to owner decisions.
- Updated `CLAUDE.md` (v3), `docs/decisions.md` (D17–D26), `docs/spec.md`, `docs/database-schema.md`, `docs/architecture.md`, `docs/integrations.md`, `docs/security.md`, `docs/outlook-template.md`, `docs/ROADMAP.md`, `docs/THINKING-AHEAD.md`, `prompts/STEP-0-PLAN.md`.
- Key changes: document precedence (decisions → demo-deviations → demo); customer number required, warranty optional; products built from invitations; Outlook invitation simulator for testing until Microsoft 365 is available; test-data labeling; no scheduled background jobs; owner sees screens during every UI step.
- Moved `PROJECT-HANDOFF.md` to `docs/history/` (historical context, superseded where it differs from current decisions).
- No application code, migration, live email, Microsoft connection or deployment was performed.

## 2026-10-25 — Documentation baseline v2
- Created updated English cloud-first starter documentation.
- Recorded approved email/password, partial offline, role administration, dual completion recipients, in-app alerts, Excel without media, transcription goal, audited corrections and Hebrew guides.
- Strengthened security blueprint and clarified Supabase publishable versus secret keys.
- No application code, migration, live email, actual Microsoft connection or production deployment was performed.
- Next action: owner reviews Step 0 plan; Claude Code implements only after explicit approval.
