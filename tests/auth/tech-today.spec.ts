import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { addDays } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { seeded, signInAs } from "./helpers";
import { attendeeOf, cancelVisitAsPostgres, ensurePickupPlace, ingestVisit, signedInClient } from "./tech-fixtures";

// Step 3, the technician home "היום" and the visit card, against the LOCAL stack (tests/auth/run-local.mjs),
// through the real sign-in and the real pages of a production build. Visits are created through the
// invitation simulator's single ingestion service under the Manager's own session (tech-fixtures.ts);
// everything is fictional and test-marked (D47). Covers: the technician sees only his own visits
// (RLS); another technician's visit id answers "not found" with nothing of it rendered; office roles
// get the no-access state; a cancelled visit is never listed, counted or opened (D60 (1)); the
// counters and the next visit come from the server's rows (QA T-02 view); the pickup card is hidden
// on a day without pickups and its "נאסף" tick is kept on the device, labelled (T-07, TE-03
// TEMPORARY); the visit card's fields and links (TE-07 to TE-12, D60 (3)).

const run = randomBytes(3).toString("hex");
const today = jerusalemToday();
const PLACE = "מרכז לוגיסטי בדיקה";

const mine = {
  first: { req: `T1-${run}`, customerNo: `C1-${run}`, customer: "משפחת לוי בדיקה", phone: "050-123-4567", city: "רחובות", street: "הרצל 14", building: "2", floor: "3", apt: "7", arrival: "קוד בכניסה 1234", product: "מדיח כלים בדיקה", sku: `dw-${run}`, desc: "המדיח לא מסנן מים", warranty: "לא", collect: "משאבת ניקוז", collectFrom: PLACE, techNote: "להתקשר חצי שעה לפני" },
  second: { req: `T2-${run}`, customerNo: `C2-${run}`, customer: "משפחת כהן בדיקה", phone: "052-765-4321", city: "נס ציונה", street: "ויצמן 3", product: "תנור בדיקה", sku: `ov-${run}`, desc: "התנור לא מתחמם", warranty: "כן · עד 03/2028", type: "התקנה" },
  cancelled: { req: `T3-${run}`, customerNo: `C3-${run}`, customer: "משפחת מבוטלת בדיקה", phone: "053-111-2222", city: "לוד", street: "הנשיא 1", product: "מקרר בדיקה", sku: `fr-${run}`, desc: "רעש" },
  tomorrow: { req: `T4-${run}`, customerNo: `C4-${run}`, customer: "משפחת מחר בדיקה", phone: "054-333-4444", city: "יבנה", street: "הדקל 5", product: "מזגן בדיקה", sku: `ac-${run}`, desc: "לא מקרר" },
};
const other = { req: `O1-${run}`, customerNo: `OC-${run}`, customer: "משפחת זר בדיקה", phone: "058-999-8888", city: "חולון", street: "סוקולוב 9", product: "מכונת כביסה בדיקה", sku: `wm-${run}`, desc: "לא סוחטת" };

const ids: { first?: string; second?: string; cancelled?: string; other?: string } = {};

async function homeOf(page: Page) {
  await page.goto("/tech");
  await expect(page).toHaveURL(/\/tech$/);
}

test.describe.serial("technician home and visit card (Step 3, local stack)", () => {
  test("an empty day: the next-visit message, no pickup card, zero counters", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(tech.name);
    await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText("אין ביקורים מתוכננים להיום");
    await expect(page.getByRole("region", { name: "מה לאסוף לפני יציאה" })).toHaveCount(0);
    await expect(page.getByText("אין עוד ביקורים היום")).toBeVisible();
    await expect(page.locator(".stat").nth(0)).toContainText("0");
    await expect(page.locator(".stat").nth(1)).toContainText("0");
  });

  test("setup: visits through the invitation simulator (Manager session)", async () => {
    const { mgr } = seeded();
    const office = await signedInClient(mgr.email, mgr.password);
    ensurePickupPlace(PLACE, "דרך השלום 10, תל אביב");
    const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
    const them = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
    ids.second = await ingestVisit(office, me, today, "12:00", "13:30", mine.second);
    ids.first = await ingestVisit(office, me, today, "08:00", "09:30", mine.first);
    ids.cancelled = await ingestVisit(office, me, today, "15:00", "16:00", mine.cancelled);
    await ingestVisit(office, me, addDays(today, 1), "09:00", "10:00", mine.tomorrow);
    ids.other = await ingestVisit(office, them, today, "10:00", "11:00", other);
    cancelVisitAsPostgres(ids.cancelled);
  });

  test("the day from the server: own visits only, counters, next visit, no cancelled or tomorrow's visit", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    const schedule = page.getByRole("region", { name: 'לו"ז היום' });
    await expect(schedule.getByRole("link")).toHaveCount(2);
    await expect(schedule.getByRole("link").nth(0)).toContainText(mine.first.customer);
    await expect(schedule.getByRole("link").nth(1)).toContainText(mine.second.customer);
    await expect(schedule.getByRole("link").nth(0)).toContainText("שובצה");
    // T-02: the counters are the server's (2 open, 0 completed).
    await expect(page.locator(".stat").nth(0)).toContainText("2");
    await expect(page.locator(".stat").nth(1)).toContainText("0");
    // The next visit: the first scheduled one, with a plain Waze link (no status change).
    const next = page.getByRole("region", { name: "הביקור הבא" });
    await expect(next).toContainText(mine.first.customer);
    await expect(next.getByRole("link", { name: /ניווט ב-Waze/ })).toHaveAttribute("href", /^https:\/\/waze\.com\/ul\?q=.+&navigate=yes$/);
    await expect(next.getByRole("button")).toHaveCount(0);
    const html = await page.content();
    for (const absent of [other.customer, mine.cancelled.customer, mine.tomorrow.customer, "בוטלה"]) expect(html).not.toContain(absent);
    // 🧪 on test records (D47).
    await expect(schedule.locator('[title="נתוני בדיקה"]').first()).toBeVisible();
  });

  test("pickups: grouped by place with Waze; the tick is kept on this device and says so", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    const card = page.getByRole("region", { name: "מה לאסוף לפני יציאה" });
    await expect(card).toContainText(PLACE);
    await expect(card).toContainText("משאבת ניקוז");
    await expect(card).toContainText("הסימון נשמר במכשיר הזה בלבד, להיום.");
    await expect(card.getByRole("link", { name: `Waze · ניווט אל ${PLACE}` })).toHaveAttribute("href", /waze\.com\/ul/);
    await expect(card).toContainText("0 מתוך 1 נאסף");
    await card.getByRole("checkbox").check();
    await expect(card).toContainText("1 מתוך 1 נאסף");
    await page.reload();
    await expect(page.getByRole("region", { name: "מה לאסוף לפני יציאה" }).getByRole("checkbox")).toBeChecked();
  });

  test("the visit card: details, links and markers from the server", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.getByRole("link", { name: `פרטי קריאה · ${mine.first.customer}` }).click();
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.first}$`));
    await expect(page.getByRole("heading", { level: 1, name: mine.first.customer })).toBeVisible();
    await expect(page.locator(".ph-head")).toContainText(`מס׳ פנייה ${mine.first.req} · משימה 1 · ביקור 1`);
    await expect(page.locator(".ph-head")).toContainText("שובצה");
    const info = page.getByRole("region", { name: "פרטי הלקוח והמוצר" });
    for (const value of [`${mine.first.street}, ${mine.first.city}`, mine.first.arrival, mine.first.phone, mine.first.customerNo, "תיקון", mine.first.product, mine.first.sku, "שירה נציגה"]) {
      await expect(info).toContainText(value);
    }
    await expect(page.getByRole("region", { name: "תיאור התקלה" })).toContainText(mine.first.desc);
    await expect(page.getByRole("region", { name: "הערות לטכנאי" })).toContainText(mine.first.techNote);
    await expect(page.getByRole("region", { name: "לאסוף לפני הביקור" })).toContainText(PLACE);
    const tiles = page.getByRole("group", { name: "ניווט ויצירת קשר" });
    await expect(tiles.getByRole("link", { name: /^לקוח · חיוג/ })).toHaveAttribute("href", "tel:0501234567");
    await expect(tiles.getByRole("link", { name: /^וואטסאפ ללקוח/ })).toHaveAttribute("href", "https://wa.me/972501234567");
    await expect(tiles.getByRole("link", { name: /^Waze · ניווט אל/ })).toHaveAttribute("href", /waze\.com\/ul\?q=/);
    // The handling rep has no linked profile here: the tile is disabled, never a broken link.
    await expect(tiles.getByRole("link", { name: /^נציגה/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("🧪 זימון בדיקה")).toBeVisible();
    // No field times for the technician (TE-25) and no write action yet.
    await expect(page.getByRole("button")).toHaveCount(0);
  });

  test("no warranty and no paid marker on the technician's card (D68), call type shown", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${ids.second}`);
    const info = page.getByRole("region", { name: "פרטי הלקוח והמוצר" });
    await expect(info).toContainText("התקנה");
    await expect(info).not.toContainText("באחריות");
    await expect(info).not.toContainText("כן · עד 03/2028");
    await expect(info).not.toContainText("ביקור בתשלום");
    await expect(page.getByRole("region", { name: "לאסוף לפני הביקור" })).toHaveCount(0);
    // The paid-visit case (warranty "לא") shows no marker either.
    await page.goto(`/tech/visit/${ids.first}`);
    const first = page.getByRole("region", { name: "פרטי הלקוח והמוצר" });
    await expect(first).toContainText(mine.first.product);
    await expect(first).not.toContainText("באחריות");
    await expect(first).not.toContainText("ביקור בתשלום");
  });

  test("another technician's visit, a cancelled visit and a malformed id are not found (nothing rendered)", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    for (const id of [ids.other, ids.cancelled, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await page.goto(`/tech/visit/${id}`);
      expect(res?.status(), String(id)).toBe(404);
      const html = await page.content();
      expect(html).not.toContain(other.customer);
      expect(html).not.toContain(mine.cancelled.customer);
    }
  });

  test("the other technician sees only his visit; no pickup card on his day (T-07)", async ({ page }) => {
    const { tech2 } = seeded();
    await signInAs(page, tech2, /\/tech$/);
    await homeOf(page);
    const schedule = page.getByRole("region", { name: 'לו"ז היום' });
    await expect(schedule.getByRole("link")).toHaveCount(1);
    await expect(schedule).toContainText(other.customer);
    await expect(page.getByRole("region", { name: "מה לאסוף לפני יציאה" })).toHaveCount(0);
    const res = await page.goto(`/tech/visit/${ids.first}`);
    expect(res?.status()).toBe(404);
    expect(await page.content()).not.toContain(mine.first.customer);
  });

  test("office roles cannot open the technician screens", async ({ page }) => {
    const { mgr, cs } = seeded();
    for (const user of [mgr, cs]) {
      await signInAs(page, user, /\/office$/);
      for (const path of ["/tech", "/tech/done", `/tech/visit/${ids.first}`]) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/login\?state=no-access$/);
        expect(await page.content()).not.toContain(mine.first.customer);
      }
      await page.getByRole("button", { name: "יציאה מהחשבון" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("'הושלמו היום' lists nothing yet and agrees with the counter", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.getByRole("link", { name: /הושלמו/ }).click();
    await expect(page).toHaveURL(/\/tech\/done$/);
    await expect(page.getByRole("heading", { level: 1, name: "הושלמו היום" })).toBeVisible();
    await expect(page.getByText("עוד לא הושלמו ביקורים היום")).toBeVisible();
  });
});
