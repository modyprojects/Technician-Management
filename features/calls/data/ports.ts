// Service-call ports. Implemented by app/dev/demo/_data/adapter.ts (queries, fictional
// fixtures), app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and, later,
// by Supabase adapters that run on the server under the caller's session (RLS).
import type { CommandResult, Page, PageRequest } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import type { BackFromFieldPage, BackFromFieldQuery, CallDetail, CallFilter, CallsPage, CallSummary } from "./types";

export interface CallsQueries {
  /** Calls list, newest first (latest visit date and start), filtered and paged (OF-04). */
  list(filter: CallFilter): Promise<CallsPage>;
  /** The call card; null when not found (or not visible). */
  get(req: string): Promise<CallDetail | null>;
  /** Other calls of the same customer (same phone or customer number), newest first, paged (default 40, at most 100). */
  customerHistory(req: string, page?: PageRequest): Promise<Page<CallSummary>>;
  /**
   * "חזרו מהשטח" (OF-16): calls whose latest closed visit is "המשך טיפול" and that have no open
   * visit (service-call status "followup", D38), one row per call (that visit), oldest first,
   * optionally for one technician, paged (default 40, at most 100). Which matrix key gates the
   * screen is open decision #15 (d23). Server gate pending #15: deny by default; the demo's fixed
   * rule (workQueueScreensOffered) is not a grant.
   */
  backFromField(query: BackFromFieldQuery): Promise<BackFromFieldPage>;
}

/**
 * Office actions on a call. Results say whether they were simulated.
 * No reschedule or office-note command: neither is in docs/demo.html, docs/spec.md or
 * docs/demo-deviations.md, and scheduling stays in Outlook (OF-03). Adding one needs an owner
 * decision (an ADD row) first.
 */
export interface CallCommands {
  /**
   * Cancels one open visit, never the whole call (D38). OF-09 / SE-04 are PENDING (open decision
   * d08): the call card shows only a disabled placeholder, so no screen calls this yet. Matrix key
   * `cancel` (D33).
   */
  cancelVisit(ref: VisitRef, input?: { reason?: string }): Promise<CommandResult>;
}
