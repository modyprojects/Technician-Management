"use client";

// The real field commands of ONE visit for the shared work and close components (Step 4, Version
// 1): the page (a Server Component) passes its server actions and what it read about the visit;
// this builds the VisitCommands over them (features/visits/data/field-actions.ts) and provides them
// to useVisitCommands(). components/ never imports lib/actions.
import { useMemo, type ReactNode } from "react";
import { VisitCommandsProvider } from "@/features/visits/commands-context";
import { PHOTO_MAX_BYTES } from "@/features/visits/data/field";
import { visitCommandsOfActions, type FieldActions, type FieldVisit } from "@/features/visits/data/field-actions";

export function FieldVisitProvider({ actions, visit, children }: { actions: FieldActions; visit: FieldVisit; children: ReactNode }) {
  const commands = useMemo(() => visitCommandsOfActions(actions, visit, PHOTO_MAX_BYTES), [actions, visit]);
  return <VisitCommandsProvider commands={commands}>{children}</VisitCommandsProvider>;
}
