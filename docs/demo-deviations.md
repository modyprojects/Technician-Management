# Demo Deviations — what to keep, change, drop or add

**Status:** APPROVED v1.2 — owner approval 2026-10-26 (v1.0), amendment approved 2026-10-26 (v1.1), amendment approved 2026-11-01 and 2026-11-02 (v1.2).
**v0.2 changes:** EM-04 no longer refers to any external system; permission-matrix editing reopened as an owner decision (SE-02); no scheduled pickup reminder in v1 (TE-28, TE-29, SE-11); product rules added (PR-01 to PR-07).
**v0.3 changes:** Outlook invitation simulator added as a testing feature (X-05, SIM-01 to SIM-12). Real use of the app starts only when Microsoft 365 is connected.
**v0.4 changes:** owner approved: SKU normalization and name rule (PR-07), simulator switch by environment setting only (SIM-11, SIM-12), customer service may use the simulator in test environments (SIM-10).
**v1.1 changes:** dashboards and exports in test environments include test data with a "נתוני בדיקה" label (SIM-08, SIM-13); visit source label (TE-12, SIM-14).
**v1.2 changes (owner answers 2026-11-01):** dev-only side-by-side size view under `/dev` (X-03); technician layout above ~900 px (TE-31); every role at every width (D27); fictitious data in the testing-period Production (G-05, aligned with D31). TE-32 (fixed bottom navigation, proposed by Claude Code) and the desktop alignment of header and navigation content in TE-31 were approved at the owner's Step 0 review on 2026-11-02. Visual review round 1 (2026-11-02): next-visit card actions 50/50 from 600 px (TE-33); table column alignment and sizing (G-07).
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
| G-07 | All tables: every cell right-aligned except the visit count; the browser shares extra width across all columns (a wide gap opens next to the status pill) | CHANGE | Short columns (status, dates, times, counts, technician, SKU, request number) centred and sized to their content; long-text columns (customer, product, city, rep) right-aligned; extra width goes to customer and product. From 521 to 900 px tables use 8 px side padding and the headers of content-sized columns may wrap, so the calls table fits at 820 px; phones keep the demo's single-line table that scrolls sideways. Rule in `docs/design-system.md` ("Tables") | owner 2026-11-02 |

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
| TE-06 | "↻ ביקור המשך" box with previous visit summary | KEEP | | spec v2 |
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
| TE-19 | "טופל": fixed text, signer name, signature canvas | KEEP | | spec v2 decision 6 |
| TE-20 | "המשך טיפול": reason list | KEEP | | spec v2 |
| TE-21 | — (missing) free text "מה צריך בביקור הבא" under follow-up | ADD | Required when result is "המשך טיפול" | spec v2, d23 |
| TE-22 | Close sub-text "שירות הלקוחות יקבל מייל…" | CHANGE | Text must match D09 recipients (manager + customer-service mailbox) | D09 |
| TE-23 | After send: toast "נשלח מייל לשירות הלקוחות" | CHANGE | Never claim an email was sent. Show sync state: נשמר במכשיר / ממתין לסנכרון / מסתנכרן / נשלח לשרת / נכשל. Email goes out only after server acceptance | D06, D09 |
| TE-24 | — (missing) offline state and manual retry | ADD | Visible sync status per visit and a "נסה שוב" action, in the demo's visual language | D06 |
| TE-25 | Visit times recorded in background and shown only to the office | PENDING | Whether the technician sees his own times | d05 |
| TE-26 | "הושלמו היום" list and read-only view with "🔒" note | KEEP | | D14 |
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
| OF-01 | Dark sidebar navigation | KEEP | Items shown by role | demo |
| OF-02 | — (missing) nav items "זימונים שלא נקלטו", "חזרו מהשטח", "לקוחות" | ADD | See OF-16 | spec v2, d23 |
| OF-03 | Technician calendar day/week/month, tech filter chips, legend, visit drawer, "תצוגה בלבד" note | KEEP | Read-only. Tech colors from settings | spec v2 decision 1 |
| OF-04 | Calls list: search, status chips with counts, tech filter, 40-row cap | CHANGE | Same look. Server-side search and pagination | demo |
| OF-05 | — (missing) customer number in calls list and search | ADD | Column + searchable | d01 |
| OF-06 | Call card: customer, call details, visit timeline with departure/arrival/end pills, summary, recording, media, signature, sent emails | KEEP | Media via short-lived signed URLs only | security.md §6 |
| OF-07 | Call card "מותג / ספק" row | CHANGE | Same look. Brand and supplier are optional; show "לא הוזן" when empty | PR-04 |
| OF-08 | Call card "פתח זימון ב-Outlook" (toast) | CHANGE | Hidden until Microsoft 365 is connected. Then opens the event's web link | D08 |
| OF-09 | Cancel visit: in-app button, manager only, no reason | PENDING | Who cancels and where (Outlook delete vs. app), reason required | d08 |
| OF-10 | — (missing) audited correction of a closed visit | ADD | Manager/Creator correction with mandatory reason; original values preserved | D14 |
| OF-11 | Dashboard tabs כללי / טכנאים / מוצרים וספקים, KPIs, "עכשיו בשטח", technician drill-down | KEEP | Weekly chart ranges dynamic (G-01) | spec v2 |
| OF-12 | Dashboard "מוצרים וספקים" tab | CHANGE | Same look. SKU analysis always works. Brand and supplier charts group products without a value under "לא הוזן" | PR-04 |
| OF-13 | — (missing) KPIs "באיחור", "זמן ממוצע לסגירה", "מוצרים שחזרו תוך זמן קצר" | ADD | Add to dashboard | spec v2, d23 |
| OF-14 | "ייצוא ל-Excel" buttons (toast) | PENDING | Text only, no media, formula-injection safe. Columns decided before Step 8 | D11 |
| OF-15 | "מדדי שימוש" screen (logins, click tracking) | PENDING | Not in any spec. Touches employee privacy | d13 |
| OF-16 | — (missing) screens "זימונים שלא נקלטו", "חזרו מהשטח", "לקוחות" + customer card | ADD | Per spec v2 office screens table | spec v2, d23 |

## Settings

| ID | Demo element | Category | Production behavior | Source |
|---|---|---|---|---|
| SE-01 | Users table, "+ הוספת משתמש" (toast) | CHANGE | Real admin-invite flow, no public sign-up. Manager can manage standard users; only Creator manages Creator access | D04, D05, d04 |
| SE-02 | Editable permission matrix (toggles per role) | PENDING | Whether the matrix is editable or fixed is an **owner product decision**. Do not decide it. Either way, every permission is enforced on the server and in RLS, never only in the UI | d04 |
| SE-03 | Manager has no access to Settings (`settings: 0`) | CHANGE | Manager and Creator can manage users. Manager manages standard users only; only Creator manages Creator access | D05 |
| SE-04 | Customer service cannot cancel (`cancel: 0`) | PENDING | Spec v2 says customer service cancels | d08 |
| SE-05 | Technicians: color, phone, Outlook email, device, active | KEEP | Outlook email is the key that matches an invitation attendee to a technician | D08 |
| SE-06 | Pickup places table | KEEP | Deactivate instead of delete when referenced | database-schema.md |
| SE-07 | Follow-up reasons: toggle, add, delete only if unused; editable "טופל" fixed text | KEEP | Deactivate instead of delete when used | demo |
| SE-08 | Mail settings: per-outcome toggles (rep on, manager **off** for "טופל") | CHANGE | Completion email always to manager **and** customer-service mailbox for both outcomes | D09 |
| SE-09 | Mail settings: "הנציגה המטפלת" as recipient | PENDING | | d10 |
| SE-10 | Mail settings: "לצרף תמונות וסרטונים" | PENDING | Recommendation: link to the call card only | d11 |
| SE-11 | Technician notification toggles (new/change, cancel, morning pickup) | CHANGE | In-app only. Remove the morning pickup toggle (see TE-28) | D10 |
| SE-12 | "זימון שלא נקלט · מייל לנציגה" toggle | PENDING | | d09 |
| SE-13 | Template: "נושא הזימון מתחיל ב-[קריאת שירות]" | KEEP | Confirm with Shirel in O2 | demo |
| SE-14 | Template: "בדיקת תיבת Outlook · כל 5 דקות" | CHANGE | Replace with "מתעדכן אוטומטית כשזימון נוצר או משתנה". Event-driven, no polling | D08 |
| SE-15 | Template labels table with required toggles | CHANGE | Add "מספר לקוח" (required). "באחריות" optional. Final label list from O2 | d01, O2 |

## Invitation ingestion (demo simulation → real behavior)

| ID | Demo behavior | Category | Production behavior | Source |
|---|---|---|---|---|
| IN-01 | Parses body by Hebrew labels, not line order | KEEP | | outlook-template.md |
| IN-02 | Rejects an invitation whose SKU is not in the product list | CHANGE | Accept it. Apply the product rules PR-01 to PR-07 | d03, d25 |
| IN-03 | Rejects an unknown pickup place | KEEP | Invitation goes to "זימונים שלא נקלטו" | demo |
| IN-04 | Missing required field → not ingested + email to rep | CHANGE | Not ingested, and listed on "זימונים שלא נקלטו" with the missing field. Email to rep is PENDING d09 | spec v2 |
| IN-05 | Same request number → added as next visit | CHANGE | Deduplicate by calendar event ID: same event = update the existing visit. A new event with the same request number = new visit | integrations.md |
| IN-06 | — (missing) invitation moved, re-assigned or deleted in Outlook | ADD | Move / re-assign updates the visit. Delete: PENDING d08 | spec v2 |

## Products (catalog built from invitations)

| ID | Rule | Category | Production behavior | Source |
|---|---|---|---|---|
| PR-01 | No initial product list | ADD | The system starts with an empty products table. No import | owner 2026-10-26 |
| PR-02 | Read SKU and product name from each new invitation | ADD | Parsed by label, like every other field | owner 2026-10-26 |
| PR-03 | Existing SKU | ADD | Link the call to the existing product | owner 2026-10-26 |
| PR-04 | New SKU | ADD | Create the product automatically with SKU and name. Brand and supplier are optional and empty at creation | owner 2026-10-26 |
| PR-05 | No duplicates | ADD | One product per SKU, enforced by a unique constraint in the database, so repeated or concurrent invitations cannot create the same SKU twice | owner 2026-10-26 |
| PR-06 | Edit product details | ADD | Only authorized roles can edit name, brand and supplier (spec v2: Manager; Creator has all rights). Enforced on the server and in RLS | owner 2026-10-26, spec v2 |
| PR-07 | SKU normalization and product name | ADD | Before matching, trim spaces and convert the SKU to upper case, so "kt-2041 " and "KT-2041" are one product. If a later invitation has a different product name for an existing SKU, keep the existing name and do not overwrite it | owner 2026-10-26 (d27) |

## Outlook invitation simulator (testing feature)

**Purpose (owner decision 2026-10-26):** the app is used for real work only after Microsoft 365 is connected. Until then, everything is testing. The simulator lets authorized users test the full invitation workflow end-to-end with fictitious data. It is **not** a way to enter real service calls.

| ID | Requirement | Category | Production behavior | Source |
|---|---|---|---|---|
| SIM-01 | Simulator screen "סימולטור זימוני Outlook" in the office dashboard | ADD | Hebrew RTL, reusing the demo's Outlook modal design (X-05) | d28 |
| SIM-02 | Create a simulated invitation: technician (attendee), date, start and end time, subject, body using the approved Hebrew template labels | ADD | Body is parsed by labels exactly like a real invitation | d28 |
| SIM-03 | Update, reschedule and re-assign an existing simulated invitation | ADD | Same simulated event ID; the existing visit is updated, not duplicated | d28, IN-05 |
| SIM-04 | Simulate cancellation (event deleted) | ADD | Sends the delete event. What happens to the visit follows the cancel decision | d28, d08 |
| SIM-05 | Simulate duplicates, invalid values and missing required fields | ADD | Show the validation errors and the ingestion result on screen | d28 |
| SIM-06 | One ingestion service | ADD | Simulated events go through the **same** validated ingestion service as the future Microsoft Graph adapter. No separate business logic for simulated visits | d28, D08 |
| SIM-07 | Persisted like real data | ADD | Customer, service call, visit and product records are saved in Supabase and appear in the technician and office screens. New SKUs follow PR-01 to PR-07 | d28 |
| SIM-08 | Every record created from the simulator is marked as test data | ADD | A source marker on each record. In test environments (development, Preview) dashboards, reports and Excel exports include test data and are clearly labeled "נתוני בדיקה". In production, test-marked records are never counted, reported or exported. Simulated visits never send real email in any environment. | d28, security.md, owner 2026-10-26 |
| SIM-13 | "נתוני בדיקה" label on reports | ADD | In test environments: a visible "נתוני בדיקה" banner on the dashboard and on every report screen; Excel file name and the first row of each sheet include "נתוני בדיקה" | owner 2026-10-26 |
| SIM-14 | Visit source label everywhere a visit is shown | ADD | "🧪 זימון בדיקה" for simulated visits, "📅 נקלט אוטומטית מזימון Outlook" for Microsoft 365 visits, on the technician card, office calls list, office call card and calendar drawer | owner 2026-10-26 |
| SIM-09 | No real email or external notification from simulated visits | ADD | Completion emails for simulated visits stay in the mock outbox only | D09, security.md |
| SIM-10 | Who can use it | ADD | Manager, Creator and Customer Service, in development and Preview only. Technicians have no access. Enforced on the server and in database policies, not only by hiding the menu item. No public API | d28, d30 |
| SIM-11 | Where it runs and how it is switched on/off | ADD | Controlled **only** by an environment setting (feature flag): on in development and Preview, off in production. No on/off toggle in the UI. Never enabled in production without separate explicit approval. Fictitious data only | d28, d29 |
| SIM-12 | After Microsoft 365 is connected | ADD | The simulator is disabled by changing the environment setting, without changing service-call records, technician workflows or the ingestion architecture. Do not delete its code automatically | d28, d29 |

## Completion email

| ID | Demo behavior | Category | Production behavior | Source |
|---|---|---|---|---|
| EM-01 | Structure: status banner, follow-up instructions, customer, address, product/SKU, technician, summary, recording note, signature line, "לכרטיס הקריאה" button; subject "✓ טופל · פנייה…" / "↻ המשך טיפול · פנייה…" | KEEP | | demo |
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
