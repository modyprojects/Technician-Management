import type { ReactNode } from "react";
import { DemoToastProvider } from "./_components/DemoToast";
import { SimulatedCommandsProvider } from "./_components/SimulatedCommands";

// UI demo with fictitious data (D53, G-05). Served only where the /dev gate allows (proxy.ts).
// The toast provider sits here so a simulated-action toast survives navigation between screens.
// SimulatedCommandsProvider gives every screen the demo's Commands (useCommands()): all actions
// are simulated and show the toast; nothing is saved or sent.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoToastProvider>
      <SimulatedCommandsProvider>{children}</SimulatedCommandsProvider>
    </DemoToastProvider>
  );
}
