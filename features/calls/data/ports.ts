// Service-call ports. Implemented by app/dev/demo/_data/adapter.ts (queries, fictional
// fixtures), app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and, later,
// by Supabase adapters that run on the server under the caller's session (RLS).
import type { CommandResult } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import type { CallDetail, CallFilter, CallsPage, CallSummary, VisitSlot } from "./types";

export interface CallsQueries {
  /** Calls list, newest first (latest visit date and start), filtered and paged (OF-04). */
  list(filter: CallFilter): Promise<CallsPage>;
  /** The call card; null when not found (or not visible). */
  get(req: string): Promise<CallDetail | null>;
  /** Other calls of the same customer (same phone or customer number), newest first. */
  customerHistory(req: string): Promise<CallSummary[]>;
  /** Every request number (static params of the demo build; not for production lists). */
  ids(): Promise<string[]>;
}

/** Office actions on a call. Results say whether they were simulated. */
export interface CallCommands {
  /**
   * Moves an open visit. Until Microsoft 365 is connected the time is changed in the Outlook
   * invitation (OF-03); `slot` is optional so the UI can record the request without a picker.
   */
  reschedule(ref: VisitRef, slot?: VisitSlot): Promise<CommandResult>;
  /** Adds an office note to the call (1–500 characters). */
  addNote(req: string, text: string): Promise<CommandResult>;
  /** Cancels one open visit, never the whole call (D38; OF-09 pending, matrix key `cancel`). */
  cancelVisit(ref: VisitRef, input?: { reason?: string }): Promise<CommandResult>;
}
