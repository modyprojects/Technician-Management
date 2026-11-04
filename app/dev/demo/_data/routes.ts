// Demo route builders (app/dev/demo/**). Client-safe. Use these instead of hand-written paths.
import { officeCalendarHref, techCalendarHref, type OfficeCalendarState } from "@/features/calendar/data/search-params";
import type { CalendarView } from "@/features/calendar/data/types";
import { backFromFieldHref, type BackFromFieldState } from "@/features/calls/data/search-params";
import { customersListHref, type CustomersListState } from "@/features/customers/data/search-params";
import type { CustomerId } from "@/features/customers/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { productsListHref, type ProductsListState } from "@/features/products/data/search-params";
import type { SettingsSection } from "@/features/settings/data/types";
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
  /**
   * Dashboards (general / technicians / products) under a role: the Manager's and the Creator's;
   * customer service gets "אין הרשאה". `?tab&tech&filter&page` come from analytics/_state.
   */
  analytics: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}/analytics`,
  /**
   * Settings tab under a role (default "users", "משתמשים והרשאות"). The Creator sees every tab; a
   * matrix role only where its `settings` value offers it (roles.ts settingsTabsOffered; display only).
   */
  settings: (role: OfficeRole, section: SettingsSection = "users"): string => `${DEMO_BASE}/office/${role}/settings/${section}`,
  /** "ניהול משתמשים": the Manager's account administration (D34, a fixed capability, SE-03). */
  users: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}/users`,
  /** "לקוחות" (OF-16, matrix key `calls`): `?q&page` (features/customers/data/search-params); defaults left out. */
  customers: (role: OfficeRole, state?: Partial<CustomersListState>): string =>
    customersListHref(`${DEMO_BASE}/office/${role}/customers`, state),
  /** The customer card (OF-16): every call of the customer and the products that came back. */
  customer: (role: OfficeRole, id: CustomerId): string => `${DEMO_BASE}/office/${role}/customers/${encodeURIComponent(id)}`,
  /** "זימונים שלא נקלטו" (OF-16, IN-03, IN-04; matrix key pending open #15, d23); `?page=` from page 2. */
  unparsed: (role: OfficeRole, page?: number): string =>
    page !== undefined && Number.isInteger(page) && page > 1
      ? `${DEMO_BASE}/office/${role}/unparsed?page=${page}`
      : `${DEMO_BASE}/office/${role}/unparsed`,
  /** "חזרו מהשטח" (OF-16; matrix key pending open #15, d23): `?tech&page` (features/calls/data/search-params). */
  backFromField: (role: OfficeRole, state?: Partial<BackFromFieldState>): string =>
    backFromFieldHref(`${DEMO_BASE}/office/${role}/back-from-field`, state),
  /** "מוצרים" (PR-06, matrix key `products`): `?q&page` (features/products/data/search-params). */
  products: (role: OfficeRole, state?: Partial<ProductsListState>): string =>
    productsListHref(`${DEMO_BASE}/office/${role}/products`, state),
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
