# Deployment and Environments
- Cloud-first development; GitHub repository PRIVATE; feature branch -> controlled Vercel Preview -> approval -> merge to main.
- Distinct Supabase development and production projects; **no Preview links to Production database**. **Known deviation (D31):** during the testing period, Vercel's Production environment will point to the development Supabase project (fictitious data only); revisit at the go-live gate. Production credentials, services and live data off-limits pending approval.
- Environment values only in provider-managed secrets with least privileges. Never paste actual values into Claude conversation, repository, PR, screenshot, test fixture or logs.
- During the testing period only the owner can open Preview and Production deployments (D29, D31): no shareable links, bypass tokens, access exceptions or extra members. Do not expose /dev or support diagnostics publicly. Don't assume Preview URLs are access-controlled automatically; verify.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intentionally public; `SUPABASE_SECRET_KEY`, provider mail/transcription keys private server-side only.
- Run build/lint/typecheck/automated tests/secrets detection/dependency security checks before PR. Security tests must include cross-technician access negative cases and browser bundle secret scan.
- Define DB + Storage backup & restoration plan and prove restoration before pilot. Do not claim backups exist unless configured and checked.
- No real customer records or emails on development/Preview.

## Hosting (D30, D31)
- Free plans only (D30): GitHub Free, Vercel Hobby (team `mody-projects`, project `technician-management`), and the existing Supabase project `Technician-Management` (about $10/month, owner-approved, d36). Nothing that adds a charge (for example a second Supabase project, branching or compute upgrades) without owner approval; review hosting plans if the app is ever used commercially.
- Commits are authored with the owner's GitHub account (Vercel Hobby deploys only commits by the team owner) and end with `Co-Authored-By: Claude <noreply@anthropic.com>`. If Vercel blocks a deployment: stop and report.
- Feature branches create protected Preview deployments (work in progress). Production is the owner's fixed, protected viewing address for approved versions; it changes only by merging to `main` after the owner approves that specific merge. `vercel.json` builds only Preview deployments and Production from `main`; anything else is skipped (fails closed). Vercel makes a new project's first deployment Production even from a branch, so the first Production deployment needs an owner decision. **First deployment (owner, 2026-11-02):** two pushes to the feature branch with a read-only check after each (the first is expected to be skipped as a branch build targeted at Production); stop and report if the deployment does not behave as expected. No Production deployment and no merge to `main` without a separate owner approval.
- `vercel.json` installs with `npm ci` from the committed lockfile. Node 24.x (`package.json` engines).
- After every Production deployment: confirm Vercel Authentication (All Deployments), single member, no shareable links / bypass secrets / exceptions, and that an anonymous request is blocked (401 or redirect to the Vercel login, never 200). Report the result to the owner.

## Go-live gate (before any real use, D23, D31)
1. Remove `/dev` and all fictitious fixtures from Production: set `testingPeriod` to `false` in `config/release.json` (the `/dev` gate then returns 404 on Vercel Production) and exclude or delete the `/dev` routes so they are not in the Production build.
2. Re-enable the fixture check: with `testingPeriod: false`, `npm run build && npm run scan:bundle` must pass in CI, which requires the `/dev` routes and fixtures to be removed from the build (the check fails if the fixture sentinel is anywhere in the output). `tests/e2e/gate-logic.spec.ts` already covers Production with `testingPeriod` false (gate closed).
3. Decide on a separate production Supabase project and point Vercel's Production environment to it (closes the D31 known deviation); no real data in development.
4. Decide the Production protection scope for real users (Vercel Authentication on Production would block technicians and Microsoft Graph webhooks).
5. Simulator off in Production (D24), MFA for Creator/Manager, security review, backup/restore rehearsal and real-device tests (D28) as listed in `docs/security.md` and `docs/testing.md`.
