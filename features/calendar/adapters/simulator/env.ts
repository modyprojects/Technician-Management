// The Outlook invitation simulator's switch (D24, SIM-11, SIM-12; docs/security.md §9). Pure: the
// server passes the values in (lib/calendar/simulator-env.ts reads them), so tests cover every
// branch. Controlled ONLY by an environment setting, never by a UI toggle:
//   - CALENDAR_SIMULATOR=1 turns it on (exactly "1"; anything else, or unset, is off: fail closed);
//   - it is always off on Vercel Production (VERCEL_ENV=production), whatever the flag says: it is
//     never enabled in production without the owner's separate explicit approval (D24; open
//     decision 21 asks about the testing-period Production address: until he answers, off there).
// The owner sets the flag himself where he wants it (development and Preview); after Microsoft 365
// is connected it is switched off without changing records or the ingestion architecture (SIM-12).

/** The variable's name (listed in .env.example; its value is never logged or returned). */
export const SIMULATOR_FLAG_NAME = "CALENDAR_SIMULATOR";

export type SimulatorEnvInput = {
  /** CALENDAR_SIMULATOR. */
  flag: string | undefined;
  /** VERCEL_ENV ("production", "preview", "development") or undefined outside Vercel. */
  vercelEnv: string | undefined;
};

export function simulatorEnabled(input: SimulatorEnvInput): boolean {
  if (input.vercelEnv === "production") return false;
  return input.flag === "1";
}
