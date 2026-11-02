import { expect, test } from "@playwright/test";
import { ALL_PAGES, box, horizontalOverflow, openPage } from "./helpers";

// Runs in the phone (390), tablet (820) and desktop (1440) projects.

for (const path of ALL_PAGES) {
  test(`${path}: Hebrew RTL and no horizontal overflow`, async ({ page }) => {
    await openPage(page, path);
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
    expect(await horizontalOverflow(page)).toEqual([]);
  });
}

test("office shell: sidebar on the right above 900px, top bar below", async ({ page }) => {
  await openPage(page, "/dev/showcase/office");
  const viewport = page.viewportSize()!;
  const side = await box(page, ".side");
  const work = await box(page, ".work");
  const me = page.locator(".side .me");
  if (viewport.width > 900) {
    expect(side.width).toBeCloseTo(220, 0);
    expect(side.x).toBeGreaterThan(work.x);
    await expect(me).toBeVisible();
  } else {
    expect(side.width).toBeCloseTo(viewport.width, 0);
    expect(side.y).toBeLessThan(work.y);
    await expect(me).toBeHidden();
  }
});

test("technician shell: fixed header and bottom nav, content width per breakpoint", async ({ page }) => {
  await openPage(page, "/dev/showcase/tech");
  const viewport = page.viewportSize()!;
  const head = await box(page, ".ph-head");
  const nav = await box(page, ".ph-nav");
  expect(head.y).toBeCloseTo(0, 0);
  expect(head.width).toBeCloseTo(viewport.width, 0);
  expect(nav.y + nav.height).toBeCloseTo(viewport.height, 0);
  expect(nav.width).toBeCloseTo(viewport.width, 0);

  const card = await box(page, ".ph-main > *");
  if (viewport.width >= 600) {
    // Tablet layout, kept above 900px (owner decision 2026-11-01).
    expect(card.width).toBeCloseTo(Math.min(760, viewport.width - 48), 0);
    const leftGap = card.x;
    const rightGap = viewport.width - (card.x + card.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  } else {
    expect(card.width).toBeCloseTo(viewport.width - 28, 0);
  }

  if (viewport.width > 900) {
    // Desktop (owner review 2026-11-02): header and nav content share the card column.
    for (const selector of [".ph-head > *", ".ph-head > * + *", ".ph-head > * + * + *"]) {
      const content = await box(page, selector);
      expect(content.x).toBeCloseTo(card.x, 0);
      expect(content.width).toBeCloseTo(card.width, 0);
    }
    const navButtons = await page.locator(".ph-nav button").all();
    const first = (await navButtons[0]!.boundingBox())!;
    const last = (await navButtons[navButtons.length - 1]!.boundingBox())!;
    expect(Math.min(first.x, last.x)).toBeGreaterThanOrEqual(card.x - 1);
    expect(Math.max(first.x + first.width, last.x + last.width)).toBeLessThanOrEqual(card.x + card.width + 1);
  }
});

test("control sizes match the demo at this width", async ({ page }) => {
  await openPage(page, "/dev/showcase");
  const viewport = page.viewportSize()!;
  const tablet = viewport.width >= 600;
  const bigButton = await box(page, ".bigbtn");
  const actionTile = await box(page, ".act");
  expect(bigButton.height).toBe(tablet ? 60 : 54);
  expect(actionTile.height).toBe(tablet ? 62 : 54);

  await openPage(page, "/dev/showcase/tech");
  // Demo bottom-nav buttons: 22px icons give 41px, the 20px profile icon gives 39px.
  const navButtons = page.locator(".ph-nav button");
  await expect(navButtons).toHaveCount(3);
  const expected = [41, 41, 39];
  const buttons = await navButtons.all();
  for (const [i, navButton] of buttons.entries()) {
    expect(Math.abs((await navButton.boundingBox())!.height - expected[i]!)).toBeLessThanOrEqual(1);
  }
});
