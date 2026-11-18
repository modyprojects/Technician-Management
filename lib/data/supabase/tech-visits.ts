// The real technician queries for this request (Step 3). Server-only. The Technician comes from
// lib/auth/session.ts (server-validated; the role from his own profile, the technician id from
// `my_technician_id()`); every read runs under his own session (RLS and the narrow functions of
// Migration 3), through features/visits/supabase/tech.ts. Without a technician id or the Supabase
// configuration there is nothing to read (the page then fails closed). A failed read is logged by
// its code only (docs/security.md §8) and rethrown, so the page shows the error boundary, never
// partial data.
import "server-only";
import type { SessionUser } from "@/features/auth/data/types";
import { techVisitsQueriesOf, TechVisitsQueryError, type TechVisitsQueries } from "@/features/visits/supabase/tech";
import { logAuthEvent } from "@/lib/auth/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";

function logged(queries: TechVisitsQueries): TechVisitsQueries {
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        logAuthEvent(`tech.query.${name}_failed`, error instanceof TechVisitsQueryError ? error.code : "exception");
        throw error;
      }
    };
  return {
    day: wrap("day", queries.day),
    visit: wrap("visit", queries.visit),
    photos: wrap("photos", queries.photos),
    reasons: wrap("reasons", queries.reasons),
  };
}

/**
 * The visit queries of `me`, a Technician the page's guard (requireArea("tech")) returned. Throws
 * when `me` has no technician record or the configuration is missing: the guard admits only an
 * active Technician, so either means the request cannot be served (fail closed).
 */
export async function techVisitsQueries(me: SessionUser): Promise<TechVisitsQueries> {
  if (me.role !== "tech" || !me.technicianId) throw new TechVisitsQueryError("no-technician");
  const client = await createUserSupabaseClient();
  if (!client) throw new TechVisitsQueryError("not-configured");
  return logged(techVisitsQueriesOf(client, { technicianId: me.technicianId, name: me.name }));
}
