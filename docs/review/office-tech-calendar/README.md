# Office technician calendar ("יומן טכנאים") on real data (#57)

Signed in as the Manager on the local Supabase stack, reset before the images (`supabase db reset`, local only) so no technicians from earlier test runs are left. Every record is fictional and test-marked ("נתוני בדיקה", D47, D91). Made by `tests/auth/office-tech-calendar-screenshots.spec.ts`.

| File | What it shows |
| --- | --- |
| `1440-default.webp` | `/office/calendar` with no view chosen: the week, Sunday to Saturday (D94 (a), (b)), all six technicians of the team |
| `390-default.webp` | The same address on a phone: today's day for one technician, on the technician calendar's day strip and hour grid (D97) |
| `1440-day.webp` | Day view, six technicians: one readable column each |
| `1440-filter-open.webp` | The "טכנאים: 2 טכנאים ▾" list open: "כולם" (partly chosen) and a checkbox per technician, two of six chosen |
| `1440-day-many.webp`, `1440-day-many-scrolled.webp` | Day view with 22 technicians: each column keeps its minimum width; the calendar scrolls sideways inside its own area (second image: scrolled halfway) with the hour column fixed; the page and the sidebar do not move |
| `390-week.webp` | Week view on a phone: the technician calendar's 7-column week grid for the selected technician |
| `390-tech-select.webp` | "בחר טכנאי" with its options (drawn in place for the image; a real phone opens the system picker) |
| `1440-drawer.webp`, `390-drawer.webp` | A visit's drawer, with the link to the call card |
| `1440-range-edge.webp`, `390-range-edge.webp` | The last week of the range: a whole week (Sunday to Saturday), no greyed days, "next" is disabled (D94 (d) as amended 22.11) |
| `1440-cs-nav.webp`, `390-cs-nav.webp` | Customer Service's menu with `cal` (D60 (4), D96) |

The phone images choose the fictional technician who has visits (`?tech=`); with no `tech` the phone shows the first technician by name.

The team in the images: the two technicians the test run seeds and four fictional ones (six). The 16 more technicians of the "many" images are switched off (not accepting invitations, no visits) except for those images.

Measured with 22 technicians (Playwright, `document.documentElement.scrollWidth` against the viewport; the app's scroller `.stage` likewise): 1440 → 1440 and 1920 → 1920, in the day and the week view; the sidebar stays 220 px at the right edge; only the day calendar's own area scrolls sideways.

## Changes from the approved skeleton (D81)

1. **Week is Sunday to Saturday (7 columns), not Sunday to Thursday.** Reason: owner answer D94 (a), same as the technician calendar (D89).
2. **Default view by device: week on desktop, day on phone**, when the address names no view; the chosen view stays in the address. Reason: D94 (b).
3. **Day arrows move one calendar day** (Friday and Saturday included) instead of skipping to the next work day; their names are "יום קודם" / "יום הבא". Reason: D94 (a) makes Friday and Saturday days of the calendar.
4. **Range: one month back, three months forward.** A date outside is moved to the nearest edge; the arrow at the edge is dimmed and disabled. Reason: D94 (d). (Rounded to whole weeks after the owner's review, batch 2 below.)
5. **"אין הרשאה" state** for a role without the permission key `cal`; nothing is read. Reason: D94 (c) (visibility by `cal`, checked on the server).
6. **The drawer's "לכרטיס הקריאה המלא" shows only for roles with `calls`**, and "חיוג לטכנאי" only when the technician's work phone is readable (Manager, Creator). Reason: no link to a screen the role cannot open; RLS decides the phone.
7. **Technicians shown**: every technician who accepts invitations, plus any with a visit that week, by name (the skeleton had four fixed ones). Reason: real data.
8. **Test-data banner** only when a shown record is test-marked; test records are hidden on Production after go-live. Reason: D91.

## Additions after the independent review (22.11)
- "יומן טכנאים" appears in the menu only when the user has `cal` (D94 (c)); before, every office role saw it and the page denied. Review nit 4.
- After go-live the drawer's technician read drops test rows (D91). Review nit 3.
- Customer Service navigation (D60 (4), D96): "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" — `390-cs-nav.webp`, `1440-cs-nav.webp`.

## Changes after owner review 22.11 (phone only; amends D94 (b))
1. **"בחר טכנאי" dropdown instead of the technician chips**, the same native select as the calls list's technician filter. One technician at a time, kept in the address (`?tech=`); default the first technician; an unknown id falls back to the first. Desktop keeps the chips ("כולם" and each technician).
2. **Day = the technician calendar's day view** (D85 (b)): the day strip of the shown week (Sunday to Saturday, each day with its visit count; days outside the range are left out) and the hour grid with the visit blocks ("request · customer · time", status chip). The card list is removed.
3. **Week = the technician calendar's week grid**: 7 columns, Sunday to Saturday, for the selected technician; a day heading opens that day; days outside the range are greyed.
4. **No explanation line ("תצוגה בלבד…") and no colour legend on the phone.** Each block's status is still in its accessible name; on the day grid it is also a text chip. Desktop unchanged.
5. Unchanged: default day on phone / week on desktop, the range clamp and disabled arrows, read-only, the `cal` gate, the test-data banner, and a tap on a visit opens the drawer.

## Changes after owner review 22.11 (batch 2)
1. **Desktop technician filter: one button "טכנאים ▾" instead of the chips.** It opens a list with "כולם" and a checkbox per technician (multi-select; default all). The button shows the selection: "כל הטכנאים", the technician's name when one is chosen, otherwise "N טכנאים". The calendar shows only the chosen technicians, and the filter row stays one row whatever the team's size. The selection is in the address (`?techs=id1,id2`): absent = all; unknown ids are ignored; nothing left = all; every technician chosen = all. At least one technician stays chosen (the last one cannot be cleared). Keyboard: Enter/Space on the button opens and closes, Tab moves through the checkboxes, Space toggles, Escape closes and returns to the button; a click outside closes. The phone keeps its single "בחר טכנאי" dropdown (D97).
2. **Desktop day view: a minimum column width per technician (180 px)**, so names and visit text stay readable. When the columns do not fit, the calendar scrolls sideways inside its own area with the hour column fixed; the page itself never scrolls sideways and the sidebar is never pushed or cut (measured above).
3. **Range rounded to whole weeks** (amends D94 (d)): from the Sunday of the week one month ago to the Saturday of the week three months ahead. Every shown week is complete, so no day is greyed as "מחוץ לטווח היומן" any more (desktop week, phone week and the phone's day strip). The arrows still stop at the ends and every read is clamped to the range. The technician's own calendar keeps its past-day greying.
4. **Review images retaken on a reset local stack** with a realistic team (six technicians), plus the open filter list and the many-technicians day view.
