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

## Hebrew speech-to-text — planned, not connected
- Recording can be captured offline. On reconnect, upload securely; transcription runs only after vendor, privacy terms, region, consent and budget are approved (decisions.md open #11).
- Technician reviews, corrects and approves the transcript as the summary. Never send an unreviewed transcript.

## Excel
`.xlsx`, authorized rows and filters, Hebrew, safe dates, treatment text and approved transcript only, no media or signed URLs, formula-injection safe. Not an ERP template.

## In-app notifications
Bell and list only, created by events. No push, SMS, WhatsApp or scheduled reminders (D10, D25).

## Forbidden
No ONE ERP integration, synchronization, import/export contract, field mapping, adapter or table (D07).
