import { expect, test } from "@playwright/test";
import { box, openPage } from "./helpers";

// Owner visual review round 1 (2026-11-02): TE-33 next-visit actions and the table column rules
// (design-system.md "Tables"). Runs at 390, 820 and 1440 px.

test("next-visit card: demo layout below 600px, equal Waze and details buttons from 600px", async ({ page }) => {
  await openPage(page, "/dev/showcase/tech");
  const viewport = page.viewportSize()!;
  const waze = await box(page, ".next-actions > .bigbtn");
  const details = await box(page, ".next-actions > .btn");
  const wazeBackground = await page.locator(".next-actions > .bigbtn").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(wazeBackground).toBe("rgb(21, 94, 117)"); // --accent #155E75: Waze stays the primary button
  if (viewport.width >= 600) {
    expect(Math.abs(waze.width - details.width)).toBeLessThanOrEqual(1);
  } else {
    expect(waze.width).toBeGreaterThan(details.width * 2); // unchanged demo layout on phones
  }
});

test("calls table: short columns centred and sized to content, long text right-aligned", async ({ page }) => {
  await openPage(page, "/dev/showcase/office");
  const viewport = page.viewportSize()!;

  const report = await page.evaluate(() => {
    const table = document.querySelector("table")!;
    const headers = [...table.querySelectorAll("thead th")] as HTMLElement[];
    const rows = [...table.querySelectorAll("tbody tr")] as HTMLTableRowElement[];
    const contentWidth = (cell: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const style = getComputedStyle(cell);
      return range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    };
    return headers.map((th, i) => {
      const cells = [th, ...rows.map((r) => r.cells[i] as HTMLElement)];
      return {
        name: th.textContent!.trim(),
        fit: th.classList.contains("col-fit"),
        centred: th.classList.contains("col-center"),
        width: th.getBoundingClientRect().width,
        widest: Math.max(...cells.map(contentWidth)),
        aligns: [...new Set(cells.map((c) => getComputedStyle(c).textAlign))],
      };
    });
  });

  const byName = Object.fromEntries(report.map((c) => [c.name, c]));
  for (const name of ["מס׳ פנייה", "מק\"ט", "טכנאי", "ביקורים", "ביקור אחרון / הבא", "סטטוס"]) {
    expect(byName[name]?.centred, name).toBe(true);
    expect(byName[name]?.aligns, name).toEqual(["center"]);
  }
  for (const name of ["לקוח", "עיר", "מוצר", "נציגה"]) {
    expect(byName[name]?.centred, name).toBe(false);
    for (const align of byName[name]!.aligns) expect(["right", "start"], name).toContain(align);
  }

  const scroller = page.locator(".scrollx").first();
  const [scrollWidth, clientWidth] = await scroller.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  if (viewport.width > 520) {
    // Content-sized columns take only their content; the rest goes to customer and product.
    for (const column of report.filter((c) => c.fit)) {
      expect(column.width, column.name).toBeLessThanOrEqual(column.widest + 2);
    }
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth); // fits without sideways scrolling
  } else {
    expect(scrollWidth).toBeGreaterThan(clientWidth); // phones keep the demo's scrolling table
  }
});
