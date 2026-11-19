// The technician's own visits, read under HIS OWN SESSION (Step 3; ROADMAP "Technician views"; QA
// T-02, T-03, T-07; D36, D40, D47, D60 (1)). No secret key, no environment, no server-only import:
// lib/data/supabase/tech-visits.ts wires it per request, and the local-stack tests (tests/auth) run
// this same code with real local clients.
//
// What the database lets a Technician read (Migration 3, TEMPORARY OQ-1, OQ-9, OQ-10, OQ-12):
// - `visits`: his own rows, every status (RLS visits_select_technician);
// - `my_visit_details(visit)`: the call, customer, product and label details of his own visit that
//   is open or was closed today (Asia/Jerusalem); 42501 otherwise;
// - `visit_rep_contact(visit)`: the handling representative's name and work phone, same window (D40);
// - `previous_visits(visit)`: the earlier closed visits of the same call, only while his visit is
//   open (D36);
// - `visit_reports` and `visit_signatures`: his own visits' rows;
// - `technicians`: his own row; `followup_reasons` and `collection_locations`: active rows.
// He never reads `service_calls`, `customers` or `products` directly, and never field times (open
// decision 2). RLS is the boundary; the technician id below only narrows the query.
//
// D60 (1): a cancelled visit is never shown ("בוטלה" is not a user-facing status): it is left out of
// every list and counter, and its address answers "not found". Every list is bounded.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addDays } from "@/features/calendar/data/dates";
import { isIsoDate, isUuid, type HourMinute, type IsoDate } from "@/features/data-access/common";
import { atJerusalem, jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import { isTechnicianColorToken, technicianColorCss, type TechnicianRef } from "@/features/reference/data/types";
import type {
  ClosedVisitDetail,
  PickupGroup,
  TechDay,
  TechDayVisitWithId,
  VisitDetail,
  VisitHistoryItem,
  VisitStatus,
} from "@/features/visits/data/types";

/** A failed read: `code` is the PostgREST or SQLSTATE code (or "invalid-row"), never a message. */
export class TechVisitsQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    const safe = typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
    super(`technician visits query failed (${safe})`);
    this.name = "TechVisitsQueryError";
    this.code = safe;
  }
}

/** The signed-in Technician (from the server-validated session, lib/auth/session.ts). */
export type TechViewer = { technicianId: string; name: string };

/** Cap of the visits read for one day (a technician's day never comes close). */
export const TECH_DAY_LIMIT = 100;

/** Cap of the visits read for the calendar window (two weeks; never close in practice). */
export const TECH_CALENDAR_LIMIT = 300;

/** The longest window the calendar may read, in days (the current week and the next, D89 (a)). */
export const TECH_CALENDAR_MAX_DAYS = 14;

/** "לא צוין" for a pickup place the invitation did not name (the demo's fallback). */
export const PICKUP_PLACE_NOT_GIVEN = "לא צוין";

/** The database's visit status codes → the screens' codes (Migration 3 DEV-3). */
const STATUS_OF_DB: Readonly<Record<string, VisitStatus>> = {
  scheduled: "new",
  en_route: "go",
  in_progress: "work",
  done: "done",
  followup: "cont",
  cancelled: "cancel",
};

/** The screen status of a database code; null for an unknown code (the row is refused). */
export function visitStatusOfDb(code: unknown): VisitStatus | null {
  return typeof code === "string" && Object.hasOwn(STATUS_OF_DB, code) ? (STATUS_OF_DB[code] ?? null) : null;
}

/** Visit columns the technician screens read (Migration 3 `visits`). */
export const TECH_VISIT_COLUMNS =
  "id, visit_number, task_number, scheduled_start, scheduled_end, status, city, street, building, floor, apartment, " +
  "arrival_notes, tech_notes, pickup_item, next_visit_notes, closed_at, is_test";

const text = z.string();
const optText = z.string().nullable();
const instant = z.string().min(1);

const VisitRowSchema = z.object({
  id: z.string().refine(isUuid),
  visit_number: z.number().int().min(1),
  task_number: text,
  scheduled_start: instant,
  scheduled_end: instant,
  status: text,
  city: text,
  street: text,
  building: optText,
  floor: optText,
  apartment: optText,
  arrival_notes: optText,
  tech_notes: optText,
  pickup_item: optText,
  next_visit_notes: optText,
  closed_at: z.string().nullable(),
  is_test: z.boolean(),
});
export type TechVisitRow = z.infer<typeof VisitRowSchema>;

const DetailsRowSchema = z.object({
  request_number: text,
  call_type_label: text,
  fault_description: text,
  warranty_status: z.enum(["yes", "no"]).nullable(),
  warranty_until: z.string().nullable(),
  is_test: z.boolean(),
  customer_number: text,
  customer_name: text,
  customer_phone: text,
  product_sku_display: text,
  product_name: text,
  pickup_location_name: optText,
  pickup_location_type: optText,
  pickup_location_address: optText,
  followup_reason_label: optText,
});
export type TechVisitDetailsRow = z.infer<typeof DetailsRowSchema>;

const RepRowSchema = z.object({ rep_name: text, work_phone: optText });

const HistoryRowSchema = z.object({
  visit_number: z.number().int().min(1),
  scheduled_start: instant,
  status: text,
  technician_name: text,
  technician_color: text,
  followup_reason_label: optText,
  next_visit_notes: optText,
  summary_text: optText,
  summary_source: optText,
  is_test: z.boolean(),
});

const TechnicianRowSchema = z.object({ id: z.string(), display_name: text, color: text, is_test: z.boolean() });

const ReportRowSchema = z.object({ summary_text: text });
const ReportSummaryRowSchema = z.object({ visit_id: z.string().refine(isUuid), summary_text: text });
const SignatureRowSchema = z.object({ signer_name: text, signed_ack_text: text });

/** A row through its schema, or the read fails ("invalid-row"): never a half-understood value. */
function parsed<T>(schema: z.ZodType<T>, row: unknown): T {
  const result = schema.safeParse(row);
  if (!result.success) throw new TechVisitsQueryError("invalid-row");
  return result.data;
}

/** "HH:MM" in Asia/Jerusalem; the row is refused when the instant is invalid. */
function clock(iso: string): HourMinute {
  const t = jerusalemTime(iso);
  if (!t) throw new TechVisitsQueryError("invalid-row");
  return t;
}

function dayOf(iso: string): IsoDate {
  const d = jerusalemDate(iso);
  if (!d) throw new TechVisitsQueryError("invalid-row");
  return d;
}

/**
 * The warranty as the screens show it (TE-08, D42): "כן", "כן · עד MM/YYYY", "לא", or "" (the
 * screen shows "לא צוין"). The raw invitation text is not returned to a Technician (Migration 3).
 */
export function warrantyText(status: "yes" | "no" | null, until: string | null): string {
  if (status === "no") return "לא";
  if (status !== "yes") return "";
  const m = until ? /^(\d{4})-(\d{2})-\d{2}$/.exec(until) : null;
  return m ? `כן · עד ${m[2]}/${m[1]}` : "כן";
}

/** A technician colour token as CSS (allowlist only); the accent colour for anything else. */
const colorOf = (token: string): string => (isTechnicianColorToken(token) ? technicianColorCss(token) : "var(--accent)");

/** "הרצל 14, רחובות". */
const addressOf = (row: TechVisitRow): string => `${row.street}, ${row.city}`;

/** Everything a page of the technician screens reads about one visit. */
export type TechVisitView =
  | { kind: "open"; id: string; detail: VisitDetail; history: VisitHistoryItem[] }
  | {
      kind: "closed";
      id: string;
      detail: ClosedVisitDetail;
      /**
       * False when the call, customer and product details are no longer served (a visit closed before
       * today, Migration 3 TEMPORARY OQ-10): the view then shows the visit's own rows only.
       */
      detailsAvailable: boolean;
    };

/**
 * One visit of the technician calendar (D85, D89). `request`, `customer` and `product` come from
 * `my_visit_details`, which serves a visit that is open or was closed today only (Migration 3
 * TEMPORARY OQ-10): for a visit closed before today they are "" and the calendar shows the reduced
 * view (address, status, summary; D79 (2)).
 */
export type TechCalendarVisit = {
  id: string;
  isTest: boolean;
  /** Asia/Jerusalem date of scheduled_start. */
  date: IsoDate;
  request: string;
  start: HourMinute;
  end: HourMinute;
  customer: string;
  city: string;
  address: string;
  product: string;
  /** The treatment summary of a closed visit (visit_reports); "" otherwise. */
  summary: string;
  status: VisitStatus;
  isFollowUp: boolean;
};

/** The queries of one Technician's own visits. */
export type TechVisitsQueries = {
  /** His visits scheduled on `date` (Asia/Jerusalem), cancelled excluded, with the home counters. */
  day(date: IsoDate): Promise<TechDay<TechDayVisitWithId>>;
  /** One of his visits by id; null when not found, not his, cancelled or not a uuid. */
  visit(id: string): Promise<TechVisitView | null>;
  /**
   * His visits scheduled from `from` to `to` (Asia/Jerusalem dates, inclusive, at most
   * TECH_CALENDAR_MAX_DAYS days), cancelled excluded, in start order. `today` (the caller's clock)
   * only decides which rows the details are asked for: open ones, and closed ones closed today.
   */
  calendar(from: IsoDate, to: IsoDate, today: IsoDate): Promise<TechCalendarVisit[]>;
};

type Rpc = <T>(fn: string, visitId: string, schema: z.ZodType<T>) => Promise<T[] | null>;

/**
 * The technician queries over a Supabase client under the technician's own session. `viewer` is
 * the session's Technician; nothing here widens what RLS and the narrow functions return.
 */
export function techVisitsQueriesOf(db: SupabaseClient, viewer: TechViewer): TechVisitsQueries {
  /** A narrow function's rows, or null when it refuses this visit (42501: outside its window). */
  const rpc: Rpc = async (fn, visitId, schema) => {
    const { data, error } = await db.rpc(fn, { p_visit_id: visitId });
    if (error) {
      if (error.code === "42501") return null;
      throw new TechVisitsQueryError(error.code);
    }
    if (!Array.isArray(data)) throw new TechVisitsQueryError("invalid-row");
    return data.map((row) => parsed(schema, row));
  };

  const details = async (visitId: string): Promise<TechVisitDetailsRow | null> => (await rpc("my_visit_details", visitId, DetailsRowSchema))?.[0] ?? null;

  async function technician(): Promise<TechnicianRef> {
    const { data, error } = await db
      .from("technicians")
      .select("id, display_name, color, is_test")
      .eq("id", viewer.technicianId)
      .maybeSingle();
    if (error) throw new TechVisitsQueryError(error.code);
    if (!data) return { id: viewer.technicianId, name: viewer.name, color: "var(--accent)", phone: "" };
    const row = parsed(TechnicianRowSchema, data);
    return { id: row.id, name: row.display_name, color: colorOf(row.color), phone: "" };
  }

  function dayVisit(row: TechVisitRow, d: TechVisitDetailsRow | null, status: VisitStatus): TechDayVisitWithId {
    return {
      id: row.id,
      isTest: row.is_test,
      req: d?.request_number ?? "",
      n: row.visit_number,
      task: row.task_number,
      start: clock(row.scheduled_start),
      end: clock(row.scheduled_end),
      status,
      // D47, SIM-14: every source the database accepts today is test data (the simulator or an
      // automated test); "outlook" only for a real Microsoft 365 visit (Step 11).
      source: row.is_test ? "simulator" : "outlook",
      customerName: d?.customer_name ?? "",
      address: addressOf(row),
      city: row.city,
      productName: d?.product_name ?? "",
      isFollowUp: row.visit_number > 1,
      pickup: row.pickup_item
        ? { item: row.pickup_item, place: d?.pickup_location_name ?? PICKUP_PLACE_NOT_GIVEN, placeAddress: d?.pickup_location_address ?? null }
        : null,
    };
  }

  return {
    async day(date) {
      if (!isIsoDate(date)) throw new TechVisitsQueryError("invalid-date");
      const from = atJerusalem(date, "00:00");
      const to = atJerusalem(addDays(date, 1), "00:00");
      const [tech, rows] = await Promise.all([
        technician(),
        db
          .from("visits")
          .select(TECH_VISIT_COLUMNS)
          .eq("technician_id", viewer.technicianId)
          .neq("status", "cancelled")
          .gte("scheduled_start", from)
          .lt("scheduled_start", to)
          .order("scheduled_start", { ascending: true })
          .order("visit_number", { ascending: true })
          .limit(TECH_DAY_LIMIT),
      ]);
      if (rows.error) throw new TechVisitsQueryError(rows.error.code);
      const visits = (rows.data ?? []).map((r) => parsed(VisitRowSchema, r));
      const withDetails = await Promise.all(visits.map(async (row) => ({ row, d: await details(row.id) })));
      const open: TechDayVisitWithId[] = [];
      const closed: TechDayVisitWithId[] = [];
      for (const { row, d } of withDetails) {
        const status = visitStatusOfDb(row.status);
        if (!status) throw new TechVisitsQueryError("invalid-row");
        if (status === "cancel") continue;
        (status === "done" || status === "cont" ? closed : open).push(dayVisit(row, d, status));
      }
      // The featured visit (TE-02): in progress, else en route, else the first scheduled.
      const next = open.find((v) => v.status === "work") ?? open.find((v) => v.status === "go") ?? open[0] ?? null;
      // "מה לאסוף לפני יציאה" (TE-03): the open visits' pickups, grouped by place in visit order.
      const groups = new Map<string, PickupGroup>();
      for (const v of open) {
        if (!v.pickup) continue;
        const group = groups.get(v.pickup.place) ?? { place: v.pickup.place, placeAddress: v.pickup.placeAddress, items: [] };
        group.items.push({ ref: { req: v.req, n: v.n }, item: v.pickup.item, customerName: v.customerName, start: v.start, collected: false });
        groups.set(v.pickup.place, group);
      }
      return {
        technician: tech,
        date,
        open,
        closed,
        next,
        pickups: [...groups.values()],
        stats: { open: open.length, completed: closed.length },
      };
    },

    async visit(id) {
      if (!isUuid(id)) return null;
      const res = await db
        .from("visits")
        .select(TECH_VISIT_COLUMNS)
        .eq("id", id)
        .eq("technician_id", viewer.technicianId)
        .maybeSingle();
      if (res.error) {
        // A malformed id never reaches here (isUuid); anything else fails closed.
        throw new TechVisitsQueryError(res.error.code);
      }
      if (!res.data) return null;
      const row = parsed(VisitRowSchema, res.data);
      const status = visitStatusOfDb(row.status);
      if (!status) throw new TechVisitsQueryError("invalid-row");
      if (status === "cancel") return null;
      const isOpen = status === "new" || status === "go" || status === "work";
      const [tech, d, rep] = await Promise.all([technician(), details(row.id), rpc("visit_rep_contact", row.id, RepRowSchema)]);
      const contact = rep?.[0] ?? null;
      const base = {
        isTest: row.is_test,
        req: d?.request_number ?? "",
        n: row.visit_number,
        task: row.task_number,
        technician: tech,
        date: dayOf(row.scheduled_start),
        start: clock(row.scheduled_start),
        end: clock(row.scheduled_end),
        status,
        source: row.is_test ? ("simulator" as const) : ("outlook" as const),
        followupReason: d?.followup_reason_label ?? null,
        summary: "",
        transcript: "",
        recordingSeconds: 0,
        media: [],
        parts: [],
        nextNote: row.next_visit_notes ?? "",
        signerName: null,
        signedText: null,
        pickup: row.pickup_item
          ? { item: row.pickup_item, place: d?.pickup_location_name ?? PICKUP_PLACE_NOT_GIVEN, placeAddress: d?.pickup_location_address ?? null }
          : null,
        call: {
          // The call's marker: a call, its customer and its product share it (composite foreign
          // keys, D47), so the visit's own marker stands for all of them when the details are not served.
          isTest: d?.is_test ?? row.is_test,
          req: d?.request_number ?? "",
          type: d?.call_type_label ?? "",
          warranty: d ? warrantyText(d.warranty_status, d.warranty_until) : "",
          problem: d?.fault_description ?? "",
          techNote: row.tech_notes ?? "",
          representative: { name: contact?.rep_name ?? "", phone: contact?.work_phone ?? null },
        },
        customer: {
          isTest: d?.is_test ?? row.is_test,
          name: d?.customer_name ?? "",
          number: d?.customer_number ?? "",
          phone: d?.customer_phone ?? "",
          // No second customer phone for Technicians (Migration 3 TEMPORARY OQ-9).
          phone2: "",
          address: { city: row.city, street: row.street, building: row.building ?? "", floor: row.floor ?? "", apt: row.apartment ?? "" },
          arrivalNotes: row.arrival_notes ?? "",
        },
        product: { isTest: d?.is_test ?? row.is_test, sku: d?.product_sku_display ?? "", name: d?.product_name ?? "", brand: "", supplier: "" },
      };
      if (isOpen) {
        const historyRows = (await rpc("previous_visits", row.id, HistoryRowSchema)) ?? [];
        const history: VisitHistoryItem[] = historyRows.flatMap((h) => {
          const hs = visitStatusOfDb(h.status);
          if (hs !== "done" && hs !== "cont") return [];
          return [
            {
              isTest: h.is_test,
              req: base.req,
              n: h.visit_number,
              relation: "call" as const,
              date: dayOf(h.scheduled_start),
              start: clock(h.scheduled_start),
              technician: { id: "", name: h.technician_name, color: colorOf(h.technician_color) },
              status: hs,
              summary: h.summary_text ?? "",
              transcript: "",
              followupReason: h.followup_reason_label,
              nextNote: h.next_visit_notes ?? "",
              parts: [],
              media: [],
              mediaCount: 0,
              recordingSeconds: 0,
              customerName: base.customer.name,
              product: { sku: base.product.sku, name: base.product.name },
            },
          ];
        });
        // No field times for the technician (TE-25, open decision 2).
        const detail: VisitDetail = { ...base, departAt: null, arriveAt: null, endAt: null, editable: true };
        return { kind: "open", id: row.id, detail, history };
      }
      const [report, signature] = await Promise.all([
        db.from("visit_reports").select("summary_text").eq("visit_id", row.id).maybeSingle(),
        db.from("visit_signatures").select("signer_name, signed_ack_text").eq("visit_id", row.id).maybeSingle(),
      ]);
      if (report.error) throw new TechVisitsQueryError(report.error.code);
      if (signature.error) throw new TechVisitsQueryError(signature.error.code);
      const summary = report.data ? parsed(ReportRowSchema, report.data).summary_text : "";
      const signed = signature.data ? parsed(SignatureRowSchema, signature.data) : null;
      const detail: ClosedVisitDetail = {
        ...base,
        summary,
        signerName: signed?.signer_name ?? null,
        signedText: signed?.signed_ack_text ?? null,
        editable: false,
      };
      return { kind: "closed", id: row.id, detail, detailsAvailable: d !== null };
    },

    async calendar(from, to, today) {
      if (!isIsoDate(from) || !isIsoDate(to) || !isIsoDate(today)) throw new TechVisitsQueryError("invalid-date");
      if (to < from || addDays(from, TECH_CALENDAR_MAX_DAYS - 1) < to) throw new TechVisitsQueryError("invalid-range");
      const rows = await db
        .from("visits")
        .select(TECH_VISIT_COLUMNS)
        .eq("technician_id", viewer.technicianId)
        .neq("status", "cancelled")
        .gte("scheduled_start", atJerusalem(from, "00:00"))
        .lt("scheduled_start", atJerusalem(addDays(to, 1), "00:00"))
        .order("scheduled_start", { ascending: true })
        .order("visit_number", { ascending: true })
        .limit(TECH_CALENDAR_LIMIT);
      if (rows.error) throw new TechVisitsQueryError(rows.error.code);
      const visits = (rows.data ?? []).map((r) => {
        const row = parsed(VisitRowSchema, r);
        const status = visitStatusOfDb(row.status);
        if (!status) throw new TechVisitsQueryError("invalid-row");
        return { row, status, date: dayOf(row.scheduled_start) };
      });
      const isClosed = (status: VisitStatus): boolean => status === "done" || status === "cont";
      // The details are served only for an open visit or one closed today (42501 otherwise): ask
      // only for those, and never for an open visit of a past day (not shown, D79 (1)). closed_at
      // carries microseconds (PostgREST), which the strict ISO check refuses: normalise it first.
      const closedDay = (iso: string | null): IsoDate | null => {
        const ms = iso === null ? Number.NaN : Date.parse(iso);
        return Number.isNaN(ms) ? null : jerusalemDate(new Date(ms).toISOString());
      };
      const served = (v: (typeof visits)[number]): boolean => (isClosed(v.status) ? closedDay(v.row.closed_at) === today : v.date >= today);
      const closedIds = visits.filter((v) => isClosed(v.status)).map((v) => v.row.id);
      const [withDetails, reports] = await Promise.all([
        Promise.all(visits.map(async (v) => ({ ...v, d: served(v) ? await details(v.row.id) : null }))),
        closedIds.length
          ? db.from("visit_reports").select("visit_id, summary_text").in("visit_id", closedIds).limit(TECH_CALENDAR_LIMIT)
          : Promise.resolve({ data: [] as unknown[], error: null }),
      ]);
      if (reports.error) throw new TechVisitsQueryError(reports.error.code);
      const summaries = new Map(
        (reports.data ?? []).map((r) => {
          const row = parsed(ReportSummaryRowSchema, r);
          return [row.visit_id, row.summary_text] as const;
        }),
      );
      return withDetails.flatMap(({ row, status, date, d }): TechCalendarVisit[] =>
        status === "cancel"
          ? []
          : [
              {
                id: row.id,
                isTest: row.is_test,
                date,
                request: d?.request_number ?? "",
                start: clock(row.scheduled_start),
                end: clock(row.scheduled_end),
                customer: d?.customer_name ?? "",
                city: row.city,
                address: addressOf(row),
                product: d?.product_name ?? "",
                summary: summaries.get(row.id) ?? "",
                status,
                isFollowUp: row.visit_number > 1,
              },
            ],
      );
    },
  };
}
