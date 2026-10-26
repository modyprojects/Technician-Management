# Step-by-Step Build Plan

Technical writing and prompts in English. **Consultation, questions, explanations and approval requests in Hebrew.** Every step: PLAN (Hebrew) → APPROVE → IMPLEMENT → TEST → PREVIEW → OWNER REVIEW → PR → LOG. No step starts automatically.

**The owner sees the screens throughout.** Every step that touches UI ends with a Preview link, screenshots at 390/820/1440 px and a Hebrew list of what to check. Screens are shown with fake data and approved **before** real logic is connected. Large screens are shown in parts.

Real use starts only after Microsoft 365 is connected (D23). Steps 0–10 run with fictitious data.

| Step | What Claude builds | Why it matters | Owner's check |
|---|---|---|---|
| 0 — Foundation | Next.js skeleton, design tokens from the demo, RTL, protected `/dev/showcase`, protected Preview, CI | Safe base that looks like the demo | Preview matches the demo on phone and desktop; no secrets or services changed |
| 1 — Database and RLS | Approved ERD and dev migrations with fictitious data: customers (required customer number), products built from invitations (normalized unique SKU), calls, visits, test-data marker, grants, RLS, tests | Correct relationships and isolation | Tech A cannot see Tech B; duplicate SKU impossible |
| 2 — Authentication | Email/password, admin invitations, role checks, MFA design | Only approved users log in | Four fake roles; no open registration; Manager cannot create Creator |
| 3 — Technician views | Home, visit card (incl. customer number, tech notes, paid-visit marker), calendar, pickup list | Field workflow | Phone preview vs. demo; Hebrew technician guide |
| 4 — Visit workflow and offline | Waze, arrival, media, text/voice summary, parts, signature, follow-up notes, safe close; then offline queue and manual sync | Core product | Disconnected phone test; no data loss or duplicates |
| 5 — Office | Read-only calendar, calls, customers, unparsed invitations, back from field, visit timeline, corrections | Office acts on field data | Manager/CS role tests and guides |
| 6 — Calendar ingestion + simulator | Single ingestion service; Outlook invitation simulator (D24) for create/update/reschedule/re-assign/cancel/duplicate/invalid; product auto-creation; unparsed-invitations list. Graph adapter boundary only | Full workflow testable before Microsoft 365 | Replay does not duplicate; simulator hidden in production; visits show their source; test data labeled in KPIs |
| 7 — Email and in-app notifications | Outbox, mock delivery, event-driven in-app notifications (no scheduled jobs) | Reliable office notification | Simulated email to both recipients once per closure; no email for test data |
| 8 — Excel | Role-authorized filtered XLSX | Reporting | Hebrew opens correctly; no media or links |
| 9 — Dashboards | KPIs, technician performance, products/brands/suppliers ("לא הוזן" when empty) | Manager insight | Numbers match seeded records; "נתוני בדיקה" label visible in test environments; production ignores test-marked records |
| 10 — Settings and hardening | Users, technicians, places, reasons, products, correction audit, security tests | Operational control | Permission matrix and audit tests pass |
| 11 — Microsoft 365 and pilot | After Microsoft 365 is available and IT approves: Graph adapter, simulator off; then pilot with one technician (WhatsApp as backup), then all technicians | Safe first real use | Owner/company sign-off before real data |

## Step 0: owner checklist
1. Repository is private and contains the updated package (task T3).
2. `CLAUDE.md` at root; `docs/demo.html` and `docs/demo-deviations.md` present; no credentials or customer data.
3. Open Claude Code on the repository and send prompt P0-1 from the owner's board.
4. Review Claude's Hebrew plan: files, dependencies with versions, Preview protection, cost, what will not be done.
5. Approve Step 0 only. Claude creates a feature branch, skeleton and protected Preview; no database, integrations or email.
6. Compare with the demo at 390, 820 and 1440 px; request fixes.
7. Build/lint/typecheck pass; WORKLOG updated; PR opened.
8. Move to Step 1 only after approving the ERD, schema and RLS.

## Stop immediately if
Claude asks for API keys in chat, touches production data or migrations, creates public endpoints, exposes data in Preview, changes the demo style without authorization, enables the simulator in production, or claims an email was sent during mock testing.
