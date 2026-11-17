# Step 2: self-service password reset (D65)

Branch `claude/step2-password-reset`, based on `claude/step2-pr25-login` (the real sign-in, owner-approved visual design of 2026-11-17). Owner decision D65 (2026-11-17): self-service password reset is in scope now; email delivery is a future integration, not a blocker (a Resend account exists, no sending domain is verified); no domain purchase, paid service or remote email or Auth setting change without approval; development and tests use local or mock delivery only.

Code written by Claude Code under the direction of the repository owner.

## 1. What was built

| Item | Where | Notes |
|---|---|---|
| "שכחתי סיסמה" on the sign-in screen | `components/ui/LoginScreen.tsx` (two optional props), `app/(auth)/login/page.tsx`, `_SignInScreen.tsx` | A centred link under the form (also in the unavailable state; never in the no-access state). `?state=password-updated` shows the notice "הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה." above the form (`.note`, `role="status"`), until the first sign-in attempt. Nothing else on the approved screen changes; the UI demo's prototype passes neither prop |
| Request screen "איפוס סיסמה" | `app/(auth)/login/forgot/`, `components/ui/ForgotPasswordForm.tsx`, `components/ui/AuthScreen.tsx` | Email field, "שליחת קישור", "חזרה לכניסה". Answers: **sent** ("בדקו את תיבת המייל", the same for every address) or **delivery-off** (an alert to contact the Creator, decided by the environment only). A signed-in user goes to his start, as on `/login` |
| New-password screen "בחירת סיסמה חדשה" | `app/(auth)/login/reset/`, `components/ui/ResetPasswordForm.tsx` | "סיסמה חדשה" and "אימות סיסמה", each with the sign-in screen's eye toggle, "שמירת הסיסמה". The **invalid-link** state ("הקישור אינו תקף או שפג תוקפו." and "בקשת קישור חדש") without a well-formed token and without a recent reset session. `referrer: no-referrer`, dynamic, nothing external |
| Server actions | `lib/actions/password-reset.ts` | `requestPasswordReset`, `completePasswordReset` (below) |
| Auth Admin call | `lib/auth/password-reset-admin.ts` | Its own client per call from `SUPABASE_SECRET_KEY` (read at call time, validated by `parseSupabaseAdminEnv`), `generateLink({ type: "recovery" })`, returns only `hashed_token`. Without a valid key: "unavailable" |
| Secret-key schema | `features/auth/env-schema.ts` | `SupabaseAdminEnv…`, `SECRET_KEY_PATTERN`, `secretKeySchema`, `parseSupabaseAdminEnv` and the header comment, byte-identical to `f1ba1a3` on `claude/step2-user-management` (so that branch rebases cleanly; its header names `lib/supabase/admin.ts`, which arrives with that branch) |
| Link origin | `features/auth/password-reset/origin.ts`, `lib/auth/app-origin.ts` | `APP_ORIGIN` (https, or http on a loopback host), else Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (Production) or `VERCEL_BRANCH_URL` (Preview), else `http://localhost:3000`. Never the request's headers |
| Mail port | `features/mail/`, `lib/mail/index.ts` | `disabled` (default), `mock` (refused in Vercel Production; a file or memory), `resend` (dormant). See `docs/integrations.md` "Email" |
| Email template | `features/auth/password-reset/email.ts` | Hebrew, RTL, table layout, inline styles, the brand's tokens, text wordmark "MODY" and "ניהול טכנאים" on the ink header, the button "בחירת סיסמה חדשה", the link as text, the expiry, the "ignore" line and the footer. No remote image, font or stylesheet. Every value escaped; only http(s) links |
| Email preview | `app/dev/email-preview/password-reset/page.tsx` | Behind the `/dev` gate: the real template with a fictional link in a sandboxed `srcdoc` frame, plus the text version |
| Throttle (interim) | `features/auth/password-reset/throttle.ts`, `lib/auth/password-reset-throttle.ts` | One email per address per minute, 20 per minute per instance, in memory (section 3) |
| Routes, inputs and the reset-session rule | `features/auth/password-reset/paths.ts`, `input.ts`, `recovery-session.ts` | Route constants without Zod (for client components); Zod strict schemas; the session rule below |
| Texts | `features/data-access/supabase-errors.ts` `PASSWORD_RESET_MESSAGES` | Appended at the end of the file (keeps the user-management branch's rebase clean) |
| Styles | `styles/ui.css` | One rule, `.login-link` (a taller tap area for the centred text links). The notice reuses `.note`; everything else reuses the sign-in classes |
| Variable names | `.env.example` | `EMAIL_DELIVERY`, `MAIL_MOCK_FILE` (local tests), `APP_ORIGIN`; names only |

## 2. Design and security reasoning (`docs/security.md` §4)

**Request (`requestPasswordReset`).** The email is validated with the sign-in rule and lower-cased. If this environment cannot deliver (delivery `disabled`, no valid `SUPABASE_SECRET_KEY`, or no usable link origin) the answer is **delivery-off**, decided by the environment alone before any Auth call (it says nothing about any account). Otherwise: the throttle; the Auth Admin `generateLink`; any refusal (`user_not_found` …) ends there; on success the app builds its own link and renders the email, which is sent **after the response** (`after()`), so a known address does not answer measurably later than an unknown one. Every well-formed request answers **sent**. One log line per request: an event name and an outcome code (`delivery_off`, `throttled`, `user_not_found`, `sent`, `mail_<code>` …), never the address, link or token.

**Why the app builds the link.** Supabase's own reset email would need its mailer (limited to the organization's members), its email template and its Site URL and redirect list, all remote settings. `generateLink` sends nothing and changes no setting; the app's link carries only the token's hash to the app's own `/login/reset`. Supabase's own `action_link` is never used.

**No open redirect, no Host-header injection.** The link's origin comes only from configuration (`APP_ORIGIN` or Vercel's system variables). A forged `Host` or `X-Forwarded-Host` header can never put another site into a real reset email. After a reset the browser goes to a fixed path (`/login?state=password-updated`); no `next` or redirect parameter exists in this flow.

**The link (time-limited, single use).** The token is verified only when the form is submitted (a server-action POST), never when the page is opened, so an email scanner or a prefetch cannot consume it. The Auth server keeps one recovery token per user (a new link replaces the old one), uses it once and expires it after the Auth "Email OTP expiration" (3600 seconds locally; see section 5 for the remote value). The page sends no referrer and loads nothing external; after the token is used the form drops it and removes it from the address bar.

**Setting the password (`completePasswordReset`).**
1. The password rules first: non-empty, at most 72 UTF-8 bytes, equal to the confirmation. A typo never uses up the link (also for a request that bypasses the browser's checks; tested).
2. With a token: `verifyOtp({ type: "recovery", token_hash })` under the browser's session cookies (the SSR client). A refused token gives the invalid-link state; a rate limit or service failure the service message.
3. The session must be a **recent reset session**: its verified JWT `amr` must hold an email-token verification no older than one hour. Pinned on the local stack: the reset link's session carries `amr: [{ method: "otp", timestamp }]`; a password sign-in carries `"password"` (`tests/auth/password-reset.spec.ts`). **Deviation from the design:** the design expected the method `recovery`; Supabase Auth names it `otp`. `otp` is also what an emailed sign-in link or code gives; each of those proves control of the mailbox exactly as the reset link does, and public sign-up is off (D50), so accepting it adds no new path. `recovery` is accepted too, in case an Auth version names it so. An ordinary signed-in session, a refreshed one (the `amr` keeps the original method and time) or an older reset session is refused: the invalid-link state, and the session itself is left alone.
4. `updateUser({ password })`. `weak_password` and `same_password` give a Hebrew message; the reset session stays, so the user retries without the (now used) link. Other failures give the service message.
5. Success: `signOut({ scope: "global" })` ends every session of the account (the earlier sign-ins on other devices too; tested), with the direct cookie removal of `lib/actions/auth.ts` as the fallback; then `/login?state=password-updated`.

**Generic errors, no enumeration.** The request screen shows the same heading and text for every address (tested against an unknown one); a refused, unknown or throttled request is indistinguishable to the user. A deactivated account (or one without a profile) can set a new password, but the sign-in rules are unchanged and still refuse it with the one credential message (tested).

**Brute-force protection.** Requests: the interim throttle (section 3). Token guesses: the Auth server's verification rate limit (30 per 5 minutes per IP by default) and the one-hour, single-use token. Note: the token's hash is derived from the address and the emailed one-time code (6 digits by default), exactly as for Supabase's own reset links and codes; a longer "Email OTP length" (up to 10) widens it (a remote setting; section 5). Every verification through the app comes from the app server's address, so the Auth limit then also caps the app as a whole; an app-level limit on the new-password action belongs with the durable throttle (Step 2 plan Q11, already a go-live blocker).

**Secrets.** `SUPABASE_SECRET_KEY` stays server-only (never `NEXT_PUBLIC_`, never logged; the bundle scan passes). `EMAIL_PROVIDER_API_KEY` is read only by the dormant Resend adapter, which never puts it into a result or an error (tested). The mock delivery is refused in Vercel Production.

**CSRF.** Next.js checks the Origin of every server-action POST against the Host (no `allowedOrigins`), as for sign-in (tested there with a replayed foreign-Origin POST).

**MFA later (open decision 19).** When MFA is enforced for the Creator and the Manager, a reset session is `aal1`; Supabase Auth may then refuse the password change for an account with a verified factor, and the reset rules must be revisited with the MFA design (`docs/mfa-design.md`).

## 3. Interim throttle: a GO-LIVE BLOCKER before `resend`

At most one reset email per address per minute (keyed by a SHA-256 of the lower-cased address; the address is never kept) and 20 per minute per server instance, in memory. A throttled request still answers **sent** and leaves the earlier link valid (a new `generateLink` would replace it). Vercel runs several instances and restarts them, so this is **no durable limit**. Before `resend` is enabled in any environment, a durable throttle is required: a database-backed counter (a migration, with the owner's approval) or Supabase's Send Email Hook. Today every environment is `disabled` or the local `mock`, and Preview and Production sit behind Vercel Authentication (D29, D31).

## 4. Future Resend activation

Not started; every step needs the owner's approval. The steps are in `docs/integrations.md` ("Email" › "Future Resend activation"): verify a sending domain in Resend; build the durable throttle; the owner sets `EMAIL_DELIVERY=resend`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` (and `SUPABASE_SECRET_KEY` if missing) for the chosen environment; a read-only check of the remote "Email OTP expiration"; one test reset to the owner's own address in Preview; then Production.

## 5. Not changed, and what the remote project must keep

No remote Supabase or Vercel operation, no remote Auth or email setting change, no migration, no `supabase/config.toml` change, no protected file (`proxy.ts` does not match `/login/*`; these pages need no session refresh), no new package. For the remote project these settings matter and were **not** checked (a read-only check needs the owner's approval per operation): "Email OTP expiration" at most 3600 seconds (bounds the link's lifetime); "Secure password change" (off by default; on, a reset session is still recent enough); the password policy (decides `weak_password`). Vercel holds only the two public Supabase values (names checked read-only on 2026-11-17, `docs/WORKLOG.md`): no `EMAIL_DELIVERY` and no `SUPABASE_SECRET_KEY`, so every Preview answers delivery-off.

## 6. Tests

| Suite | Command | Result (final commit) |
|---|---|---|
| Lint | `npm run lint` | pass (0 warnings) |
| Typecheck | `npm run typecheck` | pass |
| CI unit tests | `npm run test:ci` | 208 / 208 pass |
| Build (no Supabase values) | `npm run build` | pass (Next 16.4.3 sometimes stops once with its upgrade advisory; a retry builds; Next is not upgraded here) |
| Bundle scan | `npm run scan:bundle` | pass (7,956 browser-delivered files) |
| Default e2e (390 / 820 / 1440) | `npm run test:e2e` | 2,797 passed, 0 failed (3,008 skipped: single-project and on-demand tests) |
| Local-stack auth suite | `SUPABASE_BIN=/home/user/.supabase-cli/supabase node tests/auth/run-local.mjs` | 20 passed (the 13 existing and 7 new), 6 skipped (on-demand screenshots) |

**Default e2e, `tests/e2e/password-reset.spec.ts`** (no Supabase values, delivery disabled): the owner's wording; the email template (RTL, subject, button and text link, expiry, ignore line, footer, no external resource, escaping, only http(s) links, expiry text); the link origin (`APP_ORIGIN` rules, Vercel Production and Preview, fail closed, never a fallback); delivery selection (`disabled` default, `mock` refused in Production, `resend` needs both values, header-injection shapes refused); the Resend adapter with a fake `fetch` (endpoint, Bearer header, JSON body, no redirects, status-to-code mapping, timeout, no key or address in a result); the throttle (per address, per instance, fail closed, hashed key); the inputs (72-byte limit, mismatch before the token, token format); the reset-session rule; source checks of the server modules. Screens at every width: `/login` with the link and the notice; `/login/forgot` form, browser checks and delivery-off, with the sign-in layout checks (logo 48px from the top, card centred, only the listed texts centred, no horizontal overflow); `/login/reset` invalid-link and form states (no referrer, nothing external, eye toggles, mismatch kept in the browser, fields emptied and hidden after a call); the email preview. `/login/forgot` and `/login/reset` joined the responsive checks, the preview the `/dev` gate checks. The earlier "no reset route" test now proves that the only link on `/login` is "שכחתי סיסמה".

**Local stack, `tests/auth/password-reset.spec.ts`** (`EMAIL_DELIVERY=mock` into a private temporary file, the local secret key in the app server's runtime only, `APP_ORIGIN` = the test server): the whole flow from "שכחתי סיסמה" (address typed in another case) to one mock message with the app's own link (56-hex token, RTL HTML, no image, link or script tag); a second request within a minute sends nothing; opening the link uses nothing; a mismatch in the browser sends nothing; a mismatch that bypasses the browser is refused before the link is used; a weak password uses the link, keeps the session (a reload keeps the form) and removes the token from the address bar; the retry succeeds, the notice shows, no session cookie stays; the earlier session on another device is revoked; the old password fails and the new one signs in; the same link again gives the invalid-link state. An unknown address: the same screen, no message. A signed-in user on the request screen goes to his start. An ordinary password session: invalid-link without a token, a crafted submission without a token refused, a made-up token refused, the session kept and the password unchanged. A deactivated account can reset but still cannot sign in. The claim shape is pinned (`otp` for the reset session, `password` for a sign-in). No address, password, token or link in any server log line, and every auth event line is exactly `{event, code}`. The existing 13 sign-in and refresh tests stay green; two accounts were added to the global setup for these tests (their passwords change).

## 7. Screenshots (390 / 820 / 1440, local production build of the final commit, fictional data only)

Default server (no Supabase values, delivery disabled): `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-password-reset"`. Local stack with mock delivery: `SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build tests/auth/screenshots.spec.ts -g "password reset"`.

| Screen | 390 | 820 | 1440 | Source |
|---|---|---|---|---|
| Sign-in with "שכחתי סיסמה" | `390-login-link.png` | `820-login-link.png` | `1440-login-link.png` | local stack |
| Sign-in after a reset (notice) | `390-login-updated.png` | `820-login-updated.png` | `1440-login-updated.png` | local stack |
| Request form | `390-forgot-form.png` | `820-forgot-form.png` | `1440-forgot-form.png` | default |
| Request sent (mock) | `390-forgot-sent.png` | `820-forgot-sent.png` | `1440-forgot-sent.png` | local stack |
| Delivery off | `390-forgot-delivery-off.png` | `820-forgot-delivery-off.png` | `1440-forgot-delivery-off.png` | default |
| New-password form | `390-reset-form.png` | `820-reset-form.png` | `1440-reset-form.png` | default |
| Mismatch | `390-reset-mismatch.png` | `820-reset-mismatch.png` | `1440-reset-mismatch.png` | default |
| Invalid link | `390-reset-invalid-link.png` | `820-reset-invalid-link.png` | `1440-reset-invalid-link.png` | default |
| Email preview (`/dev`) | `390-email-preview.png` | `820-email-preview.png` | `1440-email-preview.png` | default |

There is no demo screen for these (the demo has no reset); compare with the approved sign-in screen (`docs/review/step2-pr25/`).

## 8. מה לבדוק (לבעלים)

- **מסך הכניסה:** הקישור "שכחתי סיסמה" ממורכז מתחת לטופס. שום דבר אחר במסך שאושר לא השתנה (לוגו, כרטיס, צבעים, גופנים, מרווחים).
- **אחרי איפוס:** ההודעה "הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה." מופיעה מעל הטופס, ברקע תכלת בהיר.
- **"איפוס סיסמה":** אותו עיצוב כמו מסך הכניסה (לוגו למעלה, כרטיס במרכז). לבדוק את הנוסח, את הכפתור "שליחת קישור" ואת "חזרה לכניסה".
- **"בדקו את תיבת המייל":** אותו מסך בדיוק לכל כתובת, גם לכתובת שאין לה חשבון (כך אי אפשר לברר אילו כתובות רשומות).
- **"שליחת מיילים עדיין אינה פעילה":** זה מה שיופיע היום ב-Preview, כי שליחת מיילים כבויה. אין שליחה אמיתית עד שתאשר ספק מיילים ודומיין מאומת.
- **"בחירת סיסמה חדשה":** שני שדות, לכל אחד כפתור עין משלו. הודעה כשהסיסמאות אינן תואמות. מסך "הקישור אינו תקף" עם "בקשת קישור חדש".
- **המייל:** תצוגה מקדימה ב-`/dev/email-preview/password-reset` (קישור פיקטיבי, שום דבר לא נשלח). לבדוק את הנוסח, הכותרת הכהה עם "MODY", הכפתור, שורת התוקף ("הקישור תקף לשעה ולשימוש אחד") והשורה התחתונה.
- **חשוב לדעת:** לפני הפעלת שליחה אמיתית דרך Resend צריך: דומיין שליחה מאומת, הגבלת קצב קבועה (במקום הזמנית של היום) ואישור שלך. כרגע לא שונתה שום הגדרה מרוחקת.
