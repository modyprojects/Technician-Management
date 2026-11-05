# Step 2, PR 2.1 (foundations): packages and runtime verifications

Branch `claude/step2-foundations`, based on `main` `a225091`. The owner approved on 2026-11-05 that Step 2 proceeds alongside Step 1, with the local database only. This PR adds no route, no screen, no `proxy.ts` change and no remote call: it adds the packages, pure helpers in `features/`, the server-only Supabase user client in `lib/supabase/` (used by no route yet) and their unit tests. Nothing in it reaches the browser.

## 1. Packages

Installed with `npx -y npm@11.19.1 install --save-exact` (`.npmrc`: exact versions, no install scripts, 7-day release cooldown). Runtime dependencies, because the server code imports them.

| Package | Version | Published | Why this version |
|---|---|---|---|
| `@supabase/supabase-js` | 2.118.0 | 2026-10-15 | Newest release at least 7 days old (2.119.0 is from 2026-11-04). Its sub-packages (`auth-js`, `postgrest-js`, `realtime-js`, `storage-js`, `functions-js`) are pinned by it at 2.118.0. |
| `@supabase/ssr` | 0.12.7 | 2026-09-08 | Newest release; peer `@supabase/supabase-js ^2.114.0` is met. The supported Supabase SSR pattern (`docs/security.md` §4). |
| `zod` | 4.6.7 | 2026-10-12 | Newest release. Already in the lockfile as a development dependency of the lint toolchain at the same version; now a direct runtime dependency (`CLAUDE.md`: Zod for inputs). |

New transitive packages: `cookie` 1.1.1 (2025-11-26), `iceberg-js` 0.8.1 (2025-12-05), `@supabase/phoenix` 0.4.5 (2026-07-15); `tslib` 2.8.1 was already present. `npm audit --audit-level=high` passes; the 10 moderate findings are the existing `minimatch` chain of the lint toolchain on `main`, none in the new packages. The `server-only` npm package is not added (Step 2 plan §2.4): Next.js resolves `import "server-only"` itself, and `next/types/global.d.ts` declares the module for TypeScript.

## 2. Runtime verifications (Step 2 plan §2.4, risk R19)

**Method.** A throw-away Next.js 16.4.3 app in the session's scratch directory (never committed) with copies of this PR's `features/auth/env-schema.ts`, `features/auth/session-cookies.ts`, `lib/supabase/env.ts` and `lib/supabase/server.ts`, the same `node_modules` and a scratch `proxy.ts` that follows the plan's §3.6 pattern. Supabase Auth was a fake HTTP server on `127.0.0.1` that logs every request and returns fictional sessions; the publishable key was a fictional `sb_publishable_…` value. No Supabase project, no local Supabase stack and no real key or token were involved. Production build (`next build`, Turbopack) and `next start`, checked with `curl` and Chromium (Playwright).

| # | Question | Result |
|---|---|---|
| 1 | Does `@supabase/ssr` work in a Next.js 16 `proxy.ts`? | **Yes.** The proxy (Node.js runtime, the Next.js 16 default) refreshed an expired fictional session (one `POST /auth/v1/token?grant_type=refresh_token`, then `GET /auth/v1/user`), wrote the new cookie onto the request and the response, and the page render behind it read the refreshed cookie. The library's `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0` and `Pragma: no-cache` arrive through `setAll`'s second argument and were set on the response. |
| 2 | Are forced `httpOnly` cookie options respected? | **Yes.** A sign-in through `lib/supabase/server.ts` set `sb-127-auth-token` with `HttpOnly; SameSite=lax; Path=/` and `Secure` when `x-forwarded-proto` was `https`, none when it was `http`. In Chromium the cookie was `httpOnly`, `document.cookie` was empty, and `localStorage` and `sessionStorage` were empty. The library's own default is `httpOnly: false`, so the forcing is needed. |
| 3 | Can `proxy.ts` import a module that starts with `import "server-only"`? | **Yes.** The scratch proxy imported `lib/supabase/env.ts`; build and runtime succeeded. |
| 4 | Can a client provider import a `"use server"` module that imports `server-only`? | **Yes.** A client component imported such a module's action; the build succeeded and a click in Chromium returned the action's result. The browser files contained no Supabase code, no key and no action body. |
| 5 | Does `auth.getUser()` call the network when there is no session cookie? | **No.** Without a cookie it returned `AuthSessionMissingError` and the fake Auth server received no request (page render and proxy). With a valid session cookie it made one `GET /auth/v1/user`. |

**Also observed**

- `next start` sets `x-forwarded-proto: http` for a local plain-http request, so `isHttpsRequest()` drops `Secure` only there; Vercel sends `https`.
- `NEXT_PUBLIC_*` values present at build time are inlined into the **server** output too: a server started without the variables still used them. When the build had no values, the server read them at runtime. Either way a change of the Vercel values needs a new deployment to be predictable (plan §2.3, R10).
- Built without the variables, the scratch app reported "not configured" in the page and in the proxy and sent no request at all (S15, fail closed).
- The library writes the session cookie with `Max-Age` of 400 days (its default); how long a session stays valid is decided by Supabase Auth (refresh-token rules), not by the cookie. Recorded for the revocation question (plan Q10); nothing is changed here.

## 3. What this PR adds

- `features/auth/env-schema.ts`: Zod schema of `NEXT_PUBLIC_SUPABASE_URL` (https origin; plain http only on a loopback host) and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…` only); anything else is `configured: false` with problem codes, never values.
- `features/auth/redirects.ts`: the post-sign-in `next` allowlist per role area (`/office…`, `/tech…`).
- `features/auth/roles.ts`: database ↔ UI role codes, the role area, and the office navigation helpers moved out of the fixture zone (`officeNav` now takes the addresses from the caller and lists only items that have one).
- `features/auth/session-cookies.ts`: the forced cookie attributes and the https check (pure, so they are unit-tested).
- `features/data-access/supabase-errors.ts`: database codes, Migration 1's `55000` texts and Auth error codes to Hebrew messages; the sign-in credential/service split.
- `lib/supabase/env.ts`, `lib/supabase/server.ts`: server-only; the publishable-key user-session client. No secret-key or admin client.
- `tests/e2e/auth-foundations.spec.ts`: unit tests of all of the above (desktop project only, no server needed).

## 4. Deviations from the plan

- **`features/auth/session-cookies.ts`** is an extra file. The forced cookie attributes are an auth control, and the plan keeps pure logic out of `lib/` so tests can import it (§3.1, §5.1); `lib/supabase/server.ts` and the PR 2.5 proxy share it.
- **URL rule:** the schema accepts plain http only on a loopback host and only a bare origin. The plan says "URL"; this is the validation detail chosen (TECH): a non-local http URL would send the key and session tokens unencrypted.
- **`next` allowlist:** percent-encoded characters are refused anywhere, including the query, as the plan says ("no … encoded … characters"); a `next` with an encoded search falls back to the area's start.
- **`23503`** (foreign key) is mapped to the "missing or wrong details" message: Migration 1 raises it once and the plan's list did not name it. PostgREST "not found" codes (`PGRST106`, `PGRST202`, `PGRST204`, `PGRST205`) and their SQLSTATEs are a separate kind, `missing-object`, for the "Migration 1 not applied" case (§3.3).
- **Messages not in the plan's table** (shown to the owner for feedback, plan §4): `55000` texts beyond the three examples, `user_not_found` ("חשבון ההתחברות לא נמצא.") and the Auth Admin rate limit ("בוצעו יותר מדי פעולות. נסו שוב מאוחר יותר.").

## 5. Independent review (D53 (4)) and dispositions

The reviewer, who did not write the code, found no must findings. Dispositions:

| ID | Finding | Disposition |
|---|---|---|
| S1 (should) | Per-key unit coverage of the shared navigation helpers was thin (plan §5.1 "per role and key"). | **Fixed (tests only).** New tests flip every matrix key from the Manager's default values, add each key to Customer Service's values, cover every dashboard key (and the home title, which only `dashGen` sets) and the Creator with no values and all values. Mutation check: three mutants the earlier tests missed (home title from `dashTech`, "דשבורד" from `dashGen` only, "פריטים לבדיקה" without `card`) now fail. |
| N1 (nit) | Nothing enforced `import "server-only"` at the top of future `lib/` modules. | **Applied.** A unit test reads every `lib/` source file as text (never importing it) and requires the marker as the first statement; a `"use server"` directive may precede it, because a server-action module (plan §3.1 `lib/actions`) must start with its directive. Checked with a temporary unmarked file, which failed the test. |
| N2 (nit) | The Secure flag trusts `x-forwarded-proto`. | **Documented** in `features/auth/session-cookies.ts`: the platform (Vercel's edge) sets the header; without such a proxy a client could send "http", which only drops Secure on its own response's cookies. The PR 2.5 proxy reuses the same function and assumption. |
| N3 (nit) | `setAll` swallows every error, also in a server action. | **No code change** (the catch is the supported Server Component pattern). The comment now says that the PR 2.5 sign-in and sign-out actions must check their cookie writes themselves and log an event name and code only (`docs/security.md` §8). |
| N4 (nit) | `officeRoleOf` duplicated `isOfficeRole`; `roleArea` sent any non-"tech" value to "office". | **Applied.** `officeRoleOf` reuses `isOfficeRole`; `roleArea` is an explicit map and returns null for a value that is no role (typing bypassed), deny by default. A test that fails on the earlier code was added. `roleArea` has no caller yet besides the tests. |
| N5 (nit) | Local `npm run scan:secrets` (all refs) stops on a finding at `a9e7980`. | **Not a defect of this PR.** The commit is only on the stale local ref `claude/db-canary-rows` (the deleted WIP branch; the known fictional test value). Gitleaks on this branch's history and on the working files finds nothing. Deleting the ref is a git-state change left to the owner. |
