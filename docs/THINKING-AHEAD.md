# Thinking Ahead — decisions, risks, and product evolution

A **risk register**, not authorization to implement anything beyond the approved step. Revisit after every step. Explain proposed changes to the owner in Hebrew; keep this document in English. Updated 2026-11-01.

## Highest-risk open questions
| Priority | Topic | Why it matters | Suggested direction | When |
|---|---|---|---|---|
| P0 | Microsoft 365 rollout date and where the service calendar runs today | Real use starts only after Microsoft 365 (D23); the pilot date depends on it | Ask IT now (owner task O1) | Before Step 6 |
| P0 | Offline closure vs. office cancellation | Office cancels while technician is offline | Server version check, conflict screen, never silently overwrite | Before Step 4 |
| P0 | Voice-only completion and transcript approval | Prevents misleading summaries | Pending until the technician approves text; typed fallback | Before Step 4 |
| P0 | Offline PII retention and lost-phone process | Photos and signatures on phones | Minimal data, re-auth, cleanup after verified sync | Before real use |
| P1 | Permission matrix fixed or editable | Security complexity | Fixed in the first release; enforced in RLS either way | Before Step 1 |
| P1 | Test data leaking into real reports | Simulator writes to the same tables | Separate Supabase projects from go-live (D31: shared development project until then); test-data marker on every record; labeled "נתוני בדיקה" in test environments, ignored in production; never real email | Step 1 schema |
| P1 | Email provider, sender domain, recipients | Real delivery | Mock until approved | Before Step 7 |
| P1 | Speech vendor, privacy, budget | Voice is personal data | Hebrew benchmark, DPA, retention | Before transcription goes live |
| P1 | Media byte limits | Offline uploads and cost | Test real phone media | Before Step 4 |
| P1 | Technician devices: phones and tablets (kosher / no camera) (D27) | App needs camera and microphone | Map devices; work phones or tablets where needed (O5) | Before Step 4 |
| P1 | Real-device testing comes late (D28) | Touch comfort, PWA install, camera and offline behaviour can differ from desktop device mode | Decide which step first needs real phones and tablets, and who tests while only the owner may open the Preview (D29) | Before Step 3 |
| P1 | Production is a test environment until go-live (D31) | Fictitious data, `/dev` and the development database are reachable at the Production address; the simulator (D24, off in production) and test-data exclusion in production reports (SIM-08) assume the opposite | Complete the go-live gate in `docs/deployment.md`; decide simulator and dashboard behaviour for the testing-period Production before Step 6 (open decision 21) | Before Step 6 and before go-live |
| P2 | Commits show as "Unverified" on GitHub (open decision 24) | Commits are authored with the owner's account (D30) but signed by the Claude Code environment's key | Find verified, transparent signing that keeps Claude's co-authorship visible; never move the owner's private key into an environment | Before go-live |
| P2 | Free plans only (D30): GitHub Free, Vercel Hobby, and the existing Supabase project `Technician-Management` (about $10/month, owner-approved, d36) | Free-plan limits (Vercel Hobby, GitHub Free: no branch protection, no push protection) shape the controls | Stop and tell the owner when something needs a paid plan; review hosting plans if the app is ever used commercially | Ongoing |
| P2 | Brand and supplier left empty | Supplier analysis stays empty (D19) | Assign someone to fill them | Before Step 9 |
| P2 | Excel columns | Usability, privacy | Text only | Before Step 8 |

Resolved since the last version: customer number required, warranty optional (D17); product source (D19); simulator scope (D24).

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
