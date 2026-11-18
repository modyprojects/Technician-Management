"use client";

// Gives client components the active Commands implementation (simulated in the UI demo, server
// actions later) without knowing which one it is. Generic: no demo or fixture knowledge here.
import { createContext, use, type ReactNode } from "react";
import type { Commands } from "./types";

const CommandsContext = createContext<Commands | null>(null);

export function CommandsProvider({ commands, children }: { commands: Commands; children: ReactNode }) {
  return <CommandsContext value={commands}>{children}</CommandsContext>;
}

/**
 * The active Commands, or null when no CommandsProvider wraps the component (a real screen that
 * supplies its own narrower commands, e.g. features/accounts/commands-context.tsx).
 */
export function useOptionalCommands(): Commands | null {
  return use(CommandsContext);
}

/** The active Commands. Throws when no CommandsProvider wraps the component. */
export function useCommands(): Commands {
  const commands = use(CommandsContext);
  if (!commands) {
    throw new Error(
      "useCommands() needs a <CommandsProvider>. Wrap the screen in the provider of its data source " +
        "(UI demo: SimulatedCommandsProvider in app/dev/demo/layout.tsx).",
    );
  }
  return commands;
}
