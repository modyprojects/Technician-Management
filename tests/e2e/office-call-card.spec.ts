import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { minutesLabel, visitDurationsOf, wholeMinutesBetween } from "@/features/calls/data/visit-durations";
import {
  callCardOfRows,
  callCardRowSchema,
  dateLabelOf,
  isRequestNumber,
  warrantyLabel,
  type CallCardExtras,
  type CallCardRow,
} from "@/features/calls/supabase/card-queries";
import { onlyInProject } from "./helpers";

// The office call card on real data (D60 (5), D68, D88): the pure duration derivation, the row
// mapping of the Supabase adapter, and source checks of the page's server-side guards. The screen
// itself is tested against the local stack (tests/auth/office-call-card.spec.ts).

test.describe("visit durations (D60 (5): only from recorded instants)", () => {
  onlyInProject("desktop");

  test("travel, treatment and total in whole minutes", () => {
    expect(
      visitDurationsOf({ departedAt: "2026-11-19T08:40:00+02:00", arrivedAt: "2026-11-19T09:10:30+02:00", endedAt: "2026-11-19T09:55:00+02:00" }),
    ).toEqual({ travelMin: 30, treatMin: 44, totalMin: 75 });
  });

  test("missing times give null for every duration that needs them, never an invented value", () => {
    expect(visitDurationsOf({ departedAt: null, arrivedAt: null, endedAt: null })).toEqual({ travelMin: null, treatMin: null, totalMin: null });
    expect(visitDurationsOf({ departedAt: "2026-11-19T08:40:00Z", arrivedAt: null, endedAt: "2026-11-19T09:40:00Z" })).toEqual({
      travelMin: null,
      treatMin: null,
      totalMin: 60,
    });
    expect(visitDurationsOf({ departedAt: null, arrivedAt: "2026-11-19T08:40:00Z", endedAt: "2026-11-19T09:00:00Z" })).toEqual({
      travelMin: null,
      treatMin: 20,
      totalMin: null,
    });
    // Not an instant (a bare clock time or garbage) counts as missing.
    expect(wholeMinutesBetween("08:40", "09:10")).toBeNull();
    expect(wholeMinutesBetween("2026-11-19T08:40:00", "2026-11-19T09:10:00")).toBeNull();
    expect(wholeMinutesBetween("x", "2026-11-19T09:10:00Z")).toBeNull();
  });

  test("a visit across midnight is measured from the instants", () => {
    expect(
      visitDurationsOf({ departedAt: "2026-11-19T23:30:00+02:00", arrivedAt: "2026-11-20T00:10:00+02:00", endedAt: "2026-11-20T01:15:00+02:00" }),
    ).toEqual({ travelMin: 40, treatMin: 65, totalMin: 105 });
    // Different offsets of the same instants.
    expect(wholeMinutesBetween("2026-11-19T21:30:00Z", "2026-11-20T00:10:00+02:00")).toBe(40);
  });

  test("an end before its start (wrong order) is not shown", () => {
    expect(
      visitDurationsOf({ departedAt: "2026-11-19T09:10:00Z", arrivedAt: "2026-11-19T08:40:00Z", endedAt: "2026-11-19T09:55:00Z" }),
    ).toEqual({ travelMin: null, treatMin: 75, totalMin: 45 });
    expect(wholeMinutesBetween("2026-11-19T09:00:00Z", "2026-11-19T09:00:00Z")).toBe(0);
    expect(wholeMinutesBetween("2026-11-19T09:00:00Z", "2026-11-19T09:00:59Z")).toBe(0);
  });

  test("labels: minutes under an hour, hours and minutes from 60", () => {
    expect(minutesLabel(0)).toBe("0 דק׳");
    expect(minutesLabel(45)).toBe("45 דק׳");
    expect(minutesLabel(60)).toBe("1:00 שע׳");
    expect(minutesLabel(105)).toBe("1:45 שע׳");
  });
});

const CALL = "00000000-0000-4000-8000-0000000000c1";
const CUSTOMER = "00000000-0000-4000-8000-0000000000d1";
const V1 = "00000000-0000-4000-8000-0000000000e1";
const V2 = "00000000-0000-4000-8000-0000000000e2";
const V3 = "00000000-0000-4000-8000-0000000000e3";
const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const P1 = "00000000-0000-4000-8000-0000000000f1";
const P2 = "00000000-0000-4000-8000-0000000000f2";
const R1 = "00000000-0000-4000-8000-0000000000b1";
const L1 = "00000000-0000-4000-8000-0000000000b2";

const visit = (id: string, n: number, status: CallCardRow["visits"][number]["status"], tech: string, day: string) => ({
  id,
  visit_number: n,
  task_number: String(n),
  status,
  scheduled_start: `2026-11-${day}T07:00:00+00:00`,
  scheduled_end: `2026-11-${day}T08:30:00+00:00`,
  city: "רחובות",
  street: `הרצל ${n}`,
  building: n === 2 ? "2" : null,
  floor: null,
  apartment: null,
  arrival_notes: n === 2 ? "לצלצל" : null,
  tech_notes: null,
  pickup_item: "אטם",
  pickup_location_id: L1,
  followup_reason_id: status === "followup" ? R1 : null,
  next_visit_notes: status === "followup" ? "להביא אטם" : null,
  technician_id: tech,
  is_test: true,
});

const row: CallCardRow = callCardRowSchema.parse({
  id: CALL,
  request_number: "73001",
  status: "awaiting_followup",
  is_test: true,
  fault_description: "נזילה",
  warranty_status: "yes",
  warranty_until: "2027-03-01",
  handling_rep_name: "שירה",
  customer_id: CUSTOMER,
  call_types: { label_he: "תיקון" },
  customers: { name: "משפחת בדיקה", customer_number: "100", phone: "050-0000100", phone_alt: null, is_test: true },
  products: { name: "ברז", sku_display: "KT-1", is_test: true, brands: null, suppliers: { name: "ספק" } },
  visits: [visit(V2, 2, "followup", T2, "18"), visit(V1, 1, "done", T1, "12"), visit(V3, 3, "cancelled", T1, "19")],
});

const extras = (over: Partial<CallCardExtras> = {}): CallCardExtras => ({
  times: [
    { visit_id: V2, kind: "departed", reported_at: "2026-11-18T06:40:00+00:00" },
    { visit_id: V2, kind: "arrived", reported_at: "2026-11-18T07:05:00+00:00" },
    { visit_id: V2, kind: "ended", reported_at: "2026-11-18T08:20:00+00:00" },
  ],
  reports: [{ visit_id: V2, summary_text: "הוחלף אטם" }],
  signatures: [{ visit_id: V1, signer_name: "חותם", signed_ack_text: "אישור" }],
  media: [
    { visit_id: V2, kind: "photo", phase: "before", state: "stored" },
    { visit_id: V2, kind: "photo", phase: "after", state: "pending" },
    { visit_id: V1, kind: "signature", phase: null, state: "stored" },
  ],
  technicians: [
    { id: T1, display_name: "טכנאי א", color: "t-y", profile_id: P1 },
    { id: T2, display_name: "טכנאית ב", color: "rgb(1,2,3)", profile_id: P2 },
  ],
  phones: new Map([[P2, "050-0000002"]]),
  reasons: new Map([[R1, "חסר חלק"]]),
  places: new Map([[L1, "מחסן ראשי"]]),
  otherCalls: [{ request_number: "72000", status: "resolved", opened_at: "2025-12-01T08:00:00+00:00", products: { name: "מסנן" } }],
  today: "2026-11-18",
  ...over,
});

test.describe("call card mapping (D60 (1), (5); D39; D74)", () => {
  onlyInProject("desktop");

  test("visits in number order without the cancelled one; field times and durations of the closed visit", () => {
    const card = callCardOfRows(row, extras());
    expect(card.visits.map((v) => v.n)).toEqual([1, 2]);
    const v2 = card.visits[1]!;
    expect(v2).toMatchObject({ status: "cont", dateLabel: "היום", start: "09:00", end: "10:30", departAt: "08:40", arriveAt: "09:05", endAt: "10:20" });
    expect(v2).toMatchObject({ travelMin: 25, treatMin: 75, totalMin: 100, reason: "חסר חלק", nextNote: "להביא אטם", summary: "הוחלף אטם" });
    // Only stored photos (never a pending one or the signature image).
    expect(v2.media).toEqual([{ kind: "img", when: "before" }]);
    // No times recorded: nothing derived.
    expect(card.visits[0]).toMatchObject({ departAt: null, arriveAt: null, endAt: null, travelMin: null, treatMin: null, totalMin: null });
    expect(card.visits[0]).toMatchObject({ dateLabel: "12.11", signer: "חותם", signedText: "אישור", collect: "" });
    // Unknown colour → the muted token, never stored CSS.
    expect(v2.tech.color).toBe("var(--muted)");
  });

  test("header, customer (address of the newest shown visit), warranty, other calls and the technician's phone", () => {
    const card = callCardOfRows(row, extras());
    expect(card).toMatchObject({ req: "73001", status: "followup", isTest: true, type: "תיקון", warranty: "כן · עד 03/2027", desc: "נזילה" });
    expect(card.customer).toMatchObject({ address: "הרצל 2, רחובות", building: "2", arrival: "לצלצל", rep: "שירה", phone2: "" });
    expect(card.product).toMatchObject({ sku: "KT-1", brand: "", supplier: "ספק" });
    expect(card.customerCalls).toEqual([{ req: "72000", href: "/office/calls/72000", product: "מסנן", when: "01.12.25", status: "resolved" }]);
    expect(card.technician).toEqual({ name: "טכנאית ב", phone: "050-0000002" });
  });

  test("no readable phone → an empty phone (the page then shows no \"התקשר לטכנאי\")", () => {
    expect(callCardOfRows(row, extras({ phones: new Map() })).technician).toEqual({ name: "טכנאית ב", phone: "" });
  });

  test("warranty and date labels", () => {
    expect(warrantyLabel("yes", "2027-03-01")).toBe("כן · עד 03/2027");
    expect(warrantyLabel("yes", null)).toBe("כן");
    expect(warrantyLabel("no", null)).toBe("לא");
    expect(warrantyLabel(null, null)).toBe("לא צוין");
    expect(dateLabelOf("2026-11-18T22:30:00+00:00", "2026-11-19")).toBe("היום"); // 00:30 in Jerusalem
    expect(dateLabelOf("2026-11-18T08:00:00+00:00", "2026-11-19")).toBe("18.11");
    expect(dateLabelOf(null, "2026-11-19")).toBe("—");
  });

  test("request numbers: the database's pattern only", () => {
    for (const ok of ["73001", "A-1", "x".repeat(32)]) expect(isRequestNumber(ok), ok).toBe(true);
    for (const bad of ["", "a b", "x".repeat(33), "1;drop", "%27"]) expect(isRequestNumber(bad), bad).toBe(false);
  });

  test("a malformed row is refused by the schema", () => {
    expect(callCardRowSchema.safeParse({ ...row, request_number: "a b" }).success).toBe(false);
    expect(callCardRowSchema.safeParse({ ...row, visits: [{ ...row.visits[0], technician_id: "x" }] }).success).toBe(false);
  });
});

test.describe("call card page: server-side guards (source)", () => {
  onlyInProject("desktop");

  test("area guard, office roles, the key `calls`, one 404 for absent and unreadable; no skeleton data", () => {
    const src = readFileSync(path.join(process.cwd(), "app/(office)/office/calls/[req]/page.tsx"), "utf8");
    expect(src).toContain('requireArea("office")');
    expect(src).toContain("readsCalls(me)");
    expect(src).toContain("callsPermitted()");
    expect(src).toMatch(/if \(!call\) notFound\(\)/);
    expect(src).toContain("showReport={showReport}");
    expect(src).not.toContain("_skeletonData");
    const data = readFileSync(path.join(process.cwd(), "lib/data/supabase/calls.ts"), "utf8");
    expect(data).toContain('import "server-only"');
    expect(data).toContain("createUserSupabaseClient");
    expect(data).not.toMatch(/SECRET|service_role|createAdmin/i);
  });
});
