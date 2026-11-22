import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addDays, weekStartOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { calendarRangeOf } from "@/features/office-calendar/data/office-calendar";
import { localSql, seeded, submitSignIn } from "./helpers";
import { closeVisitAsPostgres, startVisitAsPostgres } from "./tech-calendar-fixtures";
import { attendeeOf, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the real "יומן טכנאים" (D94; the phone as
// amended by the owner's review of 22.11, D97; the desktop as amended by batch 2 of 22.11) at 390 and
// 1440 px (D72), from a local production build signed in as the Manager to the LOCAL stack
// (tests/auth/run-local.mjs). Every record is fictional and test-marked (D47): the visits are made
// through the invitation simulator's ingestion service under the Manager's session; the extra
// technicians are fictional, test-marked rows with fixed ids (made once, reused: a rerun adds none).
// Reset the local stack first (supabase db reset) so earlier runs' technicians are gone.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-tech-calendar-screenshots.spec.ts
// WebP files land in SHOTS_DIR (default docs/review/office-tech-calendar).
const OUT = path.resolve(process.env.SHOTS_DIR || "docs/review/office-tech-calendar");
const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const today = jerusalemToday();
const weekStart = weekStartOf(today);
const range = calendarRangeOf(today);
const v = (customer: string, city: string, street: string, product: string): FictionalVisit => ({
  req: String(randomInt(70000, 79999)),
  customerNo: String(randomInt(100000, 999999)),
  customer,
  phone: "050-123-4567",
  city,
  street,
  product,
  sku: `sku-${randomInt(1000, 9999)}`,
  desc: "נזילה מתחת לכיור (בדיקה)",
});

/** Fictional technicians: 4 for a realistic team (6 with the two seeded ones), then 16 more for the many-technicians shots. */
const TEAM = ["אורי בדיקה", "דנה בדיקה", "מאיר בדיקה", "שירה בדיקה"];
const MANY = Array.from({ length: 16 }, (_, i) => `טכנאי נוסף ${i + 1} בדיקה`);
const COLORS = ["t-y", "t-e", "t-s"];
const extraId = (i: number) => `0e7c0000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;

/** Makes (or reuses) the fictional technicians `names` from index `from`, accepting invitations or not. */
function extraTechnicians(names: readonly string[], from: number, accepts: boolean): string[] {
  const ids = names.map((_, i) => extraId(from + i));
  const rows = names.map((name, i) => ({ id: ids[i]!, name, email: `otc-shot-${from + i + 1}@example.test`, color: COLORS[(from + i) % COLORS.length]! }));
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  localSql(`begin;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values ${rows.map((r) => `(${q(r.id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${q(r.email)}, now(), now())`).join(", ")}
  on conflict (id) do nothing;
insert into public.profiles (id, role, full_name, is_active, is_test)
  values ${rows.map((r) => `(${q(r.id)}, 'technician', ${q(r.name)}, true, true)`).join(", ")}
  on conflict (id) do nothing;
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, accepts_invitations)
  values ${rows.map((r) => `(${q(r.id)}, ${q(r.id)}, true, ${q(r.name)}, ${q(r.color)}, ${q(r.email)}, ${accepts})`).join(", ")}
  on conflict (id) do update set accepts_invitations = excluded.accepts_invitations;
commit;`);
  return ids;
}

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function save(page: Page, name: string, fullPage: boolean) {
  const png = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: png, fullPage });
  execFileSync("convert", [png, "-quality", "80", png.replace(/\.png$/, ".webp")]);
  rmSync(png);
}

/**
 * `url` at each size; `phoneTech` is added to the phone's address (the phone shows one technician,
 * D97); `before` runs after the page is ready (e.g. to show the dropdown's options).
 */
async function shoot(
  page: Page,
  url: string,
  name: string,
  sizes: readonly { width: number; height: number }[] = SIZES,
  phoneTech = "",
  before?: (page: Page) => Promise<void>,
) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto(size.width === 390 && phoneTech ? `${url}${url.includes("?") ? "&" : "?"}tech=${phoneTech}` : url);
    await ready(page);
    if (before) await before(page);
    await save(page, `${size.width}-${name}`, size.width === 390);
  }
}

/** The page's own sideways overflow: the document and the app's scroller (.stage) against the viewport. */
async function overflowOf(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage");
    const side = document.querySelector<HTMLElement>(".side")?.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>("[data-calendar-block=desktop] [data-day-scroll]");
    return {
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      stageScrollWidth: stage?.scrollWidth ?? 0,
      stageClientWidth: stage?.clientWidth ?? 0,
      sidebar: side ? { left: Math.round(side.left), right: Math.round(side.right), width: Math.round(side.width) } : null,
      calendarScrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : null,
    };
  });
}

test("screenshots: week, day, drawer, technician filter, range edge, many technicians", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const { mgr } = seeded();
  const office = await signedInClient(mgr.email, mgr.password);
  // A realistic team: the two seeded technicians and four more; the many-technicians set is hidden
  // (not accepting invitations, no visits) until its own shots.
  const team = extraTechnicians(TEAM, 0, true);
  const many = extraTechnicians(MANY, TEAM.length, false);
  const a = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const b = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
  const c = await attendeeOf(office, team[0]!);
  const d = await attendeeOf(office, team[1]!);
  const day = (offset: number) => addDays(weekStart, offset);
  const plan: [string, string, string, string, FictionalVisit][] = [
    [a, today, "08:30", "10:00", v("משפחת לוי", "רחובות", "הרצל 14", "ברז מטבח נשלף")],
    [a, today, "10:30", "12:00", v("רותם אלמוג", "חולון", "סוקולוב 3", "מסנן מים")],
    [b, today, "09:00", "10:30", v("יוסי מזרחי", "נס ציונה", "ויצמן 8", "מיכל הדחה סמוי")],
    [b, today, "11:00", "12:30", v("אילנה שגב", "יבנה", "הדקל 2", "סוללת אמבטיה")],
    [c, today, "08:00", "09:00", v("גלית פרץ", "ראשון לציון", "הרצל 70", "מסנן מים")],
    [d, today, "13:00", "14:30", v("עמית נחום", "רמלה", "הגפן 4", "ברז מטבח נשלף")],
    [a, day(1), "09:00", "10:30", v("טל וינטר", "אשדוד", "הנמל 5", "ברז מטבח נשלף")],
    [b, day(2), "13:00", "14:00", v("ענת רוזן", "חולון", "המלאכה 9", "מסנן מים")],
    [c, day(3), "10:00", "11:30", v("משה דהן", "גדרה", "הבנים 6", "סוללת אמבטיה")],
    [a, day(4), "08:00", "09:30", v("משפחת חדד", "בת ים", "בלפור 21", "סוללת אמבטיה")],
    [b, day(5), "10:00", "11:00", v("נועה ברק", "לוד", "הרצל 40", "מסנן מים")],
  ];
  const ids: string[] = [];
  for (const [who, date, from, to, visit] of plan) ids.push(await ingestVisit(office, who, date, from, to, visit));
  closeVisitAsPostgres(ids[0]!, "הוחלף ראש ברז בדיקה");
  startVisitAsPostgres(ids[1]!, "in_progress");
  startVisitAsPostgres(ids[2]!, "en_route");
  const first = plan[0]![4];

  await submitSignIn(page, mgr.email, mgr.password);
  await expect(page).toHaveURL(/\/office$/);
  // The default of each device (D94 (b)): the week at 1440, the day at 390 (one technician: the
  // first one with visits is chosen in the address, as "בחר טכנאי" does).
  const techA = process.env.AUTH_E2E_TECH_ROW ?? "";
  const techB = process.env.AUTH_E2E_TECH2_ROW ?? "";
  await shoot(page, "/office/calendar", "default", SIZES, techA);
  await shoot(page, `/office/calendar?view=week&date=${today}`, "week", [SIZES[0]], techA);
  await shoot(page, `/office/calendar?view=day&date=${today}`, "day", [SIZES[1]]);
  await shoot(page, `/office/calendar?view=day&date=${today}&req=${first.req}&n=1`, "drawer", SIZES, techA);
  await shoot(page, `/office/calendar?view=week&date=${range.max}`, "range-edge", SIZES, techA);
  // "בחר טכנאי" with its options: a phone opens the system picker, which a page screenshot cannot
  // show, so the list is drawn in place (up to 8 rows) for the image only.
  await shoot(page, "/office/calendar", "tech-select", [SIZES[0]], techA, async (p) => {
    await p.locator("[data-calendar-block=phone] select[data-tech-select]").evaluate((el) => {
      const select = el as HTMLSelectElement;
      select.size = Math.min(select.options.length, 8);
    });
  });
  // Batch 2: the desktop's "טכנאים" list open, two technicians of the team chosen.
  await shoot(page, `/office/calendar?view=week&date=${today}&techs=${techA},${techB}`, "filter-open", [SIZES[1]], "", async (p) => {
    const button = p.locator("[data-calendar-block=desktop] [data-tech-filter] button");
    await expect(button).toContainText("2 טכנאים");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(p.locator("[data-calendar-block=desktop] [data-tech-filter] input[type=checkbox]:checked")).toHaveCount(2);
  });

  // Many technicians (22): the day view keeps a readable column per technician and scrolls sideways
  // inside the calendar, the hours fixed; the page itself never scrolls sideways.
  extraTechnicians(MANY, TEAM.length, true);
  try {
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/office/calendar?view=day&date=${today}`);
    await ready(page);
    await expect(page.locator("[data-calendar-block=desktop] .calhead > div")).toHaveCount(1 + 6 + many.length);
    await save(page, "1440-day-many", false);
    // Scrolled part of the way: the hour column stays.
    await page.locator("[data-calendar-block=desktop] [data-day-scroll]").evaluate((el) => {
      el.scrollLeft = -(el.scrollWidth - el.clientWidth) / 2;
    });
    await save(page, "1440-day-many-scrolled", false);
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["day", "week"]) {
        await page.goto(`/office/calendar?view=${view}&date=${today}`);
        await ready(page);
        if (view === "week") await page.locator("[data-calendar-block=desktop] [data-tech-filter] button").click();
        const m = await overflowOf(page);
        console.log(`many technicians (22) ${view} @${width}: ${JSON.stringify(m)}`);
        expect(m.documentScrollWidth).toBe(m.viewport);
        expect(m.stageScrollWidth).toBe(m.stageClientWidth);
        expect(m.sidebar?.width).toBe(220);
        expect(m.sidebar?.right).toBe(width);
        if (view === "day") expect(m.calendarScrolls).toBe(true);
      }
    }
  } finally {
    extraTechnicians(MANY, TEAM.length, false);
  }
});

// D60 (4), D96: Customer Service's menu with `cal`: "יומן טכנאים", "קריאות", "זימונים שלא נקלטו".
test("screenshots: Customer Service navigation", async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const { cs } = seeded();
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    await submitSignIn(page, cs.email, cs.password);
    await expect(page).toHaveURL(/\/office\/calls$/);
    if (size.width === 390) {
      const menu = page.getByRole("button", { name: /תפריט/ });
      if (await menu.count()) await menu.first().click();
    }
    await ready(page);
    await save(page, `${size.width}-cs-nav`, false);
    await context.close();
  }
});
