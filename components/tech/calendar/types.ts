import type { TechCalendarVisit } from "@/features/visits/supabase/tech";
import type { IsoDate } from "@/features/data-access/common";

// The technician calendar's visit (D85, D89): one of the technician's own visits, read under his
// session (features/visits/supabase/tech.ts `calendar`). Cancelled visits never get here (D60 (1)).
export type CalVisit = TechCalendarVisit;

export type CalDay = { date: IsoDate; visits: CalVisit[] };

export type TechCalView = "day" | "week";
