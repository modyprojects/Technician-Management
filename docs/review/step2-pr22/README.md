# Step 2, PR 2.2 (port alignment): review notes and screenshots

Branch `claude/step2-pr22-port-alignment`, based on `main` `71a03f0`. PR 2.2 of the reviewed Step 2 plan (§3.7 items a–j, §5.1, §6 row 2.2): the account and settings ports, their validators, the demo adapter and the simulated commands now match Migration 1 (PR 1.3, `supabase/migrations/20261104120000_access_and_permissions.sql` on PR #12; not applied, not merged). UI demo only (`/dev/demo`); fictional, test-marked data (D47); no migration, no remote Supabase operation, no protected file, no new package, no permission value changed.

Placement follows D57 (1): the Manager's account administration is Settings › "משתמשים" (`/dev/demo/office/mgr/settings/accounts`); the Creator's is Settings › "משתמשים והרשאות" (`/dev/demo/office/creator/settings/users`). No route changes in this PR.

## What changed (plan §3.7)

| Item | Change | Visible? |
|---|---|---|
| a. Versions | `version` on `UserAccount`, `AccountRequest`, `TechnicianSetting`; every edit command takes one input object with `expectedVersion`; a stale version gets "הנתונים השתנו בינתיים. רעננו את הדף ונסו שוב." (the PT409 text). Demo versions are not all 1. | No |
| b. Session port | `features/auth/data` (`SessionQueries.current()` → `SessionUser`); the demo's `demoSession` in `_data/adapter.ts`; the signed-in demo account is read through it. | No |
| c. Creator credentials | `setPassword`, `changeEmail` (port, validators, simulated commands). Dialogs are PR 2.3. | No |
| d. Creator notices | `accounts.creatorNotices()` with fictional audit stand-ins. The card is PR 2.3. | No |
| e. Routine updates | `updateProfile`, `updateTechnician` with patch semantics; the Manager's Outlook email and "פעיל" are refused (TEMPORARY, Q14). The edit UI is PR 2.3. | No |
| f. No Creator creation | `NewAccountInput.role` is Manager, Customer Service or Technician; the form shows a disabled "יוצר · ממתין להחלטת בעלים" and a note (TEMPORARY, Q9). | **Yes** |
| g. Cancel like the database | The requester cancels his own pending request or his own approved, unfulfilled creation; the Creator only an approved, unfulfilled creation (he rejects a Manager's pending request with a reason). | No (no such fixture) |
| h. No phone on the request | The Manager's Customer Service request is name and email only; the note says the phone is added after the account is created. | **Yes** |
| i. Request kinds | `db-codes.ts`: `role-change` ↔ `role_change`; `direct_create` rows are creation intents (`accounts.openCreations()`), never requests. The rows are PR 2.3. | No |
| j. Missing technician profile | `UserAccount.technicianMissing` (`technicianProfileMissing()`). The row is PR 2.3. | No |

**TEMPORARY behaviours (deny by default, owner questions of the Step 2 plan):** Q9 (no Creator account through the app), Q14 (a Manager does not change a technician's Outlook email or "פעיל"), Q17 (a test account keeps an `example.test` address on an email change), Q1 (accounts are created without a password; only the Creator sets one), Q12 (the app checks only "not empty" and at most 72 bytes; strength is Supabase's).

## Screenshots

Taken with the "step2-pr22" block of `tests/e2e/screenshots.spec.ts` (Playwright, Chromium) from a local production build of this branch, at 390 × 844, 820 × 1180 and 1440 × 900 px:

```
npm run build
SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-pr22"
```

| Screen | 390 | 820 | 1440 | Demo counterpart |
|---|---|---|---|---|
| Creator, Settings › "משתמשים והרשאות", "+ הוספת משתמש" open (full page) | `390-creator-add-user-form.png` | `820-creator-add-user-form.png` | `1440-creator-add-user-form.png` | `docs/review/ui-demo-3/<w>-demo-settings-users.png` (the demo's button is a toast) |
| The same form, cropped, with the role list shown open (the greyed "יוצר · ממתין להחלטת בעלים") | `390-creator-add-user-roles.png` | `820-creator-add-user-roles.png` | `1440-creator-add-user-roles.png` | — |
| Manager, Settings › "משתמשים", "+ בקשת חשבון שירות לקוחות" open (full page) | `390-mgr-cs-request-form.png` | `820-mgr-cs-request-form.png` | `1440-mgr-cs-request-form.png` | none (`docs/demo.html` has no request form; SE-01) |
| The request form, cropped (name and email only) | `390-mgr-cs-request-form-crop.png` | `820-mgr-cs-request-form-crop.png` | `1440-mgr-cs-request-form-crop.png` | — |

A closed native select hides its options, so the "roles" crop sets the select's `size` attribute for the shot only; on the page it is a normal drop-down.

## מה לבדוק (לבעלים)

1. הגדרות › משתמשים והרשאות (יוצר) › "+ הוספת משתמש": "יוצר" כבר לא ניתן לבחירה; מופיעה שורה "יוצר · ממתין להחלטת בעלים" שאי אפשר לבחור, והערה מתחת לטופס.
2. הגדרות › משתמשים (מנהל) › "+ בקשת חשבון שירות לקוחות": אין שדה טלפון; ההערה אומרת שהטלפון מוסיפים אחרי שהחשבון נוצר.
3. שאר המסכים לא השתנו: דחייה עם סיבה, ביטול בקשה ממתינה של המנהל, השבתה והפעלה עובדים כמו קודם.

## Deviations from the implementation spec (with reasons)

- **`CreationIntent.requestedBy`** is added to the DTO: the demo adapter has no session, and the spec asks the PR 2.3 loader to filter intents by the viewer before serializing, which needs the requester.
- **Technician versions:** יורם 1, אדי 2, שמואל 1 (the spec says שמואל 2). אדי's Outlook email change on 18.10 is the fictional notice `aev-3`, so his record is the one that changed.
- **`creatorNotices` in the demo** returns the demo Creator's view (it has no caller to deny); only the Creator's loader will call it (PR 2.3). Production denies other callers, as documented on the port.
- **`updateTechnician` (simulated)** also applies `testAccountEmailError` to a new Outlook email of a test-marked technician, as `createTechnician` does (D47; Migration 1 `technicians_test_outlook_email`).
- **`credentialEmailError`** treats a target without an explicit `isTest: false` as test-marked (fail safe).

## Notes for later PRs

- `SettingsShellToggle` lets "פעיל" be switched again after a success; the simulation never advances versions, so the second switch passes. With a real adapter the second switch would get PT409 unless the command returns the new version: PR 2.6/2.7 decides (for example, return the new version in `CommandResult.data`).
- GAPs carried to PR 2.3 (spec §1 e, i): `UserAccount` has no invitation alias, so an edit form cannot show the current one; the "השלמת יצירה" command is not defined yet.
- Plan screen #5 lists "טכנאי" among the "+ הוספת משתמש" options; the demo adds technicians on Settings › "טכנאים" (unchanged here).
