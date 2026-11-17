import path from "node:path";
import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { jerusalemToday } from "@/features/visits/data/today";
import { seeded, signInAs } from "./helpers";
import { attendeeOf, ensurePickupPlace, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the real technician home and visit card
// (Step 3; D62 (6): every state at 390, 820 and 1440 px), from a local production build signed in to
// the LOCAL stack (tests/auth/run-local.mjs). Every record is fictional and test-marked (D47): the
// visits are made through the invitation simulator's ingestion service under the Manager's session.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-screenshots.spec.ts
// SHOTS_DIR picks the folder (default docs/review/tech-today).
const OUT = path.resolve(process.env.SHOTS_DIR || "docs/review/tech-today");
const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const today = jerusalemToday();
const req = () => String(randomInt(40000, 99999));
const PLACE_A = "מרכז לוגיסטי ראשון לציון";
const PLACE_B = "סניף חולון";

export const DAY: { from: string; to: string; visit: FictionalVisit }[] = [
  {
    from: "08:30",
    to: "10:00",
    visit: { req: req(), task: "2", customerNo: `${randomInt(100000, 999999)}`, customer: "משפחת לוי", phone: "050-123-4567", city: "רחובות", street: "הרצל 14", building: "2", floor: "3", apt: "7", arrival: "קוד בכניסה 1234, חניה ברחוב", product: "מדיח כלים Bosch", sku: "dw-6040", desc: "המדיח לא מנקז מים בסוף התוכנית", warranty: "לא", collect: "משאבת ניקוז", collectFrom: PLACE_A, techNote: "להתקשר חצי שעה לפני ההגעה" },
  },
  {
    from: "11:00",
    to: "12:30",
    visit: { req: req(), customerNo: `${randomInt(100000, 999999)}`, customer: "משפחת כהן", phone: "052-765-4321", city: "נס ציונה", street: "ויצמן 3", product: "תנור בילט-אין Electra", sku: "ov-2210", desc: "התנור לא מתחמם מעל 100 מעלות", warranty: "כן · עד 03/2028", type: "התקנה", collect: "גוף חימום עליון", collectFrom: PLACE_A },
  },
  {
    from: "14:00",
    to: "15:00",
    visit: { req: req(), customerNo: `${randomInt(100000, 999999)}`, customer: "משפחת מזרחי", phone: "054-222-3344", city: "ראשון לציון", street: "רוטשילד 40", product: "מקרר Samsung", sku: "rf-8800", desc: "רעש חזק מהמדחס", warranty: "כן", collect: "מסנן מים", collectFrom: PLACE_B },
  },
];

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

/** One image per width: `<width>-<name>.png`; `bottom` scrolls the content to its end first. */
export async function shoot(page: Page, name: string, opts: { bottom?: boolean; dir?: string } = {}) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await ready(page);
    await page.evaluate((bottom) => {
      const main = document.querySelector(".ph-main");
      if (main) main.scrollTop = bottom ? main.scrollHeight : 0;
    }, Boolean(opts.bottom));
    await page.screenshot({ path: path.join(opts.dir ?? OUT, `${size.width}-${name}.png`) });
  }
}

test("technician home and visit card: review screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  const { tech, mgr } = seeded();
  await signInAs(page, tech, /\/tech$/);
  await shoot(page, "home-empty-day");

  const office = await signedInClient(mgr.email, mgr.password);
  ensurePickupPlace(PLACE_A, "המדע 6, ראשון לציון");
  ensurePickupPlace(PLACE_B, "המלאכה 12, חולון");
  const attendee = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const ids: string[] = [];
  for (const d of DAY) ids.push(await ingestVisit(office, attendee, today, d.from, d.to, d.visit));

  await page.goto("/tech");
  await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText("משפחת לוי");
  await shoot(page, "home-day");
  await page.getByRole("region", { name: "מה לאסוף לפני יציאה" }).getByRole("checkbox").first().check();
  await expect(page.getByRole("region", { name: "מה לאסוף לפני יציאה" })).toContainText("1 מתוך 3 נאסף");
  await shoot(page, "home-pickup-ticked");

  await page.goto(`/tech/visit/${ids[0]}`);
  await expect(page.getByRole("heading", { level: 1, name: "משפחת לוי" })).toBeVisible();
  await shoot(page, "visit-card");
  await page.goto(`/tech/visit/${ids[1]}`);
  await expect(page.getByRole("heading", { level: 1, name: "משפחת כהן" })).toBeVisible();
  await shoot(page, "visit-card-warranty");

  await page.goto("/tech/done");
  await expect(page.getByRole("heading", { level: 1, name: "הושלמו היום" })).toBeVisible();
  await shoot(page, "done-empty");

  await page.goto("/tech/visit/00000000-0000-4000-8000-000000000000");
  await shoot(page, "visit-not-found");
});
