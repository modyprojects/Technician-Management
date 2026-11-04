// Profile port. Implemented by app/dev/demo/_data/adapter.ts (fictional fixtures) and, later, by a
// server-side Supabase adapter. `techId` is a filter, not identity: production takes the
// technician from the session (G-03) and RLS rejects other technicians' data.
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { TechnicianProfile } from "./types";

export interface ProfileQueries {
  /** The technician's profile with the figures of the week containing `date`; null for an unknown technician. */
  technician(techId: TechnicianId, date: IsoDate): Promise<TechnicianProfile | null>;
}
