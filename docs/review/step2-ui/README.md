# Step 2, PR 2.3 "screens first" (fake data): review notes and screenshots

Branch `claude/step2-pr23-screens`, based on `main` `7dbd72d`. PR 2.3 of the reviewed Step 2 plan (§6 row 2.3): the sign-in, sign-out and start prototypes, and the account screens' new dialogs and rows, all under `/dev/demo` with fictional, test-marked data (D47). Every action is simulated: nothing is saved, sent or signed in. Every new element is a PROPOSED row in `docs/demo-deviations.md` (AU-01 to AU-04, SE-17 to SE-20; Step 2 plan Q26). No database, migration, remote call, protected file, new package or permission value changed.

Placement follows D57 (1): the Manager's account administration is Settings › "משתמשים" (`/dev/demo/office/mgr/settings/accounts`); the Creator's is Settings › "משתמשים והרשאות" (`/dev/demo/office/creator/settings/users`).

## What changed

| Item | Where | Row |
|---|---|---|
| Sign-in "כניסה": the form, "פרטים שגויים", "כניסה לא זמינה", "אין גישה" (with "יציאה"); no sign-up, no "שכחתי סיסמה" | `/dev/demo/login[?state=…]` | AU-01 |
| "יציאה": the office sidebar's user block (at ≤ 900 px only the button, at the end of the top bar), the technician profile's "חשבון", the no-access state | every office demo page; `/dev/demo/tech/profile` | AU-02 |
| Temporary start screens: name, role, one sentence, the pending label, only built navigation items | `/dev/demo/start/{creator,mgr,cs,tech}` | AU-03 |
| The technician's minimal profile: identity and sign-out only | `/dev/demo/start/tech/profile` | AU-04 |
| The Creator's "הגדרת סיסמה" and "שינוי כתובת מייל" (never on his own row) | Settings › "משתמשים והרשאות", row buttons "סיסמה", "מייל" | SE-17 |
| The Creator's "התראות חשבונות" (first card) | Settings › "משתמשים והרשאות" | SE-18 |
| "עריכת פרטים" (Creator: every field; Manager: no Outlook email or "פעיל") | both account screens, row button "עריכה" | SE-19 |
| "יצירה שלא הושלמה", an approved request without an account, "פרופיל טכנאי חסר" | both account screens; "בקשות לאישור" / "הבקשות שלי" | SE-20 |

**TEMPORARY behaviours (deny by default; nothing decided here):**

| Q | What this PR shows until the owner answers |
|---|---|
| Q1 | No password at creation; the Creator types one and hands it over; no forced change |
| Q2 | No reset link, no "שכחתי סיסמה" |
| Q4 | Sign-out in the office sidebar (and, at ≤ 900 px, at the end of the top bar), on the technician profile and in the no-access state |
| Q5 | The dialogs show the demo account's email; the real screens show "—" where it cannot be read |
| Q9 | No Creator account in "+ הוספת משתמש" (unchanged since PR 2.2) |
| Q12 | The app checks only non-empty and ≤ 72 bytes; the sign-in system decides strength |
| Q13 | The notices card and the Creator's account sections stay on Settings › "משתמשים והרשאות" |
| Q14 | The Manager never edits a technician's Outlook email or "פעיל"; completion uses one email for sign-in and Outlook; a Manager's Outlook-email change in the notices is labelled |
| Q15 | A failed creation after approval stays approved with "השלמת יצירה" / "ביטול"; approve-and-create in one action is PR 2.6 |
| Q16 | Cancelling an incomplete creation may leave an orphan sign-in user: not shown, reported |
| Q17 | Test accounts keep `@example.test` on an email change |
| Q18 | Start placeholder: shell, name, role, sign-out, one sentence, only built navigation items |
| Q22 | No "סיסמה" / "מייל" on the Creator's own row |
| Q23 | `55000` refusals as Hebrew business messages |
| Q25 | PR 2.3 (no database) merges before Step 1's owner check |
| Q26 | Every new UI element is a PROPOSED row |

"הגדרות" on the Manager's or the Creator's start prototype opens the full demo, which has the D57 five-item sidebar ("דשבורד" first): the prototype shows the Q18 option only (owner question א below).

## Screenshots

Taken with the "step2-ui" block of `tests/e2e/screenshots.spec.ts` (Playwright, Chromium) from a local production build of this branch, at 390 × 844, 820 × 1180 and 1440 × 900 px. Dialogs are shot open and empty: no typed password appears in any image.

```
npm run build
SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-ui"
```

Each file is `<w>-<name>.png` with `<w>` = 390, 820 or 1440.

| Name | Page / state | Demo counterpart |
|---|---|---|
| `login-form`, `login-failed`, `login-unavailable`, `login-no-access` | `/dev/demo/login[?state=…]` | none (new UI) |
| `start-creator`, `start-mgr`, `start-cs` | `/dev/demo/start/<role>` | `docs/review/step-0/<w>-demo-office.png` (the `.me` block) |
| `start-tech`, `start-tech-profile` | `/dev/demo/start/tech[/profile]` | `docs/review/ui-demo-2/<w>-demo-tech-profile.png` |
| `office-signout-topbar` | `/dev/demo/office/mgr/calls` (top of the page) | `docs/review/step-0/<w>-demo-office.png` |
| `tech-profile-signout` | `/dev/demo/tech/profile` (full page) | `docs/review/ui-demo-2/<w>-demo-tech-profile.png` |
| `creator-users` | `/dev/demo/office/creator/settings/users`, full page (notices, the table with the intent and גלעד, `areq-6`) | `docs/review/ui-demo-3/<w>-demo-settings-users.png` |
| `creator-notices` | the notices card (crop) | — |
| `creator-password-dialog` | "הגדרת סיסמה · שיראל", empty | — |
| `creator-email-dialog` | "שינוי כתובת מייל · הדס", with the Q17 note | — |
| `creator-edit-tech` | "עריכת פרטים · יורם" (every field) | `docs/review/ui-demo-3/<w>-demo-settings-techs.png` |
| `mgr-accounts` | `/dev/demo/office/mgr/settings/accounts` (full page) | `docs/review/manager-dashboard/<w>-mgr-settings-accounts.png` |
| `mgr-edit-tech`, `mgr-edit-cs` | "עריכת פרטים" on אדי (the Q14 line) and on שיראל | — |
| `mgr-complete-creation` | "השלמת יצירה · טכנאי חדש" | — |
| `complete-technician` | "השלמת פרופיל טכנאי · גלעד" (the Creator's screen) | — |
| `creator-complete-request` | "השלמת יצירה · נציגת ערב" | — |

The drawer takes the whole width at 390 px (as the demo's drawer and "תיקון ביקור סגור"), so a phone dialog shot shows only the dialog.

## מה לבדוק

1. מסך הכניסה (`/dev/demo/login`): אימייל וסיסמה בלבד, בלי הרשמה ובלי "שכחתי סיסמה". ההודעות במצבים "פרטים שגויים", "כניסה לא זמינה" ו"אין גישה" (עם כפתור "יציאה"). רקע כהה עם הלוגו הלבן, והמשפט "אין הרשמה עצמית. חשבונות נפתחים רק על ידי הנהלת המערכת."
2. כפתור "יציאה": במחשב בסרגל הצד ליד השם; בטלפון ובטאבלט בסוף הסרגל העליון; אצל הטכנאי בפרופיל, תחת "חשבון".
3. מסכי הפתיחה הזמניים לכל תפקיד: שם, תפקיד, משפט שהמסכים יגיעו בהמשך, ורק פריטי תפריט שכבר בנויים. אצל מנהל ויוצר מופיע זמנית "בית" (ראו שאלה א׳).
4. יוצר › הגדרות › משתמשים והרשאות: כרטיס "התראות חשבונות" בראש העמוד; "עריכה" בכל שורה; "סיסמה" ו"מייל" בכל שורה חוץ מהשורה שלך.
5. חלון "הגדרת סיסמה": הסיסמה לא מוצגת שוב, לא נשמרת באפליקציה ולא נשלחת במייל או בהודעה. חלון "שינוי כתובת מייל": בחשבונות בדיקה רק כתובות ‎@example.test.
6. "עריכת פרטים": היוצר רואה גם מייל ב-Outlook ו"פעיל"; המנהל לא, ובמקומם מופיעה השורה "ממתין להחלטת בעלים".
7. שורות "יצירה שלא הושלמה" ו"פרופיל טכנאי חסר", ובקשה שאושרה אבל החשבון עוד לא נוצר: כפתורי "השלמת יצירה", "ביטול" ו"השלמה".
8. כל הפעולות מדומות: שום דבר לא נשמר ולא נשלח.

## Owner items (Hebrew; questions first, then notices; nothing is decided here)

**שאלות:**
- א. **מנהל ויוצר לפני שהדשבורד האמיתי מחובר.** D57 קובע חמישה פריטי תפריט ו"דשבורד" כמסך פתיחה. שאלה 18 בתוכנית קובעת להציג רק מסכים שכבר בנויים. באב-הטיפוס מוצג זמנית "בית" עם "הגדרות" בלבד. מה עדיף: (1) "בית" זמני עד שהדשבורד מחובר; (2) מסך "דשבורד" אמיתי שמציג "לא זמין" עד שיש נתונים?
- ב. **נוסח כפתור היציאה.** "יציאה" (כמו בתוכנית), "התנתקות" או "יציאה מהחשבון"? אצל הטכנאי "יציאה" משמש גם ל"יציאה ללקוח".
- ג. **חלון "הגדרת סיסמה".** להוסיף כפתור הצגה/הסתרה בזמן ההקלדה, כדי שהיוצר יוכל למסור את הסיסמה? לא נבנה עד שתחליט.
- ד. **מסך הכניסה.** רקע כהה עם הלוגו הלבן (מחוץ לכותרות הכהות שאושרו ב-D57), והמשפט "אין הרשמה עצמית. חשבונות נפתחים רק על ידי הנהלת המערכת." האם לאשר? האם להוסיף משפט כמו "שכחתם סיסמה? פנו למנהל המערכת"?

**לידיעה (התנהגות זמנית עד החלטה, לא הוחלט דבר):**
1. כל המסכים החדשים נוספו כשורות "מוצע" ב-`demo-deviations.md` (שאלה 26).
2. "יציאה" בשלושה מקומות. בטלפון ובטאבלט הכפתור נשאר בסוף הסרגל העליון, ובזה הוא שונה מהדמו (שאלה 4).
3. אין "סיסמה" ו"מייל" בשורה של היוצר עצמו, כי אין עדיין מסך שינוי עצמי (שאלה 22).
4. היוצר קובע סיסמה ומוסר אותה בעצמו, ואין חובה להחליף סיסמה בכניסה הראשונה (שאלה 1).
5. המנהל לא משנה מייל ב-Outlook ולא "פעיל". בהשלמת יצירה אותו מייל משמש לכניסה ול-Outlook. התראה על שינוי מייל ב-Outlook שעשה מנהל מסומנת (שאלה 14).
6. בשורה של טכנאי, שדה "שם" אחד מעדכן גם את שם החשבון וגם את השם ביומן (החלטה טכנית).
7. בחשבונות בדיקה כתובת חדשה חייבת להיות ב-‎@example.test (שאלה 17).
8. בקשה שאושרה אבל החשבון לא נוצר מוצגת עם "השלמת יצירה" ו"ביטול". אישור ויצירה בפעולה אחת ייבנו ב-PR 2.6 (שאלה 15).
9. ביטול יצירה שלא הושלמה עלול להשאיר משתמש התחברות שהמייל שלו תפוס. זה לא מוצג במסך, וזה חוסם עלייה לאוויר (שאלה 16).
10. במסכים האמיתיים, כשאי אפשר לקרוא את המייל של חשבון, יוצג "—" (שאלה 5).
11. "התראות חשבונות" וניהול החשבונות של היוצר נשארים ב"משתמשים והרשאות" (שאלה 13).
12. PR 2.3 (בלי מסד נתונים) ממוזג לפני בדיקת הבעלים של שלב 1 (שאלה 25).
13. טכנאים עדיין נוספים דרך "+ הוספת טכנאי", לא דרך "+ הוספת משתמש" (כמו מאז PR 2.2).
14. הודעת "הכניסה אינה זמינה" אחרי שליחת הטופס (כשהטופס נשאר) תיבנה עם הכניסה האמיתית ב-PR 2.5.
15. השם "כינוי בזימונים" לשדה הכינוי מוצג לביקורת.
16. ביקורת בלתי תלויה של כללי ההרשאות החדשים נדרשת (D53 (4)) ותירשם ב-PR.

## Deviations from the implementation spec (with reasons)

- **Actions cell layout:** `.acct-actions` is a two-column grid, not a wrapping flex row with `max-width: 200px`. The cell is `.col-fit` (`width: 1%`), where a wrapping row shrinks to one button per line; the grid keeps the spec's rule exactly (at most two buttons per line, five actions on three lines), pinned by E4.
- **Shared dialog parts:** `DialogNotes`, `ColorChoice` and `DIALOG_FAILED` live in `AccountDialog.tsx` (used by the credential, edit and completion forms); `said()` moved to `AccountAdminParts.tsx` (one copy for the screen, the request lists and the dialogs).
- **`AccountAdminRequests` props:** `scope` (the display rules take it) and `onComplete(created, simulated)` (the created records, as the command returned them, for the accounts table). The request's entry becomes local with the account bound through the existing `onUpdate`.
- **Edit form's required colour:** "צבע ביומן" is required where the stored colour is unknown (`technicianColorTokenOf` null): a save then says "צבע לא תקין" on the field. The Creator's Outlook email is also checked for `example.test` on a test technician in the form (the same rule the command runs), so the error goes to its field.
- **Route builder type:** `routes.ts` (client-safe) declares the viewpoint union locally (`"tech" | OfficeRole`), since `roles.ts` is server-only and imports `routes.ts`.
- **The technician tabs constant** `DEMO_START_TECH_TABS` is in `_data/roles.ts` (a page file may export only Next's page exports).
- **Backdrop checks at 390 px:** the drawer takes the whole width there, so the "press the dimmed background" steps of E4 run at 820 and 1440 only.
