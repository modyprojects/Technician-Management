# Step 2: unified user management (D60 (7)): the server side and the screens

Branch `claude/step2-user-management` (draft PR #36), merged with `main` after PR #33 (the approved sign-in and the self-service password reset, D65, with their review fixes). The server side (sections 1–8), the **real screens**: Settings › "משתמשים" (the Manager) and Settings › "משתמשים והרשאות" (the Creator), one screen component for both (section 9), and the **independent review's fixes**, with the owner's decision D67 and the D66 record of the secret key (section 10). Nothing remote was accessed apart from `git fetch`: no Supabase or Vercel operation, no migration, no change to `supabase/config.toml`, no new package; the only protected files that changed (`CLAUDE.md`, `docs/security.md`) came unchanged from `main` through the merge.

Code written by Claude Code under the direction of the repository owner.

## 1. What was built

| Item | Where | Notes |
|---|---|---|
| Ports aligned with D60 (7) | `features/accounts/data/ports.ts`, `types.ts` | `AccountsQueries` / `AccountCommands` are what the real screen uses. New: `changeRole`, `cancelCreation`, `deleteAccount`, `get`. The retired request path of D34 (a) (`requests`, `requestAccount`, `decideAccountRequest`, `cancelAccountRequest`) moved to `RetiredAccountRequest*`, used only by the `/dev/demo` prototype (D61 (1)); no real implementation exists |
| D60 (7) rules | `features/accounts/data/validate.ts` (end of file) | `creationCallerError`, `roleChangeError`, `deleteAccountError`, `credentialTargetError`, `cancelCreationError`, `ownCreationIntentError`, `isOwnAccount`, `actionReasonError`. Each mirrors a database refusal, so the app refuses early with the same message |
| Input re-validation | `features/accounts/supabase/schemas.ts` | A strict Zod shape per action (unknown keys, wrong types, non-UUID ids and over-long strings refused, never dropped), then the shared Hebrew rules; normalized values (trimmed, lower-case email and ids). No message repeats an input value |
| Queries under the caller's session | `features/accounts/supabase/queries.ts`; wired by `lib/data/supabase/accounts.ts` | RLS decides the rows; the viewer only narrows. Bounded (default 40, at most 100). Deleted accounts never listed. A Technician's Outlook email and "פעיל" only for the Creator (Q14) |
| Commands (the orchestration) | `features/accounts/supabase/commands.ts` | Injected clients (`db` under the caller's session, the Auth Admin port, the session's viewer), so the local-stack tests run the same code |
| Auth Admin port | `features/accounts/supabase/auth-admin.ts` | Five narrow functions: create a user for a creation intent (confirmed, no password, the intent nonce and `is_test` in `app_metadata`, never a role), read one user's facts, set a password, set an email (confirmed, no email sent), ban for a deletion. Failures classified as unavailable / refused (definite 4xx) / uncertain (network, 408, 5xx); never Auth's text. No logging |
| Admin client | `lib/supabase/admin.ts` | `server-only`; reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` inside the call (never at module load); exports only the narrow port; without a valid key every call is "unavailable" |
| Admin configuration schema | `features/auth/env-schema.ts` `parseSupabaseAdminEnv` | New-format `sb_secret_…` keys only (a legacy JWT `service_role` key or a publishable key is refused); problems are codes, never values |
| Server actions | `lib/actions/accounts.ts` | 13 `"use server"` actions in a `server-only` module; input taken as `unknown`; the caller from the server-validated session (`lib/auth/session.ts`), never from the input |
| Hebrew messages | `features/data-access/supabase-errors.ts` `ACCOUNT_MESSAGES` | Migration 5's refusal texts (deleted account, retired requests, D49 promotion), the multi-step outcomes (creation incomplete or cancelled, field profile missing, revoke incomplete) |
| Demo alignment | `app/dev/demo/_data/adapter.ts`, `_components/simulated-commands.ts`, `office/[role]/users/_accounts.ts` | The fixture adapter implements `get` and the unified `AccountListEntry`; the simulated commands implement the three new commands with the shared rules (the prototype offers none of them); the demo loader passes the screen `UserAccount` only, so the field profile reaches the page only through the scope-mapped `technicians` (Q14) |

**Unchanged:** every migration, `supabase/config.toml`, the permission values (D51), every protected file, every user-facing route. No new package.

## 2. D60 (7) alignment

| D60 (7) / QA | Server side |
|---|---|
| The Manager adds Technician and Customer Service users directly, one "הוסף משתמש", a role choice (M-06, C-01) | `createAccount` (`cs`) and `createTechnician`: Migration 5 `authorize_account_creation` and `admin_create_profile` accept them for the Manager; no Creator approval |
| The Manager edits permitted details and activates or deactivates these users, no approval | `updateProfile`, `updateTechnician`, `activateAccount`, `deactivateAccount` (Migration 5 `admin_set_user_active`) |
| "בקשות לאישור" removed (C-02) | No action, query or server path for requests; the database refuses `request_account_change` and `decide_account_request` to every role; the unit test pins that `lib/actions/accounts.ts` names none of them |
| A deactivated user cannot sign in; history kept | The profile row stays; RLS needs an active profile, so the session gives no access (tested) |
| Managers never change roles; only the Creator | `changeRole`: the app refuses a non-Creator before any call; `admin_set_user_role` refuses too |
| Only the Creator manages Manager and Creator accounts | The Manager's scope is `cs` and `tech` in the app and in the database (RLS, `require_caller`, the role checks) |
| D34 (e): Managers never set or reset passwords or change an email | `setPassword` / `changeEmail`: Creator only, never his own account (Q22), after `assert_can_change_credentials` |
| Deletion, Option A: Creator only, after explicit confirmation; access revoked for good; profile marked deleted, hidden, never reactivated; history and attribution kept | `deleteAccount` with `confirm: true`: `admin_delete_user` first, then the Auth ban (section 5) |
| Auditing and the Creator's in-app notice | Every write is audited by its database function; `creatorNotices` reads a Manager's deactivations and Outlook-email changes by anyone but the viewing Creator |
| Enforced in the database and on the server | Every action calls its database function under the caller's own session; every Auth Admin call comes after a database check (section 3) |

## 3. The server actions

Every action re-validates its input, takes the caller from the session, and lets the database decide under the caller's own session **before** any Auth Admin call. "App check" is the early refusal with the database's own message; it never grants anything.

| Action | Who may call | Authorizing database call (caller's session) | Auth Admin call (only after it) |
|---|---|---|---|
| `createAccount` | Creator: Manager, Customer Service, Technician (account only); Manager: Customer Service, Technician. Never a Creator (Q9) | `authorize_account_creation` (phase 1, audited intent), then `admin_create_profile` binds the Auth user (phase 3) | `getUser` (retry detection), `createUserForIntent` (phase 2) |
| `createTechnician` | Creator, Manager | As above, then `admin_create_technician` (phase 4) | As above |
| `completeCreation` ("השלמת יצירה") | The requester of an open intent (Creator or Manager) | RLS read of his own intent, then `assert_can_manage(role)` (added in this pass), then `admin_create_profile` and, for a Technician, `admin_create_technician` | `getUser`, `createUserForIntent` |
| `cancelCreation` ("ביטול") | The requester, or the Creator | `cancel_account_request` (creation intents only) | none |
| `completeTechnicianProfile` ("השלמה") | Creator any; Manager within his scope | RLS read of the profile (a Technician, not deleted, no field profile), `assert_can_manage('technician')`, then `admin_create_technician` | `getUser` (the sign-in email becomes the Outlook email; never returned to a Manager) |
| `deactivateAccount` | Creator: anyone but himself; Manager: Customer Service, Technician | `admin_set_user_active` (audited; a Manager's is a Creator notice) | none |
| `activateAccount` | As above; never a deleted account | `admin_set_user_active` | none |
| `updateProfile` | Creator: any; Manager: Customer Service, Technician, never his own | `admin_update_profile` (name, phone, alias; never the email) | none |
| `updateTechnician` | Creator; Manager without the Outlook email and "פעיל" (Q14, app-only) | `admin_update_technician` (an Outlook-email change is audited for the Creator's notice) | none |
| `changeRole` | Creator only, never his own, never to Creator | `admin_set_user_role` | none |
| `setPassword` | Creator only, never his own | `assert_can_change_credentials` (audited; refuses a deleted account) | `setPassword` |
| `changeEmail` | Creator only, never his own; a test-marked account keeps `example.test` (Q17) | `assert_can_change_credentials` | `setEmail` (confirmed; no email sent) |
| `deleteAccount` | Creator only, `confirm: true`, never his own, never a Creator (OQ-1) | `admin_delete_user` (audited; a Technician's "פעיל" off); a repeated deletion ("נסו שוב") is authorized by its "already deleted" refusal, which Migration 5 raises only after checking the caller | `revokeAccess` (ban; an uncertain failure is tried once more at once, review S1) |

Queries (`lib/data/supabase/accounts.ts`): `list`, `get` (Creator: every role; Manager: Customer Service and Technician; anyone else nothing), `openCreations` (the Manager: his own intents; the Creator: every open intent with its requester, review S3), `creatorNotices` (Creator only: a Manager's deactivations, Outlook-email changes by others and, D67 (b), every account created by anyone but him). A failed read throws with a code only and the page fails closed.

Next.js checks the Origin of every server-action POST against the Host. No result or log line carries a password, a token, Auth's or the database's text; logs are an event name and a code (`lib/auth/log.ts`).

## 4. Failure handling (Step 2 plan §3.8)

| Where it fails | What the user is told | State left |
|---|---|---|
| No secret key (Auth Admin unavailable) | "unavailable" | Nothing written: creation, password, email and deletion stop before the database |
| Phase 1 refused (role, scope, open intent for the address) | The database's refusal in Hebrew | Nothing |
| Phase 2 uncertain (network, timeout, 5xx) | "יצירת המשתמש לא הושלמה…" | The intent stays open ("יצירה שלא הושלמה"); "השלמת יצירה" finds a user an earlier attempt created (a name-based id per intent) and binds it, never a second one |
| Phase 2 refused (address already in Auth, invalid) | The Auth reason in Hebrew | The intent is cancelled |
| Phase 3 binding refused (42501: nonce, time, role or email mismatch) | "…והיא בוטלה" | The intent is cancelled; the Auth user (no password, cannot sign in) stays (Q16) |
| Phase 4 failed | "…פרופיל הטכנאי לא נשמר" | The account exists as "פרופיל טכנאי חסר"; "השלמה" completes it |
| Deletion: the database committed, the ban failed (an uncertain failure is tried once more at once) | "…חסימת ההתחברות לא הושלמה. נסו שוב כדי להשלים אותה." with a "נסו שוב" button on the card (review S1: the row is gone, so the card keeps the account and the version it sent) | The profile is deleted (no access through RLS); "נסו שוב" sends the same deletion, which repeats only the ban: Migration 5 refuses an already deleted account only after checking the caller, his own account and a Creator target |
| Stale version | "data changed" (PT409) | Nothing |
| Any exception | The generic message; logged by event name only | Whatever the database committed |

## 5. Deletion: the Auth ban and its session effect

- **Order:** `admin_delete_user` commits first (profile inactive, `deleted_at`, `deleted_by`, a Technician's "פעיל" off, audited); only then the server bans the Auth user for about 100 years (`ban_duration: "876000h"`).
- **Why a ban:** a hard delete cannot succeed (`profiles.id` references `auth.users` `ON DELETE RESTRICT`) and would break attribution; a soft delete obfuscates the address that ties the Auth user to its history. The ban keeps the user row, its address and its D47 metadata.
- **Effect (tested against the local stack):** a new sign-in is refused (`user_banned`, shown as the one credential message); the refresh token is refused (`user_banned`); `getUser` with the old session fails, so every real page treats it as anonymous. The access token already issued stays valid until it expires (at most `jwt_expiry`, one hour), but it grants nothing: every policy needs an active profile, so the user's own profile and `my_technician_id()` read nothing.
- **Reversibility:** only an Auth administrator with the secret key could lift the ban; no app path does. The database keeps the account frozen whatever Auth says (no reactivation, edit, role or credential change).

## 6. Tests and results

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` | clean |
| Node CI tests | `npm run test:ci` | 208/208 |
| Build (no Supabase env, from an empty `.next`) | `npm run build` | passed (the first run stops with Next 16.4.3's advisory nudge, the retry builds; no upgrade, section 7) |
| Bundle scan | `npm run scan:bundle` | passed, 7,948 browser files |
| Unit spec | `npx playwright test tests/e2e/accounts-server.spec.ts` | 25/25 (desktop project; the other two projects skip by design) |
| Default e2e suite | `npm run test:e2e` | 2,760 passed, 0 failed (2,982 skipped by project scoping and on-demand specs). The first run had 1 failure, fixed (section 7, item 6) |
| Local stack, no Creator | `node tests/accounts/run-local.mjs` | 13 passed, 8 skipped (the Creator's cases) |
| Local stack, with the local Creator | `node tests/accounts/run-local.mjs --with-creator` | 21/21 |
| Existing sign-in suite | `node tests/auth/run-local.mjs` | 13 passed (3 on-demand screenshot cases skipped), unchanged (run before the demo-loader fix of section 7 item 6, which no sign-in test reaches) |

Every local-stack command runs with `SUPABASE_BIN` set to the local CLI and, like every Playwright run here, under an exclusive port lock shared with the other worktrees. The database tests (pgTAP) were not rerun: no migration or database file changed.

**What the local-stack suite (`tests/accounts/`) proves**, each refusal checked twice (the app's answer, and the database's own refusal of the same call under the same session):
- Manager: creates Customer Service and Technician accounts at once (test-marked, bound to the intent, no password); his Technician's Outlook email and "פעיל" are not returned to him; lists only Customer Service and Technician accounts, bounded, without deleted ones; is refused Manager and Creator accounts, role changes, passwords, emails and deletion with no Admin call; deactivates and reactivates at once; routine updates; stale and malformed input refused.
- Customer Service and Technician: every action refused, by the app and by the database (including `assert_can_manage`), with no Admin call; a tampered session user claiming to be the Manager creates nothing; every list empty.
- Incomplete creations: an uncertain Auth call leaves the intent, "השלמת יצירה" completes it; a lost success is bound on retry, never duplicated; "ביטול"; a definite refusal cancels the intent.
- Without the secret key: nothing created, no intent, no audit row.
- Creator (`--with-creator`): creates every non-Creator role; changes a role (never a Technician with a field profile, never to Creator, never his own); sets a password (old fails, new works; never his own, also in upper case; weak refused in Hebrew); changes an email (example.test kept for a test account; never his own, also in upper case); deactivates and reactivates; deletes after the explicit confirmation (section 5's effects, history kept, hidden from lists, frozen, repeated deletion repeats only the ban); without the secret key password, email and deletion change nothing; the notices.
- No password appears in any result or log line; the local Mailpit received no email.

**Unit spec (`tests/e2e/accounts-server.spec.ts`):** the admin configuration and its server-only reading; the action module's exports (exactly the 13, no retired request path); the Auth Admin port (failure classes, unavailable, the exact calls, bad ids never sent, nothing echoed, the per-intent user id); the D60 rules; input re-validation; list mapping and scope; refusals before any database or Auth call; the Hebrew messages of Migration 5's refusals.

## 7. Review of the paused WIP and fixes made in this pass

1. **Own-account checks were case-sensitive.** `credentialTargetError`, `roleChangeError` and `deleteAccountError` compared the raw input id with `===`. An upper-case spelling of the Creator's own UUID passed the app-only Q22 rule, and `assert_can_change_credentials` does not refuse the caller's own account, so the Creator could have set his own password or email. Fixed with a case-blind `isOwnAccount` used by every own-account check (also the Manager's routine-update check and the (de)activation pre-check); unit and local-stack tests added.
2. **`completeCreation` made Auth Admin calls with no database check at completion time** (only the app's role check and the RLS read of the intent). It now runs `assert_can_manage(role)` under the caller's session first, so the Admin calls always follow a database authorization; a database control test added.
3. **Unit spec fake:** the fake Admin client turned `createUser`'s attribute object into the id; fixed in the test (the port was correct).
4. **Deletion test strengthened:** the old session's access token reads nothing and its refresh token is refused (`user_banned`).
5. `lib/actions/accounts.ts` uses the shared `INVALID_INPUT` message.
6. **The Manager's demo payload carried Technicians' Outlook emails** (found by the default e2e suite, "raw responses"): the unified `AccountListEntry` holds the field profile in the Creator's view (the demo adapter has no session), and the demo loader passed it straight to the page. The loader now passes `UserAccount` only; the field profile reaches the page only through the scope-mapped `technicians` (Q14, review AUTH-N3). The real queries never put a Manager's Technician Outlook email in an entry (`outlookEmail: null`).

Checked and kept: deny by default without a session or configuration; every list bounded; deleted accounts filtered in the query and in the mapping; the Manager limited to Customer Service and Technician in the app and the database; the Creator-only role change, credentials and deletion with confirmation; the repeated-deletion path keyed on Migration 5's exact refusal, which comes after its caller checks; no password, token or email in logs; Auth's and the database's texts never returned.

## 8. Open items for the owner and follow-ups

- **Step 2 plan Q6 (open): a Creator in the local database.** The Creator's cases run only with `--with-creator`, which bootstraps a fictional Creator in the LOCAL database through `private.bootstrap_first_creator` as `postgres`. It is real-marked in `profiles` because the database refuses a test-marked Creator (its Auth user carries the test marker), so it is an exception to D47 that needs the owner's decision. It is reused by later runs; a Creator the tests did not create stops the setup. Without the flag the Creator's cases are skipped and pgTAP plus the unit spec cover them. Not in CI.
- **Q5 (open): email display in the lists.** The list shows the creation intent's address only when the viewer may read the intent under RLS (the Creator: every intent; the Manager: his own) and no email change was authorized since; otherwise it is empty (the screen shows "—"). No Admin API read is used for lists. One Admin read exists outside lists: `completeTechnicianProfile` reads that one account's sign-in email after the database check, to store it as the Outlook email (the port contract since PR 2.3, Q14); it is never returned to a Manager. The independent review should confirm this against `docs/security.md` §5 ("avoid the secret key for ordinary CRUD").
- **`docs/security.md` §5 (protected) still describes the retired request path** (D34 (a): a Manager's Customer Service creation, activation and role change wait for the Creator). D60 (7) supersedes it; the code follows D60 (7). Aligning the text is a protected change that needs the owner's approval.
- **Deletion by Auth ban** (section 5): the owner should know that the ban is permanent in practice but reversible by an Auth administrator, and that the issued access token remains valid (and useless) for up to an hour.
- **Q1 (TEMPORARY): no password at creation.** An account is created without a password and cannot sign in until one is set. The Creator sets the first password (`setPassword`, D50); by D67 (a) the self-service reset never serves an account that has not signed in before, so this stays the way in also once email delivery is enabled (review N7: the screens no longer say that only the Creator can ever give a password).
- Other TEMPORARY app rules kept: Q9 (no Creator account through the app), Q14 (the Manager does not change a Technician's Outlook email or "פעיל"), Q16 (an Auth user of a cancelled creation stays), Q17 (a test-marked account keeps `example.test`), Q22 (the Creator never changes his own credentials), Q12 (password strength is Supabase's policy; at most 72 bytes).
- **No app-level rate limit** on the account actions (only signed-in Creator and Manager sessions reach them, and the database authorizes every call). Still none with the screens (section 9.8).
- **CI:** `tests/accounts` and `tests/auth` run locally only; a CI workflow is a protected change.
- **Independent review (D53, D58)** of this branch is required before a PR is merged (authentication, authorization, environment handling).
- **Rebase:** done in the screens pass: the branch now sits on `claude/step2-password-reset` (section 9).
- **Next.js advisory:** the build's first run stops with the 16.4.3 advisory nudge (the same advisory recorded in PR 2.5: not exposed; the upgrade is a separate dependency PR). Not upgraded here.

## 9. The real screens (this pass)

### 9.1 Routes, guards and data
| Route | Who | What it does |
|---|---|---|
| `/office/settings` | any office role | `requireArea("office")`, then a redirect to `/office/settings/users` (the first built tab) |
| `/office/settings/users` | Manager: Settings › "משתמשים"; Creator: Settings › "משתמשים והרשאות" | `requireArea("office")` at request time (anonymous → `/login`; a Technician or an account without access → `/login?state=no-access`), then `accountAdminScope(role)` **before** any account read: Customer Service gets "אין הרשאה" and nothing is read. Otherwise the list (`list`, at most 100, role then name, deleted accounts left out), the viewer's own open creation intents and, for the Creator, `creatorNotices`, all under the viewer's own session (`lib/data/supabase/accounts.ts`); a failed read throws and the page fails closed |

- **One screen component** for both roles, `components/office/UserManagementScreen.tsx`, with the controls of the viewer's scope (display rules in `features/accounts/data/offers.ts`, each mirroring the server's rule; a hidden button is not access control: every action is re-checked by the server and the database).
- **Actions:** the page passes the 13 server actions of `lib/actions/accounts.ts` as props (`ACTIONS`; `components/` never imports `lib/actions`); `features/accounts/data/actions.ts` adapts them to the `AccountCommands` port, and the shared account dialogs of the prototype run them through `useAccountCommands()` (`features/accounts/commands-context.tsx`; in `/dev/demo` the same dialogs still get the simulated `Commands.accounts`). After every action the page is read again (`router.refresh`): rows and versions come from the database, and a stale version shows the server's "data changed" message (PT409). The row buttons wait while it reloads.
- **Navigation:** `features/auth/landing.ts` `realOfficeNav` (shared by `/office` and the settings pages through `app/(office)/office/_OfficeFrame.tsx`): the landing item and "הגדרות" for the Manager and the Creator; Customer Service keeps "קריאות" only (QA S-01). TEMPORARY Q18: only built screens are listed.
- **No password is kept:** the password dialog's field is uncontrolled (`autocomplete="new-password"`, no `name` or `value`), read once at submit and emptied when the call returns; the add dialog has no password field (D50, Q1).
- **Test data (D47):** every listed test-marked account carries 🧪 ("נתוני בדיקה" for screen readers) and a legend line under the table; new accounts must use `@example.test` until go-live (the server enforces it too).

### 9.2 What each role sees
| | Manager (Settings › "משתמשים") | Creator (Settings › "משתמשים והרשאות") |
|---|---|---|
| List | Technician and Customer Service accounts only (not his own) | Every role, his own row marked "החשבון שלך" (only "עריכה") |
| "+ הוסף משתמש" | Role: טכנאי / שירות לקוחות | Role: טכנאי / שירות לקוחות / מנהל; "יוצר · ממתין להחלטת בעלים" shown disabled (Q9) |
| Technician fields | Colour (`t-*` allowlist), device; phone; the email is also the Outlook address; a new technician is "פעיל" | The same; in "עריכה" also "מייל ב-Outlook" and "פעיל · מקבל זימונים חדשים" (Q14) |
| Row actions | "עריכה", "השלמה" (פרופיל טכנאי חסר), "השבתה" (confirmation) / "הפעלה" | Also "סיסמה", "מייל", "תפקיד" (never to Creator, never his own row, never a Creator row or a Technician with a field profile) and "מחיקה" (explicit checkbox) |
| Incomplete creations | His own "יצירה שלא הושלמה" rows: "השלמת יצירה", "ביטול" | His own, the same; others' open intents too, with "התחילה … · על ידי <requester>" and "ביטול" only (review S3) |
| Notices | none | "התראות חשבונות" (a Manager's deactivations, Outlook-email changes by others and every account a Manager creates, D67 (b); no requests) |
| "בקשות לאישור" | none (C-02) | none (C-02) |
| Customer Service | no "הגדרות" item; the route shows "אין הרשאה" | |
| Technician | the route sends him to the sign-in screen's no-access state | |

### 9.3 Design and reuse
The demo's visual language (`docs/demo.html` setUsers() as amended by SE-01, SE-17 to SE-20): the Settings shell and card head, the users table (name, email, role pill, state pill), the 🧪 badge, the two-per-line row actions with the ≤ 520 px stacked layout (no sideways scroll on a phone), the drawer dialogs (focus moves in, Tab stays inside, Escape and "ביטול" close, focus returns to the opener). Reused from the prototype (never imported from `app/dev`): `AccountAdminParts` (name, pills, result line), `AccountDialog`, `AccountEditForm`, `AccountCredentialForms`, `AccountCompletionForms`, `AccountNoticesCard`, `AccountAdminRules`, `SettingsShell`. New: `AccountAddDialog`, `AccountRoleDialog`, `AccountConfirmDialog`, `SettingsNoAccess`, `UserManagementRules.ts`, a few `.acct-*` classes.

Differences from the prototype (recorded as SE-21 in `docs/demo-deviations.md`, PROPOSED):
1. One "+ הוסף משתמש" opens a drawer dialog with the role choice (QA M-06, C-01), instead of the prototype's inline forms ("+ הוספת משתמש", "+ הוספת טכנאי", "+ בקשת חשבון שירות לקוחות").
2. The deactivation confirmation is a dialog (as every other confirmation), not the prototype's strip at the bottom of the card.
3. New Creator row actions "תפקיד" and "מחיקה" (D60 (7)); "השבתה" and "מחיקה" share the last line of the actions cell.
4. No "בקשות לאישור" section and no request wording anywhere (C-02); the notices card's sub-line no longer mentions requests.
5. The phone sits under the email ("מייל · טלפון"), a Technician's calendar colour under his name; an email the viewer may not read shows "—" (TEMPORARY Q5).
6. The Creator's tab shows no permission matrix yet (Step 10, D51); a note says so.

### 9.4 Tests and results (this pass)
| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` | clean (also right after the rebase) |
| Node CI tests | `npm run test:ci` | 208/208 |
| Build (no Supabase env, from an empty `.next`) | `npm run build` | passed (the first run stops with Next 16.4.3's advisory nudge; the retry builds; not upgraded) |
| Bundle scan | `npm run scan:bundle` | passed, 7,957 browser files |
| Default e2e suite | `npm run test:e2e` | 2,842 passed, 0 failed (3,080 skipped by project scoping and on-demand specs). The first run had 1 failure, fixed: the new source check matched the screen's own comment; it now reads the code without comments |
| Local stack, browser, with the local Creator | `node tests/auth/run-local.mjs --with-creator tests/auth/user-management.spec.ts` | 15/15 |
| Local stack, the whole `tests/auth` suite | `node tests/auth/run-local.mjs --no-build --with-creator` | 35 passed, 10 skipped (the on-demand screenshot cases) |
| Local stack, service suite | `node tests/accounts/run-local.mjs` / `--with-creator` | 13 passed + 8 skipped / 21/21 |
| Screenshots | `SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build --with-creator tests/auth/user-management-screenshots.spec.ts` | 4/4, 51 images, each looked at |

Every Playwright run and every `next start` ran under the shared port lock (other agents' worktrees); `SUPABASE_BIN` was the local CLI. The local-stack builds carry the two public local values only; `.next` was removed and rebuilt without them before the default suite. Sign-ins were paced (one per actor per block). pgTAP was not rerun: no migration or database file changed.


### 9.5 Screenshots (D62 (6))
`docs/review/step2-user-management-ui/<width>-<name>.webp`, each at 390 and 1440 px (D72; 38 images, retaken after the owner's review of 2026-11-18, section 11), from a local production build signed in to the local stack with fictional, test-marked accounts made through the real screens (`SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build --with-creator tests/auth/user-management-screenshots.spec.ts`). The shared local database also holds the other suites' seeded test accounts, so the lists show them too. No password appears in any image.

| Image | State |
|---|---|
| `nav-mgr` | The Manager's office start: the navigation with "דשבורד" and "הגדרות" |
| `mgr-list` | Manager: Settings › "משתמשים" (Technician and Customer Service users, an incomplete creation on top) |
| `mgr-incomplete-row` | The "יצירה שלא הושלמה" row with "השלמת יצירה" and "ביטול" |
| `add-empty` | "+ הוסף משתמש": empty, the role not chosen yet (Manager: two roles) |
| `add-technician` | The role "טכנאי": the technician fields (colour, device) |
| `add-validation` | A validation error (an address outside `example.test`; since review S4 the address reads "@example.test" in the right-to-left line) |
| `edit-mgr` | The Manager's "עריכת פרטים" of a Technician (no Outlook email or "פעיל": Q14) |
| `deactivate-confirm` | The deactivation confirmation |
| `creator-list` | Creator: Settings › "משתמשים והרשאות" with the notices card |
| `creator-notices` | "התראות חשבונות" alone (also "משתמש חדש שהמנהל יצר", D67 (b)) |
| `creator-other-intent` | The Manager's open creation as the Creator sees it: "על ידי <the Manager>" and "ביטול" only (review S3) |
| `creator-tech-missing` | A "פרופיל טכנאי חסר" row with "השלמה", among the Creator's rows |
| `edit-creator` | The Creator's "עריכת פרטים" of a Technician (Outlook email, "פעיל") |
| `role-change` | "שינוי תפקיד" (never Creator, never the current role) |
| `password-empty` | "הגדרת סיסמה", empty |
| `email-change` | "שינוי כתובת מייל" |
| `delete-confirm` | The deletion confirmation (the button waits for the checkbox) |
| `delete-retry` | A deletion whose Auth ban did not complete: the message and "נסו שוב" on the card (review S1) |
| `cs-no-access` | Customer Service: no "הגדרות" item; "אין הרשאה" on the route |

### 9.6 מה לבדוק (לבעלים)
- **מנהל:** בתפריט יש "דשבורד" ו"הגדרות" בלבד; "הגדרות" פותח "משתמשים" עם טכנאים ונציגי שירות לקוחות בלבד (בלי מנהלים ובלי יוצר).
- **כפתור אחד "+ הוסף משתמש"** עם בחירת תפקיד: למנהל טכנאי / שירות לקוחות; ליוצר גם מנהל. לטכנאי מופיעים צבע ביומן ומכשיר. אין שדה סיסמה.
- **פעולות בשורה:** למנהל "עריכה" ו"השבתה"/"הפעלה" בלבד, בלי סיסמה, מייל, תפקיד או מחיקה. ליוצר גם "סיסמה", "מייל", "תפקיד" ו"מחיקה".
- **השבתה:** חלון אישור שאומר שמשתמש לא פעיל לא יכול להיכנס ושההיסטוריה נשמרת.
- **מחיקה (יוצר בלבד):** כפתור "מחיקה סופית" פעיל רק אחרי סימון תיבת האישור; השורה נעלמת מהרשימה וההיסטוריה נשמרת.
- **אין "בקשות לאישור"** בשום מקום.
- **"יצירה שלא הושלמה"** ו**"פרופיל טכנאי חסר"**: לבדוק שהמצבים והכפתורים ("השלמת יצירה", "ביטול", "השלמה") ברורים.
- **"התראות חשבונות"** בראש המסך של היוצר בלבד.
- **שירות לקוחות:** אין "הגדרות" בתפריט, והכתובת מציגה "אין הרשאה".
- **בטלפון (390):** המייל, התפקיד והמצב יורדים מתחת לשם, והכפתורים נשארים בתוך המסך בלי גלילה הצידה.
- **🧪 נתוני בדיקה:** כל החשבונות בתמונות הם חשבונות בדיקה בדויים.

### 9.7 QA IDs (D62 (4))
- **Implemented in this screen:** M-06 (the Manager adds Technician and Customer Service users with one button and a role choice, edits, activates and deactivates; no deletion), M-10 (deletion Creator-only, enforced on the server; checked in the browser by tampered submissions), C-01 (one unified screen for every role, technician fields, deletion after confirmation), C-02 (no "בקשות לאישור"), C-09 (covered by C-01 and C-02), S-01 (Customer Service navigation unchanged: "קריאות" only).
- **Still pending:** M-07 (the Manager's other three Settings areas: continuation reasons, the "טופל" text and call types; Step 10) and the real permission-matrix screen of "משתמשים והרשאות" (C-01 "the matrix kept"; SE-02, D51, Step 10).

### 9.8 Open items of the screens
- **Naming (no conflict found, flagged):** the QA document names the Manager's first Settings area "משתמשים והרשאות"; D57 (1), the prototype and this brief call it "משתמשים" (the Manager has no matrix). The screen uses "משתמשים" for the Manager and "משתמשים והרשאות" for the Creator.
- **Step 2 plan Q6 (open):** the Creator's browser cases and the Creator's screenshots need `--with-creator` (the fictional, real-marked local Creator of `tests/accounts`).
- **No app-level rate limit** on the account actions (unchanged).
- ~~A shared message's direction~~: fixed by review S4 (section 10.1): a left-to-right mark keeps "@example.test" in one piece (`add-validation` retaken).
- **Independent review (D53, D58)** of the whole branch before any PR (authentication, authorization, environment handling, and now the screens).


## 10. Independent review fixes (verdict APPROVE WITH FIXES; no security defect found)

### 10.1 Review fixes: what was done

| ID | Finding | Done |
|---|---|---|
| M1 | Merge with the updated base (the password reset's review fixes, PR #33) | **Merged** `origin/main` (PR #33 merged as `820ae3c`, the same tree as `claude/step2-pr25-login` `7581dbe`, which includes the reset squash `898d744`) into this branch, with a merge commit (no history rewritten). Every file this branch's own commits did not change takes `main`'s version (114 files); the 15 files both sides changed were merged three-way against `a74bbdc`; `lib/auth/session.ts`, `lib/actions/password-reset.ts`, `lib/mail/*`, `features/mail/*` and `features/auth/password-reset/*` were byte-identical to `main` after the merge (checked), before N4 and D67 (a) changed `lib/actions/password-reset.ts`. The reset-only session is anonymous in `lib/auth/session.ts`, so every account action refuses it (S6 a) |
| S1 | A deletion whose Auth ban fails cannot be completed from the screen (the row disappears) | **Fixed.** The card keeps `{accountId, version, name}` and shows "נסו שוב" next to the message; it sends the same `deleteAccount({ accountId, expectedVersion, confirm: true })`, which repeats only the ban (Migration 5 refuses an already deleted account with 55000 after its caller checks). An uncertain ban (network, timeout, 5xx) is also tried once more at once. Message: "המשתמש נמחק במערכת, אבל חסימת ההתחברות לא הושלמה. נסו שוב כדי להשלים אותה." Tests: unit (fake database and Admin port: one immediate retry on "uncertain", none on a definite refusal, the repeated path), local stack (an injected failing ban: deleted and hidden at once, not banned; the same input again: banned, one audit row; the Manager cannot reach the path), browser (the real server, the browser told the ban failed: "נסו שוב" focused, the ban lifted in the local database, the click bans again) |
| S2 | A Manager could create an account on a mailbox he controls and reset its password himself once email delivery is enabled | **Owner decision D67 (2026-11-17): both (a) and (b), implemented.** (a) The reset's deferred delivery skips, silently ("sent" all the same; no link built or sent), an account that has never signed in (Auth `last_sign_in_at` empty: "skipped_never_signed_in") as well as a banned (deleted) one (N4); the Creator sets the first password. (b) The Creator's "התראות חשבונות" lists every account created by anyone but him, i.e. by a Manager (D49 and Q9: no other Creator is made), from the existing `profile.created` audit row (`admin_create_profile`, written under the creating caller's session; `actor_profile_id` is the Manager): kind `manager-creation`, "משתמש חדש שהמנהל יצר · <name>", "<role> · על ידי <Manager> · <time>". **No migration was needed.** Tests: local stack (a never-signed-in account gets the same answer and no link; another one, after its first sign-in, gets one; a Manager's creations are notices, the Creator's own are not; the Manager reads none), unit source checks. Note: Auth gives no lookup by address before `generateLink`, so Auth still creates (and keeps unsent) a recovery token for a skipped account; it is never delivered |
| S3 | The Creator cannot see or cancel other people's open creation intents | **Fixed.** For the Creator, `openCreations` drops the requester filter (RLS already lets him read them) and names the requester; the page passes every open intent to the Creator and only his own to the Manager. Another's intent shows "התחילה … · על ידי <requester>" and "ביטול" only (`intentCancelOffered`; `cancel_account_request` lets a real Creator cancel an approved request); "השלמת יצירה" stays the requester's (`intentCompletionOffered`, the server's `ownCreationIntentError`, Migration 5 OQ-4). Tests: unit (mapping, offers), local stack (the Creator sees and cancels the Manager's intent, cannot complete it with no Admin call; the Manager never sees the Creator's intent and cannot cancel it), browser ("ביטול" only, then cancelled) |
| S4 | The D47 address rule shows "example.test@" in a right-to-left line | **Fixed.** `testAccountEmailError` → "נתוני בדיקה: רק כתובות ‎@example.test" (a left-to-right mark before "@", as in `AccountAddDialog`). The pinned expectations (`tests/e2e/accounts-server.spec.ts`, `tests/auth/user-management.spec.ts`, `tests/e2e/demo.spec.ts` ×3) now assert against `testAccountEmailError(...)`; one unit check pins the mark. `add-validation` retaken at 390 / 820 / 1440 |
| S5 | The secret key needs its D66 record | **Done:** section 10.2 |
| S6 | Missing negative tests | **Added.** (a) A reset-link session (amr "otp" only) of the Manager and of the Creator: in `tests/accounts` the server's derivation gives no viewer (`isAppSessionClaims`), every one of the 13 actions is refused with no Admin call, nothing changes (the control shows the database alone would take the session as the user's own: the app's session rule is the barrier); in `tests/auth` the real server: two captured action requests replayed with a reset-only browser session are refused and change nothing, and the settings page sends that session to `/login`. (b) The Manager's `updateProfile` (also with the id in upper case), `updateTechnician`, `completeTechnicianProfile`, `activateAccount` and `deactivateAccount` aimed at a Manager (a second seeded Manager) or the Creator: refused by the app (also with a session user claiming to be the Creator) and by the database (42501), no Admin call, nothing changes. (c) A deactivated Manager whose session is still valid: no viewer is derived, every action is refused with no viewer and with the stale viewer (the database refuses the session), no Admin call, nothing written. (d), (e): S1 and S3 above |
| N1 | ARIA attributes on a plain `<fieldset>` | **Fixed:** the role choices in `AccountAddDialog` and `AccountRoleDialog` are `role="radiogroup"` named by their legend (`aria-labelledby`), where `aria-required` and `aria-invalid` are allowed; the browser test queries the radiogroup |
| N2 | "Email exists" told the Creator to contact the Creator | **Fixed:** `AUTH_ADMIN_MESSAGES.emailExists` + `askCreator`; `authAdminErrorMessage(…, { forCreator })` leaves "פנו ליוצר" out for the Creator (the commands pass the caller's role). Tests: unit; local stack (the Manager's message asks the Creator, the Creator's does not). (Local Auth answers an email change to a taken address with HTTP 500, so that path is "uncertain" and generic; the creation path carries the case) |
| N3 | JavaScript and database lower-casing can disagree outside ASCII (orphan intents) | **Fixed:** `accountEmailError` (printable ASCII only) for every account address: creation, the Creator's email change, a Technician's Outlook email, in the shared rules, the server schemas and the dialogs. Sign-in and the reset keep `emailError` (they only look an address up). Unit-tested |
| N4 | The reset should skip deleted and banned accounts silently | **Done** in `lib/actions/password-reset.ts` (deferred delivery): a banned account ("skipped_banned") gets no link and no email; the answer stays "sent". `lib/auth/password-reset-admin.ts` returns the fact with the token (`banned`, from `banned_until`). Tests: unit source check; local stack (a deleted, banned account: the same answer, no email). A deletion whose ban is still incomplete (S1) is not banned yet: it is closed by "נסו שוב", and such an account cannot sign in anyway (RLS needs an active, non-deleted profile) |
| N5 | — | Not in this pass's brief; nothing changed |
| N6 | The Creator-row offers and `roleChangeError` disagreed (comment vs rule) | **Fixed (wording, no permission change):** the screen still does not offer a role change on a Creator row, now stated as a display subset (TEMPORARY, until the owner decides how Creator accounts are managed); `roleChangeError`, like `admin_set_user_role`, cannot see the target's role and does not refuse another Creator's id (the database's last-active-Creator rule guards it). The old "D49: Creator accounts are not managed through the app" justification is gone. A unit test pins the difference |
| N7 | "Cannot sign in until the Creator sets a password" stops being true once email delivery is enabled | **Fixed:** the Manager's created line reads "המשתמש … נוצר בלי סיסמה, ולכן עדיין לא יכול להיכנס. היוצר יכול לקבוע לו סיסמה." (the Creator's: "…נוצר בלי סיסמה. כדי שיוכל להיכנס, קבעו לו סיסמה ב"סיסמה"."); the README's Q1 item is reworded (section 8); with D67 (a) it stays true |
| N8 | — | Not in this pass's brief; nothing changed |

### 10.2 The secret key (`SUPABASE_SECRET_KEY`): the D66 record

- **Why it is needed.** Supabase Auth's administrative actions cannot be done with the publishable key or under a user's session: creating a sign-in account without a password and without public sign-up (D50), setting a password or a sign-in email for another account (D34 (e)), banning a deleted account (D60 (7) Option A) and creating a password-reset token (D65). Without the key every one of them answers "הפעולה עדיין אינה זמינה." (creation, password, email, deletion) or "delivery-off" (the reset request); nothing else changes.
- **The exact operations** (server-only; the key is read at call time and never stored, logged or returned):
  1. `createUserForIntent` (`features/accounts/supabase/auth-admin.ts`): creates the Auth user of a creation intent (confirmed, no password, `app_metadata` = the intent nonce and `is_test`; never a role);
  2. `getUser`: reads one Auth user's facts (id, lower-case email, the intent nonce, banned or not);
  3. `setPassword`: sets another account's password (the Creator's "סיסמה");
  4. `setEmail`: sets another account's sign-in email, confirmed, no email sent (the Creator's "מייל");
  5. `revokeAccess`: bans a deleted account for about 100 years;
  6. D65: `createRecoveryTokenHash` (`lib/auth/password-reset-admin.ts`), Auth Admin `generateLink({ type: "recovery" })`: a recovery token hash, from which the app builds its own link; it sends nothing itself.
  `lib/supabase/admin.ts` exports only the narrow port of 1–5; the client object is never exported; nothing calls an RPC or a table with the key.
- **Authorization evidence.** 1–5 run only after the database authorized the action under the caller's own session: creation after `authorize_account_creation` (and, on "השלמת יצירה", `assert_can_manage`); `getUser` for a technician profile after `assert_can_manage('technician')`; password and email after `assert_can_change_credentials` (audited); the ban after `admin_delete_user` (or its "already deleted" refusal, raised only after the caller checks). The caller always comes from the server-validated session (`lib/auth/session.ts`), which treats a reset-link session as anonymous. 6 is unauthenticated by design (self-service): it runs only after the answer, behind the per-address throttle, sends only to the account's own address, and skips banned and never-signed-in accounts (N4, D67 (a)). Negative suites: `tests/e2e/accounts-server.spec.ts` (every refusal before any database or Auth call; the port's exact calls), `tests/accounts/` (every refusal checked by the app and by the database, with a spy proving no Admin call: Customer Service, Technicians, the Manager outside his scope, tampered session users, a deactivated Manager with a valid session, reset-link sessions, the key missing), `tests/auth/` (tampered and replayed browser submissions, reset-only sessions), `tests/e2e/password-reset.spec.ts` (the reset's server modules).
- **Minimum scope.** Vercel **Preview only**, marked **Sensitive**; Production only at go-live, with the owner's separate approval (D59 (5)). A **dedicated, revocable new-format key** (`sb_secret_…`, named for its use); never the legacy JWT `service_role` key (the schema refuses it, `parseSupabaseAdminEnv`), never a `NEXT_PUBLIC_` variable (the bundle scan and the secret scan check it).
- **How the owner sets it (dashboard only; never in the chat):**
  1. Supabase → project Technician-Management → Project Settings → API Keys → Secret keys → create a new secret key named, for example, `vercel-preview`; copy it.
  2. Vercel → project technician-management → Settings → Environment Variables → add `SUPABASE_SECRET_KEY` with that value, environment **Preview** only, **Sensitive** on; save, then redeploy the Preview.
  3. To revoke: delete that key in Supabase (API Keys); the app then answers "unavailable" again.

### 10.3 Tests and results (the review-fix pass, final head)

Rebased on `main` (1cdf5a7) on 2026-11-18; local runs on that head:

| Check | Result |
|---|---|
| `tsc --noEmit`, `npm run lint`, `npm run build` | clean / clean / OK |
| Default e2e: `user-management-ui`, `accounts-server`, `auth-real-routes` | 78 passed, 108 skipped (other projects) |
| `node tests/accounts/run-local.mjs --with-creator` | 27 / 27 |
| `tests/auth`: `user-management`, `password-reset`, `sign-in` (`--with-creator`) | 41 / 41 after one test fix: the S6 a case pressed Escape while the add dialog was still busy with the aborted request (the dialog ignores Escape while a command runs, by design); it now waits for "הוספה" to be enabled again |
| Screenshots (`user-management-screenshots`, `--with-creator`) | 57 images, WebP |

### 10.4 מה לבדוק (לבעלים)
- **מחיקה שלא הושלמה:** אם חסימת ההתחברות נכשלה, ההודעה בכרטיס כוללת כפתור "נסו שוב" שמשלים את המחיקה (`delete-retry`).
- **יצירה שלא הושלמה של מנהל:** היוצר רואה אותה עם "על ידי <שם המנהל>" ויכול רק לבטל; השלמה נשארת אצל מי שהתחיל (`creator-other-intent`).
- **התראות חשבונות (D67 ב):** כל משתמש שמנהל יוצר מופיע אצל היוצר כ"משתמש חדש שהמנהל יצר" (`creator-notices`).
- **איפוס סיסמה (D67 א):** חשבון שעוד לא נכנס אף פעם, או חשבון שנמחק, לא מקבל קישור איפוס (התשובה במסך זהה). את הסיסמה הראשונה קובע היוצר.
- **הודעת הכתובת:** "נתוני בדיקה: רק כתובות @example.test" נקראת נכון משמאל לימין בתוך השורה (`add-validation`).

## 11. Owner review of 2026-11-18 (D72–D78)

| Item | Done |
|---|---|
| Phone list (D72) | One card per user: name, email, phone; role and state chips on one line; ⋮ |
| Desktop list | The table; the actions column is ⋮ only |
| Row actions (D76) | `components/office/RowMenu.tsx`: one ⋮ menu (a portal, so no row overflows; it opens upward near the bottom and follows on scroll; Escape returns focus to ⋮). Manager: עריכה, השבתה/הפעלה; Creator: עריכה, סיסמה, מייל, תפקיד, השבתה/הפעלה, מחיקה (red, last); "השלמה" for a missing technician profile; intents: "השלמת יצירה" / "ביטול". The offers are unchanged (offers.ts mirrors the server) |
| Search and filters | Name, phone, email; role; state (פעיל / לא פעיל / יצירה שלא הושלמה); client side; no count cards, no pagination |
| Dialogs (D75) | Centred modal on desktop, full screen at 600 px and below (`AccountDialog`, shared with the demo) |
| Add dialog | "הוספה" and "ביטול" at the bottom left; one note ("את הסיסמה הראשונה קובע היוצר ומוסר אותה למשתמש."); the email help text under the field; the test-data and other notes removed; the disabled Creator option no longer says "ממתין להחלטת בעלים" |
| Test data (D74) | One banner "🧪 מוצגים נתוני בדיקה" above the card; the quiet grey "בדיקה" per record (`TestBadge.tsx`, identical to PR #42) |
| Phone header (D73) | `OfficePhoneBar` in the shared `OfficeShell`, switched on by the real office frame only (the /dev/demo layout is unchanged): at 600 px and below the logo on the left, ☰ on the right, a drawer from the right with the role's items and "יציאה" |
| Overflow bug | Fixed by the ⋮ menu; new browser test: at 390 px, for the Manager and the Creator, rows in every state (active, inactive, incomplete creation, missing technician profile) and their menus stay inside the screen; no horizontal scroll |
| Customer Service navigation | Today "קריאות" only (the start screen). Missing: "יומן טכנאים" (no screen yet) and "זימונים שלא נקלטו" (in `claude/office-unparsed`); each is added with its screen |
| Deferred (owner) | Re-review lows L1/L2 → the post-M7 migration with the notices' "נקרא" (D78); notices tabs (D78) and the ten technician colours (D77) are not part of this pass |

Local results on this head: lint, tsc, build clean; default e2e (`demo`, `user-management-ui`, `auth-real-routes`, `accounts-server`) 1040 passed; `tests/accounts` 27/27; `tests/auth/user-management.spec.ts` 19/19 (`--with-creator`); screenshots 38 (390 / 1440). The demo specs pinned the old "🧪" marker: 13 assertions now look for the D74 marker (title "נתוני בדיקה").
