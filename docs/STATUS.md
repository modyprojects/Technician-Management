# STATUS — Technician Management
Updated 2026-11-19 (~12:15). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- `main` = a1ef568. Supabase: M1–M7 applied (M7 = remote 20261119095402, payload SHA 489901e5… verified); bucket `visit-media` awaits approval.
- Public repo (D84): never commit secrets or real data. Rules: levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- #41 decisions D68–D78; #42 technician home, visit card, "הושלמו היום"; #47 decisions D79–D84, design rules.

## Modules (D88: one open module per lane, end to end)
- Technician: **1. calendar #45 (open: skeleton review)** → 2. visit flow (M7 applied) → 3. profile.
- Office: **1. calls: #43 → #44 → #46 (open)** → 2. office technician calendar → 3. manager dashboard on real data.

## Open PRs
- #36 user management: owner "מאשר" on 6abe2bc; main merged in (1a50eea, app files identical to 6abe2bc). Merge after CI.
- #38 M7: applied + post-checks passed 19.11 → `visit-media` bucket (approval of SHA a3f7b93c…) → merge.
- #45 technician calendar skeleton: owner review of cd107a7 (D89) being applied → 15:30 review.
- #46 office call card skeleton with owner answers (ae6671b) → 15:30 review. Stacked: #43 → #44 → #46 on #36.

## Waiting for the owner
- 15:30 review: #45, #46 (and #43, #44 visual approval).
- D87: the three Supabase variables in Vercel Production; then Claude redeploys and checks read-only.
- Bucket `visit-media` approval (SHA a3f7b93c…); V1 date; `/dev/demo` "ממתין..." hints: change or leave?
- IT: the M365 app registration (D86, plan in `docs/m365-mail-plan.md`).

## Next, in order
1. Merge #36 → rebase #43/#44/#46 on main; bucket → merge #38. After skeleton approval: #45, #46 on real data (D88).
2. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
3. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key; Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts (Creator notice, no reset link), "נקרא" (D78); #36 re-review L1/L2.
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it.

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
- Backups: `claude/office-unparsed-backup`, `claude/office-calls-list-backup`, `claude/tech-calendar-backup`.
