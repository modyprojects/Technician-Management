// FICTITIOUS DATA ONLY: generateStaticParams() values for the demo's dynamic routes.
// Allowed only under app/dev (G-05). Server-side (uses the seeded calls).
import { ME } from "./reference";
import { OFFICE_ROLES } from "./roles";
import { CALLS } from "./seed";
import { isOpenVisit } from "./status";
import type { OfficeRole } from "./types";

/** /dev/demo/office/[role] */
export const officeRoleParams = (): { role: OfficeRole }[] => OFFICE_ROLES.map((role) => ({ role }));

/** /dev/demo/office/[role]/calls/[req]: every call for both roles. */
export const officeCallParams = (): { role: OfficeRole; req: string }[] =>
  OFFICE_ROLES.flatMap((role) => CALLS.map((c) => ({ role, req: c.req })));

/** /dev/demo/tech/visit/[req]/[n]: every visit of the demo technician (יורם), cancelled excluded. */
export const techVisitParams = (): { req: string; n: string }[] =>
  CALLS.flatMap((c) => c.visits.filter((v) => v.tech === ME && v.status !== "cancel").map((v) => ({ req: c.req, n: String(v.n) })));

/** /dev/demo/tech/visit/[req]/[n]/work and /close: the demo technician's open visits only
 *  (closed visits are read-only to technicians, D14). */
export const techOpenVisitParams = (): { req: string; n: string }[] =>
  CALLS.flatMap((c) => c.visits.filter((v) => v.tech === ME && isOpenVisit(v)).map((v) => ({ req: c.req, n: String(v.n) })));
