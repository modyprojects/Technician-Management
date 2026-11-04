# Project Map — current state

Last updated: 2026-11-04 (UI demo with fictional data, phase F, branch `claude/ui-demo-4`, stacked on `claude/ui-demo-3` (PR #8, phase E); PR #5 is merged to `main` as `013fd2f`).

## 1. Purpose and how to read it

This file shows the repository **as it is now**: what exists, where it lives, and which capabilities are implemented, mock or planned. It is the current-state map; `docs/WORKLOG.md` is the history. Do not copy WORKLOG entries here, and do not repeat decision text: link to it.

- `README.md` — short entry point; links here.
- `CLAUDE.md` — binding workflow, security and architecture rules.
- `docs/ROADMAP.md` — steps, goals and owner checks.
- `docs/WORKLOG.md` — what was done, when, and how it was verified.
- `docs/decisions.md` → `docs/demo-deviations.md` → `docs/demo.html` — precedence for requirements and design (`CLAUDE.md`).

Status words used below: **Implemented** (built and tested), **Mock or demo** (fictitious data or prototype only, not real behavior), **Planned** (not built yet).

## 2. Repository structure (as it exists now)

| Path | Responsibility |
|---|---|
| `app/layout.tsx` | Root layout: Hebrew, RTL, self-hosted Rubik and Assistant fonts, `noindex` metadata |
| `app/page.tsx` | Temporary Hebrew home page; replaced by the role-based start screen in Step 2 |
| `app/not-found.tsx` | Hebrew 404 page |
| `app/globals.css` | Demo design tokens (`:root` values copied from `docs/demo.html`) and base styles; Tailwind without preflight |
| `styles/ui.css` | Component and shell styles copied from `docs/demo.html` (only the classes in use; no demo chrome); the Settings classes (`.set-*`) are the demo's inline settings styles as classes |
| `app/dev/` | Restricted developer area: `_gate.ts` (gate logic), `layout.tsx`, `showcase/` (token swatches, technician and office shells, 390 / 820 / 1440 size view, a "הושלמו היום" list with rows) with fictitious data in `showcase/_fixtures.ts` (G-05), and `demo/` (below). Served only when the `/dev` gate allows it |
| `app/dev/demo/` | UI demo with fictional data (D53): landing (`/dev/demo`, lists the viewpoints: technician, manager, customer service, Creator; no role switcher in the screens, X-02), office homes `office/[role]` (manager and Creator "לוח בקרה", customer service "בית"), calls list `office/[role]/calls` (search and filters in the URL, server paging), call card `office/[role]/calls/[req]`, manager dashboards `office/[role]/analytics` (customer service gets "אין הרשאה"), office "יומן טכנאים" `office/[role]/calendar` (day / week / month, technician filter and the visit drawer, all in the URL `?view&date&tech&req&n`), technician home `tech`, visit card `tech/visit/[req]/[n]`, work and close screens (`.../work`, `.../close`), "היומן שלי" `tech/calendar` (`?view&date`), "הושלמו היום" `tech/done` and the read-only closed visit `tech/done/[req]/[n]`, notifications `tech/notifications` and profile `tech/profile`, Settings `office/[role]/settings/[tab]` (seven tabs: "משתמשים והרשאות" with accounts, requests and the permission matrix, "טכנאים", "מקומות איסוף", "סיבות המשך טיפול", "סוגי קריאה", "מיילים והתראות", "תבנית זימון"; the Creator sees every tab, the Manager and customer service get "אין הרשאה" with the default matrix values) the Manager's account administration `office/[role]/users` (customer service "אין הרשאה", the Creator a link to Settings), "לקוחות" `office/[role]/customers` (`?q&page`, server search by name, customer number, phone or city) and the customer card `office/[role]/customers/[id]` (status counters, details, products that came back, the customer's calls), "מוצרים" `office/[role]/products` (`?q&page`; inline edit of name, brand and supplier with `products`; customer service "אין הרשאה"), "זימונים שלא נקלטו" `office/[role]/unparsed` (`?page`) and "חזרו מהשטח" `office/[role]/back-from-field` (`?tech&page`; both offered to every office role by a temporary rule pending open decision #15, d23, labelled on each screen); route loaders `users/_accounts.ts` and `settings/[tab]/_users.ts` read through `demoDataAccess`, and `office/[role]/_simulatedState.ts` builds the scoped server state of the simulated commands (only the Settings tabs that delete, the account screens and "מוצרים" receive it); `tech/layout.tsx` keeps the simulated visit statuses across the technician screens. Every page renders the fixture sentinel and the "נתוני בדיקה" strip (`_components/DemoPage.tsx`) |
| `app/dev/demo/_data/` | Fixtures and the fixture adapter (G-05): `adapter.ts` exports `demoDataAccess` (the `DataAccess` ports, `server-only`); `seed.ts`, `reference.ts`, `queries.ts` (also `server-only`), `mappers.ts`, `aggregations.ts`, `settings.ts` and `accounts.ts` (Settings and account fixtures), `customers.ts` (customers derived from the calls and the returns rule), `products.ts` (catalogue rows) and `intake.ts` (unparsed invitations, all from the simulator) feed it; `routes.ts`, `roles.ts`, `dates.ts`, `params.ts` are the only other modules pages may import (ESLint) |
| `app/dev/demo/_components/` | `DemoPage` / `DemoFrames` (sentinel, test-data strip, shells), `DemoToast` ("פעולה מדומה · לא נשמר"), `SimulatedCommands` (the demo's `Commands`: validates input, checks what a server would against the fixtures (`SimulatedServerState`: references, pending requests, account states, product versions and active options, scoped per screen by `office/[role]/_simulatedState.ts`; empty, deny by default, everywhere else), returns `{ok, simulated: true}` with created records as the real commands will, saves nothing) |
| `features/data-access/` | Shared data-access types: `DataAccess` and `Commands` aggregates, `Page<T>`, `CommandResult` (with `simulated`), list bounds, `CommandsProvider` / `useCommands()` (`docs/architecture-data-access.md`) |
| `features/*/data/` | Typed ports, DTOs and input validators per feature: `calls`, `visits`, `calendar` (office and technician calendar read models and the unparsed-invitations read model; `search-params.ts` maps the calendar URL; `dates.ts` is the one set of pure date helpers, including the arrows' `shiftCalendarDate`, for both calendars and the demo fixtures), `dashboards`, `reference` (technicians, products, reasons, places, permission values, approval text), `notifications`, `profile`, `settings` (permission matrix, technicians, places, reasons, call types, mail, invitation template), `accounts` (accounts and account requests, D34), `customers` (list and card, `search-params.ts` maps `?q&page`), `products` (catalogue, brands and suppliers, the edit and its validators; `search-params.ts` maps `?q&page`); `calls` also maps the back-from-field URL (`?tech&page`). No fixture data; a Supabase adapter implements the same ports later |
| `proxy.ts` | `/dev` gate: runs before rendering; a closed gate returns the Hebrew 404 with no showcase content |
| `components/ui/` | Shared UI components (buttons, chips, segmented control, tabs, toggle, visit and call status pills, test-data badge, KPI, bars, pager, list item, icons) and `pending-hint.ts` (one wording for an item that waits for an open owner decision) |
| `components/tech/` | Technician shell, home header, bottom navigation, next-visit card, pickups, schedule, visit header / info / history, work screen (media tiles, summary and simulated recording, parts), close screen (outcome, signature pad, follow-up reason and next-visit note), shared bell link, "היומן שלי" (header, view switch, day strip and timeline, week, month; grid helpers in `CalendarDates.ts`), "הושלמו היום" list and the one read-only closed-visit view (`DoneVisitView`, also used for a closed visit opened at its visit-card address), notifications (read-state provider, header, list), profile (header, week figures, notification toggles, help) |
| `components/office/` | Office shell and sidebar, calls filters and table, call card and visit timeline, dashboard parts (KPI grid, sections, status bar, technician lanes, work queues, test-data note), manager analytics (general, technicians, drill-down, products, no access), "יומן טכנאים" (toolbar, day / week / month views, no-access card) and the visit drawer (`CallDrawer`, modal dialog), customers (`CustomerSearch`, `CustomersTable`, `CustomerCard`), products (`ProductSearch`, `ProductsTable` with the inline edit, `ProductRules`), the work-queue screens (`UnparsedInvitationsList`, `BackFromFieldList` with its technician filter), Settings (`SettingsShell`, tab links, the shared switch `SettingsShellToggle`, the permission matrix `SettingsMatrix`, technicians, places, reasons and the "טופל" text, call types, mail, template; `SettingsUsersTab`) and account administration (`AccountAdminScreen`, forms, requests and shared parts; used by the Creator's Settings tab and the Manager's "משתמשים") |
| `config/release.json` | `testingPeriod` switch (D31): `/dev` in Vercel Production and the bundle fixture check; set to `false` at the go-live gate (`docs/deployment.md`) |
| `vercel.json` | Production build guard: `npm ci`; builds only Preview deployments and Production from `main` (D31); anything else is skipped (fails closed) |
| `next.config.ts` | Baseline security headers for every route (`docs/security.md`) |
| `.npmrc` | Supply-chain settings: exact versions, no install scripts, 7-day release cooldown |
| `.env.example` | Environment variable **names** only; no values |
| `package.json` | Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test:e2e`, `test:ci`, `test:db` (needs the Supabase CLI and Docker), `check:migrations`, `screenshots`, `scan:bundle`, `scan:secrets`; exact dependency versions (lockfile `package-lock.json`) |
| `eslint.config.mjs`, `tsconfig.json`, `postcss.config.mjs` | Lint, strict TypeScript and Tailwind/PostCSS configuration |
| `playwright.config.ts` | Playwright at 390 / 820 / 1440 px; one build served twice (`/dev` open and closed) |
| `tests/e2e/` | End-to-end tests: RTL and overflow, breakpoints, demo tokens, security headers, `/dev` gate (positive and negative, showcase and every UI-demo route, RSC and prefetch variants), owner review rules, UI demo (`demo.spec.ts`: every demo route and calendar view at 390 / 820 / 1440, search and filters, call card, access by role, simulated actions, signature, calendar navigation and filters, visit drawer, technician calendar views, closed-visit views, notifications, profile, office navigation per role, Settings access and tabs, permission matrix, account administration and requests, every D34 activation path, the add forms' submit flows, operational settings, what the browser receives, phase F navigation per role, customers search and card, products edit and access, unparsed invitations and back from field); `data-validate.spec.ts`: negative tests of the shared validators and list filters (pure logic); `screenshots.spec.ts` runs on demand only |
| `tests/ci/` | Tests for CI scripts (`node --test`): the migration guard |
| `tests/db/` | Database tests (pgTAP) run against a local Supabase database in CI: catalog-wide checks that `anon` and `PUBLIC` have no table, sequence or function privileges in `public` or `private`, `anon` has no usage on `private`, and every table has RLS and a test-data marker (D47) |
| `supabase/config.toml` | Local Supabase configuration for CI tests: Postgres 17, invitation-only Auth (sign-ups off, D50), seed disabled (no seed file). Not used for the remote project |
| `scripts/install-supabase-cli.sh` | Installs the pinned Supabase CLI (checksum-verified) in CI |
| `scripts/check-migrations.mjs` | Migration guard (D47): migrations may insert only approved reference data and never test markers |
| `scripts/check-bundle.mjs` | Post-build browser bundle check: secret patterns always; fixture sentinel after go-live |
| `scripts/scan-secrets.sh` | Local Gitleaks scan (same pinned version as CI), values redacted |
| `.github/workflows/ci.yml` | CI: Gitleaks, lint, typecheck, CI script tests, migration guard, build, bundle check, e2e, dependency audit; read-only token, pinned actions |
| `.github/workflows/db.yml` | Database tests: runs only when database files change; migration guard, pinned Supabase CLI, local database (`supabase db start`), pgTAP (`supabase test db tests/db`); no secrets |
| `.github/pull_request_template.md` | PR description and checklist |
| `docs/` | Decisions, demo deviations, spec, security, architecture, data-access architecture (`architecture-data-access.md`), database schema (approved Step 1 design), deployment, testing, design system, integrations, Outlook template, roadmap, thinking ahead, work log, this map |
| `docs/research/` | Research notes, not decisions (`d31-anonymous-access-check.md`: automated anonymous-access check, not implemented) |
| `docs/demo.html` | Original Hebrew interactive prototype: design reference only, **not production code** |
| `docs/review/` | Review screenshots per step (`docs/review/step-0/`, `docs/review/ui-demo-1/`, `docs/review/ui-demo-2/` and `docs/review/ui-demo-3/`, each with the matching `demo-` shots from `docs/demo.html`; `docs/review/ui-demo-4/` has none, because the demo has no such screens, OF-16), fictitious data only |
| `docs/user-guides/` | Hebrew user guides (D15): placeholders until features are tested |
| `docs/history/` | Superseded context; not authoritative |
| `prompts/` | Claude Code prompts (`STEP-0-PLAN.md`) |
| `START-HERE.md` | Beginner guide for the owner |

Not created yet (see section 4): `app/(auth)/`, `app/(tech)/tech/`, `app/(office)/office/`, `app/api/`, `lib/`, `supabase/migrations/`, and the feature logic folders (`features/calendar`, `features/products`, `features/exports`, `features/transcription`; `features/` holds only data-access ports, URL-state mappers and validators so far).

## 3. Status

| Capability | Status | Step |
|---|---|---|
| Design tokens, technician and office shells, temporary home and 404 pages | Implemented | Step 0 |
| `/dev` showcase with fixtures (fictitious data) | Mock or demo (dev only) | Step 0 |
| UI demo with fictional data (`/dev/demo`: office homes, calls list, call card, manager dashboards, office calendar and visit drawer, technician home, visit, work and close, technician calendar, "הושלמו היום" and closed-visit view, notifications, profile, the Creator viewpoint, Settings tabs with the permission matrix (values temporary, D51; display only, G-04) and account administration (D34), customers and the customer card, products with a simulated edit, unparsed invitations (rep mail pending d09) and back from field (new Outlook invitation disabled until Microsoft 365, D23); every action simulated; no usage screen, OF-15 pending d13) | Mock or demo (dev only) | D53, before the remaining Step 1 work |
| Data-access layer (typed ports in `features/*/data`, `useCommands()`) | Implemented (fixture adapter `demoDataAccess`); Supabase adapter Planned | D53; Supabase adapter after Step 1 |
| Security headers, `/dev` gate, CI, secret scan, bundle check | Implemented | Step 0 |
| Protected Preview and Production (Vercel Authentication, owner only; D29, D31) | Implemented (Vercel settings; verified read-only by Claude Code before each merge and after each Production deployment; owner checks periodic; D53) | Step 0 |
| Database test infrastructure | Implemented | Step 1, PR 1.2 |
| Database schema, RLS, grants, permission matrix (D33; values temporary until Step 10, D51), account approval (D34), test-data marking (D47) | Planned | Step 1, PRs 1.3–1.6 |
| Step 1 report (Hebrew), ER diagram | Planned | Step 1, PR 1.7 |
| Authentication and user administration | Planned | Step 2 |
| Technician views | Planned | Step 3 |
| Visit workflow and offline | Planned | Step 4 |
| Office screens | Planned | Step 5 |
| Calendar ingestion and Outlook invitation simulator | Planned | Step 6 |
| Email (outbox, mock adapter) and in-app notifications | Planned | Step 7 |
| Excel export | Planned | Step 8 |
| Dashboards | Planned | Step 9 |
| Settings and hardening | Planned | Step 10 |
| Microsoft 365 and pilot | Planned | Step 11 |
| Hebrew user guides with real screenshots (D15) | Planned (written as features are tested) | From Step 3 |

## 4. Where things belong

| What | Where |
|---|---|
| UI routes | `app/(auth)/`, `app/(tech)/tech/`, `app/(office)/office/`; route handlers in `app/api/` |
| Components | `components/ui`, `components/tech`, `components/office` |
| Data access | Ports, DTOs and validators in `features/<feature>/data`; screens read only through them and run actions only through `useCommands()` (`docs/architecture-data-access.md`); fixture adapter only under `app/dev` |
| Feature logic | `features/visits`, `features/customers`, `features/calendar` (single service in `features/calendar/ingestion`, adapters in `features/calendar/adapters/simulator` and, later, `features/calendar/adapters/graph`), `features/products`, `features/notifications`, `features/exports`, `features/transcription` |
| Server-only code | `lib/`, with server-only module checks |
| Database schema | `supabase/migrations/` (migrations only; never fictitious data, D47) |
| Database tests | `tests/db/` (the Supabase CLI accepts this path, so no deviation from `CLAUDE.md`; decided in PR 1.2) |
| End-to-end tests | `tests/e2e/` |
| Test data | Marked and labelled per D47 (`data_source` / `is_test`, "נתוני בדיקה" / "🧪 זימון בדיקה"); fixtures for screens only under `app/dev` (G-05); no local seed file (seeding disabled in `supabase/config.toml`; `supabase/seed.sql` does not exist); any future local CI fixtures are marked `automated_test`, never in migrations (`docs/database-schema.md` §2) |
| Review screenshots | `docs/review/<step>/` |

## 5. Keeping it current

- Update this file in the same PR whenever the repository structure or a capability's status changes (Definition of Done in `CLAUDE.md`; checklist line in `.github/pull_request_template.md`).
- Keep it a snapshot: history goes to `docs/WORKLOG.md`, decisions to `docs/decisions.md`.
- `README.md` stays short and links here.
