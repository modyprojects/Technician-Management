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

/** Opens docs/demo.html as a role (tech | cs | mgr), demo bar hidden. */
async function demoAs(page: Page, role: "tech" | "cs" | "mgr") {
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
      await openPage(page, "/dev/demo/tech/visit/48213/1/close");
      await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
      await page.getByRole("region", { name: "המשך טיפול" }).getByRole("button").first().click();
      await page.getByLabel(/מה צריך בביקור הבא/).fill("להביא ברז חלופי ולתאם עם הלקוחה מראש.");
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
