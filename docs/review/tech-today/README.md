# Technician today (home) and the visit card — real screens (Step 3, Version 1 item 3)

Branch `claude/tech-today` (from `claude/step2-user-management` + `claude/step6-calendar-ingestion`).
Local only: nothing pushed, no PR, no remote operation, no migration.

## What was built

Real data only (D61), read under the signed-in Technician's own session (RLS, `my_technician_id()`;
Migration 3 `visits`, `my_visit_details`, `visit_rep_contact`, `previous_visits`, `visit_reports`,
`visit_signatures`):

| Route | Screen |
|---|---|
| `/tech` | "היום": date, greeting, 🧪 for a test user, counters "ביקורים היום" / "הושלמו ›", the next-visit card or the empty-day message, "מה לאסוף לפני יציאה" (hidden when empty), "לו"ז היום" with "הושלמו היום: …" |
| `/tech/visit/[id]` | Visit card. Open visit: "↻ ביקור המשך" (D36), action tiles (Waze, customer `tel:`, WhatsApp, the rep's work phone), address / building / floor / apartment, arrival notes, phone, customer number, call type, product, SKU, handling rep (no warranty and no paid-visit marker, D69), fault, "הערות לטכנאי", pickup with "Waze ›", the source line. Closed visit: the read-only view (D14, D43) |
| `/tech/done` | "הושלמו היום" (from the same read as the home counter) |

- Code: `features/visits/supabase/tech.ts` (queries over a client, Zod-checked rows, no server-only or
  secret), `lib/data/supabase/tech-visits.ts` (server-only per-request wiring),
  `features/visits/data/{links,paths,today}.ts`, `components/tech/{DevicePickups,VisitLinks}.tsx`,
  small additions to `NextVisitCard` (`navigate`, `NextVisitEmpty`), `TechHomeHeader` (optional bell,
  🧪), `PickupsCard` (`onToggle`, `note`), `VisitInfo` ("סוג קריאה"), and the visit type's task number
  widened to the stored text (D41).
- A visit is addressed by its id; another technician's visit, a cancelled visit or an unknown id is
  404 with nothing of it rendered.
- Five statuses only (D60 (1)): cancelled visits are left out of every list, counter and link.

## QA IDs

| ID | State |
|---|---|
| T-02 (view) | Done: counters, open and completed lists, next visit and the empty-day message come from the server's rows on every request. The closing action itself is the next screen (visit flow) |
| T-03 (view) | Done for the view: "המשך טיפול" counts as completed. Proved end to end with the visit flow |
| T-07 | Done: the pickup card is hidden on a day without pickups (local-stack test) |
| T-06 | Checked: no pencil-like icon on the technician home, visit card or "הושלמו היום". The only ✎ in the technician screens is "✎ כתיבה" in the summary editor (visit flow), a labelled mode switch with a clear function; the dashboard's ✎ ("has a summary") is an office screen (Step 9) |
| T-04 | Partly: the shared five-status map is used; the calendar views come with the calendar screen |
| T-08 | Partly: home, done list and card read one source; office views are other screens |
| T-01, T-09, T-10, T-05 | Pending (offline is Version 2; completion with the visit flow; email in Step 7) |

## Deviations and TEMPORARY behaviour (all labelled in code)

1. **"ניווט · Waze" instead of "יוצא · Waze"** on the next-visit card and a plain Waze tile on the card:
   no technician writer exists in Migrations 1–6, so a tap opens Waze only and records nothing. The
   visit flow (Migration 7) restores "יוצא · Waze" with the departure.
2. **"נאסף" is kept on this device for the day** (localStorage, request and visit numbers only), with
   the visible line "הסימון נשמר במכשיר הזה בלבד, להיום." No database object keeps it yet (TE-03 asks
   for per technician per day).
3. **No bell** (no notifications until Step 7) and **no "יומן"** tab or "יומן ›" chip until the calendar screen.
4. **Greeting by the hour** in Asia/Jerusalem ("בוקר טוב" / "צהריים טובים" / "ערב טוב"); the demo's
   fixed "בוקר טוב" would be wrong in the evening (G-01).
5. **"מס׳ פנייה"** in the card header (D60 (3)) instead of the demo's "פנייה".
6. **"סוג קריאה"** row added to the card (the coordinator's list).
7. **Empty next-visit card**: "אין ביקורים מתוכננים להיום" / "כל הביקורים של היום הושלמו" (QA T-02).
8. **Test-data marker** (D74, owner 2026-11-18; earlier QA T-06: the icon-only 🧪 read as a pencil): `TestPill` in `components/ui/TestBadge.tsx` is a small quiet grey "בדיקה" (no colour, border or icon; accessible name "נתוני בדיקה") on each test record, and `TestDataBanner` ("🧪 מוצגים נתוני בדיקה") at the top of a screen that shows test data. Real records show nothing.
9. The rep tile is disabled when the invitation's rep is not linked to an active office profile (D40, OQ-8).

## Open business questions (for the owner)

- **Unclosed visit from an earlier day:** the home shows the visits *scheduled* today (as the demo). A
  visit left open yesterday is not on today's home. Should it be?
- **Older closed visits (Migration 3 OQ-10, TEMPORARY):** the customer, call and product details are
  served to the technician only for open visits and visits closed today. From the next day a closed
  visit shows its own address, status and summary only. Confirm for the calendar screen.
- **"נאסף" on the server:** needs a small table (per technician, visit and day). Until then device-only.
- Open decision 2 (does the technician see his own times) stays open: no times are shown.

## Tests (this branch)

- Local stack (isolated `tm-tech`, ports 557xx): `tests/auth/tech-today.spec.ts` 10/10 — empty day;
  data via the simulator's ingestion service; own visits only; counters and next visit; no cancelled
  or tomorrow's visit; pickups grouped with Waze, device tick kept and labelled; card fields and links;
  no warranty or paid marker (D69); another technician's / cancelled / unknown / malformed id → 404 with nothing
  rendered; the second technician sees only his visit and no pickup card; Manager and Customer
  Service get the no-access state; "הושלמו היום" empty.
- Default e2e: `tests/e2e/tech-screens.spec.ts` (links, warranty, status codes, Jerusalem today and
  greeting, paths, source checks of guards and data access); `/tech/done` and `/tech/visit/<id>` added
  to the real-page, responsive and anonymous-redirect checks.

## Screenshots (local production build against the isolated stack; fictional, test-marked data)

`390-`, `820-` (D70: technician screens at 390 / 820 only) × `home-empty-day`, `home-day`,
`home-pickup-ticked`, `visit-card`, `visit-card-install`, `done-empty`, `visit-not-found` (WebP).
Taken with `SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-screenshots.spec.ts`.

## Owner corrections (2026-11-18)

- Building / floor / apartment: three equal columns, label and value centred (building right, floor middle, apartment left).
- No "באחריות" row and no "ביקור בתשלום" marker on technician screens (D69).
- Test data (D74): one banner "🧪 מוצגים נתוני בדיקה" at the top; a quiet grey "בדיקה" on each test record.

## מה לבדוק

1. מסך "היום": המונים "ביקורים היום" ו"הושלמו", כרטיס "הביקור הבא" וההודעה כשאין ביקורים.
2. "מה לאסוף לפני יציאה": מקובץ לפי מקום איסוף, עם Waze לכל מקום; השורה "הסימון נשמר במכשיר הזה בלבד, להיום".
3. כרטיס הביקור: בניין / קומה / דירה בשלוש עמודות שוות וממורכזות (בניין מימין, קומה באמצע, דירה משמאל).
4. כרטיס הביקור: אין שורת "באחריות" ואין "ביקור בתשלום" (גם בביקור שאינו באחריות).
5. נתוני בדיקה: באנר אחד "🧪 מוצגים נתוני בדיקה" בראש המסך וסימון אפור שקט "בדיקה" על כל רשומת בדיקה; "ניווט · Waze" רק פותח את Waze (היציאה, ההגעה והסיום במסך הבא).
