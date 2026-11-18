"use client";

// The visit commands a client component runs, without knowing their source (Step 4, Version 1):
// - the real technician pages provide their server actions through VisitCommandsProvider
//   (features/visits/data/field-actions.ts visitCommandsOfActions);
// - the /dev/demo prototype provides nothing here: its SimulatedCommandsProvider's `visits`
//   (features/data-access/commands-context.tsx) is used instead.
// The shared work and close components (components/tech/*) call useVisitCommands() and so run
// against either. Generic: no demo or fixture knowledge here.
import { createContext, use, type ReactNode } from "react";
import { useOptionalCommands } from "@/features/data-access/commands-context";
import type { VisitCommands } from "./data/ports";

const VisitCommandsContext = createContext<VisitCommands | null>(null);

export function VisitCommandsProvider({ commands, children }: { commands: VisitCommands; children: ReactNode }) {
  return <VisitCommandsContext value={commands}>{children}</VisitCommandsContext>;
}

/** The nearest VisitCommandsProvider's commands, else the CommandsProvider's `visits`. Throws without either. */
export function useVisitCommands(): VisitCommands {
  const own = use(VisitCommandsContext);
  const all = useOptionalCommands();
  const commands = own ?? all?.visits ?? null;
  if (!commands) throw new Error("useVisitCommands() needs a <VisitCommandsProvider> (the real screen) or a <CommandsProvider> (the UI demo).");
  return commands;
}
