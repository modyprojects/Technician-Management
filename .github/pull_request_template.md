## Summary

<!-- One or two sentences: what this PR does and which step / PR of the approved plan it belongs to. -->

Code written by Claude Code under the direction of the repository owner.

## What changed

<!-- Files, tables, routes or settings touched, grouped by area. Reference decisions (D##) and demo-deviation rows where relevant. -->

-

## How it was tested

<!-- Commands run and results (CI run link, local checks), negative tests added, and anything not tested or left unresolved. -->

-

## Owner review (what to look at)

<!-- What the owner should check and where (Preview link, screenshots under docs/review/<step>/, test report). The Hebrew summary for the owner is sent separately in the conversation. -->

-

## Checklist

- [ ] CI green: lint, typecheck, build, e2e, bundle check, audit
- [ ] Gitleaks clean
- [ ] Database: negative RLS/grant tests added, or N/A
- [ ] Test data marked and labelled (D47), or N/A
- [ ] Database: test-data census zero on a database built from migrations, catalog coverage complete, or N/A
- [ ] No secrets, keys or real data
- [ ] `docs/PROJECT-MAP.md` updated, or not needed
- [ ] `docs/WORKLOG.md` updated
- [ ] `docs/decisions.md` / `docs/demo-deviations.md` updated if needed
- [ ] UI: screenshots at 390 / 820 / 1440 px, or N/A
- [ ] Preview stays owner-only (D29)
- [ ] Independent review recorded (authentication, authorization, proxy/gate, environment handling or deployment-configuration changes; D53), or N/A
- [ ] Merge per D53: every mandatory check green on the exact approved head (any later commit needs the checks and reviews again); the owner's approval if this PR weakens protections in `CLAUDE.md`, `docs/security.md`, `.github/workflows/**`, `vercel.json`, `proxy.ts`, `app/dev/_gate.ts`, `config/release.json` or the canary-rows check's own files (`scripts/db-canary.mjs`, `tests/db-canary/**`, `tests/db-canary-selftest/**`; D54)
- [ ] Deployment protection (D31, D53): Claude Code's read-only checks before the merge and after the Production deployment (CI, commit SHA, READY, Vercel Authentication on All Deployments, Production domains); any check it cannot perform reported; a failed or inconclusive check stops further merges until the owner confirms
