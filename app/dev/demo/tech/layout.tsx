import type { ReactNode } from "react";
import { SyncQueueProvider, type QueueItemRef } from "@/components/tech/SyncQueue";
import { SimulatedCommandsProvider } from "../_components/SimulatedCommands";
import { demoDataAccess } from "../_data/adapter";
import { DEMO_TECHNICIAN_ID } from "../_data/roles";
import { deviceQueueState } from "./_simulatedState";
import { VisitStatusProvider } from "./_VisitStatus";

// Technician screens of the UI demo (D53). The live visit statuses (depart, arrive, close; all
// simulated) are held here, above the pages, so they survive client navigation between the
// home, visit card, work and close screens: after "יוצא · Waze" the visit card shows "בדרך", and
// after a close the home and the visit card show the visit as closed. A reload shows the fixture
// statuses again (nothing is saved, G-02).
// The device's work queue (TE-24, D46) is nested here for every technician page, so "סנכרן עכשיו"
// and "נסה שוב" (useCommands().sync) are checked against it; the office pages never get it (deny
// by default). SyncQueueProvider holds the queue items' live states (TE-23) for the home banner,
// the visit card and the closed views, read through the layer (sync.device; G-03: production
// takes the technician from the session, and the queue lives on the device).
export default async function TechDemoLayout({ children }: { children: ReactNode }) {
  const [state, device] = await Promise.all([deviceQueueState(), demoDataAccess.sync.device(DEMO_TECHNICIAN_ID)]);
  const queue: QueueItemRef[] =
    device?.visits.items.flatMap((v) => v.operations.items.map((o) => ({ opId: o.opId, state: o.state }))) ?? [];
  return (
    <SimulatedCommandsProvider state={state}>
      <SyncQueueProvider operations={queue}>
        <VisitStatusProvider>{children}</VisitStatusProvider>
      </SyncQueueProvider>
    </SimulatedCommandsProvider>
  );
}
