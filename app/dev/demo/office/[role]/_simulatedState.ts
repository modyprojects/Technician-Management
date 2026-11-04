// What the simulated commands of one office screen check against stored data, as the server
// would (SimulatedServerState): read through the data-access layer, scoped to that screen. Only
// the Settings tabs that delete (places, reasons) and the account screens (Settings › "משתמשים
// והרשאות", "ניהול משתמשים") receive it; every other demo page gets the empty state, so no other
// page carries account or request ids. The real server checks these itself, in the database,
// under the caller's session.
import type { AccountAdminData } from "@/components/office/AccountAdminParts";
import type { SettingsSection } from "@/features/settings/data/types";
import type { SimulatedServerState } from "../../_components/SimulatedCommands";
import { demoDataAccess } from "../../_data/adapter";

/** Account administration: the accounts and requests in the viewer's scope, and the viewer. */
export function accountAdminState(admin: AccountAdminData | null): SimulatedServerState {
  if (!admin) return {};
  return {
    accounts: Object.fromEntries(
      admin.accounts.items.map((a) => [a.id, { name: a.name, email: a.email, role: a.role, active: a.active }]),
    ),
    requests: Object.fromEntries(admin.requests.items.map((e) => [e.request.id, e.request.status])),
    self: admin.self,
  };
}

/** The operational Settings tabs that delete records: what forbids a delete (SE-06, SE-07). */
export async function settingsTabState(tab: SettingsSection): Promise<SimulatedServerState> {
  switch (tab) {
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
