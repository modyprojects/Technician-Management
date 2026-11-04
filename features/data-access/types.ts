// The typed data-access layer as a whole (owner architecture rule, 2026-11-03): screens read
// data only through DataAccess and run actions only through Commands. Fixture implementations
// live under app/dev/demo (G-05); Supabase implementations will live in lib/ (server-only).
import type { AccountCommands, AccountsQueries } from "@/features/accounts/data/ports";
import type { CalendarQueries, IntakeQueries } from "@/features/calendar/data/ports";
import type { CallCommands, CallsQueries } from "@/features/calls/data/ports";
import type { CustomersQueries } from "@/features/customers/data/ports";
import type { DashboardQueries } from "@/features/dashboards/data/ports";
import type { NotificationCommands, NotificationsQueries } from "@/features/notifications/data/ports";
import type { OutboxQueries } from "@/features/outbox/data/ports";
import type { ProductCommands, ProductsQueries } from "@/features/products/data/ports";
import type { ProfileQueries } from "@/features/profile/data/ports";
import type { ReferenceQueries } from "@/features/reference/data/ports";
import type { ReviewCommands, ReviewQueries } from "@/features/review/data/ports";
import type { SettingsCommands, SettingsQueries } from "@/features/settings/data/ports";
import type { DeviceSyncQueries, SyncCommands } from "@/features/sync/data/ports";
import type { VisitCommands, VisitsQueries } from "@/features/visits/data/ports";

export type { Bounded, CommandResult, Page, PageRequest } from "./common";

/** Read side. Server-side: Server Components and server functions call it. */
export type DataAccess = {
  calls: CallsQueries;
  visits: VisitsQueries;
  calendar: CalendarQueries;
  dashboards: DashboardQueries;
  reference: ReferenceQueries;
  notifications: NotificationsQueries;
  profile: ProfileQueries;
  settings: SettingsQueries;
  accounts: AccountsQueries;
  customers: CustomersQueries;
  products: ProductsQueries;
  intake: IntakeQueries;
  /** "פריטים לבדיקה" (D39, D44; matrix key `conflicts`). */
  review: ReviewQueries;
  /** The mock outbox viewer (/dev only, X-06): read-only. */
  outbox: OutboxQueries;
  /** The technician device's work queue (TE-23, TE-24; production: the client-side offline module, D46). */
  sync: DeviceSyncQueries;
};

/** Write side. Client components get it from useCommands() (features/data-access/commands-context). */
export type Commands = {
  calls: CallCommands;
  visits: VisitCommands;
  notifications: NotificationCommands;
  settings: SettingsCommands;
  accounts: AccountCommands;
  products: ProductCommands;
  review: ReviewCommands;
  sync: SyncCommands;
};
