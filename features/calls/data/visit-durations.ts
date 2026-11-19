import { instantMs } from "@/features/dashboards/data/time";

// The office call card's durations of one visit (D60 (5); D45; D68: office only). Computed only from
// the recorded field times (ISO instants with an offset, as `visit_time_current.reported_at`),
// never invented: a duration whose two ends are not both recorded, or whose end is before its start
// (a clock or ordering fault, flagged by the database's sequence_flags), is null and not shown.
// Instants, not clock times, so a visit that runs past midnight is measured correctly.

export type VisitFieldTimes = {
  /** "יציאה": departure (`departed`). */
  departedAt: string | null;
  /** "הגעה": arrival (`arrived`). */
  arrivedAt: string | null;
  /** "סיום": end of the treatment (`ended`). */
  endedAt: string | null;
};

export type VisitDurations = {
  /** "זמן נסיעה": departure → arrival, whole minutes. */
  travelMin: number | null;
  /** "בטיפול": arrival → end, whole minutes. */
  treatMin: number | null;
  /** "משך כולל": departure → end, whole minutes. */
  totalMin: number | null;
};

/** Whole minutes from `from` to `to`; null when either is missing or invalid, or `to` is earlier. */
export function wholeMinutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = instantMs(from);
  const b = instantMs(to);
  if (a === null || b === null || b < a) return null;
  return Math.floor((b - a) / 60_000);
}

export function visitDurationsOf(t: VisitFieldTimes): VisitDurations {
  return {
    travelMin: wholeMinutesBetween(t.departedAt, t.arrivedAt),
    treatMin: wholeMinutesBetween(t.arrivedAt, t.endedAt),
    totalMin: wholeMinutesBetween(t.departedAt, t.endedAt),
  };
}

/** "45 דק׳" under an hour, else "1:05 שע׳". */
export const minutesLabel = (m: number): string => (m < 60 ? `${m} דק׳` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`);
