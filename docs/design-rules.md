# Design rules (from the owner review of 2026-11-18; D82)

Self-check every screen before sending screenshots. On conflict with `docs/decisions.md` the decision wins; stop and ask.
## Widths
- Office 390 / 1440 (D72); technician 390 / 820 (D70). No horizontal scroll.

## Frame and navigation
- Office phone header (≤600 px): MODY logo left, ☰ right opens a drawer from the right with the role's items and "יציאה". No tabs, no "יציאה" button in the top bar (D73). Built once in the shared office frame.
- Technician: fixed bottom navigation (TE-32): "היום" · "יומן" · "פרופיל" (D83).

## Lists and actions
- Phone: lists are cards, not tables. Row actions sit in one ⋮ menu (phone and desktop); the menu shows only what the server allows (D76).
- Destructive actions: red and last, in menus and in dialogs. Dialogs: centred modal on desktop, full screen on phone (D75).

## Text
- One short info box per screen at most, plus short help text where needed. Hebrew, RTL; LTR only for emails, phones, codes.
- No "ממתין להחלטת בעלים", "ממתין לאישור" or any other "ממתין..." placeholder text on a user-facing screen. If something is not built, leave it out.

## Status colours (one source, whole app)
- Visit statuses: `VISIT_STATUSES` (`components/ui/StatusPill.tsx`); call statuses: `CALL_STATUSES` (`components/ui/CallStatusPill.tsx`). Never hard-code a status colour.

| Status | Token | Colour |
|---|---|---|
| שובצה | `--s-new` | #1F5FA8 blue |
| בדרך | `--s-go` | #C79A00 amber |
| בטיפול | `--s-work` | #6A3FB5 purple |
| טופל / טופלה (call) | `--s-done` | #2E7D32 green |
| המשך טיפול | `--s-cont` | #C2570C orange |
| בוטלה | `--s-cancel` | #4A5563 grey |
| פתוחה (call) | `--accent` | #155E75 teal |
| ממתינה לשיבוץ (call) | `--warn-bd` | #E8B44A |
- Status is never colour alone: a text chip, or a legend where there is no room (calendar weekly 390).
- Date and time ranges are written start–end with `TimeRange` (`components/ui/TimeRange.tsx`).

## Test data (D74)
- One banner at the very top of the screen: "🧪 מוצגים נתוני בדיקה" — above notices, cards and filters.
- Each test row/record: a small quiet grey "בדיקה" marker (no colour, no border). Real records show nothing.

## Process
- Skeleton first (D81); after approval list every visible change under "Changes from the approved skeleton".
