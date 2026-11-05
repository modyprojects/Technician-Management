import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { onlyInProject, openPage } from "./helpers";

// On demand only: `npm run screenshots` (SCREENSHOTS=1). Writes PR review images, fictitious data only.
const OUT = path.resolve("docs/review/step-0");
const DEMO_URL = pathToFileURL(path.resolve("docs/demo.html")).href;
const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

// Let pages that scroll inside .stage grow, so a full-page screenshot shows everything.
const UNCLIP_STAGE = "html,body,.stagewrap,.stage,.app-root{height:auto!important;overflow:visible!important}";

async function demo(page: Page, role: "tech" | "office") {
  await page.goto(DEMO_URL);
  await page.locator("#roles button").nth(role === "tech" ? 0 : 2).click();
  if (role === "office") await page.locator(".side .nav button").nth(1).click();
  await page.addStyleTag({ content: ".demobar{display:none!important}" });
  await page.evaluate(() => document.fonts.ready);
}

test.describe("review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`screens at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      const shot = (name: string, fullPage = false) =>
        page.screenshot({ path: path.join(OUT, `${size.width}-${name}.png`), fullPage });

      await openPage(page, "/dev/showcase/tech");
      await shot("app-tech");
      await demo(page, "tech");
      await shot("demo-tech");

      await openPage(page, "/dev/showcase/office");
      await shot("app-office");
      await demo(page, "office");
      await shot("demo-office");

      await openPage(page, "/dev/showcase");
      await page.addStyleTag({ content: UNCLIP_STAGE });
      await shot("app-showcase", true);

      await openPage(page, "/");
      await shot("app-home");
      await openPage(page, "/no-such-page");
      await shot("app-404");

      if (size.width === 1440) {
        await openPage(page, "/dev/showcase/sizes");
        await page.waitForTimeout(1500); // let the six iframes finish loading
        await page.addStyleTag({ content: UNCLIP_STAGE });
        await shot("app-sizes", true);
      }
    });
  }
});

// UI demo with fictional data (D53): app screens next to the matching docs/demo.html screens.
const OUT_DEMO = path.resolve("docs/review/ui-demo-1");

// The demo pages scroll inside DemoPage, .ph-main and .stage; let them grow for full-page shots.
const UNCLIP_APP =
  "html,body,.stagewrap,.stage,.app-root,.techwrap,.phone,.ph-main,[data-fixtures],[data-fixtures]>div" +
  "{height:auto!important;max-height:none!important;overflow:visible!important}";
// The same for docs/demo.html (#stagewrap/#stage/#app, the phone frame), without the toast.
const UNCLIP_DEMO_HTML =
  "html,body,#stagewrap,#stage,#app,.techwrap,.phone,.ph-main{height:auto!important;max-height:none!important;" +
  "min-height:0!important;overflow:visible!important}#toast{display:none!important}";

/** Draws a short signature stroke with pointer (mouse) events. */
async function sign(page: Page, selector: string) {
  const pad = page.locator(selector);
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  if (!b) throw new Error(`No box for ${selector}`);
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.65);
  await page.mouse.down();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.45, 0.7],
    [0.6, 0.35],
    [0.75, 0.65],
    [0.85, 0.4],
  ] as const) {
    await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 8 });
  }
  await page.mouse.up();
}

/** Opens docs/demo.html as a role (tech | cs | mgr | creator), demo bar hidden. */
async function demoAs(page: Page, role: "tech" | "cs" | "mgr" | "creator") {
  await page.goto(DEMO_URL);
  await page.locator(`#roles button[data-v="${role}"]`).click();
  await page.addStyleTag({ content: ".demobar{display:none!important}" });
  await page.evaluate(() => document.fonts.ready);
}

test.describe("ui-demo-1 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`demo screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      // Full page only when a screen scrolls; a screen that fits keeps the live viewport, so the
      // technician footer and bottom navigation stay at the bottom as on the device (TE-32).
      const shot = async (name: string, fullPage = true) => {
        const scrolls = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("[data-fixtures]>div:last-child, .ph-main, .work")].some(
            (el) => el.scrollHeight > el.clientHeight + 1,
          ),
        );
        const full = fullPage && scrolls;
        if (full) await page.addStyleTag({ content: UNCLIP_APP });
        await page.screenshot({ path: path.join(OUT_DEMO, `${size.width}-${name}.png`), fullPage: full });
      };
      /** Waits until the simulated-action toast has gone, so it does not cover the screen. */
      const toastGone = () => expect(page.locator(".toast")).toHaveCount(0, { timeout: 8_000 });

      for (const [name, url] of [
        ["landing", "/dev/demo"],
        ["office-mgr-home", "/dev/demo/office/mgr"],
        ["office-cs-home", "/dev/demo/office/cs"],
        ["calls-list", "/dev/demo/office/mgr/calls"],
        ["call-detail", "/dev/demo/office/mgr/calls/48205"],
        ["analytics-general", "/dev/demo/office/mgr/analytics"],
        ["analytics-technicians", "/dev/demo/office/mgr/analytics?tab=tech"],
        ["tech-home", "/dev/demo/tech"],
        ["tech-visit", "/dev/demo/tech/visit/48205/2"],
        // States the owner asked to see (closed and resolved views, access, drill-downs).
        ["tech-visit-closed", "/dev/demo/tech/visit/47800/1"],
        ["call-detail-resolved", "/dev/demo/office/mgr/calls/47969"],
        ["call-detail-awaiting", "/dev/demo/office/mgr/calls/48230"],
        ["call-detail-cs", "/dev/demo/office/cs/calls/48205"],
        ["analytics-cs-no-access", "/dev/demo/office/cs/analytics"],
        ["analytics-products", "/dev/demo/office/mgr/analytics?tab=prod"],
        ["analytics-tech-detail", "/dev/demo/office/mgr/analytics?tab=tech&tech=y"],
      ] as const) {
        await openPage(page, url);
        await shot(name);
      }

      // Work screen in recording mode (a simulated recording).
      await openPage(page, "/dev/demo/tech/visit/48213/1/work");
      await page.getByRole("group", { name: "אופן הסיכום" }).getByRole("button", { name: /הקלטה/ }).click();
      await page.getByRole("button", { name: "התחלת הקלטה" }).click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "עצירת הקלטה" }).click();
      await expect(page.getByText("הקלטה מדומה · לא נשמרה. לחץ שוב כדי להקליט מחדש.")).toBeVisible();
      await toastGone();
      await shot("tech-work-recording");

      // Close as "המשך טיפול" with a reason and the next-visit note (TE-21).
      // The work first (a photo after the treatment and a summary), as the close requires.
      await openPage(page, "/dev/demo/tech/visit/48205/2/work");
      await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
      await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("המחסנית הוחלפה, נדרש כיוון נוסף של הפיה.");
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).blur();
      await page.getByRole("link", { name: "סיום ביקור ›" }).click();
      await expect(page).toHaveURL(/\/48205\/2\/close$/);
      await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
      await page.getByRole("region", { name: "המשך טיפול" }).getByRole("button").first().click();
      await page.getByLabel(/מה צריך בביקור הבא/).fill("לכוון את הפיה ולבדוק שאין טפטוף.");
      await shot("tech-close-followup");

      // Work screen with an "after" photo and a summary, then the close screen with a signature.
      await openPage(page, "/dev/demo/tech/visit/48205/2/work");
      await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
      await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("הוחלף אטם בברז, נבדק ותקין.");
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).blur();
      await toastGone();
      await shot("tech-work");

      await page.getByRole("link", { name: "סיום ביקור ›" }).click();
      await expect(page).toHaveURL(/\/close$/);
      await toastGone();
      await page.getByRole("button", { name: /✓ טופל/ }).click();
      await page.getByPlaceholder("שם הלקוח").fill("אבי כהן");
      await sign(page, "canvas.sig");
      await expect(page.locator("canvas.sig")).toHaveAttribute("aria-label", "שטח חתימה · יש חתימה");
      await page.mouse.move(0, 0);
      await shot("tech-close");

      // docs/demo.html, the equivalent screens.
      const demoShot = async (name: string, fullPage = true) => {
        if (fullPage) await page.addStyleTag({ content: UNCLIP_DEMO_HTML });
        await page.screenshot({ path: path.join(OUT_DEMO, `${size.width}-demo-${name}.png`), fullPage });
      };

      await demoAs(page, "mgr");
      await page.locator('.side .nav button[data-v="calls"]').click();
      await demoShot("calls-list");
      await page.locator('[data-act="openCard"][data-req="48205"]').first().click();
      await demoShot("call-detail");

      await demoAs(page, "mgr");
      await page.locator('.side .nav button[data-v="cal"]').click();
      await page.locator('[data-act="drawer"][data-req="48205"]').first().click();
      await page.addStyleTag({ content: "#toast{display:none!important}" });
      await demoShot("call-drawer", false);

      await demoAs(page, "mgr");
      await page.locator('.side .nav button[data-v="dash"]').click();
      await demoShot("analytics-general");
      await page.locator('[data-act="dashTab"][data-v="tech"]').click();
      await demoShot("analytics-technicians");

      await demoAs(page, "cs");
      await demoShot("office-cs-home");

      await demoAs(page, "tech");
      await demoShot("tech-home");
      await page.locator('[data-act="openVisit"][data-req="48205"][data-n="2"]').first().click();
      await demoShot("tech-visit");
      await page.locator('[data-act="arrived"]').click();
      await page.locator('[data-act="sampleMedia"][data-when="after"]').first().click();
      await page.locator('[data-in="summary"]').fill("הוחלף אטם בברז, נבדק ותקין.");
      await demoShot("tech-work");
      await page.locator("#finishBtn").click();
      await page.locator('[data-act="closeChoice"][data-v="done"]').click();
      await page.locator('[data-in="signer"]').fill("אבי כהן");
      await sign(page, "#sig");
      await page.mouse.move(0, 0);
      await demoShot("tech-close");
    });
  }
});

// UI demo, phase D (D53): calendars, closed visits, notifications and profile, next to docs/demo.html.
const OUT_DEMO_2 = path.resolve("docs/review/ui-demo-2");

/** Full page only when the screen scrolls (same rule as the ui-demo-1 block: TE-32 footer stays put). */
async function appShot(page: Page, file: string, fullPage = true) {
  const scrolls = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-fixtures]>div:last-child, .ph-main, .work")].some(
      (el) => el.scrollHeight > el.clientHeight + 1,
    ),
  );
  const full = fullPage && scrolls;
  if (full) await page.addStyleTag({ content: UNCLIP_APP });
  await page.screenshot({ path: file, fullPage: full });
}

test.describe("ui-demo-2 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`phase D screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      const shot = (name: string, fullPage = true) => appShot(page, path.join(OUT_DEMO_2, `${size.width}-${name}.png`), fullPage);

      for (const [name, url] of [
        ["office-calendar", "/dev/demo/office/mgr/calendar"],
        ["office-calendar-week", "/dev/demo/office/mgr/calendar?view=week"],
        ["office-calendar-month", "/dev/demo/office/mgr/calendar?view=month"],
        ["office-calendar-cs-filtered", "/dev/demo/office/cs/calendar?tech=y"],
        ["tech-calendar-day", "/dev/demo/tech/calendar"],
        ["tech-calendar-week", "/dev/demo/tech/calendar?view=week"],
        ["tech-calendar-month", "/dev/demo/tech/calendar?view=month"],
        ["tech-done-list", "/dev/demo/tech/done"],
        ["tech-done-view", "/dev/demo/tech/done/47800/1"],
        ["tech-notifications", "/dev/demo/tech/notifications"],
        ["tech-profile", "/dev/demo/tech/profile"],
      ] as const) {
        await openPage(page, url);
        await shot(name);
      }

      // "הושלמו היום" with rows: the fixtures have none on the demo's date, so the showcase shows
      // the list with sample DTOs (rows, 🧪 badges, pager).
      await openPage(page, "/dev/showcase");
      await page.locator("#showcase-done-list").screenshot({ path: path.join(OUT_DEMO_2, `${size.width}-showcase-done-list.png`) });

      // The drawer is a fixed overlay: a viewport shot, opened from a block as the user would.
      await openPage(page, "/dev/demo/office/mgr/calendar");
      await page.locator('a.ocal-ev[data-cal-visit]').first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.mouse.move(0, 0);
      await shot("office-calendar-drawer", false);

      // docs/demo.html, the equivalent screens.
      const demoShot = async (name: string, fullPage = true) => {
        await page.addStyleTag({ content: fullPage ? UNCLIP_DEMO_HTML : "#toast{display:none!important}" });
        await page.screenshot({ path: path.join(OUT_DEMO_2, `${size.width}-demo-${name}.png`), fullPage });
      };

      await demoAs(page, "mgr");
      await page.locator('.side .nav button[data-v="cal"]').click();
      await demoShot("office-calendar");
      await page.locator('[data-act="calView"][data-v="week"]').click();
      await demoShot("office-calendar-week");
      await page.locator('[data-act="calView"][data-v="month"]').click();
      await demoShot("office-calendar-month");
      await page.locator('[data-act="calView"][data-v="day"]').click();
      await page.locator('[data-act="drawer"]').first().click();
      await demoShot("office-calendar-drawer", false);

      await demoAs(page, "tech");
      await page.locator('.ph-nav [data-act="techTab"][data-v="cal"]').click();
      await demoShot("tech-calendar-day");
      await page.locator('[data-act="techCalView"][data-v="week"]').click();
      await demoShot("tech-calendar-week");
      await page.locator('[data-act="techCalView"][data-v="month"]').click();
      await demoShot("tech-calendar-month");

      await demoAs(page, "tech");
      await page.locator('[data-act="openNotifs"]').first().click();
      await demoShot("tech-notifications");

      await demoAs(page, "tech");
      await page.locator('.ph-nav [data-act="techTab"][data-v="prof"]').click();
      await demoShot("tech-profile");

      // "הושלמו היום" is empty until a visit is closed (as in the app's fixtures); close one in the
      // demo to show the list with a row and the read-only view.
      await demoAs(page, "tech");
      await page.locator('[data-act="techGo"][data-v="doneList"]').first().click();
      await demoShot("tech-done-list");
      await demoAs(page, "tech");
      await page.locator('[data-act="openVisit"][data-req="48205"][data-n="2"]').first().click();
      await page.locator('[data-act="arrived"]').click();
      await page.locator('[data-act="sampleMedia"][data-when="after"]').first().click();
      await page.locator('[data-in="summary"]').fill("הוחלף אטם בברז, נבדק ותקין.");
      await page.locator("#finishBtn").click();
      await page.locator('[data-act="closeChoice"][data-v="done"]').click();
      await page.locator('[data-in="signer"]').fill("אבי כהן");
      await sign(page, "#sig");
      await page.locator("#sendBtn").click();
      await page.locator('[data-act="techGo"][data-v="doneList"]').first().click();
      await demoShot("tech-done-list-after-close");
      await page.locator('[data-act="openDone"]').first().click();
      await page.mouse.move(0, 0);
      await demoShot("tech-done-view");
    });
  }
});

// UI demo, phase E (D53): the Creator's Settings tabs and the Manager's account administration,
// next to docs/demo.html's Settings tabs (as the Creator). The demo has no "סוגי קריאה" tab (SE-16)
// and no Manager account screen (SE-01): those app shots have no demo counterpart.
const OUT_DEMO_3 = path.resolve("docs/review/ui-demo-3");

test.describe("ui-demo-3 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`phase E screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      const shot = (name: string, fullPage = true) => appShot(page, path.join(OUT_DEMO_3, `${size.width}-${name}.png`), fullPage);

      for (const [name, url] of [
        ["settings-users", "/dev/demo/office/creator/settings/users"],
        ["settings-techs", "/dev/demo/office/creator/settings/techs"],
        ["settings-places", "/dev/demo/office/creator/settings/places"],
        ["settings-reasons", "/dev/demo/office/creator/settings/reasons"],
        ["settings-types", "/dev/demo/office/creator/settings/types"],
        ["settings-mail", "/dev/demo/office/creator/settings/mail"],
        ["settings-template", "/dev/demo/office/creator/settings/template"],
        ["mgr-users", "/dev/demo/office/mgr/users"],
      ] as const) {
        await openPage(page, url);
        await shot(name);
      }

      // docs/demo.html as the Creator: Settings, each tab.
      const demoShot = async (name: string) => {
        await page.addStyleTag({ content: UNCLIP_DEMO_HTML });
        await page.screenshot({ path: path.join(OUT_DEMO_3, `${size.width}-demo-${name}.png`), fullPage: true });
      };
      for (const tab of ["users", "techs", "places", "reasons", "mail", "template"] as const) {
        await demoAs(page, "creator");
        await page.locator('.side .nav button[data-v="settings"]').click();
        await page.locator(`[data-act="setTab"][data-v="${tab}"]`).click();
        await expect(page.locator(`[data-act="setTab"][data-v="${tab}"]`)).toBeVisible();
        await demoShot(`settings-${tab}`);
      }
    });
  }
});

// UI demo, phase F (D53): "לקוחות" and the customer card, "מוצרים", "זימונים שלא נקלטו" and "חזרו
// מהשטח" as the Manager, and "לקוחות" as customer service. docs/demo.html has none of these screens
// (OF-16 ADD), so there is no demo counterpart; the call card with its new customer link is shot
// at 1440 px only.
const OUT_DEMO_4 = path.resolve("docs/review/ui-demo-4");

test.describe("ui-demo-4 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`phase F screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      const shot = (name: string, fullPage = true) => appShot(page, path.join(OUT_DEMO_4, `${size.width}-${name}.png`), fullPage);

      for (const [name, url] of [
        ["customers", "/dev/demo/office/mgr/customers"],
        ["customer-card", "/dev/demo/office/mgr/customers/cu-298747"],
        ["products", "/dev/demo/office/mgr/products"],
        ["unparsed", "/dev/demo/office/mgr/unparsed"],
        ["back-from-field", "/dev/demo/office/mgr/back-from-field"],
        ["cs-customers", "/dev/demo/office/cs/customers"],
      ] as const) {
        await openPage(page, url);
        await shot(name);
      }

      // The product edit form open (simulated command; nothing is saved).
      await openPage(page, "/dev/demo/office/mgr/products");
      await page.getByRole("button", { name: "עריכה · ברז מטבח נשלף (KT-2041)" }).click();
      await expect(page.getByRole("form", { name: "עריכת המוצר KT-2041" })).toBeVisible();
      await shot("products-edit");

      if (size.width === 1440) {
        await openPage(page, "/dev/demo/office/mgr/calls/48213");
        await expect(page.getByRole("link", { name: "לכרטיס הלקוח · משפחת לוי" })).toBeVisible();
        await shot("call-card-customer-link");
      }
    });
  }
});

// UI demo, phase G (D53): "פריטים לבדיקה" (the list and a D44 conflict item), the call card with
// the closed-visit correction dialog and its history (OF-10), the /dev mock outbox with an email
// (X-06), the technician home with the sync banner and the close confirmation with the sync
// progression (TE-23). docs/demo.html has no review, correction or sync screens; its mail view ("✉
// מיילים שנשלחו" after a close) is shot for comparison with the outbox.
const OUT_DEMO_5 = path.resolve("docs/review/ui-demo-5");

test.describe("ui-demo-5 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`phase G screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      const file = (name: string) => path.join(OUT_DEMO_5, `${size.width}-${name}.png`);
      const shot = (name: string, fullPage = true) => appShot(page, file(name), fullPage);
      const toastGone = () => expect(page.locator(".toast")).toHaveCount(0, { timeout: 8_000 });

      for (const [name, url] of [
        ["review-list", "/dev/demo/office/mgr/review"],
        ["review-item-conflict", "/dev/demo/office/mgr/review/rv-6"],
        ["review-item-closure", "/dev/demo/office/creator/review/rv-7"],
        ["outbox", "/dev/demo/outbox"],
        ["outbox-followup", "/dev/demo/outbox?id=ob-47964-1"],
        ["tech-home-sync", "/dev/demo/tech"],
        ["tech-done-sync", "/dev/demo/tech/done/47963/1"],
      ] as const) {
        await openPage(page, url);
        await shot(name);
      }

      // The D44 conflict item with "בחירה לפי שדה" chosen (the conflicting field still open).
      await openPage(page, "/dev/demo/office/mgr/review/rv-6");
      await page.locator("#review-decision").getByRole("radio", { name: /בחירה לפי שדה/ }).check();
      await shot("review-item-per-field");

      // The call card: the correction dialog open on a closed visit, then the history with a
      // simulated correction (nothing is saved).
      await openPage(page, "/dev/demo/office/mgr/calls/47969");
      await page.getByRole("button", { name: "תיקון ביקור סגור · ביקור 1" }).click();
      const dialog = page.getByRole("dialog", { name: /תיקון ביקור סגור/ });
      await dialog.getByLabel("שדה לתיקון").selectOption("summary");
      await dialog.getByLabel(/סיבת התיקון/).fill("השלמה לפי שיחה עם הטכנאי");
      await page.screenshot({ path: file("call-card-correction-dialog") });
      await dialog.getByRole("button", { name: "ביטול" }).click();
      await page.locator("#visit-1 .vc").scrollIntoViewIfNeeded();
      await shot("call-card-corrections");

      // The close confirmation: "המשך טיפול" sent (simulated) shows the sync progression.
      // The work first (a photo after the treatment and a summary), as the close requires.
      await openPage(page, "/dev/demo/tech/visit/48205/2/work");
      await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
      await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("המחסנית הוחלפה, נדרש כיוון נוסף של הפיה.");
      await page.getByRole("textbox", { name: "סיכום הטיפול" }).blur();
      await page.getByRole("link", { name: "סיום ביקור ›" }).click();
      await expect(page).toHaveURL(/\/48205\/2\/close$/);
      await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
      await page.getByRole("region", { name: "המשך טיפול" }).getByRole("button").first().click();
      await page.getByLabel(/מה צריך בביקור הבא/).fill("לכוון את הפיה ולבדוק שאין טפטוף.");
      await page.locator(".bigbtn").last().click();
      await expect(page.getByRole("region", { name: "מה קורה עם הסיום" })).toBeVisible();
      await toastGone();
      await shot("tech-close-sync");

      // docs/demo.html: a close, then "✉ מיילים שנשלחו" (the demo bar is hidden; its button is
      // clicked directly). The demo claims the email was sent; the app's outbox never does (SIM-09).
      const demoShot = async (name: string) => {
        await page.addStyleTag({ content: "#toast{display:none!important}" });
        await page.screenshot({ path: path.join(OUT_DEMO_5, `${size.width}-demo-${name}.png`) });
      };
      const openMails = () => page.evaluate(() => (document.querySelector('[data-act="mailsOpen"]') as HTMLElement | null)?.click());

      await demoAs(page, "tech");
      await page.locator('[data-act="openVisit"][data-req="48205"][data-n="2"]').first().click();
      await page.locator('[data-act="arrived"]').click();
      await page.locator('[data-act="sampleMedia"][data-when="after"]').first().click();
      await page.locator('[data-in="summary"]').fill("הוחלף אטם בברז, נבדק ותקין.");
      await page.locator("#finishBtn").click();
      await page.locator('[data-act="closeChoice"][data-v="done"]').click();
      await page.locator('[data-in="signer"]').fill("אבי כהן");
      await sign(page, "#sig");
      await page.locator("#sendBtn").click();
      await openMails();
      await expect(page.getByRole("dialog", { name: "מיילים שנשלחו" })).toBeVisible();
      await demoShot("mails-done");

      await demoAs(page, "tech");
      await page.locator('[data-act="openVisit"][data-req="48213"][data-n="1"]').first().click();
      await page.locator('[data-act="arrived"]').click();
      await page.locator('[data-act="sampleMedia"][data-when="after"]').first().click();
      await page.locator('[data-in="summary"]').fill("הברז דורש החלפה, הוזמן ברז חלופי.");
      await page.locator("#finishBtn").click();
      await page.locator('[data-act="closeChoice"][data-v="cont"]').click();
      await page.locator('[data-act="closeReason"]').first().click();
      await page.locator("#sendBtn").click();
      await openMails();
      await expect(page.getByRole("dialog", { name: "מיילים שנשלחו" })).toBeVisible();
      await demoShot("mails-followup");
    });
  }
});

// Manager dashboard, navigation and the MODY logo (D57; spec-final §12): app screens at 390 / 820 /
// 1440 and the approved visual reference (docs/design/manager-dashboard-demo.html) for comparison.
// Fictional, test-marked data only. Run only this block:
//   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "manager-dashboard"
const OUT_DASH = path.resolve("docs/review/manager-dashboard");
const DASH_REFERENCE_URL = pathToFileURL(path.resolve("docs/design/manager-dashboard-demo.html")).href;

test.describe("manager-dashboard review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`manager-dashboard screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(size);
      const file = (name: string) => path.join(OUT_DASH, `${size.width}-${name}.png`);
      const shot = (name: string, fullPage = true) => appShot(page, file(name), fullPage);
      const ready = () => expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      const dash = "/dev/demo/office/mgr/analytics";

      // Set A: the white logo in the existing dark headers.
      await openPage(page, "/dev/demo/tech");
      await shot("tech-home-logo", false);
      await page.locator(".ph-head").screenshot({ path: file("logo-tech-header") });
      await openPage(page, "/dev/demo/tech/visit/48213/1");
      await shot("tech-visit-logo", false);
      await openPage(page, "/dev/demo/office/mgr/calls");
      await page.locator(size.width > 900 ? ".side .logo" : ".side").screenshot({ path: file("logo-office-sidebar") });
      await shot("office-calls-logo", false);

      // Set B: navigation (Manager and Creator sidebars with the "מסכים נוספים" row, Customer
      // Service unchanged, the Manager's Settings › משתמשים and a closed Settings tab).
      for (const [name, url] of [
        ["nav-mgr-calls", "/dev/demo/office/mgr/calls"],
        ["nav-creator-calls", "/dev/demo/office/creator/calls"],
        ["nav-cs-home", "/dev/demo/office/cs"],
        ["mgr-settings-accounts", "/dev/demo/office/mgr/settings/accounts"],
        ["mgr-settings-places-no-access", "/dev/demo/office/mgr/settings/places"],
      ] as const) {
        await openPage(page, url);
        await shot(name, false);
      }

      // Set C: the General tab, its dialog and the 12-month chart with the data table open.
      await openPage(page, dash);
      await ready();
      await shot("dash-general");
      await openPage(page, `${dash}?detail=today.missed`);
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("dash-general-dialog", false);
      await openPage(page, `${dash}?months=12`);
      await ready();
      await page.locator(".ma-details > summary").click();
      await shot("dash-general-12m");
      // The loading state: the sidebar link prefetches it; the page response is held back.
      await openPage(page, "/dev/demo/office/mgr/calls");
      await page.waitForLoadState("networkidle");
      await page.route(/\/analytics/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
      });
      await page.locator(".side").getByRole("link", { name: "דשבורד" }).click();
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      await page.screenshot({ path: file("dash-loading") });
      await ready();
      await page.unroute(/\/analytics/);

      // Set D: Technicians (month, previous month, week, custom range and its error, reports) and
      // Products & Suppliers (with a supplier's calls in the dialog).
      for (const [name, url] of [
        ["dash-tech-month", `${dash}?tab=tech&tech=y`],
        ["dash-tech-prev", `${dash}?tab=tech&tech=y&offset=-1`],
        ["dash-tech-week", `${dash}?tab=tech&tech=y&period=week`],
        ["dash-tech-custom", `${dash}?tab=tech&tech=s&period=custom&from=2026-10-01&to=2026-10-21`],
        ["dash-tech-custom-error", `${dash}?tab=tech&tech=y&period=custom&from=2026-10-10&to=2026-10-01`],
        ["dash-tech-reports", `${dash}?tab=tech&tech=y&view=reports`],
        ["dash-products", `${dash}?tab=prod`],
      ] as const) {
        await openPage(page, url);
        await ready();
        await shot(name);
      }
      await openPage(page, `${dash}?tab=prod&detail=prod.bySupplier&group=${encodeURIComponent("מ.ס. יבוא")}`);
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("dash-products-dialog", false);

      // Set E (D57 (9), owner message 6): "נפתחה" (opened_at) and "תחילת טיפול" (first arrival) with
      // their own labels on the customer card (48213: opened 19.10, not started; the return counted
      // from opened_at) and on the products screen's "נוצר מזימון".
      await openPage(page, "/dev/demo/office/mgr/customers/cu-298747");
      await shot("customer-card-dates");
      await openPage(page, "/dev/demo/office/mgr/products");
      await shot("products-dates", false);

      // The reference, tab by tab, and its dialog ("לא בוצעו במועד").
      const refShot = async (name: string, fullPage = true) => {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: file(`ref-${name}`), fullPage });
      };
      await page.goto(DASH_REFERENCE_URL);
      await refShot("general");
      await page.locator('[data-tab="tech"]').click();
      await refShot("tech");
      await page.locator('[data-tab="products"]').click();
      await refShot("products");
      await page.locator('[data-tab="general"]').click();
      await page.locator(".kpi", { hasText: "לא בוצעו במועד" }).click();
      await expect(page.locator("#overlay")).toHaveClass(/open/);
      await refShot("modal", false);
    });
  }
});

// Step 2 PR 2.2 (port alignment): the two visible demo changes. "+ הוספת משתמש" no longer offers
// "יוצר" (a disabled "יוצר · ממתין להחלטת בעלים" and a note, TEMPORARY Q9), and the Manager's
// "+ בקשת חשבון שירות לקוחות" has no phone field. The demo counterpart of the Creator's form is
// docs/review/ui-demo-3/<w>-demo-settings-users.png (docs/demo.html's "+ הוספת משתמש" is a toast);
// docs/demo.html has no request form. A closed native select hides its options, so a crop of the
// form shows the role list opened as a list box (size attribute set for the shot only). Run only
// this block:
//   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-pr22"
const OUT_PR22 = path.resolve("docs/review/step2-pr22");

test.describe("step2-pr22 review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`step2-pr22 screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      const file = (name: string) => path.join(OUT_PR22, `${size.width}-${name}.png`);

      await openPage(page, "/dev/demo/office/creator/settings/users");
      await page.getByRole("button", { name: "+ הוספת משתמש" }).click();
      const account = page.getByRole("form", { name: "הוספת משתמש" });
      await expect(account).toBeVisible();
      await appShot(page, file("creator-add-user-form"), true);
      // The role options as a list (screenshot only): "יוצר · ממתין להחלטת בעלים" is greyed out.
      await account.getByLabel("הרשאה").evaluate((el) => el.setAttribute("size", "3"));
      await account.scrollIntoViewIfNeeded();
      await account.screenshot({ path: file("creator-add-user-roles") });

      await openPage(page, "/dev/demo/office/mgr/settings/accounts");
      await page.getByRole("button", { name: "+ בקשת חשבון שירות לקוחות" }).click();
      const request = page.getByRole("form", { name: "בקשת חשבון שירות לקוחות" });
      await expect(request).toBeVisible();
      await appShot(page, file("mgr-cs-request-form"), true);
      await request.scrollIntoViewIfNeeded();
      await request.screenshot({ path: file("mgr-cs-request-form-crop") });
    });
  }
});

// Step 2 PR 2.3 "screens first" (fake data, all PROPOSED): the sign-in prototype in its four states,
// the temporary start screens (Q18), "יציאה" (Q4), the Creator's notices and credential dialogs, the
// routine edit and the incomplete creations. Dialogs are shot open and empty (no typed password in
// any image). Run only this block, from a local production build:
//   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "step2-ui"
const OUT_STEP2_UI = path.resolve("docs/review/step2-ui");

test.describe("step2-ui review screenshots", () => {
  onlyInProject("desktop");

  for (const size of SIZES) {
    test(`step2-ui screens at ${size.width}px`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      const file = (name: string) => path.join(OUT_STEP2_UI, `${size.width}-${name}.png`);
      /** A dialog, open and untouched: the viewport (the drawer is fixed over the page). */
      const dialogShot = async (opener: string, name: string) => {
        await page.getByRole("button", { name: opener }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: file(name) });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      };

      for (const [name, url] of [
        ["login-form", "/dev/demo/login"],
        ["login-failed", "/dev/demo/login?state=failed"],
        ["login-unavailable", "/dev/demo/login?state=unavailable"],
        ["login-no-access", "/dev/demo/login?state=no-access"],
        ["start-creator", "/dev/demo/start/creator"],
        ["start-mgr", "/dev/demo/start/mgr"],
        ["start-cs", "/dev/demo/start/cs"],
        ["start-tech", "/dev/demo/start/tech"],
        ["start-tech-profile", "/dev/demo/start/tech/profile"],
      ] as const) {
        await openPage(page, url);
        await appShot(page, file(name));
      }

      // "יציאה": the top of an office page (the end of the top bar at 900 px and below) and the
      // technician profile's "חשבון".
      await openPage(page, "/dev/demo/office/mgr/calls");
      await page.screenshot({ path: file("office-signout-topbar") });
      await openPage(page, "/dev/demo/tech/profile");
      await appShot(page, file("tech-profile-signout"));

      // The Creator's Settings › "משתמשים והרשאות": notices, the table with the intent and גלעד, areq-6.
      await openPage(page, "/dev/demo/office/creator/settings/users");
      const notices = page.locator(".set-body > .card").first();
      await notices.scrollIntoViewIfNeeded();
      await notices.screenshot({ path: file("creator-notices") });
      await dialogShot("סיסמה · הגדרת סיסמה לחשבון של שיראל", "creator-password-dialog");
      await dialogShot("מייל · שינוי כתובת המייל של הדס", "creator-email-dialog");
      await dialogShot("עריכה · הפרטים של יורם", "creator-edit-tech");
      await dialogShot("השלמה · פרופיל הטכנאי של גלעד", "complete-technician");
      await dialogShot("השלמת יצירה: יצירת חשבון · נציגת ערב", "creator-complete-request");
      await openPage(page, "/dev/demo/office/creator/settings/users");
      await appShot(page, file("creator-users"));

      // The Manager's Settings › "משתמשים".
      await openPage(page, "/dev/demo/office/mgr/settings/accounts");
      await dialogShot("עריכה · הפרטים של אדי", "mgr-edit-tech");
      await dialogShot("עריכה · הפרטים של שיראל", "mgr-edit-cs");
      await dialogShot("השלמת יצירה · טכנאי חדש", "mgr-complete-creation");
      await openPage(page, "/dev/demo/office/mgr/settings/accounts");
      await appShot(page, file("mgr-accounts"));
    });
  }
});
