"use server";

// The Outlook invitation simulator's server action (D24, SIM-02 to SIM-11; Step 6). No screen
// calls it yet: the simulator button inside "זימונים שלא נקלטו" comes with that screen (D60 (11),
// D62). Next.js checks the Origin of every server-action POST against the Host.
//
// Order of checks (fail closed):
//   1. the environment switch (CALENDAR_SIMULATOR=1; on Vercel Production only while testingPeriod, D90): when off, the
//      action answers "not-found" and does nothing (docs/security.md §9: disabled simulator
//      endpoints are unreachable). This is the ONLY place the switch holds: the database cannot
//      see it, and the RPC public.ingest_calendar_event stays callable through the Data API by any
//      active office session (TEMPORARY Step 6 OQ-13, open decision 21; revoked or flag-gated
//      before real use, docs/review/step6-ingestion/README.md section 9);
//   2. the request, validated with the shared Zod schemas (no value is echoed when it fails);
//   3. the session: an active Manager, Creator or Customer Service user (D24, SIM-10); a
//      Technician or an anonymous visitor is refused. This is a convenience: the database checks
//      the caller again inside private.ingest_calendar_event (role, rate limit, every value's
//      column rule), which is the boundary for who may write and what is stored;
//   4. the single ingestion service with the Supabase store, under the caller's own session.
// Simulated records are test data (the database marks them from the source, D47) and simulated
// visits never send email: nothing here sends any, and the Step 7 outbox never delivers test data
// (D24, SIM-09). Logs carry an event name and a code only (docs/security.md §8).
import "server-only";
import { buildSimulatorEvent, parseSimulatorRequest } from "@/features/calendar/adapters/simulator/commands";
import { ingestInvitation } from "@/features/calendar/ingestion/service";
import type { IngestionResult, InvitationEvent } from "@/features/calendar/ingestion/types";
import { authLogLine } from "@/features/auth/sign-in-input";
import { getSessionState } from "@/lib/auth/session";
import { calendarSimulatorEnabled } from "@/lib/calendar/simulator-env";
import { IngestionStoreError, supabaseIngestionStore } from "@/lib/calendar/supabase-ingestion-store";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export type SimulatorActionError =
  | "not-found"
  | "invalid-input"
  | "not-authorized"
  | "rate-limited"
  | "conflict"
  | "unavailable"
  | "failed";

export type SimulatorActionResult =
  | {
      ok: true;
      /** The event that was delivered (the caller's own input, so the screen can deliver it again). */
      event: InvitationEvent;
      result: IngestionResult;
    }
  | { ok: false; error: SimulatorActionError };

/** Office roles that may use the simulator (D24, SIM-10): a fixed capability, never a matrix key (D33). */
const SIMULATOR_ROLES: ReadonlySet<string> = new Set(["creator", "mgr", "cs"]);

function log(event: string, code: unknown): void {
  console.warn(authLogLine(event, code));
}

function errorOf(code: string | null): SimulatorActionError {
  switch (code) {
    case "42501":
      return "not-authorized";
    case "PT429":
      return "rate-limited";
    case "23505":
      return "conflict";
    case "22023":
    case "23514":
      return "invalid-input";
    default:
      return "failed";
  }
}

/** Delivers one simulated invitation event (create, update, reschedule, reassign, cancel, invalid, duplicate). */
export async function runInvitationSimulator(input: unknown): Promise<SimulatorActionResult> {
  if (!calendarSimulatorEnabled()) return { ok: false, error: "not-found" };

  const request = parseSimulatorRequest(input);
  if (!request) {
    log("calendar.simulator.rejected", "invalid_input");
    return { ok: false, error: "invalid-input" };
  }

  const state = await getSessionState();
  if (state.kind === "unavailable") return { ok: false, error: "unavailable" };
  if (state.kind !== "signed-in" || !SIMULATOR_ROLES.has(state.user.role)) {
    log("calendar.simulator.denied", state.kind);
    return { ok: false, error: "not-authorized" };
  }

  const client = await createUserSupabaseClient();
  if (!client) return { ok: false, error: "unavailable" };

  const event = buildSimulatorEvent(request, { now: () => new Date(), newId: () => crypto.randomUUID() });
  try {
    const result = await ingestInvitation(event, supabaseIngestionStore(client));
    log("calendar.simulator.delivered", result.kind === "ingested" ? result.outcome.outcome : result.kind);
    return { ok: true, event, result };
  } catch (error) {
    const code = error instanceof IngestionStoreError ? error.code : "exception";
    log("calendar.simulator.failed", code);
    return { ok: false, error: errorOf(code) };
  }
}
