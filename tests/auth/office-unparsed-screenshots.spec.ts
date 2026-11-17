import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, submitSignIn } from "./helpers";

// On demand only (SCREENSHOTS=1): the review images of "זימונים שלא נקלטו" and the Outlook invitation
// simulator (QA S-05; D60 (4), (11); D62 (6): the screen and its states at 390, 820 and 1440 px), from
// a local production build signed in to the ISOLATED local stack (tests/auth/run-local.mjs). Start from
// an empty stack (`supabase db reset`) so the empty state is real:
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-unparsed-screenshots.spec.ts
// Every invitation is sent through the real simulator dialog and the real server action (fictional,
// test-marked, D47); the accounts are global-setup's fictional ones.
const OUT = path.resolve("docs/review/office-unparsed");
const PATH = "/office/unparsed";
const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function signedIn(browser: Browser, user: SeededUser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: SIZES[2] });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/office$/);
  return { context, page };
}

const outlookOf = (row: string | undefined) => localSqlValue(`select outlook_email from public.technicians where id = '${row ?? ""}'`);
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Outlook · זימון בדיקה (סימולטור)" });
const action = (dialog: Locator, name: string) => dialog.getByRole("group", { name: "פעולה" }).getByText(name, { exact: true });

test.describe.serial("office-unparsed screenshots", () => {
  let mgr: { context: BrowserContext; page: Page };
  let cs: { context: BrowserContext; page: Page };

  test.beforeAll(async ({ browser }) => {
    const users = seeded();
    mgr = await signedIn(browser, users.mgr);
    cs = await signedIn(browser, users.cs);
  });

  test.afterAll(async () => {
    await mgr?.context.close();
    await cs?.context.close();
  });

  test("the empty state (before any invitation)", async () => {
    test.skip(localSqlValue("select count(*) from public.calendar_ingestion_errors where status = 'open'") !== "0", "the stack already holds unparsed invitations");
    for (const size of SIZES) {
      await mgr.page.setViewportSize(size);
      await mgr.page.goto(PATH);
      await ready(mgr.page);
      await mgr.page.screenshot({ path: path.join(OUT, `${size.width}-empty.png`) });
    }
  });

  test("invitations sent through the simulator: one ingested, five not ingested", async () => {
    const { page } = cs;
    await page.setViewportSize(SIZES[2]);
    await page.goto(PATH);
    const tech = outlookOf(process.env.AUTH_E2E_TECH_ROW);
    const sendWith = async (sample: string, edit: (body: string) => string, attendee: string = tech) => {
      await page.getByRole("button", { name: "סימולטור זימונים" }).click();
      const dialog = dialogOf(page);
      await dialog.getByRole("button", { name: sample }).click();
      if (attendee === tech) await dialog.getByLabel("אל", { exact: true }).selectOption(tech);
      else {
        await dialog.getByLabel("אל", { exact: true }).selectOption({ label: "כתובת אחרת…" });
        await dialog.getByLabel("כתובת המשתתף").fill(attendee);
      }
      const body = dialog.getByLabel("גוף הזימון (לפי התבנית)");
      await body.fill(edit(await body.inputValue()));
      await dialog.getByRole("button", { name: "שליחה" }).click();
      await expect(dialog.getByRole("status")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    };
    // Ingested (never on the list).
    await sendWith("לקוח חדש", (b) => b);
    // Not ingested, one reason kind each (S-05).
    await sendWith("לקוח חדש", (b) => b.replace("סוג קריאה: תיקון", "סוג קריאה: החלפה"));
    await sendWith("לקוח חדש", (b) => b.replace("לאסוף לפני הביקור: ", "לאסוף לפני הביקור: ראש נשלף").replace("לאסוף מ: ", "לאסוף מ: מחסן חולון"));
    await sendWith("לקוח חדש", (b) => b, "nobody-office@example.test");
    await sendWith("לקוח חדש", (b) => b.replace(/^מספר פנייה: .*$/m, "מספר פנייה: 48 213").replace(/^טלפון: .*$/m, "טלפון: אין"));
    await sendWith("זימון עם שדות חסרים", (b) => b);
  });

  for (const size of SIZES) {
    test(`the screen at ${size.width}px`, async () => {
      test.setTimeout(120_000);
      const file = (name: string) => path.join(OUT, `${size.width}-${name}.png`);
      const shot = async (page: Page, name: string, target?: Locator) => {
        await ready(page);
        if (target) await target.screenshot({ path: file(name) });
        else await page.screenshot({ path: file(name) });
      };

      // The Manager's view: the list with data (newest first) and one invitation's reasons.
      const m = mgr.page;
      await m.setViewportSize(size);
      await m.goto(PATH);
      await expect(m.getByRole("list", { name: "זימונים שלא נקלטו" }).locator(":scope > li").first()).toBeVisible();
      await shot(m, "mgr-list");
      await shot(m, "reasons-missing", m.getByRole("list", { name: "זימונים שלא נקלטו" }).locator(":scope > li").first());
      await shot(m, "reasons-technician", m.getByRole("list", { name: "זימונים שלא נקלטו" }).locator(":scope > li").filter({ hasText: "טכנאי לא זוהה" }).first());

      // Customer Service: the same screen in its navigation (D60 (4)).
      const c = cs.page;
      await c.setViewportSize(size);
      await c.goto(PATH);
      await expect(c.getByRole("list", { name: "זימונים שלא נקלטו" })).toBeVisible();
      await shot(c, "cs-list");
    });
  }

  // After every list image: the dialog's result sends one more invitation per width.
  for (const size of SIZES) {
    test(`the simulator dialog at ${size.width}px`, async () => {
      test.setTimeout(120_000);
      const file = (name: string) => path.join(OUT, `${size.width}-${name}.png`);
      // The dialog scrolls inside its fixed backdrop: a whole-dialog image needs a viewport that
      // holds it (same width; only the height grows for that image).
      const shot = async (page: Page, name: string, target?: Locator) => {
        await ready(page);
        if (!target) {
          await page.screenshot({ path: file(name) });
          return;
        }
        await page.setViewportSize({ width: size.width, height: 2200 });
        await ready(page);
        await target.screenshot({ path: file(name) });
        await page.setViewportSize(size);
      };
      const m = mgr.page;
      await m.setViewportSize(size);
      await m.goto(PATH);

      // The simulator dialog: as it opens, filled for an invalid invitation, its own errors, a result.
      await m.getByRole("button", { name: "סימולטור זימונים" }).click();
      const dialog = dialogOf(m);
      await expect(dialog).toBeVisible();
      await shot(m, "simulator-open");
      await shot(m, "simulator-open-full", dialog);
      await dialog.getByRole("button", { name: "זימון עם שדות חסרים" }).click();
      await dialog.getByLabel("אל", { exact: true }).selectOption({ label: "כתובת אחרת…" });
      await dialog.getByLabel("כתובת המשתתף").fill("rep-test@example.test");
      await shot(m, "simulator-filled", dialog);
      await action(dialog, "עדכון זימון").click();
      await dialog.getByLabel("נושא", { exact: true }).fill("");
      await dialog.getByLabel("שעת התחלה").fill("9");
      await dialog.getByRole("button", { name: "שליחה" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await shot(m, "simulator-errors", dialog);
      await m.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // A result: an invalid invitation sent from the dialog, with its reasons.
      await m.getByRole("button", { name: "סימולטור זימונים" }).click();
      await dialog.getByRole("button", { name: "זימון עם שדות חסרים" }).click();
      await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env.AUTH_E2E_TECH_ROW));
      await dialog.getByRole("button", { name: "שליחה" }).click();
      await expect(dialog.getByRole("status")).toContainText("הזימון לא נקלט");
      await dialog.getByRole("status").scrollIntoViewIfNeeded();
      await shot(m, "simulator-result");
      await shot(m, "simulator-result-full", dialog);
      // The cancellation form (no fields), for the invitation just sent.
      await action(dialog, "ביטול זימון").click();
      await shot(m, "simulator-cancel", dialog);
      await m.keyboard.press("Escape");
    });
  }
});
