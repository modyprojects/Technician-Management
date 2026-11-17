// The short time label of the account screens ("היום 14:20", "אתמול 09:10", "14.09 12:20"), in
// Asia/Jerusalem (G-01), for a creation intent's "התחילה …" and a Creator notice. Pure: `Intl` only;
// the caller passes `now` (the server's request time), so the label never depends on the server's
// own time zone. Accepts the database's timestamps as PostgREST returns them (microseconds and an
// offset); anything unreadable gives "".
import { addDays, ddmm } from "@/features/calendar/data/dates";
import type { IsoDate } from "@/features/data-access/common";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A timestamp with an explicit offset or "Z" (never a local time, whose meaning would depend on the server). */
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

function local(value: string | Date): { date: IsoDate; time: string } | null {
  let ms: number;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "string" && WITH_OFFSET.test(value)) {
    // PostgreSQL may write the offset as "+00" or "+0000"; Date.parse wants "+00:00".
    ms = Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  }
  else return null;
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}` as IsoDate, time: `${p.hour}:${p.minute}` };
}

/** "היום 14:20" / "אתמול 09:10" / "14.09 12:20" (Asia/Jerusalem); "" when `iso` is not a timestamp. */
export function accountTimeLabel(iso: string | null | undefined, now: Date): string {
  if (typeof iso !== "string") return "";
  const at = local(iso);
  const today = local(now);
  if (!at || !today) return "";
  const day = at.date === today.date ? "היום" : at.date === addDays(today.date, -1) ? "אתמול" : ddmm(at.date);
  return `${day} ${at.time}`;
}
