# STATUS — Technician Management
Updated 2026-11-19 (~14:30). Keep ≤40 lines; update at the end of every task.

## Where we are
- **Version 1: 2 December 2026** (owner, 19.11): all V1 modules merged, on test data; online only.
- Supabase: M1–M7 applied (M7 = remote 20261119095402, payload SHA 489901e5… verified); bucket `visit-media` created 19.11 (private, 10 MiB, JPEG/PNG/WebP).
- Public repo (D84): never commit secrets or real data. Rules: levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- Decisions D68–D91; #42 technician home; #36 user management; #49 TimeRange + colours; #51/#52 simulator gate; #43 unparsed; #44 calls list; #45/#54 technician calendar; #38 M7; #53 CLAUDE.md/security.md D90.

## Modules (D88: one open module per lane, end to end)
- Technician: 1. calendar ✅ → **2. visit flow (next: skeleton)** → 3. profile.
- Office: **1. calls: #43 ✅ → #44 ✅ → #46 real-data build (in progress)** → 2. office technician calendar → 3. manager dashboard (scope rule D91).

## Open PRs
- #46 call card on real data (in progress; independent review after).

## Waiting for the owner
- D87: the three Supabase variables + `CALENDAR_SIMULATOR=1` in Vercel Production; then Claude redeploys and checks read-only.
- Approval: `docs/security.md` §9 text for D91 (now says test data is never shown in Production).
- IT: the M365 app registration (D86, `docs/m365-mail-plan.md`); video/audio media (open decisions 3, 4, 11).

## Next, in order
1. #46 call card on real data; technician visit flow skeleton (D71, D81).
2. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
3. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key; Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts, "נקרא" (D78), #36 L1/L2, OQ-13 (the DB enforces the simulator switch).
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it. `testingPeriod` false: simulator off (D90), test data hidden (D91).

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
