# D31 automation research: anonymous-access check

## 1. Status
- **Research only. Not implemented** (owner, 2026-11-03; D53 (5): automated D31 workflows are deferred). No workflow, file, setting, token or Vercel/GitHub configuration was created or changed.
- Meanwhile D31 runs manually: Claude Code's read-only checks before each merge and after each Production deployment, and the owner's periodic anonymous-access and dashboard checks.
- Method (read-only, 2026-11-03). Every claim was re-verified by a second agent. Refuted claims appear here only in their corrected form; inferences are marked *(inference)* and unverified points *(unverified)*.
  - `vercel.com` and `docs.github.com` were unreachable from the session. Vercel docs were read through the Vercel docs MCP index and search snippets.
  - GitHub docs were read from the `github/docs` source (commit `7fa55a0a`, 2026-11-02).
  - Vercel code was read from `vercel/repository-dispatch` (`bad8e8a0bb`), `vercel/wait-for-deployment-action` (`0e2b0c5c`) and `vercel/vercel-plugin` (`3ca3e549`).
  - No `*.vercel.app` response could be observed: the session proxy rejects the connection (CONNECT 403).

## 2. Event options

### Evidence in this repository (read-only `gh api`, 2026-11-03)
- Only `ci.yml` and `db.yml` exist. There are zero runs for `repository_dispatch`, `deployment_status`, `status` and `deployment`. With no listener, this says nothing about what Vercel emits.
- **`status` (observed).** `vercel[bot]` posts legacy commit statuses with context `Vercel`.
  - On `76fed5f`: pending "Vercel is deploying your app" at 12:56:02Z, then success "Deployment has completed" at 12:57:41Z.
  - `target_url` is the Vercel inspector, `https://vercel.com/mody-projects/technician-management/<id>`, not a deployment URL. The id is the deployment id without the `dpl_` prefix (`wait-for-deployment-action`).
  - The Preview commit `b84c14b` received the same context and descriptions, so a status alone cannot tell Production from Preview.
- **`deployment_status` (probably not emitted here, *inference*).**
  - The GitHub Deployments API returned 403 to the session, and PRs #1–#4 have no "deployed" timeline events.
  - Vercel documents the event as on by default, with a "deployment_status Events" toggle under Settings > Git.
- **`repository_dispatch` (unverified for this project).** Nothing listens yet. A setting probably exists under Settings > Git; its exact label, default and Hobby/private-repo availability are *unverified*.

### Semantics
| Event | Workflow version that runs | `GITHUB_SHA` | Deployment data |
|---|---|---|---|
| `repository_dispatch` | Default branch only (the file must be on `main`) | Last commit on `main` | `client_payload`: `project.{id,name}`, `environment`, `git.{ref,sha,shortSha}`, `id` (`dpl_…`), `url`, optional `alias[]`, `state.type` |
| `status` | Default branch only | Last commit on `main` | `sha`, `context`, `state`, `target_url` (inspector), `sender`; no environment, no URL |
| `deployment_status` | The deployed commit's copy (a Preview runs the PR branch's copy) | Deployed commit | `environment`, `environment_url` / `target_url`, `state`; no `types` or `branches` filter; `inactive` does not trigger |

- **Vercel event types:** `vercel.deployment.{ready, success, error, canceled, ignored, skipped, pending, failed, promoted}`.
  - Wildcards are claimed only by Vercel; GitHub documents exact `types`, so list them explicitly.
  - The package's type union omits `ready`.
- **Event meanings (Vercel README):** `ready` = built, not promoted; `success` = built and automatically promoted to production; `promoted` = promoted (automatic or manual). But Vercel's own examples use `success` for Preview tests, so a filter must require `environment == 'production'` as well as the type.
  - Whether `success` and `promoted` both fire for one deployment is undocumented.
  - The Deployment Checks docs say `ready` fires before checks and before aliasing.
- **The payload is untrusted.**
  - It is unsigned and limited to 10 top-level properties, and the error variant has no `url`, `id` or `alias`.
  - Any token with Contents: write can create a dispatch, including the `GITHUB_TOKEN` of any workflow granted `contents: write`.
  - `sender` is set by GitHub, not by the payload.
- **`deployment_status` environment names:** plain `Production` / `Preview` for a single-project repo, `Production – <slug>` for multi-project repos. Confirm from a real event. *Unverified:* whether Vercel posts `pending` first and then `success`; keep a `state == 'success'` filter regardless.

### Recommendation (proposal)
1. **Primary trigger: `repository_dispatch`.** List its types explicitly: `success` and `promoted`, plus `error`, `failed`, `canceled` and `ignored` so those are recorded as "not verified". Filter at job level on `environment == 'production'`. It runs `main`'s workflow and carries the deployment id, SHA and URL.
2. **Cross-check with `status`.** The payload `id` must equal `dpl_` + the last `target_url` segment of the `vercel[bot]` `Vercel` success status on the same SHA. `github.event.sender.login` must be the Vercel app (expected `vercel[bot]`; confirm from a real event).
3. **`workflow_dispatch`** for manual re-checks and controlled tests. It also needs the file on `main`, and anyone with write access can run it on any branch, so the merge gate must verify where a result came from (§8).
4. **Not recommended: `deployment_status`.** It appears inactive here, and Preview runs execute a PR-modified checker.
5. **Precondition:** a separately approved listener PR that logs only non-sensitive fields (type, environment, `project.id`, `git.sha`, URL host) to confirm delivery.

## 3. Vercel Authentication: anonymous response
- **Documented (prose only):** unauthenticated visitors get "a Vercel login redirect". No status code or URL format is documented.
- **Observed by third parties, not by us.** An anonymous GET or HEAD returns **HTTP 302** with `Location: https://vercel.com/sso-api?url=<percent-encoded requested URL>&nonce=<value>`.
  - Sources: github.com/scheuclu/whale_tracker/issues/85, github.com/TestSprite/testsprite-cli/issues/620, github.com/Roy-Wanyoike/Motivra/issues/96 and github.com/ejc3/aws/pull/300.
  - A Hobby report from a GitHub Actions job saw the same 302 shape. Those requests carried a rejected OIDC header and targeted a Preview deployment.
  - The behaviour is undocumented and can change.
- **401 also occurs.**
  - One project reports 401 for an unauthenticated raw request to an immutable production URL (method not stated).
  - Vercel's KB gives 401 for a CORS preflight and for cross-origin subresources without the cookie.
  - When Vercel answers 401 rather than 302 is undocumented.
- **Never follow redirects.** `/sso-api` leads to `vercel.com/login`, which returns 200, so a client that follows redirects sees "reachable".
  - Parse the first-hop `Location` exactly: scheme `https`, host exactly `vercel.com`, path exactly `/sso-api`, and a `url` parameter whose decoded origin equals the requested origin.
  - Never match by substring, which would accept `vercel.com.evil.example`.
  - A first hop straight to `vercel.com/login` has not been observed and counts as inconclusive.
  - Later hops are never trusted.
- **403 is not a Vercel signal.**
  - No raw observation shows Vercel Authentication answering 403; a Vercel-authored skill mentions "a protection 401 or 403" without detail.
  - In this session the egress proxy answered 403 to CONNECT (curl exit 56).
  - A bare 401/403 without positive Vercel evidence, or a firewall challenge, is **inconclusive**.
- **Missing paths also hit the wall.** Vercel documents that Deployment Protection requires authentication for all requests, including Routing Middleware. A KB on Password Protection says it runs at the edge before application code and covers static files; applying that to Vercel Authentication is an *inference*.
  - A third party saw `/robots.txt` return 404 publicly but 302 on the protected alias.
  - So a 404 is never evidence of protection, and an anonymous response cannot prove that a path exists.
- **Headers.** `set-cookie: _vercel_sso_nonce=…`, `server: Vercel` and `x-robots-tag: noindex` were observed, but none is a documented marker. `server: Vercel` is on every Vercel response, and this app's `next.config.ts` sets `X-Robots-Tag` on every route.
- **Per-host testing.** The access cookie is scoped to one URL, so each hostname is gated, and tested, separately.
- **Request-time setting.** Protection is a per-project setting: "Disabling Vercel Authentication renders all existing deployments unprotected". It is evaluated at request time *(inference)*.
- **Scope values.** `ssoProtection.deploymentType = all` means All Deployments (expected here). `prod_deployment_urls_and_all_previews` means Standard (production custom domains unprotected), and `null` means off. A Vercel changelog (about September 2026) made All Deployments free on every plan.
- **OPTIONS is not a valid probe.** The OPTIONS Allowlist disables all protection for OPTIONS on listed path prefixes. A KB says `/api` is listed by default for new projects; the reference page does not confirm it.

## 4. Probe set and fail-closed markers
- **Hosts.** Use fixed hosts, never hosts taken from the payload: `technician-management-mody-projects.vercel.app`, `technician-management.vercel.app` and `technician-management-git-main-mody-projects.vercel.app`.
  - Also the deployment's unique URL from the payload, only after validation against `^technician-management-[a-z0-9]+-mody-projects\.vercel\.app$`. The regex must be confirmed against a real event.
- **Paths:**
  - `/`;
  - `/dev/showcase`: in Production during the testing period the gate is open, so an unprotected response would be the fictitious showcase (200); after go-live it would be the app's 404; both are failures;
  - an invented missing path;
  - (proposal) the `/dev/demo` pages once merged.
- **Request variants.** Use the variants `tests/e2e/dev-gate.spec.ts` already lists: document, `?_rsc` with `RSC: 1`, prefetch, segment prefetch, `.rsc`, `.segments/_tree.segment.rsc`. The segment-tree variants carry no body markers, so any 200 on them fails.
- **Static assets.** There is no `public/` directory and no favicon. Hashed `/_next/static` names cannot be discovered anonymously, and a CI rebuild does not reliably reproduce Vercel's names. A stable asset probe would need a dedicated `public/` canary file, which is a security-sensitive change and needs an owner decision.
- **Methods:** GET and HEAD, never OPTIONS.
- **Request hygiene:**
  - no cookies and no redirect following;
  - refuse any `x-vercel-protection-bypass` header or query parameter, `x-vercel-set-bypass-cookie` and `x-vercel-trusted-oidc-idp-token`;
  - assert that `VERCEL_AUTOMATION_BYPASS_SECRET` and `VERCEL_OIDC_TOKEN` are absent;
  - pass payload fields through `env`, never interpolated into shell.

| Response | Class |
|---|---|
| 302 to exactly `https://vercel.com/sso-api` with a matching `url` and a `nonce`, and no app markers | Protected (pass) |
| 401 with positive Vercel-origin evidence (marker still to be observed), no app markers | Owner decision pending |
| 401/403 without Vercel evidence; first hop to `vercel.com/login`; firewall challenge; timeout, connection or TLS error | Inconclusive: manual check |
| 200; 404; any app marker; same-host or look-alike redirect; app redirects (e.g. 308 trailing slash) | Fail: exposed |

**App markers (any one means failure)**, observed in the prerendered HTML at `76fed5f`:
- `<html lang="he" dir="rtl"`;
- the titles "ניהול טכנאים", "תצוגת רכיבים · תצוגת פיתוח" and "השוואת גדלים · תצוגת פיתוח";
- the texts "האפליקציה בבנייה" and "העמוד לא נמצא", and the classes `stagewrap` and `app-root`;
- the fixture sentinel `FIXTURE-SENTINEL-TM-STEP0`. The UI demo's `DemoPage` also renders it.

The app's CSP and Permissions-Policy headers are an extra failure signal only, because it is unknown whether the wall carries them.

## 5. Binding the check to the intended deployment
- **The wall carries no deployment identifier**, so an anonymous probe cannot show which deployment an alias serves. The protection setting itself is project-wide.
- **Required before a pass** *(proposal)*:
  - `environment == 'production'`;
  - `project.id == prj_n7738ShbK5Pl0UuaVflBROQndR3u`;
  - `git.ref == 'main'`;
  - `git.sha` equals `main` HEAD read through the GitHub API at run time; otherwise the result is "superseded / inconclusive";
  - the `sender` check and the inspector-id cross-check (§2);
  - a validated URL host;
  - a missing or empty `alias[]` is inconclusive.
- **Concurrency.** Key the concurrency group on the deployment id. A newer queued run cancels the pending one; the cancelled run writes no status, which reads as "not verified". Do not use `queue: max`.
- **Rollbacks.** `main` HEAD equal to the SHA does not prove where the aliases point: an Instant Rollback moves them without changing `main`. Confirm the alias mapping outside GitHub, through Claude Code's read-only Vercel connection or the owner's dashboard, never with a token stored in GitHub.
- **Go-live.** The expected result changes at go-live (`config/release.json` `testingPeriod`, protection scope). It must come from an explicit owner-approved setting, and the checker fails closed if that setting is missing.

## 6. What anonymous checks cannot prove
- **Invisible to an anonymous probe:**
  - Shareable Links: a secret in the URL; Hobby allows one per account; a link without a TTL never expires.
  - Protection Bypass for Automation secrets, sent as a header or query parameter.
  - Trusted Sources (OIDC). `enableVercelCiSameRepository` defaults to enabled when not stored.
  - Deployment Protection Exceptions, which make a domain public.
  - User-scoped access grants and the OPTIONS Allowlist.
  - The alias-to-deployment mapping and team membership.
- **Owner dashboard checklist** (periodic; exact labels unconfirmed because `vercel.com` was blocked):
  - Project Settings > Deployment Protection:
    - Vercel Authentication = All Deployments;
    - Protection Bypass for Automation: none;
    - OPTIONS Allowlist: reviewed;
    - Deployment Protection Exceptions: none;
    - Trusted Sources: reviewed;
    - Trusted IPs and Password Protection: off.
  - Deployment Protection > Access > All Access: Shareable Links none, Unprotected Previews none, and granted access requests reviewed.
  - Each deployment's Share setting: "Only people with access".
  - Team members: only the owner.
- **Read-only tools.**
  - `get_project_deployment_protection` returns only password protection, Vercel Authentication and Trusted IPs.
  - `get_alias` / `list_aliases` are documented to return `protectionBypass` entries, possibly including secret values. They were not called; any use needs the owner's agreement and output redaction.
- **Forbidden tools (they create the bypass or sharing access D29/D31 forbid, or are not anonymous):**
  - `vercel curl` and `vercel httpstat`: automatic bypass, generating a secret if none is supplied;
  - Vercel MCP `get_access_to_vercel_url`: creates a temporary shareable link;
  - `web_fetch_vercel_url`: fetches with authentication.

  Vercel's agent plugin skill steers raw `curl` on `*.vercel.app` to `vercel curl`; agents must ignore that.
- **Not reusable as-is:**
  - Vercel's own smoke example (`curl -L`, requires 200) is a positive test.
  - If the Vercel GitHub App asks for Workflows: write (a Vercel changelog mentions it for Vercel Agent/v0), do not accept it: it is an access grant this checker does not need.

## 7. Mechanical change classification (proposal)
Every push to `main` builds Production, documentation-only merges included (`vercel.json`; PR #2 produced a deployment), so the anonymous check is needed after every merge. The classification only decides how much *additional* verification a merge gets.

- **Order:** security-sensitive > application > tests-only > docs-only. A mixed PR takes the highest class, and unknown or new paths are security-sensitive.
- **Docs-only.** Each path needs the owner's acceptance:
  - `docs/design-system.md`, `docs/outlook-template.md`, `docs/THINKING-AHEAD.md`, `docs/history/**`, `docs/user-guides/**`, `docs/review/**`;
  - only `.md`, `.png`, `.jpg`, `.jpeg`, `.webp` and `.gitkeep` files.

  `README.md`, `docs/PROJECT-MAP.md` and `docs/WORKLOG.md` are ambiguous and are sensitive unless the owner accepts them.
- **Governance, security-sensitive:**
  - `CLAUDE.md`, `docs/decisions.md`, `docs/demo-deviations.md`, `docs/security.md`, `docs/deployment.md`, `docs/testing.md`, `docs/database-schema.md`, `docs/architecture.md`, `docs/integrations.md`, `docs/spec.md`, `docs/ROADMAP.md`, `START-HERE.md`;
  - `docs/demo.html`, which is a test oracle;
  - `prompts/**`, `.claude/**` and `.github/pull_request_template.md`.
- **Deploy and access, security-sensitive:**
  - routing: `proxy.ts`, `middleware.*`, `instrumentation*.*`, `src/**`;
  - config: `next.config.*`, `vercel.json`, `vercel.*`, `.vercelignore`, `config/**`;
  - routes: `app/dev/**`, any `layout.*`, `app/api/**`, any `route.(ts|js)`, `app/(auth|tech|office)/**`, any new page or metadata route;
  - server code and data: `lib/**`, `features/**`, `supabase/**`;
  - CI and tooling: `.github/**`, `scripts/**`, `package.json`, `package-lock.json`, `.npmrc`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `playwright.config.ts`;
  - secrets and serving: `.env*`, `.gitignore`, `public/**`.
- **Tests-only:**
  - New files: `tests/e2e/*.spec.ts`, `tests/ci/*.test.mjs` or `tests/db/*.test.sql`.
  - Changes to non-security tests.
  - Modifying, deleting or renaming a security test is sensitive. That covers `dev-gate`, `gate-logic` and `security-headers` specs, `tests/e2e/helpers.ts`, `tests/db/**` and `tests/ci/**`.
- **Application (owner to confirm).** `styles/**` and `app/globals.css`.
  - `components/**`, `app/page.tsx` and `app/not-found.tsx` are sensitive by default.
  - Alternative: an approved application class that becomes sensitive when the diff adds any of: `"use server"`, a `server-only` import, route segment config, metadata or robots exports, `process.env`, or imports from `lib/`, `features/` or `app/dev/`.
- **Edge rules:**
  - Diff options: diff with `--no-renames` and `-z`, so a rename counts as a deletion plus an addition, and classify a deletion by its old path.
  - File types: any symlink, gitlink, type change or mode change is sensitive. Binaries are allowed only under `docs/review/**` and `docs/user-guides/images/**`.
  - Inconclusive diffs: an empty or failed diff is inconclusive.
  - Commits compared: classify the exact head SHA against the merge base, re-run when the head or base changes, and re-check the squash commit against its parent.
  - Ignored inputs: never use PR titles or labels.
  - Rule source: take the rules from the base branch, because `pull_request` workflows run the PR's own copy. Any change to `.github/**` or `scripts/**` is sensitive.

## 8. Failure handling
- **Silence is "not verified".** No signal exists when a dispatch is never delivered or a workflow never runs. Specific cases:
  - A job skipped by `if:` reports **Success**, so an Actions conclusion is never evidence.
  - Ignored Production builds emit `vercel.deployment.ignored`, and reportedly no `deployment_status`.
  - An alias failure arrives as `failed` / `aliasing_failed`.
  - Over-quota usage is blocked, so the checker does not run at all.
- **Positive record.** After positive verification only, the checker writes a dedicated commit status (e.g. `D31 anonymous check` = success) on the exact `main` SHA.
  - The gate must verify that the status came from a run of the checker workflow on `main` (via `target_url`: path and `head_branch`).
  - Any workflow with `statuses: write` can write the same context, including a `workflow_dispatch` run on another branch, and every `GITHUB_TOKEN` status shows `github-actions[bot]`.
- **No required checks on GitHub Free.** Private repos on GitHub Free have no protected branches or rulesets, and `main` reports `protected: false`. Enforcement stays procedural: before each merge Claude Code checks the record and where it came from. Without it, a manual check is required.
- **Fail or inconclusive:** stop further merges until the owner confirms; independent development continues (D53 (5)).
- **Evidence expiry.** Log and artifact retention is 90 days by default (1–400 for private repos). Since 2026-10-01 the same retention also deletes checks, workflow runs and commit statuses, so results are copied into `docs/WORKLOG.md`.
- **Controlled tests** (`workflow_dispatch`, local servers inside the runner, never the real app):
  - The real app served locally must fail on its markers.
  - Stubs must all fail or be inconclusive: 401 with and without Vercel evidence; 403 `text/plain`; 302 to a same-host `/login`; 302 to a look-alike host; the Hebrew 404; 200 without markers; timeout; connection refused; TLS error.
  - Only a recognised protection response passes.

## 9. GitHub Actions permissions and Free limits
- **Permissions:**
  - `contents: read`, `statuses: write`, and `actions: read` for provenance checks; everything unspecified is `none`.
  - Never `id-token: write`, so the job cannot present an OIDC token.
  - No `environment:` key: environments are unavailable for private repos on Free, and a job that uses one creates deployment objects.
  - The repository is user-owned, so the workflow's `permissions` key sets these; no repository setting change is needed. The session could not read the default-permission setting.
- **No recursion.** Events created with `GITHUB_TOKEN` start no runs, except `workflow_dispatch`, `repository_dispatch` and approval-required `pull_request` runs. A status the checker writes therefore does not retrigger a `status` workflow.
- **Free plan allowance.** Private repos get $12 of compute a month: about 2,000 minutes on `ubuntu-latest` at $0.006/min, or `ubuntu-slim` at $0.002/min (1 core, 15-minute job limit). Each job rounds up to a whole minute. Storage: 500 MB of artifacts and a 10 GB cache.
- **Estimated cost.** About $0.006 or $0.002 per Production deployment; 30 deployments a month is about $0.18 or $0.06. Existing CI usage was not measured. Jobs skipped by `if:` are probably not billed *(undocumented)*.
- **No charges.** Without a payment method, usage is blocked rather than billed. The owner reported no payment method on GitHub (WORKLOG, 2026-11-02). Larger runners require one: never use them (D30).
- **Other limits:**
  - a job can run up to 6 hours;
  - 20 concurrent standard jobs;
  - `GITHUB_TOKEN` gets 1,000 REST requests per hour per repository;
  - at most 1,000 statuses per SHA and context.

## 10. Open questions
1. Does Vercel send `repository_dispatch` for this Hobby project and private repo? What are the setting's label and default? Does the Vercel GitHub App hold Contents: write?
2. Is the "deployment_status Events" toggle on? Does Vercel create GitHub Deployment objects here?
3. What is the exact `sender.login` of Vercel's dispatch?
4. Do `success` and `promoted` both fire? Does `alias[]` list all three Production addresses, assigned before `success`?
5. What does Vercel return to an anonymous non-browser request for this project? Status, `Location`, cookies, headers, body. When is it 401 rather than 302? Does the wall carry the `next.config.ts` headers?
6. Can a Vercel firewall or attack challenge reach GitHub-hosted runners, and with what status?
7. Is the OPTIONS Allowlist on, with `/api` listed? What are the Trusted Sources settings?
8. Can any anonymous signal bind a response to a deployment id? Evidence so far says no.
9. Is a scheduled re-check compatible with D25 ("no scheduled background jobs"), which appears to target the app?
10. What is the repository's retention setting?

## 11. Owner decisions pending
1. Whether, and when, to implement the automated check (deferred by D53).
2. Accepted protection responses: a possible D31 wording change, currently "401 or redirect to the Vercel login".
   - Exact 302 to `https://vercel.com/sso-api`;
   - 401 only with Vercel evidence;
   - whether 403, or a direct first hop to `vercel.com/login`, is ever accepted;
   - 200 and 404 are never accepted.
3. Whether D31 names the `main` branch address and the deployment's unique URL next to the two Production domains.
4. Whether to add a `public/` canary file (security-sensitive; it becomes public if the protection scope changes).
5. Approval of a listener PR to confirm event delivery, and a one-time controlled observation of raw responses (from a GitHub-hosted runner or the owner's browser devtools).
6. The classification tiers in §7: which documents are docs-only, the application class, and the rules for changing tests.
7. The owner-approved setting that defines the expected state after go-live.
8. Whether Claude Code may read alias `protectionBypass` metadata through `get_alias`, with redaction.
