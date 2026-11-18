# STATUS — Technician Management
Updated 2026-11-18, end of day. Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- `main` = 1cdf5a7. Supabase: Migrations 1–6 applied (M6 = remote 20261118082250). M7 not applied.
- **CI blocked:** every GitHub Actions job fails in ~3 s without a runner (billing). Do not re-trigger Actions; no merges until CI is green. Vercel Previews build independently.

## Done on main
- Sign-in, guards, role landing, password reset with mock mail (#33, #35); Step 6 ingestion + simulator + M6 (#37); CI audit gate (#39); rules reset (#40).

## Open PRs (all unmerged)
- #41 docs: STATUS, decisions D68–D78 (D67 is #36's), TE-08/11/25, CLAUDE.md widths (office 390/1440, technician 390/820). Docs-only; merge when CI is green.
- #42 tech-today (85e09be): technician home, visit card, "הושלמו היום"; D69 (no warranty), centred building/floor/apt, D74 test marker + banner, demo tests ported. Awaits the owner's "מאשר" on 85e09be.
- #36 user management (9fd7595): owner review of 18.11 done (cards, ⋮, search/filters, centred modals, add dialog, phone header D73, 390 overflow test); screenshots 390/1440 sent; re-review of review fixes CONFIRMED. Awaits "מאשר". Not in this pass: notices tabs (D78), 10 colours (D77). Same TestBadge.tsx change as #42 (drops out on rebase after #42 merges).
- #38 M7: review fixes (c80828f), re-review APPROVE recorded; owner approved file SHA 489901e51b4bd6150364e255be440f92509bb623af5523902d4cc2a830a8d974 (file only). Next: CI green → ask the owner for apply approval with that SHA.

## Waiting for the owner
- GitHub budget (unblocks CI); then record the "free plans only" exception as a decision.
- V1 date; "מאשר" on #42 and #36; the parallel-work plan; M7 apply approval (after CI).

## Next, in order
1. Owner sets the budget → decision for the "free plans only" exception → CI green → merge #41, then #42 (after "מאשר").
2. M7 flow: CI on #38 → apply approval → apply → `visit-media` bucket → merge #38 (encode `\uXXXX` in the wrapper, as for M6).
3. PR D early (CI docs-only / @responsive); PR A hook bypasses (branch `claude/efficiency-pr-a`, do not merge).
4. Screens queue: office-unparsed (stacked on #36) → office-calls-list (stacked on unparsed) → tech-visit-flow (after M7; rebase on tech-today; DepartLink save-first-then-Waze, D71) → office call card, office technician calendar, technician calendar, manager dashboard.
5. Customer Service nav must become "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)), each with its screen.
6. Follow-up: next 16.4.3 → 16.4.6 (`next build` shows a security notice; first build attempt stops, retry passes).

## Must fix before real users (hardening gate)
- One post-M7 migration: (a) a deleted-but-not-banned account shows a persistent "השלמת מחיקה" for the Creator, from database state; (b) the password reset never sends a link to a deleted account (also deleted-but-not-banned); (c) the "נקרא" state of account notices (D78). #36 re-review lows L1/L2.
- MFA for Creator and Manager before production.

## Notes
- Backups of rebased branches: `claude/step4-migration7-backup`, `claude/tech-today-backup`, `claude/step2-user-management-backup`.
- Local stack: install the CLI with `scripts/install-supabase-cli.sh`; Docker must be started by hand in the container. New sessions start fresh; everything above is pushed.
