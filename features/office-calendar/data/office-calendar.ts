// The office "יומן טכנאים" on real data (D88 office module 2; OF-03; D94) over a Supabase client
// under the CALLER'S OWN SESSION: RLS decides which visits, calls, customers, products and
// technicians the caller reads (Migrations 1–3: `cal` or `calls`); this module narrows to the
// calendar's window and shapes the existing calendar DTOs (features/calendar/data/types.ts). No
// secret key and no environment here: lib/data/supabase/office-calendar.ts wires it per request,
// and the tests run the same mapping.
// D94: (a) the week is Sunday to Saturday (as the technician calendar, D89); (c) visibility is the
// matrix key `cal` (private.has_permission('cal')), checked here before ANY read: without it nothing
// is read and every query returns nothing (deny by default); (d) the window is one month back and
// three months forward from today (Asia/Jerusalem), rounded out to whole weeks (Sunday to Saturday,
// owner review 22.11), and every read is clamped to it; (e) read-only.
// D91: test-marked rows are shown with the "נתוני בדיקה" marker, except on Production after go-live
// (`VERCEL_ENV` production and `testingPeriod` not true), where they are left out (scope).
// Bounded (docs/security.md §9): one read covers at most one week (7 days) and OFFICE_CALENDAR_WINDOW
// visits; lanes and day columns are capped (CALENDAR_LANE_LIMIT, CALENDAR_WEEK_DAY_LIMIT).
// Cancelled visits are never on a calendar (QA-02). Every row is validated before it is used; a
// failed or unreadable read throws OfficeCalendarQueryError (a code only) and the page fails closed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SessionUser } from "@/features/auth/data/types";
import { addDays, pad, toMinutes, weekStartOf } from "@/features/calendar/data/dates";
import {
  CALENDAR_LANE_LIMIT,
  CALENDAR_WEEK_DAY_LIMIT,
  type CalendarVisit,
  type CalendarVisitDetail,
  type OfficeCalendarDay,
  type OfficeCalendarWeek,
  type PlacedCalendarVisit,
} from "@/features/calendar/data/types";
import { instantOf } from "@/features/calendar/supabase/intake-queries";
import { atJerusalem, jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import { isIsoDate, isUuid, type IsoDate } from "@/features/data-access/common";
import { isTechnicianColorToken, technicianColorCss, type TechnicianRef } from "@/features/reference/data/types";
import type { VisitRef, VisitStatus } from "@/features/visits/data/types";

/** A failed read: `code` is the PostgREST or SQLSTATE code (or "invalid-row"), never a message. */
export class OfficeCalendarQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    const safe = typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
    super(`office calendar query failed (${safe})`);
    this.name = "OfficeCalendarQueryError";
    this.code = safe;
  }
}

/** The most visits one read returns (one week); beyond it the screen says the week is cut. */
export const OFFICE_CALENDAR_WINDOW = 1000;

/** Technicians read for the chips and lanes (bounded). */
const TECHNICIANS_MAX = 200;

/** D94 (d): how far back and forward the calendar reaches, in calendar months from today. */
export const RANGE_MONTHS_BACK = 1;
export const RANGE_MONTHS_FORWARD = 3;

/** The office roles that may be offered the calendar (never a Technician; `cal` decides). */
export const officeCalendarRole = (viewer: Pick<SessionUser, "role"> | null | undefined): boolean =>
  viewer?.role === "creator" || viewer?.role === "mgr" || viewer?.role === "cs";

// ---------------------------------------------------------------------------------------------
// Dates: the window, the clamp and the week (pure).

/** `date` moved by `months` calendar months; the day is cut to the target month's last day. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const y = Number(date.slice(0, 4));
  const m0 = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m0 / 12);
  const month = ((m0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(Number(date.slice(8, 10)), last))}`;
}

export type CalendarRange = { min: IsoDate; max: IsoDate };

/**
 * D94 (d), amended by the owner's review of 22.11 (batch 2): one month back and three months forward
 * from `today`, rounded out to whole weeks: from the Sunday of the week one month ago to the Saturday
 * of the week three months ahead, both ends included. Every week shown is complete (no day of a shown
 * week is outside the range).
 */
export const calendarRangeOf = (today: IsoDate): CalendarRange => ({
  min: weekStartOf(addMonths(today, -RANGE_MONTHS_BACK)),
  max: addDays(weekStartOf(addMonths(today, RANGE_MONTHS_FORWARD)), 6),
});

/** `date` inside the window (a date outside it lands on the nearest end). */
export const clampToRange = (date: IsoDate, r: CalendarRange): IsoDate => (date < r.min ? r.min : date > r.max ? r.max : date);

export const inRange = (date: IsoDate, r: CalendarRange): boolean => date >= r.min && date <= r.max;

/** D94 (a): the seven days of the week of `date`, Sunday to Saturday. */
export const weekDaysOf = (date: IsoDate): IsoDate[] => {
  const start = weekStartOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/**
 * Where the previous / next arrows go (null at the window's edge, D94 (d)). Day: the day before or
 * after (Friday and Saturday are days of the calendar week, D94 (a)). Week: the week before or after,
 * on the same weekday, clamped into the window; none when that week has no day inside it.
 */
export function stepsOf(view: "day" | "week", date: IsoDate, r: CalendarRange): { prev: IsoDate | null; next: IsoDate | null } {
  if (view === "day") {
    return { prev: date > r.min ? addDays(date, -1) : null, next: date < r.max ? addDays(date, 1) : null };
  }
  const start = weekStartOf(date);
  return {
    prev: addDays(start, -1) >= r.min ? clampToRange(addDays(date, -7), r) : null,
    next: addDays(start, 7) <= r.max ? clampToRange(addDays(date, 7), r) : null,
  };
}

/**
 * D91 scope: whether test-marked rows are shown. Left out only on Vercel Production after go-live
 * (`testingPeriod` not exactly true); everywhere else they are shown with the marker.
 */
export const showsTestRows = (vercelEnv: string | undefined, testingPeriod: unknown): boolean =>
  !(vercelEnv === "production" && testingPeriod !== true);

// ---------------------------------------------------------------------------------------------
// Rows → DTOs (pure).

/** `visits.status` (Migration 3, DEV-3) → the UI's visit status. */
const STATUS_OF_DB = {
  scheduled: "new",
  en_route: "go",
  in_progress: "work",
  done: "done",
  followup: "cont",
  cancelled: "cancel",
} as const satisfies Record<string, VisitStatus>;
const dbStatus = z.enum(["scheduled", "en_route", "in_progress", "done", "followup", "cancelled"]);

const short = (max: number) => z.string().max(max);

/** The columns of one calendar visit: the visit, its call's request number, customer and product names. */
export const CALENDAR_VISIT_COLUMNS =
  "visit_number, status, scheduled_start, scheduled_end, city, technician_id, is_test, " +
  "service_calls(request_number, customers(name), products(name))";

export const calendarVisitRowSchema = z.object({
  visit_number: z.number().int().min(1).max(999),
  status: dbStatus,
  scheduled_start: short(64),
  scheduled_end: short(64),
  city: short(200),
  technician_id: z.string().refine(isUuid),
  is_test: z.boolean(),
  service_calls: z.object({
    request_number: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    customers: z.object({ name: short(200) }).nullable(),
    products: z.object({ name: short(200) }).nullable(),
  }),
});
export type CalendarVisitRow = z.infer<typeof calendarVisitRowSchema>;

export const technicianRowSchema = z.object({
  id: z.string().refine(isUuid),
  display_name: short(200),
  color: short(32),
  accepts_invitations: z.boolean(),
  is_test: z.boolean(),
});
export type TechnicianRow = z.infer<typeof technicianRowSchema>;

/** A technician's colour from the allowlist only, never stored CSS. */
const colorOf = (token: string): string => (isTechnicianColorToken(token) ? technicianColorCss(token) : "var(--muted)");

export const technicianRefOf = (t: TechnicianRow, phone = ""): TechnicianRef => ({ id: t.id, name: t.display_name, color: colorOf(t.color), phone });

/** One visit row → a calendar block; null for a cancelled visit or an unreadable time (never shown). */
export function calendarVisitOf(row: CalendarVisitRow, techs: ReadonlyMap<string, TechnicianRow>): CalendarVisit | null {
  if (row.status === "cancelled") return null;
  const start = instantOf(row.scheduled_start);
  const date = jerusalemDate(start);
  const from = jerusalemTime(start);
  const to = jerusalemTime(instantOf(row.scheduled_end));
  if (!date || !from || !to) return null;
  const t = techs.get(row.technician_id);
  return {
    req: row.service_calls.request_number,
    n: row.visit_number,
    date,
    start: from,
    end: to,
    status: STATUS_OF_DB[row.status],
    // Microsoft 365 is not connected (D23): a test row comes from the simulator (D24, D47).
    source: row.is_test ? "simulator" : "outlook",
    technician: { id: row.technician_id, name: t?.display_name ?? "—", color: t ? colorOf(t.color) : "var(--muted)" },
    customerName: row.service_calls.customers?.name ?? "—",
    city: row.city,
    productName: row.service_calls.products?.name ?? "—",
    isFollowUp: row.visit_number > 1,
    isTest: row.is_test,
  };
}

const byStart = (a: CalendarVisit, b: CalendarVisit): number =>
  toMinutes(a.start) - toMinutes(b.start) || a.technician.name.localeCompare(b.technician.name, "he") || a.req.localeCompare(b.req) || a.n - b.n;

/** Overlap placement (the demo's laneLayout): a visit sits beside the ones it overlaps. */
export function placeVisits(visits: readonly CalendarVisit[]): PlacedCalendarVisit[] {
  const placed: PlacedCalendarVisit[] = [];
  let cluster: PlacedCalendarVisit[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((v) => v.lane + 1));
    for (const v of cluster) placed.push({ ...v, lanes });
    cluster = [];
  };
  for (const v of [...visits].sort(byStart)) {
    if (cluster.length && toMinutes(v.start) >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => toMinutes(c.end) > toMinutes(v.start)).map((c) => c.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ ...v, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, toMinutes(v.end));
  }
  flush();
  return placed;
}

/** What one week's read gives the page: the visits, the technicians (chips and lanes) and the cut. */
export type OfficeCalendarData = {
  /** Visits of the week inside the window, cancelled left out, by start. */
  visits: CalendarVisit[];
  /** Technicians to show: those accepting invitations and any with a visit in the week, by name. */
  technicians: TechnicianRef[];
  /** More visits matched than one read returns (OFFICE_CALENDAR_WINDOW). */
  capped: boolean;
};

/** The technicians shown: every one that accepts invitations, and any with a shown visit; by name. */
export function shownTechnicians(rows: readonly TechnicianRow[], visits: readonly CalendarVisit[]): TechnicianRef[] {
  const busy = new Set(visits.map((v) => v.technician.id));
  return rows
    .filter((t) => t.accepts_invitations || busy.has(t.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "he") || a.id.localeCompare(b.id))
    .map((t) => technicianRefOf(t));
}

/**
 * The technician filter: null = every technician; one id, or the ids chosen in the desktop's
 * "טכנאים" list (owner review 22.11, batch 2).
 */
export type TechFilter = string | readonly string[] | null;

/** Whether `id` passes the filter. */
const passes = (tech: TechFilter, id: string): boolean => tech === null || (typeof tech === "string" ? tech === id : tech.includes(id));

/** The DTO's single technician id: the one chosen when exactly one, else null. */
const singleOf = (tech: TechFilter): string | null => (tech === null ? null : typeof tech === "string" ? tech : tech.length === 1 ? (tech[0] ?? null) : null);

/** The day view: one lane per technician in the filter (all when `tech` is null), placed in overlap lanes. */
export function officeDayOf(data: OfficeCalendarData, date: IsoDate, tech: TechFilter): OfficeCalendarDay {
  const technicians = data.technicians.filter((t) => passes(tech, t.id));
  const lanes = technicians.map((t) => {
    const own = data.visits.filter((v) => v.date === date && v.technician.id === t.id);
    return { technician: t, visits: { items: placeVisits(own.sort(byStart).slice(0, CALENDAR_LANE_LIMIT)), total: own.length, limit: CALENDAR_LANE_LIMIT } };
  });
  const shown = lanes.flatMap((l) => l.visits.items);
  return {
    date,
    filter: { technicianId: singleOf(tech), statuses: [] },
    includesTestData: shown.some((v) => v.isTest),
    lanes,
    total: lanes.reduce((s, l) => s + l.visits.total, 0),
  };
}

/** The week view: Sunday to Saturday (D94 (a)), each day's visits by start (every week shown is inside the window). */
export function officeWeekOf(data: OfficeCalendarData, date: IsoDate, tech: TechFilter): OfficeCalendarWeek {
  const days = weekDaysOf(date).map((d) => {
    const own = data.visits.filter((v) => v.date === d && passes(tech, v.technician.id)).sort(byStart);
    return { date: d, visits: { items: own.slice(0, CALENDAR_WEEK_DAY_LIMIT), total: own.length, limit: CALENDAR_WEEK_DAY_LIMIT } };
  });
  return {
    weekStart: weekStartOf(date),
    filter: { technicianId: singleOf(tech), statuses: [] },
    includesTestData: days.some((d) => d.visits.items.some((v) => v.isTest)),
    days,
    total: days.reduce((s, d) => s + d.visits.total, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// The drawer's detail (pure part).

export const DETAIL_COLUMNS =
  "request_number, is_test, fault_description, handling_rep_name, " +
  "customers(name, phone, is_test), products(name, sku_display, is_test), " +
  "visits(id, visit_number, status, scheduled_start, scheduled_end, city, street, technician_id, followup_reason_id, is_test)";

export const detailRowSchema = z.object({
  request_number: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  is_test: z.boolean(),
  fault_description: short(1000),
  handling_rep_name: short(200),
  customers: z.object({ name: short(200), phone: short(120), is_test: z.boolean() }),
  products: z.object({ name: short(200), sku_display: short(64), is_test: z.boolean() }),
  visits: z
    .array(
      z.object({
        id: z.string().refine(isUuid),
        visit_number: z.number().int().min(1).max(999),
        status: dbStatus,
        scheduled_start: short(64),
        scheduled_end: short(64),
        city: short(200),
        street: short(200),
        technician_id: z.string().refine(isUuid),
        followup_reason_id: z.string().refine(isUuid).nullable(),
        is_test: z.boolean(),
      }),
    )
    .max(1),
});
export type DetailRow = z.infer<typeof detailRowSchema>;

export const timeRowSchema = z.object({ kind: z.enum(["departed", "arrived", "ended", "signed"]), reported_at: short(64).nullable() });

export type DetailExtras = {
  technician: TechnicianRow | null;
  phone: string;
  times: z.infer<typeof timeRowSchema>[];
  signer: string | null;
  reason: string | null;
};

/** The call row (with its one visit) → the drawer; null for a cancelled visit or one outside the window. */
export function visitDetailOf(row: DetailRow, x: DetailExtras, range: CalendarRange): CalendarVisitDetail | null {
  const v = row.visits[0];
  if (!v || v.status === "cancelled") return null;
  const start = instantOf(v.scheduled_start);
  const date = jerusalemDate(start);
  const from = jerusalemTime(start);
  const to = jerusalemTime(instantOf(v.scheduled_end));
  if (!date || !from || !to || !inRange(date, range)) return null;
  const at = (kind: "departed" | "arrived" | "ended") => jerusalemTime(instantOf(x.times.find((t) => t.kind === kind)?.reported_at ?? null));
  const status = STATUS_OF_DB[v.status];
  return {
    req: row.request_number,
    n: v.visit_number,
    date,
    start: from,
    end: to,
    status,
    source: v.is_test ? "simulator" : "outlook",
    isTest: row.is_test || v.is_test,
    technician: x.technician ? technicianRefOf(x.technician, x.phone) : { id: v.technician_id, name: "—", color: "var(--muted)", phone: "" },
    customer: { name: row.customers.name, phone: row.customers.phone, isTest: row.customers.is_test, address: `${v.street}, ${v.city}` },
    product: { sku: row.products.sku_display, name: row.products.name, isTest: row.products.is_test },
    representative: row.handling_rep_name,
    problem: row.fault_description,
    departAt: at("departed"),
    arriveAt: at("arrived"),
    endAt: at("ended"),
    signerName: status === "done" ? x.signer : null,
    followupReason: status === "cont" ? x.reason : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Queries under the caller's session.

export type OfficeCalendarQueries = {
  /** Whether the caller's role is offered the calendar (matrix key `cal`, D33, D94 (c); the Creator always). */
  permitted(): Promise<boolean>;
  /** The week of `date`, its days inside the window only, every technician (the page filters); empty without `cal`. */
  week(date: IsoDate, range: CalendarRange): Promise<OfficeCalendarData>;
  /** One visit's drawer; null without `cal`, when absent, cancelled, outside the window or not readable. */
  visit(ref: VisitRef, range: CalendarRange): Promise<CalendarVisitDetail | null>;
};

const EMPTY: OfficeCalendarData = { visits: [], technicians: [], capped: false };

function rowsOf<T>(schema: z.ZodType<T>, result: { data: unknown; error: { code?: string } | null }, max: number): T[] {
  if (result.error) throw new OfficeCalendarQueryError(result.error.code);
  const p = z.array(schema).max(max).safeParse(result.data ?? []);
  if (!p.success) throw new OfficeCalendarQueryError("invalid-row");
  return p.data;
}

/**
 * The office calendar of `viewer` (from the server-validated session) under `db`'s session.
 * `testRows`: the D91 scope (showsTestRows). Every query checks `cal` first and reads nothing without it.
 */
export function officeCalendarQueriesOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null, testRows: boolean): OfficeCalendarQueries {
  let allowed: Promise<boolean> | null = null;
  const permitted = (): Promise<boolean> => {
    if (!officeCalendarRole(viewer)) return Promise.resolve(false);
    allowed ??= (async () => {
      const { data, error } = await db.rpc("has_permission", { p_key: "cal" });
      if (error) throw new OfficeCalendarQueryError(error.code);
      return data === true;
    })();
    return allowed;
  };

  return {
    permitted,

    async week(date, range) {
      if (!isIsoDate(date) || !isIsoDate(range.min) || !isIsoDate(range.max) || range.max < range.min) throw new OfficeCalendarQueryError("invalid-date");
      if (!(await permitted())) return EMPTY;
      const days = weekDaysOf(date).filter((d) => inRange(d, range));
      const first = days[0];
      const last = days.at(-1);
      let techQuery = db.from("technicians").select("id, display_name, color, accepts_invitations, is_test").order("display_name").limit(TECHNICIANS_MAX);
      if (!testRows) techQuery = techQuery.eq("is_test", false);
      if (!first || !last) {
        const techs = rowsOf(technicianRowSchema, await techQuery, TECHNICIANS_MAX);
        return { visits: [], technicians: shownTechnicians(techs, []), capped: false };
      }
      let visitQuery = db
        .from("visits")
        .select(CALENDAR_VISIT_COLUMNS, { count: "exact" })
        .neq("status", "cancelled")
        .gte("scheduled_start", atJerusalem(first, "00:00"))
        .lt("scheduled_start", atJerusalem(addDays(last, 1), "00:00"))
        .order("scheduled_start", { ascending: true })
        .order("visit_number", { ascending: true })
        .limit(OFFICE_CALENDAR_WINDOW);
      if (!testRows) visitQuery = visitQuery.eq("is_test", false);
      const [visitsResult, techsResult] = await Promise.all([visitQuery, techQuery]);
      const rows = rowsOf(calendarVisitRowSchema, visitsResult, OFFICE_CALENDAR_WINDOW);
      const techRows = rowsOf(technicianRowSchema, techsResult, TECHNICIANS_MAX);
      const techMap = new Map(techRows.map((t) => [t.id, t]));
      const visits = rows
        .map((r) => calendarVisitOf(r, techMap))
        .filter((v): v is CalendarVisit => v !== null && inRange(v.date, range));
      return {
        visits,
        technicians: shownTechnicians(techRows, visits),
        capped: (visitsResult.count ?? 0) > OFFICE_CALENDAR_WINDOW,
      };
    },

    async visit(ref, range) {
      if (!/^[A-Za-z0-9-]{1,32}$/.test(ref.req) || !Number.isInteger(ref.n) || ref.n < 1 || ref.n > 999) return null;
      if (!(await permitted())) return null;
      let query = db
        .from("service_calls")
        .select(DETAIL_COLUMNS)
        .eq("request_number", ref.req)
        .eq("visits.visit_number", ref.n)
        .limit(1, { referencedTable: "visits" });
      if (!testRows) query = query.eq("is_test", false);
      const call = await query.maybeSingle();
      if (call.error) throw new OfficeCalendarQueryError(call.error.code);
      if (call.data === null) return null;
      const parsed = detailRowSchema.safeParse(call.data);
      if (!parsed.success) throw new OfficeCalendarQueryError("invalid-row");
      const row = parsed.data;
      const v = row.visits[0];
      if (!v || v.status === "cancelled" || (!testRows && v.is_test)) return null;

      const [tech, times, signature, reason] = await Promise.all([
        (testRows
          ? db.from("technicians").select("id, display_name, color, accepts_invitations, is_test, profile_id").eq("id", v.technician_id)
          : db.from("technicians").select("id, display_name, color, accepts_invitations, is_test, profile_id").eq("id", v.technician_id).eq("is_test", false)
        ).limit(1),
        db.from("visit_time_current").select("kind, reported_at").eq("visit_id", v.id).limit(10),
        db.from("visit_signatures").select("signer_name").eq("visit_id", v.id).limit(1),
        v.followup_reason_id ? db.from("followup_reasons").select("label_he").eq("id", v.followup_reason_id).limit(1) : Promise.resolve({ data: [], error: null }),
      ]);
      const techRow = rowsOf(technicianRowSchema.extend({ profile_id: z.string().refine(isUuid) }), tech, 1)[0] ?? null;
      // The work phone: RLS returns the profile only where the caller may read it (Creator, Manager).
      const profile = techRow
        ? rowsOf(z.object({ work_phone: short(120).nullable() }), await db.from("profiles").select("work_phone").eq("id", techRow.profile_id).limit(1), 1)[0]
        : undefined;
      return visitDetailOf(
        row,
        {
          technician: techRow,
          phone: profile?.work_phone ?? "",
          times: rowsOf(timeRowSchema, times, 10),
          signer: rowsOf(z.object({ signer_name: short(100) }), signature, 1)[0]?.signer_name ?? null,
          reason: rowsOf(z.object({ label_he: short(200) }), reason, 1)[0]?.label_he ?? null,
        },
        range,
      );
    },
  };
}
