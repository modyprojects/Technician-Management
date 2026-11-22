import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFICE_CALENDAR_PATH, realOfficeNav } from "@/features/auth/landing";
import {
  addMonths,
  calendarRangeOf,
  calendarVisitOf,
  clampToRange,
  officeCalendarQueriesOf,
  officeCalendarRole,
  officeDayOf,
  officeWeekOf,
  placeVisits,
  showsTestRows,
  shownTechnicians,
  stepsOf,
  visitDetailOf,
  weekDaysOf,
  type CalendarVisitRow,
  type DetailRow,
  type TechnicianRow,
} from "@/features/office-calendar/data/office-calendar";
import { phoneDaysOf, phoneTechOf, techCalVisitOf } from "@/features/office-calendar/data/phone";
import { parseTechs, techsLabelOf, techsParamOf } from "@/features/office-calendar/data/tech-filter";
import { addDays, weekStartOf } from "@/features/calendar/data/dates";
import { onlyInProject } from "./helpers";

// "יומן טכנאים" on real data (D88 office module 2; D94): the pure rules of the Supabase adapter
// (features/office-calendar/data/office-calendar.ts), the `cal` gate before any read, and source checks of the page's
// server-side guards. The screen on real data is tested against the local stack
// (tests/auth/office-tech-calendar.spec.ts).

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const T3 = "00000000-0000-4000-8000-0000000000a3";
const tech = (id: string, name: string, o: Partial<TechnicianRow> = {}): TechnicianRow => ({ id, display_name: name, color: "t-y", accepts_invitations: true, is_test: true, ...o });
const techs = new Map([
  [T1, tech(T1, "אבי")],
  [T2, tech(T2, "בני", { color: "url(x)" })],
]);
const row = (o: Partial<CalendarVisitRow> = {}): CalendarVisitRow => ({
  visit_number: 1,
  status: "scheduled",
  // 07:00 UTC = 09:00 in Jerusalem (winter).
  scheduled_start: "2026-11-22T07:00:00+00:00",
  scheduled_end: "2026-11-22T08:30:00+00:00",
  city: "רחובות",
  technician_id: T1,
  is_test: true,
  service_calls: { request_number: "48213", customers: { name: "משפחת לוי" }, products: { name: "ברז" } },
  ...o,
});

test.describe("the office calendar's window, week and steps (D94)", () => {
  onlyInProject("desktop");

  test("(d) one month back and three months forward, rounded out to whole weeks (owner review 22.11, batch 2)", () => {
    // Today Sunday 22.11.26: one month back is Thursday 22.10 → its Sunday 18.10; three months ahead
    // is Monday 22.02.27 → that week's Saturday 27.02.27.
    expect(calendarRangeOf("2026-11-22")).toEqual({ min: "2026-10-18", max: "2027-02-27" });
    // Today Wednesday 25.11: 25.10 is a Sunday (kept); 25.02.27 is a Thursday → Saturday 27.02.
    expect(calendarRangeOf("2026-11-25")).toEqual({ min: "2026-10-25", max: "2027-02-27" });
    // Today Saturday 28.11: 28.10 is a Wednesday → Sunday 25.10; 28.02.27 is a Sunday → Saturday 06.03.
    expect(calendarRangeOf("2026-11-28")).toEqual({ min: "2026-10-25", max: "2027-03-06" });
    // Month ends: 30.11 → 30.10 (Friday → Sunday 25.10) and 28.02.27 (cut; Sunday → Saturday 06.03).
    expect(calendarRangeOf("2026-11-30")).toEqual({ min: "2026-10-25", max: "2027-03-06" });
    // 31.01.26 (Saturday) → 31.12.25 (Wednesday → Sunday 28.12.25) and 30.04.26 (Thursday → Saturday 02.05).
    expect(calendarRangeOf("2026-01-31")).toEqual({ min: "2025-12-28", max: "2026-05-02" });
    // Every shown week is complete: the range starts on a Sunday and ends on a Saturday.
    for (const today of ["2026-11-22", "2026-11-25", "2026-11-28", "2026-11-30", "2026-01-31", "2026-02-28", "2026-12-31"]) {
      const r = calendarRangeOf(today);
      expect(weekStartOf(r.min)).toBe(r.min);
      expect(addDays(weekStartOf(r.max), 6)).toBe(r.max);
      expect(r.min <= addMonths(today, -1) && r.max >= addMonths(today, 3)).toBe(true);
    }
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2027-01-15", -1)).toBe("2026-12-15");
    const r = calendarRangeOf("2026-11-22");
    expect(clampToRange("2025-01-01", r)).toBe("2026-10-18");
    expect(clampToRange("2030-01-01", r)).toBe("2027-02-27");
    expect(clampToRange("2026-12-01", r)).toBe("2026-12-01");
  });

  test("(a) the week is Sunday to Saturday", () => {
    expect(weekDaysOf("2026-11-25")).toEqual(["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
  });

  test("(d) the arrows stop at the edges; days include Friday and Saturday", () => {
    const r = calendarRangeOf("2026-11-22");
    expect(stepsOf("day", "2026-11-27", r)).toEqual({ prev: "2026-11-26", next: "2026-11-28" });
    expect(stepsOf("day", r.min, r)).toEqual({ prev: null, next: "2026-10-19" });
    expect(stepsOf("day", r.max, r)).toEqual({ prev: "2027-02-26", next: null });
    // The first week (Sunday 18.10 – Saturday 24.10): no previous week.
    expect(stepsOf("week", "2026-10-22", r).prev).toBeNull();
    expect(stepsOf("week", "2026-10-18", r).prev).toBeNull();
    expect(stepsOf("week", "2026-10-29", r).prev).toBe("2026-10-22");
    // The last week (Sunday 21.02.27 – Saturday 27.02.27): no next week.
    expect(stepsOf("week", "2027-02-27", r).next).toBeNull();
    expect(stepsOf("week", "2027-02-22", r).next).toBeNull();
    expect(stepsOf("week", "2027-02-15", r).next).toBe("2027-02-22");
  });

  test("D91 scope: test rows are left out only on Production after go-live", () => {
    expect(showsTestRows(undefined, true)).toBe(true);
    expect(showsTestRows("preview", false)).toBe(true);
    expect(showsTestRows("production", true)).toBe(true);
    expect(showsTestRows("production", false)).toBe(false);
    expect(showsTestRows("production", "true")).toBe(false);
  });
});

test.describe("the office calendar's mapping (Supabase adapter)", () => {
  onlyInProject("desktop");

  test("a visit: request number, Asia/Jerusalem times, allowlisted colour, test source; cancelled never shown", () => {
    expect(calendarVisitOf(row(), techs)).toMatchObject({
      req: "48213",
      n: 1,
      date: "2026-11-22",
      start: "09:00",
      end: "10:30",
      status: "new",
      source: "simulator",
      technician: { id: T1, name: "אבי", color: "var(--t-y)" },
      customerName: "משפחת לוי",
      city: "רחובות",
      productName: "ברז",
      isTest: true,
    });
    expect(calendarVisitOf(row({ technician_id: T2 }), techs)?.technician.color).toBe("var(--muted)");
    expect(calendarVisitOf(row({ status: "cancelled" }), techs)).toBeNull();
    expect(calendarVisitOf(row({ scheduled_start: "not a time" }), techs)).toBeNull();
  });

  test("lanes: every technician that accepts invitations or has a visit; overlaps side by side; tech filter", () => {
    const visits = [
      calendarVisitOf(row(), techs)!,
      calendarVisitOf(row({ visit_number: 2, scheduled_start: "2026-11-22T07:30:00+00:00", scheduled_end: "2026-11-22T09:00:00+00:00" }), techs)!,
      calendarVisitOf(row({ technician_id: T3, scheduled_start: "2026-11-27T07:00:00+00:00", scheduled_end: "2026-11-27T08:00:00+00:00" }), techs)!,
    ];
    const rows = [tech(T1, "אבי"), tech(T2, "בני", { accepts_invitations: false }), tech(T3, "גל", { accepts_invitations: false })];
    const shown = shownTechnicians(rows, visits);
    expect(shown.map((t) => t.id)).toEqual([T1, T3]);
    const data = { visits, technicians: shown, capped: false };
    const day = officeDayOf(data, "2026-11-22", null);
    expect(day.lanes.map((l) => l.visits.total)).toEqual([2, 0]);
    expect(day.lanes[0]!.visits.items.map((v) => [v.lane, v.lanes])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(day.includesTestData).toBe(true);
    expect(officeDayOf(data, "2026-11-22", T3).lanes.map((l) => l.technician.id)).toEqual([T3]);
    const week = officeWeekOf(data, "2026-11-25", null);
    expect(week.days).toHaveLength(7);
    expect(week.days.map((d) => d.visits.total)).toEqual([2, 0, 0, 0, 0, 1, 0]);
    expect(officeWeekOf(data, "2026-11-25", T1).total).toBe(2);
    // The desktop's multi-select (owner review 22.11, batch 2).
    expect(officeDayOf(data, "2026-11-22", [T1, T3]).lanes.map((l) => l.technician.id)).toEqual([T1, T3]);
    expect(officeDayOf(data, "2026-11-22", [T3]).filter.technicianId).toBe(T3);
    expect(officeDayOf(data, "2026-11-22", [T1, T3]).filter.technicianId).toBeNull();
    expect(officeWeekOf(data, "2026-11-25", [T3]).total).toBe(1);
    expect(placeVisits([])).toEqual([]);
  });

  test("desktop technician filter (owner review 22.11, batch 2): ?techs= parsing, the address and the button's text", () => {
    const shown = [
      { id: T1, name: "אבי" },
      { id: T2, name: "בני" },
      { id: T3, name: "גל" },
    ];
    // Absent or empty: all.
    expect(parseTechs(undefined, shown)).toBeNull();
    expect(parseTechs("", shown)).toBeNull();
    // In the technicians' order, duplicates and spaces ignored.
    expect(parseTechs(`${T3},${T1}, ${T3}`, shown)).toEqual([T1, T3]);
    expect(parseTechs([T2, T3], shown)).toEqual([T2, T3]);
    // Unknown ids are ignored; nothing left = all; every technician = all.
    expect(parseTechs(`${T2},00000000-0000-4000-8000-000000000000,x`, shown)).toEqual([T2]);
    expect(parseTechs("00000000-0000-4000-8000-000000000000,<script>", shown)).toBeNull();
    expect(parseTechs(`${T1},${T2},${T3}`, shown)).toBeNull();
    expect(parseTechs(T1, [])).toBeNull();
    expect(techsParamOf(null, shown)).toBeNull();
    expect(techsParamOf([T3, T1], shown)).toBe(`${T1},${T3}`);
    expect(techsParamOf([T1, T2, T3], shown)).toBeNull();
    expect(techsLabelOf(null, shown)).toBe("כל הטכנאים");
    expect(techsLabelOf([T2], shown)).toBe("בני");
    expect(techsLabelOf([T1, T3], shown)).toBe("2 טכנאים");
  });

  test("phone (owner review 22.11): one technician, default the first, unknown falls back; the technician calendar's shape", () => {
    const shown = [tech(T1, "אבי"), tech(T3, "גל")].map((t) => ({ id: t.id }));
    expect(phoneTechOf(T3, shown)).toBe(T3);
    expect(phoneTechOf(null, shown)).toBe(T1);
    expect(phoneTechOf("not-a-tech", shown)).toBe(T1);
    expect(phoneTechOf(T2, [])).toBeNull();
    const second = calendarVisitOf(row({ visit_number: 2, scheduled_start: "2026-11-22T06:00:00+00:00", scheduled_end: "2026-11-22T06:30:00+00:00" }), techs)!;
    const visits = [calendarVisitOf(row(), techs)!, second, calendarVisitOf(row({ technician_id: T3 }), techs)!];
    const data = { visits, technicians: [], capped: false };
    const days = phoneDaysOf(data, weekDaysOf("2026-11-25"), T1);
    expect(days.map((d) => d.visits.length)).toEqual([2, 0, 0, 0, 0, 0, 0]);
    // By start time; the id is the visit ref the drawer opens.
    expect(days[0]!.visits.map((v) => v.id)).toEqual(["48213:2", "48213:1"]);
    expect(techCalVisitOf(visits[0]!)).toMatchObject({ id: "48213:1", request: "48213", customer: "משפחת לוי", city: "רחובות", product: "ברז", start: "09:00", end: "10:30", status: "new", isTest: true, isFollowUp: false });
    expect(phoneDaysOf(data, ["2026-11-22"], null)[0]!.visits).toEqual([]);
  });

  test("the drawer: field times, signer only when done, reason only when follow-up; outside the window or cancelled is null", () => {
    const detail: DetailRow = {
      request_number: "48213",
      is_test: true,
      fault_description: "נוזל",
      handling_rep_name: "נציגה",
      customers: { name: "משפחת לוי", phone: "050-0000000", is_test: true },
      products: { name: "ברז", sku_display: "KT-1", is_test: true },
      visits: [
        {
          id: "00000000-0000-4000-8000-0000000000d1",
          visit_number: 1,
          status: "done",
          scheduled_start: "2026-11-22T07:00:00+00:00",
          scheduled_end: "2026-11-22T08:00:00+00:00",
          city: "רחובות",
          street: "הרצל 1",
          technician_id: T1,
          followup_reason_id: null,
          is_test: true,
        },
      ],
    };
    const x = { technician: techs.get(T1)!, phone: "", times: [{ kind: "departed" as const, reported_at: "2026-11-22T06:40:00+00:00" }], signer: "דנה", reason: "חלק" };
    const r = calendarRangeOf("2026-11-22");
    expect(visitDetailOf(detail, x, r)).toMatchObject({
      req: "48213",
      n: 1,
      status: "done",
      departAt: "08:40",
      arriveAt: null,
      signerName: "דנה",
      followupReason: null,
      customer: { address: "הרצל 1, רחובות" },
      technician: { id: T1, phone: "" },
    });
    expect(visitDetailOf(detail, x, calendarRangeOf("2027-06-01"))).toBeNull();
    expect(visitDetailOf({ ...detail, visits: [{ ...detail.visits[0]!, status: "cancelled" }] }, x, r)).toBeNull();
    expect(visitDetailOf({ ...detail, visits: [] }, x, r)).toBeNull();
  });
});

/** A client that records every call and answers `has_permission` with `allowed`. */
function recordingClient(allowed: boolean) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gte", "lt", "order", "limit", "in", "maybeSingle"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}:${String(args.p_key)}`);
      return { data: allowed, error: null };
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

test.describe("D94 (c): `cal` is checked before any read", () => {
  onlyInProject("desktop");

  test("without `cal` nothing is read; a Technician or no session is never asked", async () => {
    const r = calendarRangeOf("2026-11-22");
    const denied = recordingClient(false);
    const q = officeCalendarQueriesOf(denied.db, { role: "cs" }, true);
    expect(await q.permitted()).toBe(false);
    expect(await q.week("2026-11-22", r)).toEqual({ visits: [], technicians: [], capped: false });
    expect(await q.visit({ req: "48213", n: 1 }, r)).toBeNull();
    expect(denied.calls).toEqual(["rpc:has_permission:cal"]);

    for (const viewer of [{ role: "tech" as const }, null]) {
      const none = recordingClient(true);
      const t = officeCalendarQueriesOf(none.db, viewer, true);
      expect(await t.permitted()).toBe(false);
      expect((await t.week("2026-11-22", r)).visits).toEqual([]);
      expect(await t.visit({ req: "48213", n: 1 }, r)).toBeNull();
      expect(none.calls).toEqual([]);
    }
    for (const role of ["creator", "mgr", "cs"] as const) expect(officeCalendarRole({ role })).toBe(true);
    expect(officeCalendarRole({ role: "tech" })).toBe(false);
  });

  test("with `cal` the week reads visits and technicians under the session; a tampered visit ref reads nothing", async () => {
    const r = calendarRangeOf("2026-11-22");
    const ok = recordingClient(true);
    const q = officeCalendarQueriesOf(ok.db, { role: "mgr" }, true);
    await q.week("2026-11-22", r);
    expect(ok.calls[0]).toBe("rpc:has_permission:cal");
    expect([...ok.calls].sort()).toEqual(["from:technicians", "from:visits", "rpc:has_permission:cal"]);
    expect(await q.visit({ req: "x' or 1=1", n: 1 }, r)).toBeNull();
    expect(ok.calls).toHaveLength(3);
  });
});

test.describe("the calendar page: navigation and server-side guards", () => {
  onlyInProject("desktop");

  test("\"יומן טכנאים\" is in an office role's navigation only with `cal` (D94 (c); display only)", () => {
    expect(OFFICE_CALENDAR_PATH).toBe("/office/calendar");
    for (const role of ["mgr", "creator", "cs"]) {
      expect(realOfficeNav(role, { cal: true }).some((i) => i.key === "cal" && i.href === "/office/calendar")).toBe(true);
      expect(realOfficeNav(role, { cal: false }).some((i) => i.key === "cal")).toBe(false);
      expect(realOfficeNav(role).some((i) => i.key === "cal")).toBe(false);
    }
    expect(realOfficeNav("tech", { cal: true })).toEqual([]);
    expect(realOfficeNav("tech")).toEqual([]);
  });

  test("the page guards itself (session, office role, `cal`), reads under the session, is read-only and has no fake data", () => {
    const page = readFileSync(path.resolve("app/(office)/office/calendar/page.tsx"), "utf8");
    expect(page).toContain('await requireArea("office")');
    expect(page).toContain("if (!officeCalendarRole(me)) redirect(LOGIN_NO_ACCESS_PATH);");
    expect(page).toContain("if (!(await queries.permitted()))");
    expect(page).not.toMatch(/skeleton|fixture|app\/dev/i);
    // D94 (e): read-only: no form, no server action, no drag.
    expect(page).not.toMatch(/<form|"use server"|draggable|onDrag|action=/);
    // Owner review 22.11: the phone reuses the technician calendar's grids; no card list.
    expect(page).toContain("<TechCalDay");
    expect(page).toContain("<TechCalWeek");
    expect(page).not.toContain("PhoneAgenda");
    // Owner review 22.11, batch 2: whole weeks, so no day is greyed as out of range; the desktop
    // filter is one button with a checkbox list, the day view has a minimum column width.
    expect(page).not.toMatch(/greyed|inRange|מחוץ לטווח/);
    expect(page).toContain("<TechFilter");
    expect(page).toContain("minColumn={DAY_COLUMN_MIN}");
    const server = readFileSync(path.resolve("lib/data/supabase/office-calendar.ts"), "utf8");
    expect(server).toContain('import "server-only";');
    expect(server).toContain("createUserSupabaseClient");
    expect(server).not.toMatch(/SUPABASE_SECRET_KEY|createAdmin|service_role/);
  });
});
