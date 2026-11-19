import path from "node:path";
import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { calendarWindow } from "@/components/tech/calendar/model";
import { addDays, weekdayOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { seeded, signInAs } from "./helpers";
import { closeVisitAsPostgres, startVisitAsPostgres } from "./tech-calendar-fixtures";
import { attendeeOf, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the real technician calendar (D85, D89) at
// 390 and 820 px (D70), from a local production build signed in to the LOCAL stack
// (tests/auth/run-local.mjs). Every record is fictional and test-marked (D47): the visits are made
// through the invitation simulator's ingestion service under the Manager's session.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-calendar-screenshots.spec.ts
// PNGs land in SHOTS_DIR (default docs/review/tech-calendar) and are converted to WebP afterwards.
const OUT = path.resolve(process.env.SHOTS_DIR || "docs/review/tech-calendar");
const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const today = jerusalemToday();
const span = calendarWindow(today);
const req = () => String(randomInt(70000, 79999));
const v = (customer: string, city: string, street: string, product: string): FictionalVisit => ({
  req: req(),
  customerNo: String(randomInt(100000, 999999)),
  customer,
  phone: "050-123-4567",
  city,
  street,
  product,
  sku: `sku-${randomInt(1000, 9999)}`,
  desc: "תקלה לבדיקה",
});

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function shoot(page: Page, name: string, bottom = false) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await ready(page);
    await page.evaluate((b) => {
      const main = document.querySelector(".ph-main");
      if (main) main.scrollTop = b ? main.scrollHeight : 0;
    }, bottom);
    await page.screenshot({ path: path.join(OUT, `${size.width}-${name}.png`) });
  }
}

test("technician calendar: review screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  const { tech, mgr } = seeded();
  const office = await signedInClient(mgr.email, mgr.password);
  const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const add = (date: string, from: string, to: string, visit: FictionalVisit) => ingestVisit(office, me, date, from, to, visit);

  // Today: closed, in progress, scheduled.
  const t1 = await add(today, "08:00", "09:30", v("מאפיית הגליל", "חיפה", "הנמל 12", "מכונת קפה"));
  const t2 = await add(today, "10:00", "11:30", v("קליניקת שמש", "קריית אתא", "הרצל 8", "מזגן מרכזי"));
  await add(today, "13:00", "14:30", v("דפוס אלון", "נשר", "התעשייה 4", "מדפסת תעשייתית"));
  closeVisitAsPostgres(t1, "הוחלף גוף חימום");
  startVisitAsPostgres(t2, "in_progress");
  // Tomorrow: outside 08:00-17:00. The day after: empty.
  const outside = addDays(today, 1);
  await add(outside, "07:00", "08:30", v("מלון הים", "נהריה", "הגעתון 2", "מערכת השקיה"));
  await add(outside, "10:00", "11:00", v("סופר הצפון", "עכו", "ויצמן 31", "מקרר תעשייתי"));
  await add(outside, "17:30", "19:00", v("בית קפה הנמל", "חיפה", "המגדלור 5", "מכונת קפה"));
  const empty = addDays(today, 2);
  // Past days of this week: closed visits (reduced) and one left open (not shown).
  if (weekdayOf(today) > 0) {
    const y = addDays(today, -1);
    const p1 = await add(y, "09:00", "10:30", v("משרדי נוף", "חיפה", "מוריה 90", "מערכת אזעקה"));
    const p2 = await add(y, "12:00", "13:00", v("סופר הצפון", "עכו", "ויצמן 31", "מקרר תעשייתי"));
    await add(y, "15:00", "16:00", v("פתוח מאתמול", "נשר", "הגפן 1", "מזגן"));
    closeVisitAsPostgres(p1, "הותקן חיישן חדש");
    closeVisitAsPostgres(p2, "ממתין לחלק", "followup");
  }
  if (weekdayOf(today) > 1) {
    const p3 = await add(addDays(today, -2), "10:00", "11:30", v("קליניקת שמש", "קריית אתא", "הרצל 8", "מזגן מרכזי"));
    closeVisitAsPostgres(p3, "נוקה מסנן");
  }
  // Next week.
  const next = addDays(span.from, 7);
  await add(next, "08:00", "09:30", v("מרכז רפואי גל", "חיפה", "בן גוריון 22", "מזגן מרכזי"));
  await add(next, "10:30", "12:00", v("בית קפה הנמל", "חיפה", "המגדלור 5", "מכונת קפה"));
  await add(addDays(next, 2), "13:00", "14:30", v("מלון הים", "נהריה", "הגעתון 2", "מערכת השקיה"));
  await add(addDays(next, 4), "09:30", "11:00", v("בית ספר הדס", "קריית ביאליק", "הדס 3", "מקרן"));

  await signInAs(page, tech, /\/tech$/);
  await page.goto("/tech/calendar");
  await expect(page.getByRole("note", { name: "מקרא צבעים" })).toBeVisible();
  await shoot(page, "daily");
  await page.goto(`/tech/calendar?view=day&date=${outside}`);
  await shoot(page, "outside-hours");
  await page.goto(`/tech/calendar?view=day&date=${empty}`);
  await expect(page.getByText("אין ביקורים")).toBeVisible();
  await shoot(page, "empty-day");
  await page.goto("/tech/calendar?view=week");
  await shoot(page, "weekly");
  await shoot(page, "weekly-bottom", true);
  await page.goto(`/tech/calendar?view=week&date=${next}`);
  await shoot(page, "next-week");
});
