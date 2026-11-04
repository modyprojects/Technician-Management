# Project Map — current state

Last updated: 2026-11-04 (UI demo with fictional data, branch `claude/ui-demo-1`).

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
| `styles/ui.css` | Component and shell styles copied from `docs/demo.html` (only the classes in use; no demo chrome) |
| `app/dev/` | Restricted developer area: `_gate.ts` (gate logic), `layout.tsx`, `showcase/` (token swatches, technician and office shells, 390 / 820 / 1440 size view) with fictitious data in `showcase/_fixtures.ts` (G-05), and `demo/` (below). Served only when the `/dev` gate allows it |
| `app/dev/demo/` | UI demo with fictional data (D53): landing (`/dev/demo`), office homes `office/[role]` (manager "לוח בקרה", customer service "בית"), calls list `office/[role]/calls` (search and filters in the URL, server paging), call card `office/[role]/calls/[req]`, manager dashboards `office/[role]/analytics` (customer service gets "אין הרשאה"), technician home `tech`, visit card `tech/visit/[req]/[n]`, work and close screens (`.../work`, `.../close`); `tech/layout.tsx` keeps the simulated visit statuses across the technician screens. Every page renders the fixture sentinel and the "נתוני בדיקה" strip (`_components/DemoPage.tsx`) |
| `app/dev/demo/_data/` | Fixtures and the fixture adapter (G-05): `adapter.ts` exports `demoDataAccess` (the `DataAccess` ports, `server-only`); `seed.ts`, `reference.ts`, `queries.ts` (also `server-only`), `mappers.ts`, `aggregations.ts` feed it; `routes.ts`, `roles.ts`, `dates.ts`, `params.ts` are the only other modules pages may import (ESLint) |
| `app/dev/demo/_components/` | `DemoPage` / `DemoFrames` (sentinel, test-data strip, shells), `DemoToast` ("פעולה מדומה · לא נשמר"), `SimulatedCommands` (the demo's `Commands`: validates input, returns `{ok, simulated: true}`, saves nothing) |
| `features/data-access/` | Shared data-access types: `DataAccess` and `Commands` aggregates, `Page<T>`, `CommandResult` (with `simulated`), list bounds, `CommandsProvider` / `useCommands()` (`docs/architecture-data-access.md`) |
| `features/*/data/` | Typed ports, DTOs and input validators per feature: `calls`, `visits`, `dashboards`, `reference` (technicians, products, reasons, places, permission values, approval text), `notifications`, `customers`. No fixture data; a Supabase adapter implements the same ports later |
| `proxy.ts` | `/dev` gate: runs before rendering; a closed gate returns the Hebrew 404 with no showcase content |
| `components/ui/` | Shared UI components (buttons, chips, segmented control, tabs, toggle, visit and call status pills, test-data badge, KPI, bars, pager, list item, icons) |
| `components/tech/` | Technician shell, home header, bottom navigation, next-visit card, pickups, schedule, visit header / info / history, work screen (media tiles, summary and simulated recording, parts), close screen (outcome, signature pad, follow-up reason and next-visit note) |
| `components/office/` | Office shell and sidebar, calls filters and table, call card and visit timeline, dashboard parts (KPI grid, sections, status bar, technician lanes, work queues, test-data note), manager analytics (general, technicians, drill-down, products, no access) |
| `config/release.json` | `testingPeriod` switch (D31): `/dev` in Vercel Production and the bundle fixture check; set to `false` at the go-live gate (`docs/deployment.md`) |
| `vercel.json` | Production build guard: `npm ci`; builds only Preview deployments and Production from `main` (D31); anything else is skipped (fails closed) |
| `next.config.ts` | Baseline security headers for every route (`docs/security.md`) |
| `.npmrc` | Supply-chain settings: exact versions, no install scripts, 7-day release cooldown |
| `.env.example` | Environment variable **names** only; no values |
| `package.json` | Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test:e2e`, `test:ci`, `test:db` (needs the Supabase CLI and Docker), `check:migrations`, `screenshots`, `scan:bundle`, `scan:secrets`; exact dependency versions (lockfile `package-lock.json`) |
| `eslint.config.mjs`, `tsconfig.json`, `postcss.config.mjs` | Lint, strict TypeScript and Tailwind/PostCSS configuration |
| `playwright.config.ts` | Playwright at 390 / 820 / 1440 px; one build served twice (`/dev` open and closed) |
| `tests/e2e/` | End-to-end tests: RTL and overflow, breakpoints, demo tokens, security headers, `/dev` gate (positive and negative, showcase and every UI-demo route, RSC and prefetch variants), owner review rules, UI demo (`demo.spec.ts`: every demo route at 390 / 820 / 1440, search and filters, call card, access by role, simulated actions, signature); `screenshots.spec.ts` runs on demand only |
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
| `docs/review/` | Review screenshots per step (`docs/review/step-0/`, `docs/review/ui-demo-1/` with the matching `demo-` shots from `docs/demo.html`), fictitious data only |
| `docs/user-guides/` | Hebrew user guides (D15): placeholders until features are tested |
| `docs/history/` | Superseded context; not authoritative |
| `prompts/` | Claude Code prompts (`STEP-0-PLAN.md`) |
| `START-HERE.md` | Beginner guide for the owner |

Not created yet (see section 4): `app/(auth)/`, `app/(tech)/tech/`, `app/(office)/office/`, `app/api/`, `lib/`, `supabase/migrations/`, and the feature logic folders (`features/calendar`, `features/products`, `features/exports`, `features/transcription`; `features/` holds only data-access ports so far).

## 3. Status

| Capability | Status | Step |
|---|---|---|
| Design tokens, technician and office shells, temporary home and 404 pages | Implemented | Step 0 |
| `/dev` showcase with fixtures (fictitious data) | Mock or demo (dev only) | Step 0 |
| UI demo with fictional data (`/dev/demo`: office homes, calls list, call card, manager dashboards, technician home, visit, work and close; every action simulated) | Mock or demo (dev only) | D53, before the remaining Step 1 work |
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
