# Step 2, PR 2.2 (port alignment): review notes and screenshots

Branch `claude/step2-pr22-port-alignment`, based on `main` `71a03f0`. PR 2.2 of the reviewed Step 2 plan (§3.7 items a–j, §5.1, §6 row 2.2): the account and settings ports, their validators, the demo adapter and the simulated commands now match Migration 1 (PR 1.3, `supabase/migrations/20261104120000_access_and_permissions.sql` on PR #12; not applied, not merged). UI demo only (`/dev/demo`); fictional, test-marked data (D47); no migration, no remote Supabase operation, no protected file, no new package, no permission value changed.

Placement follows D57 (1): the Manager's account administration is Settings › "משתמשים" (`/dev/demo/office/mgr/settings/accounts`); the Creator's is Settings › "משתמשים והרשאות" (`/dev/demo/office/creator/settings/users`). No route changes in this PR.

## What changed (plan §3.7)

| Item | Change | Visible? |
|---|---|---|
| a. Versions | `version` on `UserAccount`, `AccountRequest`, `TechnicianSetting`; every account and technician edit command takes one input object with `expectedVersion` and returns the version as stored after it (`{ version }`); a stale version gets "הנתונים השתנו בינתיים. רעננו את הדף ונסו שוב." (the PT409 text). Demo versions are not all 1. The matrix's `setPermission` has no version yet (GAP, below). | No |
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

- **Versions after a stored action (resolved in the review fix pass, CA-1):** each versioned command returns the version as stored after it, and the accounts table, the request lists and the "פעיל" switch send `versionAfter(result, read)` next. Still open for the real adapter (PR 2.5+): a stored approval of an activation or role change bumps the ACCOUNT's version, which `decide_account_request` does not return, so that screen reads the account again (`router.refresh()`) before acting on the row.
- **GAP, the matrix (CA-4; Step 10, Step 2 plan Q13):** Migration 1 `admin_set_role_permission(p_role, p_key, p_allowed, p_expected_version, p_reason)` requires the cell's version (`role_permissions.version`); `settings.setPermission(role, key, value)` and the matrix cells carry none yet. The matrix adapter adds a cell version and `expectedVersion` (no value changes).
- GAPs carried to PR 2.3 (spec §1 e, i): `UserAccount` has no invitation alias, so an edit form cannot show the current one; the "השלמת יצירה" command is not defined yet.
- **PR 2.3 test obligations (CA-5 c, d):** the cancel of an approved, unfulfilled creation in "הבקשות שלי" end to end (no fixture is in that state in 2.2; its offer and its line are the unit-tested `requesterMayCancel`, `cancelledRequest` and `requestOutcomeLine`), with the Creator's "בקשות לאישור" offering no cancel; `accounts.openCreations()` and `accounts.creatorNotices()` through their loaders (the selection is the unit-tested `creatorNoticesOf`; the loader must filter intents by the viewer); the credential and routine-update commands through their screens, including the caller checks of their wiring.
- **Fixture `aev-3` (N4):** a Manager's Outlook-email change. The database allows it (`admin_update_technician`); the app keeps it for the Creator while Q14 is open, so PR 2.3 labels such a notice in the card, or the fixture changes with the owner's answer.
- Plan screen #5 lists "טכנאי" among the "+ הוספת משתמש" options; the demo adds technicians on Settings › "טכנאים" (unchanged here).

## Review dispositions

Two independent reviews of `66cacbe` (contract alignment; security and scope) found no must-level issue. Every finding is listed with what was done. "Test" names the test that fails without the fix; each was checked by reverting the fix (mutation) where it says so.

| ID | Severity | Disposition | Test |
|---|---|---|---|
| CA-1 | should | **Fixed.** The versioned commands (`decideAccountRequest`, `cancelAccountRequest`, `deactivateAccount`, `activateAccount`, `updateProfile`, `updateTechnician`, `settings.setTechnicianActive`) return `CommandResult<VersionedResult>` (`{ version }`, as every Migration 1 edit function returns the new version; the simulation returns the version it checked, unchanged). `versionAfter(result, read)` (`features/data-access/common.ts`) gives the version to send next: the stored result's, else the one read. The accounts table, "הבקשות שלי" / "בקשות לאישור" and the "פעיל" switch keep it. Not fixed in 2.2: a stored approval that changes an ACCOUNT (activation, role change) returns the request's version only; recorded for the real adapter (re-read the account) in "Notes for later PRs". | Unit "after a STORED edit the next one sends the returned version…" (mutation: `versionAfter` ignoring `simulated` fails it). No e2e: the demo has no stored adapter. |
| CA-2 | should | **Fixed.** `AccountRequest.cancelledAfterApproval`; `requestOutcomeLine` (pure) prints "אושרה על ידי <decider> · <time> · בוטלה" for it, never the approver as the canceller; `cancelledRequest` keeps `decidedBy` / `decidedAt` on an approved request, and the screen keeps the approval's time label. The adapter reads the flag from the row (`cancelledAfterApprovalOf`: a cancelled "create" whose decider is not its requester; Migration 1 sets `decided_by` on a pending cancel to the requester and keeps the approving Creator otherwise), not from the audit row the reviewer suggested: a Manager reads only his own audit rows, so he could not read the Creator's cancellation. | Unit "CA-2/g: an approved creation cancelled later keeps its approver…" (mutation: dropping the `cancelledAfterApproval` branch fails it). |
| CA-3 | should | **Fixed (both paths kept).** `technicianActiveError(input, stored, viewerRole)`: the Creator only; a Manager gets the Q14 text (as `updateTechnician({ active })`), anyone else "אין לך הרשאה לפעולה הזו."; `settingsTabState("techs", role)` passes `selfRole` (no account id). Port docs (settings header, `setTechnicianActive`, `updateTechnician`) and `docs/architecture-data-access.md` say so. | Unit "\"פעיל\" of a technician is the Creator's only for now (Q14), on both of its command paths" (mutation: removing the caller check fails it). |
| CA-4 | should | **Fixed as a recorded GAP** (the fix the review asks for): the `setPermission` port doc, `docs/architecture-data-access.md` and "Notes for later PRs" record the missing version for the matrix adapter (Step 10, Q13); the README's item a now says "every account and technician edit command". The optional cell version is not added: it changes the matrix DTO, fixtures and screen, outside §3.7 a–j, and no matrix value may change. | — (documentation) |
| CA-5 | should | **Fixed for a, b, d; c recorded.** (a) e2e raw-response test: `selfRole` "mgr" on the Manager's Settings › "משתמשים", "creator" on the Creator's "משתמשים והרשאות" and "טכנאים", none for Customer Service. (b) שיראל's stored version is 3 (two routine updates), so the Manager's deactivation e2e fails if the screen sends any version but the one read (אדי, version 2, already pins the switch). (d) The checks moved out of `SimulatedCommands` into pure, unit-tested validators: `decideRequestError`, `accountStateCommandError`, `profileUpdateCommandError`, `technicianUpdateCommandError`, `creatorNoticesOf`, `sessionUserOf` (the demo adapter and the simulated commands call them). (c) Not added: an approved, unfulfilled request would be a new visible row, and PR 2.2's visible changes are the two of the plan (L528); its offer and line are the unit-tested pure helpers, and the end-to-end path is a PR 2.3 test obligation (below and `docs/testing.md`). Still uncaught by any test, by design until PR 2.3: the hard-coded version for approve and reject (Migration 1 never updates a pending request, so every pending fixture is version 1), `openCreations` through a loader, the wiring of the credential commands (no screen), the screen wiring of `versionAfter` (`AccountAdminScreen.tsx`, `AccountAdminRequests.tsx`), the `storedVersion` update in `SettingsShellToggle.tsx`, the cancel label in `AccountAdminRequests.tsx` (no stored adapter in the demo), and the two call sites `creatorOnlyError(state.selfRole)` in the simulated `createAccount` and `managerOnlyError(state.selfRole)` in the simulated `requestAccount` (`app/dev/demo/_components/SimulatedCommands.tsx`; the helpers themselves are unit-tested). Found by the independent verification; PR 2.3 obligations. | e2e "the simulated commands' caller is the page's role…" (mutation: `selfRole` "creator" on every page fails it); e2e "Manager: deactivation asks to confirm…" (mutation: `expectedVersion: 1` fails it); unit "CA-5/S1" decide and (de)activation tests (mutations: removing either stale check fails them); unit "CA-5 d" notices and session tests (mutations: notices including non-pending requests, a session for an inactive account, fail them). |
| CA-6 | nit | **Fixed** with S1 (below). | see S1 |
| CA-7 | nit | **Fixed.** The refusals now use the database mapping's texts: an unknown request on decide is "חלק מהפרטים חסרים או שגויים." (22023); not pending "הבקשה כבר טופלה." (`REQUEST_MESSAGES.notPending`, shared with the 55000 mapping); an unknown or out-of-scope account (deactivate, activate, a request's target) and an unknown technician "אין לך הרשאה לפעולה הזו." (42501); an unknown account for a password or email change 22023. The `validate.ts` header now says exactly which refusals share the database's text (input-shape messages stay more specific). | Unit "CA-7: unknown or out-of-scope records…" |
| CA-8 | nit | **Fixed.** `areq-5` is version 3 (approved, then fulfilled); the fixture comment explains 1 / 2 / 3. | — (fixture) |
| CA-9 | nit | **Fixed** with S4. | see S4 |
| CA-10 | nit | **Fixed.** `UpdateProfileInput`, `UpdateTechnicianInput` and both port docs say that the checks run on the patch as sent, before the adapter fills the unchanged fields (protected by `expectedVersion`). | — (documentation) |
| CA-11 | nit | **Fixed (documented).** `createAccount` and `NewAccountInput` say that Technicians are created with `createTechnician` and that "tech" here covers phases 1–3 only (`technicianMissing: true`). The type is not narrowed: the plan keeps "tech" at the port (spec §1 f). | — (documentation) |
| S1 | should | **Fixed.** Who may call, as Migration 1's `require_caller`, in shared validators: `creatorOnlyError` (decide, `createAccount`, credentials), `managerOnlyError` (`requestAccount`), `accountAdminCallerError` ((de)activation, `createTechnician`, routine updates), `managerActivationError` (a Manager's Customer Service activation: "הפעולה דורשת אישור של היוצר.", `REQUEST_MESSAGES.needsCreator`, shared with the 55000 mapping). Every simulated account command checks the caller first; the provider comment and `docs/architecture-data-access.md` list what is modelled and what is not. | Unit "S1/CA-6: who may call each account command", "CA-5/S1" decide and (de)activation tests. |
| S2 | should | **Fixed** with CA-3 (the caller check, not only the docs). | see CA-3 |
| S3 | should | **Fixed.** `profileUpdateError` and `technicianUpdateError` accept only their input keys (an email, a role or a test marker is refused, never dropped) and refuse a patch with no field ("אין שינוי לשמור", as `productUpdateError`); the Customer Service create request accepts exactly `kind`, `name`, `email`. | Unit "S3/N2/N3: routine updates refuse extra keys and an empty patch…" |
| S4 | should | **Fixed.** `phoneError` allows digits, "+", "-" and the ASCII space only (the database CHECK `^[0-9+ -]{3,20}$`). | Unit "S4/CA-9: a phone allows only digits, + - and the ASCII space" |
| N1 | nit | **Fixed.** `expectedVersionError` refuses versions above 2,147,483,647 (`VERSION_MAX`, the `integer` range). | Unit "a. versions…" (2**31, 1e21) |
| N2 | nit | **Fixed.** `routineUpdateCallerError` refuses a Manager's target without an id (fail closed). | Unit "S3/N2/N3…" |
| N3 | nit | **Fixed.** `profileUpdateCommandError` / `technicianUpdateCommandError` check the caller's role first, then the fields, then who may update this record, then the version (Migration 1's order). | Unit "S3/N2/N3…" (a Customer Service caller with a bad name gets "no permission") |
| N4 | nit | **Fixed (documented).** A comment on `aev-3` and "Notes for later PRs" say the change is allowed by the database and narrowed by the app (Q14), for PR 2.3 to label. | — (documentation) |

Screens: no visible change from the fix pass (the two visible changes of PR 2.2 are unchanged); the screenshots were taken again from a local production build of the fix commit and are identical, so none is replaced.
