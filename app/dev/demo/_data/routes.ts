// Demo route builders (app/dev/demo/**). Client-safe. Use these instead of hand-written paths.
import type { OfficeRole } from "./types";

export const DEMO_BASE = "/dev/demo";

export const demoHref = {
  /** Viewpoint picker. */
  landing: (): string => DEMO_BASE,
  /** Office home of a role (מנהל: "לוח בקרה", שירות לקוחות: "בית"). */
  officeHome: (role: OfficeRole): string => `${DEMO_BASE}/office/${role}`,
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
} as const;
