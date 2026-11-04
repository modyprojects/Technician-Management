# Step-by-Step Build Plan

Technical writing and prompts in English. **Consultation, questions, explanations and approval requests in Hebrew.** Every step: IMPLEMENT → TEST → PREVIEW → PR → MERGE → LOG, with a Hebrew explanation of what was built.

**Autonomous development (D53, owner, 2026-11-03; supersedes D52's approvals to start and to merge a PR).** Within the approved scope Claude Code creates branches, commits and PRs, builds features and UI, runs tests, fixes issues and reviews code (parallel agents allowed), and continues to the next task without routine approvals or a separate planning approval. It squash-merges a PR only when every mandatory check has passed on the exact approved merge candidate (the exact reviewed head); never with failing, pending, skipped, missing or inconclusive checks, and never by pushing or force-pushing to `main`. The owner's approval is still required for:
- merging any change that weakens protections in `CLAUDE.md`, `docs/security.md`, `.github/workflows/**`, `vercel.json`, `proxy.ts`, `app/dev/_gate.ts` or `config/release.json`;
- every remote Supabase operation, read-only included, approved per operation (only project `ooxozvvrljjkyfduuiks`); D52's migration rule still applies: every migration, or a precisely scoped migration batch, is approved before it is applied;
- open owner-level decisions; meanwhile clearly labelled, reversible, deny-by-default temporary behaviour, and independent work continues.

Changes to authentication, authorization, proxy/gate, environment handling or deployment configuration get an independent review by an agent that did not write the code, recorded in the PR (D53).

**The owner sees the screens throughout.** Every step that touches UI ends with a Preview link (owner-only, D29), screenshots at 390/820/1440 px and a Hebrew list of what to check. Every screen works for every role at all three widths (D27). During development the owner reviews in a desktop browser (D28). Versions reach the protected Production address only by a merge to `main` through the protected Vercel workflow (D31, D53). Claude Code verifies deployment protection (read-only) before each merge and after each Production deployment and reports any check it cannot perform; the owner's anonymous-access and dashboard checks are periodic; a failed or inconclusive check stops further merges until the owner confirms (D31, D53). Screens are built and shown with fake data first; visual review is not a gate, and the owner's feedback becomes new tasks (D53). Large screens are shown in parts.

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

## Current priority (owner, 2026-11-03)
- **Interactive UI demo with fictional data** under `/dev/demo` (behind the `/dev` gate and Vercel Authentication), before PRs 1.3–1.7 (D53 (9)). Screens:
  - calls list, search and filters;
  - call detail;
  - customer, product and problem;
  - technician and visits;
  - technician visit detail;
  - history;
  - photos, audio and summary;
  - signature;
  - office, manager and customer-service dashboards.
- **Architecture rule (owner).** Screens read data only through the typed data-access layer (`features/*/data` ports). A fixture adapter implements it now; a Supabase adapter implements the same ports later. See `docs/architecture-data-access.md`.
- Every record in the demo is fictional test data, labelled "נתוני בדיקה" (D47); every action is simulated ("פעולה מדומה · לא נשמר"); nothing is saved or sent.

## Step 1: PR sequence (plan version 6, approved 2026-11-03)
Step 1 runs as separate PRs. Since D53 (2026-11-03) a PR starts and is squash-merged without an individual owner approval, under the D53 merge rule; every migration still needs the owner's approval before it is applied (D52 rule 4):

| PR | Content | Approvals |
|---|---|---|
| 1.1 Documentation | Decisions D33–D51 across the docs (D52 approval workflow added 2026-11-03 as an owner-approved scope extension), `CLAUDE.md`, `docs/PROJECT-MAP.md`, PR template, WORKLOG | Done: PR #3, merge approved by the owner (D52), merged and deployed 2026-11-03 |
| 1.2 Database test infrastructure | Pinned Supabase CLI, `Database tests` CI workflow, smoke test, check that migrations contain no test rows, test-data census coverage; database tests under `tests/db` (the CLI accepts this path; no deviation) | Done: PR #4, merge approved by the owner (D52), merged and deployed 2026-11-03 |
| 1.3 Migration 1: access and permissions | Hardening (mandatory security requirement below), profiles, technicians, permission matrix (D33), account requests (D34), audit, test-data rules and census; the first-Creator function is created but not run (D49) | D53 → review → **owner's Auth settings change (D50)** → apply (D52 migration approval) → merge (D53) |
| 1.4 Migration 2: reference data, customers and products | Brands, suppliers, products, customers, call types and continuation reasons (D48), pickup places | D53 → review → apply (D52 migration approval) → merge (D53) |
| 1.5 Migration 3: service calls and visits | Service calls and call status (D38), visits, reports, signatures, time reports (D45), change history, previous-visit (D36) and representative-contact (D40) functions | D53 → review → apply (D52 migration approval) → merge (D53) |
| 1.6 Migration 4: integrity and offline | Offline operations, review items (D44), corrections, field versions | D53 → review → apply (D52 migration approval) → merge (D53) |
| 1.7 Report and close | Hebrew who-can-see-what and test report, ERD, census, PROJECT-MAP, WORKLOG | D53 merge; end of Step 1 |

- **Approvals (D53; D52's start and merge approvals superseded on 2026-11-03).**
  - **Autonomous within the approved scope:** Claude Code starts, implements, tests, reviews and squash-merges each PR under the D53 merge rule (every mandatory check passed on the exact approved merge candidate).
  - **Migrations (D52 rule 4, still in force):** every migration, or an explicitly approved and precisely scoped migration batch, needs separate approval before it is applied to Supabase. A batch approval covers only the exact reviewed migrations; a material change needs renewed approval. A migration is applied immediately before its merge.
  - **Remote Supabase operations (D53):** every one, read-only included, needs the owner's approval of that specific operation; only project `ooxozvvrljjkyfduuiks`. Preparing migrations and isolated local database tests that never contact the real project need no approval.
  - **Owner approval before merging (D53):** any change that weakens protections in `CLAUDE.md`, `docs/security.md`, `.github/workflows/**`, `vercel.json`, `proxy.ts`, `app/dev/_gate.ts` or `config/release.json`.
- **Before PR 1.3** the owner changes the Supabase Auth settings himself (D50): "Allow new users to sign up" off, "Allow anonymous sign-ins" off, Email provider on, Data API exposed schemas limited to `public` (and the default `graphql_public`). Claude never changes Supabase, Vercel or GitHub settings.
- **PR 1.3 mandatory security requirement (owner, 2026-11-03).**
  - Harden privileges on tables, sequences and functions in all application schemas (`public` and `private`).
  - Revoke unintended `PUBLIC`, `anon` and `authenticated` grants, including default privileges.
  - Grant explicitly and minimally; RLS is default-deny.
  - Negative tests for tables, sequences and functions.
  - Preserve the permissions that Supabase-managed components need.
  - No apply without the owner's approval (D52 rule 4, D53).
  - Known finding: Supabase's default privileges grant `anon` SELECT, UPDATE and USAGE on new sequences (observed locally in PR 1.2 with a probe sequence in `public`). Smoke test 7 (`tests/db/000_smoke.test.sql`) guards it; Migration 1 must revoke these default privileges.
- Deployment protection: Claude Code verifies it (read-only) before each merge and after each Production deployment; a failed or inconclusive check stops further merges until the owner confirms (D31, D53).

## Stop immediately if
Claude asks for API keys in chat, touches production data or migrations, creates public endpoints, exposes data in Preview, changes the demo style without authorization, enables the simulator in production, or claims an email was sent during mock testing.
