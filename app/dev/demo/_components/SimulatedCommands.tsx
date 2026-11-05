"use client";

// The UI demo's Commands provider (features/data-access/types): every action is SIMULATED (D53).
// Nothing is saved, uploaded, signed or sent. The commands themselves are the pure
// buildSimulatedCommands (./simulated-commands.ts): inputs are validated like a server would
// (invalid input returns ok: false); valid input returns { ok: true, simulated: true, message }
// after a short artificial delay, and the demo toast shows "פעולה מדומה · לא נשמר" with what would
// have happened. Screens call useCommands() and never this module directly.
import { useMemo, type ReactNode } from "react";
import { CommandsProvider } from "@/features/data-access/commands-context";
import { useSimulate } from "./DemoToast";
import { buildSimulatedCommands, type SimulatedServerState } from "./simulated-commands";

export { SIMULATED_TITLE, type SimulatedServerState } from "./simulated-commands";

const EMPTY_STATE: SimulatedServerState = {};

export function SimulatedCommandsProvider({ state = EMPTY_STATE, children }: { state?: SimulatedServerState; children: ReactNode }) {
  const simulate = useSimulate();
  const commands = useMemo(() => buildSimulatedCommands(state, simulate), [state, simulate]);
  return <CommandsProvider commands={commands}>{children}</CommandsProvider>;
}
