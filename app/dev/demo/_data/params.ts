// FICTITIOUS DATA ONLY: generateStaticParams() values for the demo's dynamic routes. Allowed only
// under app/dev (G-05). Server-only, build-time helper: it lists every fixture key, which a
// production data-access port must never do (full-table scans), so these lists are not part of
// DataAccess. Pages import only these functions from here (eslint.config.mjs); they read screen
// data through demoDataAccess.
import "server-only";
import { CALLS } from "./queries";
import { ME } from "./reference";
import { OFFICE_ROLES } from "./roles";
import { isOpenVisit } from "./status";
import type { Call, OfficeRole, Visit } from "./types";

type VisitParams = { req: string; n: string };

/** The demo technician's visits that match `keep`, as route params. */
function techVisits(keep: (v: Visit) => boolean): VisitParams[] {
  return CALLS.flatMap((c: Call) => c.visits.filter((v) => v.tech === ME && keep(v)).map((v) => ({ req: c.req, n: String(v.n) })));
}

/** /dev/demo/office/[role] */
export const officeRoleParams = (): { role: OfficeRole }[] => OFFICE_ROLES.map((role) => ({ role }));

/** /dev/demo/office/[role]/calls/[req]: every call for both roles. */
export function officeCallParams(): { role: OfficeRole; req: string }[] {
  return OFFICE_ROLES.flatMap((role) => CALLS.map((c) => ({ role, req: c.req })));
}

/** /dev/demo/tech/visit/[req]/[n]: every visit of the demo technician (יורם), cancelled excluded. */
export function techVisitParams(): VisitParams[] {
  return techVisits((v) => v.status !== "cancel");
}

/** /dev/demo/tech/visit/[req]/[n]/work and /close: the demo technician's open visits only
 *  (closed visits are read-only to technicians, D14). */
export function techOpenVisitParams(): VisitParams[] {
  return techVisits(isOpenVisit);
}
