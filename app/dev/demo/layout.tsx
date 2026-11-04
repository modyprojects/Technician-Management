import type { ReactNode } from "react";
import { DemoToastProvider } from "./_components/DemoToast";
import { SimulatedCommandsProvider } from "./_components/SimulatedCommands";

// UI demo with fictitious data (D53, G-05). Served only where the /dev gate allows (proxy.ts).
// The toast provider sits here so a simulated-action toast survives navigation between screens.
// SimulatedCommandsProvider gives every screen the demo's Commands (useCommands()): all actions
// are simulated and show the toast; nothing is saved or sent. It has the empty server state here:
// only the Settings and account screens nest a provider with what their commands check against
// stored data, scoped to that screen (office/[role]/_simulatedState.ts), so no other page carries
// account or request ids.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoToastProvider>
      <SimulatedCommandsProvider>{children}</SimulatedCommandsProvider>
    </DemoToastProvider>
  );
}
