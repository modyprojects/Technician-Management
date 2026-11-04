import type { ReactNode } from "react";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import { DemoToastProvider } from "./_components/DemoToast";
import { SimulatedCommandsProvider, type SimulatedServerState } from "./_components/SimulatedCommands";
import { demoDataAccess } from "./_data/adapter";

// UI demo with fictitious data (D53, G-05). Served only where the /dev gate allows (proxy.ts).
// The toast provider sits here so a simulated-action toast survives navigation between screens.
// SimulatedCommandsProvider gives every screen the demo's Commands (useCommands()): all actions
// are simulated and show the toast; nothing is saved or sent.

/**
 * What the simulated commands check against stored data, as the server would (delete only unused
 * places and reasons, decide only pending requests, account states). Read through the layer.
 */
async function simulatedServerState(): Promise<SimulatedServerState> {
  const [places, reasons, pending, accounts] = await Promise.all([
    demoDataAccess.settings.places(),
    demoDataAccess.settings.reasons(),
    demoDataAccess.accounts.requests({ statuses: ["pending"], limit: MAX_PAGE_LIMIT }),
    demoDataAccess.accounts.list({ limit: MAX_PAGE_LIMIT }),
  ]);
  return {
    placesInUse: places.items.filter((p) => p.inUse).map((p) => p.id),
    reasonsInUse: reasons.items.filter((r) => r.inUse).map((r) => r.id),
    pendingRequestIds: pending.items.map((r) => r.id),
    activeAccountIds: accounts.items.filter((a) => a.active).map((a) => a.id),
    inactiveAccountIds: accounts.items.filter((a) => !a.active).map((a) => a.id),
  };
}

export default async function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoToastProvider>
      <SimulatedCommandsProvider state={await simulatedServerState()}>{children}</SimulatedCommandsProvider>
    </DemoToastProvider>
  );
}
