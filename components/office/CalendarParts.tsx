import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { CALENDAR_STATUS_VALUES } from "@/features/calendar/data/types";
import type { HourMinute, IsoDate } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";

// Shared bits of the office "יומן טכנאים" (docs/demo.html offCal() L752-802): date labels as the
// demo writes them, the day grid's hour range, the status legend and the visit-count wording.
// Pure and presentational (no data). Dates are "YYYY-MM-DD" and times "HH:MM"; weekday arithmetic
// uses UTC noon, so the result never depends on the server or browser time zone.

/** The demo's DAYS (Sunday first). */
export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

const utcNoon = (date: IsoDate): Date => new Date(`${date}T12:00:00Z`);

const pad = (n: number): string => String(n).padStart(2, "0");

/** Day of week, 0 = Sunday. */
export const weekdayOf = (date: IsoDate): number => utcNoon(date).getUTCDay();

/** "רביעי". */
export const dayNameOf = (date: IsoDate): string => DAY_NAMES[weekdayOf(date)] ?? "";

/** "21.10" (the demo's ddmm). */
export const ddmm = (date: IsoDate): string => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** Date plus `n` days (negative goes back). */
export function addDaysIso(date: IsoDate, n: number): IsoDate {
  const d = utcNoon(date);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "HH:MM" → minutes since midnight (0 for a malformed value). */
export function toMinutes(time: HourMinute): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

/** The demo's field day: 08:00 to 18:00. */
const DAY_START = 8 * 60;
const DAY_END = 18 * 60;

/**
 * Whole hours the day grid shows: 08:00-18:00 as in the demo, widened when a visit starts earlier
 * or ends later, so no block falls outside the grid.
 */
export function hourRange(visits: readonly { start: HourMinute; end: HourMinute }[]): { from: number; to: number } {
  let from = DAY_START;
  let to = DAY_END;
  for (const v of visits) {
    from = Math.min(from, toMinutes(v.start));
    to = Math.max(to, toMinutes(v.end));
  }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;
  return { from, to: Math.min(24 * 60, Math.max(to, from + 60)) };
}

/** "08:00". */
export const hourLabel = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:00`;

/** "ביקור אחד" / "3 ביקורים". */
export const visitCountLabel = (n: number): string => (n === 1 ? "ביקור אחד" : `${n} ביקורים`);

/**
 * The value of `data-cal-visit` on a visit block: the drawer gives focus back to the block that
 * opened it when it closes.
 */
export const calVisitKey = (v: VisitRef): string => `${v.req}:${v.n}`;

/** The demo's legend (L801): a square dot in the status colour and the status name. */
export function CalendarLegend() {
  return (
    <ul className="ocal-legend" aria-label="מקרא צבעי סטטוס">
      {CALENDAR_STATUS_VALUES.map((status) => (
        <li key={status}>
          <span className="dot" style={{ background: VISIT_STATUSES[status].c, borderRadius: 3 }} aria-hidden="true" />{" "}
          {VISIT_STATUSES[status].label}
        </li>
      ))}
    </ul>
  );
}
