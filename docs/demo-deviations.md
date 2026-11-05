# Demo Deviations — what to keep, change, drop or add

**Status:** APPROVED v1.4 — owner approval 2026-10-26 (v1.0), amendment approved 2026-10-26 (v1.1), amendment approved 2026-11-01 and 2026-11-02 (v1.2), amendment approved 2026-11-03 (v1.3), amendment approved 2026-11-05 (v1.4, D57).
**v0.2 changes:** EM-04 no longer refers to any external system; permission-matrix editing reopened as an owner decision (SE-02); no scheduled pickup reminder in v1 (TE-28, TE-29, SE-11); product rules added (PR-01 to PR-07).
**v0.3 changes:** Outlook invitation simulator added as a testing feature (X-05, SIM-01 to SIM-12). Real use of the app starts only when Microsoft 365 is connected.
**v0.4 changes:** owner approved: SKU normalization and name rule (PR-07), simulator switch by environment setting only (SIM-11, SIM-12), customer service may use the simulator in test environments (SIM-10).
**v1.1 changes:** dashboards and exports in test environments include test data with a "נתוני בדיקה" label (SIM-08, SIM-13); visit source label (TE-12, SIM-14).
**v1.2 changes (owner answers 2026-11-01):** dev-only side-by-side size view under `/dev` (X-03); technician layout above ~900 px (TE-31); every role at every width (D27); fictitious data in the testing-period Production (G-05, aligned with D31). TE-32 (fixed bottom navigation, proposed by Claude Code) and the desktop alignment of header and navigation content in TE-31 were approved at the owner's Step 0 review on 2026-11-02. Visual review round 1 (2026-11-02): next-visit card actions 50/50 from 600 px (TE-33); table column alignment and sizing (G-07).
**v1.3 changes (owner decisions D33–D51, 2026-11-03):** permission-matrix values are temporary until the owner approves the final values in Step 10 (SE-02, D51); editable permission matrix, Creator only (SE-02, PR-06); account administration with Creator approval (SE-01, SE-03, SE-05); cancellation stays pending d08 with the `cancel` key (SE-04, OF-09); operational settings and D17-required template labels (SE-06, SE-07, SE-15, new SE-16 call types); previous visits for a follow-up technician (TE-06); approval text preserved at signing (TE-19, TE-26, OF-06, SE-07, EM-01); original recordings (OF-06); service-call status display (OF-04, new OF-17); invitation changes to started visits go to review (IN-06, SIM-03); 🧪 test-data badges (new SIM-15 to SIM-19); offline stores and warnings (TE-23, TE-24).
**v1.4 (2026-11-05, D57):** rows changed by D57 are APPROVED (owner); rows or parts marked TEMPORARY, PROPOSED or PENDING are not: T1–T8 and T12–T14 (#20), the entry row's count (#26), the former Manager home (#26), simulator placement (#27), and Claude Code's design proposals in OF-19 (PROPOSED, owner feedback pending under D53). Changed: OF-01, OF-02, OF-11, OF-12, OF-13, OF-16 (including D57 (9): "נפתחה" vs "תחילת טיפול"), SE-01, SE-03, SIM-01 (note); new: OF-18, OF-19, OF-20, G-08.
**Applies to:** `docs/demo.html` ("ניהול טכנאים · דמו חי · גרסה 2").

## Precedence

1. `docs/decisions.md`
2. **this file**
3. `docs/demo.html`

Where this file and the demo differ, this file wins. Where neither this file nor `decisions.md` covers a demo behavior, build it as in the demo. If you find a conflict that is not listed here, **stop and ask the owner in Hebrew**. Do not resolve it yourself.

## Categories

| Code | Meaning | What Claude Code does |
|---|---|---|
| **KEEP** | Keep exactly as in the demo (look and behavior) | Reproduce faithfully |
| **CHANGE** | Keep the look, change the behavior | Build the look from the demo, the behavior from the "Production behavior" column |
| **DROP** | Demo-only; never ship | Do not build. A dev-only equivalent behind `/dev` is allowed only where stated |
| **PENDING** | Waiting for an owner decision (ID given) | Build the visual with a disabled placeholder; implement no logic until the decision is recorded in `decisions.md` |
| **ADD** | Required by the spec but missing from the demo | Design new UI in the demo's visual language; show it to the owner before wiring logic |

Decision IDs like `d05` refer to the owner's decision board. `docs/decisions.md` lists each one in its **Board ref** column, next to the matching `D##` entry or open question.

## Global rules (apply to every screen)

| ID | Demo behavior | Category | Production behavior | Source |
|---|---|---|---|---|
| G-01 | Static date `TODAY = 2026-10-21`; month views hard-coded to October 2026 | CHANGE | Dynamic dates, `Asia/Jerusalem` time zone | Handoff §4 |
| G-02 | All state in browser memory; reset on reload | CHANGE | Server persistence (Supabase) with RLS; offline queue per D06 | D06, security.md |
| G-03 | Technician hard-coded as "יורם" (`ME = 'y'`) | CHANGE | Identity from Supabase Auth session | D04 |
| G-04 | Screens hidden by a client-side `can()` check | CHANGE | Same visibility in UI, **plus** server/RLS enforcement. A hidden button is not access control | security.md §5 |
| G-05 | Fictitious seed data (customers, phones, addresses) | KEEP (dev only) | Only under `/dev`. Served in development and Vercel Preview, and in Vercel Production only during the testing period behind Vercel Authentication (D31; `config/release.json` `testingPeriod`). Removed from Production at the go-live gate (`docs/deployment.md`). Never present after go-live | security.md, D31 |
| G-06 | Toasts ending in "(הדמיה)" / "בדמו לא…" | CHANGE | Real action, or no toast. Never claim an action happened when it did not | ROADMAP "Stop immediately if" |
| G-07 | All tables: every cell right-aligned except the visit count; the browser shares extra width across all columns (a wide gap opens next to the status pill) | CHANGE | Short columns (status, dates, times, counts, technician, SKU, request number) centred and sized to their content; long-text columns (customer, product, city, rep) right-aligned; extra width goes to customer and product. From 521 to 900 px tables use 8 px side padding, headers of content-sized columns may wrap, and city and rep may wrap like customer and product, so the calls table fits at 820 px with headroom; phones keep the demo's single-line table that scrolls sideways. Rule in `docs/design-system.md` ("Tables") | owner 2026-11-02 |
| G-08 | — (new) company logo | ADD | APPROVED (D57 (6)): the white MODY logo `public/brand/mody-logo-white.png` in every existing dark header (office sidebar 132 px, the ≤ 900 px office top bar 92 px, the technician header row 88 px at the left); proportions and transparency kept; no new light strip; the dark file is not used in the app | D57 |

## Demo-only chrome (DROP)

| ID | Element | Category | Note |
|---|---|---|---|
| X-01 | Top demo bar (brand + "דמו חי · גרסה 2 · נתונים בדויים") | DROP | |
| X-02 | Role switcher (טכנאי / שירות לקוחות / מנהל / יוצר) | DROP | Role comes from login |
| X-03 | Device switcher (מסך מלא / טאבלט / טלפון) and phone frame + fake status bar | DROP | Real responsive layout instead: every role at phone, tablet and desktop widths (D27), following the demo's container-query breakpoints. **v1.2:** a dev-only side-by-side size view (390 / 820 / 1440 px) is allowed only under `/dev`, with no device frame and no fake status bar |
| X-04 | "איפוס" (reset) | DROP | |
| X-05 | "📅 שליחת זימון מ-Outlook" simulation modal in the demo bar | CHANGE | Moves out of the demo bar into the Outlook invitation simulator (SIM-01 to SIM-12). Reuse the demo modal's visual design |
| X-06 | "✉ מיילים שנשלחו" modal | DROP | A dev-only mock outbox viewer behind `/dev` is allowed in Step 7 |
| X-07 | "מה לנסות כאן" guide panel beside the phone | DROP | |
| X-08 | "+ דוגמה" sample-media buttons | DROP | |
| X-09 | Fake numbers in usage screen (e.g. "▲ 12%", "96%") | DROP | See OF-15 |

## Technician app

| ID | Demo element | Category | Production behavior | Source |
|---|---|---|---|---|
| TE-01 | Home header: date, greeting, avatar, bell, counters "ביקורים היום" / "הושלמו ›" | KEEP | | demo |
| TE-02 | Next-visit card with "יוצא · Waze" and "פרטי קריאה" | CHANGE | Same look. Waze opens a real deep link to the address. Tapping sets status "בדרך" and records departure time (server or offline queue) | spec v2, D06 |
| TE-03 | "מה לאסוף לפני יציאה" grouped by pickup place, "נאסף" checkboxes, Waze to place | CHANGE | Same look. "נאסף" state is persisted per technician per day | spec v2 |
| TE-04 | "לו\"ז היום" list | KEEP | | demo |
| TE-05 | Call card header: request no. · task no. · visit no., status pill | KEEP | | demo |
| TE-06 | "↻ ביקור המשך" box with previous visit summary (the demo also shows the previous visit's recording length) | CHANGE | Same look. While the Technician has a current authorized assignment on the call (D36), the box shows the **earlier closed visits** of the same call (visit number lower than his open visit), even if another Technician did them: summaries, approved transcriptions, photos, videos, parts, follow-up reason and next-visit notes, and other authorized attachments. **Deviation from the demo:** instead of the previous recording, production shows the approved transcription; another Technician's original recording is never shown or cached on the device (D36, D37). Never shown: signatures or signer names, other Technicians' field times, future or concurrent visits of others. Enforced in the database and in private-storage authorization, not only in the UI; access ends on the server when the assignment ends, the account is deactivated or the role changes, and the device purges the cached copy at the next sync (D46) | spec v2, D36, D37, D46 |
| TE-07 | Action buttons Waze / לקוח / וואטסאפ / נציגה | CHANGE | Real `tel:` and WhatsApp links. "נציגה" calls the handling rep's phone from her user profile, not a fixed office number | spec v2 |
| TE-08 | Card fields: address, building/floor/apt, arrival notes, phone, product, SKU, warranty, rep, description, pickup | CHANGE | Same look. Warranty is optional: show "לא צוין" when empty | d01 |
| TE-09 | — (missing) customer number on the card | ADD | Show "מספר לקוח" (required field) | d01, spec v2 |
| TE-10 | — (missing) "הערות לטכנאי" is parsed but never shown | ADD | Show tech notes on the card | spec v2 |
| TE-11 | — (missing) "paid visit" marker | ADD | When warranty = "לא", show a clear "ביקור בתשלום" marker | spec v2 |
| TE-12 | "📅 נקלט אוטומטית מזימון Outlook" | CHANGE | Show the real source. Visit from Microsoft 365: keep the demo text "📅 נקלט אוטומטית מזימון Outlook". Visit from the simulator: "🧪 זימון בדיקה". See SIM-14 | D24, owner 2026-10-26 |
| TE-13 | "הגעתי · התחלת טיפול" | KEEP | Records arrival time | demo |
| TE-14 | Media before (optional) / after (required): photo + video | CHANGE | Real camera capture, compression, size/duration limits | D13, d07 PENDING |
| TE-15 | Summary: "✎ כתיבה" / "🎙 הקלטה" toggle; recording is simulated | CHANGE | Real recording, max 180 s. Transcript must be reviewed and approved by the technician before it becomes the summary | D12, D13 |
| TE-16 | Can close with a recording only, no text | PENDING | Close flow for voice-only visits | d06 |
| TE-17 | — (missing) "חלפים שהוחלפו" | ADD | Parts replaced, on the work screen after the summary | spec v2, d23 |
| TE-18 | Close: two results only, "טופל" / "המשך טיפול" | KEEP | | spec v2 decision 3 |
| TE-19 | "טופל": fixed text, signer name, signature canvas | CHANGE | Same look. The exact approval text shown to the customer at signing is preserved with the signature and the visit: the device sends the text version identifier and hash, the server verifies them against immutable stored versions, and a mismatch goes to review; it is never replaced by the current text (D43) | spec v2 decision 6, D43 |
| TE-20 | "המשך טיפול": reason list | KEEP | | spec v2 |
| TE-21 | — (missing) free text "מה צריך בביקור הבא" under follow-up | ADD | Required when result is "המשך טיפול" | spec v2, d23 |
| TE-22 | Close sub-text "שירות הלקוחות יקבל מייל…" | CHANGE | Text must match D09 recipients (manager + customer-service mailbox) | D09 |
| TE-23 | After send: toast "נשלח מייל לשירות הלקוחות" | CHANGE | Never claim an email was sent. Show sync state: נשמר במכשיר / ממתין לסנכרון / מסתנכרן / נשלח לשרת / נכשל. Email goes out only after server acceptance. The work stays in the device work queue until the server confirms receipt and integrity; it is never deleted automatically because the workday ended, an assignment was cancelled or access was lost (D46) | D06, D09, D46 |
| TE-24 | — (missing) offline state and manual retry | ADD | Visible sync status per visit and a "נסה שוב" action, in the demo's visual language. Two separate device stores (D46): a read-only cache with a defined retention policy, purged at sync when access ends (other Technicians' recordings are never cached; final durations with open decision 12), and a work queue kept until the server confirms receipt and integrity, never deleted automatically. Safe retries (backoff, manual retry, idempotent operation ids) and clear warnings for pending data. A deactivated account cannot sync: its pending work stays on the device with a clear warning until a recovery path is decided (open decision 25, Step 4). No recovery is promised for data that existed only on the device (device loss or damage, browser storage eviction, app removal or cleared browser data before sync) | D06, D46 |
| TE-25 | Visit times recorded in background and shown only to the office | PENDING | Whether the technician sees his own times | d05 |
| TE-26 | "הושלמו היום" list and read-only view with "🔒" note (the demo shows the current "טופל" text for past signatures) | CHANGE | Same look, read-only (D14). The read-only view shows the approval text preserved at signing, never the current Settings text (D43) | D14, D43 |
| TE-27 | Calendar day / week / month | CHANGE | Same look, dynamic dates (G-01) | demo |
| TE-28 | Bell + notifications list (new, follow-up, change, cancel, pickup reminder) | CHANGE | In-app only. Keep notifications triggered by events (new, follow-up, change, cancel). **No scheduled pickup reminder and no background scheduled jobs in v1**: the pickup list on the home screen (TE-03) covers it | D10, owner 2026-10-26 |
| TE-29 | Profile: weekly stats, notification toggles, "צליל התראה" | CHANGE | Toggles persist per user. Remove the "תזכורת 'מה לאסוף' בבוקר" toggle (see TE-28). Sound plays only while the app is open (no push) | D10 |
| TE-30 | Profile: "⚠ דיווח על תקלה באפליקציה" (toast only) | PENDING | Where the report goes | d26 |
| TE-31 | Above 900 px the demo shows the technician app only inside the phone mockup (DROP X-03) | CHANGE | Continue the tablet layout (600 px and wider): full-width dark header and bottom navigation, content centred up to 760 px, tablet-size touch targets. Above 900 px the header content (date, greeting, avatar, bell, counters) and the bottom-navigation buttons also align with the 760 px column; only their backgrounds are full width | D27, owner 2026-11-01 and 2026-11-02 |
| TE-32 | At 900 px and below the demo's `.phone{height:100%}` does not resolve, so the bottom navigation follows the content (on a tablet it floats mid-screen) | CHANGE | Header and bottom navigation stay fixed and only the content scrolls, at every width, as the demo's "real app" rule intends | owner 2026-11-02 |
| TE-33 | Next-visit card: "יוצא · Waze" fills the row and "פרטי קריאה" takes only its content width, at every width | CHANGE | Below 600 px exactly as in the demo. From 600 px (tablet and desktop) both buttons share the row 50/50; Waze stays the primary dark button | owner 2026-11-02 |

## Office (customer service, manager, creator)

| ID | Demo element | Category | Production behavior | Source |
|---|---|---|---|---|
| OF-01 | Dark sidebar navigation | CHANGE | Items shown by role. **Manager** (D57 (1), APPROVED): exactly "דשבורד", "יומן טכנאים", "קריאות", "זימונים שלא נקלטו", "הגדרות", in this order; no "לוח בקרה", "לקוחות", "חזרו מהשטח", "פריטים לבדיקה", "מוצרים" or "משתמשים" item. **Creator:** the same five items and the same landing, per the owner's request of 2026-11-05 (D57 (1): "Apply a corresponding navigation structure to the Creator, while preserving Creator-only functions") (APPROVED); every Creator-only function stays reachable (Settings tabs, the call card, the "מסכים נוספים" row). **Customer Service:** unchanged. Display only (G-04): every route keeps its own server-side check | demo, D57 |
| OF-02 | — (missing) nav items "זימונים שלא נקלטו", "חזרו מהשטח", "לקוחות" | ADD | See OF-16. Customer Service: the three items in its sidebar (unchanged). Manager and Creator (D57, APPROVED): "זימונים שלא נקלטו" in the sidebar; "לקוחות" and "חזרו מהשטח" (with "פריטים לבדיקה" and "מוצרים") in one unobtrusive "מסכים נוספים" row at the top of "קריאות", without counts (the row is APPROVED within D57 (2); the count question is TEMPORARY, #26 (b)) | spec v2, d23, D57 |
| OF-03 | Technician calendar day/week/month, tech filter chips, legend, visit drawer, "תצוגה בלבד" note | KEEP | Read-only. Tech colors from settings | spec v2 decision 1 |
| OF-04 | Calls list: search, status chips with counts, tech filter, 40-row cap | CHANGE | Same look. Server-side search and pagination. Status chips use the service-call status (OF-17) | demo, D38 |
| OF-05 | — (missing) customer number in calls list and search | ADD | Column + searchable | d01 |
| OF-06 | Call card: customer, call details, visit timeline with departure/arrival/end pills, summary, recording, media, signature, sent emails | CHANGE | Same look. Media via short-lived signed URLs only, issued after a database authorization check. The signature shows the approval text preserved at signing, not the current Settings text (D43). Original recordings only for the Creator or with the matrix key `recordings`; every access is audited (D37). Header status pill: see OF-17 | security.md §6, D37, D43 |
| OF-07 | Call card "מותג / ספק" row | CHANGE | Same look. Brand and supplier are optional; show "לא הוזן" when empty | PR-04 |
| OF-08 | Call card "פתח זימון ב-Outlook" (toast) | CHANGE | Hidden until Microsoft 365 is connected. Then opens the event's web link | D08 |
| OF-09 | Cancel visit: in-app button, manager only, no reason | PENDING | Who cancels and where (Outlook delete vs. app), reason required. If in-app cancellation is approved, the matrix key `cancel` governs who (D33); Customer Service off until d08 | d08, D33 |
| OF-10 | — (missing) audited correction of a closed visit | ADD | Manager/Creator correction with mandatory reason; original values preserved | D14 |
| OF-11 | Dashboard tabs כללי / טכנאים / מוצרים וספקים, KPIs, "עכשיו בשטח", technician drill-down | CHANGE | APPROVED (D57 (3)): three tabs per `docs/design/manager-dashboard-spec.md` and the visual reference `docs/design/manager-dashboard-demo.html`. General: today's activity and progress, the current month's service metrics (D56 (2)), the 30-day leading suppliers and SKUs, opened vs closed calls per month (3 / 6 / 12 completed months). Technicians: one technician at a time with day / week / month / year / custom periods; activity "ביקורים מתוכננים", "ביקורים שבוצעו", "קריאות שנסגרו" and the performance metrics; the per-technician "דוחות הביקורים" view replaces the drill-down. No live view ("עכשיו בשטח"), no technician comparison, no trend on Technicians, no "דורש טיפול", follow-up or review counters | spec v2, D57 |
| OF-12 | Dashboard "מוצרים וספקים" tab | CHANGE | APPROVED (D57): unique service calls, never visits; supplier card first (right); cumulative since the first call, no date controls; brand and supplier charts group products without a value under "לא הוזן" (its row always shown); SKU table columns, sort and pagination per spec §8.3; "תקלה נפוצה" is "לא זמין" (no structured issue category, D57 (4)); "% המשך טיפול" per D57 (5); no red highlight; 🧪 on test products (SIM-17) | PR-04, D57 |
| OF-13 | — (missing) KPIs "באיחור", "זמן ממוצע לסגירה", "מוצרים שחזרו תוך זמן קצר" | ADD | "באיחור" → "לא בוצעו במועד", computed (spec §4.2; T1, TEMPORARY #20); "זמן ממוצע לסגירה" → "זמן סגירת קריאה", computed (spec §4.4; T7, TEMPORARY #20); "מוצרים שחזרו תוך זמן קצר" is off the dashboard (D57 (3): no extra widgets) and stays on the customer card ("↩ מוצר חזר") | spec v2, d23, D57 |
| OF-14 | "ייצוא ל-Excel" buttons (toast) | PENDING | Text only, no media, formula-injection safe. Columns decided before Step 8 | D11 |
| OF-15 | "מדדי שימוש" screen (logins, click tracking) | PENDING | Not in any spec. Touches employee privacy | d13 |
| OF-16 | — (missing) screens "זימונים שלא נקלטו", "חזרו מהשטח", "לקוחות" + customer card | ADD | Per spec v2 office screens table. Customer Service reaches them from its sidebar (unchanged); Manager and Creator from the sidebar ("זימונים שלא נקלטו") and the "מסכים נוספים" row on "קריאות" (APPROVED, D57; no counts, #26 (b) TEMPORARY). The routes and implementations are unchanged. The customer card (and the "מוצרים" screen's "נוצר מזימון") show a call's "נפתחה" (`opened_at`) and "תחילת טיפול" (the first visit's arrival, read as the first recorded arrival by visit number, TEMPORARY T14, #20; "טרם התחיל" before it) with their own labels, and the "חזר תוך זמן קצר" rule counts from `opened_at` (APPROVED, D57 (9)) | spec v2, d23, D57 |
| OF-17 | Calls-list status chips and the call-card header pill show the status of the call's **last visit** (the demo has no separate call status) | CHANGE | Same look. The calls-list status chips and the office call-card header pill show the **service-call status** (D38) with the labels "פתוחה" / "ממתינה לשיבוץ" / "המשך טיפול" / "טופלה", calculated on the server. No cancelled call status: whole-call cancellation is open until d08. Visit pills (visit timeline, calendars, drawer, technician screens) keep the demo's visit statuses unchanged. New visual elements (colours for "פתוחה" and "ממתינה לשיבוץ") are designed in the demo's visual language and shown to the owner for approval before wiring | D38 |
| OF-18 | — (new) landing page | ADD | APPROVED (D57 (1)): Manager and Creator land on "דשבורד" (the office home redirects to it; every "חזרה ל…" link uses the same landing). Customer Service keeps its home. The former Manager home "לוח בקרה" (with "עכשיו בשטח") is kept but unreachable for Manager and Creator: open #26 (a) | D57 |
| OF-19 | — (new) Manager dashboard design | ADD | **APPROVED (D57, the detailed spec, the reference):** the detailed spec and the reference govern the dashboard; built with `--dash-*` tokens and the app fonts; G-07, SIM-13, SIM-14 and SIM-17 still apply; no future navigation (the reference's `Math.min(0, …)`); the 3/6/12 selector (spec §6); the toolbar order of spec §7.2 (technicians right, date navigation centre, periods left; C24); the spec §9 danger colour `#C14F4F` (C26). The existing Excel placeholder stays as it is (OF-14 PENDING; not re-approved here). **PROPOSED (Claude Code; owner feedback pending under D53; not approved):** `--dash-blue-strong` (#315EB5) for filled controls carrying text (C23); the `<details>` data table under the chart (C22); labelled gridlines at whole-number steps (C27); the `MIN_OFFSET` bounds (day −730, week −104, month −24, year −5); the custom range limited to today and to 366 days; the "הצג" button (C30); the per-technician "דוחות הביקורים" view; the "נדרש המשך טיפול" dialog column | D57, manager-dashboard-spec.md |
| OF-20 | — (new) metric categories and states | ADD | APPROVED (D57 (4)): every metric is computed, "הגדרה ממתינה" (only "עמידה בתכנון") or "לא זמין" (only "תקלה נפוצה"); a missing measurement is "—" with "אין מספיק נתונים", never 0; a period before the first recorded call shows "אין נתונים". First-visit resolution and "% המשך טיפול" per D57 (5) APPROVED (the app's label for the closed call status stays the D38 "טופלה"). T1–T8, T12 and T13 TEMPORARY (#20); T9 withdrawn by D57 (5) | D57, #20 |

## Settings

| ID | Demo element | Category | Production behavior | Source |
|---|---|---|---|---|
| SE-01 | Users table, "+ הוספת משתמש" (toast) | CHANGE | Real account administration through the app's authorized invitation/account-creation workflow; no public sign-up (D50). Only the Creator creates, modifies, activates, deactivates or manages Manager and Creator accounts. A Manager manages Customer Service and Technician accounts (D34): Manager-initiated Customer Service creation, activation, reactivation and role changes take effect only after the Creator approves (request statuses pending / approved / rejected / cancelled; nothing changes while pending; rejection stores a reason; every step audited; no automatic expiry); a Manager deactivates a Customer Service or Technician account immediately (audited, the Creator is notified in the app); Technician creation, activation and reactivation are immediate; Managers never set or reset passwords for others or change an account's email (Creator only). Authorization is checked in the database under the caller's session before any Auth admin call. The request and approval screens are new UI in the demo's visual language  D57 (1) (APPROVED): the Manager reaches this account administration under Settings › "משתמשים" (no standalone "משתמשים" item; the former address redirects there); `settings` stays off | D04, D05, D34, D50, D57 |
| SE-02 | Editable permission matrix (toggles per role) | CHANGE | Same look: an editable matrix in Settings (D33). **Only the Creator can change it**, through a Creator-only server function; changes take effect immediately and are audited. It covers Manager and Customer Service; Technician and Creator capabilities are fixed. Keys: the demo's `cal`, `calls`, `card`, `cancel`, `dashGen`, `dashTech`, `dashProd`, `export`, `settings`, `usage` plus `products`, `conflicts` and `recordings`. Defaults follow the demo: Manager all on except `settings` and `usage`; Customer Service `cal`, `calls`, `card` only (no `cancel` until d08; the usage screen is not built until d13). **Enforcement is always in the database (RLS, grants, server functions) and on the server, never only in the UI.** Data keys (`calls`, `card`, `settings`, `products`, `conflicts`, `cancel`, `recordings`) are enforced on the data; screen keys (`cal` vs `calls`, `dashGen`, `dashTech`, `dashProd`, `export`, `usage`) gate screens and server functions and never bypass database and server-side authorization; every export is authorized on the server. Fixed capabilities are never matrix keys (D33). **Values are TEMPORARY** (D51): seeded defaults carry the status `temporary` until the owner approves the final Manager and Customer Service values on the Step 10 settings screen; a key introduced later defaults to denied unless approved; temporary values never override hard restrictions. New visual elements (Hebrew labels of the `products`, `conflicts` and `recordings` rows, the `card` label without recordings, the temporary-value marker) are designed in the demo's visual language and shown to the owner for approval before wiring | D33, D51, d04, d40 |
| SE-03 | Manager has no access to Settings (`settings: 0`) | CHANGE | The `settings` key (operational settings, D35) stays off by default for the Manager, as in the demo (D33). Account administration is a fixed capability, not a matrix key: the Manager manages Customer Service and Technician accounts under the D34 rules whatever `settings` allows; only the Creator manages Manager and Creator accounts and edits the matrix. D57 (1) (APPROVED): the Manager's "הגדרות" item opens Settings › "משתמשים" (the D34 account administration); the other Settings tabs stay closed to the Manager while `settings` is off | D05, D33, D34, D57 |
| SE-04 | Customer service cannot cancel (`cancel: 0`) | PENDING | Spec v2 says customer service cancels. If in-app cancellation is approved, the matrix key `cancel` governs who (D33); Customer Service off until d08 | d08, D33 |
| SE-05 | Technicians: color, phone, Outlook email, device, active | CHANGE | Same look. Outlook email is the key that matches an invitation attendee to a technician; every change to it notifies the Creator in the app, no approval (D34). The technician "פעיל" toggle means eligibility for new invitations (as the demo says, an inactive technician gets no new invitations and keeps his history); it does not control sign-in or data access, which follow the user account (activation and deactivation per D34; access ends when the account is deactivated or the role changes, D36) | D08, D34, D36 |
| SE-06 | Pickup places table | KEEP | Deactivate instead of delete when referenced. Editing is controlled by the matrix key `settings` (D35) | database-schema.md, D35 |
| SE-07 | Follow-up reasons: toggle, add, delete only if unused; editable "טופל" fixed text | CHANGE | Same look. Deactivate instead of delete when used. Editing is controlled by the matrix key `settings` (D35). The demo's five reasons are the initial values, to be validated with customer service (owner task O3, D48). Editing the "טופל" text never changes past signatures: each signature keeps the exact text shown at signing (D43) | demo, D35, D43, D48 |
| SE-08 | Mail settings: per-outcome toggles (rep on, manager **off** for "טופל") | CHANGE | Completion email always to manager **and** customer-service mailbox for both outcomes | D09 |
| SE-09 | Mail settings: "הנציגה המטפלת" as recipient | PENDING | | d10 |
| SE-10 | Mail settings: "לצרף תמונות וסרטונים" | PENDING | Recommendation: link to the call card only | d11 |
| SE-11 | Technician notification toggles (new/change, cancel, morning pickup) | CHANGE | In-app only. Remove the morning pickup toggle (see TE-28) | D10 |
| SE-12 | "זימון שלא נקלט · מייל לנציגה" toggle | PENDING | | d09 |
| SE-13 | Template: "נושא הזימון מתחיל ב-[קריאת שירות]" | KEEP | Confirm with Shirel in O2 | demo |
| SE-14 | Template: "בדיקת תיבת Outlook · כל 5 דקות" | CHANGE | Replace with "מתעדכן אוטומטית כשזימון נוצר או משתנה". Event-driven, no polling | D08 |
| SE-15 | Template labels table with required toggles | CHANGE | Add "מספר לקוח" (required). "באחריות" optional. Final label list from O2. Editing is controlled by the matrix key `settings` (D35); the D17-required labels ("מספר פנייה", "מספר לקוח") stay required whatever `settings` allows | d01, O2, D35 |
| SE-16 | — (missing) call types ("תיקון", "התקנה") are fixed in the demo; no Settings screen | ADD | Call types are editable in Settings under the matrix key `settings` (D35), in the demo's visual language. Initial values "תיקון" and "התקנה", to be validated with customer service (owner task O3, D48) | D35, D48 |

## Invitation ingestion (demo simulation → real behavior)

| ID | Demo behavior | Category | Production behavior | Source |
|---|---|---|---|---|
| IN-01 | Parses body by Hebrew labels, not line order | KEEP | | outlook-template.md |
| IN-02 | Rejects an invitation whose SKU is not in the product list | CHANGE | Accept it. Apply the product rules PR-01 to PR-07 | d03, d25 |
| IN-03 | Rejects an unknown pickup place | KEEP | Invitation goes to "זימונים שלא נקלטו" | demo |
| IN-04 | Missing required field → not ingested + email to rep | CHANGE | Not ingested, and listed on "זימונים שלא נקלטו" with the missing field. Email to rep is PENDING d09 | spec v2 |
| IN-05 | Same request number → added as next visit | CHANGE | Deduplicate by calendar event ID: same event = update the existing visit. A new event with the same request number = new visit | integrations.md |
| IN-06 | — (missing) invitation moved, re-assigned or deleted in Outlook | ADD | Move / re-assign updates the visit. Delete: PENDING d08. **Amendment (D39, approved 2026-11-03):** for a visit that is already en route or in progress, re-assignment, cancellation or deletion, and changes of customer, address or SKU are not applied automatically but go to review; non-critical changes (time, technician notes, arrival notes) are applied with a notification; a closed visit is never changed by an invitation. Field-by-field contact updates and review of SKU or customer changes: D39 | spec v2, D39 |

## Products (catalog built from invitations)

| ID | Rule | Category | Production behavior | Source |
|---|---|---|---|---|
| PR-01 | No initial product list | ADD | The system starts with an empty products table. No import | owner 2026-10-26 |
| PR-02 | Read SKU and product name from each new invitation | ADD | Parsed by label, like every other field | owner 2026-10-26 |
| PR-03 | Existing SKU | ADD | Link the call to the existing product | owner 2026-10-26 |
| PR-04 | New SKU | ADD | Create the product automatically with SKU and name. Brand and supplier are optional and empty at creation | owner 2026-10-26 |
| PR-05 | No duplicates | ADD | One product per SKU, enforced by a unique constraint in the database, so repeated or concurrent invitations cannot create the same SKU twice | owner 2026-10-26 |
| PR-06 | Edit product details | ADD | Only authorized roles can edit name, brand and supplier (spec v2: Manager; Creator has all rights). Governed by the matrix key `products` (D33; default on for Manager, off for Customer Service). Enforced on the server and in RLS | owner 2026-10-26, spec v2, D33 |
| PR-07 | SKU normalization and product name | ADD | Before matching, trim spaces and convert the SKU to upper case, so "kt-2041 " and "KT-2041" are one product. If a later invitation has a different product name for an existing SKU, keep the existing name and do not overwrite it | owner 2026-10-26 (d27) |

## Outlook invitation simulator (testing feature)

**Purpose (owner decision 2026-10-26):** the app is used for real work only after Microsoft 365 is connected. Until then, everything is testing. The simulator lets authorized users test the full invitation workflow end-to-end with fictitious data. It is **not** a way to enter real service calls.

| ID | Requirement | Category | Production behavior | Source |
|---|---|---|---|---|
| SIM-01 | Simulator screen "סימולטור זימוני Outlook" in the office dashboard | ADD | Hebrew RTL, reusing the demo's Outlook modal design (X-05). Placement open #27 (D57 limits the dashboard to three tabs and the Manager sidebar to five items); not built yet (Step 6) | d28, #27 |
| SIM-02 | Create a simulated invitation: technician (attendee), date, start and end time, subject, body using the approved Hebrew template labels | ADD | Body is parsed by labels exactly like a real invitation | d28 |
| SIM-03 | Update, reschedule and re-assign an existing simulated invitation | ADD | Same simulated event ID; the existing visit is updated, not duplicated. **Amendment (D39, approved 2026-11-03), as in IN-06:** for a visit that is already en route or in progress, re-assignment, cancellation or deletion, and changes of customer, address or SKU go to review instead of being applied; non-critical changes (time, technician notes, arrival notes) are applied with a notification; a closed visit is never changed by an invitation | d28, IN-05, D39 |
| SIM-04 | Simulate cancellation (event deleted) | ADD | Sends the delete event. What happens to the visit follows the cancel decision | d28, d08 |
| SIM-05 | Simulate duplicates, invalid values and missing required fields | ADD | Show the validation errors and the ingestion result on screen | d28 |
| SIM-06 | One ingestion service | ADD | Simulated events go through the **same** validated ingestion service as the future Microsoft Graph adapter. No separate business logic for simulated visits | d28, D08 |
| SIM-07 | Persisted like real data | ADD | Customer, service call, visit and product records are saved in Supabase and appear in the technician and office screens. New SKUs follow PR-01 to PR-07 | d28 |
| SIM-08 | Every record created from the simulator is marked as test data | ADD | A source marker on each record. In test environments (development, Preview) dashboards, reports and Excel exports include test data and are clearly labeled "נתוני בדיקה". In production, test-marked records are never counted, reported or exported. Simulated visits never send real email in any environment. | d28, security.md, owner 2026-10-26 |
| SIM-13 | "נתוני בדיקה" label on reports | ADD | In test environments: a visible "נתוני בדיקה" banner on the dashboard and on every report screen; Excel file name and the first row of each sheet include "נתוני בדיקה" | owner 2026-10-26 |
| SIM-14 | Visit source label everywhere a visit is shown | ADD | "🧪 זימון בדיקה" for simulated visits, "📅 נקלט אוטומטית מזימון Outlook" for Microsoft 365 visits, on the technician card, office calls list, office call card and calendar drawer | owner 2026-10-26 |
| SIM-15 | 🧪 badge on test service calls | ADD | A test-marked service call shows a 🧪 badge wherever it is listed or opened (for example the office calls list and call card), in the demo's visual language. Visits keep "🧪 זימון בדיקה" (SIM-14) | D47 |
| SIM-16 | 🧪 badge on test customers | ADD | A test-marked customer shows a 🧪 badge wherever it is listed or opened (for example the "לקוחות" screen and customer card, OF-16) | D47 |
| SIM-17 | 🧪 badge on test products | ADD | A test-marked product shows a 🧪 badge wherever it is listed or opened (for example the call card product row and the dashboard "מוצרים וספקים" tab) | D47 |
| SIM-18 | 🧪 badge on test users | ADD | A test user (office account or technician) shows a 🧪 badge wherever it is listed or opened (for example the Settings users and technicians tables) | D47 |
| SIM-19 | 🧪 badge on test media | ADD | Test-marked photos, videos and recordings show a 🧪 badge wherever they are listed or opened (for example the call card media section) | D47 |
| SIM-09 | No real email or external notification from simulated visits | ADD | Completion emails for simulated visits stay in the mock outbox only | D09, security.md |
| SIM-10 | Who can use it | ADD | Manager, Creator and Customer Service, in development and Preview only. Technicians have no access. Enforced on the server and in database policies, not only by hiding the menu item. No public API | d28, d30 |
| SIM-11 | Where it runs and how it is switched on/off | ADD | Controlled **only** by an environment setting (feature flag): on in development and Preview, off in production. No on/off toggle in the UI. Never enabled in production without separate explicit approval. Fictitious data only | d28, d29 |
| SIM-12 | After Microsoft 365 is connected | ADD | The simulator is disabled by changing the environment setting, without changing service-call records, technician workflows or the ingestion architecture. Do not delete its code automatically | d28, d29 |

## Completion email

| ID | Demo behavior | Category | Production behavior | Source |
|---|---|---|---|---|
| EM-01 | Structure: status banner, follow-up instructions, customer, address, product/SKU, technician, summary, recording note, signature line, "לכרטיס הקריאה" button; subject "✓ טופל · פנייה…" / "↻ המשך טיפול · פנייה…" | CHANGE | Same structure. The signature line uses the approval text preserved at signing, not the current Settings text (D43) | demo, D43 |
| EM-02 | To: rep + service mailbox; CC manager only on follow-up | CHANGE | Manager + customer-service mailbox, both outcomes | D09 |
| EM-03 | Thumbnails of media in the email | PENDING | | d11 |
| EM-04 | — (missing) business identifiers in the email | ADD | Show request number, task number, customer number, visit number, result, follow-up reason, summary and parts, for normal business use. No reference to, mapping for, or format of any external system | d22 |
| EM-05 | Sent immediately on close | CHANGE | Transactional outbox, only after server acceptance and an approved summary | D09, D12 |

## Traceability: the 11 conflicts found in the 2026-10-25 review

| # | Conflict | Rows |
|---|---|---|
| 1 | "Check Outlook every 5 minutes" vs. event-driven | SE-14 |
| 2 | Manager not CC'd on "טופל" emails | SE-08, EM-02 |
| 3 | Handling rep as recipient | SE-09 |
| 4 | Media attached to email | SE-10, EM-03 |
| 5 | Closing with a recording only | TE-15, TE-16 |
| 6 | Editable permission matrix; manager has no Settings | SE-01, SE-02, SE-03 |
| 7 | Usage-metrics screen not in spec | OF-15 |
| 8 | Cancel in app vs. Outlook; who may cancel | OF-09, SE-04, IN-06 |
| 9 | Customer number missing | TE-09, OF-05, SE-15 |
| 10 | "[קריאת שירות]" subject rule undocumented | SE-13 |
| 11 | Email to rep on unparsed invitation | SE-12, IN-04 |
