// The Outlook invitation simulator's switch (D24, SIM-11, SIM-12; docs/security.md §9). Pure: the
// server passes the values in (lib/calendar/simulator-env.ts reads them), so tests cover every
// branch. Controlled ONLY by an environment setting, never by a UI toggle:
//   - CALENDAR_SIMULATOR=1 turns it on (exactly "1"; anything else, or unset, is off: fail closed);
//   - on Vercel Production (VERCEL_ENV=production) a second lock must also hold: config/release.json
//     testingPeriod is exactly true (owner decision 19.11, D24 exception: Production uses the test
//     database until go-live). Read the same way as the /dev gate (app/dev/_gate.ts). Any other
//     value (false, missing, malformed) keeps it off there: fail closed. After go-live it is off.
// The owner sets the flag himself where he wants it; after Microsoft 365 is connected it is
// switched off without changing records or the ingestion architecture (SIM-12).
import release from "@/config/release.json";

/** The variable's name (listed in .env.example; its value is never logged or returned). */
export const SIMULATOR_FLAG_NAME = "CALENDAR_SIMULATOR";

export type SimulatorEnvInput = {
  /** CALENDAR_SIMULATOR. */
  flag: string | undefined;
  /** VERCEL_ENV ("production", "preview", "development") or undefined outside Vercel. */
  vercelEnv: string | undefined;
};

/**
 * The rule with the testing period passed explicitly (no default parameter, so an `undefined`
 * value is judged as given rather than replaced). Typed `unknown` so a missing or malformed value
 * fails closed: only the boolean `true` opens Production.
 */
export function simulatorEnabledFor(input: SimulatorEnvInput, testingPeriod: unknown): boolean {
  if (input.flag !== "1") return false;
  if (input.vercelEnv === "production") return testingPeriod === true;
  return true;
}

/** Whether the simulator may run, with the testing period read from config/release.json. */
export function simulatorEnabled(input: SimulatorEnvInput): boolean {
  return simulatorEnabledFor(input, (release as { testingPeriod?: unknown }).testingPeriod);
}
