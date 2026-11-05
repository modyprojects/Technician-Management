// Period resolver of the manager dashboard (D57; docs/design/manager-dashboard-spec.md §6, §7.2):
// the Technicians tab's day / week / month / year / custom periods, the General chart's completed
// months and the coverage guard. Pure: dates are "YYYY-MM-DD" in Asia/Jerusalem and "today"
// (`asOf`) always comes from the caller (G-01). There is no future navigation: offsets are 0 or
// negative, and a custom range ends at `asOf` at the latest.
import { addDays, dayName, monthLabel, MONTH_NAMES, pad, weekStartOf } from "@/features/calendar/data/dates";
import type { YearMonth } from "@/features/calendar/data/types";
import { isIsoDate, type IsoDate } from "@/features/data-access/common";
import type { AnalyticsPeriod } from "./types";

export const DASHBOARD_PERIOD_KINDS = ["day", "week", "month", "year", "custom"] as const;
export type DashboardPeriodKind = (typeof DASHBOARD_PERIOD_KINDS)[number];

export const isDashboardPeriodKind = (value: unknown): value is DashboardPeriodKind =>
  typeof value === "string" && (DASHBOARD_PERIOD_KINDS as readonly string[]).includes(value);

/** The default period of the Technicians tab: the current month (spec §7.2). */
export const DEFAULT_PERIOD_KIND: DashboardPeriodKind = "month";

/** Period kinds with previous / next navigation. */
export type NavigablePeriodKind = Exclude<DashboardPeriodKind, "custom">;

/**
 * How far back the previous arrow goes (PROPOSED by Claude Code, OF-19: owner feedback pending
 * under D53): two years of days, 104 weeks, 24 months, 5 years.
 */
export const MIN_OFFSET: Readonly<Record<NavigablePeriodKind, number>> = { day: -730, week: -104, month: -24, year: -5 };

/** Longest custom range, days inclusive (a leap year fits; docs/architecture-data-access.md). */
export const MAX_RANGE_DAYS = 366;

const at = (d: IsoDate): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Days from `from` to `to`, both included (1 for a single day; 0 or less when `to` is earlier). */
export const daysInclusive = (from: IsoDate, to: IsoDate): number => Math.round((at(to) - at(from)) / 864e5) + 1;

/** "21.10.2026", "1.10.2026", "2.1.2027" (no leading zeros). */
export const dateLabel = (d: IsoDate): string => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;

/** The dashboard title's date: "יום רביעי, 21 באוקטובר 2026" (the page and its loading state). */
export const longDateLabel = (d: IsoDate): string =>
  `יום ${dayName(d)}, ${Number(d.slice(8, 10))} ב${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

const dayMonth = (d: IsoDate): string => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;

/** Compact range: "18.10–24.10.2026", "22.9–21.10.2026"; across years "27.12.2026–2.1.2027". */
export function rangeLabel(from: IsoDate, to: IsoDate): string {
  if (from === to) return dateLabel(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${dayMonth(from)}–${dateLabel(to)}` : `${dateLabel(from)}–${dateLabel(to)}`;
}

/** A custom range as typed: "1.10.2026 – 21.10.2026". */
export const customRangeLabel = (from: IsoDate, to: IsoDate): string => `${dateLabel(from)} – ${dateLabel(to)}`;

/** "2026-10" for "2026-10-21". */
export const monthOfDate = (d: IsoDate): YearMonth => d.slice(0, 7);

/** `month` plus `n` months (negative goes back). */
export function shiftMonth(month: YearMonth, n: number): YearMonth {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${pad((((index % 12) + 12) % 12) + 1)}`;
}

/** The whole calendar month as an inclusive period. */
export function monthPeriod(month: YearMonth): AnalyticsPeriod {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

/** The `days` days ending with `asOf` (the General highlights' 30 days, T4). */
export const lastDaysWindow = (asOf: IsoDate, days: number): AnalyticsPeriod => ({ from: addDays(asOf, -(days - 1)), to: asOf });

/** Whether `date` is inside the inclusive period (false for null). */
export const periodContains = (p: AnalyticsPeriod, date: IsoDate | null): boolean => date !== null && date >= p.from && date <= p.to;

/**
 * The `n` completed months before `asOf`'s month, oldest first (the General chart, spec §6):
 * completedMonths("2026-10-21", 6) = 2026-04 … 2026-09.
 */
export function completedMonths(asOf: IsoDate, n: number): YearMonth[] {
  const current = monthOfDate(asOf);
  return Array.from({ length: n }, (_, i) => shiftMonth(current, i - n));
}

/**
 * Whether the period ends before the first recorded call (`coverageStart`), so every metric is
 * "no data", never a real-looking 0 (spec §4.1 "Missing data"). With no call at all
 * (`coverageStart` null) every period is before coverage.
 */
export const beforeCoverage = (period: AnalyticsPeriod, coverageStart: IsoDate | null): boolean =>
  coverageStart === null || period.to < coverageStart;

/** Offset of a navigable period: 0 for a positive or malformed value, at least MIN_OFFSET[kind]. */
export function clampOffset(kind: DashboardPeriodKind, offset: unknown): number {
  if (kind === "custom") return 0;
  const n = typeof offset === "string" && offset.trim() !== "" ? Number(offset) : offset;
  if (typeof n !== "number" || !Number.isInteger(n) || n > 0) return 0;
  return Math.max(MIN_OFFSET[kind], n);
}

/** What the Technicians toolbar asks for (URL values; anything malformed falls back). */
export type DashboardPeriodRequest = { kind?: unknown; offset?: unknown; from?: unknown; to?: unknown };

export type ResolvedDashboardPeriod = {
  kind: DashboardPeriodKind;
  /** 0 = the current period; always 0 for "custom". */
  offset: number;
  /** The period the metrics use (the current month when a custom range is invalid). */
  period: AnalyticsPeriod;
  /** "21.10.2026", "18.10–24.10.2026", "אוקטובר 2026", "2026", "1.10.2026 – 21.10.2026". */
  label: string;
  canGoPrev: boolean;
  /** offset < 0: no future navigation. */
  canGoNext: boolean;
  /** "custom" only: the requested range (valid dates only), to prefill the form. */
  from?: IsoDate;
  to?: IsoDate;
  /** "custom" only: the range is not `from ≤ to ≤ asOf` within MAX_RANGE_DAYS; `period` falls back to the current month. */
  error?: "invalid-range";
};

/**
 * The period of the Technicians tab (spec §7.2; D57 (3)). day: `asOf + offset`; week: Sunday to
 * Saturday; month: the calendar month; year: 1 January to 31 December; custom: as entered, the
 * first "מותאם" click giving the 1st of `asOf`'s month to `asOf`. A current period may extend past
 * `asOf` (its later visits count as planned, T12); nothing starts after `asOf`.
 */
export function resolveDashboardPeriod(request: DashboardPeriodRequest, asOf: IsoDate): ResolvedDashboardPeriod {
  if (!isIsoDate(asOf)) throw new RangeError("Invalid date");
  const kind: DashboardPeriodKind = isDashboardPeriodKind(request.kind) ? request.kind : DEFAULT_PERIOD_KIND;

  if (kind === "custom") {
    const given = (v: unknown) => v !== undefined && v !== null && v !== "";
    const current = monthOfDate(asOf);
    if (!given(request.from) && !given(request.to)) {
      const from = `${current}-01`;
      return { kind, offset: 0, period: { from, to: asOf }, label: customRangeLabel(from, asOf), canGoPrev: false, canGoNext: false, from, to: asOf };
    }
    const from = isIsoDate(request.from) ? request.from : undefined;
    const to = isIsoDate(request.to) ? request.to : undefined;
    if (from !== undefined && to !== undefined && from <= to && to <= asOf && daysInclusive(from, to) <= MAX_RANGE_DAYS) {
      return { kind, offset: 0, period: { from, to }, label: customRangeLabel(from, to), canGoPrev: false, canGoNext: false, from, to };
    }
    return {
      kind,
      offset: 0,
      period: monthPeriod(current),
      label: monthLabel(current),
      canGoPrev: false,
      canGoNext: false,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      error: "invalid-range",
    };
  }

  const offset = clampOffset(kind, request.offset);
  const nav = { kind, offset, canGoPrev: offset > MIN_OFFSET[kind], canGoNext: offset < 0 };
  if (kind === "day") {
    const d = addDays(asOf, offset);
    return { ...nav, period: { from: d, to: d }, label: dateLabel(d) };
  }
  if (kind === "week") {
    const from = addDays(weekStartOf(asOf), 7 * offset);
    const to = addDays(from, 6);
    return { ...nav, period: { from, to }, label: rangeLabel(from, to) };
  }
  if (kind === "month") {
    const month = shiftMonth(monthOfDate(asOf), offset);
    return { ...nav, period: monthPeriod(month), label: monthLabel(month) };
  }
  const year = Number(asOf.slice(0, 4)) + offset;
  return { ...nav, period: { from: `${year}-01-01`, to: `${year}-12-31` }, label: String(year) };
}
