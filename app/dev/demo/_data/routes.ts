// Demo route builders (app/dev/demo/**). Client-safe. Use these instead of hand-written paths.
import { officeCalendarHref, techCalendarHref, type OfficeCalendarState } from "@/features/calendar/data/search-params";
import type { CalendarView } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { OfficeRole } from "./types";

export const DEMO_BASE = "/dev/demo";

export const demoHref = {
  /** Viewpoint picker. */
  landing: (): string => DEMO_BASE,
  /** Office home of a role (מנהל: "לוח בקרה", שירות לקוחות: "בית"). */
  officeHome: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}`,
  /**
   * Office "יומן טכנאים" (OF-03): `?view&date&tech` and, for the open visit drawer, `req&n`
   * (features/calendar/data/search-params). Defaults (day view, today, every technician) are left out.
   */
  officeCalendar: (role: OfficeRole, state?: Partial<OfficeCalendarState>): string =>
    officeCalendarHref(`${DEMO_BASE}/office/${role}/calendar`, state),
  /** Calls list (search and filters). */
  calls: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}/calls`,
  /** Full service-call card. */
  call: (role: OfficeRole, req: string): string => `${DEMO_BASE}/office/${role}/calls/${req}`,
  /** Manager dashboards (general / technicians / products). Manager only. */
  analytics: (): string => `${DEMO_BASE}/office/mgr/analytics`,
  /** The dashboards address under a role (customer service gets "אין הרשאה"). */
  officeAnalytics: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}/analytics`,
  /** Technician home (today). */
  tech: (): string => `${DEMO_BASE}/tech`,
  /** Technician visit card (details, previous visits). */
  visit: (req: string, n: number): string => `${DEMO_BASE}/tech/visit/${req}/${n}`,
  /** Technician work screen (photos, recording, summary, parts). Open visits only. */
  work: (req: string, n: number): string => `${DEMO_BASE}/tech/visit/${req}/${n}/work`,
  /** Technician close screen (result, signature or follow-up reason). Open visits only. */
  close: (req: string, n: number): string => `${DEMO_BASE}/tech/visit/${req}/${n}/close`,
  /** Technician "היומן שלי" (TE-27): `?view=day|week|month&date=YYYY-MM-DD`; defaults (day view, today) left out. */
  techCalendar: (view?: CalendarView, date?: IsoDate): string =>
    techCalendarHref(`${DEMO_BASE}/tech/calendar`, { view, date }),
  /** "הושלמו היום" (TE-26): the technician's visits closed today; `?page=` from page 2. */
  techDone: (page?: number): string =>
    page !== undefined && Number.isInteger(page) && page > 1 ? `${DEMO_BASE}/tech/done?page=${page}` : `${DEMO_BASE}/tech/done`,
  /** One of the technician's closed visits, read-only (TE-26, D14). */
  techDoneVisit: (req: string, n: number): string => `${DEMO_BASE}/tech/done/${req}/${n}`,
  /** Technician notifications (bell, TE-28); `?page=` from page 2. */
  techNotifications: (page?: number): string =>
    page !== undefined && Number.isInteger(page) && page > 1
      ? `${DEMO_BASE}/tech/notifications?page=${page}`
      : `${DEMO_BASE}/tech/notifications`,
  /** Technician profile (TE-29, TE-30). */
  techProfile: (): string => `${DEMO_BASE}/tech/profile`,
} as const;
