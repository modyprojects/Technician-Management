// Demo route builders (app/dev/demo/**). Client-safe. Use these instead of hand-written paths.
import { officeCalendarHref, techCalendarHref, type OfficeCalendarState } from "@/features/calendar/data/search-params";
import type { CalendarView } from "@/features/calendar/data/types";
import { backFromFieldHref, type BackFromFieldState } from "@/features/calls/data/search-params";
import { customersListHref, type CustomersListState } from "@/features/customers/data/search-params";
import type { CustomerId } from "@/features/customers/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { outboxHref, type OutboxViewState } from "@/features/outbox/data/search-params";
import { productsListHref, type ProductsListState } from "@/features/products/data/search-params";
import type { LoginState } from "@/features/auth/login-state";
import { reviewListHref, type ReviewListState } from "@/features/review/data/search-params";
import type { SettingsSection } from "@/features/settings/data/types";
import type { OfficeRole } from "./types";

/** A demo viewpoint (the technician or an office role); the same union as roles.ts `Viewpoint`. */
type StartRole = "tech" | OfficeRole;

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
   * matrix role only where its `settings` value offers it (features/auth/roles.ts settingsTabsOffered; display only).
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
  /**
   * "פריטים לבדיקה" (D39, D44; matrix key `conflicts`): `?status=open|resolved|all&page=`
   * (features/review/data/search-params); the default view (open items, page 1) is left out.
   */
  review: (role: OfficeRole, state?: Partial<ReviewListState>): string =>
    reviewListHref(`${DEMO_BASE}/office/${role}/review`, state),
  /** One review item: both versions per field and the resolution (D44). */
  reviewItem: (role: OfficeRole, id: string): string => `${DEMO_BASE}/office/${role}/review/${encodeURIComponent(id)}`,
  /**
   * Developer tool, not an app screen (X-06): the mock completion-email outbox, `?page&id`
   * (features/outbox/data/search-params). Linked only from the landing page's tools section.
   */
  outbox: (state?: Partial<OutboxViewState>): string => outboxHref(`${DEMO_BASE}/outbox`, state),
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
  /**
   * Step 2 PR 2.3 prototype of the sign-in screen "כניסה" (AU-01, PROPOSED): `?state=failed`,
   * `unavailable` or `no-access`; the form (the default) leaves the parameter out.
   */
  login: (state?: LoginState): string =>
    state === undefined || state === "form" ? `${DEMO_BASE}/login` : `${DEMO_BASE}/login?state=${state}`,
  /** Step 2 PR 2.3 prototype of a role's temporary start screen (Q18 TEMPORARY, AU-03). */
  start: (role: StartRole): string => `${DEMO_BASE}/start/${role}`,
  /** Step 2 PR 2.3 prototype of the technician's minimal profile (identity and sign-out, AU-04). */
  startProfile: (): string => `${DEMO_BASE}/start/tech/profile`,
} as const;
