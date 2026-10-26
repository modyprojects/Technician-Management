# Work Log (English only)

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
