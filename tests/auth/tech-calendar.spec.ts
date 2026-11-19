import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { calendarWindow } from "@/components/tech/calendar/model";
import { addDays, ddmm, weekdayOf } from "@/features/calendar/data/dates";
import { techVisitsQueriesOf } from "@/features/visits/supabase/tech";
import { jerusalemToday } from "@/features/visits/data/today";
import { seeded, signInAs } from "./helpers";
import { closeVisitAsPostgres } from "./tech-calendar-fixtures";
import { attendeeOf, cancelVisitAsPostgres, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// The technician calendar (D85, D89) on real data, against the LOCAL stack (tests/auth/run-local.mjs):
// the real sign-in and the real page of a production build. Visits are created through the invitation
// simulator's single ingestion service under the Manager's own session; everything is fictional and
// test-marked (D47). Covers: the technician sees only his own visits, by the query under his session
// (RLS: asking for another technician's id returns nothing) and on the page; the other technician
// sees his and not ours; cancelled never shown; a visit left open on a previous day is not shown and
// a closed one is, reduced (D79); the grid widens to a 07:00 visit; the week label is start–end; a
// block opens the visit card; "today" cannot be overridden from the URL.

const run = randomBytes(3).toString("hex");
const today = jerusalemToday();
const span = calendarWindow(today);
const yesterday = addDays(today, -1);
const hasPastDay = weekdayOf(today) > 0;

const base = (req: string, customer: string, street: string): FictionalVisit => ({
  req,
  customerNo: `C-${req}`,
  customer,
  phone: "050-000-0000",
  city: "חיפה",
  street,
  product: "מוצר בדיקה",
  sku: `sku-${req}`,
  desc: "תקלה לבדיקה",
});
const mine = {
  early: base(`K1-${run}`, "לקוח מוקדם בדיקה", "הנמל 1"),
  noon: base(`K2-${run}`, "לקוח צהריים בדיקה", "הנמל 2"),
  tomorrow: base(`K3-${run}`, "לקוח מחר בדיקה", "הנמל 3"),
  cancelled: base(`K4-${run}`, "לקוח מבוטל בדיקה", "הנמל 4"),
  pastOpen: base(`K5-${run}`, "לקוח פתוח מאתמול בדיקה", "הנמל 5"),
  pastClosed: base(`K6-${run}`, "לקוח סגור מאתמול בדיקה", "הנמל 6"),
};
const other = base(`KO-${run}`, "לקוח של טכנאי אחר בדיקה", "הנמל 9");
const ids: Record<string, string> = {};

test.describe.serial("technician calendar on real data (local stack)", () => {
  test("setup: visits through the invitation simulator (Manager session)", async () => {
    const { mgr } = seeded();
    const office = await signedInClient(mgr.email, mgr.password);
    const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
    const them = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
    ids.early = await ingestVisit(office, me, today, "07:00", "08:30", mine.early);
    ids.noon = await ingestVisit(office, me, today, "12:00", "13:00", mine.noon);
    ids.tomorrow = await ingestVisit(office, me, addDays(today, 1), "17:30", "19:00", mine.tomorrow);
    ids.cancelled = await ingestVisit(office, me, today, "15:00", "16:00", mine.cancelled);
    ids.other = await ingestVisit(office, them, today, "10:00", "11:00", other);
    cancelVisitAsPostgres(ids.cancelled);
    if (hasPastDay) {
      ids.pastOpen = await ingestVisit(office, me, yesterday, "09:00", "10:00", mine.pastOpen);
      ids.pastClosed = await ingestVisit(office, me, yesterday, "11:00", "12:00", mine.pastClosed);
      closeVisitAsPostgres(ids.pastClosed, "הוחלף חלק בדיקה");
    }
  });

  test("the query under the technician's session: his own visits only (RLS)", async () => {
    const { tech, tech2 } = seeded();
    const techRow = process.env.AUTH_E2E_TECH_ROW ?? "";
    const tech2Row = process.env.AUTH_E2E_TECH2_ROW ?? "";
    const client = await signedInClient(tech.email, tech.password);
    const own = await techVisitsQueriesOf(client, { technicianId: techRow, name: tech.name }).calendar(span.from, span.to, today);
    const ownIds = own.map((v) => v.id);
    expect(ownIds).toEqual(expect.arrayContaining([ids.early, ids.noon, ids.tomorrow]));
    expect(ownIds).not.toContain(ids.other);
    expect(ownIds).not.toContain(ids.cancelled);
    expect(own.find((v) => v.id === ids.early)).toMatchObject({ request: mine.early.req, start: "07:00", end: "08:30", status: "new", isTest: true, date: today });
    // Negative: asking for the other technician's id under this session returns nothing.
    expect(await techVisitsQueriesOf(client, { technicianId: tech2Row, name: tech.name }).calendar(span.from, span.to, today)).toEqual([]);
    // The other technician sees his visit and none of ours.
    const client2 = await signedInClient(tech2.email, tech2.password);
    const theirs = (await techVisitsQueriesOf(client2, { technicianId: tech2Row, name: tech2.name }).calendar(span.from, span.to, today)).map((v) => v.id);
    expect(theirs).toEqual([ids.other]);
    // The window is bounded (two weeks at most).
    await expect(techVisitsQueriesOf(client, { technicianId: techRow, name: tech.name }).calendar(span.from, addDays(span.from, 14), today)).rejects.toThrow(/invalid-range/);
  });

  test("daily view: own visits with request number, status chip, legend; grid widened to 07:00", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto("/tech/calendar?today=2020-01-06");
    const day = page.getByRole("region", { name: /^ביקורים ביום/ });
    await expect(day).toContainText(`${mine.early.req} · ${mine.early.customer} · 07:00`);
    await expect(day).toContainText(mine.noon.req);
    await expect(day).toContainText("שובצה");
    await expect(day).toContainText("07:00");
    await expect(page.getByRole("note", { name: "מקרא צבעים" })).toHaveText(/שובצה.*בטיפול.*טופל.*המשך טיפול/);
    await expect(page.getByText("מוצגים נתוני בדיקה")).toBeVisible();
    // "today" is the server's: the URL's today= is ignored (the strip starts at today).
    await expect(page.getByRole("group", { name: "הימים הקרובים" }).getByRole("link").first()).toHaveAttribute("href", `/tech/calendar?view=day&date=${today}`);
    const html = await page.content();
    for (const absent of [other.req, other.customer, mine.cancelled.req, mine.pastOpen.req]) expect(html).not.toContain(absent);
  });

  test("weekly view: start–end label, past day closed visit reduced, open one from yesterday hidden", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto("/tech/calendar?view=week");
    await expect(page.locator("bdi.time-range")).toHaveText(`${ddmm(span.from)}–${ddmm(addDays(span.from, 6))}`);
    const html = await page.content();
    for (const absent of [other.req, other.customer, mine.cancelled.req, mine.pastOpen.req, mine.pastOpen.street]) expect(html).not.toContain(absent);
    if (hasPastDay) {
      const closed = page.locator(`a[href="/tech/visit/${ids.pastClosed}"]`);
      await expect(closed).toHaveAttribute("aria-label", /הנמל 6, חיפה · טופל · הוחלף חלק בדיקה/);
    }
    await page.goto(`/tech/calendar?view=week&date=${addDays(span.from, 7)}`);
    await expect(page.locator("bdi.time-range")).toHaveText(`${ddmm(addDays(span.from, 7))}–${ddmm(span.to)}`);
  });

  test("a block opens the visit card of that visit; the other technician never sees ours", async ({ page, browser }) => {
    const { tech, tech2 } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto("/tech/calendar");
    await page.locator(`a[href="/tech/visit/${ids.noon}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.noon}$`));
    await expect(page.getByRole("heading", { level: 1, name: mine.noon.customer })).toBeVisible();

    const ctx = await browser.newContext();
    const page2 = await ctx.newPage();
    await signInAs(page2, tech2, /\/tech$/);
    for (const path of ["/tech/calendar", "/tech/calendar?view=week"]) {
      await page2.goto(path);
      const html = await page2.content();
      expect(html).toContain(other.req);
      for (const v of Object.values(mine)) expect(html).not.toContain(v.req);
    }
    await ctx.close();
  });
});
