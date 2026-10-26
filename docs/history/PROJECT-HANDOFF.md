> **HISTORICAL — NOT AUTHORITATIVE (moved here 2026-10-26).** This is the original handoff, kept for context. Where it differs from `CLAUDE.md`, `docs/decisions.md` or `docs/demo-deviations.md`, those documents win. Known superseded points: §6/§13 customer number and warranty (now D17); products (D19); §11 Step 6 now uses the Outlook invitation simulator (D24); no scheduled background jobs (D25); real use only after Microsoft 365 (D23). Do not act on this file's "START HERE" instructions; start from `CLAUDE.md`.

# PROJECT HANDOFF — Technician Management Application
**Prepared:** 2026-10-25  
**Audience:** Claude Code (cloud development environment)  
**Status:** Planning and documentation prepared; implementation has NOT been verified as started.  
**Purpose:** Transfer the full project context, decisions, constraints, delivery plan, and safety rules into Claude Code without relying on prior ChatGPT messages.

> **START HERE:** Read this file, then `CLAUDE.md`, `docs/decisions.md`, `docs/spec.md`, `docs/demo.html`, `docs/security.md`, `docs/database-schema.md`, `docs/ROADMAP.md`, and `docs/THINKING-AHEAD.md`. Review repository and cloud resource state before taking any action. This file is contextual history and handoff; `docs/decisions.md` contains approved decisions, and `CLAUDE.md` contains operative development rules. Flag discrepancies rather than silently resolving them.

## 1. Owner, communication and working method
- The project owner is building their **first application**. Explain every stage in accessible **Hebrew**, including consultations, recommendations, alternative choices, questions, approvals, progress updates, and test instructions.
- **English only** for Claude prompts, repository documentation and plans, source code, comments, test names, commit messages, PRs and engineering logs. **Hebrew RTL** for the actual application and end-user manuals. Hebrew strings and Outlook field labels in the approved demo/template must remain in Hebrew.
- The owner has accounts for **GitHub, Vercel, Supabase, and paid Claude Code**, and reports that Claude Code is already connected to all three services. Do not request reconnection absent a demonstrated need.
- The owner's computer is old. Work **cloud-first** in Claude Code / GitHub; do not depend on local VS Code, a local server being visible to the owner, or local Node.js installation.
- Use a **plan → Hebrew explanation → owner approval → small implementation → tests → protected preview → owner review** cycle. The owner expects to understand *what* is being built and *why*.
- At the beginning of each session, read current decisions and recent `docs/WORKLOG.md` entries. Keep a feature branch and PR per approved phase. **Never merge to `main` without explicit permission.**

## 2. Business context and goal
This is an internal technician service-visit web application, replacing informal field documentation via a WhatsApp group. Service representatives continue their existing office process; technicians handle assigned visits from their smartphones; office staff and managers use a desktop-oriented interface.

The system should:
1. Receive visit assignments eventually from Outlook calendar invitations (mock events for now).
2. Let a technician see their schedule, visit details, previous visit history and pickup checklist.
3. Guide the technician through Waze navigation, arrival, documentation, media, treatment notes, customer signature when resolved, and either **Resolved (`טופל`)** or **Follow-up Required (`המשך טיפול`)**.
4. Preserve data by customer, service call, and distinct visit.
5. Show office staff current statuses, history, return visits, exception/incomplete-invitation records; provide manager analytics by technician, product SKU, brand and supplier.
6. Send a completion email to **both the Manager and Customer Service mailbox** after each successfully server-accepted visit close, subject to approved summary/transcription rules.
7. Allow simple role-authorized XLSX downloads, with text data/approved summary **but no image, video or audio content**.

A *service call* is associated with its business request number and may have **multiple visits**. Each visit has its own task number and assigned technician. Do not equate visit completion with closure of every open follow-up, nor equate visit status with offline sync status.

## 3. Chronology of scope decisions (authoritative unless marked OPEN)
1. **Spec v2 superseded spec v1.** No creation/scheduling of calls inside the app. Office scheduling remains in the existing office workflow; the app presents calendar assignments.
2. **NO ONE ERP integration.** The original October 21 spec described an Excel upload/sync workflow for ONE, but the owner later explicitly removed **all ONE integration and even preparatory scaffolding**. Remove ONE-related APIs, schemas, sync flags, exports, background workers and roadmap tasks. Historical documents mentioning ONE are non-authoritative context only.
3. **Microsoft 365 is not currently available to the company.** Prepare a clean, vendor-neutral calendar-ingestion boundary and mocked events, but **do not connect Microsoft 365** or use real company calendars yet.
4. **When Outlook becomes available, use Microsoft Graph change notifications (event-driven webhooks), NOT five-minute polling.** Later implementation must authenticate webhooks, deduplicate deliveries, renew subscriptions, and recover missed changes; Graph notification is a trigger to fetch/validate event details, not necessarily the full invitation payload. Exact calendars and IT approval remain OPEN.
5. **Email-and-password authentication via Supabase Auth**; admin-provisioned accounts; no public signup. Both **Creator and Manager** can invite/create and manage regular workers; Manager cannot grant Creator privilege, self-escalate, or change Creator-level access. Creator has ultimate authorization.
6. **Partial offline operation — approved Option 2.** Previously cached assigned visits remain viewable; arrival, photos, recordings, signature, notes and closure actions can be captured to local durable storage and synced when app is active/reconnected, with manual retry. Never claim guaranteed background sync or absolute offline storage durability on iOS.
7. **Automatic visit-completion email** to both Manager and Customer Service mailbox for BOTH outcomes (`טופל`, `המשך טיפול`). Design independent of Microsoft 365. Use durable server-side outbox, idempotent send attempts, delivery state and mock mail adapter until a real provider is approved.
8. **In-app notifications only** for initial release; no mobile push/SMS/WhatsApp notifications.
9. **XLSX export** should export authorized and currently filtered records, including an approved textual treatment summary; never include photos, videos, audio files or raw recordings. No ONE-specific format. Protect against formula injection.
10. **Hebrew speech-to-text transcription requested.** Voice recording should become the treatment-summary text after technician review/correction/approval. Offline recordings may wait to upload and transcribe. Choice of provider, processing location/privacy/cost, and the exact process for a technician who leaves before approving the transcript are OPEN. Do not auto-approve raw AI transcripts.
11. **Photos/video proposal accepted provisionally**: compression where appropriate; suggested video duration up to **60 seconds**, voice recording up to **180 seconds**, and photo limits based on total volume rather than count; exact file-size caps and deployment cost limits remain OPEN. These are pilot targets, not fully tested platform limits.
12. **Completed synced visits locked for technicians.** Authorized Manager/Creator may correct with a mandatory reason and immutable old-value audit trail; changes cannot silently rewrite the previous record.
13. **Faithful visual reproduction** of the uploaded **original `docs/demo.html`** is mandatory, including layout, cards, status colors, fonts and flows. Do not redesign. Demo-only role/device switcher, fake emails and reset features are not real production controls.
14. User documentation must be written **in Hebrew with actual app screenshots and clear step-by-step instructions**, updated *as features are built*, in three guides: technician, customer service and manager/creator. Engineering documentation continues in English.

## 4. Approved reference visual design
- `docs/demo.html` is the complete original interactive HTML prototype (not an actual production app). Preserve its visual and functional intent while rebuilding in **Next.js App Router + TypeScript strict + Tailwind + PWA**.
- Key tokens extracted from demo:
  - Ink `#18212B`, accent `#155E75`, surface `#F2F4F6`, card `#FFFFFF`, divider `#DDE3E9`.
  - Fonts: **Rubik** headings and **Assistant** body.
  - Statuses: `שובצה` blue, `בדרך` yellow, `בטיפול` purple, `טופל` green, `המשך טיפול` orange, `בוטלה` grey.
- Technician: smartphone-first (large touch controls, lower navigation), today/next visit, calendar, pickup reminder, Waze, customer call/WhatsApp links where present in demo, arrival, media, summary, follow-up reason, signature, previous visits.
- Office: desktop layout, dark navigation sidebar, calendars, calls, customers, service-visit card, manager KPIs/products/suppliers and settings.
- Screens must be checked at roughly **390px**, **820px** and **1440px** viewports. Obtain visual approval before connecting production behavior.
- Demo seed data is fictitious and demo dates are static (2026-10-21); production dates must be dynamic and use **Asia/Jerusalem** time zone.

## 5. Architecture and file organization
- One responsive web app / installable PWA; not a native App Store/Play Store application.
- GitHub private repository for versions/PRs; Vercel gated Preview deployment; Supabase Postgres/Auth/private Storage; future Microsoft Graph adapter.
- Separate Supabase **development** and **production** projects; initially work in development with invented data only.
- Suggested structure:
  - `app/(auth)/`, `app/(tech)/tech/`, `app/(office)/office/`, `app/api/`;
  - `components/ui/`, `components/tech/`, `components/office/`;
  - `features/visits/`, `features/customers/`, `features/calendar/`, `features/notifications/`, `features/exports/`, `features/transcription/`;
  - `lib/auth/`, `lib/supabase/`, `lib/integrations/`, `lib/validation/` (server-only code where necessary);
  - `supabase/migrations/`, `tests/`, `docs/`, `docs/user-guides/`.
- Use small cohesive modules. Do not put business access control in client-only code. Use migration files and schema reviews rather than ad hoc DB changes.

## 6. Database design: proposal to approve before Step 1
Plan and validate an ER diagram and policies; do NOT assume these tables already exist:
- `profiles` / `roles` / role permissions; `technicians`
- `customers` → `service_calls` (one-to-many) → `visits` (one-to-many)
- `visit_media`, `visit_parts`, `visit_collections`, `collection_locations`
- `products`, `brands`, `suppliers`, `followup_reasons`
- `notifications`, `email_outbox`, `email_deliveries`
- future calendar event identity/deduplication and `calendar_ingestion_errors`
- `audit_logs` and sync/operation metadata needed for idempotent offline changes

Technical invariants:
- Internal UUID identifiers, business `request_number` and `task_number` stored separately.
- Define unique constraints, foreign keys, appropriate indexes, safe delete policies, timestamps and optimistic concurrency/version checking.
- Separate **visit lifecycle**, **service-call lifecycle**, **device sync state**, **transcription approval**, and **email delivery state**.
- No ONE sync column, ONE status, or ONE export tables.
- Confirm known **spec/demo discrepancies before creating schema**: the original spec requires customer number while demo invitation template omits it; original spec marks warranty optional while demo marks it required.

## 7. Security contract — primary priority
**There is no legitimate guarantee of zero vulnerabilities.** Treat every integration, route and release as needing verifiable controls, regression tests, audit and independent review before real customer use.

### Secret and API-key policy
- **NEVER request the owner to paste passwords, service tokens, Supabase secret/service-role keys, email/transcription API keys, Microsoft client secrets, database connection strings, or cloud environment-variable contents into chat, source files, prompts, PRs, logs, screenshots or tickets.**
- Use cloud platform secret management / encrypted environment settings. Read permissions only as needed. Never list, inspect, copy, serialize or print secret **values** to prove configuration; checking variable **presence** is sufficient.
- `NEXT_PUBLIC_` is ONLY for deliberately public configuration (e.g. Supabase URL and Publishable key). A **Supabase publishable key is browser-safe only with robust RLS and grants**; Supabase **secret** key and legacy `service_role` bypass RLS and must be server-only.
- Do not expose secret keys through Next.js Client Components, JSON endpoints, bundles, hydration props, `sourceMappingURL`, logs, errors, analytics, test snapshots or screenshots. Include secret scanning in CI and code reviews.
- If any secret leaks: STOP; notify owner **without quoting the value**, revoke/rotate it, review logs and access, invalidate affected credentials, and record sanitized incident details. Merely deleting a Git commit is not enough.
- Never use a broad privileged key for normal browser/user requests; separate service credentials for background jobs only with minimal access.

### Authorization and data protection
- Supabase Auth email/password; no public self-signup; MFA for Creator/Manager before launch, secure recovery, login rate limiting.
- Default-deny RLS, table privileges and Storage policies; verify resource ownership at DB and server; all admin actions require server authorization. Never infer authorization solely from a hidden button, a user-supplied role or request body.
- Test anonymous access, Technician A attempting Technician B's IDs/storage paths, customer-service role, Manager privilege escalation and Creator controls.
- Protect session cookies, CSRF/origin validation, rate limits, replay protection, uploads, file-type validation, signed file URLs, export endpoints and administrative APIs.
- Keep customer records and media out of logs, analytics, debug screens, PR Preview public pages and client hydration state.
- Distinguish Vercel preview app access from public website visibility; protect private Preview and disable all sensitive dev controls outside properly gated development.
- PWA offline data holds PII; cache minimum necessary; make logout/phone-loss cleanup policy explicit. Never erase unsynced records automatically.

### Process controls
- No production migrations, secrets changes, real emails, company calendars, new paid providers, permission changes or destructive actions without explicit approval.
- Automated tests: build/lint/typecheck, RLS negative tests, authorization checks, data input validation, dependency review, secret scanning and at least one end-to-end visit path.
- Before pilot: security review by an independent qualified person, backup and **restoration** testing for BOTH DB and Storage, incident-response checklist and minimal privacy/retention policy.
- Review `docs/security.md` before all authentication, RLS, media, email, XLSX, offline, or external-integration changes.

## 8. Offline Option 2: required detailed behavior
- Download only the authenticated technician's assigned visit data needed for field work while online.
- Cache the app shell (Service Worker) and locally needed visit state/media (IndexedDB or equivalent audited durable browser storage).
- Support offline arrival, summary, images/video within limits, audio recording, signature and pending closure; display **Saved on device / Pending sync / Syncing / Synced / Failed** in Hebrew.
- Use stable client-generated operation identifiers and server idempotency so retries cannot produce extra visits, closure actions or email notices.
- On reconnect, reconcile server version/visit state; detect conflicts (e.g. office cancellation while technician offline) and **do not silently overwrite**.
- Upload required media and summary before marking server closure complete; voice transcription may remain pending and needs approved flow.
- Sync while app is active; manual retry must be available. iOS PWA background sync is not guaranteed.
- Never declare server sync succeeded until the server confirms persistence and required assets; never destroy pending local data on logout or storage cleanup without a user-safe recovery strategy.

## 9. Email, transcription, Outlook and Excel sequencing
**Email:** server transaction captures visit close + enqueue outbox record; background sender performs guarded retries and tracks `pending/sent/failed`, deduplicated by logical close event. Recipients Manager + Customer Service. Live sender/domain still OPEN. Do not claim real email delivery from mock adapters.

**Voice-to-text:** approve Hebrew transcription vendor with privacy, geography and processing costs. Technician may edit and must approve transcript as their official treatment summary. Define waiting/approval UX for offline voice-only closures before coding the final close flow. Do not send misleading/incomplete summary emails.

**Outlook:** mock create/update/delete for now. Future Graph webhook (not periodic five-minute polling), renew subscriptions, handle missed notifications; permission scope and personal-vs-shared calendar decision depend on company IT. Validate exact Hebrew invitation labels and record malformed invitations visibly.

**Excel:** export accessible filtered data and text-only treatment summary, omit raw media and their file links unless separately approved, guard against spreadsheet formula injection, use correct Hebrew/date formatting. No ONE field mapping.

## 10. End-user manuals — must grow with the product
Create and maintain:
- `docs/user-guides/technician-guide.md`
- `docs/user-guides/customer-service-guide.md`
- `docs/user-guides/manager-guide.md`
- actual scrubbed screenshots under `docs/user-guides/images/`

All guide prose in Hebrew. After a functional screen is built and tested: screenshot it with fictitious data, explain the actions in numbered steps, mention errors and offline states where relevant, and update the corresponding guide. Do not document mock-only functionality as real. Plan exportable PDF manuals before launch.

## 11. Full development journey (explain each step in Hebrew)
| Step | Goal | Owner-visible acceptance evidence |
|---|---|---|
| **0 — Foundation** | Repo audit; scaffold Next.js, strict TypeScript, Tailwind, RTL/PWA tokens; dev-only gated showcase; protected Vercel Preview | Preview resembles demo; build/lint/typecheck pass; no real data or secrets |
| **1 — Schema and RLS** | Approve ERD, constraints, dev migrations, private Storage and RLS | Test users cannot access each other's visits |
| **2 — Auth and roles** | Email/password, managed invitations, Creator/Manager permission boundaries, MFA planning | Four fake roles, no public signup, role tests |
| **3 — Technician UI** | Today view, visit card, schedule, pickup list, faithful mobile UI | Phone preview, Hebrew technician guide |
| **4 — Visit workflow/offline** | Waze and arrival, documentation/media, signatures, safe closure, local queue/reconnect/conflicts, transcription placeholders | Test online/offline on real phone; no duplicates; summary flow approved |
| **5 — Office UI** | Read-only calendar, calls/clients, visit timeline, correction workflow | Manager/CS access tests and screenshots |
| **6 — Mock calendar ingestion** | Simulated invite create/update/delete, Hebrew parser, invalid invites | Replay event does not duplicate visit |
| **7 — Mail & notifications** | Transactional outbox, mock delivery and optional approved provider, in-app notifications | Both recipients simulated once, failure/retry tests |
| **8 — XLSX** | Authorized filtered text-only exports | Opens Hebrew, no media or secret/customer overreach |
| **9 — Dashboard** | KPI, technician/product/brand/supplier analyses | KPI consistency checks, matching demo |
| **10 — Settings/hardening** | Admin settings, user management, correction audit, security negative tests | Access matrix and audit tests |
| **11 — Pilot/launch** | End-to-end pilot, device tests, backup+restore, independent security check, final manuals | Owner/company approval before production data or deployment |

Prefer one early *vertical-slice* acceptance path: mocked invite → assigned visit → technician actions → offline sync → validated server close → mocked email → office sees update. Do not wait until every dashboard is complete before testing end-to-end.

## 12. Immediate next action: Step 0, planning only
**No verified coding work has been completed in the material provided here.** Inspect repository state rather than assuming it is empty or already set up.

1. Confirm the private repository contains the unzipped starter-pack file tree and the intact `docs/demo.html`.
2. Read operative docs in section 1 and note discrepancies; do not treat an older PDF/spec-v1 as current scope.
3. Inspect existing GitHub branch, Vercel/Supabase connections **read-only**. Do not expose cloud credentials or inspect secret values.
4. Draft a **Step 0-only plan**, written to the owner **in Hebrew**: proposed code structure, dependencies, visual tokens, Preview access controls, files changed, costs, tests, and acceptance checklist.
5. Explicitly state **no Supabase migrations, no live Microsoft, no real emails, no customer data, no production deployment and no ERP scaffolding** in Step 0.
6. Ask for explicit approval. **DO NOT yet write code, install packages, deploy, change resources or merge.**
7. Once approved, implement Step 0 in branch, show private Preview, compare to original design, update English WORKLOG and Hebrew guides only for completed screens; wait for owner review before next step.

Suggested initial prompt to the Claude Code agent:
> Read `PROJECT-HANDOFF.md` and `CLAUDE.md`, then the approved decisions, specification, original HTML demo, security, schema, roadmap and thinking-ahead documents. Audit this repository and produce a Step 0 implementation plan ONLY. Address me entirely in clear Hebrew. Keep all engineering artifacts in English and the app/user guides in Hebrew RTL. Do not implement, deploy, connect services, change credentials or migrate databases until I explicitly approve. Prioritize protecting API secrets, preserving demo fidelity, and respecting the absolute prohibition on ONE integration.

## 13. Outstanding decisions and exact approval gates
- **Before Step 1:** Confirm customer number mandatory, warranty optional; approve ERD/relationship constraints and role matrix.
- **Before Steps 2/11:** MFA enrollment/recovery, admin invitation and dormant-account policy.
- **Before Step 4:** Exact photo/video/audio sizes, consent and privacy, local PII clean-up, offline conflict behavior, voice-only completion and transcript approval.
- **Before Step 7:** Email vendor, authenticated sending domain, Manager/CS mailbox addresses, recipient failures and service provider cost.
- **Before transcription service launch:** Hebrew accuracy benchmark, external processing/privacy agreement, data jurisdiction, usage cost and deletion policy for original audio.
- **Before Step 8:** Exact XLSX tabs/columns/filter/export permissions.
- **Before real Microsoft integration:** Company 365 availability, IT approval, personal vs shared Outlook calendar, Graph subscriptions and missing-event reconciliation.
- **Before pilot:** Business/legal retention periods for DB, photos, videos, raw audio, transcripts and signatures; data-subject access/deletion handling; backup/restore and formal security assessment.

## 14. Reference map and source precedence
- `CLAUDE.md` — operative agent rules.
- `docs/decisions.md` — approved decisions and still-open entries.
- `docs/spec.md` — updated functional specification.
- `docs/demo.html` — original demo, visual and interaction reference, not an authorization model.
- `docs/database-schema.md` — proposed DB schema, to approve before migration.
- `docs/security.md` — detailed security controls.
- `docs/architecture.md` — architecture layers and cloud services.
- `docs/integrations.md` — calendar event adapter, email, XLSX and transcription boundaries.
- `docs/design-system.md` — demo tokens/components.
- `docs/outlook-template.md` — Hebrew event field names and validation.
- `docs/ROADMAP.md` — phases, beginner checklist and completion criteria.
- `docs/THINKING-AHEAD.md` — risk register, NOT implementation permission.
- `docs/testing.md`, `docs/deployment.md` — quality gates and cloud release process.
- `docs/WORKLOG.md` — actual work performed; do not fabricate entries.
- `prompts/STEP-0-PLAN.md` — a separate first-message prompt.
- Earlier Hebrew spec-v2 and comparison, old PDF plan: source history only; superseded wherever owner decisions differ.

### Anti-drift rule
At the end of each approved task, compare implementation with this handoff, `docs/decisions.md`, security rules and the HTML demo. Record actual results, unresolved defects and owner-approved deviations. If documents conflict, **ask in Hebrew** and do not choose silently.

**Handoff ends here. Start with a Hebrew Step 0 plan; do not execute it until approval.**
