# QA corrections 01 — roadmap integration (D60)

**Status:** APPROVED plan (owner, 2026-11-12, D60). Planning only: nothing here is implemented yet.

**Sources:**
- `docs/design/qa-corrections-01.md`, "קובץ תיקונים 01" (owner-approved 09.11.2026). It is added by PR #28; merge PR #28 before this document's PR.
- The owner's development message of 2026-11-12.
- `docs/decisions.md` D60.

**Precedence:** D60 and this document override `docs/demo.html` and `docs/demo-deviations.md` where they differ (`docs/demo-deviations.md` § "QA corrections 01").

**Rules:**
- Each correction is built into the real screen in the step where that screen is built. Corrections are not built first in the demo.
- The MODY design is preserved. Only the elements the QA document names change.
- Demo behaviour never counts as implemented.

## 1. Baseline (verified 2026-11-12)

**Status words:**
- **Implemented:** built and tested in the real code.
- **Demo only:** fictional data under `/dev/demo`, with no backend.
- **Partial:** some infrastructure exists, for example tables or functions.
- **Missing:** nothing exists.

**What exists today:**
- **Screens:** every application screen exists only in the demo.
- **Migration 1 (applied):** profiles, technicians, the permission matrix, the D34 account requests and the audit trail.
- **Migration 2 (applied):**
  - call types, continuation reasons, pickup places, customers and products;
  - the Settings RPCs, gated by `settings`.
- **Migration 3 (prepared, PR #25):** service calls with their own status (D38) and visits.
  - Visit statuses: `scheduled`, `en_route`, `in_progress`, `done`, `followup` and an internal `cancelled`.
  - `request_number`.
  - `visit_time_reports` (`departed`, `arrived`, `ended`, `signed`).
  - The treatment summary.
  - The signature with the exact signed text and its sha256.
  - The follow-up reason and next-visit notes.
  - The status history.
- **Missing from the database, planned for Step 4:** parts, media (including the signature image), the approval-text versions (`ack_text_versions`, D43) and transcripts.
- **Authentication:** foundations only (PR 2.1). There is no sign-in or user administration screen yet.
- **Telemetry:** none.
- **Visit-completion bug (QA chapter 1 §2):** reproduced in the demo.

The QA corrections need **no change to Migrations 1–3**.

## 2. Requirement mapping

The "Step" column uses the ROADMAP step numbers, in the development order 1 → 2 → 6 → 3 → 4 → 5 → 7 → 8 → 9 → 10 → 11. Two items are new:
- **M5:** the accounts-and-permissions migration.
- **Step 12:** after the pilot.

### 2.1 Technician (QA chapter 1)

| ID | QA § | Requirement | Status | Work | Step | Acceptance and tests |
|---|---|---|---|---|---|---|
| T-01 | 1 | Sync notice: the pending and failed counts; "סנכרן עכשיו"; missing internet named only when it is the confirmed cause; hidden once everything is synced | Demo only | FE banner on the home screen. Offline queue that classifies network vs server failures. Offline operations (Migration 4) | 4 | Counts match the queue. A disconnect shows the "עקב חוסר חיבור" wording; a server error shows the generic wording. **Tests:** e2e for disconnect, failure and reconnect; unit test of the cause mapping |
| T-02 | 2 | **Bug.** A completed visit stays active and "הושלמו" stays 0. Both "טופל" and "המשך טיפול" move the visit to "הושלמו היום"; the completed and remaining counters and the next visit update; a message appears when no visits remain | Demo (bug reproduced) | The home screen is derived from server data and the offline queue, with no separate local state. The server close function | 3 (view), 4 (close) | **e2e** for both outcomes (counters, lists, next visit) and for the empty day |
| T-03 | 2 | "המשך טיפול" completes the visit; the service call stays open | Partial (D38 in Migration 3) | Labels. `recalc_call_status` already exists | 3–5 | Existing pgTAP for D38. **e2e:** a follow-up call stays open |
| T-04 | 3 | Five statuses with text and colour in the daily, weekly and monthly views, updated immediately; completed and follow-up visits stay in the calendar history | Partial (values in Migration 3, pills in the demo) | **One** status → label/colour map for every interface. "בוטלה" is never shown (D60 (1)) | 3 (technician), 5 (office) | Unit test of the map. **e2e** in all three views at 390/820/1440. A cancelled visit does not appear |
| T-05 | 4 | Completion email to Shirel and Rotem for both outcomes. Content: מס׳ פנייה, customer, visit, technician, status, outcome, summary; for a follow-up also the reason and actions. No duplicates | Demo only (mock outbox) | Outbox with a unique key per event; mock adapter; recipients configurable. Real sending after Microsoft 365 | 7 (mock), 11 (real) | One event gives exactly two messages, also on retry. No email for test data. Content as listed |
| T-06 | 5 | Pencil-like icon next to customers and visits: find its meaning; remove it if it has no clear function | Demo only | In the demo ✎ marks "has a treatment summary" in the technician dashboard table. Confirm against the owner's screenshot which screen showed it | 3, 9 | An icon without a function is removed; an icon with a function becomes a consistent, explained symbol (`title`/`aria-label`) |
| T-07 | 6 | "מה לאסוף לפני יציאה" stays in place and is hidden when there are no items | Demo only | FE | 3 | **e2e:** a day with items and a day without |
| T-08 | 7 | Status and documentation appear on the home screen, technician calendar, call card, office calendars and dashboard. Media and the signature follow permissions. A follow-up visit links to the original call. No automatic change to the Outlook appointment | Partial (one data source in Migration 3; screens missing) | All screens read through the data-access layer (Supabase adapter), with no parallel copies. Ingestion links follow-up visits by מס׳ פנייה | 3–6 | Integration test: one status change is visible on every screen. No duplicate call (`request_number` is unique). No write to Graph |
| T-09 | 8 | Completion: mandatory fields, with a clear list of what is missing; save confirmation; no duplicate submission; the existing confirmation screen with "חזרה להיום" and no automatic navigation; offline, local save distinguished from server save | Demo (partial) | Zod validation; the button is locked while sending. Idempotent close keyed by `operation_id`. Offline queue | 4 | **e2e:** a double click gives one close; a missing field shows a message; offline shows "נשמר במכשיר, ממתין לסנכרון" |
| T-10 | Checks and decision | The supplementary checks and the kept confirmation screen | — | Become acceptance criteria | 3–4 | The document's check list becomes e2e tests at 390/820/1440 |

### 2.2 Customer Service (QA chapter 2)

| ID | QA § | Requirement | Status | Work | Step | Acceptance and tests |
|---|---|---|---|---|---|---|
| S-01 | 1 | "בית" removed; the default screen is "קריאות" | Demo only | Navigation; the role landing (`features/auth/redirects.ts`) | 2 (landing), 5 | **e2e:** Customer Service lands on "קריאות"; no link to "בית" |
| S-02 | 2 | Technician calendar: field status without double entry, as text and colour; **מס׳ פנייה on the visit card**; consistent in the three views | Demo only | Office calendar on real data, with the T-04 map and the "מס׳ פנייה" label | 5 (number from Step 6) | **e2e.** A scan finds no "ONE" in names, labels or schema |
| S-03 | 3 | "קריאות" and the call card update; the signature shows when present; call status separate from visit status; follow-up as T-03 | Partial (database) | FE; the signature image comes in Step 4 | 5 | **e2e.** RLS: the signature is visible only with `card` |
| S-04 | 4 | "לקוחות" and "חזרו מהשטח" removed from navigation; customer details stay reachable through the call card; no data deleted | Demo only | The standalone screens are not built for any role (with D57 (1)); ports and data stay | 5 | **e2e:** Customer Service navigation has 3 items; customer details are on the call card |
| S-05 | 5 | Navigation: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו". An unparsed invitation shows the reason and the information needed to fix it. Any access still needed moves to a relevant screen | Demo only | Ingestion stores a structured failure reason. FE | 6 (reasons), 5 (screen) | Ingestion tests: each failure kind gives a readable reason |
| S-06 | 6 | Shirel sees the outcome, completion time and documents, from one shared source; the call ↔ follow-up link and history stay | Partial (database) | As T-08 | 5 | As T-08 |
| S-07 | 7.1 | Call card order: a header with the customer, **מס׳ פנייה** and the call status; then "פרטי הקריאה" (right) and "לקוח וכתובת" (left); then "שיבוץ" and the visit cards | Demo (previous layout) | **One shared call-card component** for Customer Service and the Manager | 5 | Screenshots at 390/820/1440 compared with the layout; RTL |
| S-08 | 7.2 | "פרטי הקריאה": מס׳ פנייה prominent; call type, product, SKU, brand/supplier, warranty and fault description, as uniform field/value pairs | Partial (fields in Migrations 2 and 3) | FE; an empty brand or supplier shows "לא הוזן" | 5 | **e2e** with a complete call and an incomplete one |
| S-09 | 7.3 | "שיבוץ": technician, date, planned window (e.g. 09:00–11:00) and visit status; planned kept separate from actual | Partial | FE | 5 | **e2e** |
| S-10 | 7.4 | Visit card: number, date, departure, arrival, end, total range, total duration, treatment duration, travel time. **Computed only from recorded times** | Partial (times in Migration 3) | One shared calculation; a missing time shows "לא נרשם" and is never guessed; suspicious times are flagged (D45) | 5 (data from Step 4) | Unit tests for every combination of missing times, midnight crossings and Asia/Jerusalem |
| S-11 | 7.5 | Summary, parts, photos and videos, recording or transcript, signature, follow-up reason and actions; each visit shown separately, with history | Partial (summary, signed text and follow-up in Migration 3; parts, media and transcripts missing) | Database work in Step 4 (`visit_parts`, `visit_media`, transcripts). FE | 4 (data), 5 (view) | RLS: media follows `card`, recordings follow `recordings` |
| S-12 | 7.6 | Clear cards with bold headings, uniform alignment and spacing, less empty space, consistent status colours, the MODY style; **no change to logic, data or permissions** | — | FE | 5 | Screenshot comparison; every existing RLS test still passes |

### 2.3 Manager (QA chapter 3)

| ID | QA § | Requirement | Status | Work | Step | Acceptance and tests |
|---|---|---|---|---|---|---|
| M-01 | 1 | "לא בוצעו במועד" drill-down: the planned window and the actual arrival, or "לא הגיע" / "טרם הגיע"; a link to the call card per permissions | Demo (details dialog) | A database function per the approved definition (D57; detailed spec §4.2). **Proposed:** "טרם הגיע" while the visit is open and its day has not ended; "לא הגיע" once the day has ended or the visit closed without an arrival | 9 | Tests for both states; the call-card link requires `card` |
| M-02 | 2 | Labels "ממוצע זמן טיפול", "ממוצע זמן נסיעה", "ממוצע זמן סגירת קריאה", "אחוז התקלות שנפתרו בביקור הראשון", each with unit and period | Demo only (old labels) | FE and the metric definitions | 9 | Labels, units and period as listed |
| M-03 | 3 | **"עמידה בתכנון" removed entirely** (the owner's message prevails over the document's "define it first") | Demo ("הגדרה ממתינה") | FE; D57 (4) amended by D60 (6) | 9 | The metric appears on no tab |
| M-04 | 4 | Manager calendar: status, colour and מס׳ פנייה, consistent | Demo only | As S-02 | 5 | As S-02 |
| M-05 | 5 | Call card: signature, documentation, full visit sequence, and the new visit-card design from S-07 to S-12 | Demo only | The shared component (S-07 to S-12) | 5 | The signature appears only when one exists |
| M-06 | 6 | User management: add Technician or Customer Service users with one button and a role choice; edit; active/inactive (an inactive user cannot sign in, history kept); **no deletion**; narrow permissions | Partial and conflicting: Migration 1 gives Technicians immediately, Customer Service only after Creator approval (D34) | Migration 5. Server actions (Auth user creation with the server key). FE | M5, 2 | **pgTAP:** a Manager creates Customer Service directly; cannot create a Manager or Creator; cannot change roles (D60 (7)); an inactive user is denied by RLS and cannot sign in; no delete function for the Manager |
| M-07 | 7 | One "הגדרות" tab with four areas. **Continuation reasons:** add and activate/deactivate, without harming history. **"טופל" text:** edit and save; earlier signatures keep the text actually signed. **Call types:** add and activate/deactivate. **No global `settings`** | Partial: the reason and call-type RPCs exist in Migration 2 but are gated by `settings`; the text versions are planned for Step 4 (D43) | Migration 5: three narrow keys (D60 (8)). FE | M5; 4 (text used at signing); 10 (settings screens) | **pgTAP:** a Manager with the narrow key succeeds and without it fails; no access to pickup places; a new text version leaves earlier signatures unchanged (D43). **e2e:** the document's acceptance test |
| M-08 | 8 | The three dashboard tabs, the filters and the period on each tab stay; "קריאות", "זימונים שלא נקלטו" and the Excel export stay, per permissions | Demo only | FE, BE | 5, 8, 9 | **e2e** |
| M-09 | 9 | The "התקדמות הביקורים" bar, percentage and legend removed from the General tab for the Manager and the Creator; the daily activity cards stay (planned, done, remaining, late); the space is tightened | Demo only | FE | 9 | Screenshots; **e2e:** the bar is absent |
| M-10 | Checks and decision | Pre-development checks; the activity-status and deletion decision | — | Acceptance criteria | M5, 2, 9 | Deletion is Creator-only and enforced on the server |

### 2.4 Creator (QA chapter 4)

| ID | QA § | Requirement | Status | Work | Step | Acceptance and tests |
|---|---|---|---|---|---|---|
| C-01 | 1 | Unified user management for all roles; one "הוסף משתמש" button; for a technician also phone, Outlook email, calendar colour and status; edit and activate/deactivate; **deletion by the Creator only**, after confirmation; history and the matrix kept | Demo (separate screens) | Migration 5 (deletion, D60 (7) Option A). BE, FE | M5, 2 | **pgTAP:** only the Creator deletes; after deletion there is no sign-in, history is kept and reactivation is refused; a role change grants nothing undefined |
| C-02 | 2 | "בקשות לאישור" removed (the list and the approve/reject controls); security mechanisms kept | Demo only | The component is not built. Migration 5 retires the request path and keeps the table as history | M5, 2 | **e2e:** no component. **pgTAP:** the request functions cannot be executed |
| C-03 | 3 | "מדדי שימוש" as a main tab, Creator only, from real events, with day/week/month/custom filters and breakdown by role and user; no customer content, recordings or signatures | Missing (the demo has a Settings tab with simulated data) | Telemetry migration (event table); an ingest endpoint with rate limiting; FE | Telemetry with Step 3; basic dashboard Step 10; full dashboard Step 12 | RLS: only the Creator reads; the Manager and Customer Service are refused on the server; no content fields in events |
| C-04 | 4 | Active users per day/week/month, adoption rate, logins, active days, last login, usage time, visits documented and closed in the app, completion rate, usage by role | Missing | Sign-in and session events; visit data from the database | Collect from Steps 2–3; full view in Step 12 | Calculation tests on test events |
| C-05 | 5 | Most-viewed screens, most-used buttons, key actions with unique users, unused functions, call-card opens, dashboard entries, Waze use, the navigation-to-outcome funnel (attempt vs success), documentation breakdown | Missing | A **closed event catalogue**; hooks added to each screen as it is built | 3–5 (hooks), 12 | Catalogue test: only defined events are accepted |
| C-06 | 6 | Application errors, failed operations, load times and slow loads (definition to be approved), failed sign-ins, failed, pending and successful syncs; no sensitive content | Missing | Error and performance events; sign-in failures recorded on the server | 2–4 (collection), 12 | No sensitive content in events |
| C-07 | 7 | Pickup places, reasons, call types, email and notification settings and the invitation template kept; features waiting for Microsoft 365 marked; operational vs system settings kept apart; the progress bar also removed from the Creator's General tab | Partial (places, reasons and types in Migration 2; the rest demo) | FE, BE | 7, 9, 10 | **e2e:** nothing is shown as "sent" before the connection |
| C-08 | Verification | Existing telemetry? Privacy and retention; server-side enforcement; demo vs backend | Telemetry: none (verified) | Privacy and retention: D60 (9) and open decision 12. Enforcement: pgTAP | — | — |
| C-09 | Final decisions | No approval requests; "מדדי שימוש" separate and Creator only; deletion Creator only; technician and user management unified | — | Covered by C-01 to C-03 | — | — |

### 2.5 Shared requirements (owner's message §7–8)

| ID | Requirement | Status | Work and step | Tests |
|---|---|---|---|---|
| X-01 | **"מס׳ פנייה"** = the reference number in the Outlook invitation, an ordinary field (`request_number`); **no ONE** of any kind. The document's "continued handling in ONE" only means there is no in-app "חזרו מהשטח" screen | Partial (database) | One label, "מס׳ פנייה"; ingestion parses the number from the invitation. Steps 6, 3, 5 | Scan: no "ONE" or `one_` in code, labels or schema |
| X-02 | Call status vs visit status; consistent labels and colours | Partial | One map. Steps 3, 5 | Unit test |
| X-03 | Full visit history; follow-up visits linked; no duplicate calls | Partial (unique `request_number` and `visit_number` in Migration 3) | Ingestion. Step 6 | A second invitation with the same number gives visit 2 of the same call |
| X-04 | Accurate timestamps and computed durations | Partial (D45, Migration 3) | As S-10. Steps 4, 5 | As S-10 |
| X-05 | Signatures and documentation per permissions | Partial | RLS and Step 4. Steps 4, 5 | RLS |
| X-06 | Correct offline synchronization | Missing | As T-01 and Migration 4. Step 4 | As T-01 |
| X-07 | Server-side authorization | Implemented in the database (Migrations 1–3, tested); continues in every step | Every step | Negative tests in every PR |
| X-08 | No automatic change to Outlook appointments | By design (ingestion only) | The Graph adapter is read-only. Step 11 | No Graph write permission |
| X-09 | No fabricated operational or analytics data shown as real | By design (D47, "נתוני בדיקה") | Every step | — |

## 3. Integrated sequence

1. **Step 1:**
   - apply Migration 3 (owner approval) and merge PR #25;
   - PR 1.6, Migration 4: offline operations and integrity (T-01, T-09, X-06);
   - PR 1.7: the Step 1 report.
2. **QA documentation:** PR #28 and this PR (D60). Documentation only.
3. **PR 1.8, Migration 5 (accounts and permissions, D60 (7)–(9)):** separate apply approval. Contents in §5.
4. **Step 2:**
   - sign-in;
   - role landing: Customer Service → "קריאות", Manager → "דשבורד";
   - the unified user-management screen for the Manager and the Creator, with "הוסף משתמש", no "בקשות לאישור", deletion by the Creator only and no role change by the Manager (M-06, C-01, C-02, S-01);
   - the Manager "הגדרות" tab with the users area;
   - sign-in telemetry events once the telemetry migration exists (C-04, C-06).
5. **Step 6:**
   - מס׳ פנייה parsing and follow-up linking (X-01, X-03);
   - structured unparsed reasons (S-05);
   - the simulator button inside "זימונים שלא נקלטו" (D60 (11)).
6. **Step 3:**
   - the technician home: "הושלמו היום", counters, next visit, collection area hidden when empty (T-02 view, T-07);
   - the calendar with the status map (T-04);
   - the icon (T-06);
   - **the telemetry migration and the event helper**, with hooks from the first real screen (C-03, C-05).
7. **Step 4:**
   - completion: validation, no duplicates, the "חזרה להיום" screen, local vs server save (T-09, T-02, T-03);
   - the sync banner (T-01);
   - parts, media, the signature image, the approval-text versions and transcripts (S-11; the M-07 text).
8. **Step 5:**
   - Customer Service navigation with 3 items and "קריאות" as default (S-01, S-04, S-05);
   - the office calendar with status and מס׳ פנייה (S-02, M-04);
   - **the shared call card** (S-07 to S-12, M-05);
   - synchronization (S-06, T-08).
9. **Step 7:** completion email to Shirel and Rotem for both outcomes, no duplicates, mock until Microsoft 365; "waiting for Microsoft 365" marking (T-05, C-07).
10. **Step 8:** Excel per permissions (M-08).
11. **Step 9:**
    - remove the progress bar (M-09, C-07) and "עמידה בתכנון" (M-03);
    - metric labels, units and period (M-02);
    - the "לא בוצעו במועד" drill-down (M-01).
12. **Step 10:**
    - the Manager settings areas: reasons, the "טופל" text and call types (M-07);
    - the Creator settings (C-07);
    - **a basic "מדדי שימוש" dashboard** (C-03, most of C-04).
13. **Step 11:** real email (T-05) and the read-only Graph adapter (X-08).
14. **Step 12 (new, after the pilot):** the **full usage-analytics dashboard** (C-04 to C-06), on events collected since Steps 2–3.

**Every step with UI** ends as today:
- an owner-only Preview;
- screenshots at 390/820/1440;
- a Hebrew checklist that names the QA IDs it covers.

## 4. Decisions applied (D60)

| Conflict | Resolution |
|---|---|
| D34 (a): Creator approval for Manager-initiated Customer Service accounts (implemented in Migration 1) vs direct Manager management | D60 (7): direct management by the Manager. Migration 5 replaces the function bodies and retires the request path; `account_requests` is kept as history. Migration 1 is not modified |
| Creator deletion vs history (`ON DELETE RESTRICT` everywhere, hash-chained audit) | D60 (7), Option A: access revoked permanently, profile marked deleted and hidden, no reactivation; history and attribution kept; no physical deletion of historical business records |
| Role changes | D60 (7): Managers cannot change an existing user's role; only the Creator performs approved role changes |
| Manager settings vs the `settings` key (D57; Migration 2 RPCs) | D60 (8): narrow keys `reasons`, `callTypes`, `ackText`; places, email, notifications and the invitation template stay Creator-only |
| "בוטלה" hidden vs D38 cancellation | D60 (1): internal `cancelled` and the D38 recalculation stay; cancelled visits are omitted from every user-facing list and counter and kept in the database and audit |
| Customer Service navigation vs simulator access (open decision 27) | D60 (11): a button inside "זימונים שלא נקלטו", only when the simulator is explicitly enabled in a test environment, never in Production |
| Usage analytics vs D33 (`usage`), open decision 10, D25 and privacy | D60 (9): Creator-only fixed capability; closed event catalogue without content; no scheduled jobs; retention per open decision 12 |
| ROADMAP Step 5 "customers" and "back from field" | Not built as standalone screens (D60 (4), D57 (1)); customer details on the call card |

## 5. Future database changes (not implemented now)

All are forward-only, and each needs its own approval (D52 rule 4). **Migrations 1–3 stay unchanged.**

| Migration | Status | QA-related content |
|---|---|---|
| Migration 4 (PR 1.6) | Planned | Offline operations and sync state (pending and failed), review items (D44), corrections, field versions (T-01, T-09, X-06) |
| **Migration 5 (PR 1.8): accounts and permissions** | **New (D60)** | (1) Direct Manager management of Technician and Customer Service accounts: new bodies for `assert_can_manage`, `authorize_account_creation`, `admin_set_user_active` and related functions; no role change by the Manager. (2) The request path retired (EXECUTE revoked) and `account_requests` kept read-only. (3) Creator-only deletion, Option A: `deleted_at`, `deleted_by`, a reactivation guard and a new audit action. (4) The audit action CHECK extended, as in Migration 2 section 4. (5) The narrow keys `reasons`, `callTypes`, `ackText`: TEMPORARY matrix rows (D51) and the Migration 2 RPC checks switched to them. (6) `usage` as a Creator-only fixed capability. (7) A fail-closed hardening check, as in Migrations 2 and 3 |
| Step 4 migration | Planned | `visit_parts`, `visit_media` (including the signature image), `ack_text_versions` (D43), transcripts, private Storage buckets and policies (S-11, M-07, T-09). The owner approves the initial "טופל" wording before Step 4 |
| Telemetry migration (M7 in the plan; numbered by apply order) | **New (D60)** | `usage_events` (closed catalogue, no content), a rate-limited insert function, Creator-only aggregate functions and a manual purge function (C-03 to C-06) |
| Step 7 | Planned | Outbox and notifications, with configurable recipients and a unique key per event (T-05) |
| Step 9 | Planned | Dashboard functions, including the "לא בוצעו במועד" drill-down (M-01) |
