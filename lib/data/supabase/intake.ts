// The real IntakeQueries for this request ("זימונים שלא נקלטו"; QA S-05, D60 (4), (11)).
// Server-only. The session's user comes from lib/auth/session.ts (server-validated); every read runs
// under that user's own session (RLS), through features/calendar/supabase/intake-queries.ts. Without
// a signed-in office user, or without the Supabase configuration, the list is empty (deny by
// default, fail closed). A failed read throws IntakeQueryError (a code only), logged here by its
// code; the page fails closed.
import "server-only";
import type { IntakeQueries } from "@/features/calendar/data/ports";
import { intakeQueriesOf, IntakeQueryError, simulatorTechniciansOf } from "@/features/calendar/supabase/intake-queries";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/** Deny by default: nothing for a caller without a session or configuration. */
const NONE: IntakeQueries = {
  unparsedInvitations: async () => ({ items: [], total: 0, page: 1, limit: 0, pageCount: 1 }),
};

/** The intake queries of this request's signed-in user, under his own session. */
export async function intakeQueries(): Promise<IntakeQueries> {
  const state = await getSessionState();
  if (state.kind !== "signed-in") return NONE;
  const client = await createUserSupabaseClient();
  if (!client) return NONE;
  const queries = intakeQueriesOf(client, state.user);
  return {
    async unparsedInvitations(page) {
      try {
        return await queries.unparsedInvitations(page);
      } catch (error) {
        logAuthEvent("intake.query.unparsed_failed", error instanceof IntakeQueryError ? error.code : "exception");
        throw error;
      }
    },
  };
}

/** The simulator's technicians for this request's signed-in user (empty without a session). */
export async function simulatorTechnicians(): Promise<{ id: string; name: string; email: string }[]> {
  const state = await getSessionState();
  if (state.kind !== "signed-in") return [];
  const client = await createUserSupabaseClient();
  if (!client) return [];
  try {
    return await simulatorTechniciansOf(client, state.user);
  } catch (error) {
    logAuthEvent("intake.query.simulator_technicians_failed", error instanceof IntakeQueryError ? error.code : "exception");
    throw error;
  }
}
