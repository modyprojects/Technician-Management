// Shared building blocks of the typed data-access layer (owner architecture rule, 2026-11-03):
// screens read data only through the ports in features/*/data/ports.ts. Today a fixture adapter
// implements them (app/dev/demo/_data/adapter.ts); later a Supabase adapter implements the same
// ports on the server, under the caller's session, with RLS (docs/security.md).
// Pure types and helpers: no data, no I/O, safe on the server and in the browser.

/** Calendar date "YYYY-MM-DD" (Asia/Jerusalem in production, G-01). */
export type IsoDate = string;

/** Local time "HH:MM". */
export type HourMinute = string;

/**
 * Point in time, ISO 8601 with an offset, e.g. "2026-10-20T17:05:00+03:00" (timestamptz in the
 * database). Screens format it for the user (Asia/Jerusalem, G-01); DTOs never carry display text.
 */
export type IsoTimestamp = string;

/** D47: every record DTO says whether it is test data, so screens can show "🧪 נתוני בדיקה". */
export type TestMarker = { isTest: boolean };

/**
 * A list cut to a fixed, documented cap (lists inside aggregate DTOs such as dashboards). Every
 * list result is bounded (docs/security.md: query bounds); `total` lets a screen say "ועוד X".
 */
export type Bounded<T> = {
  /** At most `limit` items. */
  items: T[];
  /** Matching records before the cap. */
  total: number;
  /** The cap that was applied. */
  limit: number;
};

/** One page of a bounded list query (the caller chooses page and size). */
export type Page<T> = Bounded<T> & {
  /** 1-based page number actually returned (clamped). */
  page: number;
  /** Number of pages (at least 1). */
  pageCount: number;
};

/** What a caller asks of a paged list query. Both optional; adapters clamp them (clampPage, clampLimit). */
export type PageRequest = {
  /** 1-based page; default 1. */
  page?: number;
  /** Page size; default DEFAULT_PAGE_LIMIT (40), at most MAX_PAGE_LIMIT (100). */
  limit?: number;
};

/** Result of every command (save, sign, upload, cancel ...). */
export type CommandResult<T = void> =
  | {
      ok: true;
      /** True when nothing was saved or sent (UI demo, D53). Screens must not claim a real save. */
      simulated: boolean;
      /** Short Hebrew status line for the user. */
      message?: string;
      data?: T;
    }
  | {
      ok: false;
      simulated: boolean;
      /** Hebrew error for the user (never a stack trace or server detail). */
      error: string;
    };

/** Hard upper bound of every list query (docs/security.md: query bounds). */
export const MAX_PAGE_LIMIT = 100;

/** Default page size: the demo's 40-row cap (OF-04). */
export const DEFAULT_PAGE_LIMIT = 40;

/** Longest free-text search accepted by list queries. */
export const MAX_QUERY_LENGTH = 100;

/** Integer in [min, max]; `fallback` for anything that is not a finite number. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Page size in [1, MAX_PAGE_LIMIT]. */
export const clampLimit = (limit: unknown): number => clampInt(limit, 1, MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);

/** 1-based page number (at least 1, bounded so offsets stay small). */
export const clampPage = (page: unknown): number => clampInt(page, 1, 10_000, 1);

/** Trimmed search text, cut to MAX_QUERY_LENGTH; "" when not a string. */
export function normalizeQuery(q: unknown): string {
  return typeof q === "string" ? q.trim().slice(0, MAX_QUERY_LENGTH) : "";
}

/** Trimmed free text cut to `max` characters; "" when not a string. */
export function cleanText(text: unknown, max: number): string {
  return typeof text === "string" ? text.trim().slice(0, max) : "";
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "YYYY-MM-DD" of a date that exists (2026-02-31 does not: Date would roll it over to March). */
export const isIsoDate = (value: unknown): value is IsoDate =>
  typeof value === "string" && ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const isHourMinute = (value: unknown): value is HourMinute =>
  typeof value === "string" && HOUR_MINUTE.test(value);

/** Request number ("מספר פנייה") or another short identifier: letters, digits and dashes. */
export const isRecordKey = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{1,32}$/.test(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A database id (uuid, 36 characters, either case). */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The first `cap` items of an in-memory list (fixture adapters; a database uses LIMIT and a count). */
export function boundedOf<T>(all: readonly T[], cap: number): Bounded<T> {
  const limit = clampInt(cap, 1, MAX_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
  return { items: all.slice(0, limit), total: all.length, limit };
}

/** Slice one page out of an in-memory list (fixture adapters; a database pages with LIMIT/OFFSET). */
export function pageOf<T>(all: readonly T[], page: unknown, limit: unknown): Page<T> {
  const size = clampLimit(limit);
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const current = Math.min(clampPage(page), pageCount);
  const start = (current - 1) * size;
  return { items: all.slice(start, start + size), total: all.length, page: current, limit: size, pageCount };
}
