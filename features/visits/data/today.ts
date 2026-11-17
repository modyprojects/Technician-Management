// "Today" and the greeting of the technician home in Asia/Jerusalem (G-01: dynamic dates; the
// server's or browser's own time zone never decides). Pure: the caller passes the clock.
import type { IsoDate } from "@/features/data-access/common";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";

/** The Asia/Jerusalem calendar date of `now`. */
export function jerusalemToday(now: Date = new Date()): IsoDate {
  const d = jerusalemDate(now.toISOString());
  if (!d) throw new RangeError("invalid clock");
  return d;
}

/**
 * The demo's "בוקר טוב" by the Asia/Jerusalem hour (G-01): "בוקר טוב" 04:00–11:59, "צהריים טובים"
 * 12:00–16:59, "ערב טוב" otherwise.
 */
export function greetingAt(now: Date = new Date()): string {
  const hour = Number((jerusalemTime(now.toISOString()) ?? "08:00").slice(0, 2));
  if (hour >= 4 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  return "ערב טוב";
}
