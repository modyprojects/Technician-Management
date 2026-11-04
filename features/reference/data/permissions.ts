// Display helpers over a role's permission-matrix values (RolePermissions, read through
// reference.permissions(role)). Pure. They decide only what a screen offers: enforcement is always
// on the server and in the database (RLS, grants, server functions; D33, G-04). The values are
// temporary until the owner approves the final matrix in Step 10 (D51).
import type { PermissionKey, RolePermissions } from "./types";

/** Matrix keys of the manager dashboards (כללי / טכנאים / מוצרים וספקים). */
export const DASHBOARD_PERMISSION_KEYS = ["dashGen", "dashTech", "dashProd"] as const satisfies readonly PermissionKey[];

/** Whether the screen offers what `key` governs. Never access control. */
export const offers = (permissions: RolePermissions, key: PermissionKey): boolean => permissions.values[key] === true;

/** Whether the role sees any dashboard tab (the "דשבורדים" nav item). */
export const offersAnyDashboard = (permissions: RolePermissions): boolean =>
  DASHBOARD_PERMISSION_KEYS.some((key) => offers(permissions, key));
