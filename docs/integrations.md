# Integrations and Boundaries

## Calendar
- **Now:** Outlook invitation simulator (D24) in development and Preview only, through the single ingestion service. Fictitious data, marked as test data.
- **Later:** Microsoft 365 via Microsoft Graph change notifications (D08, D18). The notification signals a change; the server fetches, validates, deduplicates and reconciles the event. Subscription renewal and missed-change recovery are maintenance tasks, not polling.
- No live Graph tokens, tenant registration, mailbox reading or subscriptions until Microsoft 365 exists and the owner and IT approve. Open: rollout date, where the service calendar runs today, shared vs. personal calendar, read-permission scope (decisions.md open #13, #14).
- Real use of the app starts only after this connection exists (D23).

## Products
No external product source. Products are created from invitations (D19). No import.

## Email — approved requirement, provider TBD
- Completion email to Manager and the customer-service mailbox for both outcomes (D09); content per D22.
- Server-side provider selected with owner approval, verified domain, rate limits. No live email in development or Preview; simulated visits never send real email.
- Outbox written atomically with server-finalized completion; retries with backoff; delivery results audited.

### Mail port and the password-reset email (D65, Step 2)
- **Port:** `lib/mail/` (server-only) with the pure parts in `features/mail/`. `EMAIL_DELIVERY` selects the delivery:
  - `disabled` (default when unset or unknown): nothing is sent. The request screen "איפוס סיסמה" then answers that email delivery is not active in this environment, decided by the environment alone (also when `SUPABASE_SECRET_KEY` or a usable link origin is missing).
  - `mock`: local runs and CI only: refused wherever `VERCEL_ENV` is set (every Vercel deployment) and without `MAIL_MOCK_FILE` naming an absolute path (then `disabled`). One JSON line per message is appended to that file (the local auth tests). Never sent, never logged, never kept in memory.
  - `resend` (**dormant**): the Resend HTTP API (`POST https://api.resend.com/emails`, Bearer key, JSON `{from, to, subject, html, text}`, 10-second timeout, failures mapped to codes, the response body cancelled unread). Needs `EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM_ADDRESS`, else it falls back to `disabled`. Unit-tested with a fake `fetch` only; it has never sent an email.
- **Today:** every environment is `disabled` (Vercel Preview and Production have no `EMAIL_DELIVERY`) or the local `mock`. A Resend account exists, but no sending domain is verified (D65; open decision 9 stays open). Nothing in the app claims that Resend works.
- **Reset links:** the app builds them itself, `<origin>/login/reset?token_hash=…`, from a recovery token's hash created by the server-only Auth Admin `generateLink` (`lib/auth/password-reset-admin.ts`, `SUPABASE_SECRET_KEY` at call time), after the request has answered (so the answer's timing says nothing about the account), and sends them to the account's own address as `generateLink` returns it. Supabase's own mailer, email templates, Site URL and redirect list are not used, so no remote Auth or email setting changes. The origin comes from `APP_ORIGIN` or Vercel's system variables (`VERCEL_PROJECT_PRODUCTION_URL` in Production, `VERCEL_BRANCH_URL` in Preview), never from the request's Host header.
- **Who gets a link (D67 (a); user-management review N4):** only an account that has signed in before (Auth `last_sign_in_at` set) and is not banned (a deleted account is banned, D60 (7) Option A). Any other request is skipped silently after the answer ("sent" all the same; log codes `skipped_never_signed_in`, `skipped_banned`): no link is built or sent. The Creator sets an account's first password (D50).
- **Interim throttle:** at most one reset email per address per minute and 20 per minute per server instance, in memory (`features/auth/password-reset/throttle.ts`). Vercel runs several instances and restarts them, so this is no durable limit. The per-instance cap also counts addresses without an account (the throttle runs before the Auth call and must not reveal accounts); how unknown addresses count belongs to the durable throttle's design. Today nothing is delivered, and Preview and Production sit behind Vercel Authentication (D29, D31).
- **Mandatory go-live steps before `resend` is enabled in any environment** (D65; independent review 2026-11-17; each with the owner's approval):
  - Supabase Auth **"Email OTP length" = 10** (the owner's remote setting; the default 6 digits leave about a million candidates per address), confirmed by a read-only check together with "Email OTP expiration" at most 3600 seconds.
  - A **durable per-address request cap** (for example at most 5 reset emails per address per hour) in place of the interim throttle: a database-backed counter (a migration, with the owner's approval) or Supabase's Send Email Hook.
  - An **app-level cap on token submissions** to `completePasswordReset` (durable, per address or token and per client).
  - Recorded, not fixable in the app: a recovery token can also be redeemed **directly at Supabase's `/verify` endpoint with the publishable key** (inherent to Supabase recovery tokens), bypassing the app's caps; only the OTP length and the Auth server's own verification limit cover that path.
- **Future Resend activation (each step needs the owner's approval; nothing here is done yet):**
  1. In Resend, add and verify a sending domain (DNS records at the domain's registrar). No domain is bought without the owner's approval (D30, D65).
  2. The go-live steps above: the durable per-address request cap (replacing the interim throttle) and the cap on token submissions, with their tests.
  3. The owner sets, for the chosen Vercel environment only, `EMAIL_DELIVERY=resend`, `EMAIL_PROVIDER_API_KEY` (a sending-only Resend key) and `EMAIL_FROM_ADDRESS` (an address on the verified domain, for example `MODY <no-reply@…>`), and `SUPABASE_SECRET_KEY` if it is not set there yet. Claude Code never reads, asks for or prints these values.
  4. The owner sets the remote Auth "Email OTP length" to 10; then a read-only check (approved per operation) that it is 10 and that "Email OTP expiration" is at most 3600 seconds, since it bounds the link's lifetime (the token's hash is derived from the address and that code).
  5. One test reset to the owner's own address in Preview, then the owner's approval for Production.

## Hebrew speech-to-text — planned, not connected
- Recording can be captured offline. On reconnect, upload securely; transcription runs only after vendor, privacy terms, region, consent and budget are approved (decisions.md open #11).
- Technician reviews, corrects and approves the transcript as the summary. Never send an unreviewed transcript.

## Excel
`.xlsx`, authorized rows and filters, Hebrew, safe dates, treatment text and approved transcript only, no media or signed URLs, formula-injection safe. Not an ERP template.

## In-app notifications
Bell and list only, created by events. No push, SMS, WhatsApp or scheduled reminders (D10, D25).

## Forbidden
No ONE ERP integration, synchronization, import/export contract, field mapping, adapter or table (D07).
