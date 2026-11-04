// Visit ports. Implemented by app/dev/demo/_data/adapter.ts (queries, fictional fixtures),
// app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and, later, by Supabase
// adapters. `techId` arguments are filters, not identity: production takes the technician from
// the session (G-03) and RLS rejects other technicians' data.
import type { CommandResult, IsoDate, Page, PageRequest } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type {
  AddMediaInput,
  ClosedVisitDetail,
  CloseVisitInput,
  MediaItem,
  TechDay,
  TechDayVisit,
  VisitCorrection,
  VisitCorrectionHistory,
  VisitCorrectionInput,
  VisitDetail,
  VisitHistoryItem,
  VisitRef,
} from "./types";

export interface VisitsQueries {
  /** The technician's visits on `date` (cancelled excluded) and the home-header counters; null for an unknown technician. */
  techDay(techId: TechnicianId, date: IsoDate): Promise<TechDay | null>;
  /** One visit with its call, customer and product; null when not found (or not visible). */
  get(ref: VisitRef): Promise<VisitDetail | null>;
  /**
   * Earlier closed visits the viewer of `ref` may see, oldest first (TE-06). D36 allows a
   * technician only the same call's earlier visits (relation "call"); never `ref` itself,
   * later visits or open visits.
   */
  history(ref: VisitRef): Promise<VisitHistoryItem[]>;
  /**
   * "הושלמו היום" (TE-26): the technician's visits closed on `date` ("טופל" / "המשך טיפול"), by
   * start time, paged (default 40, at most 100); null for an unknown technician.
   */
  doneVisits(techId: TechnicianId, date: IsoDate, page?: PageRequest): Promise<Page<TechDayVisit> | null>;
  /**
   * One of the technician's own closed visits, read-only (TE-26, D14); null when not found, not
   * closed, or another technician's visit.
   */
  doneVisit(techId: TechnicianId, ref: VisitRef): Promise<ClosedVisitDetail | null>;
  /**
   * A server-closed visit's correctable values and audited corrections, newest first (OF-10, D14;
   * at most VISIT_CORRECTIONS_LIMIT); null when the visit is not found, not visible, or not closed.
   * Office only: production reads `visit_corrections` with `card` (docs/database-schema.md §8.3).
   */
  corrections(ref: VisitRef): Promise<VisitCorrectionHistory | null>;
}

/**
 * Technician actions on an open visit. Every result says whether it was simulated; screens
 * show the outcome from the result (and never claim a save, an upload or an email that did not
 * happen, TE-23).
 */
export interface VisitCommands {
  /** "יוצא · Waze": status "בדרך", departure time recorded (TE-02). */
  depart(ref: VisitRef): Promise<CommandResult>;
  /** "הגעתי": status "בטיפול", arrival time recorded. */
  arrive(ref: VisitRef): Promise<CommandResult>;
  /** Ticks or clears "נאסף" for the visit's pickup on the technician home (TE-03). */
  setPickupCollected(ref: VisitRef, collected: boolean): Promise<CommandResult>;
  /** Written summary (draft until close). */
  saveSummary(ref: VisitRef, text: string): Promise<CommandResult>;
  /** Adds a photo or video; returns the new media item. */
  addMedia(ref: VisitRef, input: AddMediaInput): Promise<CommandResult<{ media: MediaItem }>>;
  removeMedia(ref: VisitRef, mediaId: string): Promise<CommandResult>;
  /** Stores a recording of `seconds` length (the audio goes through the upload path). */
  saveRecording(ref: VisitRef, input: { seconds: number }): Promise<CommandResult>;
  deleteRecording(ref: VisitRef): Promise<CommandResult>;
  /** Parts replaced (TE-17). */
  saveParts(ref: VisitRef, parts: readonly string[]): Promise<CommandResult>;
  /** Closes the visit: "טופל" with signature, or "המשך טיפול" with a reason. */
  close(ref: VisitRef, input: CloseVisitInput): Promise<CommandResult>;
  /**
   * "תיקון ביקור סגור" (OF-10, D14): an audited correction of one field of a server-closed visit
   * with a mandatory reason; the original stays stored. Manager and Creator only (a fixed
   * capability, D33); never the signed approval text, the signer or the signature (D43). Field
   * times add a correction time report (D45). Returns the correction as stored. Rejected per
   * visitCorrectionError.
   */
  correct(input: VisitCorrectionInput): Promise<CommandResult<{ correction: VisitCorrection }>>;
}
