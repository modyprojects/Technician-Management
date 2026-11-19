# STATUS — Technician Management
Updated 2026-11-19 (~10:45). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- `main` = 2abb7d5 (#41, #42 merged 19.11). Supabase: Migrations 1–6 applied (M6 = remote 20261118082250). M7 not applied.
- Repository is **public** since 19.11 (D84): Actions minutes free, CI unblocked. Never commit secrets or real data; any doubt = stop.
- New working rules (19.11): approval levels A/B/C (D80), skeleton first for new screens (D81), `docs/design-rules.md` self-check (D82), technician calendar = today + 7 days (D83).

## Done on main (19.11)
- #41 decisions D68–D78; #42 technician home, visit card, "הושלמו היום".

## Open PRs (all unmerged)
- #47 docs (D79–D84, design-rules.md, this STATUS), rebased on main. Merge after CI green (level C).
- #36 user management (6abe2bc): level-B fixes a–d done 19.11, affected shots retaken; awaits "מאשר" by SHA.
- #43 office-unparsed (087e689) → #44 office-calls-list (0872251) → #46 office call card skeleton (e4cc27c), stacked on #36. Unparsed/calls-list shots being retaken.
- #45 technician calendar skeleton (f19954a), was stacked on #42 (merged; retarget to main); awaits owner answers (5 questions).
- #38 M7 (c80828f): CI + pgTAP green 19.11; file SHA 489901e5… approved; apply package + runbook ready (PR comment). Needs the separate APPLY approval; bucket `visit-media` = its own write approval.

## Waiting for the owner
- "מאשר" on #36 6abe2bc; skeleton answers #45, #46; M7 APPLY approval (after CI); V1 date.
- `/dev/demo` prototype still shows "ממתין להחלטת בעלים (dNN)" hints: change or leave (it is not a real-app screen)?

## Next, in order
1. Merge #47 after CI; #36 after "מאשר" (CI green on 6abe2bc); rebase #36/#43/#44/#46 and #45 on main.
2. M7: APPLY approval → apply → `visit-media` bucket → merge #38.
3. Screens after skeleton approval: office call card, technician calendar; then office technician calendar, manager dashboard; tech-visit-flow after M7 (D71).
4. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
5. Follow-up: next 16.4.3 → 16.4.6 (`next build` fails once with a security notice, the retry passes).

## Must fix before real users (hardening gate)
- Post-M7 migration: deleted-but-not-banned account handling (Creator notice + no reset link); "נקרא" for account notices (D78). #36 re-review lows L1/L2.
- MFA for Creator and Manager before production.

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may hit "Data limit exceeded" — retag cached images (`kong`, `mailpit`, `vector` → `supabase/…`) and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
- Backups: `claude/office-unparsed-backup`, `claude/office-calls-list-backup`, plus the earlier ones. New sessions start fresh; everything above is pushed.
