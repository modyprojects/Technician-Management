import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, submitSignIn } from "./helpers";

// On demand only (SCREENSHOTS=1): the review images of the real "קריאות" (V1 item 4; D62 (6): the
// screen and its states at 390, 820 and 1440 px), from a local production build signed in to the
// ISOLATED local stack. Start from an empty stack (`supabase db reset`) so the empty state is real:
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-calls-list-screenshots.spec.ts
// The calls are made through the real simulator dialog and server action (fictional, test-marked,
// D47; the names are fictional).
const OUT = path.resolve("docs/review/office-calls-list");
const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const rowsOf = (p: Page, width: number) => p.locator(width <= 600 ? ".oc-cards > li" : 'table[aria-label="קריאות שירות"] tbody tr');

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function signedIn(browser: Browser, user: SeededUser, home: RegExp): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: SIZES[1] });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return { context, page };
}

const outlookOf = (row: string | undefined) => localSqlValue(`select outlook_email from public.technicians where id = '${row ?? ""}'`);

/** Fictional calls (D47): customer, city, product, SKU and the technician's seeded row. */
const CALLS = [
  { customer: "משפחת לוי", city: "רחובות", product: "ברז מטבח נשלף", sku: "KT-2041", tech: "AUTH_E2E_TECH_ROW", start: "08:30", end: "10:00" },
  { customer: "רותם אלמוג", city: "חולון", product: "מסנן מים", sku: "WF-100", tech: "AUTH_E2E_TECH2_ROW", start: "10:30", end: "12:00" },
  { customer: "דנה כהן", city: "ראשון לציון", product: "סוללת אמבטיה", sku: "BT-330", tech: "AUTH_E2E_TECH_ROW", start: "13:00", end: "14:30" },
  { customer: "יוסי מזרחי", city: "נס ציונה", product: "מיכל הדחה סמוי", sku: "WC-300", tech: "AUTH_E2E_TECH2_ROW", start: "15:00", end: "16:00" },
] as const;

test.describe.serial("office-calls-list screenshots", () => {
  let cs: { context: BrowserContext; page: Page };
  let mgr: { context: BrowserContext; page: Page };

  test.beforeAll(async ({ browser }) => {
    const users = seeded();
    cs = await signedIn(browser, users.cs, /\/office\/calls$/);
    mgr = await signedIn(browser, users.mgr, /\/office$/);
  });

  test.afterAll(async () => {
    await cs?.context.close();
    await mgr?.context.close();
  });

  test("the empty state (before any call)", async () => {
    test.skip(localSqlValue("select count(*) from public.service_calls") !== "0", "the stack already holds calls");
    for (const size of SIZES) {
      await cs.page.setViewportSize(size);
      await cs.page.goto("/office/calls");
      await ready(cs.page);
      await cs.page.screenshot({ path: path.join(OUT, `${size.width}-empty.png`) });
    }
  });

  test("calls sent through the simulator, and a second visit of the first", async () => {
    test.setTimeout(120_000);
    const { page } = cs;
    await page.setViewportSize(SIZES[1]);
    let first = "";
    for (const [i, c] of [...CALLS, CALLS[0]].entries()) {
      await page.goto("/office/unparsed");
      await page.getByRole("button", { name: "סימולטור זימונים" }).click();
      const dialog = page.getByRole("dialog", { name: "Outlook · זימון בדיקה (סימולטור)" });
      await dialog.getByRole("button", { name: "לקוח חדש" }).click();
      await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env[c.tech]));
      await dialog.getByLabel("שעת התחלה").fill(c.start);
      await dialog.getByLabel("שעת סיום").fill(i === CALLS.length ? "17:30" : c.end);
      const body = dialog.getByLabel("גוף הזימון (לפי התבנית)");
      let value = (await body.inputValue())
        .replace(/^שם לקוח: .*$/m, `שם לקוח: ${c.customer}`)
        .replace(/^עיר: .*$/m, `עיר: ${c.city}`)
        .replace(/^מוצר: .*$/m, `מוצר: ${c.product}`)
        .replace(/^מק"ט: .*$/m, `מק"ט: ${c.sku}`);
      if (i === 0) first = /^מספר פנייה: (\S+)$/m.exec(value)?.[1] ?? "";
      // The last one: visit 2 of the first call (the same request number, X-03).
      if (i === CALLS.length) value = value.replace(/^מספר פנייה: .*$/m, `מספר פנייה: ${first}`).replace(/^מספר משימה: .*$/m, "מספר משימה: 2");
      await body.fill(value);
      await dialog.getByRole("button", { name: "שליחה" }).click();
      await expect(dialog.getByRole("status")).toContainText("הזימון נקלט");
      await page.keyboard.press("Escape");
    }
  });

  for (const size of SIZES) {
    test(`the list and its filters at ${size.width}px`, async () => {
      test.setTimeout(120_000);
      const file = (name: string) => path.join(OUT, `${size.width}-${name}.png`);
      const shot = async (page: Page, name: string) => {
        await ready(page);
        await page.screenshot({ path: file(name) });
      };
      const c = cs.page;
      await c.setViewportSize(size);
      await c.goto("/office/calls");
      await expect(rowsOf(c, size.width).first()).toBeVisible();
      await shot(c, "cs-list");

      const m = mgr.page;
      await m.setViewportSize(size);
      await m.goto("/office/calls");
      await expect(rowsOf(m, size.width).first()).toBeVisible();
      await shot(m, "mgr-list");
      // Filters: the second technician, then a search that finds one call, then a chip with no call.
      await m.getByRole("combobox", { name: "סינון לפי טכנאי" }).selectOption(process.env.AUTH_E2E_TECH2_ROW ?? "");
      await expect(m).toHaveURL(/[?&]tech=/);
      await expect(rowsOf(m, size.width).first()).toBeVisible();
      await shot(m, "filter-technician");
      await m.goto("/office/calls?q=" + encodeURIComponent("חולון"));
      await expect(rowsOf(m, size.width).first()).toBeVisible();
      await shot(m, "filter-search");
      await m.goto("/office/calls?status=resolved");
      await expect(m.getByText("לא נמצאו קריאות")).toBeVisible();
      await shot(m, "filter-status-empty");
      // A row opens its call's address (the card itself is the next screen).
      await m.goto("/office/calls?q=" + encodeURIComponent("משפחת לוי"));
      await rowsOf(m, size.width).first().getByRole("link").click();
      await expect(m).toHaveURL(/\/office\/calls\/[^/?]+$/);
      await shot(m, "call-temporary");
    });
  }
});
