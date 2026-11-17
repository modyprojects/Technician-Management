# Step 2: unified user management, the server side (D60 (7))

Branch `claude/step2-user-management`, stacked on `claude/step2-pr25-login` (`f615fb4`). **Server side only:** no page, route or component a user sees. The "ניהול משתמשים" screen itself waits for the owner's approval of the authentication screens (D62 (2) e). Nothing remote was accessed: no Supabase or Vercel operation, no migration, no change to `supabase/config.toml`, no new package, no protected file.

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
| `deleteAccount` | Creator only, `confirm: true`, never his own, never a Creator (OQ-1) | `admin_delete_user` (audited; a Technician's "פעיל" off) | `revokeAccess` (ban) |

Queries (`lib/data/supabase/accounts.ts`): `list`, `get` (Creator: every role; Manager: Customer Service and Technician; anyone else nothing), `openCreations` (the viewer's own intents), `creatorNotices` (Creator only). A failed read throws with a code only and the page fails closed.

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
| Deletion: the database committed, the ban failed | "…חסימת ההתחברות לא הושלמה. נסו למחוק שוב" | The profile is deleted (no access through RLS); a repeated deletion repeats only the ban: Migration 5 refuses an already deleted account only after checking the caller, his own account and a Creator target |
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
- **Q1 (TEMPORARY): no password at creation.** An account the Manager creates cannot sign in until the Creator sets its first password (`setPassword`), as D50 requires until an email provider is approved.
- Other TEMPORARY app rules kept: Q9 (no Creator account through the app), Q14 (the Manager does not change a Technician's Outlook email or "פעיל"), Q16 (an Auth user of a cancelled creation stays), Q17 (a test-marked account keeps `example.test`), Q22 (the Creator never changes his own credentials), Q12 (password strength is Supabase's policy; at most 72 bytes).
- **No app-level rate limit** on the account actions (only signed-in Creator and Manager sessions reach them, and the database authorizes every call). To be considered with the screen.
- **CI:** `tests/accounts` and `tests/auth` run locally only; a CI workflow is a protected change.
- **Independent review (D53, D58)** of this branch is required before a PR is merged (authentication, authorization, environment handling).
- **Rebase:** `claude/step2-pr25-login` has moved on since `f615fb4`; rebase before opening a PR.
- **Next.js advisory:** the build's first run stops with the 16.4.3 advisory nudge (the same advisory recorded in PR 2.5: not exposed; the upgrade is a separate dependency PR). Not upgraded here.
