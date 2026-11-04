// The typed data-access layer as a whole (owner architecture rule, 2026-11-03): screens read
// data only through DataAccess and run actions only through Commands. Fixture implementations
// live under app/dev/demo (G-05); Supabase implementations will live in lib/ (server-only).
import type { CallCommands, CallsQueries } from "@/features/calls/data/ports";
import type { DashboardQueries } from "@/features/dashboards/data/ports";
import type { NotificationsQueries } from "@/features/notifications/data/ports";
import type { ReferenceQueries } from "@/features/reference/data/ports";
import type { VisitCommands, VisitsQueries } from "@/features/visits/data/ports";

export type { Bounded, CommandResult, Page, PageRequest } from "./common";

/** Read side. Server-side: Server Components and server functions call it. */
export type DataAccess = {
  calls: CallsQueries;
  visits: VisitsQueries;
  dashboards: DashboardQueries;
  reference: ReferenceQueries;
  notifications: NotificationsQueries;
};

/** Write side. Client components get it from useCommands() (features/data-access/commands-context). */
export type Commands = {
  calls: CallCommands;
  visits: VisitCommands;
};
