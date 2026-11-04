// Visit ports. Implemented by app/dev/demo/_data/adapter.ts (queries, fictional fixtures),
// app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and, later, by Supabase
// adapters. `techId` arguments are filters, not identity: production takes the technician from
// the session (G-03) and RLS rejects other technicians' data.
import type { CommandResult, IsoDate } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type {
  AddMediaInput,
  CloseVisitInput,
  MediaItem,
  TechDay,
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
}
