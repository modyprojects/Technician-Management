# Decision Register — approved product choices

Last updated: 2026-11-01. Source: owner decisions. Status is **APPROVED** unless marked OPEN or PROVISIONAL. Technical recommendations are not approved until the owner approves them.

The owner tracks decisions on a planning board. The **Board ref** column (`d01`, `d02`…) links each entry to that board and to references in `docs/demo-deviations.md`.

## Approved decisions

| ID | Decision | Status | Board ref |
|---|---|---|---|
| D01 | Interface and end-user documentation in Hebrew/RTL; engineering files and prompts in English; all advice and questions to the owner in Hebrew | APPROVED | |
| D02 | Reproduce the original `docs/demo.html` faithfully, **except where `docs/demo-deviations.md` says otherwise** (see D21) | APPROVED | |
| D03 | Cloud-first Claude Code, GitHub, Vercel, Supabase; connections already established | APPROVED | |
| D04 | Supabase Auth email/password, administrator-provisioned users, no public sign-up | APPROVED | |
| D05 | Creator and Manager create and administer users. Manager manages standard users only and cannot create or edit Creator-level access | APPROVED | |
| D06 | Partial offline (Option 2): cached assigned visits and local documentation; sync later with clear status | APPROVED | |
| D07 | No ONE ERP connection, no preparation for one, no ONE-specific export, schema, field or format | APPROVED | |
| D08 | Real calendar integration uses Microsoft Graph change notifications (event-driven), not polling | APPROVED | |
| D09 | Completion email to Manager AND the customer-service mailbox for every closed visit, both outcomes | APPROVED | |
| D10 | No push, SMS or WhatsApp notifications; in-app notifications only | APPROVED | |
| D11 | Authorized Excel exports with text summaries/transcripts; no photos, videos, recordings or media links | APPROVED | |
| D12 | Hebrew speech-to-text populates the treatment summary after technician review and approval. Vendor and close timing OPEN | APPROVED goal, design OPEN | |
| D13 | Image compression; video up to 60 s, audio up to 180 s; byte caps OPEN | PROVISIONAL | d07 |
| D14 | Technician cannot edit a server-closed visit; Manager/Creator make audited corrections preserving originals | APPROVED | |
| D15 | Three Hebrew user guides with real screenshots, maintained as the app grows | APPROVED | |
| D16 | Implementation only after a step plan and explicit owner approval | APPROVED | |
| D17 | **Customer number is required** in every invitation (customer service uses it). **Warranty is optional**; when empty the UI shows "לא צוין" | APPROVED 2026-10-25 | d01 |
| D18 | Service calls come from invitations in the technician's **Microsoft 365** calendar. Microsoft 365 is not yet available to the company; until it is, build the integration boundary and test with simulated invitations | APPROVED 2026-10-25 | d02 |
| D19 | **Products are built from invitations.** No initial product list and no import. Each invitation provides SKU and product name. Existing SKU → link to the existing product. New SKU → create the product automatically. Brand and supplier are optional and can be filled later. One product per SKU (database unique constraint). Before matching, trim spaces and upper-case the SKU. A later invitation with a different name never overwrites an existing product name. Only authorized roles edit product details | APPROVED 2026-10-26 | d03, d25, d27 |
| D20 | Offline support and Hebrew transcription are part of the first release. Within Step 4, build the online flow first, then offline, in the same release | APPROVED 2026-10-25 | d16 |
| D21 | `docs/demo-deviations.md` defines where production differs from the demo. Precedence: `decisions.md` → `demo-deviations.md` → `demo.html`. A conflict not covered there: stop and ask the owner | APPROVED 2026-10-26 | d18 |
| D22 | The completion email shows request number, task number, customer number, visit number, result, follow-up reason, summary and parts, for normal business use. No link to, mapping for, or format of any external system | APPROVED 2026-10-26 | d22 |
| D23 | **Real use of the app starts only after Microsoft 365 is connected.** Until then all use is testing with fictitious data | APPROVED 2026-10-26 | d28 |
| D24 | **Outlook invitation simulator** (amended 2026-10-26) (testing feature): create, update, reschedule, re-assign, cancel, duplicate and invalid simulated invitations. Uses the same ingestion service as the future Graph adapter. Records are persisted and marked as test data. In test environments dashboards, reports and exports include test data labeled "נתוני בדיקה"; in production test-marked records are never counted, reported or exported; simulated visits never send real email. Every visit shows its source ("🧪 זימון בדיקה" or "📅 נקלט אוטומטית מזימון Outlook"). Available to Manager, Creator and Customer Service; not to technicians. Switched on/off **only** by an environment setting: on in development and Preview, off in production, no UI toggle. Never in production without separate approval. Disabled after Microsoft 365 is connected without changing records or architecture; code not deleted automatically | APPROVED 2026-10-26 | d28, d29, d30 |
| D25 | No scheduled background jobs in the first release (for example no 07:00 pickup reminder). The pickup list on the technician home screen covers the need. Notifications are created by events only | APPROVED 2026-10-26 | |
| D26 | The roadmap (`docs/ROADMAP.md`) stays as planned; changes are made step by step, not wholesale | APPROVED 2026-10-25 | d17 |
| D27 | **Responsive from the start.** Every screen for every role works at phone (~390 px), tablet (~820 px) and desktop (~1440 px) in the first release. The technician interface is designed primarily for phone and tablet (field devices); desktop is the main device for office, customer service and managers; office screens are also usable on tablet and phone, and technician screens on desktop. No role is locked to a device. Follow the demo's breakpoints and container-query behavior (technician layout widens on tablet; office sidebar collapses below ~900 px). Above ~900 px the technician layout continues the tablet layout: full-width header and bottom navigation, content centred up to 760 px (owner answer 2026-11-01). Replaces "tablets (future)" in `docs/spec.md` and "tablets" in the deferred list of `docs/THINKING-AHEAD.md` | APPROVED 2026-10-26 | d33 |
| D28 | During development the owner works from a desktop computer only and reviews screens in the browser at 390 / 820 / 1440 px and from screenshots. Testing on real phones and tablets (comfort, touch, PWA install, camera, offline) happens in later steps and before launch, not as a blocker now | APPROVED 2026-10-26 | d34 |
| D29 | Only the owner views the Preview during the testing period. More users are set up only after Microsoft 365 is connected and the owner decides to go live | APPROVED 2026-10-26 | d32 |
| D30 | **Personal, non-commercial project on free plans only.** The app is the owner's personal project, not a project of any company. Hosting stays on free plans: GitHub Free (repository `modyprojects/Technician-Management`), Vercel Hobby (team `mody-projects`, project `technician-management`) and the existing Supabase project `Technician-Management` (about $10/month, approved by the owner, board ref d36). No new projects, accounts or services; no upgrades, purchases, paid add-ons or any action that can create a charge. If something needs a paid plan, stop and tell the owner; do not work around it. The hosting plans must be reviewed if the app is ever used commercially. **Commit identity** (owner answer 2026-11-01): because Vercel Hobby deploys only commits authored by the team owner, commits are authored with the owner's GitHub account (he directs and approves every change), every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`, and every PR description states that the code was written by Claude Code under the owner's direction. If a deployment is still blocked: stop and report; no other identities, tokens or deployment paths | APPROVED 2026-11-01 | d35, d36 |
| D31 | **Protected Production as the owner's fixed viewing address.** During development the Vercel Production deployment of `technician-management` is the owner's fixed address for approved versions; feature branches and Preview deployments are work in progress. Production changes only by merging to `main`, and only after the owner explicitly approves that specific merge, with a Hebrew summary of the changes and test results beforehand. Never push directly to `main`. Before the first deployment of any kind and after every Production deployment: Vercel Authentication covers All Deployments, the owner is the only team member, there are no shareable links, protection-bypass secrets or access exceptions, and an anonymous request is blocked (401 or redirect to the Vercel login, never 200). Until go-live the Production environment is a testing environment with fictitious data only: `/dev` may be served there behind Vercel Authentication, and the go-live gate in `docs/deployment.md` must be completed before any real use (D23). **Known deviation from `docs/deployment.md`:** in later steps Vercel's Production environment will point to the development Supabase project; revisit at go-live | APPROVED 2026-11-01 | d37 |

## Open decisions — do not guess

| # | Question | Needed before | Board ref |
|---|---|---|---|
| 1 | Is the permission matrix fixed per role, or editable by Creator/Manager? Either way every permission is enforced on the server and in RLS | Step 1 | d04 |
| 2 | Does the technician see his own departure/arrival/end times? | Step 3 | d05 |
| 3 | Voice-only visit: pending transcript approval before server close and email? (recommended: yes) | Step 4 | d06 |
| 4 | Final photo/video/audio byte caps and counts | Step 4 | d07 |
| 5 | Cancellation: in Outlook, in the app, or both; who may cancel; what deleting an invitation does to the visit; conflict with an offline technician closure | Step 5 | d08 |
| 6 | Email to the handling rep when an invitation cannot be ingested | Step 6 | d09 |
| 7 | Completion email: Manager = one account or all active Managers; is the handling rep also a recipient | Step 7 | d10 |
| 8 | Media in the completion email (recommended: link to the call card only) | Step 7 | d11 |
| 9 | Email provider and verified sender domain | Step 7 | d12 |
| 10 | Usage-metrics screen (logins, click tracking): build or not | Step 10 | d13 |
| 11 | Transcription vendor, privacy, region, budget, raw-audio retention | Before transcription goes live | d14 |
| 12 | Data retention for database, media, transcripts, signatures and device cache | Pilot | d15 |
| 13 | Microsoft 365 rollout date; what happens if it slips | Step 6 | d19 |
| 14 | Where the service calendar runs today; personal vs. shared calendar; IT approval for read access | Step 6 | d20, d21 |
| 15 | Spec v2 screens missing from the demo (unparsed invitations, back from field, customers, parts, next-visit notes, extra KPIs): confirm all in the first release | Step 3 | d23 |
| 16 | Work phones or tablets for technicians without a suitable device (D27) | Step 4 | d24 |
| 17 | Where the technician's "report a problem" button sends the report | Step 3 | d26 |
| 18 | Final Excel columns and date format | Step 8 | |
| 19 | MFA enrollment and admin account recovery | Step 2 / pilot | |
| 20 | Final dashboard KPIs for Manager and Creator, with exact definitions (for example what counts as "late" or "fixed on first visit"). Starting point: the demo dashboard and the spec v2 list. The Step 1 schema must store the raw data any of these KPIs needs | Step 9 (raw data: Step 1) | d31 |
| 21 | Testing-period Production (D31) vs. D24, SIM-08 and SIM-11: is the simulator on or off at the Production address until go-live, and are test-marked records shown there with the "נתוני בדיקה" label? | Step 6 | d37 |
| 22 | ~~TE-32 fixed bottom navigation~~ — resolved 2026-11-02: approved by the owner, recorded in `docs/demo-deviations.md` TE-32 | Resolved | |
| 23 | ~~First Vercel deployment~~ — resolved 2026-11-02 (owner): two pushes to the feature branch with a read-only check after each; stop and report if the deployment does not behave as expected. No Production deployment and no merge to `main` without a separate owner approval. Recorded in `docs/deployment.md` | Resolved | d37 |
| 24 | Verified, transparent commit signing. Commits are authored with the owner's GitHub account (D30) but signed by the Claude Code environment's key, so GitHub shows them as "Unverified". Find a way to get verified signatures while keeping Claude's co-authorship visible, without moving the owner's private signing key into any environment | Before go-live | d35 |

## Rules

Only a new explicit owner decision changes an APPROVED item. Date every change. Never silently upgrade OPEN or PROVISIONAL to APPROVED.
