// The real calls list ("קריאות"; V1 item 4; QA S-03, X-01, X-02; D38, D60 (1), (3)) over a Supabase
// client under the CALLER'S OWN SESSION: RLS decides which service calls, visits, customers,
// products, technicians and reasons the caller reads (Migrations 1–3: `cal` or `calls`); this module
// only narrows and shapes. No secret key and no environment here: lib/data/supabase/calls.ts wires it
// per request, and the tests run the same mapping.
// Bounded (docs/security.md §9, query bounds): one request reads the newest CALLS_WINDOW calls by
// opening time (the status filter applied by the database), and they are searched, filtered by the
// latest visit's technician, sorted by the latest visit (newest first, as the demo) and paged here,
// because one PostgREST request cannot search across a call's customer, product and visits without a
// database function (no migration in this step). When more calls match the status filter than the
// window holds, the page says so (`capped`). The chip counts are exact (one count per status).
// D60 (1): a cancelled visit is never shown: it is left out of the visit count and of "ביקור אחרון /
// הבא"; a call whose every visit was cancelled shows none (its own status, D38, says "ממתינה לשיבוץ").
// Every row is validated before it is used; a failed or unreadable read throws CallsQueryError (a
// code only, never the database's text) and the page fails closed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SessionUser } from "@/features/auth/data/types";
import type { CallFilter, CallListItem, CallsListPage, CallStatus } from "@/features/calls/data/types";
import { normalizeCallFilter } from "@/features/calls/data/validate";
import { instantOf } from "@/features/calendar/supabase/intake-queries";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import { isUuid, pageOf } from "@/features/data-access/common";
import { isTechnicianColorToken, technicianColorCss, type TechnicianRef } from "@/features/reference/data/types";
import type { VisitStatus } from "@/features/visits/data/types";

/** A failed read: `code` is the PostgREST or SQLSTATE code (or "invalid-row"), never a message. */
export class CallsQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    const safe = typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
    super(`calls query failed (${safe})`);
    this.name = "CallsQueryError";
    this.code = safe;
  }
}

/** The newest calls one list request reads (PostgREST's default row limit). */
export const CALLS_WINDOW = 1000;

/** Technicians and reasons read for the names on a page (bounded). */
const NAMES_MAX = 500;

/** The office roles that read the calls list (never a Technician; the database decides the rows). */
export const readsCalls = (viewer: Pick<SessionUser, "role"> | null | undefined): boolean =>
  viewer?.role === "creator" || viewer?.role === "mgr" || viewer?.role === "cs";

/** `service_calls.status` (Migration 3) ↔ the UI's call status (D38, OF-17). */
export const CALL_STATUS_OF_DB = {
  open: "open",
  awaiting_scheduling: "awaiting",
  awaiting_followup: "followup",
  resolved: "resolved",
} as const satisfies Record<string, CallStatus>;
export const DB_CALL_STATUS = {
  open: "open",
  awaiting: "awaiting_scheduling",
  followup: "awaiting_followup",
  resolved: "resolved",
} as const satisfies Record<CallStatus, keyof typeof CALL_STATUS_OF_DB>;

/** `visits.status` (Migration 3, DEV-3) ↔ the UI's visit status. */
export const VISIT_STATUS_OF_DB = {
  scheduled: "new",
  en_route: "go",
  in_progress: "work",
  done: "done",
  followup: "cont",
  cancelled: "cancel",
} as const satisfies Record<string, VisitStatus>;

/** The columns of one list row: the call, its customer, product (brand, supplier) and visits. */
export const CALL_LIST_COLUMNS =
  "id, request_number, status, opened_at, handling_rep_name, is_test, " +
  "customers(name, customer_number, phone, is_test), " +
  "products(name, sku_normalized, is_test, brands(name), suppliers(name)), " +
  "visits(visit_number, status, scheduled_start, scheduled_end, city, technician_id, followup_reason_id, is_test)";

const visitSchema = z.object({
  visit_number: z.number().int().min(1).max(999),
  status: z.enum(["scheduled", "en_route", "in_progress", "done", "followup", "cancelled"]),
  scheduled_start: z.string().max(64),
  scheduled_end: z.string().max(64),
  city: z.string().max(200),
  technician_id: z.string().refine(isUuid),
  followup_reason_id: z.string().refine(isUuid).nullable(),
  is_test: z.boolean(),
});
const named = z.object({ name: z.string().max(200) }).nullable();
export const callRowSchema = z.object({
  id: z.string().refine(isUuid),
  request_number: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  status: z.enum(["open", "awaiting_scheduling", "awaiting_followup", "resolved"]),
  opened_at: z.string().max(64),
  handling_rep_name: z.string().max(200),
  is_test: z.boolean(),
  customers: z.object({ name: z.string().max(200), customer_number: z.string().max(64), phone: z.string().max(40), is_test: z.boolean() }),
  products: z.object({ name: z.string().max(200), sku_normalized: z.string().max(64), is_test: z.boolean(), brands: named, suppliers: named }),
  visits: z.array(visitSchema).max(999),
});
export type CallRow = z.infer<typeof callRowSchema>;

type TechnicianRow = { id: string; display_name: string; color: string };

/** A technician's name and colour for a list row (colour only from the allowlist, never stored CSS). */
function technicianRef(id: string, techs: ReadonlyMap<string, TechnicianRow>): TechnicianRef {
  const t = techs.get(id);
  return {
    id,
    name: t?.display_name ?? "—",
    color: t && isTechnicianColorToken(t.color) ? technicianColorCss(t.color) : "var(--muted)",
    phone: "",
  };
}

/** A row as the list shows it, with the latest visit's start for sorting. */
export type ListedCall = CallListItem & { sortKey: number };

/** One call row → the list's row (D60 (1): cancelled visits are not shown). */
export function callSummaryOf(row: CallRow, techs: ReadonlyMap<string, TechnicianRow>, reasons: ReadonlyMap<string, string>): ListedCall {
  const byNumber = [...row.visits].sort((a, b) => a.visit_number - b.visit_number);
  const shown = byNumber.filter((v) => v.status !== "cancelled");
  const latest = shown.at(-1) ?? null;
  const status: CallStatus = CALL_STATUS_OF_DB[row.status];
  const lastFollowup = [...shown].reverse().find((v) => v.status === "followup") ?? null;
  const start = latest ? instantOf(latest.scheduled_start) : null;
  const opened = instantOf(row.opened_at);
  return {
    req: row.request_number,
    // Microsoft 365 is not connected (D23): every call today comes from a test source (D24, D47).
    source: row.is_test ? "simulator" : "outlook",
    customer: {
      name: row.customers.name,
      number: row.customers.customer_number,
      phone: row.customers.phone,
      isTest: row.customers.is_test,
      // The address is per visit (D39): the shown visit's city, else the newest visit's.
      city: latest?.city ?? byNumber.at(-1)?.city ?? "",
    },
    product: {
      sku: row.products.sku_normalized,
      name: row.products.name,
      brand: row.products.brands?.name ?? "",
      supplier: row.products.suppliers?.name ?? "",
      isTest: row.products.is_test,
    },
    status,
    followupReason: status === "followup" && lastFollowup?.followup_reason_id ? (reasons.get(lastFollowup.followup_reason_id) ?? null) : null,
    visitCount: shown.length,
    latestVisit: latest
      ? {
          n: latest.visit_number,
          date: jerusalemDate(start) ?? "",
          start: jerusalemTime(start) ?? "",
          end: jerusalemTime(instantOf(latest.scheduled_end)) ?? "",
          status: VISIT_STATUS_OF_DB[latest.status],
          source: latest.is_test ? "simulator" : "outlook",
          technician: technicianRef(latest.technician_id, techs),
        }
      : null,
    representative: row.handling_rep_name,
    isTest: row.is_test,
    sortKey: (start ? Date.parse(start) : null) ?? (opened ? Date.parse(opened) : 0),
  };
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * The demo's search (request number, customer number and name, phone, SKU, product name, city; a
 * query of digits, spaces and dashes also matches the phone's digits), case-blind.
 */
export function callMatches(call: CallListItem, q: string): boolean {
  const query = q.toUpperCase();
  if (!query) return true;
  const fields = [call.req, call.customer.number, call.customer.name, call.customer.phone, call.product.sku, call.product.name, call.customer.city];
  if (fields.some((x) => x.toUpperCase().includes(query))) return true;
  const digits = digitsOf(query);
  return /^[\d\s-]+$/.test(query) && digits.length >= 3 && digitsOf(call.customer.phone).includes(digits);
}

/** Search, the latest visit's technician, newest first, one page (the window is already read). */
export function listPageOf(rows: readonly ListedCall[], filter: CallFilter): { items: CallListItem[]; total: number; page: number; limit: number; pageCount: number } {
  const f = normalizeCallFilter(filter);
  const matches = rows
    .filter((c) => (f.statuses.length === 0 || f.statuses.includes(c.status)))
    .filter((c) => !f.technicianId || c.latestVisit?.technician.id === f.technicianId)
    .filter((c) => !f.from || (c.latestVisit !== null && c.latestVisit.date >= f.from))
    .filter((c) => !f.to || (c.latestVisit !== null && c.latestVisit.date <= f.to))
    .filter((c) => callMatches(c, f.q))
    .sort((a, b) => b.sortKey - a.sortKey || (a.req < b.req ? 1 : a.req > b.req ? -1 : 0));
  const page = pageOf(matches, f.page, f.limit);
  return { ...page, items: page.items.map(withoutSortKey) };
}

function withoutSortKey(row: ListedCall): CallListItem {
  const call: CallListItem & { sortKey?: number } = { ...row };
  delete call.sortKey;
  return call;
}

const EMPTY_COUNTS: Record<CallStatus, number> = { open: 0, awaiting: 0, followup: 0, resolved: 0 };

/** The real calls list for `viewer` (from the server-validated session), under `db`'s session. */
export function callsListQueriesOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null) {
  return {
    async list(filter: CallFilter): Promise<CallsListPage> {
      const f = normalizeCallFilter(filter);
      if (!readsCalls(viewer)) return { items: [], total: 0, page: 1, limit: f.limit, pageCount: 1, statusCounts: { ...EMPTY_COUNTS }, allCount: 0 };

      // The chip counts over every call the viewer may see (not narrowed by the filter, as the demo).
      const statuses = Object.keys(DB_CALL_STATUS) as CallStatus[];
      const counts = await Promise.all(
        statuses.map((s) => db.from("service_calls").select("id", { count: "exact", head: true }).eq("status", DB_CALL_STATUS[s])),
      );
      const statusCounts = { ...EMPTY_COUNTS };
      for (const [i, s] of statuses.entries()) {
        const c = counts[i]!;
        if (c.error) throw new CallsQueryError(c.error.code);
        statusCounts[s] = c.count ?? 0;
      }
      const allCount = statuses.reduce((sum, s) => sum + statusCounts[s], 0);

      let query = db
        .from("service_calls")
        .select(CALL_LIST_COLUMNS, { count: "exact" })
        .order("opened_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CALLS_WINDOW);
      if (f.statuses.length > 0) query = query.in("status", f.statuses.map((s) => DB_CALL_STATUS[s]));
      const [calls, techs, reasons] = await Promise.all([
        query,
        db.from("technicians").select("id, display_name, color").limit(NAMES_MAX),
        db.from("followup_reasons").select("id, label_he").limit(NAMES_MAX),
      ]);
      if (calls.error) throw new CallsQueryError(calls.error.code);
      if (techs.error) throw new CallsQueryError(techs.error.code);
      if (reasons.error) throw new CallsQueryError(reasons.error.code);
      const parsed = z.array(callRowSchema).max(CALLS_WINDOW).safeParse(calls.data ?? []);
      if (!parsed.success) throw new CallsQueryError("invalid-row");

      const techMap = new Map(((techs.data ?? []) as TechnicianRow[]).map((t) => [t.id, t]));
      const reasonMap = new Map(((reasons.data ?? []) as { id: string; label_he: string }[]).map((r) => [r.id, r.label_he]));
      const rows = parsed.data.map((r) => callSummaryOf(r, techMap, reasonMap));
      const page = listPageOf(rows, f);
      return { ...page, statusCounts, allCount, capped: (calls.count ?? 0) > CALLS_WINDOW };
    },
  };
}

/** The technicians of the list's filter (every technician the viewer reads, by name; bounded). */
export async function technicianOptionsOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null): Promise<{ id: string; name: string }[]> {
  if (!readsCalls(viewer)) return [];
  const { data, error } = await db.from("technicians").select("id, display_name").order("display_name").limit(NAMES_MAX);
  if (error) throw new CallsQueryError(error.code);
  return ((data ?? []) as { id: string; display_name: string }[]).filter((t) => isUuid(t.id)).map((t) => ({ id: t.id, name: t.display_name }));
}

/** Whether the caller's role is offered the calls list (matrix key `calls`, D33; the Creator always). */
export async function callsPermittedOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null): Promise<boolean> {
  if (!readsCalls(viewer)) return false;
  const { data, error } = await db.rpc("has_permission", { p_key: "calls" });
  if (error) throw new CallsQueryError(error.code);
  return data === true;
}

/** What the temporary call-card page shows: the call's number, customer, status and test marker. */
export type CallCardBrief = { req: string; customer: string; status: CallStatus; isTest: boolean };

/** One call by its request number, or null when it does not exist or the caller may not read it. */
export async function callCardBriefOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null, req: string): Promise<CallCardBrief | null> {
  if (!readsCalls(viewer) || !/^[A-Za-z0-9-]{1,32}$/.test(req)) return null;
  const { data, error } = await db.from("service_calls").select("request_number, status, is_test, customers(name)").eq("request_number", req).maybeSingle();
  if (error) throw new CallsQueryError(error.code);
  const parsed = z
    .object({
      request_number: z.string(),
      status: z.enum(["open", "awaiting_scheduling", "awaiting_followup", "resolved"]),
      is_test: z.boolean(),
      customers: z.object({ name: z.string().max(200) }),
    })
    .nullable()
    .safeParse(data);
  if (!parsed.success) throw new CallsQueryError("invalid-row");
  const d = parsed.data;
  return d ? { req: d.request_number, customer: d.customers.name, status: CALL_STATUS_OF_DB[d.status], isTest: d.is_test } : null;
}
