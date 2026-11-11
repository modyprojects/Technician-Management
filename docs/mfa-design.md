# MFA design (Step 2, PR 2.8)

**Status:** design document only (ROADMAP row 2 "MFA design"; Step 2 plan row 2.8). No code, no migration, no configuration change, no remote operation. **Open decision 19 ("MFA enrollment and admin account recovery", `docs/decisions.md` L93) is not decided here.** Every "recommended default" below is a technical recommendation for the owner, not an approved rule. Until the owner decides, the temporary behaviour of D53 (3) applies: nothing is enforced, the D49 bootstrap and remote Manager accounts stay gated (section 3), and Preview and Production stay owner-only behind Vercel Authentication (D29, D31).

Labels used below: **REQ** a requirement from an approved document; **OPEN** an owner decision; **REC** a technical recommendation (not approved); **UNVERIFIED** a fact that could not be confirmed from a primary source in this session (list in section 2.3).

---

## 1. Purpose and scope

This document answers each part of the Step 2 plan's question Q3 (open decision 19) with options, trade-offs, costs and a recommended default:

- (a) what "before production" means;
- (b) which factor types, and what they cost under D30;
- (c) when MFA is enforced for the owner's own Creator account, and how that relates to the D49 bootstrap and to remote Manager accounts;
- (d) where `aal2` is enforced (application, `private.require_caller` in the admin RPCs, restrictive RLS on all Creator and Manager data), and what each needs;
- (e) recovery of a lost factor and of a forgotten Creator password while no email provider exists;
- (f) hosted Supabase's default TOTP self-enrolment behaviour (and the other self-registration endpoints: passkeys and WebAuthn).

It also outlines the enrolment and challenge screens (to prototype later), the owner's runbook, the test plan, the risks and a decision table. The build (plan row "2.8b MFA build") starts only after open decision 19 is answered.

Out of scope: building anything; changing `CLAUDE.md`, `docs/security.md` or any other document; any Supabase, Vercel or GitHub setting.

---

## 2. Sources and method

### 2.1 Project documents (read on `main` `fc435e0`)

| Ref | Document | What it says about MFA |
|---|---|---|
| P1 | `CLAUDE.md` L49 | "MFA for Creator and Manager before production." Enforcement "is always server-side and in the database (RLS, grants, server functions)". |
| P2 | `docs/security.md` §4 L35–37 | "MFA for Creator/Manager before production; tested recovery and reset flows; time-limited reset links; … brute-force protection; generic errors." Admin create/invite APIs run only after the caller's authorization was checked in the database under his own session. |
| P3 | `docs/security.md` §4a L46–47 | Built-in email reaches only members of the organization's team; "Not now (Step 2): … MFA (open decision 19) and password policy." |
| P4 | `docs/security.md` §2 L9; §10a L140; §11 L149 | The project URL is not a secret and the publishable key is designed to be public; Vercel Authentication covers all deployments; Supabase Auth settings are changed by the owner himself. |
| P5 | `docs/spec.md` L20 | Creator: "MFA required in production." (The spec does not mention Manager MFA; `CLAUDE.md` and `security.md` add the Manager. Not a conflict: the spec is silent.) |
| P6 | `docs/database-schema.md` §8.4 rule 3 (L514) | `admin_set_role_permission` "When MFA is enforced it requires `aal2`." |
| P7 | `docs/database-schema.md` §8.4 rule 8 (L519) | "Technical recommendation: once enforced, a restrictive policy requires `aal2` for all data access by Creator and Manager, not only for admin actions." |
| P8 | `docs/database-schema.md` §8.5 (L525–527) | `assert_can_change_credentials` runs before any Auth Admin call that sets a password or changes an email. First Creator (D49): "MFA follows immediately." |
| P9 | `docs/testing.md` L11, L38 | "Before pilot: … MFA setup"; category 4 includes "`aal1` vs `aal2` once MFA is enforced (Step 2)". |
| P10 | `docs/deployment.md` L34, L41 | MFA is a Step 2 Auth setting, not changed yet; go-live gate item 5: "MFA for Creator/Manager". |
| P11 | `docs/decisions.md` L93 | Open decision 19: "MFA enrollment and admin account recovery", needed before "Step 2 / pilot". |
| P12 | `docs/decisions.md` D29 (L41), D30 (L42), D31 (L43), D34 (L46), D49 (L61), D50 (L62), D52 (L64), D53 (L65), D55 (L67) | Owner-only Preview; free plans only and no charges; Production is a protected testing environment with fictitious data until go-live; account administration rules; first Creator by a one-time function that fails if a Creator exists, and no automatic promotion to Creator; company/department Supabase organization (its access managed by the department) and the built-in email limitation; migration approval (D52 rule 4); autonomy and its exceptions; Migration 1 apply path and (D55 (10)) a separate merge approval for changes that need explicit approval under the security rules. |
| P13 | `docs/ROADMAP.md` L20 | Step 2: "Email/password, admin invitations, role checks, MFA design". |
| P14 | Migration 1, `supabase/migrations/20261104120000_access_and_permissions.sql` on draft PR #12 (`claude/step1-pr13-access-permissions`, head `daec926`; not merged, not applied) | No `aal` check anywhere. `private.require_caller(p_roles)` (L763–779) loads the caller's active profile from `auth.uid()` and raises `42501` otherwise; 14 SECURITY DEFINER bodies call it (L793–1451). RLS without FORCE: "the SECURITY DEFINER bodies run as the owner" (L83). SELECT-only policies, all `TO authenticated` (L1698–1750). `private.bootstrap_first_creator` refuses any session with JWT claims (L1667–1693). `admin_approve_role_permission` runs only from the owner's database role with a Creator id set in `request.jwt.claims` (L828–836). Until go-live every account the app creates is test-marked (L960–963, L1023), a test caller manages only test targets (for example L1106) and cannot change credentials or the matrix (L794, L848, L909), a test Creator cannot exist (L112), and the app cannot create a Creator (L948, L1000; comment L933–934). Six boolean or own-id helpers (`is_active_user`, `has_role`, `is_creator`, `is_office_user`, `has_permission`, `my_technician_id`, L674–751) are SECURITY DEFINER and executable by `authenticated`; `public.test_data_census()` is SECURITY INVOKER and Creator-only (L1624–1661). |
| P15 | PR 1.3 README (`docs/review/step1-pr13/README.md` on PR #12) Q15, §10 | "No `aal2` check yet (Step 2, open decision 19): add it for Creator and Manager in the shared caller check, plus the restrictive policy of §8.4 rule 8." `profiles.id` → `auth.users` is ON DELETE RESTRICT; accounts are deactivated, never deleted. |
| P16 | `supabase/config.toml` L166, L189–195, L229, L298–319 | Local stack: `jwt_expiry = 3600`; `secure_password_change = false`; `[auth.mfa] max_enrolled_factors = 10`; TOTP `enroll_enabled = false`, `verify_enabled = false`; phone MFA off; `[auth.passkey]`, `[auth.webauthn]` and `[auth.mfa.web_authn]` exist only as commented-out template entries. A template comment says "Multi-factor-authentication is available to Supabase Pro plan" (see U14). |
| P17 | Step 2 plan (reviewed; not stored in the repository) §7.1 Q1, Q2, Q3, Q10, Q22 and the questions glossed in 2.1a; §7.4 P-4; §2.2 steps 1–11; §3.13 | Context only (glosses in 2.1a). |
| P18 | `docs/architecture-data-access.md` L143; `docs/security.md` §5 L72–73 and §8 L102 | "The secret key is never used for ordinary reads"; "Avoid the secret key for ordinary CRUD"; "SECURITY DEFINER helpers are allowed only when they enforce authorization: they return a boolean or the caller's own ids"; the audit is not protected "against owner-level database access (… any Supabase organization member with SQL access)". |

#### 2.1a Plan questions and items referenced (P17), one line each

| Item | Subject | Temporary behaviour in the plan |
|---|---|---|
| Q1 | Initial credentials and handover | (a) the Creator types a password and hands it over in person or by phone; no forced change; no self-service UI |
| Q2 | When an email provider is decided | No provider, no reset links, no emailed invitations; the Creator resets passwords |
| Q3 | MFA (open decision 19), sub-questions (a)–(f) | Design only; gates the D49 bootstrap, remote Manager accounts and PR 2.8b |
| Q5 | Email and decider name in the account lists; option (b) is Admin API reads with the secret key, which conflicts with `docs/security.md` §5 | No Admin API reads |
| Q6 | A real-marked Creator in the local and CI databases | No Creator locally or in CI; Creator flows proven by pgTAP and unit tests |
| Q7 | Test-marked accounts (Manager, Customer Service, Technician) on the remote project | No remote accounts |
| Q8 | How the owner's own Auth user for D49 is created (dashboard, or a server script with the secret key) | Nothing remote |
| Q9 | Creating Creator accounts through the app | Not offered; the database refuses it (Migration 1 L948) |
| Q10 | Revocation on deactivation or role change | Database checks and per-request app guards only; go-live blocker |
| Q11 | Brute-force protection and rate limiting; option (b) forwards the client IP to Auth | Supabase's built-in limits only; go-live blocker |
| Q12 | Remote Auth settings before any account exists (password policy, Confirm email, Secure email change, Secure password change, notification emails, Site URL) | App checks non-empty and length only; no email links |
| Q22 | Self-service password and email changes through the Auth API with a user's own token | No UI; characterization tests only; go-live blocker |
| Q24 | Where the Supabase values go (`SUPABASE_SECRET_KEY` in Production, Preview or both; set after the apply) | The secret key is set nowhere; credential actions show "unavailable" |
| §2.2 | Remote enablement sequence, steps 1–11 (D50 settings, read-only check, Migration 1 apply and merge, audit anchor, post-apply assertions, Q12 settings, keys and Vercel values, own Auth user, D49 bootstrap, test accounts) | Each step the owner's own action or separately approved |
| §3.13 | Auth endpoints reachable with a user's own token | Characterization tests |
| P-4 | A restrictive `aal2` policy on all Creator and Manager data | Proposal; needs approval |

### 2.2 Supabase public documentation

**Method.** `supabase.com` could not be resolved from this session (its host is outside the session's allowed network). The published pages were therefore read from their public source in the `supabase/supabase` repository (`raw.githubusercontent.com`, branch `master`, which `git ls-remote` showed at `aa9d04e` on 2026-11-06), plus the type definitions of the `@supabase/auth-js` 2.118.0 package already installed in this repository. The published page can differ slightly from its source; each fact cites the published URL. The session clock crossed midnight UTC during the reading, hence two dates.

| ID | Fact | Published URL | Read |
|---|---|---|---|
| S1 | Supabase Auth MFA has two methods: App Authenticator (TOTP) and phone messaging. The assurance level is the `aal` claim of the JWT: `aal1` = conventional sign-in only, `aal2` = additionally verified with a second factor. "JWTs without an `aal` claim are at the `aal1` level." | https://supabase.com/docs/guides/auth/auth-mfa | 2026-11-05 |
| S1b | Enrolment, challenge/verify and list-factors APIs; the dashboard controls access to the enrolment API and to challenge/verify ("A setting of `Verification Disabled` will disable both the challenge API and the verification API"). | same | 2026-11-05 |
| S1c | "Adding MFA to your app's UI does not in-and-of-itself offer a higher level of security"; rules must be enforced in the database, APIs and server rendering. Template: a restrictive policy `to authenticated` whose condition is that `auth.jwt()->>'aal'` equals `aal2`; "Make sure you don't omit the `as restrictive` clause." Variants for "new users only" and "only users that have opted in" (the latter reads `auth.mfa_factors`). | same | 2026-11-05 |
| S1d | Users can unenroll a factor only after obtaining an `aal2` claim; unenrolling downgrades `aal2` to `aal1` "only after the refresh interval has lapsed" unless the session is refreshed. | same | 2026-11-05 |
| S1e | On the server, a lower AAL is often benign (closed tab, old tab, lost device); "redirect users to a page where they can authenticate using their additional factor" instead of a 401/403. | same | 2026-11-05 |
| S1f | The `amr` claim lists the methods used (`password`, `totp`, …), most recent first. | same | 2026-11-05 |
| S2 | "TOTP MFA API is free to use and is enabled on all Supabase projects by default." | https://supabase.com/docs/guides/auth/auth-mfa/totp | 2026-11-05 |
| S2b | Enrolment = `enroll()` (returns a QR code and a secret; show the secret as text if the QR cannot be scanned), `challenge()`, `verify()`; "If the verification succeeds, the factor immediately becomes active". Sign-in: after the first factor, `getAuthenticatorAssuranceLevel()` gives `currentLevel`/`nextLevel`; `aal1`/`aal2` means "User has an MFA factor enrolled but has not verified it". | same | 2026-11-05 |
| S2c | A TOTP code is valid for one 30-second interval, with a one-interval clock skew allowed. | same | 2026-11-05 |
| S3 | Phone MFA sends a code by SMS or WhatsApp through the same provider configuration as phone sign-in; codes valid up to 5 minutes; "Phone MFA is vulnerable to SIM swap attacks". | https://supabase.com/docs/guides/auth/auth-mfa/phone | 2026-11-05 |
| S4 | Advanced MFA Phone pricing: $75 per month for the first project, $10 per month per additional project (table lists Pro, Team, Enterprise); billed per hour while enabled; **not covered by the Spend Cap**; additional per-message charges from the SMS/WhatsApp provider. | https://supabase.com/docs/guides/platform/manage-your-usage/advanced-mfa-phone | 2026-11-05 |
| S5 | JavaScript reference, MFA overview: TOTP and phone are supported second factors; "Recovery codes are not supported but users can enroll multiple factors, with an upper limit of 10." Admin API entries `auth.admin.mfa.listFactors` and `auth.admin.mfa.deleteFactor`. | https://supabase.com/docs/reference/javascript/auth-mfa-api | 2026-11-05 |
| S6 | `@supabase/auth-js` 2.118.0 (installed here; `dist/module/lib/types.d.ts`, `error-codes.d.ts`): admin `deleteFactor({ id, userId })` "will log the user out of all active sessions if the deleted factor was verified" (marked experimental); admin `listFactors({ userId })` (experimental); `enroll` accepts `issuer` and `friendlyName`; factor statuses `unverified`/`verified`; a `webauthn` factor type; an experimental `mfa.recoveryCodes` API behind a client flag; error codes include `insufficient_aal`, `mfa_ip_address_mismatch`, `mfa_challenge_expired`, `mfa_verification_failed`, `too_many_enrolled_mfa_factors`, `mfa_totp_enroll_not_enabled`, `mfa_webauthn_enroll_not_enabled`, `mfa_webauthn_verify_not_enabled`. | (package type definitions; published reference as S5) | 2026-11-06 |
| S7 | JWT fields: `aal` is `"aal1"` or `"aal2"`; `amr`, `session_id` are claims of user access tokens. | https://supabase.com/docs/guides/auth/jwt-fields | 2026-11-06 |
| S8 | Rate limits: "Create or verify an MFA challenge" (`/auth/v1/factors/:id/challenge`, `/verify`, one shared limit) is limited **by IP address**, **not customizable**, 15 requests per minute with bursts up to 30. IP forwarding (`Sb-Forwarded-For`) works only with a secret key, not with publishable keys, and "must be explicitly enabled" per project (Authentication → Rate Limits, "IP Address Forwarding"). The built-in email server sends 2 emails per hour. | https://supabase.com/docs/guides/auth/rate-limits | 2026-11-06 |
| S9 | Auth hooks: "MFA Verification Attempt" (limit attempts, sign out users after invalid attempts) is available on **Teams and Enterprise** only. | https://supabase.com/docs/guides/auth/auth-hooks | 2026-11-06 |
| S10 | MFA for the owner's own **Supabase dashboard account** (platform, not the app): TOTP; "Supabase does not return recovery codes", register a backup TOTP factor and store its secret "in a secure location different than your primary one"; "we will not be able to restore access to your account if you lose all your two-factor authentication credentials." Organization-wide MFA enforcement exists on Pro, Team and Enterprise. | https://supabase.com/docs/guides/platform/multi-factor-authentication | 2026-11-06 |
| S11 | Sessions: access tokens are short-lived, refresh tokens single-use; time-boxed sessions, inactivity timeout and single session per user are "only available on Pro Plans and up". | https://supabase.com/docs/guides/auth/sessions | 2026-11-06 |
| S12 | RLS: `auth.jwt()` can check MFA (restrictive policy example on `aal2`); a SECURITY DEFINER function created by a role such as `postgres` "will have `bypassrls` privileges"; wrapping `auth.jwt()` in a sub-select caches it per statement. | https://supabase.com/docs/guides/database/postgres/row-level-security | 2026-11-06 |
| S13 | Server-side: `getClaims()` verifies the token's signature on every call (locally with asymmetric keys, otherwise through the Auth server); never trust `getSession()` on the server. | https://supabase.com/docs/guides/auth/server-side/creating-a-client | 2026-11-06 |
| S14 | Without custom SMTP, Supabase Auth refuses to deliver messages to addresses that are not part of the project organization's team. | https://supabase.com/docs/guides/auth/auth-smtp | 2026-11-06 |
| S15 | Deleting an Auth user does not sign him out (JWTs stay valid until expiry); a ban blocks sign-in but does not revoke existing sessions. | https://supabase.com/docs/guides/auth/managing-user-data | 2026-11-06 |
| S16 | Passkeys: an **experimental**, passwordless **first-factor** sign-in built on WebAuthn. Switched on by the dashboard toggle "Enable Passkey authentication" (Authentication → Passkeys) or `[auth.passkey] enabled` locally; the server rejects calls with `passkey_disabled` when it is off. "A user must be signed in before they can register a passkey"; registering needs "an existing, confirmed, non-anonymous user". An admin API lists and deletes a user's passkeys. The page states no plan or price and nothing about the `aal` of a passkey session. | https://supabase.com/docs/guides/auth/passkeys | 2026-11-06 |

### 2.3 UNVERIFIED facts (to check before or during PR 2.8b)

| # | Fact | Why it matters | How to verify |
|---|---|---|---|
| U1 | Exact dashboard path and labels of the project's MFA settings (the docs link to `/dashboard/project/_/auth/mfa` and mention "Verification Disabled"; the other labels were not read). | Runbook steps | The owner looks at the page himself (his own action) |
| U2 | Whether the dashboard's Authentication → Users screen offers a per-user "remove MFA factors" action and a direct "set password" action (rather than only "send password recovery"). | Recovery options e-1 and p-1 | The owner looks at his own user after creating it (runbook step 7a; no change) and reports |
| U3 | Whether enrolling an **additional** factor at `aal1` is refused when the user already has a verified factor (the error `insufficient_aal` exists; its use on enrolment was not read). | Pre-enrolment hijack and second-device enrolment | Local characterization test |
| U4 | Whether deleting rows from `auth.mfa_factors` or setting `auth.users.encrypted_password` in the SQL editor is a supported recovery path (it is a community workaround, not documented). | Recovery options | Not verifiable from documentation; treat as unsupported |
| U5 | Whether MFA recovery codes are available on hosted projects (the published reference says "not supported"; auth-js 2.118.0 has an experimental API behind a client flag). | Factor option b-4 | Re-read the docs when the feature is announced as generally available |
| U6 | **Passkeys:** the page was found (S16): experimental, first-factor sign-in, dashboard toggle. Not stated: whether the toggle is off by default on hosted projects (inferred from "turn on"), plan, price, and the `aal` of a passkey session. **WebAuthn as an MFA factor:** unverified (auth-js has the factor type and its "not enabled" errors, S6; the `auth-mfa/webauthn` source page returned 404). | Option b-3; self-registration endpoints (6.6) | The owner's look (runbook steps 2 and 5); local characterization (9.2) |
| U7 | Whether `challenge` and `verify` must come from the same IP address (only the error code `mfa_ip_address_mismatch` was seen). On Vercel, two server actions can leave from different addresses. | Server-side challenge flow | Local and Preview tests; use one combined call (`challengeAndVerify`) per server action meanwhile |
| U8 | Whether access tokens refreshed from an `aal2` session keep `aal2` (inferred from S1d). | Session handling after the challenge | Local test |
| U9 | Whether `auth.jwt()` works inside Migration 1's SECURITY DEFINER bodies exactly like `auth.uid()` (both are expected to read the `request.jwt.claims` setting, and SECURITY DEFINER changes only `current_user`; inferred, not read). | Option d-1 | Closable locally before PR 2.8b: read the local stack's `auth.jwt()` and `auth.uid()` definitions; then a pgTAP test in PR 2.8b |
| U10 | The Supabase plan of the company/department organization (D50). The project costs about $10/month (D30), which does not tell the plan. | Phone MFA (Pro and up), session limits (Pro and up), MFA hook (Teams and up) | The owner checks; Claude does not call organization tools (banned by D53) |
| U11 | Whether the owner reaches the Supabase dashboard with a personal account (with or without MFA) or through company single sign-on, and **which other organization members have access to the project** (D50: the department manages access). | The dashboard is the break-glass path (e); every member with project access holds the same power (R16) | The owner checks (his own look) |
| U12 | Whether the owner's Creator sign-in email will be the same address as his Supabase organization member account (only then can the built-in email reach it, S14). | Recovery option p-2 | The owner decides the address (Q8) |
| U13 | Any per-user lockout after failed TOTP attempts. Only the per-IP limit (S8) is documented; the per-user hook is Teams and Enterprise only (S9). | Guessing risk R4 | Local characterization test |
| U14 | The `supabase/config.toml` template comment "available to Supabase Pro plan" contradicts S2 ("free … enabled on all Supabase projects by default"). This document follows S2 and treats the comment as outdated. | Cost (D30) | The owner sees the MFA settings page (U1) |
| U15 | Whether factor deletions and enrolments appear in Supabase's own Auth audit log, visible to the owner. | Evidence for recoveries done outside the app | The owner looks after the first drill |
| U16 | The hosted default for the maximum number of factors per user (the reference says an upper limit of 10; local config 10). | Backup-factor policy | U1 |

---

## 3. Current state (2026-11-06)

- **Nothing is enforced.** No application code reads `aal`; Migration 1 contains no `aal` check (P14, P15) and is not applied; the local stack has TOTP enrolment and verification off (P16).
- **Remote project:** Migration 1 not applied; the owner's D50 Auth settings (B1) not yet confirmed (WORKLOG 2026-11-05, D55 (2)); no Creator (the D49 bootstrap has not run); no app accounts. Hosted projects enable TOTP by default (S2), but the project's MFA and passkey settings have not been inspected (no remote read without approval; U1, U6).
- **Access:** Preview and Production are behind Vercel Authentication, owner only (D29, D31, P4). **This protects the app, not Supabase:** the project URL and the publishable key are public by classification (P4), so anyone who knows a user's password can call Supabase Auth and the Data API directly. MFA is the control that covers that path.
- **Gates already in the plan** (P17 §2.2): the D49 bootstrap waits for Q3 or the owner's explicit acceptance of a window without MFA; remote Manager accounts wait for Q3 and Q7; PR 2.8b waits for open decision 19.

---

## 4. Requirements from the documents

| # | Requirement | Source | Status |
|---|---|---|---|
| RQ1 | MFA for the Creator and the Manager "before production" | P1, P2 | REQ; meaning of "before production" OPEN (6.1) |
| RQ2 | Creator: "MFA required in production" | P5 | REQ |
| RQ3 | Enforcement server-side and in the database, never only in the UI | P1; P2 §5 L71; S1c | REQ |
| RQ4 | `admin_set_role_permission` requires `aal2` once MFA is enforced | P6 | REQ (design document) |
| RQ5 | A restrictive `aal2` policy on all Creator and Manager data | P7; P15; P17 P-4 | REC only (not approved) |
| RQ6 | "MFA follows immediately" after the D49 bootstrap | P8 | REQ wording; its timing relative to go-live OPEN (6.1, 6.3) |
| RQ7 | Tested recovery and reset flows; generic errors; brute-force protection | P2 | REQ; mechanisms OPEN (6.5) |
| RQ8 | Tests of `aal1` vs `aal2` | P9 | REQ (once enforced) |
| RQ9 | MFA at the go-live gate; MFA setup before the pilot | P9, P10 | REQ |
| RQ10 | Free plans only; nothing that can create a charge | D30 | REQ |
| RQ11 | Supabase Auth settings are changed by the owner himself; every remote operation needs his per-operation approval; every migration needs apply approval | P4 §11; D52 rule 4; D53 (3) | REQ |
| RQ12 | No email provider until open decision 9; built-in email reaches only organization team members | P3, D50, S14 | REQ |
| RQ13 | Authorization checked in the database under the caller's session before any Auth Admin call; the secret key never for ordinary reads; SECURITY DEFINER helpers only when they enforce authorization | P2 §4–§5, P18, D34 | REQ |
| RQ14 | Only the Creator manages Manager and Creator accounts; only the Creator sets passwords and changes emails | D34 (e) | REQ |

**Tension (not resolved here):** P8 ("immediately" after the Step 2 bootstrap) and open decision 19 ("Step 2 / pilot") point to Step 2, while P9 and P10 place MFA at the pilot and go-live gates, and D31 made a protected Production address exist now as a testing environment. Section 6.1 turns this into options; the owner decides.

---

## 5. Supabase MFA mechanics that shape the design

1. **Two levels in the token.** A password sign-in gives `aal1`; a verified TOTP challenge upgrades the same session to `aal2` (S1, S2b). A user with a verified factor who has not completed the challenge has `currentLevel = aal1`, `nextLevel = aal2` (S2b).
2. **Enforcement points.**
   - **App:** the server reads `aal` from a verified token (S13: `getClaims()`; or `getUser()` followed by the level of the same validated session, TECH to confirm in 2.8b). It only steers the user (S1e) and protects nothing on its own (S1c).
   - **Database, RLS:** restrictive policies on `aal` (S1c, S12).
   - **Database, SECURITY DEFINER functions:** a function owned by `postgres` bypasses RLS (S12; Migration 1 L83). **A restrictive RLS policy therefore does not protect the admin RPC bodies, or any later SECURITY DEFINER function**, which must check `aal` themselves (6.4).
3. **Rate limits.** Challenge and verify share one limit: 15 per minute per IP, bursts 30, not customizable (S8). The plan runs every Supabase call on the server (no browser client), so every user's MFA attempts share the server's address(es), as in Q11. No per-user lockout is documented (U13); the per-user hook needs the Teams plan (S9).
4. **Factors and recovery.** Up to 10 factors per user; no recovery codes in the documented API; a second factor is Supabase's recommended backup (S5, S10). The Admin API can list and delete a user's factors; deleting a verified factor signs the user out of all sessions (S6).
5. **Self-enrolment and self-registration.** TOTP is enabled on every hosted project by default (S2). Any signed-in user can call the enrolment API with his own token, with or without an app screen (P17 §3.13). Passkey registration (S16) and WebAuthn factors (S6, U6) are further endpoints of the same kind when their settings are on.
6. **Cost.** TOTP is free (S2). Phone MFA is a paid add-on outside the spend cap (S4). Per-user MFA hooks and session limits are plan-dependent (S9, S11, U10).

---

## 6. Design options per Q3 sub-question

### 6.1 (a) What "before production" means

**Fact that shapes the options:** until go-live, every account the app creates is test-marked (Migration 1 `authorize_account_creation` L960–963 and `admin_create_profile` L1023, D47, TEMPORARY until go-live). A test caller manages only test targets (for example L1106) and cannot change credentials (`assert_can_change_credentials` L907–911) or the permission matrix (L794, L848), and a test Creator cannot exist (L112). So before go-live the owner's Creator is the **only real account**, and every remote Manager is a fictional test account that exists only if Q7 allows it.

| Option | Meaning | For | Against | What it blocks |
|---|---|---|---|---|
| **a-1** | Before go-live: enforced before the go-live gate (P10 item 5) and the pilot (P9). During the testing period the owner's Creator works at `aal1` on the development project. | Matches the go-live checklist and "Step 2 / pilot"; earliest working remote login | The owner's real-marked Creator holds full administrative rights on an internet-reachable API with a password only (section 3), contrary to P8 "immediately"; audit rows and data written in that window cannot be shown to be MFA-protected | Nothing now; MFA becomes a go-live blocker. The bootstrap needs the owner's **explicit** acceptance of the window (P17 §2.2 step 10) |
| **a-2** | Before any Creator or Manager account can sign in on any remote project: enforced before the D49 bootstrap and before any remote Manager account | Matches P8 and the database's own escalation design; the window is minutes (bootstrap → enrolment); one database check covers both roles at no extra cost | Working remote login waits for PR 2.8b (app screens plus the database change) and its migration approval; remote test Managers also need the Manager enrolment screens | D49 bootstrap and remote step 11 wait for PR 2.8b to be merged and its migration applied |
| **a-3** | Before the Vercel Production address shows a working login | Simple to state | In practice the same as a-2 (login works only after the bootstrap), but ties the rule to Vercel rather than to the accounts | Same as a-2 |
| **a-4** | The Creator is enforced before the D49 bootstrap (as a-2); Managers are enforced before go-live or before any real Manager exists, whichever comes first | Protects the only real account from the first minute; remote test Managers (if Q7 allows) can be used before the Manager enrolment and reset screens exist; the Manager part can ship in a later PR | Two enforcement stages (two changes, two reviews, two apply approvals) instead of one; until Manager enforcement a test Manager's password alone reaches, through the API, everything a Manager reads (fictional data, plus audit rows of the Creator's actions on test accounts) and allows admin writes on test targets; Manager enforcement becomes a go-live blocker that must not be forgotten; less practice with the Manager flow before go-live | The D49 bootstrap waits for the Creator part of PR 2.8b; remote test Managers wait only for Q7; real Managers and go-live wait for Manager enforcement (go-live gate item 5) |

**REC (recommended default): a-2.** "Production" in the sense of D31 already exists, the Supabase API is public regardless of Vercel Authentication, and P8 already says "immediately". The same check covers the Manager at no extra database cost. **a-4** is the reasonable alternative if the owner wants remote test Managers before the Manager screens exist. If the owner prefers a-1, the plan's gate stays: he accepts the window in words before the bootstrap, and MFA is a go-live blocker.

### 6.2 (b) Factor types and costs (D30)

| Option | Cost | Notes | Status |
|---|---|---|---|
| **b-1 TOTP** (authenticator app on the user's phone) | $0 (S2) | Enabled on hosted projects by default; codes valid 30 s ± one interval (S2c); works offline on the phone; no provider, no message charges | Available |
| **b-2 Phone (SMS/WhatsApp)** | $75/month for the first project on paid plans, billed hourly, **not covered by the spend cap**, plus per-message provider charges (S4); also needs an SMS provider account (a new service) | SIM-swap risk (S3); a "real message" to a person | Excluded by D30 without the owner's explicit approval of a charge |
| **b-3 WebAuthn / passkeys** | Not stated (U6) | Supabase's passkeys are an experimental, passwordless **first-factor** sign-in (S16), not a second factor; a WebAuthn MFA factor exists in the client library, but its hosted availability is unverified (U6) | Not proposed; both stay off (6.6; runbook steps 2 and 5) |
| **b-4 Recovery codes** | UNVERIFIED (U5) | Experimental in the library; "not supported" in the published reference | Not proposed now; revisit when generally available |

**Backup policy (part of b):**
- **b-B1 (REC for the Creator):** two TOTP factors enrolled on two separate devices or authenticator apps (Supabase's own recommendation, S10, and the 10-factor limit, S5).
- **b-B2:** one factor, plus the TOTP secret saved at enrolment. Simpler (one device); acceptable only if the secret is kept apart from the password, as S10 advises ("in a secure location different than your primary one"), not in the same password manager entry.
- **b-B3:** one factor only, recovery through the dashboard (6.5). Depends on U2.
- Managers: one factor required; a second optional; the Creator resets a lost factor (6.5, e-M1).

**REC: b-1 TOTP only; b-B1 for the Creator, one required factor for Managers.** Phone MFA stays off (it is off unless enabled; enabling it would start a charge).

### 6.3 (c) When to enforce for the owner's Creator

| Option | Sequence | Window without MFA | Needs |
|---|---|---|---|
| **c-1** | PR 2.8b (screens plus the database change) merged and its migration applied **before** the bootstrap; the owner signs in, is sent straight to enrolment, and every admin action and (with d-2) every read needs `aal2` from the first minute | Minutes between the bootstrap and the enrolment (the account can do nothing in the app until enrolled; through the API, with d-1 only, it can read at `aal1`) | 6.4 decided; one migration approval; the owner's own enrolment (runbook step 9) |
| **c-2** | Bootstrap first; the app forces enrolment at the first sign-in (app-level only); the database change follows in a later migration | Until that migration is applied: the database accepts the Creator at `aal1` through the public API | The owner's explicit acceptance of that window |
| **c-3** | Bootstrap now; enforcement at go-live (with a-1) | The whole testing period | Explicit acceptance; MFA recorded as a go-live blocker |

- **Relation to D49:** `private.bootstrap_first_creator` refuses any session with JWT claims (P14 L1673–1676), so an `aal2` rule in `require_caller` does not affect it. The bootstrap also ends the Migration 1 rollback window (PR 1.3 README §10), so its timing matters beyond MFA.
- **Relation to `admin_approve_role_permission`:** the owner runs it from his database role with a Creator id placed in `request.jwt.claims` (P14 L828–836). With d-1 those simulated claims must also say `aal2`. This is a documented owner procedure, not a weakening (only the owner's database role can run it).
- **Remote Manager accounts** (P17 §2.2 step 11): under a-2 or a-3, remote Manager accounts wait until Manager enforcement exists. Under a-1 or a-4, whether test-marked Managers may exist remotely before Manager enforcement is part of the owner's answer (Q3 together with Q7); real Managers cannot exist before go-live anyway (6.1). **REC:** create them only after Manager enforcement exists, and have each enrol at his first sign-in, ideally with the Creator present when the password is handed over (Q1 option a), which also exposes a pre-enrolment hijack (R3).
- Under a-4, c-1 applies to the Creator; the Manager part follows in its own change before go-live.

**REC: c-1** (follows a-2). If the owner chooses c-2 or c-3, the acceptance is recorded in the WORKLOG before the bootstrap.

### 6.4 (d) Where `aal2` is enforced

All options below apply only to callers whose **current** role in `profiles` is `creator` or `manager` (the role comes from `profiles`, never from token metadata; P2 §5). Customer Service and Technicians are unaffected. A missing `aal` claim counts as `aal1` (S1), so every check fails closed.

| Option | What | Covers | Does not cover | What it needs |
|---|---|---|---|---|
| **d-0 App only** | Page guards, server actions and adapters require `aal2` for Creator and Manager and redirect to the challenge (S1e) | The app's screens | Direct API calls with the user's own token (section 3). **Insufficient alone** (P1, S1c) | Code only (PR 2.8b); independent review (D53 (4), authentication) |
| **d-1 `private.require_caller`** | The shared caller check adds: when the caller is a Creator or Manager, the request's `aal` must be `aal2`, else `42501` | All 14 admin and matrix RPC bodies (P14), including P6, and every later function that uses the same check; `cancel_account_request` stays open to all roles but requires `aal2` for Creator and Manager callers | Reads through RLS: at `aal1` a Creator or Manager still reads everything his policies allow (profiles, technicians, account requests, audit logs; later customers and visits), and `public.test_data_census()` (SECURITY INVOKER, Creator-only, P14) stays callable at `aal1`. SECURITY DEFINER functions that do not call the shared check | A migration (6.4.1); pgTAP tests; the simulated claims of `admin_approve_role_permission` gain `aal2`; **a rule that every SECURITY DEFINER function executable by `authenticated`, directly or through a public wrapper, calls `private.require_caller` or the shared `aal` helper**, with a reviewed exemption list: the six boolean or own-id helpers of `docs/security.md` §5 (P14), which only report facts about the caller and are used by the policies, and deferred constraint-trigger functions (not callable directly); a `pg_proc` catalog test for that rule with a negative control (9.1) |
| **d-2 Restrictive RLS** (P7, P-4) | Every exposed table gets a restrictive policy `to authenticated`: allowed when the caller is not an active Creator or Manager, or `aal` is `aal2`. **Exception:** the caller's own `profiles` row stays readable at `aal1`, so the app can learn the role and send him to enrolment | Every table read by Creator and Manager through the Data API and through SECURITY INVOKER functions (including `test_data_census()`), now and in later steps, provided every later table carries the policy | SECURITY DEFINER bodies, which bypass RLS (S12, P14 L83): the 14 admin RPCs today, and later narrow read functions (`docs/database-schema.md` §8.3 "through a function", D40), export, media-authorization and visit functions. So d-2 alone leaves them open | A migration; the same policy in **every later migration that adds a table** (Migration 2 in PR #14 is not applied yet); a catalog test that fails for any table without it (like the RLS-on-every-table smoke test); the helper that tells "active Creator or Manager" must be a SECURITY DEFINER helper in `private` like the existing ones (P2 §5) |
| **d-3 d-0 + d-1 + d-2** | All of the above | Screens, admin actions, reads, and every later SECURITY DEFINER function that follows the d-1 rule | SECURITY DEFINER functions that do not use the shared caller check (the d-1 rule and its catalog test exist to catch them) | Both migration parts; the catalog rules for later tables and functions |

#### 6.4.1 What the database part needs (any of d-1, d-2, d-3)

- **Vehicle options:**
  - **v-1** amend Migration 1 before its apply. One apply, but every review of PR #12 restarts on the new head (D53 (2)), and D55 (4) requires the exact migration and its SHA-256 to be presented again; it delays the critical path (Migration 1 is the base of PRs 2.4–2.7).
  - **v-2 (REC)** a new migration after Migration 1 (and, if d-2 is chosen, a rule that Migration 2 and every later migration add the restrictive policy). Migration 1 stays on its approved path.
- **Gates for the new migration:** independent review (authorization, D53 (4)); the migration guard and the canary-rows check (a migration that adds no table or column needs no canary fixture: `tests/db-canary/README.md` "Files"); the full `Database tests` workflow; the owner's **separate apply approval** (D52 rule 4), with audit anchors before and after (PR 1.3 README §9), each read-only run approved; applied immediately before its PR merges (ROADMAP). **Merge:** per D53, unless the owner applies D55 (10)'s separate merge approval to this authentication change (CLAUDE.md lists "RLS/auth changes" as a high-risk stop gate); Claude asks him.
- **Order with the app:** the app's enrolment and challenge screens must exist before the database refuses `aal1`, or the owner locks himself out of every admin action. Either ship the app part first (it can merge without the migration) and the migration second, or both in one PR whose migration is applied right before the merge.
- **Local configuration:** PR 2.8b would turn local TOTP enrolment and verification on in `supabase/config.toml` (P16), if built as decided. That is a `supabase/**` change: it triggers `Database tests` and the canary check.

**REC: d-3 via v-2.** d-1 alone satisfies P6 and protects every administrative write; d-2 is what makes "MFA for Manager" meaningful for reads of personal data (and, from Step 4 on, customer data). d-2 is P-4 and needs the owner's approval as an added mechanism. If the owner wants the smaller change, d-0 + d-1 is the minimum this document considers compliant with P1.

### 6.5 (e) Recovery while no email provider exists

Constraints: no email provider (Q2, open decision 9); the built-in email reaches only members of the organization's team (S14, D50); Claude never handles passwords, secrets or the secret key and performs no remote operation without approval (D53 (3), (7)); Supabase will not restore a lost **dashboard** factor (S10); D49 creates the first Creator once (its bootstrap fails if a Creator exists), and Migration 1 refuses to create a Creator through the app (L948, L1000; TEMPORARY until go-live, comment L933–934, plan Q9 / PR 1.3 Q11), while a test-marked Creator cannot exist (L112). The secret key is set nowhere until Q24 is answered.

#### 6.5.1 Lost factor

| Option | Who | How | Risks |
|---|---|---|---|
| **e-1 Backup factor** (prevention) | The user | Sign in with the second device; remove the lost factor on the account-security screen (needs `aal2`, S1d); enrol a new one | None beyond keeping both devices apart |
| **e-2 Dashboard removal** (Creator's break-glass) | The owner himself, in the Supabase dashboard | Remove the Creator's factors on Authentication → Users (U2); sign in at `aal1`; the app forces re-enrolment at once | Depends on U2; leaves no row in the app's audit log (the owner records it in the WORKLOG; U15); whoever controls the owner's Supabase account can do the same, so that account needs its own MFA and backup factor (S10, U11); **so can every other organization member with access to the project** (D50; U11; R16) |
| **e-3 Admin API by the owner** | The owner, with the secret key, from a trusted environment | `auth.admin.mfa.deleteFactor` (S5, S6); signs the user out everywhere | The owner does not run Node locally; handling the secret key in a terminal risks shell history; Claude never does this for him |
| **e-4 SQL editor** | The owner | Delete the factor rows in `auth` tables | Unsupported (U4); writes into a Supabase-managed schema. **Not recommended** |
| **e-M1 Creator resets a Manager's factor in the app** | The Creator | A Creator-only action: first an audited database check under his session (extend `assert_can_change_credentials` with a new kind, or a new RPC), then, on the server with the secret key, `listFactors` and `deleteFactor` as one privileged operation (RQ13; not an ordinary read). The Manager is signed out everywhere (S6) and re-enrols at his next sign-in | A migration (re-review, apply approval); the reset is itself a sensitive action that requires the Creator at `aal2` (d-1); **needs Q24** (the secret key in the deployed environment): until then the action shows "unavailable" and the owner uses e-M2 |
| **e-M2 Owner resets a Manager through the dashboard** | The owner | As e-2 for the Manager | No app audit row; avoidable once e-M1 exists |

#### 6.5.2 Forgotten Creator password

Today's plan lets the Creator set **other** users' passwords (PR 2.7; RQ14). Nobody can set the Creator's password from inside the app when he cannot sign in.

| Option | How | Needs | Risks |
|---|---|---|---|
| **p-0 Prevention** | The owner keeps his password in a password manager | Nothing | Does not help if the manager itself is lost |
| **p-1 Dashboard direct set** | The owner sets a new password for his user in the dashboard, if such an action exists (U2) | U2 confirmed | None in the app; no app audit row; any organization member with project access can do the same (R16) |
| **p-2 Built-in recovery email to himself** | Dashboard "send password recovery" (or a magic link) to the owner's own address, which works only if that address is a member of the organization's team (S14, U12) | Site URL and redirect URLs (Q12), a reset-password page in the app (new code), the owner's approval of a real email to himself (stop gate), the 2-per-hour built-in limit (S8); after the reset he still completes the TOTP challenge | Adds an email-link flow while Q2 says "no reset links"; breaks if a password holder changed the account's email (Q22, R17) |
| **p-3 Admin API by the owner** | `updateUserById` with the secret key | As e-3 | As e-3 |
| **p-4 SQL editor** | Write a new password hash into `auth.users` | Unsupported (U4) | The password appears in query history. **Not recommended** |
| **p-5 Second, break-glass Creator** | A second real Creator account, held offline by the owner with its own factors, which can reset the first one's password through the normal Creator flow | Plan Q9 answered and a migration: Migration 1 refuses `p_role = 'creator'` (L948, L1000), and until go-live every new user is test-marked (L960–963) while a test Creator is forbidden (L112), so a second real Creator also needs an exception to the test-marking rule or a second owner-run bootstrap path. Not a change to D49, which forbids only automatic promotion and makes the first bootstrap one-time | More privileged accounts to protect; the last-Creator lock (§8.4 rule 4) then guards two accounts |

**REC (recovery):** prevention first (b-B1 backup factor, p-0 password manager). Break-glass for the Creator is the owner himself in the Supabase dashboard (e-2, p-1), **after he confirms U2 and protects his own Supabase account with MFA and a backup factor** (S10, U11). If U2 shows no direct password action, decide between p-2 (build a minimal reset page, approved real email to himself only) and p-5 (break-glass Creator). Managers: e-M1, built with the MFA migration, so every reset is audited (once Q24 provides the secret key; e-M2 until then). Every owner-run recovery is recorded in the WORKLOG (date, account, what was done, no secrets) because the app's audit log does not see it.

### 6.6 (f) Hosted self-enrolment behaviour

- **Fact (S2):** TOTP enrolment and verification are on by default on hosted projects. Any signed-in user can enrol a factor through the Auth API with his own token, without any app screen (P17 §3.13).
- **Effects:**
  - A Customer Service user or Technician who enrols a factor gets `nextLevel = aal2` at his next sign-in.
  - **Pre-enrolment hijack:** a person who learns a Manager's password before the Manager enrols can enrol his own factor first, reach `aal2`, and lock the real Manager out (U3 decides whether a second enrolment at `aal1` is possible).
  - Unenrolling needs `aal2` (S1d), so a password alone cannot remove a verified factor.
- **Passkeys and WebAuthn factors** are further self-service endpoints. If passkey sign-in is on (S16), anyone holding only a user's password could sign in and register a passkey: a lasting, passwordless sign-in method that survives a password reset by the Creator (the Creator's reset changes the password, not the passkey). If WebAuthn MFA is on (U6), a user could enrol a factor that the app's TOTP-only challenge cannot handle. **Both must stay off** under every option below; the owner confirms them off in his own look (runbook steps 2 and 5), and a local characterization records the refusal (9.2).

| Option | Setting (the owner's own action) | App behaviour | For | Against |
|---|---|---|---|---|
| **f-1** | Keep TOTP enrolment and verification on (default); phone, passkeys and WebAuthn off | Creator and Manager must enrol and pass the challenge. For Customer Service and Technicians: if they have a verified factor, the app honours it and asks for the code (Supabase's "opted-in" mode, S1c, app-level only); otherwise nothing changes | Nothing to change remotely; respects a user's own factor; a user who enrolled is asked for his code in the app | **App-level only:** the database still accepts these roles at `aal1`, so their factor protects nothing against a direct API caller (the same false sense of protection as f-2); **hijack lockout:** anyone with a Technician's or Customer Service user's password can enrol a factor and lock him out of the app, because he cannot unenrol at `aal1` (S1d); **who resets their factors is open** (a D34 (e)-type credential question: the Creator only, by analogy?); the database "opted-in" variant (S1c) would add protection but extend the lockout to the database |
| **f-2** | Same setting | The app ignores factors of Customer Service and Technicians (it never asks them for a code) | Simpler; a hijacker's factor cannot lock these users out of the app; no reset path or new credential decision needed for these roles; matches the database, which does not require `aal2` from them either | A user who enrolled (only possible through the API; the app offers no screen) believes his account is protected when neither the app nor the database asks; the factor stays on the account (if the user later becomes a Manager, it is required: an unexpected factor then shows as a challenge instead of enrolment, R3) |
| **f-3** | Disable enrolment until PR 2.8b ships, then enable it | — | Nobody can pre-enrol | An extra remote setting change at a precise moment; no other account exists before Q7 anyway |

**REC: f-2.** With symmetric trade-offs, honouring factors of roles the database does not protect adds a lockout path and an open reset question without real protection. Pre-enrolment hijack of Managers is handled by creating Managers only after Manager enforcement (REC; under a-1 or a-4 this is part of the owner's answer, 6.3), handing the password over in person (Q1 a), enrolling in the same sitting (an unexpected factor then shows as a challenge instead of the enrolment screen), and, if M11 provides one, showing each Manager's factor status to the Creator (section 7, screen M-7).

---

## 7. Enrolment and challenge UX outline (prototype later in `/dev/demo`, fake data)

Screens are shown first with fake data (CLAUDE.md "Visual approval"), at 390 / 820 / 1440 px for every role that can open them (D27), with proposed `docs/demo-deviations.md` ADD rows. Hebrew strings below are **examples only**, for the owner's feedback.

| # | Screen | Who | Content (Hebrew examples) | Notes |
|---|---|---|---|---|
| M-1 | Enrolment intro | Creator, Manager at `aal1` without a verified factor | "לחשבון שלך נדרש אימות דו-שלבי." / "המשך" / "יציאה" | Reached right after sign-in; no other screen until done |
| M-2 | Scan and confirm | same | "סרקו את הקוד באפליקציית האימות" / "לא מצליחים לסרוק? הקלידו את המפתח" / "קוד בן 6 ספרות" / "אישור" | QR shown as an image data URL from the server response (never inserted as markup); the secret shown as LTR text grouped in blocks; code input LTR, numeric, `autocomplete="one-time-code"`; response not cached |
| M-3 | Backup device | Creator (required under b-B1), Manager (optional) | "הוספת מכשיר גיבוי" / factor names "טלפון ראשי", "גיבוי" | Same flow, second factor |
| M-4 | Challenge at sign-in | Creator and Manager with a verified factor (under f-1 also other roles with one) | "הזינו את הקוד מאפליקציית האימות" / "אימות" / "אין לי גישה לאפליקציה" / "יציאה"; device choice when two factors exist | One server action performs challenge and verify together (U7) |
| M-5 | No access to the app | same | Manager: "פנו ליוצר לאיפוס האימות הדו-שלבי." Creator: "השתמשו במכשיר הגיבוי, או בצעו את נוהל השחזור של הבעלים." | No self-service bypass |
| M-6 | Account security | Creator, Manager (under f-1 also others with a factor) | "אבטחת חשבון": factor names and dates, "הוספת מכשיר", "הסרה" | Needs `aal2`; the last required factor cannot be removed (app-level rule: through the API a user at `aal2` can unenrol it; the database then denies him at `aal1` and the app forces re-enrolment) |
| M-7 | Factor status for the Creator | Creator, on his users screen | Badge "אימות דו-שלבי: מוגדר / לא מוגדר"; action "איפוס אימות דו-שלבי" on Manager rows (if e-M1) with a confirmation that the user will be signed out everywhere | **How the status is read is an owner decision (M11); each option conflicts with an approved rule.** (i) Admin API `listFactors` with the secret key, after a read-only database pre-check under the Creator's session (`assert_can_manage`, which writes no audit row; not `assert_can_change_credentials`, which writes one): conflicts with `docs/architecture-data-access.md` L143 ("never used for ordinary reads") and `docs/security.md` §5 (the same conflict as plan Q5 (b)), and needs Q24. (ii) A narrow database function reading `auth.mfa_factors` (a migration): strains §5, which allows SECURITY DEFINER helpers only when they enforce authorization (this one reports a fact about another user), unless it is shaped as an admin body behind a SECURITY INVOKER wrapper like Migration 1's (its documented deviation S11). (iii) None |

**Messages (examples):** wrong code "הקוד שגוי. נסו שוב עם הקוד הנוכחי."; too many attempts "יותר מדי ניסיונות. המתינו דקה ונסו שוב."; expired challenge "פג תוקף האימות. נסו שוב."; service failures reuse the existing "הכניסה אינה זמינה כרגע. נסו שוב מאוחר יותר."

**Rules for every MFA screen:** the TOTP secret, QR and codes are never logged, stored by the app, returned twice or included in screenshots of real accounts; prototypes use a fake secret; wrong-role users get the existing no-access state; "יציאה" works at `aal1`.

---

## 8. The owner's runbook

Legend: **[OWNER]** the owner's own action in a provider dashboard (Claude never changes Supabase settings, P4 §11); **[APPROVAL]** a remote operation Claude performs only after the owner's approval of that specific operation (D53 (3)); **[D53]** Claude's own work under D53 with no Supabase contact (it includes the usual GitHub branch, PR and owner-only Vercel Preview).

**Placement in the plan's remote sequence (P17 §2.2).** Steps 1–5 below can run at any time. Step 6 follows plan §2.2 steps 1–6 (the D50 Auth settings confirmed (B1), the read-only check, Migration 1 applied, PR #12 merged, the audit anchor, the post-apply assertions). Steps 7–9 also need §2.2 steps 7–8 (the Q12 Auth settings, the keys, the Vercel values (Q24) and a redeploy). Runbook step 7 is §2.2 step 9, runbook step 8 is §2.2 step 10, and runbook step 11 happens within §2.2 step 11.

| # | Step | Kind |
|---|---|---|
| 1 | Answer the decision table (section 11). | [OWNER] decision |
| 2 | Look (no change) at the project's MFA settings page and at Authentication → Passkeys; report the labels, that "Enable Passkey authentication" is off, and that WebAuthn MFA is off if the page shows it (U1, U6, U16). Report the organization's plan (U10) and which organization members have access to the project (U11). | [OWNER] read-only look |
| 3 | Protect his own Supabase dashboard account: MFA on, with a backup factor on a second device (S10). If he signs in through company single sign-on, follow the company's process (U11). | [OWNER] |
| 4 | Build PR 2.8b: app screens (prototype first), guards, server actions, the MFA migration as decided, local configuration, tests; independent review on the final head. | [D53] |
| 5 | Confirm the project's settings: TOTP enrolment and verification on (the default), phone MFA off, WebAuthn MFA off, "Enable Passkey authentication" off. Confirm in words (no screenshot showing keys). | [OWNER] |
| 6 | Audit anchor before the apply (read-only SELECT), apply the MFA migration (D52 rule 4), audit anchor after; merge PR 2.8b right after the apply. Order relative to Migration 1 and Migration 2 as decided (6.4.1). | [APPROVAL] each run; merge per D53, unless the owner applies D55 (10)'s separate merge approval to this authentication change (Claude asks him) |
| 7 | Create his own Auth user with his chosen email (Q8; U12); keep the password in his password manager; never share it. | [OWNER] |
| 7a | Look (no change) at his own user's menu on Authentication → Users; report whether "remove MFA factors" and a direct password action exist (U2). | [OWNER] read-only look |
| 8 | D49 bootstrap with audit anchors before and after (P17 §2.2 step 10). | [APPROVAL] |
| 9 | First sign-in on the Production address: enrol the primary TOTP factor, then the backup factor on a second device (b-B1); sign out and sign in again to see the challenge. | [OWNER] |
| 10 | Tell Claude "enrolled, two factors"; Claude records it in the WORKLOG (no secrets, no QR screenshots). | [OWNER] then [D53] |
| 11 | Recovery drill on a **test-marked** Manager account once Q7 allows remote test accounts: reset its factor through the app (e-M1; needs Q24, until then "unavailable") or the dashboard (e-M2), re-enrol, record the result. A test Creator cannot exist (Migration 1 L112), so the Creator's dashboard break-glass (e-2) is drilled through e-M2 on the test-marked Manager: the same dashboard action on another user (and, if U2 shows it, the dashboard password action of p-1 likewise). This is the "tested recovery" of `docs/security.md` §4. | [OWNER] (plus [APPROVAL] for any Claude-run remote step) |
| 12 | Before go-live: every Manager is enrolled (shown "מוגדר" on M-7 if M11 provides a status; otherwise confirmed by the Creator in person); the recovery procedure was drilled (step 11); the go-live gate item 5 is ticked. | [OWNER] |

**Recovery procedures (when needed):**
- **Creator, one device lost:** sign in with the backup factor → M-6 → remove the lost factor → enrol a new one.
- **Creator, all factors lost:** [OWNER] dashboard removal (e-2) → sign in → immediate re-enrolment of two factors → WORKLOG entry.
- **Creator, password forgotten:** p-1 if available; otherwise the option the owner chose (p-2 or p-5); never p-4.
- **Manager, factor lost:** the Creator uses "איפוס אימות דו-שלבי" (e-M1; e-M2 until Q24 provides the secret key); the Manager re-enrols at his next sign-in, preferably with the Creator present.
- **Manager, password forgotten:** the Creator sets a new one (PR 2.7, D34 (e)); the factor stays.
- **Suspected compromise of a Manager:** the Creator deactivates the account (immediate in the database), resets its factors (signs it out everywhere, S6) and sets a new password. Access tokens already issued stay valid until expiry for Auth-level calls (S15; Q10).
- **Not listed as procedures: e-3 and p-3 (Admin API by the owner).** The owner does not run Node locally, and he would handle the secret key in a terminal (6.5). They stay available as a last resort if he chooses them (M7, M9).

---

## 9. Test plan

All tests run locally or in CI against the local stack only (testing.md; RQ11). Creator cases follow Q6 (until it is answered they are pending, and pgTAP covers the database side).

### 9.1 Database (pgTAP, `tests/db/`)

The existing tests already simulate sessions by setting `request.jwt.claims`; the MFA cases add the `aal` claim.

| Case | Expected |
|---|---|
| Creator and Manager with `aal` = `aal1`, with no `aal` claim, and with invalid values (`AAL2`, `aal3`, empty, a number) call each of the 14 RPC bodies (d-1) | `42501` |
| The same with `aal2` | Today's behaviour unchanged (the existing assertions re-run at `aal2`) |
| Customer Service and Technician at `aal1` call `cancel_account_request` and read their own rows | Unchanged |
| d-1 catalog test (`pg_proc`): every SECURITY DEFINER function in `public` or `private` that `authenticated` may execute calls `private.require_caller` or the shared `aal` helper, or is on the reviewed exemption list (6.4) | Passes on the real catalog; **fails for a probe SECURITY DEFINER function without the check** (negative control). A text match on the function body is a tripwire, not proof (like the canary-rows check) |
| d-2: Creator and Manager at `aal1` read every table | Own `profiles` row only; zero rows elsewhere |
| d-2: at `aal2` | Today's results |
| d-2: `test_data_census()` by the Creator at `aal1` | Counts only what the restrictive policy allows (d-1 alone: unchanged, the documented gap of 6.4) |
| d-2 catalog test: every table in `public` has the restrictive policy, or is on a justified exemption list | Fails for a probe table without it (negative control) |
| `bootstrap_first_creator` from the owner's role with no claims | Unchanged |
| `admin_approve_role_permission` with simulated Creator claims without `aal2` | `42501`; with `aal2`: unchanged |
| An `aal` value in `user_metadata` or `app_metadata` | Ignored (only the top-level claim counts) |

### 9.2 Service tests (local Auth server, no browser)

- TOTP codes are computed in the test from the enrolment secret (RFC 6238 with Node's built-in crypto; no new package; TECH). Secrets stay in the test process, never printed.
- Enrol, challenge and verify for a seeded test Manager → the session is `aal2` → an admin RPC succeeds; the same user at `aal1` → `42501`.
- Wrong code → `mfa_verification_failed`; an expired challenge → `mfa_challenge_expired`.
- Admin `deleteFactor` of a verified factor → refresh fails (signed out everywhere, S6).
- Unenroll at `aal1` is refused (S1d).
- **Characterization (records behaviour, no fixed expectation):** enrolling a second factor at `aal1` when one is verified (U3); a refreshed `aal2` token keeps `aal2` (U8); challenge and verify in separate calls (U7); repeated wrong codes for one user (U13); a user changing his own password or email at `aal1` while he has a verified factor (Q22, R17); the per-IP limit (S8) as seen locally; **passkey registration at `aal1` while passkeys are disabled** (expected `passkey_disabled`, S16) and WebAuthn factor enrolment while it is disabled (expected `mfa_webauthn_enroll_not_enabled`, S6); if the pinned local Auth server has no such endpoint, the test records that.

### 9.3 End-to-end (browser, local production build)

- A Manager signs in → M-1/M-2 → enrolled → lands on his start screen; the next sign-in shows M-4.
- At `aal1`, every office page (document, RSC, prefetch and segment variants, as the existing gate specs do), every server action and every adapter call is denied or redirected to M-4; nothing of the page's data is rendered.
- "יציאה" works at `aal1` and clears the cookies.
- A Technician never sees M-1 to M-7 (f-2); under f-1, only if he enrolled a factor himself.
- The enrolment response is not cached; the secret appears in no log, in no other response and in no client bundle (`scan:bundle`).
- Screens at 390 / 820 / 1440 px; screenshots from a local production build with fake data only.

### 9.4 Negative cases (summary)

Password-only access through the Data API for Creator and Manager (RPC and table reads); a forged token claiming `aal2` (wrong signature) is rejected by the API; a Manager cannot reset another user's factor (e-M1 is Creator-only); a test-marked Creator cannot exist (Migration 1 L112), so no test can grant one MFA rights; the MFA screens never offer a way around the challenge; passkey and WebAuthn registration are refused while disabled.

### 9.5 Remote

None by Claude. The only remote "test" is the owner's own enrolment and drill (runbook steps 9 and 11).

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Password-only window** (a-1, c-2, c-3; under a-4 for test-marked Managers until Manager enforcement): the account can be used through the public Supabase API with a password alone; Vercel Authentication does not protect that path | a-2/c-1; otherwise the owner's explicit, recorded acceptance and a strong unique password (Q12 policy) |
| R2 | **Single Creator lockout:** the owner is the only Creator; losing both his factors and his Supabase dashboard access leaves no in-app recovery, and Supabase does not restore dashboard factors (S10). The owner may not be the only organization member with project access (D50; U11), so his recovery may depend on another member | b-B1 backup factor; dashboard account MFA with backup (runbook 3); p-5 as an option |
| R3 | **Pre-enrolment hijack** of a Manager account (6.6) | Managers created only after Manager enforcement (REC; 6.3); in-person handover and enrolment (Q1 a), where an unexpected factor shows as a challenge instead of the enrolment screen; factor status on M-7 if M11 provides one; e-M1 reset |
| R4 | **TOTP guessing** once the password is known. Estimate (inference, not a Supabase statement): up to three codes accepted at a time (S2c) out of a million; challenge and verify share one limit of 15 requests per minute per address (S8), so 15 guesses a minute is the upper bound for a direct caller (if one challenge accepts several verifications), and through the app each guess costs a challenge and a verify (about half that); at 15 a minute that is roughly a 6% chance per address per day, and more with many addresses; no per-user lockout documented (U13); the per-user hook needs the Teams plan (S9) | The password stays the first barrier (Q12 policy; Q11 brute-force mechanism); watch for repeated failures in the app's instrumentation (P2 §8) |
| R5 | **Shared server address** for MFA rate limits: one user's failures, or an attacker through the app, can block MFA for every office user for a minute | Few office users; Vercel Authentication during testing; same root cause as Q11. Forwarding the user's address (S8) needs the per-project switch and the secret key on user requests, which conflicts with `docs/security.md` §5 (plan Q11 (b)) |
| R6 | **Serverless IP changes** between challenge and verify (U7) | One combined call per server action; local and Preview checks |
| R7 | **RLS-only enforcement** (d-2 without d-1) leaves the admin RPCs open, because SECURITY DEFINER bodies bypass RLS (S12, P14 L83) | d-1 is part of every recommended combination |
| R8 | **A later table or SECURITY DEFINER function without the check** (d-2's policy, d-1's caller check) | Both catalog tests with negative controls (9.1); review checklist for every migration |
| R9 | **Stale `aal2` tokens** after a factor reset or deactivation stay valid until expiry for Auth-level calls (S15; local `jwt_expiry` 3600 s); the database denies on the next request only where it checks the role or `is_active` | Deactivation is immediate in the database; Q10 decides any further mechanism |
| R10 | **Secret exposure during enrolment** (server → browser; logs; screenshots) | Section 7 rules; `no-store`; instrumentation logs event names and codes only (P2 §8) |
| R11 | **Recovery outside the app** leaves no app audit row | WORKLOG entry for every owner-run recovery; e-M1 for Managers (audited) |
| R12 | **Cost creep:** enabling phone MFA starts an hourly charge outside the spend cap (S4) | b-1 only; D30 |
| R13 | **Review reset** if Migration 1 is amended (v-1) | v-2 |
| R14 | **Local vs hosted drift:** TOTP off locally, on remotely (P16, S2) | PR 2.8b would turn it on locally, if built as decided; runbook step 5 confirms the remote setting |
| R15 | **Unsupported SQL recovery** (e-4, p-4) could break Auth state or expose a password in query history | Not recommended; dashboard or Admin API only |
| R16 | **Organization members with project access** hold the same break-glass power as the owner (factor removal, password actions, SQL), and app MFA does not protect against them (`docs/security.md` §8 makes the same point for the audit log) | The owner checks who has project access (his own look, U11; runbook step 2); every recovery is recorded in the WORKLOG |
| R17 | **Self-service credential change at `aal1`:** a password holder may change the user's own password or email through the Auth API (Q22); for the Creator this can lock him out of his password and, with an email change, break p-2 | The Q12 settings (Secure password change, Secure email change, notification emails); the §9.2 characterization; Q22's decision |
| R18 | **Passkeys or WebAuthn MFA switched on** (by default or by mistake): a password holder registers a lasting sign-in method or an unsupported factor (6.6) | Both off, confirmed by the owner (runbook steps 2 and 5); §9.2 characterization |

---

## 11. Decision table for the owner

Every "recommended default" is a **technical recommendation, not a decision**. Until each item is answered, the temporary behaviour applies: design only, no enforcement, bootstrap and remote Manager accounts gated, no remote setting changed.

| # | Decision | Options | Recommended default (REC) | What it blocks or unblocks |
|---|---|---|---|---|
| M1 | (a) Meaning of "before production" | a-1 before go-live; a-2 before any Creator/Manager signs in remotely; a-3 before Production shows a working login; a-4 Creator before the bootstrap, Managers before go-live or before any real Manager | **a-2** (alternative: a-4 if remote test Managers are wanted before the Manager screens) | a-2/a-3: the D49 bootstrap and remote Managers wait for PR 2.8b and its migration. a-4: the bootstrap waits for the Creator part; remote test Managers wait only for Q7; Manager enforcement is a go-live blocker. a-1: unblocks the bootstrap after the owner's explicit acceptance of the window; MFA becomes a go-live blocker |
| M2 | (b) Factor types | b-1 TOTP; b-2 phone (paid); b-3 WebAuthn / passkeys (passkeys are a first-factor sign-in; WebAuthn MFA unverified); b-4 recovery codes (unverified) | **b-1 TOTP only**; passkeys and WebAuthn off | b-2 needs an explicit owner approval of a charge (D30) and an SMS provider; b-3/b-4 wait for U5/U6 |
| M3 | Backup factor policy | b-B1 two devices; b-B2 secret kept apart from the password; b-B3 one factor | **b-B1 for the Creator; one required factor for Managers** | b-B3 makes recovery depend on U2 |
| M4 | (c) Creator enforcement timing | c-1 before bootstrap; c-2 app first, database later; c-3 at go-live | **c-1** | c-1 blocks the bootstrap until PR 2.8b is merged and applied; c-2/c-3 need a recorded acceptance of the window |
| M5 | (d) Where `aal2` is enforced | d-0 app only (not compliant); d-1 `require_caller` plus the rule for every SECURITY DEFINER function; d-2 restrictive RLS (P-4); d-3 all | **d-3** (minimum compliant: d-0 + d-1) | d-1 and d-2 each need a migration with independent review and apply approval (D52 rule 4); d-1 binds every later SECURITY DEFINER function and d-2 every later table (including Migration 2), each with a catalog test |
| M6 | Migration vehicle | v-1 amend Migration 1 before apply; v-2 new migration after it | **v-2** | v-1 restarts PR #12's reviews and its D55 (4) presentation; v-2 needs its own apply approval |
| M7 | (e) Creator's lost factor | e-1 backup; e-2 dashboard removal by the owner; e-3 Admin API by the owner; e-4 SQL (not recommended) | **e-1, with e-2 as break-glass after U2** | e-2 depends on U2, on the owner's own Supabase account security (runbook 3) and on who else has project access (U11) |
| M8 | (e) Manager's lost factor | e-M1 Creator resets in the app (audited); e-M2 owner via dashboard | **e-M1** (e-M2 until Q24) | e-M1 needs a database change (new kind or RPC) in the MFA migration and **Q24** (the secret key in the deployed environment); until then it shows "unavailable" and the owner uses e-M2 |
| M9 | (e) Forgotten Creator password | p-0 prevention; p-1 dashboard direct set (U2); p-2 built-in recovery email to himself (reset page, Site URL, approved real email); p-3 Admin API by the owner; p-4 SQL (not recommended); p-5 break-glass second Creator | **p-0 plus p-1 if U2 confirms it; otherwise choose p-2 or p-5** | p-2 adds an email-link flow (Q2, Q12) and a real email to the owner; p-5 needs plan Q9 answered and a migration (6.5.2) |
| M10 | (f) Hosted TOTP self-enrolment | f-1 keep on, honour factors of other roles (app-level only); f-2 keep on, ignore them; f-3 disable until 2.8b. Under every option passkeys and WebAuthn MFA stay off | **f-2** | f-1 also needs an answer on who resets Technicians' and Customer Service users' factors (the Creator only, by analogy with D34 (e)?); f-3 needs two timed setting changes by the owner |
| M11 | Factor status for the Creator (M-7) | (i) Admin API `listFactors` after a read-only `assert_can_manage` pre-check (conflicts with `architecture-data-access.md` L143 and `security.md` §5, as plan Q5 (b); needs Q24); (ii) a narrow database function (a migration; strains `security.md` §5 unless shaped as an admin body); (iii) none | **No recommendation between (i) and (ii)**: each conflicts with an approved rule, so the owner decides (together with Q5). Meanwhile (iii), deny by default, with in-person detection at the first sign-in (R3) | (iii) removes the Creator's view of R3's hijack; (i) also waits for Q24 |

**What stays blocked until the answers:** PR 2.8b; the D49 bootstrap (unless the owner explicitly accepts a window without MFA); remote Manager accounts (also Q7); go-live gate item 5.

---

## 12. What this document does not change

- No approved document is reworded: `CLAUDE.md`, `docs/security.md`, `docs/database-schema.md`, `docs/decisions.md` and Migration 1 are unchanged. Recording the owner's answers (a decision row, the security wording for the chosen recovery procedure, the schema rules for d-1 and d-2) happens in later PRs; any change that weakens a protected file needs the owner's approval (D53 (3)).
- No remote operation was performed for this document; Supabase was read only through its public documentation source and the installed client library.

---

## 13. Review record

An independent critique of the first draft found no blocker, 9 "should" findings and 14 nits; every point was addressed in this revision. Where the fix differs from the critique's wording:

- **S-2:** the d-1 rule's exemption list also names Migration 1's six boolean or own-id SECURITY DEFINER helpers (P14). Without them the rule would fail on Migration 1 itself, and making them call the caller check would break the policies that use them.
- **S-6:** M11 carries no recommendation between its two read options (both conflict with an approved rule); the temporary behaviour is "none" with in-person detection.
- **S-8:** with the trade-offs made symmetric, the recommended default for (f) changed from f-1 to f-2.
- **N-1:** the comment "nothing creates a Creator" is at Migration 1 L933–934 (enforced at L948 and L1000), not L929–930.
- **N-12:** U9 stays UNVERIFIED; the local reading that closes it is listed as its verification method (this document starts no local stack).
- Not adopted: none.
