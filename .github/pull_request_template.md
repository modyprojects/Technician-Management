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
- [ ] Merge only after the owner's explicit approval (D31)
- [ ] Deployment protection checked before and after Production
