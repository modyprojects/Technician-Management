import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addDays, weekStartOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { calendarRangeOf } from "@/lib/data/office-calendar";
import { seeded, submitSignIn } from "./helpers";
import { closeVisitAsPostgres, startVisitAsPostgres } from "./tech-calendar-fixtures";
import { attendeeOf, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the real "יומן טכנאים" (D94) at 390 and
// 1440 px (D72), from a local production build signed in as the Manager to the LOCAL stack
// (tests/auth/run-local.mjs). Every record is fictional and test-marked (D47): the visits are made
// through the invitation simulator's ingestion service under the Manager's session.
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

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function shoot(page: Page, url: string, name: string, sizes: readonly { width: number; height: number }[] = SIZES) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto(url);
    await ready(page);
    const png = path.join(OUT, `${size.width}-${name}.png`);
    await page.screenshot({ path: png, fullPage: size.width === 390 });
    execFileSync("convert", [png, "-quality", "80", png.replace(/\.png$/, ".webp")]);
    rmSync(png);
  }
}

test("screenshots: week, day, drawer, empty, range edge", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const { mgr } = seeded();
  const office = await signedInClient(mgr.email, mgr.password);
  const a = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const b = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
  const day = (offset: number) => addDays(weekStart, offset);
  const plan: [string, string, string, string, FictionalVisit][] = [
    [a, today, "08:30", "10:00", v("משפחת לוי", "רחובות", "הרצל 14", "ברז מטבח נשלף")],
    [a, today, "10:30", "12:00", v("רותם אלמוג", "חולון", "סוקולוב 3", "מסנן מים")],
    [b, today, "09:00", "10:30", v("יוסי מזרחי", "נס ציונה", "ויצמן 8", "מיכל הדחה סמוי")],
    [b, today, "11:00", "12:30", v("אילנה שגב", "יבנה", "הדקל 2", "סוללת אמבטיה")],
    [a, day(1), "09:00", "10:30", v("טל וינטר", "אשדוד", "הנמל 5", "ברז מטבח נשלף")],
    [b, day(2), "13:00", "14:00", v("ענת רוזן", "חולון", "המלאכה 9", "מסנן מים")],
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
  // The default of each device (D94 (b)): the week at 1440, the day at 390.
  await shoot(page, "/office/calendar", "default");
  await shoot(page, `/office/calendar?view=week&date=${today}`, "week", [SIZES[0]]);
  await shoot(page, `/office/calendar?view=day&date=${today}`, "day", [SIZES[1]]);
  await shoot(page, `/office/calendar?view=day&date=${today}&req=${first.req}&n=1`, "drawer");
  await shoot(page, `/office/calendar?view=week&date=${range.max}`, "range-edge");
});
