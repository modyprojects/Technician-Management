# STATUS — Technician Management
Updated 2026-11-19 (~15:00). Keep ≤40 lines; update at the end of every task.

## Where we are
- **Version 1: 2 December 2026** (owner, 19.11): all V1 modules merged, on test data; online only.
- Supabase: M1–M7 applied (M7 = remote 20261119095402, payload SHA 489901e5… verified); bucket `visit-media` created 19.11 (private, 10 MiB, JPEG/PNG/WebP).
- Public repo (D84): never commit secrets or real data. Rules: levels A/B/C (D80), skeleton first (D81), `docs/design-rules.md` (D82).

## Done on main (19.11)
- Decisions D68–D91; #42 technician home; #36 user management; #49 TimeRange + colours; #51/#52 simulator gate; #43 unparsed; #44 calls list; #45/#54 technician calendar; #38 M7; #46 call card; #53/#55 docs.

## Modules (D88: one open module per lane, end to end)
- Technician: 1. calendar ✅ → **2. visit flow (skeleton in progress)** → 3. profile.
- Office: 1. calls ✅ (#43, #44, #46) → **2. office technician calendar (skeleton in progress)** → 3. manager dashboard (scope rule D91).

## Open PRs
- Skeletons: technician visit flow; office technician calendar (draft PRs coming).

## Waiting for the owner
- D87 done by the owner 19.11: Production/Preview each has its own Supabase secret key ("vercel_production" / "vercel_preview"); `CALENDAR_SIMULATOR=1` on both. Production redeployed from main; owner browser check pending.
- IT: the M365 app registration (D86, `docs/m365-mail-plan.md`); video/audio media (open decisions 3, 4, 11).

## Next, in order
1. Skeleton reviews → real-data builds; call card photos come with the visit flow (D92).
2. Customer Service nav: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" (D60 (4)).
3. Follow-up: next 16.4.3 → 16.4.6 (`next build` stops once with a security notice; the retry passes).

## Go-live gate (D87; all before the first real user)
- Separate Production Supabase project; rotate the secret key (revoke the "vercel_preview" Supabase secret key; Production gets a new key on the new project); Vercel Authentication off.
- Post-M7 hardening migration: deleted-but-not-banned accounts, "נקרא" (D78), #36 L1/L2, OQ-13 (the DB enforces the simulator switch).
- MFA for the Creator and Managers; rate limits (sign-in, reset, invitation).
- Invitation + reset email through M365 (D86) once IT connects it. `testingPeriod` false: simulator off (D90), test data hidden (D91).

## Notes
- Local stack: CLI via `scripts/install-supabase-cli.sh <dir>`; registry pulls may fail ("Data limit exceeded"): retag cached `kong`, `mailpit`, `vector` as `supabase/…` and start with `-x studio,logflare,vector,imgproxy,edge-runtime`.
