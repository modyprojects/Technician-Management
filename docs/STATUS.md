# STATUS — Technician Management
Updated 2026-11-19, end of day. Keep ≤40 lines; update at the end of every task.

## Where we are
- **Version 1: 2 December 2026** (owner, 19.11): all V1 modules merged, on test data; online only.
- Supabase: M1–M7 applied (M7 = remote 20261119095402, payload SHA 489901e5… verified); bucket `visit-media` created 19.11 (private, 10 MiB, JPEG/PNG/WebP).
- Public repo (D84): never commit secrets or real data. Rules: levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- Decisions D68–D91; #42 technician home; #36 user management; #49 TimeRange + colours; #51/#52 simulator gate; #43 unparsed; #44 calls list; #45/#54 technician calendar; #38 M7; #46 call card; #53/#55/#56 docs (D79–D92, design rules, M365 plan, go-live gate).

## Modules (D88: one open module per lane, end to end)
- Technician: 1. calendar ✅ → **2. visit flow: skeleton #58 (b970752) awaits owner answers (5 questions)** → 3. profile.
- Office: 1. calls ✅ (#43, #44, #46) → **2. technician calendar: skeleton #57 (9ed18c1) awaits owner answers (5 questions + week Sun–Thu or Sun–Sat)** → 3. manager dashboard (scope rule D91).

## Open PRs
- #57, #58 (draft skeletons, above). Nothing else open.

## Waiting for the owner
- Production (D87): https://technician-management-mody-projects.vercel.app on main 16b5f10, READY, no runtime errors; separate secret keys per environment; `CALENDAR_SIMULATOR=1`. Owner browser check pending (sign-in per role, landings, simulator) — Claude cannot pass Vercel Authentication without a share link (forbidden); then Claude reads the runtime logs.
- IT: the M365 app registration (D86, `docs/m365-mail-plan.md`); video/audio media (open decisions 3, 4, 11).

## Next, in order
1. Owner answers on #57/#58 → real-data builds (D88); call card photos with the visit flow (D92).
2. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
3. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key (revoke the "vercel_preview" Supabase secret key; Production gets a new key on the new project); Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts, "נקרא" (D78), #36 L1/L2, OQ-13 (the DB enforces the simulator switch).
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it. `testingPeriod` false: simulator off (D90), test data hidden (D91).

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
