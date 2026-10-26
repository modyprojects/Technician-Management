# Deployment and Environments
- Cloud-first development; GitHub repository PRIVATE; feature branch -> controlled Vercel Preview -> approval -> merge to main.
- Distinct Supabase development and production projects; **no Preview links to Production database**. Production credentials, services and live data off-limits pending approval.
- Environment values only in provider-managed secrets with least privileges. Never paste actual values into Claude conversation, repository, PR, screenshot, test fixture or logs.
- Limit Vercel preview visibility and do not expose unpublished /dev or support diagnostics publicly. Don't assume Preview URLs are access-controlled automatically; verify.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intentionally public; `SUPABASE_SECRET_KEY`, provider mail/transcription keys private server-side only.
- Run build/lint/typecheck/automated tests/secrets detection/dependency security checks before PR. Security tests must include cross-technician access negative cases and browser bundle secret scan.
- Define DB + Storage backup & restoration plan and prove restoration before pilot. Do not claim backups exist unless configured and checked.
- No real customer records or emails on development/Preview.
