# START HERE — first-time app builder, cloud-only

## 1. What this package is
Documentation, a preserved HTML design prototype and the Step 0 app foundation (Next.js base with fictitious data only, deployed to the protected Production on 2026-11-02). Not an operating app for real use or a guarantee of security. No credentials, environment-variable values, real customer records or Supabase migrations are included.

## 2. What is already available
Claude Code is connected to GitHub, Vercel and Supabase. Use cloud development; do not install VS Code / Node.js locally merely to begin.

## 3. First actions (no coding yet) — items 1–7 done for Step 0; item 8 applies to every following step
1. Create or confirm a **private** GitHub repository (`technician-management`).
2. Upload files and folders from this unpacked starter, **not the zip file**. Keep `CLAUDE.md` in root and `docs/demo.html` unchanged.
3. Ensure no customer data or credentials are present. `.env.example` contains variable names only.
4. Launch Claude Code web, select the repository and send `prompts/STEP-0-PLAN.md`.
5. Receive Claude's **Hebrew explanation** of Step 0 only; examine planned files, Preview access, security, dependencies and costs; approve or ask it to revise the plan.
6. After approval only, allow creation of a feature branch and Next.js skeleton. No Supabase migrations or provider connections in Step 0.
7. Compare resulting Preview with the demo at 390 / 820 / 1440 px in your desktop browser and from screenshots (D28). Have Claude open a PR with automated test results and update `docs/WORKLOG.md` in English.
8. For every following step read `docs/ROADMAP.md`, review plans in Hebrew, approve one stage at a time.

## 4. Your services
- GitHub: private source, revision history and Pull Requests.
- Vercel: development/Preview; verify Preview is access-controlled, visible only to the owner during the testing period (D29), and uses development-only config. Production is the owner's protected viewing address for approved versions (D31); its two domains, `technician-management-mody-projects.vercel.app` (the owner's fixed address) and `technician-management.vercel.app`, both stay behind Vercel Authentication. Free plans only (D30): GitHub Free, Vercel Hobby, and the existing Supabase project `Technician-Management` (about $10/month, owner-approved, d36).
- Supabase: Auth, Postgres and private Storage, after later stage approval; before go-live the owner explicitly approves either separate development and production projects (recommended) or a cleanup of the existing project (D47, go-live gate in `docs/deployment.md`); during the testing period Vercel Production uses the development project (D31).
- Microsoft 365: NOT available yet. Testing uses the Outlook invitation simulator (D24); real use starts only after Microsoft 365 is connected (D23).

## 5. Files explained
- `CLAUDE.md` controls Claude Code conduct, approvals, language, security.
- `docs/decisions.md` logs approved decisions and open questions.
- `docs/demo-deviations.md` lists where production differs from the demo, and why.
- `docs/spec.md` describes product features and workflows.
- `docs/demo.html` is the original Hebrew design and demo behavior; **not secure production code**.
- `docs/database-schema.md` describes the approved Step 1 database design; every migration, or an explicitly approved and precisely scoped migration batch, needs the owner's separate approval before it is applied; a batch approval covers only the exact reviewed migrations in it, and any material change needs renewed approval (D52 rule 4); every remote Supabase operation needs the owner's approval of that operation (D53).
- `docs/security.md` details secrets, RLS, authorization and test requirements.
- `docs/ROADMAP.md` explains every build step.
- `docs/THINKING-AHEAD.md` tracks future decisions and major risks.
- `docs/user-guides/` will contain Hebrew illustrated user documentation after working screens exist.
- `docs/WORKLOG.md` tracks changes. `docs/history/` holds superseded context.

## 6. Never do this
Never paste provider/API secrets into Claude's chat, GitHub, a PR, a screenshot or logs. Never approve production table changes when evaluating a plan. Never claim a feature is live merely because it is present in the mockup. Never accept a Preview wired to real customer records.

## 7. Next
**Step 0 is complete:** merged to `main` and deployed to the protected Production on 2026-11-02 (fictitious data only). Production domains, both behind Vercel Authentication and open only to the owner:
- `https://technician-management-mody-projects.vercel.app` (the owner's fixed Production address)
- `https://technician-management.vercel.app`

**Now:** Step 1 PRs 1.1 (documentation) and 1.2 (database test infrastructure) were merged and deployed on 2026-11-03. Since D53 (2026-11-03) Claude Code develops autonomously within the approved scope and squash-merges a PR only when every mandatory check has passed on the exact approved merge candidate (the exact reviewed head); merging any change that weakens protections in `CLAUDE.md`, `docs/security.md`, `.github/workflows/**`, `vercel.json`, `proxy.ts`, `app/dev/_gate.ts`, `config/release.json`, the canary-rows check's own files (`scripts/db-canary.mjs`, `tests/db-canary/**`, `tests/db-canary-selftest/**`; D54) or the static migration guard (`scripts/check-migrations.mjs`; D55) still needs the owner's approval. The current priority (owner, 2026-11-05, D55 (11)) is Step 2 authentication and user management on the local database, with the remaining Step 1 database work; the interactive UI demo with fictional data (`/dev/demo`, protected behind the `/dev` gate and Vercel Authentication) is complete except screens that wait for open decisions. Every migration, and every remote Supabase operation (read-only included), needs the owner's approval of that operation; live external providers remain gated by later approvals. For the current state of the repository and features, see `docs/PROJECT-MAP.md`.
