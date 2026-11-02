import { expect, test } from "@playwright/test";
import { onlyInProject, openPage } from "./helpers";

// Exact demo thresholds (container queries on the stage): 520, 600 and 900 px.
test.describe("breakpoint boundaries", () => {
  onlyInProject("desktop");

  test("900 / 901: office sidebar collapses at 900px and below", async ({ page }) => {
    for (const [width, direction] of [[900, "row"], [901, "column"]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, "/dev/showcase/office");
      expect(await page.locator(".side").evaluate((el) => getComputedStyle(el).flexDirection)).toBe(direction);
    }
  });

  test("599 / 600: technician tablet layout starts at 600px", async ({ page }) => {
    for (const [width, height] of [[599, 54], [600, 60]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, "/dev/showcase");
      expect((await page.locator(".bigbtn").first().boundingBox())!.height).toBe(height);
    }
  });

  test("520 / 521: compact tables at 520px and below", async ({ page }) => {
    for (const [width, wrap] of [[520, "nowrap"], [521, "normal"]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, "/dev/showcase/office");
      expect(await page.locator("td").first().evaluate((el) => getComputedStyle(el).whiteSpace)).toBe(wrap);
    }
  });
});
