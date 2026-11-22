import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { seeded, signInAs } from "./helpers";

// On demand only (SCREENSHOTS=1): the review images of the Manager dashboard SKELETON (D81, D96) at
// 390 and 1440 px (office, D72), from a local production build signed in to the LOCAL stack
// (tests/auth/run-local.mjs) as the fictional, test-marked Manager. The dashboard itself shows fixed
// fake data (features/dashboard/skeleton-data.ts): nothing is written to the stack.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/manager-dashboard-skeleton-screenshots.spec.ts
// Full-page PNGs are converted to WebP (ImageMagick `convert`) and removed.
const OUT = path.resolve(process.env.SHOTS_DIR || "docs/review/manager-dashboard-skeleton");
const SIZES = [
  { width: 390, height: 844 },
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

async function shoot(page: Page, url: string, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "דשבורד" })).toBeVisible();
    await ready(page);
    // The office shell scrolls inside its work area: grow the viewport to the whole dashboard.
    const height = await page.evaluate(() => {
      const work = document.querySelector(".work");
      return Math.max(document.documentElement.scrollHeight, work ? work.scrollHeight + work.getBoundingClientRect().top : 0);
    });
    await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.ceil(height)) });
    await ready(page);
    const png = path.join(OUT, `${size.width}-${name}.png`);
    await page.screenshot({ path: png, fullPage: true });
    execFileSync("convert", [png, "-quality", "80", png.replace(/\.png$/, ".webp")]);
    rmSync(png);
  }
}

test("manager dashboard skeleton: the three tabs", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SIZES[1]);
  await signInAs(page, seeded().mgr, /\/office$/);
  await expect(page.getByText("נתוני בדיקה").first()).toBeVisible();
  await shoot(page, "/office", "general");
  await shoot(page, "/office?tab=tech", "technicians");
  await shoot(page, "/office?tab=prod", "products");
});
