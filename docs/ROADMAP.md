# Step-by-Step Build Plan

Technical writing and prompts in English. **Consultation, questions, explanations and approval requests in Hebrew.** Every step: PLAN (Hebrew) → APPROVE → IMPLEMENT → TEST → PREVIEW → OWNER REVIEW → PR → LOG. No step starts automatically, and no PR starts without the owner's explicit approval (D52).

**The owner sees the screens throughout.** Every step that touches UI ends with a Preview link (owner-only, D29), screenshots at 390/820/1440 px and a Hebrew list of what to check. Every screen works for every role at all three widths (D27). During development the owner reviews in a desktop browser (D28). Approved versions reach the protected Production address only by an owner-approved merge to `main`; deployment protection is verified before and after every Production deployment, on both Production domains (D31). Screens are shown with fake data and approved **before** real logic is connected. Large screens are shown in parts.

Real use starts only after Microsoft 365 is connected (D23). Steps 0–10 run with fictitious data.

| Step | What Claude builds | Why it matters | Owner's check |
|---|---|---|---|
| 0 — Foundation | Next.js skeleton, design tokens from the demo, RTL, protected `/dev/showcase`, protected Preview, CI | Safe base that looks like the demo | Preview matches the demo at 390 / 820 / 1440 px in a desktop browser (D27, D28); only the owner can open it (D29); no secrets or services changed. **Complete** (merged and deployed 2026-11-02) |
| 1 — Database and RLS | Approved ERD and dev migrations (schema and approved reference values only; migrations never contain fictitious data, D47): customers (required customer number), products built from invitations (normalized unique SKU), calls with their own status (D38), visits, test-data marking (D47), editable permission matrix (D33), account requests (D34), grants, RLS, database tests | Correct relationships and isolation | ERD and Hebrew who-can-see-what report approved; Technician A cannot see Technician B's visits except earlier closed visits of a shared call (D36); escalation and account-approval tests pass; duplicate SKU impossible |
| 2 — Authentication | Email/password, admin invitations, role checks, MFA design | Only approved users log in | Four fake roles; no open registration; Manager cannot create Manager or Creator; Customer Service accounts only after Creator approval (D34) |
| 3 — Technician views | Home, visit card (incl. customer number, tech notes, paid-visit marker), calendar, pickup list | Field workflow | Preview vs. demo at 390 / 820 / 1440 px, including the technician screens on desktop (D27, D28); Hebrew technician guide |
| 4 — Visit workflow and offline | Waze, arrival, media, text/voice summary, parts, signature, follow-up notes, safe close; then offline queue and manual sync | Core product | Disconnected phone test; no data loss or duplicates |
| 5 — Office | Read-only calendar, calls, customers, unparsed invitations, back from field, visit timeline, corrections | Office acts on field data | Manager/CS role tests at 390 / 820 / 1440 px (D27) and guides |
| 6 — Calendar ingestion + simulator | Single ingestion service; Outlook invitation simulator (D24) for create/update/reschedule/re-assign/cancel/duplicate/invalid; product auto-creation; unparsed-invitations list. Graph adapter boundary only | Full workflow testable before Microsoft 365 | Replay does not duplicate; simulator hidden in production; visits show their source; test data labeled in KPIs |
| 7 — Email and in-app notifications | Outbox, mock delivery, event-driven in-app notifications (no scheduled jobs) | Reliable office notification | Simulated email to both recipients once per closure; no email for test data |
| 8 — Excel | Role-authorized filtered XLSX | Reporting | Hebrew opens correctly; no media or links |
| 9 — Dashboards | KPIs, technician performance, products/brands/suppliers ("לא הוזן" when empty) | Manager insight | Numbers match the simulator-created test records; "נתוני בדיקה" label visible in test environments; production ignores test-marked records |
| 10 — Settings and hardening | Users, technicians, places, reasons, products, correction audit, security tests; permission-matrix settings screen (D51) | Operational control | Permission matrix and audit tests pass; the owner reviews the working app and approves the final Manager and Customer Service values (D51); temporary values are visibly marked until then |
| 11 — Microsoft 365 and pilot | After Microsoft 365 is available and IT approves: Graph adapter, simulator off; then real phone and tablet tests (touch, PWA install, camera, offline) (D28) and the go-live gate in `docs/deployment.md` (D31), then pilot with one technician (WhatsApp as backup), then all technicians. Users other than the owner only after Microsoft 365 is connected and a go-live decision (D29) | Safe first real use | Owner/company sign-off before real data; pre-pilot gate (D51): the owner approves the final permission matrix before any real pilot or real operational user |

## Step 0: owner checklist (complete 2026-11-02)
1. Repository is private and contains the updated package (task T3).
2. `CLAUDE.md` at root; `docs/demo.html` and `docs/demo-deviations.md` present; no credentials or customer data.
3. Open Claude Code on the repository and send prompt P0-1 from the owner's board.
4. Review Claude's Hebrew plan: files, dependencies with versions, Preview protection, cost, what will not be done.
5. Approve Step 0 only. Claude creates a feature branch, skeleton and protected Preview; no database, integrations or email.
6. Compare with the demo at 390, 820 and 1440 px in your desktop browser and from screenshots (D28); request fixes.
7. Build/lint/typecheck pass; WORKLOG updated; PR opened.
8. Move to Step 1 only after approving the ERD, schema and RLS.

## Step 1: PR sequence (plan version 6, approved 2026-11-03)
Every new step starts with a Hebrew plan and the owner's explicit approval. Step 1 runs as separate PRs; each PR starts only after the owner explicitly approves it (D52):

| PR | Content | Owner approvals |
|---|---|---|
| 1.1 Documentation | Decisions D33–D51 across the docs (D52 approval workflow added 2026-11-03 as an owner-approved scope extension), `CLAUDE.md`, `docs/PROJECT-MAP.md`, PR template, WORKLOG | Content → merge |
| 1.2 Database test infrastructure | Pinned Supabase CLI, CI `db` job, smoke test, check that migrations contain no test rows, test-data census coverage; database tests under `tests/db` (the CLI accepts this path; no deviation) | CI → merge |
| 1.3 Migration 1: access and permissions | Hardening, profiles, technicians, permission matrix (D33), account requests (D34), audit, test-data rules and census; the first-Creator function is created but not run (D49) | Review → **owner's Auth settings change (D50)** → apply → merge |
| 1.4 Migration 2: reference data, customers and products | Brands, suppliers, products, customers, call types and continuation reasons (D48), pickup places | Review → apply → merge |
| 1.5 Migration 3: service calls and visits | Service calls and call status (D38), visits, reports, signatures, time reports (D45), change history, previous-visit (D36) and representative-contact (D40) functions | Review → apply → merge |
| 1.6 Migration 4: integrity and offline | Offline operations, review items (D44), corrections, field versions | Review → apply → merge |
| 1.7 Report and close | Hebrew who-can-see-what and test report, ERD, census, PROJECT-MAP, WORKLOG | Merge; end of Step 1 |

- **Approvals (D52).** Approval to start a PR, to apply a migration and to merge a PR are separate; none implies another.
  - **Within an approved scope:** after the owner approves a PR's scope, Claude Code may independently implement, commit, push, run checks and fix issues within that scope. A material scope expansion needs additional approval.
  - **Migrations:** every migration, or an explicitly approved and precisely scoped migration batch, needs separate approval before it is applied to Supabase. A batch approval covers only the exact reviewed migrations; a material change needs renewed approval.
  - **Merges:** every merge into `main` needs the owner's explicit approval for that specific PR, documentation-only and tests-only PRs included. No automatic merging into `main`.
  - A migration is applied immediately before its merge.
- **Before PR 1.3** the owner changes the Supabase Auth settings himself (D50): "Allow new users to sign up" off, "Allow anonymous sign-ins" off, Email provider on, Data API exposed schemas limited to `public` (and the default `graphql_public`). Claude never changes Supabase, Vercel or GitHub settings.
- Deployment protection is verified before and after every Production deployment (D31).

## Stop immediately if
Claude asks for API keys in chat, touches production data or migrations, creates public endpoints, exposes data in Preview, changes the demo style without authorization, enables the simulator in production, or claims an email was sent during mock testing.
