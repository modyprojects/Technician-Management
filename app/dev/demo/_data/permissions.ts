// FICTITIOUS DATA ONLY: the demo's default permission matrix (D33, D37). Allowed only under
// app/dev (G-05). Server-side, and only for the fixture adapter: screens and navigation read the
// values through demoDataAccess.reference.permissions(role) (eslint.config.mjs blocks direct
// imports), exactly as they will read the Creator-edited matrix from the database.
// The values are TEMPORARY until the owner approves the final matrix in Step 10 (D51). They only
// decide what the demo shows; real enforcement is on the server and in the database (G-04).
import type { PermissionKey, PermissionValueStatus } from "@/features/reference/data/types";
import type { OfficeRole } from "./types";

/** Status of every value below (D51). */
export const PERMISSION_STATUS: PermissionValueStatus = "temporary";

/** Default matrix: Manager all on except settings and usage; Customer Service cal, calls, card. */
export const PERMISSIONS: Readonly<Record<OfficeRole, Readonly<Record<PermissionKey, boolean>>>> = {
  mgr: {
    cal: true, calls: true, card: true, cancel: true, dashGen: true, dashTech: true, dashProd: true,
    export: true, settings: false, usage: false, products: true, conflicts: true, recordings: true,
  },
  cs: {
    cal: true, calls: true, card: true, cancel: false, dashGen: false, dashTech: false, dashProd: false,
    export: false, settings: false, usage: false, products: false, conflicts: false, recordings: false,
  },
};
