// Review-item ports ("פריטים לבדיקה"; D39, D43, D44, D45). Implemented by
// app/dev/demo/_data/adapter.ts (queries, fictional fixtures), app/dev/demo/_components/
// SimulatedCommands.tsx (commands, simulated) and, later, by Supabase adapters that run on the
// server under the caller's session: `review_items` read with `card`; resolution by a server
// function that checks the caller in the database (D14 cases: Manager and Creator only; other
// items: matrix key `conflicts`; docs/database-schema.md §8.3) and writes the audit in the same
// transaction. The screen offers it with `conflicts` (display only, G-04).
import type { CommandResult } from "@/features/data-access/common";
import type { ReviewItemDetail, ReviewItemId, ReviewListQuery, ReviewPage, ReviewResolveInput } from "./types";

export interface ReviewQueries {
  /** Items newest first (by receipt time), optionally one status; paged (default 40, at most 100). */
  list(query?: ReviewListQuery): Promise<ReviewPage>;
  /** One item with both versions per field; null when not found (or not visible). */
  get(id: ReviewItemId): Promise<ReviewItemDetail | null>;
}

export interface ReviewCommands {
  /**
   * Resolves an open item: apply the submitted change, keep the server's value, or choose per
   * field where the item offers it. Rejected for an unknown or resolved item, a stale version, a
   * decision the item does not offer, a missing choice for a conflicting field, a missing required
   * note, or a caller who may not resolve it (reviewResolutionError). Both versions stay stored.
   */
  resolve(input: ReviewResolveInput): Promise<CommandResult>;
}
