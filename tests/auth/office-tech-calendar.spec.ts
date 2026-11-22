import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addDays, dayName, ddmm, weekStartOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { calendarRangeOf, officeCalendarQueriesOf } from "@/features/office-calendar/data/office-calendar";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, submitSignIn } from "./helpers";
import { attendeeOf, cancelVisitAsPostgres, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// "יומן טכנאים" (D88 office module 2; D94) on real data, against the LOCAL stack
// (tests/auth/run-local.mjs; never the remote project): the real sign-in and the real page of a
// production build. Visits are made through the invitation simulator's single ingestion service
// under the Manager's own session; everything is fictional and test-marked (D47). Records are found
// by this run's unique request numbers, never by row counts (the stack is shared).
//   node tests/auth/run-local.mjs [--with-creator] tests/auth/office-tech-calendar.spec.ts
// Covers D94: (a) Sunday to Saturday; (b) week on desktop, day on phone by default, the phone as
// one technician on the technician calendar's grids with "בחר טכנאי" (owner review 22.11); (c) `cal` on the
// server for the route and every read (Technicians blocked; with `cal` off: "אין הרשאה" and no data,
// Creator run only); (d) the range clamp and the arrows' edges; (e) read-only (no edit controls).

const run = randomBytes(3).toString("hex").toUpperCase();
const today = jerusalemToday();
const range = calendarRangeOf(today);
const weekStart = weekStartOf(today);
const saturday = addDays(weekStart, 6);

const base = (req: string, customer: string): FictionalVisit => ({
  req,
  customerNo: `C-${req}`,
  customer,
  phone: "050-000-0000",
  city: "נתניה",
  street: "הים 1",
  product: "מוצר בדיקה",
  sku: `sku-${req}`,
  desc: "תקלה לבדיקה",
});
const visits = {
  mine: base(`OC1-${run}`, `לקוחת יומן ${run}`),
  theirs: base(`OC2-${run}`, `לקוח יומן שני ${run}`),
  cancelled: base(`OC3-${run}`, `לקוח מבוטל ${run}`),
  far: base(`OC4-${run}`, `לקוח רחוק ${run}`),
};
const ids: Record<string, string> = {};

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

async function signedInPage(browser: Browser, user: SeededUser, home: RegExp, viewport = desktop): Promise<Page> {
  const context = await browser.newContext({ locale: "he-IL", viewport });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return page;
}

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

// A visit's block: the office grids mark it (data-cal-visit); the phone's technician-calendar grids link to its drawer.
const block = (page: Page, req: string) =>
  page.locator(`[data-calendar-block] a[data-cal-visit="${req}:1"], [data-calendar-block=phone] a[href*="req=${req}&n=1"]`).filter({ visible: true });

test.describe.serial("יומן טכנאים on real data (local stack)", () => {
  test("setup: visits through the invitation simulator (Manager session)", async () => {
    const { mgr } = seeded();
    const office = await signedInClient(mgr.email, mgr.password);
    const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
    const them = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
    ids.mine = await ingestVisit(office, me, today, "09:00", "10:30", visits.mine);
    // Saturday of this week: shown (D94 (a)).
    ids.theirs = await ingestVisit(office, them, saturday, "11:00", "12:00", visits.theirs);
    ids.cancelled = await ingestVisit(office, me, today, "13:00", "14:00", visits.cancelled);
    cancelVisitAsPostgres(ids.cancelled);
    // Four months ahead: outside the range (D94 (d)).
    ids.far = await ingestVisit(office, me, addDays(range.max, 20), "09:00", "10:00", visits.far);
    expect(localSqlValue(`select count(*) from public.visits where id in ('${ids.mine}', '${ids.theirs}', '${ids.far}') and is_test`)).toBe("3");
  });

  test("Manager, desktop: the week by default, Sunday to Saturday, test marker, cancelled never shown, read-only", async ({ browser }) => {
    const page = await signedInPage(browser, seeded().mgr, /\/office$/);
    await page.goto("/office/calendar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`יומן טכנאים · שבוע ${ddmm(weekStart)}–${ddmm(saturday)}`);
    const heads = page.locator("[data-calendar-block=desktop] .ocal-wk-head");
    await expect(heads).toHaveCount(7);
    await expect(heads.first()).toContainText(`ראשון ${ddmm(weekStart)}`);
    await expect(heads.last()).toContainText(`שבת ${ddmm(saturday)}`);
    await expect(block(page, visits.mine.req)).toContainText(visits.mine.customer);
    await expect(block(page, visits.mine.req)).toContainText(visits.mine.req);
    await expect(block(page, visits.mine.req)).toContainText("בדיקה");
    await expect(block(page, visits.theirs.req)).toContainText(visits.theirs.customer);
    await expect(page.getByText("מוצגים נתוני בדיקה")).toBeVisible();
    const html = await page.content();
    for (const absent of [visits.cancelled.req, visits.cancelled.customer, visits.far.req]) expect(html).not.toContain(absent);
    // D94 (e): read-only: no form, input, drag or edit control on the screen; the only select is the
    // phone's "בחר טכנאי" (navigation only, hidden on desktop).
    const main = page.locator("main");
    await expect(main.locator("form, input, textarea, [draggable=true], [contenteditable=true]")).toHaveCount(0);
    await expect(main.locator("select")).toHaveCount(1);
    await expect(main.locator("[data-calendar-block=phone] select[data-tech-select]")).toBeHidden();
    await expect(main.getByRole("button")).toHaveCount(0);
    await expect(page.getByText("תצוגה בלבד").first()).toBeVisible();
    await expect(page.locator("[data-calendar-block=desktop] .ocal-chips")).toBeVisible();

    // A block opens the drawer; the Manager has `calls`, so it links to the call card.
    await block(page, visits.mine.req).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(visits.mine.customer);
    await expect(drawer).toContainText("09:00");
    await expect(drawer.getByRole("link", { name: /לכרטיס הקריאה/ })).toHaveAttribute("href", `/office/calls/${visits.mine.req}`);
    await page.context().close();
  });

  test("day view and technician filter; the range clamp and the arrows' edges (D94 (d))", async ({ browser }) => {
    const page = await signedInPage(browser, seeded().mgr, /\/office$/);
    const tech2 = process.env.AUTH_E2E_TECH2_ROW ?? "";
    await page.goto(`/office/calendar?view=day&date=${saturday}&tech=${tech2}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`יומן טכנאים · ${dayName(saturday)} ${ddmm(saturday)}`);
    await expect(block(page, visits.theirs.req)).toBeVisible();
    await expect(page.locator("[data-calendar-block=desktop] .calhead > div")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "כולם" }).filter({ visible: true })).not.toHaveAttribute("aria-current", "true");

    // Far ahead: clamped to the last day; "next" is disabled; the far visit is never read.
    await page.goto(`/office/calendar?view=day&date=${addDays(range.max, 20)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`יומן טכנאים · ${dayName(range.max)} ${ddmm(range.max)}`);
    const steps = page.locator("[data-calendar-block=desktop] .ocal-steps");
    await expect(steps.locator('[aria-disabled="true"]')).toHaveAttribute("aria-label", /יום הבא/);
    await expect(steps.getByRole("link", { name: "יום קודם" })).toHaveAttribute("href", new RegExp(`date=${addDays(range.max, -1)}`));
    // Far back: clamped to the first day; "previous" is disabled.
    await page.goto("/office/calendar?view=day&date=2020-01-01");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`יומן טכנאים · ${dayName(range.min)} ${ddmm(range.min)}`);
    await expect(steps.locator('[aria-disabled="true"]')).toHaveAttribute("aria-label", /יום קודם/);
    // The week at the edge: the days outside the range are greyed, the next week is disabled.
    await page.goto(`/office/calendar?view=week&date=${range.max}`);
    await expect(steps.locator('[aria-disabled="true"]')).toHaveAttribute("aria-label", /השבוע הבא/);
    // A drawer outside the range opens nothing, even by its exact address.
    await page.goto(`/office/calendar?view=week&date=${range.max}&req=${visits.far.req}&n=1`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.content()).not.toContain(visits.far.customer);
    await page.context().close();
  });

  test("Customer Service, phone: the day by default (D94 (b)), one technician from \"בחר טכנאי\", the hour grid, the week, the drawer", async ({ browser }) => {
    const page = await signedInPage(browser, seeded().cs, /\/office\/calls$/, phone);
    const mine = process.env.AUTH_E2E_TECH_ROW ?? "";
    const them = process.env.AUTH_E2E_TECH2_ROW ?? "";
    await page.goto("/office/calendar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`יומן טכנאים · ${dayName(today)} ${ddmm(today)}`);
    // Owner review 22.11: a dropdown instead of the chips; no explanation line, no legend.
    const select = page.getByRole("combobox", { name: "בחר טכנאי" });
    await expect(select).toBeVisible();
    await expect(page.locator(".ocal-chips").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByText("תצוגה בלבד").filter({ visible: true })).toHaveCount(0);
    await expect(page.locator(".ocal-legend").filter({ visible: true })).toHaveCount(0);
    // Default: the first technician; choosing one puts it in the address.
    const firstOption = await select.locator("option").first().getAttribute("value");
    await expect(select).toHaveValue(firstOption ?? "");
    await select.selectOption(mine);
    await expect(page).toHaveURL(new RegExp(`tech=${mine}`));
    // The technician calendar's day: the week's day strip and the hour grid with the block.
    await expect(page.getByRole("group", { name: "ימי השבוע" }).filter({ visible: true })).toBeVisible();
    await expect(block(page, visits.mine.req)).toContainText(visits.mine.customer);
    await expect(block(page, visits.theirs.req)).toHaveCount(0);
    // An unknown technician falls back to the first.
    await page.goto("/office/calendar?tech=00000000-0000-4000-8000-000000000000");
    await expect(select).toHaveValue(firstOption ?? "");
    // The week: the technician calendar's 7 columns, the other technician's Saturday visit.
    await page.goto(`/office/calendar?view=week&tech=${them}`);
    await expect(page.locator("[data-calendar-block=phone] [role=group][aria-label^='שבת']")).toBeVisible();
    await expect(block(page, visits.theirs.req)).toContainText(visits.theirs.req);
    await expect(block(page, visits.mine.req)).toHaveCount(0);
    await page.goto(`/office/calendar?tech=${mine}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await block(page, visits.mine.req).click();
    await expect(page.getByRole("dialog")).toContainText(visits.mine.customer);
    await page.context().close();
  });

  test("a Technician is blocked: the route and the data (D94 (c))", async ({ browser }) => {
    const { tech } = seeded();
    const page = await signedInPage(browser, tech, /\/tech$/);
    await page.goto("/office/calendar");
    await expect(page).not.toHaveURL(/\/office\/calendar/);
    expect(await page.content()).not.toContain(visits.mine.req);
    await page.context().close();
    // Under his own session, even claiming an office role, `cal` is false: nothing is read.
    const client = await signedInClient(tech.email, tech.password);
    const q = officeCalendarQueriesOf(client, { role: "mgr" }, true);
    expect(await q.permitted()).toBe(false);
    expect((await q.week(today, range)).visits).toEqual([]);
    expect(await q.visit({ req: visits.mine.req, n: 1 }, range)).toBeNull();
  });

  test("Creator turns `cal` off for Customer Service: \"אין הרשאה\" and no data (D94 (c))", async ({ browser }) => {
    const c = creator();
    test.skip(!c, "needs the local Creator (--with-creator)");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect((await db.auth.signInWithPassword({ email: c!.email, password: c!.password })).error).toBeNull();
    const version = () => Number(localSqlValue("select version from public.role_permissions where role = 'customer_service' and permission_key = 'cal'"));
    const set = async (allowed: boolean) => {
      const { error } = await db.rpc("admin_set_role_permission", {
        p_role: "customer_service",
        p_key: "cal",
        p_allowed: allowed,
        p_expected_version: version(),
        p_reason: "office calendar test (local stack)",
      });
      expect(error).toBeNull();
    };
    await set(false);
    try {
      const { cs } = seeded();
      const page = await signedInPage(browser, cs, /\/office\/calls$/);
      await page.goto(`/office/calendar?req=${visits.mine.req}&n=1`);
      await expect(page.getByRole("heading", { level: 2, name: "אין הרשאה" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // The address itself names the request number; the screen shows nothing of the visit.
      await expect(page.locator("main")).not.toContainText(visits.mine.req);
      expect(await page.content()).not.toContain(visits.mine.customer);
      await page.context().close();
      const client = await signedInClient(cs.email, cs.password);
      const q = officeCalendarQueriesOf(client, { role: "cs" }, true);
      expect(await q.permitted()).toBe(false);
      expect(await q.week(today, range)).toEqual({ visits: [], technicians: [], capped: false });
      expect(await q.visit({ req: visits.mine.req, n: 1 }, range)).toBeNull();
    } finally {
      await set(true);
      await db.auth.signOut({ scope: "local" });
    }
  });
});
