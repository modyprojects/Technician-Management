// The Outlook invitation simulator's environment switch (D24, SIM-11; docs/security.md §9).
// Server-only: the only module that reads CALENDAR_SIMULATOR and VERCEL_ENV for the simulator. The
// rule itself is pure (features/calendar/adapters/simulator/env.ts). The value is never logged or
// returned: callers get a boolean.
import "server-only";
import { simulatorEnabled } from "@/features/calendar/adapters/simulator/env";

/** True only where the owner switched the simulator on; on Vercel Production only while config/release.json testingPeriod is true (D90). */
export function calendarSimulatorEnabled(): boolean {
  return simulatorEnabled({ flag: process.env.CALENDAR_SIMULATOR, vercelEnv: process.env.VERCEL_ENV });
}
