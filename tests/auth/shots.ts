import path from "node:path";
import type { Page } from "@playwright/test";

// The review-screenshot helper of the technician screens (D62 (6): 390, 820 and 1440 px).
export const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

export async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

/** One image per width, `<dir>/<width>-<name>.png`; `bottom` scrolls the content to its end first. */
export async function shoot(page: Page, dir: string, name: string, opts: { bottom?: boolean } = {}) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await ready(page);
    await page.evaluate((bottom) => {
      const main = document.querySelector(".ph-main");
      if (main) main.scrollTop = bottom ? main.scrollHeight : 0;
    }, Boolean(opts.bottom));
    await page.screenshot({ path: path.join(dir, `${size.width}-${name}.png`) });
  }
}
