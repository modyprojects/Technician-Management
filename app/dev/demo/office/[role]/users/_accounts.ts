// Reads what account administration shows (SE-01, D34) through the data-access layer
// (demoDataAccess.accounts, and demoDataAccess.settings.technicians for the edit form's technician
// fields) and formats its times for the screen. Server-only (the adapter is
// server-only). Used by the Manager's Settings › "משתמשים" (tab "accounts", D57 (1);
// ../settings/[tab]/page.tsx) and the Creator's Settings › "משתמשים והרשאות" (../settings/[tab]/_users.ts).
// The signed-in account is the viewpoint's demo user (VIEWPOINTS[role].who); production takes it
// from the session (G-03), and the server scopes and authorizes every list and action (D34).
import type {
  AccountAdminData,
  AccountAdminScope,
  AccountRequestEntry,
  AccountTechnicianDetails,
  CreationIntentEntry,
} from "@/components/office/AccountAdminParts";
import { ownIntents } from "@/features/accounts/data/offers";
import type { AccountListEntry, AccountRef, AccountRequest, AccountRole, CreationIntent, UserAccount } from "@/features/accounts/data/types";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import type { OfficeRole, TechnicianId } from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";
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

const intentEntry = (intent: CreationIntent): CreationIntentEntry => ({
  intent,
  startedLabel: notificationTimeLabel(intent.authorizedAt),
});

/**
 * A technician's field profile as the viewer's edit form shows it (security.md §8: collect only
 * needed data): the Manager gets name, colour, device and version, never the Outlook email or
 * "פעיל" (TEMPORARY, Step 2 plan Q14); the Creator also gets both.
 */
function technicianDetails(t: TechnicianSetting, scope: AccountAdminScope): AccountTechnicianDetails {
  const base: AccountTechnicianDetails = { id: t.id, name: t.name, color: t.color, device: t.device, version: t.version, isTest: t.isTest };
  return scope === "all" ? { ...base, outlookEmail: t.email, active: t.active } : base;
}

/**
 * A listed account as this screen uses it (UserAccount). The unified list entry (D60 (7)) also
 * carries the Technician's field profile with the Creator's view of it (the demo adapter has no
 * session); it never reaches the page: the field profile travels only through `technicians`,
 * mapped per scope (technicianDetails), so the Manager's payload holds no Outlook email (Q14).
 */
function userAccountOf(entry: AccountListEntry): UserAccount {
  const { technician, ...account } = entry;
  void technician;
  return account;
}

/** Only the technician records of the listed accounts, mapped per scope. */
function listedTechnicians(
  accounts: readonly UserAccount[],
  technicians: readonly TechnicianSetting[],
  scope: AccountAdminScope,
): Record<TechnicianId, AccountTechnicianDetails> {
  const listed = new Set(accounts.map((a) => a.technicianId).filter((id): id is TechnicianId => id !== null));
  return Object.fromEntries(technicians.filter((t) => listed.has(t.id)).map((t) => [t.id, technicianDetails(t, scope)]));
}

/**
 * Account administration of a role, or null when the role has none (Customer Service). The
 * Creator ("all") gets every account and every request, pending first; the Manager ("cs-tech")
 * gets Customer Service and Technician accounts and the Manager's own requests. Each gets only his
 * own open creation intents (ownIntents) and the field profiles of the listed Technician accounts,
 * mapped per scope (technicianDetails). Lists are bounded (at most MAX_PAGE_LIMIT, 100).
 */
export async function loadAccountAdmin(role: OfficeRole): Promise<AccountAdminData | null> {
  const scope = accountAdminScope(role);
  if (!scope) return null;
  const [accounts, requests, intents, technicians, self] = await Promise.all([
    demoDataAccess.accounts.list({ roles: scope === "all" ? undefined : MANAGER_SCOPE_ROLES, limit: MAX_PAGE_LIMIT }),
    demoDataAccess.accounts.requests({ limit: MAX_PAGE_LIMIT }),
    demoDataAccess.accounts.openCreations({ limit: MAX_PAGE_LIMIT }),
    demoDataAccess.settings.technicians(),
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

  // The viewer's own intents only, with their own count (critique S2): the Manager never receives
  // the Creator's intent (a Manager account), nor learns that it exists.
  // TODO(production adapter): filtered on the server (`requested_by` = the session's user).
  const own = ownIntents(intents, self?.id ?? null);

  return {
    scope,
    accounts: { items: accounts.items.map(userAccountOf), total: accounts.total, limit: accounts.limit },
    requests: { items: items.map(entry), total, limit: requests.limit },
    intents: { items: own.items.map(intentEntry), total: own.total, limit: own.limit },
    technicians: listedTechnicians(accounts.items, technicians.items, scope),
    self,
  };
}
