# Thinking Ahead — decisions, risks, and product evolution

A **risk register**, not authorization to implement anything beyond the approved step. Revisit after every step. Explain proposed changes to the owner in Hebrew; keep this document in English. Updated 2026-10-26.

## Highest-risk open questions
| Priority | Topic | Why it matters | Suggested direction | When |
|---|---|---|---|---|
| P0 | Microsoft 365 rollout date and where the service calendar runs today | Real use starts only after Microsoft 365 (D23); the pilot date depends on it | Ask IT now (owner task O1) | Before Step 6 |
| P0 | Offline closure vs. office cancellation | Office cancels while technician is offline | Server version check, conflict screen, never silently overwrite | Before Step 4 |
| P0 | Voice-only completion and transcript approval | Prevents misleading summaries | Pending until the technician approves text; typed fallback | Before Step 4 |
| P0 | Offline PII retention and lost-phone process | Photos and signatures on phones | Minimal data, re-auth, cleanup after verified sync | Before real use |
| P1 | Permission matrix fixed or editable | Security complexity | Fixed in the first release; enforced in RLS either way | Before Step 1 |
| P1 | Test data leaking into real reports | Simulator writes to the same tables | Separate Supabase projects; test-data marker on every record; labeled "נתוני בדיקה" in test environments, ignored in production; never real email | Step 1 schema |
| P1 | Email provider, sender domain, recipients | Real delivery | Mock until approved | Before Step 7 |
| P1 | Speech vendor, privacy, budget | Voice is personal data | Hebrew benchmark, DPA, retention | Before transcription goes live |
| P1 | Media byte limits | Offline uploads and cost | Test real phone media | Before Step 4 |
| P1 | Technician phones (kosher / no camera) | App needs camera and microphone | Map devices; work phones where needed (O5) | Before Step 4 |
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
Live Microsoft 365 until available and approved; push; real transcription provider; live email provider; automatic retention purge; scheduled background jobs (D25); GPS; SMS/WhatsApp; native app stores; tablets. ERP integration is prohibited, not deferred.
