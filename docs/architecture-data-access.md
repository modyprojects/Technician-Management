# Typed data-access layer

## Owner rule (2026-11-03)
- **Reads.** Screens read data only through a typed data-access layer: the ports in `features/*/data/ports.ts`. A fixture adapter implements them now; a Supabase adapter will implement the same ports later, so screens do not change.
- **No fixture data in components.** `components/**` receive DTO props whose types come from `features/*/data/types.ts`.
- **Actions.** Data actions (save, sign, upload, record, cancel and so on) go only through `useCommands()`. In the UI demo every action is simulated and marked "פעולה מדומה · לא נשמר" (D53).
- **Test data.** Every DTO record carries `isTest` (D47), so screens can show "נתוני בדיקה".

## Layout
| Path | Content |
|---|---|
| `features/data-access/common.ts` | Shared building blocks. Pure, no data or I/O, safe on server and client.<br>Types: `IsoDate`, `HourMinute`, `IsoTimestamp`, `TestMarker`, `Bounded<T>`, `Page<T>`, `PageRequest`, `CommandResult<T>`.<br>Limits: `MAX_PAGE_LIMIT` (100), `DEFAULT_PAGE_LIMIT` (40), `MAX_QUERY_LENGTH` (100).<br>Helpers: clamp and validation helpers, `boundedOf`, `pageOf` |
| `features/data-access/types.ts` | The `DataAccess` and `Commands` aggregates |
| `features/data-access/commands-context.tsx` | `"use client"`. `CommandsProvider` and `useCommands()`, which throws when no provider wraps the component. Generic: no demo or fixture knowledge |
| `features/<domain>/data/types.ts` | DTOs and enums of the domain |
| `features/<domain>/data/ports.ts` | Query and command interfaces; every method is async and returns DTOs |
| `features/<domain>/data/validate.ts` | Input validators, shared by adapters and the simulated commands |

Domains:
- `calls`, with `search-params.ts` mapping the URL `?q&status&tech&page` to and from a filter;
- `visits`;
- `calendar` (read models of the office and technician calendars; separate from the intake service in `features/calendar/ingestion`), with `search-params.ts` mapping `?view&date&tech&req&n` (office) and `?view&date` (technician);
- `dashboards`;
- `reference`, with `permissions.ts` display helpers;
- `notifications`;
- `profile` (technician profile);
- `customers` (types only).

## Aggregates
```ts
type DataAccess = { calls: CallsQueries; visits: VisitsQueries; calendar: CalendarQueries;
                    dashboards: DashboardQueries; reference: ReferenceQueries;
                    notifications: NotificationsQueries; profile: ProfileQueries };
type Commands   = { calls: CallCommands; visits: VisitCommands; notifications: NotificationCommands };
```

### `DataAccess` (read side)
Server Components and server functions call it.
- `calls`: `list(filter)` (paged, plus status counts), `get(req)`, `customerHistory(req, page?)`.
- `visits`: `techDay(techId, date)`, `get(ref)`, `history(ref)`, `doneVisits(techId, date, page?)` ("הושלמו היום", paged), `doneVisit(techId, ref)` (the technician's own closed visit, read-only; null for an open visit or another technician's visit, D14). For a technician, `history` returns only earlier closed visits of the same call (D36).
- `calendar` (read-only, OF-03, TE-27; matrix key `cal` for the office): `officeDay(date, filter?)` (one lane per technician, visits placed in overlap lanes), `officeWeek(weekOf, filter?)` (Sunday to Thursday), `officeMonth(month, filter?)` (counts per day), `visit(ref)` (the drawer), `techWeek(techId, weekOf)` (day and week views), `techMonth(techId, month)`. Cancelled visits are never on a calendar. A malformed date or month is a `RangeError`.
- `dashboards`: `officeOverview(date)`, `managerAnalytics(period)`, `technicianDetail(techId, period, query?)`, `csQueue(date)`.
- `reference`: `technicians()`, `products(page?)`, `reasons()`, `places()`, `approvalText()`, `permissions(role)`. Permission values are for display only and stay "temporary" until the owner approves them (D51, G-04).
- `notifications`: `list(userId, page?)`, `unreadCount(userId)`, `preferences(userId)` (profile toggles, TE-29).
- `profile`: `technician(techId, date)`: name, phone, the figures of the week containing `date` and the office phone. Display only.

`techId` and `userId` arguments are filters, not identity. In production the identity comes from the session, and RLS rejects other users' data.

### `Commands` (write side)
Client components get it from `useCommands()`.
- `calls`: `cancelVisit`. OF-09 and SE-04 are PENDING (open decision d08), so no screen calls it yet: the call card shows a disabled placeholder. There is no reschedule or office-note command: neither is in the demo, the spec or `demo-deviations.md`, and scheduling stays in Outlook (OF-03).
- `visits`: `depart`, `arrive`, `setPickupCollected` (TE-03 "נאסף"), `saveSummary`, `addMedia`, `removeMedia`, `saveRecording`, `deleteRecording`, `saveParts`, `close`.
- `notifications`: `markRead(ids)`, `markAllRead()`, `setPreferences(prefs)` (TE-28, TE-29; the signed-in user's own notifications only).

## `CommandResult`
```ts
type CommandResult<T = void> =
  | { ok: true;  simulated: boolean; message?: string; data?: T }
  | { ok: false; simulated: boolean; error: string };
```
- **`simulated`** is `true` when nothing was saved, uploaded or sent. A screen never claims a real save, upload or email that did not happen (TE-23).
- **`error`** is a short Hebrew message for the user, never a stack trace or server detail.

## Demo implementation (fictional data, `app/dev/demo`, G-05)
- **`app/dev/demo/_data/adapter.ts`** exports `demoDataAccess: DataAccess` over the seeded fixtures.
  - It starts with `import "server-only"`, so a client component that imports it fails the build. Client components receive DTOs or props, never the adapter.
  - It validates and clamps inputs as a server adapter would, bounds every list, and marks every DTO as test data.
  - Dashboard figures come from `_data/aggregations.ts`, calendar read models and the profile week figures from `_data/calendar.ts`, and fixture-to-DTO mapping from `_data/mappers.ts`.
- **`app/dev/demo/_data/params.ts`** provides the build-time `generateStaticParams` values. They are not part of `DataAccess`, because listing every key would be a full-table scan in production.
- **`app/dev/demo/_components/SimulatedCommands.tsx`** provides `SimulatedCommandsProvider`.
  - It checks input with the same validators and waits 250 ms.
  - Invalid input returns `{ok:false, simulated:true, error}`.
  - Valid input returns `{ok:true, simulated:true, message:"פעולה מדומה · לא נשמר"}` and shows the demo toast.
  - It is wired in `app/dev/demo/layout.tsx`, inside `DemoToastProvider`.
- **Page frames.** Every demo page renders through `DemoPage`, `DemoTechFrame` or `DemoOfficeFrame`, which carry the fixture sentinel and the "נתוני בדיקה" strip.

```tsx
// Server Component: read through the layer, pass DTOs or props down.
const day = await demoDataAccess.visits.techDay(DEMO_TECHNICIAN_ID, TODAY);
if (!day) notFound();

// Client component: run an action through the active Commands.
const { visits } = useCommands();
const r = await visits.close(ref, { outcome: "cont", reason });
if (!r.ok) setError(r.error);
```

## How a Supabase adapter plugs in later (not built; needs approvals)
1. **Server-only reads.** A server-only module in `lib/` implements the same ports and runs per request under the caller's session. Authorization is enforced in the database: RLS, grants and server functions (`docs/security.md` §5). The secret key is never used for ordinary reads.
2. **Pages.** Pages call that implementation instead of `demoDataAccess`; screens and components stay unchanged.
3. **Commands.** Commands become server actions that validate input again on the server (`CLAUDE.md`: Zod for inputs) and return `CommandResult` with `simulated: false`. A `CommandsProvider` built on them replaces `SimulatedCommandsProvider`.
4. **Test data.** In production, dashboards never count test-marked records (SIM-08); in test environments they include them, with the label.
5. **Colours from the database.** Components put DTO colours such as `Technician.color` into inline styles. The production adapter accepts only an allowlisted colour token (for example `t-y`) and maps it to `var(--t-…)`; it never passes stored CSS through, so a stored value such as `url(…)` cannot make the browser fetch an outside address (TODO before the Supabase adapter).
6. **Approvals.** Every remote Supabase operation and every migration needs the owner's approval (D52 rule 4, D53).

## ESLint enforcement (`eslint.config.mjs`; never weakened)
- **Shared code.** In `components/**`, `features/**` and `lib/**`, importing `@/app/*` or a relative `../…/app/*` is an error.
- **Fixtures outside `app/dev`.** Fixture modules (`_fixtures`, `demo/_data`, `demo/_components`) are blocked everywhere outside `app/dev`.
- **Demo screens.** In `app/dev/demo/**` outside `_data/**`, only five `_data` modules may be imported: `adapter`, `routes`, `roles`, `dates` and `params`. The error message cites the owner rule.
- **Known gap** (Phase A review): non-normalised paths and dynamic `import()` can evade these rules. No such case occurs in the code; normalising paths is an optional hardening.

## Bounded lists (`docs/security.md`: query bounds)
- **Paged lists (`Page<T>`):** default 40, at most 100 (`MAX_PAGE_LIMIT`). These are `calls.list`, `calls.customerHistory`, `reference.products`, `notifications.list`, `visits.doneVisits` and the visit rows of `technicianDetail`.
- **Calendar lists (`Bounded<T>`):** `CALENDAR_LANE_LIMIT` (30) visits per technician per day, `CALENDAR_WEEK_DAY_LIMIT` (100) per office week column; month views carry counts only; at most one lane per technician (100).
- **Aggregate lists (`Bounded<T>`)** use fixed caps: `DASHBOARD_LIST_LIMIT` (20) and `OLDEST_FOLLOWUPS_LIMIT` (6). `total` gives the full count, so a screen can say "ועוד X".
- **Settings lists** (technicians, reasons, places) are capped at 100.
- **Other bounds:** search text is cut to 100 characters, and an analytics period may cover at most 366 days.
