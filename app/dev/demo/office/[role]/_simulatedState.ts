// What the simulated commands of one office screen check against stored data, as the server
// would (SimulatedServerState): read through the data-access layer, scoped to that screen. Only
// the Settings tabs that delete (places, reasons) or carry versions (technicians), the account
// screens (Settings › "משתמשים והרשאות" and the Manager's Settings › "משתמשים"), "מוצרים"
// (products, brands, suppliers), a review item ("פריטים לבדיקה") and the call card's closed-visit
// corrections receive it; every other demo page gets the empty state, so no other page carries
// account or request ids. The real server checks these itself, in the database, under the
// caller's session.
import type { AccountAdminData } from "@/components/office/AccountAdminParts";
import type { AccountRequest, UserAccount } from "@/features/accounts/data/types";
import type { AccountRequestStored, AccountStored } from "@/features/accounts/data/validate";
import type { ProductListItem } from "@/features/products/data/types";
import type { OfficeRole } from "@/features/reference/data/types";
import type { ReviewItemDetail } from "@/features/review/data/types";
import type { SettingsSection } from "@/features/settings/data/types";
import { isClosedVisitStatus, visitRefKey, type VisitCorrectionHistory } from "@/features/visits/data/types";
import type { SimulatedServerState } from "../../_components/SimulatedCommands";
import { demoDataAccess } from "../../_data/adapter";
import { closedVisitCorrectionsOffered } from "../../_data/roles";
import { signedInAccount } from "./users/_accounts";

const accountStored = (a: UserAccount): AccountStored => ({
  name: a.name,
  email: a.email,
  role: a.role,
  active: a.active,
  version: a.version,
  isTest: a.isTest,
  technicianId: a.technicianId,
});

/** A request as the cancel and decide checks read it (requester, version, an unfulfilled creation). */
const requestStored = (r: AccountRequest): AccountRequestStored => ({
  status: r.status,
  version: r.version,
  requestedBy: r.requestedBy.id,
  creation: r.kind === "create",
  fulfilled: r.account !== null,
});

/**
 * Account administration: the accounts and requests in the viewer's scope, as stored, and the
 * viewer with his role (`viewerRole`: the page's role, which is the signed-in demo account's role;
 * set only when that account exists, so a missing viewer is denied by default).
 */
export function accountAdminState(admin: AccountAdminData | null, viewerRole: OfficeRole): SimulatedServerState {
  if (!admin) return {};
  return {
    accounts: Object.fromEntries(admin.accounts.items.map((a) => [a.id, accountStored(a)])),
    requests: Object.fromEntries(admin.requests.items.map((e) => [e.request.id, requestStored(e.request)])),
    self: admin.self,
    ...(admin.self ? { selfRole: viewerRole } : {}),
  };
}

/**
 * The operational Settings tabs whose commands check stored data: what forbids a delete (SE-06,
 * SE-07) and the technicians' versions ("פעיל", SE-05; PT409 when stale).
 */
export async function settingsTabState(tab: SettingsSection): Promise<SimulatedServerState> {
  switch (tab) {
    case "techs": {
      const techs = await demoDataAccess.settings.technicians();
      return {
        technicians: Object.fromEntries(techs.items.map((t) => [t.id, { version: t.version, name: t.name, isTest: t.isTest }])),
      };
    }
    case "places": {
      const places = await demoDataAccess.settings.places();
      return { places: Object.fromEntries(places.items.map((p) => [p.id, { inUse: p.inUse }])) };
    }
    case "reasons": {
      const reasons = await demoDataAccess.settings.reasons();
      return { reasons: Object.fromEntries(reasons.items.map((r) => [r.id, { inUse: r.inUse, userAdded: r.userAdded }])) };
    }
    default:
      return {};
  }
}

/**
 * "מוצרים" (PR-06): the products on the page (version and name) and every brand and supplier, so a
 * simulated edit with a stale version or an unknown or inactive option fails as on the server.
 */
export async function productsState(products: readonly ProductListItem[]): Promise<SimulatedServerState> {
  const [brands, suppliers] = await Promise.all([demoDataAccess.products.brands(), demoDataAccess.products.suppliers()]);
  return {
    products: {
      items: Object.fromEntries(products.map((p) => [p.sku, { version: p.version, name: p.name }])),
      brands: Object.fromEntries(brands.items.map((b) => [b.id, { active: b.active }])),
      suppliers: Object.fromEntries(suppliers.items.map((x) => [x.id, { active: x.active }])),
    },
  };
}

/**
 * "פריטים לבדיקה" (D44): the item on the page, with what its resolution is checked against.
 * `canResolve` comes from the role helpers (reviewResolutionOffered: D14 cases Manager and Creator,
 * others `conflicts`, an invitation's cancellation also `cancel`); the source and whether the
 * item's visit is closed now (D39: an invitation never changes a closed visit). Display only, the
 * server checks the caller and the visit itself.
 */
export function reviewState(item: ReviewItemDetail, canResolve: boolean): SimulatedServerState {
  return {
    review: {
      [item.id]: {
        version: item.version,
        status: item.status,
        decisions: [...item.decisions],
        choosable: item.fields.filter((f) => f.choosable).map((f) => f.key),
        conflicts: item.fields.filter((f) => f.conflict).map((f) => f.key),
        noteRequired: item.noteRequired,
        canResolve,
        source: item.source.kind,
        targetVisitClosed: item.visit !== null && isClosedVisitStatus(item.visit.status),
      },
    },
  };
}

/**
 * "תיקון ביקור סגור" (OF-10, D14): the call card's closed visits (from visits.corrections), the
 * active follow-up reasons (read by the page) and the signed-in user's name, so a simulated
 * correction with a stale version, no change, an unknown reason or a field the visit does not allow
 * fails as on the server. Only Manager and Creator may correct (closedVisitCorrectionsOffered; a
 * fixed capability, D33). The card carries no account id (phase E P1): only the name.
 */
export async function correctionsState(
  role: OfficeRole,
  histories: readonly VisitCorrectionHistory[],
  activeReasons: readonly string[],
): Promise<SimulatedServerState> {
  const canCorrect = closedVisitCorrectionsOffered(role);
  if (!canCorrect || histories.length === 0) return {};
  const self = await signedInAccount(role);
  return {
    corrections: Object.fromEntries(
      histories.map((h) => [
        visitRefKey(h),
        { version: h.version, status: h.status, current: h.current, correctable: [...h.correctable], canCorrect, reasons: [...activeReasons] },
      ]),
    ),
    ...(self ? { signedInName: self.name } : {}),
  };
}
