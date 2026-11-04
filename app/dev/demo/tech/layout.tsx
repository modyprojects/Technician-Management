import type { ReactNode } from "react";
import { VisitStatusProvider } from "./_VisitStatus";

// Technician screens of the UI demo (D53). The live visit statuses (depart, arrive, close; all
// simulated) are held here, above the pages, so they survive client navigation between the
// home, visit card, work and close screens: after "יוצא · Waze" the visit card shows "בדרך", and
// after a close the home and the visit card show the visit as closed. A reload shows the fixture
// statuses again (nothing is saved, G-02).
export default function TechDemoLayout({ children }: { children: ReactNode }) {
  return <VisitStatusProvider>{children}</VisitStatusProvider>;
}
