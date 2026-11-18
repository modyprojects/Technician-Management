# STATUS — Technician Management
Updated 2026-11-18 (rules reset; all agents stopped). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24, online only: sign-in + user management, simulator, technician screens, office screens, manager dashboard on real data.
- `main` = 9271e8f. Supabase: Migrations 1–6 applied (M6 = remote version 20261118082250, fingerprint verified). M7 not applied.

## Done on main
- Sign-in, session guards, role landing, password reset with mock mail (#33, #35).
- Step 6: ingestion + simulator server side + Migration 6 (#37); D31 post-deploy checks passed.

## In progress
- PR #39 CI audit gate: picomatch GHSA-fc5q-39xc-vjpf has no fix, so `npm audit` turns every CI red. Owner approved the final head (devOnly enforced); review CONFIRMED; merge only after CI green.
- PR #38 Migration 7 (technician writers, visit media), draft, NOT applied. Review: APPROVE WITH FIXES — medium: the idempotency hash includes device_sent_at and time-zone-dependent text, so a retry raises 23505; low: confirm_visit_media ignores visit status, replay skips the ownership check, no real-row tests, stale text. Fixes NOT started.
- Fixing M7 changes its SHA: the owner's approval of e4a92876… no longer covers it; ask again. Guard diff, canary fixture and bucket SQL are approved and unchanged.
- PR A (branch `claude/efficiency-pr-a`, WIP 4b8d72e, no PR): WORKING-EFFICIENTLY.md, settings + 2 hooks + tests, supabase-postgres-best-practices skill. Hook review FIX: 7 high + 3 medium bypasses, not fixed. Do not merge.
- Technician: `claude/tech-today` awaits visual approval; `claude/tech-visit-flow` (23a6b08) works on the local stack (spec 7/7, 51 WebP shots) — send for approval after M7 is applied. Bug: a tiny photo shows "הקובץ גדול מדי".
- Office: `claude/office-unparsed` (simulator) and `claude/office-calls-list` (74df887) await visual approval.
- PR #36 user management: draft, CI green on 0c59bbc; unfinished screenshot/test work on `claude/step2-user-management-wip`.

## Waiting for the owner
- Rules-reset PR (this lean CLAUDE.md): approval after advisor review.
- M7: approval of the new SHA after the fixes.
- Visual approvals: tech-today, calls list, unparsed + simulator, user management (final).

## Next, in order
1. Merge #39 after CI green; sync open branches with main.
2. M7 fixes (DB lane) → re-review → new-SHA approval → CI → apply → `visit-media` bucket → merge #38. apply_migration decodes literal `\uXXXX` text: encode those escapes in the wrapper (as for M6).
3. Fix the PR A hook bypasses → re-review → PR A; then decisions-current.md (PR B), CI docs-only/@responsive (PR D), test cleanup E1.
4. Remaining V1 screens: office call card, office technician calendar, technician calendar, manager dashboard on real data.
5. Follow-up PR: next 16.4.3 → 16.4.6 (two moderate advisories).

## Notes
- New sessions start in a fresh container: local worktrees and the scratchpad may be gone; everything above is pushed to GitHub.
