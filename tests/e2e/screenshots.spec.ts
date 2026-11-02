import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, type Page } from "@playwright/test";
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
