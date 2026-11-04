import type { ReactNode } from "react";
import { SimulatedCommandsProvider } from "../_components/SimulatedCommands";
import { deviceQueueState } from "./_simulatedState";
import { VisitStatusProvider } from "./_VisitStatus";

// Technician screens of the UI demo (D53). The live visit statuses (depart, arrive, close; all
// simulated) are held here, above the pages, so they survive client navigation between the
// home, visit card, work and close screens: after "יוצא · Waze" the visit card shows "בדרך", and
// after a close the home and the visit card show the visit as closed. A reload shows the fixture
// statuses again (nothing is saved, G-02).
// The device's work queue (TE-24, D46) is nested here for every technician page, so "סנכרן עכשיו"
// and "נסה שוב" (useCommands().sync) are checked against it; the office pages never get it (deny
// by default).
export default async function TechDemoLayout({ children }: { children: ReactNode }) {
  return (
    <SimulatedCommandsProvider state={await deviceQueueState()}>
      <VisitStatusProvider>{children}</VisitStatusProvider>
    </SimulatedCommandsProvider>
  );
}
