# Step 2 / PR 2.5: the real sign-in screen and role landing

Branch `claude/step2-pr25-login`, based on `main` `b00acb1` (Migrations 1–5 applied and merged). The first real screen under D62: built on Supabase Auth and the user's own `profiles` row, with its QA corrections included, shown to the owner in an owner-only Preview before the next user-facing screen starts.

Code written by Claude Code under the direction of the repository owner.

## 1. What was built

| Item | Where | Notes |
|---|---|---|
| Sign-in "כניסה" | `app/(auth)/login/page.tsx`, `_SignInScreen.tsx` | Supabase email and password through the server action `signIn` (`lib/actions/auth.ts`). The shared `LoginScreen` / `LoginForm` of the PR 2.3 prototype (AU-01), unchanged in look |
| States | same | `form`; `failed` (one message for every credential failure); `retry` (new: a service failure after a submission, the form kept); `unavailable` (not configured, before any submission, no form); `no-access` (a session without access, with "יציאה"). Only `no-access` is read from the URL |
| Server-side session, role and active status | `lib/auth/session.ts` | `auth.getUser()` (validated by the Auth server), then the user's own `profiles` row under his own session (RLS: only an active profile reads its row), then `my_technician_id()` for a Technician. The role comes only from `profiles` |
| Per-page guards | `lib/auth/guards.ts`, `features/auth/session-state.ts` | Every real page calls `requireArea()` itself at the time of the request. Anonymous or unavailable → `/login`; a session without access (no profile, inactive, deleted, another area) → `/login?state=no-access` |
| Role landing | `app/page.tsx`, `features/auth/landing.ts` | `/` → `/office` (Creator, Manager, Customer Service) or `/tech` (Technician) |
| Office start | `app/(office)/office/page.tsx` | Title and only navigation item: "דשבורד" for the Manager and the Creator (D57 (1)), "קריאות" for Customer Service (QA S-01). Name, role and 🧪 from the session; "יציאה" in the sidebar's user block |
| Technician start and minimal profile | `app/(tech)/tech/page.tsx`, `app/(tech)/tech/profile/page.tsx` | "היום" and "פרופיל" only; "יציאה" on the start card and in "חשבון" |
| Sign-out "יציאה" | `components/ui/SignOutForm.tsx`, `signOut` | A POST form (never a link), scope "local" (this device). If the Auth call fails, the session cookies are deleted directly |
| D61 (3) lint rule | `eslint.config.mjs` | No file outside `app/dev` imports any `app/dev` module; `proxy.ts` may import only the gate |
| Local Auth config | `supabase/config.toml` | `[auth.email] enable_signup = true`: the CLI maps it to the Email provider itself (with `false` no email sign-in works). Public sign-up stays off (`[auth] enable_signup = false`), as the owner's D50 remote settings; a test proves sign-up is refused |

**Unchanged:** the database, every migration, the permission values (D51), the demo (`/dev/demo`), `proxy.ts` and every other protected file. No new package. No secret key anywhere: the app uses only the two public values.

## 2. QA corrections (D62)

| QA | Status in this PR | How |
|---|---|---|
| S-01 ("בית" removed; Customer Service's default screen is "קריאות") | **Implemented** for the landing | Customer Service lands on "קריאות"; no "בית" anywhere in the real app. Test: `tests/auth` "Customer Service: lands on קריאות" |
| D57 (1) with the QA mapping (Manager → "דשבורד") | **Implemented** for the landing | Manager and Creator land on "דשבורד" |
| X-07 (server-side authorization) | **Implemented** for this screen | Per-page guards, RLS on the profile read, negative tests (anonymous, wrong area, inactive, no profile, mid-session deactivation, foreign Origin) |
| X-09 (no fabricated data shown as real) | **Implemented** | Real routes read only the session; D61 (3) lint rule; e2e: no demo frame or fixture sentinel on real routes |
| S-04, S-05 (Customer Service navigation: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו") | Pending (Step 5 screens) | Only built items are shown; the other two items arrive with their screens |
| C-04, C-06 (sign-in events, failed sign-ins) | Pending (telemetry migration) | Sign-in failures are already logged on the server as an event name and a code only; the stored events come with the telemetry migration |
| M-06, C-01, C-02, M-10 (user management) | Pending (next user-facing screen, after your approval) | Migration 5 is in place |

## 3. Tests

- **Unit and fail-closed e2e (default suite, no Supabase values):** `tests/e2e/auth-real-routes.spec.ts`: the session decisions, role landing, the server-side input validation, auth log lines; every real page shows the unavailable sign-in with no form; no sign-up or reset route; no demo content on real routes.
- **Real sign-in against the local Supabase stack** (`tests/auth/`, `playwright.auth.config.ts`, run with `node tests/auth/run-local.mjs`): 11/11 passed locally:
  - Manager → "דשבורד", Customer Service → "קריאות" (no "בית"), Technician → his start and profile; session cookies HttpOnly, SameSite=Lax, Path=/; nothing in localStorage or sessionStorage;
  - wrong password, unknown email, inactive account and an Auth user without a profile: one message, email kept, password emptied, no session cookie;
  - anonymous → `/login`; a Technician on `/office` and a Manager on `/tech/profile` → the no-access state, nothing of the other area rendered; "יציאה" clears the cookies;
  - deactivated during the session: the next request is denied;
  - `next`: followed only inside the user's own area (`//evil.example`, `https://…`, another area refused);
  - a sign-in POST replayed with a foreign Origin is refused and sets no cookie (the same request from the app's origin signs in);
  - public sign-up and anonymous sign-in are refused by the Auth server.
- These run locally only for now. Running them in CI needs a new workflow (`.github/workflows/`, protected; Step 2 plan PR 2.4), which needs the owner's approval.

## 4. Protected file `proxy.ts`: session refresh (approved by the owner on 2026-11-17, added)

**`proxy.ts`: session refresh.** Server Components cannot write cookies, so an expired access token (1 hour) must be refreshed where cookies can be written. Without it the refreshed session is never saved: after the first hour every request refreshes again from an already-used refresh token, which adds an Auth call to each request and which Supabase's refresh-token reuse rules may refuse (the user is then signed out). Verified locally with a test that expires the session cookie: without the proxy the refreshed cookie is not saved; with the proposed proxy it is saved and requests 11 seconds later (past the reuse interval) still work. The proposal (Step 2 plan §3.6):
- the `/dev` gate stays exactly as it is (same check, same 404);
- the matcher adds only `/`, `/login`, `/office…`, `/tech…` (no catch-all, static assets untouched);
- on those paths it refreshes the session with the same cookie rules (HttpOnly, SameSite=Lax, Path=/, Secure on https) and the library's no-store headers, writing the new cookies onto the request and the response;
- it never decides access; not configured or any failure passes the request unchanged and the page fails closed.

**Added on 2026-11-17** after the owner's explicit approval, "limited strictly to the tested implementation": `proxy.ts` is byte-identical to the reviewed proposal (sha256 `d27d5a94bf886166dc2ead5c128417578f61f22554883602eded55a879a7a567`), with its refresh test `tests/auth/refresh.spec.ts`. Tests on the branch with it: lint, typecheck, build, bundle scan; the full default e2e suite 2,723 passed, 0 failed (every `/dev` gate test, the encoded and `_next/data` forms included); `tests/auth` 12/12 against the local stack (the 11 sign-in tests and the refresh test). The independent review approved this exact file (section 8).

## 5. Before the owner can sign in on the Preview (each step is the owner's own action or needs his separate approval)

1. **Condition (independent review S1):** the Supabase values are set only on deployments that contain the `proxy.ts` session refresh. Without it, a session that outlives its first hour refreshes inside a Server Component, the new tokens are lost, and the next request reuses the old refresh token, which Supabase may treat as token reuse (it revokes the session and records a false reuse event). Since 2026-11-17 this branch contains the refresh, so the owner sets `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) for **Preview, limited to the branch `claude/step2-pr25-login`** (never Production, and not all Preview branches until this PR is merged), then a new Preview build is made. Until then the Preview shows the "unavailable" sign-in (as in the screenshots). Step-by-step Hebrew instructions: `docs/review/step2-pr25/preview-setup.he.md`.
2. The owner creates his own Auth user in the Supabase dashboard (his password is never shared).
3. The D49 bootstrap of the first Creator: a remote write that needs the owner's separate approval, and, per the owner's instruction, only after the authentication security review.

Until then no real user exists and nobody can sign in remotely; the screens are reviewed from the screenshots below (fictional, test-marked local accounts).

## 6. Screenshots

From local production builds of this branch, at 390 × 844, 820 × 1180 and 1440 × 900 px. Signed-in screens: `SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build tests/auth/screenshots.spec.ts` (local stack, fictional test-marked accounts); the unavailable state: `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-pr25"` (no Supabase values).

| Name | Screen | Prototype counterpart |
|---|---|---|
| `login-form` | `/login` | `docs/review/step2-ui/<w>-login-form.png` |
| `login-failed` | after a wrong password (the field emptied) | `docs/review/step2-ui/<w>-login-failed.png` |
| `login-unavailable` | `/login` without the Supabase values | `docs/review/step2-ui/<w>-login-unavailable.png` |
| `login-no-access` | a Technician who opened `/office` | `docs/review/step2-ui/<w>-login-no-access.png` |
| `start-mgr` | Manager after sign-in: "דשבורד" | `docs/review/step2-ui/<w>-start-mgr.png` |
| `start-cs` | Customer Service after sign-in: "קריאות" | `docs/review/step2-ui/<w>-start-cs.png` |
| `start-tech`, `start-tech-profile` | Technician after sign-in, and his profile | `docs/review/step2-ui/<w>-start-tech.png`, `-start-tech-profile.png` |

The Creator's start is not shown: there is no test Creator (Step 2 plan Q6 TEMPORARY); its landing is covered by unit tests.

## 7. TEMPORARY behaviours (deny by default)

- Q2: no "שכחתי סיסמה", no reset link (no email provider, D50).
- Q4: "יציאה" placements as in the prototype (AU-02).
- Q18 / AU-03: until "דשבורד" and "קריאות" are built, `/office` shows the temporary start card under the landing item's title, and the navigation has that item only.
- Q11 (brute force): Supabase Auth's built-in limits apply; because sign-in runs on the server, the Auth server sees the server's address. A go-live blocker, not solved here.
- Revocation: database access ends at once on deactivation (every policy and function checks the active profile) and the app denies the next request; the Auth token itself stays valid until it expires (1 hour).

## 8. Independent review (D53 (4), D58)

One reviewer that did not write the code; read-only (no remote calls, no repository change).

- **Branch: APPROVE WITH FIXES, no must.**
  - S1, a session refreshed inside a Server Component is not saved without the proxy: recorded as the condition of section 5 (no Supabase values on any deployment before the proxy is merged).
  - S2, the sign-out fallback's cookie-name rule was untested: moved to `features/auth/session-cookies.ts` (`isSessionCookieName`) and unit-tested against real and look-alike names.
  - Nits fixed: ESLint now also refuses `import()` and `require()` of `app/dev` from real routes; the sign-up test asserts the exact Auth error codes (`signup_disabled`, `anonymous_provider_disabled`); the staged deletion of the old `app/page.tsx` is committed together with its replacement.
  - Checked and sound by the reviewer: role and active checks from `profiles` only; the `config.toml` mapping; per-page checks, no prerendering, `Cache-Control: private, no-store`; one credential and one service message; the `next` allowlist; the Origin check; logs; no browser Supabase client; fail closed without configuration; D61; test seeding (loopback only, test-marked, the secret key kept from the app server and the workers).
- **`proxy.ts` proposal: one must, fixed.** P1: a request the `/dev` matchers send whose path is not literally `/dev…` (a percent-encoded segment, a `_next/data` form) went to the refresh instead of the gate. Fixed by routing only explicit real routes to the refresh and everything else to the gate. New closed-gate tests for those forms (`tests/e2e/dev-gate.spec.ts`, in this branch). With the revised proposal, every request form of `/`, `/login`, `/office`, `/tech`, `/tech/profile`, two `/dev` pages and the `_next/data` and encoded forms returns the same status as with today's proxy; the gate suites (1,302 tests) and the 12 auth tests, refresh included, pass. Also adopted: `getClaims()` instead of `getUser()` in the proxy (the page validates the user), and the variables read through `lib/supabase/env.ts`.
- **Confirmation round: every item CONFIRMED.** Branch `3a5bc74`: APPROVE. Proxy proposal (sha256 `d27d5a94…a7a567`): APPROVE, still subject to the owner's approval as a protected file. Four nits, fixed in the next commit: the `proxy.ts` ESLint block also refuses `import()` of `app/dev`; a template-literal `import()` is refused too; `tests/auth` checks every `sb-*` cookie the library really sets against `isSessionCookieName`; the `_next/data` gate test notes that some builds 404 that form with the gate open as well. Informational: with asymmetric signing keys `getClaims()` checks the token locally, so a session revoked elsewhere keeps its cookie until the page's own `getUser()` treats it as anonymous (access unaffected).
- **Final confirmation of `4684f4a`: CONFIRMED.** `proxy.ts` byte-identical to the reviewed file (sha256 `d27d5a94…a7a567`); `tests/auth/refresh.spec.ts` the only other non-documentation file, no production code path; the docs hold no secret and weaken no protection. A privacy note (the setup guide named the existing Auth user's email domain) is fixed: the guide now describes that user only by its creation date.
