import { toMinutes } from "@/features/calendar/data/dates";
import type { CalVisit } from "./types";

// The hour grid of the technician calendar: 08:00-17:00 by default, widened to the whole hours that
// hold the shown visits (before 08:00 or after 17:00), so no visit is clamped or hidden (D89 (e)).
// Pure (no clock): unit-tested in tests/e2e/tech-calendar-logic.spec.ts.
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 17;
/** A block is never drawn shorter than this many minutes (zero-length or very short visits). */
export const MIN_BLOCK_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

export type HourRange = { startHour: number; endHour: number };
type Times = Pick<CalVisit, "start" | "end">;

/**
 * The minutes [from, to) a visit occupies on its day's grid. A visit that ends on a later day
 * (end before start on the clock) runs to midnight; every block is at least MIN_BLOCK_MINUTES long,
 * never past midnight.
 */
export function visitSpan(v: Times): { from: number; to: number } {
  const from = Math.min(toMinutes(v.start), DAY_MINUTES - MIN_BLOCK_MINUTES);
  let to = toMinutes(v.end);
  if (to < toMinutes(v.start)) to = DAY_MINUTES;
  return { from, to: Math.min(Math.max(to, from + MIN_BLOCK_MINUTES), DAY_MINUTES) };
}

export function hourRange(visits: readonly Times[]): HourRange {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const v of visits) {
    const { from, to } = visitSpan(v);
    startHour = Math.min(startHour, Math.floor(from / 60));
    endHour = Math.max(endHour, Math.ceil(to / 60));
  }
  return { startHour, endHour: Math.min(endHour, 24) };
}

/** A visit's top and height in pixels on a grid of `hourPx` per hour. */
export function blockBox(v: Times, range: HourRange, hourPx: number): { top: number; height: number } {
  const { from, to } = visitSpan(v);
  return { top: ((from - range.startHour * 60) / 60) * hourPx, height: ((to - from) / 60) * hourPx };
}

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
