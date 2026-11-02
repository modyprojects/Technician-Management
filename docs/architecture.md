# Architecture and Data Boundaries

## Runtime
Vercel-hosted Next.js PWA → authenticated server actions / API routes → Supabase Postgres (RLS), Auth and private Storage. The browser uses only the publishable key and user-authorized access; rare privileged server operations use the secret key. External integrations sit behind server-only adapters.

## Environments
- **Development and Preview:** fictitious data only; Outlook invitation simulator enabled (D24); Preview visible to the owner only during the testing period (D29).
- **Production:** used for real work only after Microsoft 365 is connected (D23); simulator disabled by environment setting. Until go-live it is the owner's protected viewing address for approved versions with fictitious data only, may serve `/dev`, and will point to the development Supabase project (D31, known deviation; see the go-live gate in `docs/deployment.md`).
- Separate Supabase projects for development and production from go-live, once the owner approves a production project (D30). During the testing period Vercel Production uses the development project (D31 known deviation). Preview never points at a production database.

## Business model
Customers → service calls → visits. Technician assignment belongs to visits. Visits own media, recordings, transcripts, parts and signatures. Call status, visit status and device sync state are distinct. Products are created from invitations (D19); brand and supplier optional.

## Calendar intake (one ingestion service)

```
Outlook invitation simulator ─┐
                               ├─► calendar adapter ─► ingestion service ─► customers / service calls / visits / products
Microsoft Graph (future) ─────┘        (normalized event)      (validate, dedupe, upsert)        └─► calendar_ingestion_errors
```

- **Normalized event:** source, calendar ID, event ID, change type (created / updated / deleted), attendee email, start/end, subject, body.
- **Ingestion service** (`features/calendar/ingestion`): recognizes `[קריאת שירות]`, parses labels, validates, deduplicates by (source, calendar ID, event ID), upserts the customer, upserts the product by normalized SKU (D19), creates or updates the visit, records errors. Same code path for every source. No separate logic for simulated visits.
- **Simulator adapter** (`features/calendar/adapters/simulator`): office screen for authorized roles; produces normalized events with stable simulated event IDs; marks results as test data; enabled only by environment setting.
- **Graph adapter** (`features/calendar/adapters/graph`, later): change notification wakes an authenticated handler; fetch the event, validate, pass to ingestion. Subscription renewal and missed-change recovery (delta query) are maintenance concerns. No polling. Not built until Microsoft 365 is available and approved.
- Deleted events: behavior OPEN (decisions.md open #5).

## Offline (D06, D20)
- Cache the app shell and a subset of assigned visit data after an online login. No new visits without the server.
- IndexedDB queue of typed commands with UUID operation IDs, upload manifests, expected server version and timestamps. Replays rely on server idempotency and conflict rules, not blind updates.
- On reconnect while the app is open: re-check identity and access, sync media and actions in a safe order, remove local records only after server acknowledgement. Manual retry and failed/conflict states.
- Voice-only completion stays pending until an approved text summary exists (final rule OPEN).
- Minimal PII offline; IndexedDB is not a secure vault; retention and wipe policy OPEN.

## Completion and reliable email
In one transaction the server finalizes the visit (only when media, signature and summary requirements are met) and inserts a unique `email_outbox` row. A sender delivers with retries and records attempts. Recipients: Manager and the customer-service mailbox (D09). Content per D22. Test-data visits never reach a real provider. Mock adapter until a provider is approved.

## Notifications
In-app rows created by events (ingestion, cancellation, follow-up scheduling). No scheduled jobs in the first release (D25).

## Directory ownership
`app/` routes; `components/` UI; `features/` business operations; `lib/` server-only and shared utilities; `supabase/migrations/` schema; `tests/` automated tests; `docs/` knowledge. Never access privileged providers from client components.
