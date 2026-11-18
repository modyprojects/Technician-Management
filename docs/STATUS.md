# STATUS (as of 2026-11-18)

## Where we are
- Version 1 target: Tuesday 2026-11-24, online only. Scope: sign-in for 4 roles + user management; the simulator inside "זימונים שלא נקלטו" creating real calls and visits; technician screens (today, calendar, visit, Waze departure, arrival, summary, photos, signature, "טופל"/"המשך טיפול"); office screens (calls list, call card, technician calendar with statuses, unparsed invitations); manager dashboard on real data.
- Version 2: offline, recording/transcription, Excel, usage analytics, MFA, versioned "טופל" text.

## Done
- On main (820ae3c): real sign-in, session guards, role landing, password reset with mocked mail (PRs #33, #35).
- Migrations 1-5 applied to Supabase.
- Efficiency process approved 2026-11-18 (docs/WORKING-EFFICIENTLY.md); stage 0 cleanup done.

## In progress
- Migration 6 (calendar ingestion): remote apply started 2026-11-18, then merge PR #37 (draft, CI green).
- PR #36 user management (draft, CI green on 0c59bbc); unfinished screenshots/test updates saved on branch claude/step2-user-management-wip.
- Migration 7 (technician write path, media): branch claude/step4-migration7, pushed, no PR yet; request #2 re-sent to the owner.
- Technician screens: claude/tech-today (awaiting owner visual approval), claude/tech-visit-flow (work in progress).
- Office screens: claude/office-unparsed with the simulator and claude/office-calls-list (both awaiting owner visual approval).
- Efficiency PR A (this PR: rules, STATUS.md, settings, hooks, skill).

## Next
- Efficiency PRs B, C, D, E1, E2 (see docs/WORKING-EFFICIENTLY.md section 9).
- Remaining Version 1 screens: office call card, office technician calendar, technician calendar, manager dashboard on real data.

## Waiting for the owner
- Migration 7 request #2 (guard entries, canary fixture, apply, visit-media bucket, temporary behaviours OQ-1 to OQ-9).
- Visual approvals: tech-today, calls list, unparsed + simulator, user management final.
- PR C and PR D (protected); PR E2 item list after 24.11.

Update this file at the end of every task; keep it ≤40 lines.
