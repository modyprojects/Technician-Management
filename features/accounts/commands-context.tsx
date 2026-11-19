"use client";

// The account commands a client component runs (D60 (7)), without knowing their source:
// - the real Settings › "משתמשים" / "משתמשים והרשאות" screen provides the real server actions
//   through AccountCommandsProvider (features/accounts/data/actions.ts accountCommandsOfActions);
// - the /dev/demo prototype provides nothing here: its SimulatedCommandsProvider's `accounts`
//   (features/data-access/commands-context.tsx) is used instead.
// The shared account dialogs (components/office/Account*Form*.tsx) call useAccountCommands() and
// so run against either. Generic: no demo or fixture knowledge here.
import { createContext, use, type ReactNode } from "react";
import { useOptionalCommands } from "@/features/data-access/commands-context";
import type { AccountCommands } from "./data/ports";

const AccountCommandsContext = createContext<AccountCommands | null>(null);

export function AccountCommandsProvider({ commands, children }: { commands: AccountCommands; children: ReactNode }) {
  return <AccountCommandsContext value={commands}>{children}</AccountCommandsContext>;
}

/**
 * The active account commands: the nearest AccountCommandsProvider's, else the CommandsProvider's
 * `accounts`. Throws when neither wraps the component.
 */
export function useAccountCommands(): AccountCommands {
  const own = use(AccountCommandsContext);
  const all = useOptionalCommands();
  const commands = own ?? all?.accounts ?? null;
  if (!commands) {
    throw new Error(
      "useAccountCommands() needs an <AccountCommandsProvider> (the real screen) or a <CommandsProvider> (the UI demo).",
    );
  }
  return commands;
}
