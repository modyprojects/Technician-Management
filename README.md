# Technician Management — secure English starter pack v3

**Status: Step 0 deployed (2026-11-02); Step 1 (database and permissions) in progress per the owner-approved plan (2026-11-03).** The Step 0 foundation (Next.js base, demo design tokens, responsive shells and a `/dev` showcase with fictitious data) is merged to `main` and deployed to the protected Vercel Production, which only the owner can open (D29, D31). No schema migrated yet; no Supabase connection, app login or real data.

**Current state of the repository and features: [`docs/PROJECT-MAP.md`](docs/PROJECT-MAP.md).** History: `docs/WORKLOG.md`.

Production domains (both behind Vercel Authentication; see `docs/deployment.md`):
- `https://technician-management-mody-projects.vercel.app` (the owner's fixed Production address)
- `https://technician-management.vercel.app`

The goal is to implement the original interactive Hebrew prototype `docs/demo.html`, as amended by `docs/demo-deviations.md`, as a secure, responsive PWA. App UI and user guides remain Hebrew/RTL; all developer-facing files and prompts are English. All consultations and answers to the owner are in **Hebrew**.

## Read / act in order
1. `CLAUDE.md` — binding workflow and security rules.
2. `START-HERE.md` — beginner guide.
3. `docs/decisions.md` — approved decisions and open items.
4. `docs/demo-deviations.md` — where production differs from the demo.
5. `docs/ROADMAP.md` — step-by-step goals and acceptance tests.
6. `docs/THINKING-AHEAD.md` — risks / unresolved design questions.
7. `docs/security.md` — risk controls and forbidden credential exposure.
8. `prompts/STEP-0-PLAN.md` — first planning-only Claude Code prompt.

Scope: email/password; partial offline; audited corrections; manager + customer-service completion emails; in-app notifications (no scheduled jobs); Excel without media; Hebrew voice transcription (vendor open); calendar intake through an Outlook invitation simulator until Microsoft 365 is available, then Microsoft Graph change notifications; real use only after Microsoft 365; **no ONE integration or preparation**.

`docs/history/` holds superseded context (not authoritative).

## Start
Upload **unzipped contents** to a private GitHub repo; ensure `CLAUDE.md` at root. Claude Code is connected to GitHub, Vercel and Supabase. Send `prompts/STEP-0-PLAN.md` to Claude Code. Approve only Step 0 planning first. Do not provide secrets in chat or connect real data. (Done for Step 0: plan approved on 2026-11-01; screens approved, merged to `main` and deployed to the protected Production on 2026-11-02; each following step starts with a Hebrew plan and the owner's approval, see `docs/ROADMAP.md`.)
