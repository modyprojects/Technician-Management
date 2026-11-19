// The office call card ("כרטיס קריאה"; D60 (5), D68, D74, D88) over a Supabase client under the
// CALLER'S OWN SESSION: RLS decides what is read (Migrations 1–3, 7): the call, its visits, the
// customer, the product and the customer's other calls need `cal` or `calls`; the field times
// (visit_time_current, a SECURITY INVOKER view over visit_time_reports) need `cal` or `calls`, with
// no Technician policy (D68: office only); the technician's report (summary, signature, media)
// also needs `card`; a technician's work phone is readable to the Creator and the Manager only
// (profiles policies), so for Customer Service it is absent and "התקשר לטכנאי" is not shown.
// No secret key and no environment here: lib/data/supabase/calls.ts wires it per request.
// Bounded: one call by its unique request number; its visits (≤ VISITS_MAX), their times, reports,
// signatures and media (≤ ROWS_MAX each), and the customer's newest OTHER_CALLS_MAX other calls.
// D60 (1): a cancelled visit is never shown. Every row is validated; a failed read throws
// CallsQueryError (a code only) and the page fails closed. Not found and not readable are the same
// null (the page answers 404 for both).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CallDetailData, CustomerCallRow } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import type { SessionUser } from "@/features/auth/data/types";
import { officeCallPath } from "@/features/auth/landing";
import { visitDurationsOf } from "@/features/calls/data/visit-durations";
import { instantOf } from "@/features/calendar/supabase/intake-queries";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import { isUuid } from "@/features/data-access/common";
import { isTechnicianColorToken, technicianColorCss } from "@/features/reference/data/types";
import { CALL_STATUS_OF_DB, CallsQueryError, readsCalls, VISIT_STATUS_OF_DB } from "./list-queries";

/** Visits of one call read at most (the database allows 999). */
export const VISITS_MAX = 100;
/** Child rows (times, reports, signatures, media, names) read at most per card. */
const ROWS_MAX = 1000;
/** The customer's other calls shown, newest first. */
export const OTHER_CALLS_MAX = 20;

const REQ = /^[A-Za-z0-9-]{1,32}$/;
export const isRequestNumber = (req: string): boolean => REQ.test(req);

const short = (max: number) => z.string().max(max);
const optional = (max: number) => z.string().max(max).nullable();
const named = z.object({ name: short(200) }).nullable();

const visitSchema = z.object({
  id: z.string().refine(isUuid),
  visit_number: z.number().int().min(1).max(999),
  task_number: short(40),
  status: z.enum(["scheduled", "en_route", "in_progress", "done", "followup", "cancelled"]),
  scheduled_start: short(64),
  scheduled_end: short(64),
  city: short(60),
  street: short(120),
  building: optional(20),
  floor: optional(20),
  apartment: optional(20),
  arrival_notes: optional(1000),
  tech_notes: optional(1000),
  pickup_item: optional(120),
  pickup_location_id: z.string().refine(isUuid).nullable(),
  followup_reason_id: z.string().refine(isUuid).nullable(),
  next_visit_notes: optional(1000),
  technician_id: z.string().refine(isUuid),
  is_test: z.boolean(),
});
type VisitRow = z.infer<typeof visitSchema>;

export const CALL_CARD_COLUMNS =
  "id, request_number, status, is_test, fault_description, warranty_status, warranty_until, handling_rep_name, customer_id, " +
  "call_types(label_he), customers(name, customer_number, phone, phone_alt, is_test), " +
  "products(name, sku_display, is_test, brands(name), suppliers(name)), " +
  "visits(id, visit_number, task_number, status, scheduled_start, scheduled_end, city, street, building, floor, apartment, " +
  "arrival_notes, tech_notes, pickup_item, pickup_location_id, followup_reason_id, next_visit_notes, technician_id, is_test)";

export const callCardRowSchema = z.object({
  id: z.string().refine(isUuid),
  request_number: z.string().regex(REQ),
  status: z.enum(["open", "awaiting_scheduling", "awaiting_followup", "resolved"]),
  is_test: z.boolean(),
  fault_description: short(1000),
  warranty_status: z.enum(["yes", "no"]).nullable(),
  warranty_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  handling_rep_name: short(60),
  customer_id: z.string().refine(isUuid),
  call_types: z.object({ label_he: short(60) }).nullable(),
  customers: z.object({ name: short(200), customer_number: short(64), phone: short(120), phone_alt: optional(120), is_test: z.boolean() }),
  products: z.object({ name: short(200), sku_display: short(64), is_test: z.boolean(), brands: named, suppliers: named }),
  visits: z.array(visitSchema).max(VISITS_MAX),
});
export type CallCardRow = z.infer<typeof callCardRowSchema>;

const timeRowSchema = z.object({ visit_id: z.string().refine(isUuid), kind: z.enum(["departed", "arrived", "ended", "signed"]), reported_at: z.string().max(64).nullable() });
const reportRowSchema = z.object({ visit_id: z.string().refine(isUuid), summary_text: short(4000) });
const signatureRowSchema = z.object({ visit_id: z.string().refine(isUuid), signer_name: short(100), signed_ack_text: short(2000) });
const mediaRowSchema = z.object({ visit_id: z.string().refine(isUuid), kind: z.enum(["photo", "signature"]), phase: z.enum(["before", "after"]).nullable(), state: z.enum(["pending", "stored"]) });
const techRowSchema = z.object({ id: z.string().refine(isUuid), display_name: short(200), color: short(32), profile_id: z.string().refine(isUuid) });
const otherCallSchema = z.object({
  request_number: z.string().regex(REQ),
  status: z.enum(["open", "awaiting_scheduling", "awaiting_followup", "resolved"]),
  opened_at: short(64),
  products: z.object({ name: short(200) }).nullable(),
});

/** What the call card reads besides the call row (each keyed by visit id or row id). */
export type CallCardExtras = {
  times: z.infer<typeof timeRowSchema>[];
  reports: z.infer<typeof reportRowSchema>[];
  signatures: z.infer<typeof signatureRowSchema>[];
  media: z.infer<typeof mediaRowSchema>[];
  technicians: z.infer<typeof techRowSchema>[];
  /** profile id → work phone (absent where the caller may not read the profile). */
  phones: ReadonlyMap<string, string>;
  reasons: ReadonlyMap<string, string>;
  places: ReadonlyMap<string, string>;
  otherCalls: z.infer<typeof otherCallSchema>[];
  /** Today's date in Asia/Jerusalem ("2026-11-19"), for the date labels. */
  today: string;
};

export type CallCard = CallDetailData & {
  /** The newest shown visit's technician, for "התקשר לטכנאי" (phone "" when not readable). */
  technician: { name: string; phone: string } | null;
};

/** "כן · עד MM/YYYY" (D60 (5)); "כן", "לא", or "לא צוין" when the invitation had none. */
export function warrantyLabel(status: "yes" | "no" | null, until: string | null): string {
  if (status === "yes") return until ? `כן · עד ${until.slice(5, 7)}/${until.slice(0, 4)}` : "כן";
  if (status === "no") return "לא";
  return "לא צוין";
}

/** "היום", or "19.11" (with the year when it is not this year's). */
export function dateLabelOf(iso: string | null, today: string): string {
  const d = jerusalemDate(iso);
  if (!d) return "—";
  if (d === today) return "היום";
  const label = `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return d.slice(0, 4) === today.slice(0, 4) ? label : `${label}.${d.slice(2, 4)}`;
}

/**
 * Whether the card shows test data (D74): the call, its customer, its product or any shown visit.
 * One predicate drives both the top banner and the single quiet "בדיקה" by the title.
 */
export function callShowsTestData(row: Pick<CallCardRow, "is_test" | "customers" | "products" | "visits">): boolean {
  return row.is_test || row.customers.is_test || row.products.is_test || row.visits.some((v) => v.status !== "cancelled" && v.is_test);
}

/** The call row and its extras → the card (D60 (1): cancelled visits are left out). */
export function callCardOfRows(row: CallCardRow, x: CallCardExtras): CallCard {
  const shown = [...row.visits].filter((v) => v.status !== "cancelled").sort((a, b) => a.visit_number - b.visit_number);
  const latest: VisitRow | null = shown.at(-1) ?? null;
  const techs = new Map(x.technicians.map((t) => [t.id, t]));
  const timeOf = (visitId: string, kind: "departed" | "arrived" | "ended") =>
    instantOf(x.times.find((t) => t.visit_id === visitId && t.kind === kind)?.reported_at ?? null);

  const visits: TimelineVisit[] = shown.map((v) => {
    const t = techs.get(v.technician_id);
    const departedAt = timeOf(v.id, "departed");
    const arrivedAt = timeOf(v.id, "arrived");
    const endedAt = timeOf(v.id, "ended");
    const d = visitDurationsOf({ departedAt, arrivedAt, endedAt });
    const report = x.reports.find((r) => r.visit_id === v.id);
    const signature = x.signatures.find((s) => s.visit_id === v.id);
    const status = VISIT_STATUS_OF_DB[v.status];
    const start = instantOf(v.scheduled_start);
    return {
      n: v.visit_number,
      task: v.task_number,
      status,
      dateLabel: dateLabelOf(start, x.today),
      start: jerusalemTime(start) ?? "",
      end: jerusalemTime(instantOf(v.scheduled_end)) ?? "",
      tech: {
        name: t?.display_name ?? "—",
        color: t && isTechnicianColorToken(t.color) ? technicianColorCss(t.color) : "var(--muted)",
      },
      source: v.is_test ? "simulator" : "outlook",
      departAt: jerusalemTime(departedAt),
      arriveAt: jerusalemTime(arrivedAt),
      endAt: jerusalemTime(endedAt),
      treatMin: d.treatMin,
      travelMin: d.travelMin,
      totalMin: d.totalMin,
      reason: v.status === "followup" && v.followup_reason_id ? (x.reasons.get(v.followup_reason_id) ?? null) : null,
      summary: report?.summary_text ?? "",
      // Version 1 has no recording, transcription or parts list (open decisions 3, 11).
      transcript: "",
      recLabel: null,
      media: x.media
        .filter((m) => m.visit_id === v.id && m.kind === "photo" && m.state === "stored")
        .map((m) => ({ kind: "img" as const, when: m.phase ?? "after" })),
      mediaIsTest: v.is_test,
      parts: [],
      nextNote: v.status === "followup" ? (v.next_visit_notes ?? "") : "",
      signer: signature?.signer_name ?? null,
      signedText: signature?.signed_ack_text ?? null,
      // The pickup item is for a visit still to come.
      collect: v.status === "scheduled" || v.status === "en_route" ? (v.pickup_item ?? "") : "",
      collectFrom: v.pickup_location_id ? (x.places.get(v.pickup_location_id) ?? "") : "",
    };
  });

  const latestTech = latest ? techs.get(latest.technician_id) : undefined;
  const customerCalls: CustomerCallRow[] = x.otherCalls
    .filter((c) => c.request_number !== row.request_number)
    .map((c) => ({
      req: c.request_number,
      href: officeCallPath(c.request_number),
      product: c.products?.name ?? "—",
      when: dateLabelOf(instantOf(c.opened_at), x.today),
      status: CALL_STATUS_OF_DB[c.status],
    }));

  return {
    req: row.request_number,
    status: CALL_STATUS_OF_DB[row.status],
    isTest: callShowsTestData(row),
    type: row.call_types?.label_he ?? "לא הוזן",
    warranty: warrantyLabel(row.warranty_status, row.warranty_until),
    customer: {
      name: row.customers.name,
      number: row.customers.customer_number,
      phone: row.customers.phone,
      phone2: row.customers.phone_alt ?? "",
      // The address is per visit (D39): the newest shown visit's.
      address: latest ? `${latest.street}, ${latest.city}` : "—",
      building: latest?.building ?? "",
      floor: latest?.floor ?? "",
      apt: latest?.apartment ?? "",
      arrival: latest?.arrival_notes ?? "",
      rep: row.handling_rep_name,
      isTest: row.customers.is_test,
    },
    product: {
      sku: row.products.sku_display,
      name: row.products.name,
      brand: row.products.brands?.name ?? "",
      supplier: row.products.suppliers?.name ?? "",
      isTest: row.products.is_test,
    },
    desc: row.fault_description,
    techNote: latest?.tech_notes ?? "",
    visits,
    customerCalls,
    technician: latestTech ? { name: latestTech.display_name, phone: x.phones.get(latestTech.profile_id) ?? "" } : null,
  };
}

function parsed<T>(schema: z.ZodType<T>, result: { data: unknown; error: { code?: string } | null }): T[] {
  if (result.error) throw new CallsQueryError(result.error.code);
  const p = z.array(schema).max(ROWS_MAX).safeParse(result.data ?? []);
  if (!p.success) throw new CallsQueryError("invalid-row");
  return p.data;
}

/**
 * One call's card by its request number, for `viewer` (from the server-validated session), under
 * `db`'s session; null when it does not exist or the caller may not read it (the same 404).
 */
export async function callCardOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null, req: string, now = new Date()): Promise<CallCard | null> {
  if (!readsCalls(viewer) || !isRequestNumber(req)) return null;
  const call = await db.from("service_calls").select(CALL_CARD_COLUMNS).eq("request_number", req)
    // Deterministic cap: the newest VISITS_MAX visits by number (the card re-sorts them).
    .order("visit_number", { ascending: false, referencedTable: "visits" })
    .limit(VISITS_MAX, { referencedTable: "visits" })
    .maybeSingle();
  if (call.error) throw new CallsQueryError(call.error.code);
  if (call.data === null) return null;
  const row = callCardRowSchema.safeParse(call.data);
  if (!row.success) throw new CallsQueryError("invalid-row");
  const r = row.data;
  const visitIds = r.visits.map((v) => v.id);
  const techIds = [...new Set(r.visits.map((v) => v.technician_id))];
  const none = Promise.resolve({ data: [], error: null });

  const [times, reports, signatures, media, technicians, reasons, places, others] = await Promise.all([
    visitIds.length ? db.from("visit_time_current").select("visit_id, kind, reported_at").in("visit_id", visitIds).limit(ROWS_MAX) : none,
    visitIds.length ? db.from("visit_reports").select("visit_id, summary_text").in("visit_id", visitIds).limit(ROWS_MAX) : none,
    visitIds.length ? db.from("visit_signatures").select("visit_id, signer_name, signed_ack_text").in("visit_id", visitIds).limit(ROWS_MAX) : none,
    visitIds.length ? db.from("visit_media").select("visit_id, kind, phase, state").in("visit_id", visitIds).limit(ROWS_MAX) : none,
    techIds.length ? db.from("technicians").select("id, display_name, color, profile_id").in("id", techIds).limit(ROWS_MAX) : none,
    db.from("followup_reasons").select("id, label_he").limit(ROWS_MAX),
    db.from("collection_locations").select("id, name").limit(ROWS_MAX),
    db
      .from("service_calls")
      .select("request_number, status, opened_at, products(name)")
      .eq("customer_id", r.customer_id)
      .neq("id", r.id)
      .order("opened_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(OTHER_CALLS_MAX),
  ]);
  const techRows = parsed(techRowSchema, technicians);
  const profileIds = techRows.map((t) => t.profile_id);
  // Work phones: RLS returns only the profiles the caller may read (Creator, Manager).
  const phones = profileIds.length ? await db.from("profiles").select("id, work_phone").in("id", profileIds).limit(ROWS_MAX) : { data: [], error: null };
  const phoneRows = parsed(z.object({ id: z.string().refine(isUuid), work_phone: optional(120) }), phones);
  const reasonRows = parsed(z.object({ id: z.string().refine(isUuid), label_he: short(200) }), reasons);
  const placeRows = parsed(z.object({ id: z.string().refine(isUuid), name: short(200) }), places);

  return callCardOfRows(r, {
    times: parsed(timeRowSchema, times),
    reports: parsed(reportRowSchema, reports),
    signatures: parsed(signatureRowSchema, signatures),
    media: parsed(mediaRowSchema, media),
    technicians: techRows,
    phones: new Map(phoneRows.filter((p) => p.work_phone).map((p) => [p.id, p.work_phone!])),
    reasons: new Map(reasonRows.map((x) => [x.id, x.label_he])),
    places: new Map(placeRows.map((x) => [x.id, x.name])),
    otherCalls: parsed(otherCallSchema, others),
    today: jerusalemDate(now.toISOString()) ?? "",
  });
}

/** Whether the caller's role has the matrix key `card` (the technician's report; D33). */
export async function cardPermittedOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null): Promise<boolean> {
  if (!readsCalls(viewer)) return false;
  const { data, error } = await db.rpc("has_permission", { p_key: "card" });
  if (error) throw new CallsQueryError(error.code);
  return data === true;
}
