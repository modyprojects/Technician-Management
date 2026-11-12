// FICTITIOUS DATA ONLY: demo calendar helpers. Allowed only under app/dev (G-05).
// The demo's fixed date and the demo-only labels. The pure date helpers are the shared set in
// features/calendar/data/dates.ts (ported from docs/demo.html "helpers", L238-252), re-exported here
// under the demo's names. The demo's date is fixed (G-01: production uses dynamic dates in
// Asia/Jerusalem). Dates are "YYYY-MM-DD" strings, times "HH:MM".

import {
  addDays,
  dayName,
  ddmm,
  fromMinutes,
  isWorkDay,
  MONTH_NAMES,
  pad,
  shiftWorkDay,
  toMinutes,
  weekStartOf,
} from "@/features/calendar/data/dates";
import { atJerusalem } from "@/features/dashboards/data/time";

/** The demo's "today" (Wednesday 21.10.2026). */
export const TODAY = "2026-10-21";

/**
 * The demo's "now": 12:45 on TODAY, Asia/Jerusalem (IDT, +03:00). FICTIONAL. Only the manager
 * dashboard reads it (the server page passes it as `now`; D57, spec-final §5.1): 12:45 is the first
 * quarter hour not earlier than any fictional event recorded on TODAY (the latest is review item
 * rv-7, received 12:43). Checked against TODAY when this module loads (end of file).
 */
export const DEMO_NOW = "2026-10-21T12:45:00+03:00";

// The shared helpers under the names the fixtures and demo screens use (the demo's own names).
export { addDays, dayName, ddmm, pad, shiftWorkDay };
export const MONTHS = MONTH_NAMES;
export const isWork = isWorkDay;
export const weekStart = weekStartOf;
export const toMin = toMinutes;
export const fromMin = fromMinutes;

/**
 * The instant of a local Asia/Jerusalem date and time, with that date's offset (via Intl, never a
 * hard-coded "+03:00"): the fixtures' service_calls.opened_at / resolved_at and visit times.
 */
export { atJerusalem };

/** "היום" for TODAY, otherwise "21.10" (calls list, call card). */
export const dayLabel = (s: string): string => (s === TODAY ? "היום" : ddmm(s));

/** "רביעי 21.10". */
export const dayAndDate = (s: string): string => `${dayName(s)} ${ddmm(s)}`;

/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/** Recording length in seconds → "1:05". */
export const recLabel = (sec: number): string => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

/** Current clock time "HH:MM" for simulated actions. Client-side only (never during render). */
export function nowHM(): string {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

const JERUSALEM_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO timestamp → local date "YYYY-MM-DD" and time "HH:MM" in Asia/Jerusalem (G-01); null if invalid. */
export function jerusalemDateTime(iso: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = Object.fromEntries(JERUSALEM_PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Notification time (AppNotification.time, ISO) as the demo shows it: "היום 09:10", "אתמול 17:05" or "19.10 08:00". */
export function notificationTimeLabel(iso: string): string {
  const local = jerusalemDateTime(iso);
  if (!local) return "";
  const day = local.date === TODAY ? "היום" : local.date === addDays(TODAY, -1) ? "אתמול" : ddmm(local.date);
  return `${day} ${local.time}`;
}

// DEMO_NOW must stay on TODAY (R11): an inconsistent edit fails loudly instead of skewing the
// dashboard's "today" figures.
if (jerusalemDateTime(DEMO_NOW)?.date !== TODAY) {
  throw new Error(`DEMO_NOW (${DEMO_NOW}) is not on TODAY (${TODAY}) in Asia/Jerusalem`);
}
