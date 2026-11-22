# Architecture and Data Boundaries

## Runtime
Vercel-hosted Next.js PWA → authenticated server actions / API routes → Supabase Postgres (RLS), Auth and private Storage. The browser uses only the publishable key and user-authorized access; rare privileged server operations use the secret key. External integrations sit behind server-only adapters.

## Environments
- **Development and Preview:** fictitious data only; Outlook invitation simulator enabled (D24); Preview visible to the owner only during the testing period (D29).
- **Production:** used for real work only after Microsoft 365 is connected (D23); simulator disabled by environment setting. Until go-live it is the owner's protected viewing address for approved versions with fictitious data only, may serve `/dev`, and uses the same Supabase project, which stays the only one after go-live (D93; see the go-live gate in `docs/deployment.md`).
- **One Supabase project for testing and production (D93, owner 2026-11-19).** No separate production project (D30). Before go-live the test data is removed by the approved cleanup script (go-live gate in `docs/deployment.md`).
- **Before go-live (D47, D93):** the cleanup of the existing project was chosen (D93); the pre-launch acceptance checklist is completed (go-live gate in `docs/deployment.md`); the real app starts with no fictional content. The cleanup lifts the immutability and append-only protections temporarily, removes test records, Storage files and test Auth users, leaves the test data in backups, and is a separate owner-approved operation.
- **Supabase organization (D50):** the project belongs to a company/department organization whose setup, member access, plan and billing are accepted by the department. This is a planning assumption, not a verification of security settings; any change that would create a charge or materially increase security risk is still flagged to the owner. Organization members with SQL access are owner-level and outside the app's controls (`docs/database-schema.md` §1).
- **Invitation-only access (D50):** no public sign-up. The owner sets the Supabase Auth settings himself before PR 1.3: "Allow new users to sign up" off (server-side creation and invitations still work), "Allow anonymous sign-ins" off, Email provider on, Data API exposed schemas `public` and the default `graphql_public` only. Supabase's built-in email service sends only to members of the organization's team, so emailed invitations to employees need an approved email provider (open decision 9); until then the Creator issues initial credentials.

## Business model
Customers → service calls → visits. One service call can have many visits; technician assignment belongs to visits. **The address is stored per visit** (D39). Customer contact details are updated field by field from the latest valid invitation; a different SKU or customer number on an existing call, and a different customer name for the same customer number, go to review (D39). Visits own media, recordings, transcripts, parts and signatures. Products are created from invitations (D19); brand and supplier optional. Field-level history is kept (`entity_changes`).

Three separate states, never merged:
- **Service-call status (D38):** "פתוחה" (any open visit), "טופלה" or "המשך טיפול" (from the latest closed visit by visit number), "ממתינה לשיבוץ" (every visit cancelled). Recalculated by one server function in the same transaction as any visit change. Cancelling a visit never cancels the call; a new invitation on a resolved call reopens it; cancelling a whole call is open decision 5 (d08).
- **Visit status:** the demo's visit statuses ("שובצה", "בדרך", "בטיפול", "טופל", "המשך טיפול", "בוטלה"), changed only by server-side actions, with history in `visit_events`.
- **Device sync state:** held in the device's work queue (D46) and in the server's idempotency record (`offline_operations`); it is never stored as a visit or call status.

Schema details: `docs/database-schema.md`.

## Permissions and accounts (D33, D34, D51)
Roles (Technician, Customer Service, Manager, Creator) come from the user's profile on the server, never from client-sent values. Manager and Customer Service capabilities come from an editable permission matrix that only the Creator changes, through a Creator-only server function that takes effect immediately and is audited; Technician and Creator capabilities are fixed (D33). Matrix values are temporary (`value_status`) until the owner approves the final values in Step 10; a key added later defaults to denied; pre-pilot gate: the owner approves the final matrix (D51). Data keys (`calls`, `card`, `settings`, `products`, `conflicts`, `cancel`, `recordings`) are enforced in the database (RLS, grants, server functions); screen keys (`cal`, `dashGen`, `dashTech`, `dashProd`, `export`, `usage`) gate screens and server functions and never bypass database and server-side authorization, and every export is authorized on the server (accepted v1 limitation: a user with `calls` can read the same rows through the API). Account administration is a fixed capability (D34): only the Creator manages Manager and Creator accounts; a Manager manages Customer Service and Technician accounts, but Manager-initiated Customer Service creation, activation, reactivation and role changes take effect only after the Creator approves, deactivation is immediate (audited, the Creator notified in the app), Technician changes are immediate, Managers never set passwords or change emails, and every change to a Technician's Outlook email notifies the Creator. Every account action is authorized in the database under the caller's own session before any Auth admin call with the secret key.

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

## Offline (D06, D20, D46)
- Cache the app shell and the read-only cache below (D46) after an online login. No new visits without the server.
- **Two separate device stores (D46):**
  1. **Read-only cache:** own visits, minimal customer data, pickup list and previous-visit information (D36). Retention: own open visit until it is closed, re-assigned or cancelled; own closed visit until the end of that day; previous-visit information until the end of the scheduled day or a revocation signal at sync, whichever comes first. Other Technicians' recordings are never cached. Purged at sync when access ends. Final durations: open decision 12, before the pilot.
  2. **Work queue:** what the Technician produced (reports, photos, videos, audio, signatures, time reports) as typed commands with UUID operation IDs, upload manifests, expected server version (`field_version`) and the D45 time fields. Kept until the server confirms receipt and integrity; **never deleted automatically** because the workday ended, an assignment was cancelled or access was lost. Conflicting data and media are preserved for authorized review (D44).
- **Identity and environment binding:** each local store is bound to the user id and to an environment id (the Supabase project ref plus a data-generation id from the server). An operation is never sent under another user. On an environment mismatch the read-only cache is purged and queued operations are not sent; they are offered for export and review, so a device can never send test operations to a production database (D47).
- **Previous visits and revocation (D36):** the server ends access immediately when the assignment ends (re-assignment, cancellation, closure), the account is deactivated or the role changes. When the app opens or syncs, the device purges from the read-only cache everything that is no longer allowed. The Technician's own unsynced work is never purged.
- Replays rely on server idempotency and conflict rules (D44), not blind updates.
- On reconnect while the app is open: re-check identity and access, sync media and actions in a safe order, remove local work only after server acknowledgement. Safe retries (backoff, manual retry, idempotent operation ids), failed/conflict states and clear warnings for pending data.
- **Deactivated account:** it cannot sign in, so it cannot sync; its pending work stays on the device with a clear warning. The recovery path is open decision 25, decided in Step 4.
- **Unavoidable risks** (documented; no recovery is promised for data that existed only on the device): device loss or damage, browser storage eviction, app removal or cleared browser data before sync.
- Voice-only completion stays pending until an approved text summary exists (final rule OPEN, open decision 3).
- Minimal PII offline; IndexedDB is not a secure vault.

## Completion and reliable email
In one transaction the server finalizes the visit (only when media, signature and summary requirements are met) and inserts a unique `email_outbox` row. A sender delivers with retries and records attempts. Recipients: Manager and the customer-service mailbox (D09). Content per D22. Test-data visits never reach a real provider. Mock adapter until a provider is approved.

## Notifications
In-app rows created by events (ingestion, cancellation, follow-up scheduling). No scheduled jobs in the first release (D25).

## Directory ownership
`app/` routes; `components/` UI; `features/` business operations; `lib/` server-only and shared utilities; `supabase/migrations/` schema; `tests/` automated tests; `docs/` knowledge. Never access privileged providers from client components.
