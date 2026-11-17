// The database side of the single ingestion service (features/calendar/ingestion): one RPC per
// command, public.ingest_calendar_event (Migration 6), under the caller's own session (RLS, grants
// and the function's own caller check decide; docs/security.md §5). The function runs the whole
// change in one transaction: idempotency, ordering, lookups, D39 review routing and test marking.
// Server-only. Errors carry the database code only, never its text or a value.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseIngestionOutcome } from "@/features/calendar/ingestion/outcome";
import { toDatabaseCommand } from "@/features/calendar/ingestion/plan";
import type { IngestionStore } from "@/features/calendar/ingestion/types";

/** A refused or failed ingestion call: the database (PostgREST) code, or "unexpected-answer". */
export class IngestionStoreError extends Error {
  constructor(readonly code: string | null) {
    super("calendar ingestion failed");
    this.name = "IngestionStoreError";
  }
}

export function supabaseIngestionStore(client: SupabaseClient): IngestionStore {
  return {
    async apply(command) {
      const { data, error } = await client.rpc("ingest_calendar_event", { p_command: toDatabaseCommand(command) });
      if (error) throw new IngestionStoreError(typeof error.code === "string" ? error.code : null);
      const outcome = parseIngestionOutcome(data);
      if (!outcome) throw new IngestionStoreError("unexpected-answer");
      return outcome;
    },
  };
}
