# Office technician calendar ("יומן טכנאים") on real data (#57)

Signed in as the Manager on the local Supabase stack. Every record is fictional and test-marked ("נתוני בדיקה", D47, D91). Made by `tests/auth/office-tech-calendar-screenshots.spec.ts`.

| File | What it shows |
| --- | --- |
| `1440-default.webp` | `/office/calendar` with no view chosen: the week, Sunday to Saturday (D94 (a), (b)) |
| `390-default.webp` | The same address on a phone: today's day, as cards (D94 (b)) |
| `1440-day.webp` | Day view: one column per technician |
| `390-week.webp` | Week view on a phone: one section per day |
| `1440-drawer.webp`, `390-drawer.webp` | A visit's drawer, with the link to the call card |
| `1440-range-edge.webp`, `390-range-edge.webp` | The last week of the range: days after the range are greyed, "next" is disabled (D94 (d)) |

The local stack is shared, so the technician list also holds technicians made by earlier test runs (two "טכנאי בדיקה" and two "טכנאי שני בדיקה").

## Changes from the approved skeleton (D81)

1. **Week is Sunday to Saturday (7 columns), not Sunday to Thursday.** Reason: owner answer D94 (a), same as the technician calendar (D89).
2. **Default view by device: week on desktop, day on phone**, when the address names no view; the chosen view stays in the address. Reason: D94 (b).
3. **Day arrows move one calendar day** (Friday and Saturday included) instead of skipping to the next work day; their names are "יום קודם" / "יום הבא". Reason: D94 (a) makes Friday and Saturday days of the calendar.
4. **Range: one month back, three months forward.** A date outside is moved to the nearest edge; the arrow at the edge is dimmed and disabled; days of an edge week outside the range are greyed ("מחוץ לטווח היומן") and not read. Reason: D94 (d).
5. **"אין הרשאה" state** for a role without the permission key `cal`; nothing is read. Reason: D94 (c) (visibility by `cal`, checked on the server).
6. **The drawer's "לכרטיס הקריאה המלא" shows only for roles with `calls`**, and "חיוג לטכנאי" only when the technician's work phone is readable (Manager, Creator). Reason: no link to a screen the role cannot open; RLS decides the phone.
7. **Technicians shown**: every technician who accepts invitations, plus any with a visit that week, by name (the skeleton had four fixed ones). Reason: real data.
8. **Test-data banner** only when a shown record is test-marked; test records are hidden on Production after go-live. Reason: D91.

## Additions after the independent review (22.11)
- "יומן טכנאים" appears in the menu only when the user has `cal` (D94 (c)); before, every office role saw it and the page denied. Review nit 4.
- After go-live the drawer's technician read drops test rows (D91). Review nit 3.
- Customer Service navigation (D60 (4), D96): "יומן טכנאים", "קריאות", "זימונים שלא נקלטו" — `390-cs-nav.webp`, `1440-cs-nav.webp`.
