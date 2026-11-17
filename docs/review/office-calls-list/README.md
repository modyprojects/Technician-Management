# "קריאות" — the office calls list (real screen)

**Status (2026-11-17):** branch `claude/office-calls-list`, stacked on `claude/office-unparsed`. Local only, not pushed. Real data only (D61): Migration 3 (`service_calls`, `visits`, `customers`, `products`, `technicians`, `followup_reasons`) under the viewer's own session (RLS). No new migration, package or protected file.

## What was built

| Part | Files |
|---|---|
| Route `/office/calls` (`?q&status&tech&page`, 40 per page): guarded on the server (`requireArea("office")`, an office role, then the matrix key `calls` through `has_permission`, D33; without it "אין הרשאה" and nothing is read) | `app/(office)/office/calls/page.tsx` |
| The list as the approved demo (`docs/demo.html` offCalls()/callsTable(); `/dev/demo/office/[role]/calls`): search (מס׳ פנייה, customer number and name, phone digits, SKU, product, city), the latest visit's technician, service-call status chips with exact counts (D38, OF-17), newest first; the visit's source icon and the 🧪 marker of test calls (SIM-14, SIM-15, D47) and the "נתוני בדיקה" note | `features/calls/supabase/list-queries.ts`, `lib/data/supabase/calls.ts`, `components/office/CallsBrowser.tsx` (moved from the demo, shared), `components/office/CallsTable.tsx`, `components/office/CallFilters.tsx` |
| D60 (1): a cancelled visit is never shown or counted ("ביקור אחרון / הבא" is the latest other visit; none when every visit was cancelled; never "בוטל" on a real row). D60 (3): the column and the link say "מס׳ פנייה" | same |
| A row opens `/office/calls/<מס׳ פנייה>`: TEMPORARY page until the call card (next screen) is built: the call's customer, number, status and test marker, read under the session; a malformed number or a call the viewer cannot read is a 404 | `app/(office)/office/calls/[req]/page.tsx` |
| Navigation and landing: "קריאות" for the Manager and the Creator (after "דשבורד"); Customer Service lands on `/office/calls` (QA S-01; `/office` redirects there) | `features/auth/landing.ts`, `app/(office)/office/page.tsx` |

Not here (not built, no fake action): the Excel export (Step 8), the "מסכים נוספים" row (its screens are not built; D60 (4)), the call card itself.

**Bound (deviation from a database-side search):** one request reads the newest 1,000 calls by opening time (status filter applied by the database); search, technician filter, sorting by the latest visit and paging happen on the server over that window, because one PostgREST request cannot search across a call's customer, product and visits without a database function (no migration in this step). When more calls match than the window holds, the page says so. A later migration can add a search function; it needs the owner's approval.

## QA IDs

- **Implemented:** S-01 (Customer Service lands on "קריאות"; no "בית"), S-03 for the list (call status separate from visit status; field changes reach the list from the one data source), S-04 (no "לקוחות" / "חזרו מהשטח" items), X-01 and D60 (3) ("מס׳ פנייה"), X-02 for the list (one status map, `CallStatusPill`), D60 (1) (no cancelled visit), M-08 for this screen ("קריאות" stays, per permissions; the export is Step 8), X-09.
- **Pending:** the call card (S-07 to S-12, M-05: next screen), the "יומן טכנאים" item of D60 (4) (S-02, M-04), the Excel export (M-08, Step 8).

## TEMPORARY and open

- The row address `/office/calls/<מס׳ פנייה>` shows a temporary page until the call card is built.
- Matrix values are TEMPORARY until Step 10 (D51); the page follows `calls` (the Creator always).

## Tests (isolated local stack `tm-office`, ports 556xx)

| Command | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | pass |
| Default e2e `tests/e2e/office-calls-list.spec.ts` (+ both routes in `REAL_PAGES` and the real-route lists) | see the branch report |
| Local stack `node tests/auth/run-local.mjs [--with-creator] tests/auth/office-calls-list.spec.ts` | see the branch report |
| Screenshots `SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-calls-list-screenshots.spec.ts` (after `supabase db reset`) | images in this folder |

## Screenshots (390 / 820 / 1440)

`<width>-empty.png` (no call yet, Customer Service), `-cs-list.png`, `-mgr-list.png` (both views with data), `-filter-technician.png`, `-filter-search.png`, `-filter-status-empty.png` (a chip with no call), `-call-temporary.png` (a row's temporary call page).

## מה לבדוק (בעברית)

1. שירות הלקוחות נכנס ישר למסך "קריאות"; בתפריט רק "קריאות" ו"זימונים שלא נקלטו".
2. העמודה הראשונה נקראת "מס׳ פנייה"; ביקור שבוטל לא מופיע ולא נספר (עמודת "ביקורים" ו"ביקור אחרון / הבא").
3. החיפוש, סינון הטכנאי וצ׳יפים של הסטטוס (עם המספרים) עובדים ונשמרים בכתובת.
4. כל קריאת בדיקה מסומנת 🧪 ובראש המסך "נתוני בדיקה".
5. לחיצה על שורה פותחת עמוד זמני של הקריאה (כרטיס הקריאה המלא הוא המסך הבא).
