import { toMinutes } from "@/features/calendar/data/dates";
import type { FakeVisit } from "./types";

// The hour grid of the technician calendar: 08:00-17:00 by default, widened to the whole hours that
// hold the shown visits (before 08:00 or after 17:00), so no visit is clamped or hidden (D83).
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 17;

export type HourRange = { startHour: number; endHour: number };

export function hourRange(visits: readonly Pick<FakeVisit, "start" | "end">[]): HourRange {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const v of visits) {
    startHour = Math.min(startHour, Math.floor(toMinutes(v.start) / 60));
    endHour = Math.max(endHour, Math.ceil(toMinutes(v.end) / 60));
  }
  return { startHour, endHour: Math.min(endHour, 24) };
}

/** A visit's top and height in pixels on a grid of `hourPx` per hour (at least 30 minutes tall). */
export function blockBox(v: Pick<FakeVisit, "start" | "end">, range: HourRange, hourPx: number): { top: number; height: number } {
  const from = toMinutes(v.start) - range.startHour * 60;
  const len = Math.max(toMinutes(v.end) - toMinutes(v.start), 30);
  return { top: (from / 60) * hourPx, height: (len / 60) * hourPx };
}

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
