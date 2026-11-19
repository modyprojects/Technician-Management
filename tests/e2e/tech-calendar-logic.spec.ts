import { expect, test } from "@playwright/test";
import { blockBox, DEFAULT_END_HOUR, DEFAULT_START_HOUR, hourRange, visitSpan } from "@/components/tech/calendar/grid";
import { calendarDays, calendarModel, calendarWindow, isShown } from "@/components/tech/calendar/model";
import type { CalVisit } from "@/components/tech/calendar/types";
import { weekdayOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { onlyInProject } from "./helpers";

// The technician calendar's pure rules (D79, D85, D89): week boundaries Sunday to Saturday in
// Asia/Jerusalem, the 14-day window, the daily strip, the hour grid extension and the filter of a
// visit left open on a previous day. No server, no clock: "today" is passed in.
test.describe("technician calendar logic", () => {
  onlyInProject("desktop");

  let n = 0;
  const visit = (date: string, start: string, end: string, status: CalVisit["status"] = "new"): CalVisit => ({
    id: `v${++n}`,
    isTest: true,
    date,
    request: String(70000 + n),
    start,
    end,
    customer: "לקוח בדיקה",
    city: "חיפה",
    address: "הנמל 1, חיפה",
    product: "מוצר",
    summary: status === "done" || status === "cont" ? "סיכום" : "",
    status,
    isFollowUp: false,
  });

  test("the window is Sunday of this week to Saturday of the next, whatever the weekday", () => {
    // 2026-11-15 is a Sunday.
    expect(calendarWindow("2026-11-15")).toEqual({ from: "2026-11-15", to: "2026-11-28" });
    expect(calendarWindow("2026-11-19")).toEqual({ from: "2026-11-15", to: "2026-11-28" });
    expect(calendarWindow("2026-11-21")).toEqual({ from: "2026-11-15", to: "2026-11-28" });
    // Across a month and a year.
    expect(calendarWindow("2026-12-31")).toEqual({ from: "2026-12-27", to: "2027-01-09" });
    // Across the Israeli DST change (Friday 2027-03-26): dates, not instants.
    expect(calendarWindow("2027-03-27")).toEqual({ from: "2027-03-21", to: "2027-04-03" });
    const { from, to } = calendarWindow("2027-03-27");
    expect(weekdayOf(from)).toBe(0);
    expect(weekdayOf(to)).toBe(6);
  });

  test("today is the Asia/Jerusalem date, not UTC: Saturday 22:30 UTC is already Sunday", () => {
    // 2026-11-21 22:30 UTC = 2026-11-22 00:30 in Jerusalem (UTC+2): a new week.
    const today = jerusalemToday(new Date("2026-11-21T22:30:00Z"));
    expect(today).toBe("2026-11-22");
    expect(calendarWindow(today).from).toBe("2026-11-22");
    // Summer time (UTC+3): 21:30 UTC on Saturday is 00:30 Sunday.
    expect(jerusalemToday(new Date("2027-06-12T21:30:00Z"))).toBe("2027-06-13");
    expect(jerusalemToday(new Date("2027-06-12T20:30:00Z"))).toBe("2027-06-12");
  });

  test("a visit left open on a previous day is not shown; closed ones are; cancelled never", () => {
    const today = "2026-11-19";
    expect(isShown({ date: "2026-11-17", status: "new" }, today)).toBe(false);
    expect(isShown({ date: "2026-11-17", status: "go" }, today)).toBe(false);
    expect(isShown({ date: "2026-11-17", status: "work" }, today)).toBe(false);
    expect(isShown({ date: "2026-11-17", status: "done" }, today)).toBe(true);
    expect(isShown({ date: "2026-11-17", status: "cont" }, today)).toBe(true);
    expect(isShown({ date: today, status: "work" }, today)).toBe(true);
    expect(isShown({ date: today, status: "done" }, today)).toBe(true);
    expect(isShown({ date: "2026-11-25", status: "new" }, today)).toBe(true);
    expect(isShown({ date: today, status: "cancel" }, today)).toBe(false);
  });

  test("calendarDays: 14 days, visits by date in start order, past open dropped, outside the window dropped", () => {
    const today = "2026-11-19";
    const days = calendarDays(
      [
        visit("2026-11-16", "13:00", "14:00", "work"),
        visit("2026-11-16", "09:00", "10:00", "done"),
        visit(today, "12:00", "13:00"),
        visit(today, "08:00", "09:00"),
        visit("2026-11-28", "10:00", "11:00"),
        visit("2026-11-29", "10:00", "11:00"),
        visit("2026-11-14", "10:00", "11:00", "done"),
      ],
      today,
    );
    expect(days).toHaveLength(14);
    expect(days[0]!.date).toBe("2026-11-15");
    expect(days[13]!.date).toBe("2026-11-28");
    expect(days[1]!.visits.map((v) => v.status)).toEqual(["done"]);
    expect(days[4]!.visits.map((v) => v.start)).toEqual(["08:00", "12:00"]);
    expect(days[13]!.visits).toHaveLength(1);
    expect(days.flatMap((d) => d.visits)).toHaveLength(4);
  });

  test("calendarModel: daily strip today..today+6, weekly current or next week only", () => {
    const today = "2026-11-19";
    const visits = [visit("2026-11-20", "09:00", "10:00"), visit("2026-11-24", "09:00", "10:00")];
    const day = calendarModel({}, today, visits);
    expect(day.view).toBe("day");
    expect(day.date).toBe(today);
    expect(day.strip.map((d) => d.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(day.lastStripDay).toBe("2026-11-25");
    // A date outside the strip (past or beyond +6) or malformed selects today.
    for (const date of ["2026-11-18", "2026-11-26", "2026-11-1", "x"]) expect(calendarModel({ date }, today, visits).date).toBe(today);
    expect(calendarModel({ date: "2026-11-24" }, today, visits).day.visits).toHaveLength(1);

    const week = calendarModel({ view: "week" }, today, visits);
    expect(week.weekStart).toBe("2026-11-15");
    expect(week.isNextWeek).toBe(false);
    expect(week.week.map((d) => d.date)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    const next = calendarModel({ view: "week", date: "2026-11-26" }, today, visits);
    expect(next.weekStart).toBe("2026-11-22");
    expect(next.isNextWeek).toBe(true);
    expect(next.week[2]!.visits).toHaveLength(1);
    // A week further out or in the past falls back to the current week.
    for (const date of ["2026-11-29", "2026-11-08"]) expect(calendarModel({ view: "week", date }, today, visits).weekStart).toBe("2026-11-15");
    // Saturday: the strip runs into next week.
    expect(calendarModel({}, "2026-11-21", visits).lastStripDay).toBe("2026-11-27");
  });

  test("hour grid: 08-17 by default, widened to visits before 08:00 and after 17:00", () => {
    expect(hourRange([])).toEqual({ startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR });
    expect(hourRange([{ start: "09:00", end: "10:00" }])).toEqual({ startHour: 8, endHour: 17 });
    expect(hourRange([{ start: "07:00", end: "08:30" }])).toEqual({ startHour: 7, endHour: 17 });
    expect(hourRange([{ start: "06:45", end: "07:15" }])).toEqual({ startHour: 6, endHour: 17 });
    expect(hourRange([{ start: "17:30", end: "19:00" }])).toEqual({ startHour: 8, endHour: 19 });
    expect(hourRange([{ start: "16:00", end: "17:20" }])).toEqual({ startHour: 8, endHour: 18 });
    // Ending on a later day: runs to midnight.
    expect(hourRange([{ start: "22:00", end: "01:00" }])).toEqual({ startHour: 8, endHour: 24 });
  });

  test("blocks: placed from the grid start, at least 30 minutes, never past midnight", () => {
    const range = { startHour: 7, endHour: 19 };
    expect(blockBox({ start: "07:00", end: "08:30" }, range, 40)).toEqual({ top: 0, height: 60 });
    expect(blockBox({ start: "09:00", end: "09:00" }, range, 40)).toEqual({ top: 80, height: 20 });
    expect(visitSpan({ start: "23:50", end: "23:55" })).toEqual({ from: 23 * 60 + 30, to: 24 * 60 });
    expect(visitSpan({ start: "22:00", end: "01:00" })).toEqual({ from: 22 * 60, to: 24 * 60 });
  });
});
