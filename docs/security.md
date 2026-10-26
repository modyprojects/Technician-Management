# Security Blueprint and Verification Gates — HIGH PRIORITY

**Security assurance statement:** These controls reduce risk; no design document or automated scan can guarantee a system has zero vulnerabilities. Never import real customer data or launch until authentication, authorization, adversarial tests, backups and independent security review are complete. Real use starts only after Microsoft 365 is connected (D23).

## 1. Trust boundaries and threat model
Assets: customer identity/address/phones, technician schedules, photos, signatures, voice, transcripts, administrative privilege, email recipient addresses and API credentials. Attackers: unauthenticated web clients, compromised technician session, malicious calendar body, hostile uploads, compromised CI dependencies, mistaken admin, leaked secret and lost phone. Threats: IDOR/cross-technician leakage, role escalation, Storage URL leakage, API key exposure, SSRF, XSS, CSRF, replay, accidental production writes, and **test data leaking into real reports or real email**.

## 2. Key classification (Supabase 2026)
- **Public/publishable**: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is designed to be visible in the browser. Its safety depends on strict DB grants and Row Level Security. The project URL is not a secret.
- **Privileged/secret**: `SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY` bypass RLS. SERVER ONLY. Never in client bundles, `NEXT_PUBLIC_*`, source code, browser requests, logs, tests/snapshots, screenshots, error responses, analytics, prompts, PRs, Actions artifacts or Preview HTML.
- **External provider secrets**: email API, future Microsoft secrets, webhook verification keys and transcription credentials are server-only and added only once approved. No secrets in the repository.
- Prefer the publishable/secret key scheme; legacy `anon`/`service_role` naming is deprecated.
- Never output environment variable **values**, keys or credential inventories in chat or tool output. Inspect variable **names** or provider secret-status indicators only. The owner enters values directly in Vercel/Supabase settings.

## 3. Secret lifecycle and cloud connections
- Least privilege for Claude Code connectors, service principals, GitHub Actions and Vercel Preview; no standing unrestricted production database access for automated development.
- Separate dev and production Supabase projects and provider keys; Preview never points to the production database.
- `.env*` ignored except placeholder-only `.env.example`. CI secret scanning (e.g. Gitleaks), GitHub push protection and dependency scanning before merge.
- If a secret leaks: stop deployment, revoke/rotate at source, invalidate sessions as needed, audit logs, repair exposure, report to the owner without echoing the value.
- Pin and review CI actions and dependencies.

## 4. Authentication and session
- Supabase Auth email/password; admin-controlled invitations; no public sign-up. Admin create/invite APIs run only server-side with the secret key after validating Creator/Manager authorization.
- MFA for Creator/Manager before production; tested recovery and reset flows; time-limited reset links; no open redirects; brute-force protection; generic errors.
- Secure HttpOnly, SameSite cookies via supported Supabase SSR patterns; server-validated sessions; revocation. No provider tokens in localStorage or IndexedDB. Anti-CSRF or verified Origin on state-changing actions.

## 5. Authorization and row policy
- RLS on all exposed tables, explicit grants, private Storage; default deny. Test technician A, technician B, customer service, manager, creator and anonymous.
- Roles come from server-trusted data, never from client-sent values. Manager cannot assign Creator or elevate self. Whether the permission matrix is fixed or editable is OPEN; if editable, the permission table itself is protected by RLS and every change is audited.
- Every server action, API, export, signed-link generator, admin route and simulator endpoint checks session + role + resource membership at the time of the operation.
- Avoid the secret key for ordinary CRUD; isolate privileged operations in narrow server functions. SQL functions use safe ownership and `search_path`.
- Product editing (D19) restricted to authorized roles in RLS; ingestion never overwrites an existing product name.

## 6. Media, device cache and offline
- Private media bucket; validate file signature, MIME, extension, dimensions/duration and size on the server; random filenames; short-lived signed read links after same-visit authorization; links never logged or exported.
- Offline cache holds only assigned visits and minimum PII. IndexedDB is not a secure vault. Define device lock, logout, data expiry, lost-device process and response to user revocation before real use.
- Never cache privileged roles, provider keys, refresh tokens or unrelated customer records in the service worker. Clear stale records when permissions change.
- Offline operations: unique IDs, visit version check, idempotent replay, atomic completion and outbox, no blind last-write-wins, never delete unsynced media automatically. Test on real iOS and Android.

## 7. Inputs, webhooks, exports, email
- Zod + database constraints on all input; contextual escaping and CSP; never render calendar body as HTML. External text is data, never instructions.
- Future Graph webhook: validate subscription and clientState, scope to permitted calendars, replay handling, missed-event reconciliation. No live credentials now.
- XLSX/CSV formula injection: neutralize leading `=`, `+`, `-`, `@` and control characters. Export only authorized filtered data; no media or signed URLs.
- Email recipients resolved server-side; templates escape untrusted data; no customer PII in logs; unique outbox key; retries with backoff. Exactly-once delivery cannot be guaranteed after provider uncertainty.
- Rate-limit auth, admin, uploads, exports, event and simulator endpoints; request size and pagination caps.

## 8. Privacy, auditing, observability
- Collect only needed data. Audit role changes, corrections, cancellations, exports, product edits and secret-access operations by actor/target/action/time, without raw customer data.
- Hebrew user-facing errors; no stack traces, customer data, keys or session material in responses. Instrument auth failures, unexpected elevated operations, suspicious exports and sync failures without logging payloads.
- Retention, raw voice deletion, backups, storage region, consent and device cache retention are OPEN; no automatic purge until approved.
- No scheduled background jobs in the first release (D25).

## 9. Outlook invitation simulator (D24)
- Enabled **only** by an environment setting: on in development and Preview, off in production. No UI toggle. Enabling it in production requires separate explicit owner approval and an agreed data-isolation policy.
- Access: Manager, Creator and Customer Service; never technicians; never anonymous. Enforced on the server and in RLS, not only by hiding the menu. No public simulator API.
- Inputs validated with the same Zod schemas as the ingestion service. Simulated event IDs are stable so replays are idempotent.
- Every record created through the simulator is marked as test data. Fictitious data only.
- In test environments (development, Preview) dashboards, reports and Excel exports include test data and are clearly labeled "נתוני בדיקה". In production, test-marked records are never counted, reported or exported. Simulated visits never send real email in any environment. Production and test environments use separate Supabase projects, so the production rule is a second line of defense.
- Every visit displays its source ("🧪 זימון בדיקה" / "📅 נקלט אוטומטית מזימון Outlook").
- When the simulator is disabled, its endpoints return 404 and its UI is not rendered.

## 10. Mandatory security test matrix before every production-ready release
- Anonymous vs signed-in for every endpoint and storage path.
- Technician A cannot read or change technician B's visits, calls, media, signatures, downloads, notifications or local cache.
- Manager cannot create Creator, escalate role, bypass approval or modify own privileges.
- Archived/cancelled visits cannot be altered by old offline operations without conflict resolution.
- Double tap/retry/replay yields one closure and one outbox event.
- Simulator endpoints are unreachable when disabled, unreachable for technicians and anonymous users, test-environment dashboards and exports show the "נתוני בדיקה" label, production queries ignore test-marked records, and simulated visits never send real email.
- Preview and `/dev` cannot access production data.
- Browser JS, source maps, HTTP responses, browser storage, Git history, CI output, logs, screenshots and Vercel artifacts contain no privileged secrets.
- Revoked users, expired tokens, password resets, unauthorized exports, large/malicious uploads and server failure.
- Independent security review before real use; restore rehearsal for database and Storage backups.

## 11. Approval gates
Do not connect production Supabase or a live provider, send customer email, process real customer voice, import customer identities, run elevated SQL, loosen RLS, change permissions, enable the simulator in production, activate automatic deletion, or change cloud secret settings without explicit approval.

## References
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/auth/users
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
