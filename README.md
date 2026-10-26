# Technician Management — secure English starter pack v3

**Status: planning package.** No app has been deployed and no schema migrated by this package.

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
Upload **unzipped contents** to a private GitHub repo; ensure `CLAUDE.md` at root. Claude Code is connected to GitHub, Vercel and Supabase. Send `prompts/STEP-0-PLAN.md` to Claude Code. Approve only Step 0 planning first. Do not provide secrets in chat or connect real data.
