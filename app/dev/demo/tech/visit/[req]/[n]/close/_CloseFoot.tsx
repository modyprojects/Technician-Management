"use client";

// The close screen's footer for the UI demo: CloseFooter, plus recording a successful (simulated)
// close in VisitStatusProvider, so the home and the visit card show the visit as closed while the
// demo stays open (R-06; a reload shows the fixture status again).
import type { ComponentProps } from "react";
import { CloseFooter } from "@/components/tech/CloseFooter";
import { useMarkVisitClosed } from "../../../../_VisitStatus";

export function CloseFoot(props: Omit<ComponentProps<typeof CloseFooter>, "onClosed">) {
  const markClosed = useMarkVisitClosed();
  return <CloseFooter {...props} onClosed={(outcome) => markClosed(props.visit, outcome)} />;
}
