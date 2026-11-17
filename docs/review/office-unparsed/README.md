# "זימונים שלא נקלטו" with the Outlook invitation simulator (real screen)

**Status (2026-11-17):** branch `claude/office-unparsed` (from `claude/office-calls` = `claude/step2-user-management` + `claude/step6-calendar-ingestion`, merged again up to `2b41f9a`). Local only, not pushed. Real data only (D61): Migration 6 tables under the viewer's session. **Migration 6 is still local only** (not applied to the remote project); this screen needs it before it can work on Preview. No new migration, package or protected file.

## What was built

| Part | Files |
|---|---|
| Route `/office/unparsed` (`?page=n`, 40 per page): guarded on the server (`requireArea("office")`, then an office role), the real office frame | `app/(office)/office/unparsed/page.tsx` |
| The list: open rows of `calendar_ingestion_errors`, newest first, bounded and validated (Zod, the service's own problem schema); the attendee's technician matched by Outlook address; source and test label (D47, SIM-14); the rep's email shown as not sent (IN-04, pending d09) | `features/calendar/supabase/intake-queries.ts`, `lib/data/supabase/intake.ts`, `components/office/UnparsedInvitationsList.tsx` |
| Readable Hebrew reasons (S-05): every stored problem kind (missing, invalid per rule, unknown pickup place, unknown / inactive / ambiguous technician, conflicts) with the template label, the value read and what the field accepts; the active call types and pickup places named where they help | `features/calendar/data/unparsed-reasons.ts`, `components/office/unparsed-labels.ts`, `features/calendar/data/types.ts` |
| The simulator (D60 (11), resolving open #27): a button in the title row, rendered only when the server's switch is on (`CALENDAR_SIMULATOR=1`, never on Vercel Production) for Manager, Creator and Customer Service; the demo's Outlook modal (X-05); create, update, reschedule, re-assign, cancel, duplicate, invalid; the three demo samples; the form's own errors; the ingestion result in Hebrew; calls the existing server action `runInvitationSimulator` (passed as a prop) | `components/office/InvitationSimulator.tsx`, `features/calendar/data/simulator-form.ts`, `styles/ui.css` (`office-unparsed` block) |
| Navigation: "זימונים שלא נקלטו" for every office role (CS: "קריאות", "זימונים שלא נקלטו"; Manager/Creator: "דשבורד", "זימונים שלא נקלטו", "הגדרות"; only built screens) | `features/auth/landing.ts` |

Not in this screen: no action on a row (the fix is in the invitation itself, D08). Invitations sent from the dialog are kept in the screen's memory only (never browser storage), so update / cancel / duplicate work on invitations sent during the current visit of the page.

## QA IDs

- **Implemented:** S-05 (structured reasons and the information needed to fix them, on this screen), D60 (11) (simulator placement), M-08 for this screen (it stays, per role), X-01 on this screen ("מס׳ פנייה"), X-09 (no fabricated data; test data labelled "נתוני בדיקה" / "🧪 זימון בדיקה"), the "זימונים שלא נקלטו" item of D60 (4) and D57 (1).
- **Pending (other screens):** S-01 (Customer Service lands on "קריאות": the calls-list branch), the "יומן טכנאים" item of D60 (4) (S-02, M-04), S-04 is kept (no "לקוחות" / "חזרו מהשטח" items for any role).

## TEMPORARY and open

- Who sees the screen: every office role (D57 (1), D60 (4)); the gating matrix key is open decision #15. The database's read policy is the Step 6 TEMPORARY rule `calendar_ingestion_errors_select_office` (OQ-1). Not shown on the screen.
- The rep's email (IN-04): open decision #6 (d09); shown as "לא נשלח".
- The simulator on the testing-period Production address: open decision #21; off there (the switch refuses `VERCEL_ENV=production`).
- The organizer's name: the simulator sends no organizer address and the app does not map addresses to office users, so the "נציגה" line is shown only when an address exists (the body's "נציגה מטפלת" is part of the invitation).

## Tests (isolated local stack `tm-office`, ports 556xx)

| Command | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | pass |
| Default e2e `tests/e2e/office-unparsed.spec.ts` (+ the route in `REAL_PAGES` and the real-route lists) | 11 passed (desktop-only units; the route fails closed at every width) |
| Local stack `node tests/auth/run-local.mjs tests/auth/office-unparsed.spec.ts` | 9 passed, 1 skipped without `--with-creator`; 10 with it (see the branch report) |
| Screenshots `SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-unparsed-screenshots.spec.ts` (after `supabase db reset`) | 36 images in this folder |

Run against another local stack: `SUPABASE_BIN=<wrapper adding --workdir> AUTH_TEST_DB_CONTAINER=supabase_db_<project_id> node tests/auth/run-local.mjs …`. The suite starts two more servers of the same build (ports 3121 and 3122) to prove the simulator is absent with the switch off and on Vercel Production.

## Screenshots (390 / 820 / 1440)

`<width>-empty.png` (no unparsed invitation), `-mgr-list.png` (the Manager's view with data), `-cs-list.png` (Customer Service's view and navigation), `-reasons-missing.png`, `-reasons-technician.png` (one invitation's reasons), `-simulator-open(.png|-full.png)`, `-simulator-filled.png`, `-simulator-errors.png` (the form's own errors), `-simulator-result(.png|-full.png)` (an invalid invitation sent, with its reasons), `-simulator-cancel.png`.

## מה לבדוק (בעברית)

1. במסך "זימונים שלא נקלטו": לכל זימון רואים מה חסר או שגוי, את הערך שנקרא ומה צריך להיות (למשל "באחריות: אולי · צריך להיות: כן / לא / כן · עד MM/YYYY"), ואם הטכנאי לא זוהה.
2. כפתור "🧪 סימולטור זימונים" מופיע רק בסביבת בדיקה, אצל מנהל, יוצר ושירות לקוחות; בייצור הוא לא קיים בכלל.
3. בחלון הסימולטור: "לקוח חדש" יוצר קריאה; "שליחה כפולה" לא יוצרת כלום חדש; "זימון עם שדות חסרים" מופיע מיד ברשימה עם הסיבות.
4. בתפריט של שירות הלקוחות: "קריאות" ו"זימונים שלא נקלטו" (יומן טכנאים יתווסף כשייבנה).
5. כל רשומה מסומנת "🧪 זימון בדיקה" ו"נתוני בדיקה", ולא נשלח שום מייל.
