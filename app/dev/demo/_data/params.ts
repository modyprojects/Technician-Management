// FICTITIOUS DATA ONLY: generateStaticParams() values for the demo's dynamic routes, read
// through the data-access layer (adapter.ts). Allowed only under app/dev (G-05). Server-side.
import type { VisitRef } from "@/features/visits/data/types";
import { demoDataAccess } from "./adapter";
import { DEMO_TECHNICIAN_ID, OFFICE_ROLES } from "./roles";
import type { OfficeRole } from "./types";

const toParams = (refs: readonly VisitRef[]): { req: string; n: string }[] => refs.map((r) => ({ req: r.req, n: String(r.n) }));

/** /dev/demo/office/[role] */
export const officeRoleParams = (): { role: OfficeRole }[] => OFFICE_ROLES.map((role) => ({ role }));

/** /dev/demo/office/[role]/calls/[req]: every call for both roles. */
export async function officeCallParams(): Promise<{ role: OfficeRole; req: string }[]> {
  const ids = await demoDataAccess.calls.ids();
  return OFFICE_ROLES.flatMap((role) => ids.map((req) => ({ role, req })));
}

/** /dev/demo/tech/visit/[req]/[n]: every visit of the demo technician (יורם), cancelled excluded. */
export async function techVisitParams(): Promise<{ req: string; n: string }[]> {
  return toParams(await demoDataAccess.visits.refs(DEMO_TECHNICIAN_ID));
}

/** /dev/demo/tech/visit/[req]/[n]/work and /close: the demo technician's open visits only
 *  (closed visits are read-only to technicians, D14). */
export async function techOpenVisitParams(): Promise<{ req: string; n: string }[]> {
  return toParams(await demoDataAccess.visits.openRefs(DEMO_TECHNICIAN_ID));
}
