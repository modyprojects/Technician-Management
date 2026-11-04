// Display helpers of "פריטים לבדיקה" over a role's permission values (D33, D39, D44;
// docs/database-schema.md §8.3). Pure, no data or I/O. They decide only what a screen offers:
// enforcement is always on the server and in the database (G-04). The role helpers of the demo
// (app/dev/demo/_data/roles.ts) wrap them with the fixed D14 rule (Manager and Creator), which is
// never a matrix key (D33).
import { offers } from "@/features/reference/data/permissions";
import type { PermissionKey, RolePermissions } from "@/features/reference/data/types";
import { pendingCreatorDecision, pendingMatrixDecision } from "@/features/settings/data/types";
import type { ReviewAuthority, ReviewKind } from "./types";

/** `key` is on and its cell does not wait for an open owner decision (a pending cell counts as off). */
export function offersDecided(permissions: RolePermissions, key: PermissionKey): boolean {
  if (!offers(permissions, key)) return false;
  const pending = permissions.role === "creator" ? pendingCreatorDecision(key) : pendingMatrixDecision(permissions.role, key);
  return pending === null;
}

/**
 * The screen ("פריטים לבדיקה" and an item page): the matrix key `conflicts`, and `card`, with which
 * the server reads `review_items` (items carry report content: summaries, signer, signed text).
 * TEMPORARY (owner question in docs/WORKLOG.md, phase G): whether the D14 items (a change to a
 * server-closed or cancelled visit, a fixed Manager/Creator capability) stay reachable when
 * `conflicts` or `card` is off. Until then the whole screen follows both keys (deny by default).
 */
export const reviewScreenOffered = (permissions: RolePermissions): boolean =>
  offers(permissions, "card") && offers(permissions, "conflicts");

/**
 * Whether the screen offers deciding one item:
 * - an item that changes a server-closed or cancelled visit (`authority` "closed-visit"): the fixed
 *   D14 capability the caller passes (Manager and Creator; D33: never a matrix key);
 * - every other item: `conflicts` (D44);
 * - TEMPORARY, an invitation's cancellation or deletion of an active visit (D39): accepting it
 *   cancels the visit in the app, and who may cancel is the matrix key `cancel` (D33; open
 *   decision #5): the item also needs `cancel`, and a pending `cancel` cell counts as off.
 */
export function reviewDecisionOffered({
  permissions,
  closedVisitCapability,
  item,
}: {
  permissions: RolePermissions;
  /** The fixed D14 capability of the viewer's role (Manager and Creator). */
  closedVisitCapability: boolean;
  item: { authority: ReviewAuthority; kind: ReviewKind };
}): boolean {
  if (item.authority === "closed-visit") return closedVisitCapability;
  if (!offers(permissions, "conflicts")) return false;
  if (item.kind === "cancellation") return offersDecided(permissions, "cancel");
  return true;
}
