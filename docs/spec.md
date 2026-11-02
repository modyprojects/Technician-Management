# Technician Management — functional specification

Last updated: 2026-11-01. Precedence: `docs/decisions.md` → `docs/demo-deviations.md` → `docs/demo.html`.

## Goal
A responsive PWA that replaces the technicians' WhatsApp group: technicians document and close service visits on their phones or tablets; the office follows status, history and analytics, mainly on desktop. Every screen for every role works on phone, tablet and desktop; no role is locked to a device (D27). Office scheduling stays in Outlook. The app reads invitations from the Microsoft 365 calendar (D18). **Real use starts only after Microsoft 365 is connected (D23); until then everything is testing with fictitious data**, using the Outlook invitation simulator (D24).

## Out of scope
- Creating or scheduling service calls inside the app (scheduling stays in Outlook).
- Any ONE ERP integration, preparation, export, field or format (D07).
- Push, SMS or WhatsApp notifications (D10).
- Scheduled background jobs in the first release (D25).
- GPS / vehicle tracking, customer satisfaction messages. (Tablets are in the first release, D27.)

## User roles
- **Technician**: sees only his assigned visits. Phone- and tablet-first, also usable on desktop (D27): schedule, pickup list, customer contact and navigation, arrival, before/after media, written or spoken summary, parts replaced, signature for resolved visits, follow-up reason and next-visit notes.
- **Customer Service**: all calls and customers; office screens; unparsed-invitations list; read-only calendar; in-app notifications; simulator in test environments (D24). Cancellation rights: OPEN (decisions.md open #5).
- **Manager**: everything Customer Service has, plus dashboard, product/supplier analysis, Excel export, user management for standard users, product editing, audited corrections, simulator in test environments.
- **Creator**: all rights, auditable; MFA required in production.
- Whether the permission matrix is fixed or editable: OPEN (open #1). Enforcement is always on the server and in RLS.

## Core data model
Customer → service call (request number) → visits (task number, technician, time). Products are built from invitations (D19). Keep separate: call business state, visit execution status, device sync state, transcription approval state, email delivery state. Every record created by the simulator is marked as test data (D24).

## Invitation intake
- Source: Microsoft 365 calendar invitations (future, Graph change notifications) or the simulator (now). Both go through **one ingestion service**.
- Recognized by subject prefix `[קריאת שירות]`.
- Technician = invitation attendee, matched by the technician's Outlook email in settings.
- Date and time come from the invitation itself, not the body.
- Body parsed by Hebrew labels (`docs/outlook-template.md`), not by line order.
- Required fields include customer number (D17). Warranty optional (D17).
- Missing required field or unknown pickup place → not ingested; listed on the "זימונים שלא נקלטו" screen with the missing field.
- Unknown SKU is **not** an error: product created per D19.
- Same calendar event ID → update the existing visit (reschedule, re-assign). New event with an existing request number → new visit on the same call.
- Event deleted → behavior OPEN (open #5).

## Visit lifecycle
שובצה (scheduled) → בדרך (Waze tapped; departure time recorded) → בטיפול (arrived; arrival time recorded) → טופל or המשך טיפול. Cancelled (בוטלה) only by the office.
- After-work photo or video required; written or recorded summary required.
- Parts replaced recorded with the summary.
- **טופל**: fixed Hebrew acknowledgement text, signer name and signature.
- **המשך טיפול**: reason from the list plus required notes on what the next visit needs.
- After server-confirmed closure the technician view is read-only (D14).

## Offline (D06, D20)
Cache only previously loaded assigned visits. Queue arrival, media, signature, summary and closure on the device; sync while the app is open, with manual retry. Show honest states: saved on device, pending, syncing, synced, failed. Never claim guaranteed background sync on iOS. Never delete unsynced data. Email only after server acceptance.

## Audio summary (D12)
Technician may record a Hebrew summary (max 180 s). Transcription is a goal; vendor and timing are open. A recording without an approved transcript is never sent as a summary. Original audio is never exported.

## Notifications (D10, D25)
In-app only, created by events: new visit, follow-up visit scheduled, visit changed, visit cancelled. No scheduled reminders in the first release.

## Completion email (D09, D22)
For both outcomes, to Manager and the customer-service mailbox, through a transactional outbox, after server acceptance and an approved summary. Content: status, request number, task number, customer number, visit number, customer, address, product and SKU, technician, result, follow-up reason, summary, parts, signer (for טופל), link to the call card. Media in email: OPEN (open #8). Simulated visits never send real email (D24).

## Office screens
| Screen | Content | Roles |
|---|---|---|
| Technician calendar | Read-only day/week/month from invitations, colored by status | CS, Manager, Creator |
| Calls and call card | Search and filter (incl. customer number), all visits with media, summary, signature, emails | CS, Manager, Creator |
| Customers and customer card | All calls of a customer; products that came back | CS, Manager, Creator |
| Unparsed invitations | Invitations not ingested and the missing field | CS, Manager, Creator |
| Back from field | Visits closed as המשך טיפול with reason; action is a new Outlook invitation | CS, Manager, Creator |
| Dashboard | Open calls, in progress now, back from field, late, first-visit fix rate, average time to close, technician performance | Manager, Creator |
| Products and suppliers | Issues by SKU, brand, supplier; products back within a short time. Empty brand/supplier shown as "לא הוזן" | Manager, Creator |
| Products | Edit product name, brand, supplier (D19) | Manager, Creator |
| Outlook invitation simulator | D24; test environments only | Manager, Creator, CS |
| Settings | Users, technicians, pickup places, follow-up reasons, fixed text, invitation template labels | Manager (standard users), Creator |

## Excel export (D11)
Authorized filtered rows, Hebrew, text only, no media or links, formula-injection safe. Columns OPEN (open #18).

## Devices and screen sizes (D27, D28)
- Every screen for every role works at ~390 px (phone), ~820 px (tablet) and ~1440 px (desktop), following the demo's container-query breakpoints: technician layout widens from 600 px; office sidebar becomes a top bar at 900 px and below; compact tables at 520 px and below.
- Technician screens are designed for phone and tablet first; above ~900 px they keep the tablet layout (content centred up to 760 px). Office screens are designed for desktop first and stay usable on tablet and phone.
- During development screens are reviewed in a desktop browser at the three sizes and from screenshots; real phone and tablet tests (touch, PWA install, camera, offline) come in later steps and before launch.

## Visual and language rules
`docs/demo.html` defines layout, colors, typography and flows, as amended by `docs/demo-deviations.md`. UI Hebrew RTL. Engineering docs English.
