// Reads what account administration shows (SE-01, D34) through the data-access layer
// (demoDataAccess.accounts) and formats its times for the screen. Server-only (the adapter is
// server-only). Used by the Manager's Settings › "משתמשים" (tab "accounts", D57 (1);
// ../settings/[tab]/page.tsx) and the Creator's Settings › "משתמשים והרשאות" (../settings/[tab]/_users.ts).
// The signed-in account is the viewpoint's demo user (VIEWPOINTS[role].who); production takes it
// from the session (G-03), and the server scopes and authorizes every list and action (D34).
import type { AccountAdminData, AccountRequestEntry } from "@/components/office/AccountAdminParts";
import type { AccountRef, AccountRequest, AccountRole } from "@/features/accounts/data/types";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess, demoSession } from "../../../_data/adapter";
import { notificationTimeLabel } from "../../../_data/dates";
import { accountAdminScope, VIEWPOINTS } from "../../../_data/roles";

/** Roles the Manager administers (D34): Customer Service and Technician accounts. */
const MANAGER_SCOPE_ROLES: readonly AccountRole[] = ["cs", "tech"];

/**
 * The viewpoint's own account through the demo session port (features/auth/data; production:
 * `getSessionUser()`, G-03). Null when the account is missing or inactive (fail closed).
 */
export async function signedInAccount(role: OfficeRole): Promise<AccountRef | null> {
  const me = await demoSession({ role, name: VIEWPOINTS[role].who }).current();
  return me ? { id: me.id, name: me.name } : null;
}

const entry = (request: AccountRequest): AccountRequestEntry => ({
  request,
  requestedLabel: notificationTimeLabel(request.requestedAt),
  decidedLabel: request.decidedAt ? notificationTimeLabel(request.decidedAt) : null,
});

/**
 * Account administration of a role, or null when the role has none (Customer Service). The
 * Creator ("all") gets every account and every request, pending first; the Manager ("cs-tech")
 * gets Customer Service and Technician accounts and the Manager's own requests. Lists are bounded
 * (at most MAX_PAGE_LIMIT, 100).
 */
export async function loadAccountAdmin(role: OfficeRole): Promise<AccountAdminData | null> {
  const scope = accountAdminScope(role);
  if (!scope) return null;
  const [accounts, requests, self] = await Promise.all([
    demoDataAccess.accounts.list({ roles: scope === "all" ? undefined : MANAGER_SCOPE_ROLES, limit: MAX_PAGE_LIMIT }),
    demoDataAccess.accounts.requests({ limit: MAX_PAGE_LIMIT }),
    signedInAccount(role),
  ]);

  // Newest first from the layer; the Creator sees the pending ones first (they wait for a decision).
  // TODO(production adapter): the Manager's own requests are filtered on the server (requester
  // from the session), so the count is exact; here the bounded list is filtered in memory.
  const items =
    scope === "all"
      ? [...requests.items.filter((r) => r.status === "pending"), ...requests.items.filter((r) => r.status !== "pending")]
      : requests.items.filter((r) => self !== null && r.requestedBy.id === self.id);
  const total = scope === "all" ? requests.total : items.length;

  return {
    scope,
    accounts,
    requests: { items: items.map(entry), total, limit: requests.limit },
    self,
  };
}
