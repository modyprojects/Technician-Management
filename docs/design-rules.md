# Design rules (from the owner review of 2026-11-18; D82)

Self-check every screen against this list before sending screenshots. Conflict with `docs/decisions.md`: the decision wins; stop and ask.

## Widths
- Office roles (Manager, Creator, Customer Service): 390 and 1440 (D72).
- Technician: 390 and 820 (D70). No horizontal scroll at any width.

## Frame and navigation
- Office phone header (≤600 px): MODY logo left, ☰ right opens a drawer from the right with the role's items and "יציאה". No tabs, no "יציאה" button in the top bar (D73). Built once in the shared office frame.
- Technician: fixed bottom navigation (TE-32): "היום" · "יומן" · "פרופיל" (D83).

## Lists and actions
- Phone: lists are cards, not tables.
- Row actions sit in one ⋮ menu (phone and desktop); the menu shows only what the server allows (D76).
- Destructive actions: red and last, in menus and in dialogs.

## Dialogs
- Desktop: centred modal. Phone: full screen (D75).

## Text
- One short info box per screen at most, plus short help text where needed. No long explanations.
- No "ממתין להחלטת בעלים", "ממתין לאישור" or any other "ממתין..." placeholder text on a user-facing screen. If something is not built, leave it out.
- Hebrew, RTL; LTR only for emails, phone numbers and codes.

## Test data (D74)
- One banner at the very top of the screen: "🧪 מוצגים נתוני בדיקה" — above notices, cards and filters.
- Each test row/record: a small quiet grey "בדיקה" marker (no colour, no border). Real records show nothing.

## Process
- New screen: skeleton first (D81): real components, fake data, 390 + the role's wide width, 3–5 Hebrew questions.
- After approval: list every visible change under "Changes from the approved skeleton" with a reason.
