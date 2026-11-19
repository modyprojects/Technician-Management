# STATUS — Technician Management
Updated 2026-11-19 (morning). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- `main` = 1cdf5a7. Supabase: Migrations 1–6 applied (M6 = remote 20261118082250). M7 not applied.
- Repository is **public** since 19.11 (D84): Actions minutes free, CI unblocked. Never commit secrets or real data; any doubt = stop.
- New working rules (19.11): approval levels A/B/C (D80), skeleton first for new screens (D81), `docs/design-rules.md` self-check (D82), technician calendar = today + 7 days (D83).

## Open PRs (all unmerged)
- Docs: #41 (D68–D78) + branch `claude/compassionate-cray-7uwzfy` stacked on it (D79–D83, design-rules.md, this STATUS). Merge after CI green (level C).
- #42 tech-today (85e09be): owner "מאשר" 19.11; open questions closed as built (D79). Merge after CI green.
- #36 user management (6abe2bc): level-B fixes a–d done 19.11, affected shots retaken; awaits "מאשר" by SHA.
- #43 office-unparsed (087e689) → #44 office-calls-list (0872251) → #46 office call card skeleton (e4cc27c), stacked on #36. Unparsed/calls-list shots being retaken.
- #45 technician calendar skeleton (f19954a), stacked on #42; awaits owner answers (5 questions).
- #38 M7 (c80828f): file SHA 489901e5… approved; apply package + runbook ready (PR comment). Needs CI green + separate APPLY approval; bucket `visit-media` = its own write approval.

## Waiting for the owner
- "מאשר" on #36 6abe2bc; skeleton answers #45, #46; M7 APPLY approval (after CI); V1 date.
- `/dev/demo` prototype still shows "ממתין להחלטת בעלים (dNN)" hints: change or leave (it is not a real-app screen)?

## Next, in order
1. CI green → merge #41 + docs branch, #42, then #36 after "מאשר"; rebase stacked branches after each merge.
2. M7: CI on #38 → APPLY approval → apply → `visit-media` bucket → merge #38.
3. Screens after skeleton approval: office call card, technician calendar; then office technician calendar, manager dashboard; tech-visit-flow after M7 (D71).
4. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
5. Follow-up: next 16.4.3 → 16.4.6 (`next build` fails once with a security notice, the retry passes).

## Must fix before real users (hardening gate)
- Post-M7 migration: deleted-but-not-banned account handling (Creator notice + no reset link); "נקרא" for account notices (D78). #36 re-review lows L1/L2.
- MFA for Creator and Manager before production.

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may hit "Data limit exceeded" — retag cached images (`kong`, `mailpit`, `vector` → `supabase/…`) and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
- Backups: `claude/office-unparsed-backup`, `claude/office-calls-list-backup`, plus the earlier ones. New sessions start fresh; everything above is pushed.
