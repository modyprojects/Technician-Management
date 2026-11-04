import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { pad, toMinutes } from "@/features/calendar/data/dates";
import { CALENDAR_STATUS_VALUES } from "@/features/calendar/data/types";
import type { HourMinute } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";

// Shared bits of the office "יומן טכנאים" (docs/demo.html offCal() L752-802): the day grid's hour
// range, the status legend and the drawer's focus key. Pure and presentational (no data). The date
// helpers (day names, ddmm, addDays, the arrows' shiftCalendarDate) are the shared set in
// features/calendar/data/dates.ts, used by the technician calendar too.

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
