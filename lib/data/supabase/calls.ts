// The real calls list for this request ("קריאות"; V1 item 4). Server-only. The session's user comes
// from lib/auth/session.ts (server-validated); every read runs under that user's own session (RLS),
// through features/calls/supabase/list-queries.ts. Without a signed-in office user, or without the
// Supabase configuration, nothing is read (deny by default, fail closed). A failed read throws
// CallsQueryError (a code only), logged here by its code; the page fails closed.
import "server-only";
import type { CallsListQueries } from "@/features/calls/data/ports";
import {
  callCardBriefOf,
  callsListQueriesOf,
  callsPermittedOf,
  CallsQueryError,
  technicianOptionsOf,
  type CallCardBrief,
} from "@/features/calls/supabase/list-queries";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/** This request's signed-in user and his own client, or null (deny by default). */
async function caller() {
  const state = await getSessionState();
  if (state.kind !== "signed-in") return null;
  const client = await createUserSupabaseClient();
  return client ? { client, user: state.user } : null;
}

async function logged<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logAuthEvent(`calls.query.${name}_failed`, error instanceof CallsQueryError ? error.code : "exception");
    throw error;
  }
}

/** Whether the caller's role is offered "קריאות" (matrix key `calls`, D33); false without a session. */
export async function callsPermitted(): Promise<boolean> {
  const c = await caller();
  return c ? logged("permitted", () => callsPermittedOf(c.client, c.user)) : false;
}

/** The calls list of this request's signed-in user; empty without a session. */
export async function callsListQueries(): Promise<CallsListQueries> {
  const c = await caller();
  if (!c) {
    return {
      list: async () => ({ items: [], total: 0, page: 1, limit: 0, pageCount: 1, statusCounts: { open: 0, awaiting: 0, followup: 0, resolved: 0 }, allCount: 0 }),
    };
  }
  const queries = callsListQueriesOf(c.client, c.user);
  return { list: (filter) => logged("list", () => queries.list(filter)) };
}

/** The technicians of the list's filter. */
export async function callTechnicianOptions(): Promise<{ id: string; name: string }[]> {
  const c = await caller();
  return c ? logged("technicians", () => technicianOptionsOf(c.client, c.user)) : [];
}

/** One call for the temporary call-card page; null when absent or not readable. */
export async function callCardBrief(req: string): Promise<CallCardBrief | null> {
  const c = await caller();
  return c ? logged("card", () => callCardBriefOf(c.client, c.user, req)) : null;
}
