# STATUS — Technician Management
Updated 2026-11-19 (~14:15). Keep ≤40 lines; update at the end of every task.

## Where we are
- Version 1 target Tue 2026-11-24 (date to be confirmed by the owner), online only.
- Supabase: M1–M7 applied (M7 = remote 20261119095402, payload SHA 489901e5… verified); bucket `visit-media` created 19.11 (private, 10 MiB, JPEG/PNG/WebP).
- Public repo (D84): never commit secrets or real data. Rules: levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- #41, #47, #48, #50 decisions D68–D90; #42 technician home; #36 user management; #49 TimeRange + status colours; #51 simulator gate (D90); #43 unparsed invitations; #45 technician calendar (real data).

## Modules (D88: one open module per lane, end to end)
- Technician: 1. calendar ✅ (follow-up: "בדרך" in the legend) → **2. visit flow (next)** → 3. profile.
- Office: **1. calls: #43 ✅ → #44 (merge after CI) → #46 real-data build** → 2. office technician calendar → 3. manager dashboard.

## Open PRs
- #38 M7: main merged in (M7 file SHA unchanged); merge after CI.
- #44 calls list: rebased on main, own files identical to the approved 45f1c41; merge after CI.
- #52 simulator gate refuses unrecognised VERCEL_ENV (level C).
- Docs: CLAUDE.md + security.md §9 for D90 (owner-approved), open decision 21 (simulator part), OQ-13 in the go-live gate, `.claude/worktrees/` ignored.

## Waiting for the owner
- D87: the three Supabase variables + `CALENDAR_SIMULATOR=1` in Vercel Production; then Claude redeploys and checks read-only.
- Open decision 21 (rest): test-marked records at the Production address (D87 makes all data test data).
- V1 date; IT: the M365 app registration (D86, `docs/m365-mail-plan.md`); video/audio media (open decisions 3, 4, 11).

## Next, in order
1. Merge #38, #44, #52; #46 call card on real data; technician "בדרך" legend follow-up; then the visit flow (D71).
2. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
3. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key; Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts, "נקרא" (D78), #36 L1/L2, OQ-13 (the DB enforces the simulator switch).
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it. Simulator off: `testingPeriod` false (D90).

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
