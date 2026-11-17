import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { OFFICE_CALLS_PATH, officeCallPath, realOfficeNav } from "@/features/auth/landing";
import {
  callMatches,
  callRowSchema,
  callSummaryOf,
  CALL_STATUS_OF_DB,
  DB_CALL_STATUS,
  listPageOf,
  readsCalls,
  type CallRow,
  type ListedCall,
} from "@/features/calls/supabase/list-queries";
import { onlyInProject, openPage } from "./helpers";

// "קריאות" on real data (V1 item 4; D38, D60 (1), (3), (4); QA S-01, S-03, X-01, X-02): the pure
// mapping and list rules of the Supabase adapter, and source checks of the page's server-side
// guards. The screen on real data is tested against the local stack (tests/auth/office-calls-list.spec.ts);
// here, without Supabase values, the routes fail closed.

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const R1 = "00000000-0000-4000-8000-0000000000b1";
const techs = new Map([
  [T1, { id: T1, display_name: "טכנאי א", color: "t-y" }],
  [T2, { id: T2, display_name: "טכנאית ב", color: "rgb(1,2,3)" }],
]);
const reasons = new Map([[R1, "חסר חלק"]]);

const visit = (n: number, status: CallRow["visits"][number]["status"], tech = T1, start = "2026-12-01T07:00:00+00:00", city = "רחובות") => ({
  visit_number: n,
  status,
  scheduled_start: start,
  scheduled_end: "2026-12-01T09:00:00+00:00",
  city,
  technician_id: tech,
  followup_reason_id: status === "followup" ? R1 : null,
  is_test: true,
});
const row = (o: Partial<CallRow>): CallRow => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  request_number: "48213",
  status: "open",
  opened_at: "2026-11-30T10:00:00.123456+00:00",
  handling_rep_name: "נציגת בדיקה",
  is_test: true,
  customers: { name: "משפחת לוי", customer_number: "10001", phone: "050-000-1122", is_test: true },
  products: { name: "ברז מטבח נשלף", sku_normalized: "KT-2041", is_test: true, brands: { name: "מותג" }, suppliers: null },
  visits: [visit(1, "scheduled")],
  ...o,
});

test.describe("the calls list's mapping (Supabase adapter)", () => {
  onlyInProject("desktop");

  test("a row: request number, customer, product, latest visit in Asia/Jerusalem, test source (D47, SIM-14)", () => {
    const c = callSummaryOf(row({}), techs, reasons);
    expect(callRowSchema.safeParse(row({})).success).toBe(true);
    expect(c).toMatchObject({
      req: "48213",
      source: "simulator",
      status: "open",
      visitCount: 1,
      customer: { name: "משפחת לוי", number: "10001", city: "רחובות", isTest: true },
      product: { sku: "KT-2041", name: "ברז מטבח נשלף", brand: "מותג", supplier: "" },
      latestVisit: { n: 1, date: "2026-12-01", start: "09:00", end: "11:00", status: "new", source: "simulator", technician: { id: T1, name: "טכנאי א", color: "var(--t-y)" } },
      representative: "נציגת בדיקה",
      isTest: true,
    });
    // A stored colour that is not a token is never passed through as CSS.
    expect(callSummaryOf(row({ visits: [visit(1, "scheduled", T2)] }), techs, reasons).latestVisit?.technician.color).toBe("var(--muted)");
  });

  test("D60 (1): a cancelled visit is never shown or counted; every visit cancelled shows none", () => {
    const c = callSummaryOf(row({ visits: [visit(1, "done"), visit(2, "cancelled", T2, "2026-12-02T07:00:00+00:00", "חולון")] }), techs, reasons);
    expect(c.visitCount).toBe(1);
    expect(c.latestVisit?.n).toBe(1);
    expect(c.latestVisit?.status).toBe("done");
    const none = callSummaryOf(row({ status: "awaiting_scheduling", visits: [visit(1, "cancelled", T1, undefined, "חולון")] }), techs, reasons);
    expect(none).toMatchObject({ status: "awaiting", visitCount: 0, latestVisit: null });
    // The address is per visit: the newest visit's city still names the call's place.
    expect(none.customer.city).toBe("חולון");
  });

  test("statuses map both ways (D38); a follow-up call names its reason", () => {
    for (const [db, ui] of Object.entries(CALL_STATUS_OF_DB)) expect(DB_CALL_STATUS[ui]).toBe(db);
    const f = callSummaryOf(row({ status: "awaiting_followup", visits: [visit(1, "followup")] }), techs, reasons);
    expect(f).toMatchObject({ status: "followup", followupReason: "חסר חלק" });
    expect(callSummaryOf(row({ visits: [visit(1, "followup"), visit(2, "scheduled")] }), techs, reasons).followupReason).toBeNull();
  });

  test("search, the latest visit's technician, newest first, pages of 40", () => {
    const rows: ListedCall[] = [
      callSummaryOf(row({}), techs, reasons),
      callSummaryOf(
        row({
          id: "00000000-0000-4000-8000-0000000000c2",
          request_number: "48300",
          customers: { name: "רותם אלמוג", customer_number: "SC-1", phone: "052-000-7070", is_test: true },
          products: { name: "מסנן מים", sku_normalized: "WF-100", is_test: true, brands: null, suppliers: null },
          visits: [visit(1, "scheduled", T2, "2026-12-03T07:00:00+00:00", "חולון")],
        }),
        techs,
        reasons,
      ),
    ];
    expect(listPageOf(rows, {}).items.map((c) => c.req)).toEqual(["48300", "48213"]);
    for (const q of ["48213", "לוי", "10001", "kt-2041", "ברז", "0500001122", "000-1122"]) {
      expect(listPageOf(rows, { q }).items.map((c) => c.req), q).toEqual(["48213"]);
    }
    expect(listPageOf(rows, { q: "חולון" }).items.map((c) => c.req)).toEqual(["48300"]);
    expect(listPageOf(rows, { technicianId: T2 }).items.map((c) => c.req)).toEqual(["48300"]);
    expect(listPageOf(rows, { statuses: ["resolved"] }).total).toBe(0);
    expect(callMatches(rows[0]!, "999")).toBe(false);
    const many = Array.from({ length: 45 }, (_, i) => ({ ...rows[0]!, req: `R${i}`, sortKey: i }));
    const p2 = listPageOf(many, { page: 2, limit: 40 });
    expect(p2).toMatchObject({ page: 2, pageCount: 2, total: 45 });
    expect(p2.items).toHaveLength(5);
    expect("sortKey" in p2.items[0]!).toBe(false);
    expect(listPageOf(many, { page: 9, limit: 40 }).page).toBe(2);
  });

  test("only office roles read the list", () => {
    for (const role of ["creator", "mgr", "cs"] as const) expect(readsCalls({ role })).toBe(true);
    expect(readsCalls({ role: "tech" })).toBe(false);
    expect(readsCalls(null)).toBe(false);
  });
});

test.describe("the calls pages: navigation and server-side guards", () => {
  onlyInProject("desktop");

  test("the navigation of D57 (1) and D60 (4) built so far; Customer Service lands on \"קריאות\" (S-01)", () => {
    expect(OFFICE_CALLS_PATH).toBe("/office/calls");
    expect(officeCallPath("48 213/x")).toBe("/office/calls/48%20213%2Fx");
    for (const role of ["mgr", "creator"]) expect(realOfficeNav(role).map((i) => i.label)).toEqual(["דשבורד", "קריאות", "זימונים שלא נקלטו", "הגדרות"]);
    expect(realOfficeNav("cs")).toEqual([
      { key: "calls", label: "קריאות", href: "/office/calls" },
      { key: "unparsed", label: "זימונים שלא נקלטו", href: "/office/unparsed" },
    ]);
    const start = readFileSync(path.resolve("app/(office)/office/page.tsx"), "utf8");
    expect(start).toContain('if (item.key === "calls") redirect(OFFICE_CALLS_PATH);');
  });

  test("each page guards itself: the session, an office role and the matrix key `calls`; no demo import", () => {
    for (const file of ["app/(office)/office/calls/page.tsx", "app/(office)/office/calls/[req]/page.tsx"]) {
      const source = readFileSync(path.resolve(file), "utf8");
      expect(source, file).toContain('await requireArea("office")');
      expect(source, file).toContain("readsCalls(me)");
      expect(source, file).toContain("await callsPermitted()");
      expect(source, file).not.toMatch(/app\/dev|_fixtures|demoDataAccess|data-sim/);
    }
    // The table never says "בוטל/בוטלה" for a real row (D60 (1)): the real page passes no cancelled flag.
    expect(readFileSync(path.resolve("app/(office)/office/calls/page.tsx"), "utf8")).not.toContain("whenCancelled");
  });

  test("without the Supabase values both routes fail closed to /login", async ({ page }) => {
    for (const p of ["/office/calls", "/office/calls?status=open&q=1", "/office/calls/48213"]) {
      await openPage(page, p);
      await expect(page, p).toHaveURL(/\/login$/);
    }
  });
});
