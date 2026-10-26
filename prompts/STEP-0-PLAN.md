# Prompt P0-1 — Step 0 plan only (version 2, 2026-10-26)

Paste the block below into a new Claude Code session on the `technician-management` repository.

```text
You are working in the `technician-management` repository. I am the project owner and this is my first app.

LANGUAGE
- Talk to me only in clear Hebrew: plans, questions, recommendations, progress and approval requests.
- Keep all code, comments, commit messages, PRs, plan files, WORKLOG and decisions in English.
- The end-user app and the user guides are Hebrew, right-to-left.

READ FIRST, in this order
1. CLAUDE.md
2. docs/decisions.md
3. docs/demo-deviations.md  (where it differs from docs/demo.html, it wins)
4. docs/spec.md
5. docs/demo.html  (visual and interaction reference only)
6. docs/security.md, docs/architecture.md, docs/design-system.md
7. docs/ROADMAP.md and the latest entries in docs/WORKLOG.md

TASK: STEP 0 PLAN ONLY
Inspect the repository read-only and propose the smallest safe plan for Step 0:
- Next.js App Router + TypeScript strict + Tailwind, Hebrew RTL.
- Design tokens copied exactly from docs/demo.html (colors, Rubik and Assistant fonts, status colors).
- A restricted /dev/showcase page that shows the tokens and basic components with fake data only.
- A protected Vercel Preview deployment from a feature branch.
- CI checks: build, lint, typecheck, secret scanning.

Your plan, in Hebrew, must include:
1. Every file you will create or change, with one line on why.
2. Every dependency with an exact version, and why it is needed.
3. How the Preview stays private, and anything I must switch on in Vercel myself.
4. Expected cost. If it is zero on current plans, say so explicitly.
5. How I can check the result on my phone and computer (390px, 820px, 1440px).
6. What you will NOT do in Step 0.
7. Any conflict you found between the documents. Do not resolve it yourself; list it and ask me.

HARD LIMITS FOR THIS MESSAGE
- Do not write code, install packages, create branches, deploy, or change any cloud setting.
- No Supabase project, tables or migrations. No Microsoft 365. No invitation simulator yet (Step 6). No real email. No customer data.
- No ONE ERP integration or scaffolding of any kind.
- Never ask me to paste API keys or secrets into the chat.

End with a short list of questions I must answer before you start, then stop and wait for my explicit approval.
```
