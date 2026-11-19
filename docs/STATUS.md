# STATUS — Technician Management
Updated 2026-11-19 (~12:00). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- `main` = a1ef568. Supabase: M1–M6 applied; **M7 apply approved 19.11 (in progress)**.
- Repository public since 19.11 (D84); CI works. Never commit secrets or real data; any doubt = stop.
- Rules: approval levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- #41 decisions D68–D78; #42 technician home, visit card, "הושלמו היום"; #47 decisions D79–D84, design rules.

## Open PRs
- #36 user management: owner "מאשר" on 6abe2bc; main merged in (1a50eea, app files identical to 6abe2bc). Merge after CI.
- #38 M7: apply in progress → post-checks → `visit-media` bucket (separate approval) → merge.
- #45 technician calendar skeleton rebuilt as a real calendar (cd107a7, D85) → 15:30 review.
- #46 office call card skeleton with owner answers (ae6671b) → 15:30 review. Stacked: #43 → #44 → #46 on #36.

## Waiting for the owner
- 15:30 review: #45, #46 (and #43, #44 visual approval).
- D87: the three Supabase variables in Vercel Production; then Claude redeploys and checks read-only.
- M7 bucket approval (after the post-checks); V1 date; `/dev/demo` "ממתין..." hints: change or leave?
- IT: the M365 app registration (D86, plan in `docs/m365-mail-plan.md`).

## Next, in order
1. Merge #36 → rebase #43/#44/#46 on main. M7 post-checks → bucket → merge #38.
2. After skeleton approval: build #45 and #46 fully; then office technician calendar, manager dashboard; tech-visit-flow (D71).
3. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
4. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key; Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts (Creator notice, no reset link), "נקרא" (D78); #36 re-review L1/L2.
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it.

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
- Backups: `claude/office-unparsed-backup`, `claude/office-calls-list-backup`, `claude/tech-calendar-backup`.
