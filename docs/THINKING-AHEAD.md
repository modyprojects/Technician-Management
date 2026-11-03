# Thinking Ahead — decisions, risks, and product evolution

A **risk register**, not authorization to implement anything beyond the approved step. Revisit after every step. Explain proposed changes to the owner in Hebrew; keep this document in English. Updated 2026-11-03.

## Highest-risk open questions
| Priority | Topic | Why it matters | Suggested direction | When |
|---|---|---|---|---|
| P0 | Microsoft 365 rollout date and where the service calendar runs today | Real use starts only after Microsoft 365 (D23); the pilot date depends on it | Ask IT now (owner task O1) | Before Step 6 |
| P0 | Offline closure vs. office cancellation | Office cancels while technician is offline | Server version check, conflict screen, never silently overwrite | Before Step 4 |
| P0 | Voice-only completion and transcript approval | Prevents misleading summaries | Pending until the technician approves text; typed fallback | Before Step 4 |
| P0 | Offline PII retention and lost-phone process | Photos and signatures on phones | Minimal data, re-auth, cleanup after verified sync; read-only cache retention per D46 (final durations: open decision 12) | Before real use |
| P1 | ~~Permission matrix fixed or editable~~ — resolved 2026-11-03 (D33) | Security complexity | Editable in Settings, only by the Creator, through a Creator-only audited server function; enforced in the database (RLS, grants, server functions) and on the server, never only in the UI; screen keys never bypass data authorization | Resolved |
| P1 | Temporary permission-matrix values (D51) | Testing runs on the demo defaults; unreviewed values could reach the pilot | Values carry the status `temporary` in the database and the Settings screen; the owner approves final values in Step 10; pre-pilot gate blocks real users until then | Step 10, before the pilot |
| P1 | Test data leaking into real reports | Simulator writes to the same tables | Test-data marker on every record (D47); labeled "נתוני בדיקה" in test environments, ignored in production; never real email. Before go-live an explicitly approved cleanup or environment-separation plan and a pre-launch acceptance checklist (D47); technical recommendation: a separate Supabase project from go-live, only with the owner's explicit approval (D30; D31: shared development project until then) | Step 1 schema |
| P1 | Work that exists only on the device is lost before sync (D46) | Device loss or damage, browser storage eviction, app removal or cleared browser data before sync lose unsynced work; no recovery is possible or promised | Work queue kept until the server confirms receipt and integrity; early sync, prominent pending-data warnings, minimal personal data on the device; document the risk in the Hebrew technician guide | Step 4 |
| P1 | Deactivated account with pending offline work (D46, open decision 25) | A deactivated account cannot sync; its pending work stays on the device with a warning and may never reach the server | Decide a recovery path. Recorded recommendation (not approved): a short quarantine-only upload mode with no data reads; full block for a lost device | Step 4 |
| P1 | Initial credentials without an email provider (D34, D50, open decision 9) | Managers never set passwords or emails, and Supabase's built-in email service sends only to members of the organization's team, so until an email provider is approved only the Creator can issue initial credentials for every new account, including Technicians created by a Manager | Decide in the Step 2 plan: Creator-issued initial credentials, or emailed invitations through an approved email provider (a "real emails" stop gate and a new service under D30) | Step 2 |
| P1 | Email provider, sender domain, recipients | Real delivery | Mock until approved | Before Step 7 |
| P1 | Speech vendor, privacy, budget | Voice is personal data | Hebrew benchmark, DPA, retention | Before transcription goes live |
| P1 | Media byte limits | Offline uploads and cost | Test real phone media | Before Step 4 |
| P1 | Technician devices: phones and tablets (kosher / no camera) (D27) | App needs camera and microphone | Map devices; work phones or tablets where needed (O5) | Before Step 4 |
| P1 | Real-device testing comes late (D28) | Touch comfort, PWA install, camera and offline behaviour can differ from desktop device mode | Decide which step first needs real phones and tablets, and who tests while only the owner may open the Preview (D29) | Before Step 3 |
| P1 | Production is a test environment until go-live (D31) | Fictitious data, `/dev` and the development database are reachable at the Production address; the simulator (D24, off in production) and test-data exclusion in production reports (SIM-08) assume the opposite | Complete the go-live gate in `docs/deployment.md`; decide simulator and dashboard behaviour for the testing-period Production before Step 6 (open decision 21) | Before Step 6 and before go-live |
| P2 | Commits show as "Unverified" on GitHub (open decision 24) | Commits are authored with the owner's account (D30) but signed by the Claude Code environment's key | Find verified, transparent signing that keeps Claude's co-authorship visible; never move the owner's private key into an environment | Before go-live |
| P2 | Free plans only (D30): GitHub Free, Vercel Hobby, and the existing Supabase project `Technician-Management` (about $10/month, owner-approved, d36) | Free-plan limits (Vercel Hobby, GitHub Free: no branch protection, no push protection) shape the controls | Stop and tell the owner when something needs a paid plan; review hosting plans if the app is ever used commercially | Ongoing |
| P2 | Supabase organization is a shared company/department account (D50, planning assumption) | Its setup, members, plan and billing are managed by the department and not verified by us; organization members with sufficient roles can see the project and run SQL, and owner-level access is outside the application's controls (for example audit immutability) | Accepted planning assumption, not a security verification; keep flagging to the owner any change that creates charges or materially increases security risk; the hash-chained audit in the Step 1 plan makes owner-level changes detectable, not preventable | Ongoing |
| P2 | Creator as a bottleneck for Customer Service onboarding (D34) | Every Manager-initiated Customer Service creation, activation, reactivation and role change waits for the Creator; requests never expire automatically (D25) | Accepted trade-off that closes the privilege-escalation path through Customer Service accounts; Creator approvals view in Step 2; Manager deactivation stays immediate; revisit if onboarding is delayed | Step 2 |
| P2 | Brand and supplier left empty | Supplier analysis stays empty (D19) | Assign someone to fill them | Before Step 9 |
| P2 | Excel columns | Usability, privacy | Text only | Before Step 8 |

Resolved since the last version (2026-11-03): permission matrix editable, only by the Creator, enforced in the database and on the server (D33); account administration with Creator approval (D34); Supabase organization and invitation-only access (D50, planning assumption). Earlier: customer number required, warranty optional (D17); product source (D19); simulator scope (D24).

## Architecture guardrails
- One ingestion service for simulator and Graph; no separate logic per source.
- Stable operation IDs and server-confirmed completion for offline sync and the email outbox.
- Version and conflict behavior designed from the first schema.
- Cheap vendor isolation: email, calendar and transcription adapters. No ONE adapter (prohibited, not deferred).
- Audit admin corrections and product edits.
- Do not build dashboards or optional features before one full visit path works.

## First vertical slice
Simulated invitation → assigned visit → technician screens → arrival, media, summary, signature → offline pending and reconnect → server-confirmed completion → outbox event → mock email → office sees the update.

## Explicitly deferred
Live Microsoft 365 until available and approved; push; real transcription provider; live email provider; automatic retention purge; scheduled background jobs (D25); GPS; SMS/WhatsApp; native app stores. ERP integration is prohibited, not deferred. (Tablets are in the first release, D27.)
