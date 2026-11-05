import { expect, test, type Page } from "@playwright/test";
import { DEMO_PAGES, FIXTURE_SENTINEL, horizontalOverflow, onlyInProject, openPage, verticalPageOverflow } from "./helpers";

// UI demo with fictional data (D53, /dev/demo). Runs in the phone (390), tablet (820) and desktop
// (1440) projects unless a block says otherwise. Every action in the demo is simulated: the tests
// check that it says so ("פעולה מדומה · לא נשמר") and that nothing claims a save or an email.

const SIMULATED = "פעולה מדומה · לא נשמר";

/** Views that live behind query strings (tabs, drill-down, filters), on top of DEMO_PAGES. */
const DEMO_VIEWS = [
  "/dev/demo/office/mgr/analytics?tab=tech",
  "/dev/demo/office/mgr/analytics?tab=prod",
  "/dev/demo/office/mgr/analytics?tab=tech&tech=y",
  // D57 dashboard: chart range, periods, custom range, reports view, dialogs, sort, the Creator.
  "/dev/demo/office/mgr/analytics?months=12",
  "/dev/demo/office/mgr/analytics?tab=tech&tech=y&period=week",
  "/dev/demo/office/mgr/analytics?tab=tech&tech=s&period=custom&from=2026-10-01&to=2026-10-21",
  "/dev/demo/office/mgr/analytics?tab=tech&tech=y&view=reports",
  "/dev/demo/office/mgr/analytics?detail=today.missed",
  "/dev/demo/office/mgr/analytics?tab=prod&detail=prod.skuCalls&group=KT-2041",
  "/dev/demo/office/mgr/analytics?tab=prod&sort=calls-asc",
  "/dev/demo/office/creator/analytics?tab=tech",
  "/dev/demo/office/mgr/calls?status=followup",
  // Calendars (OF-03, TE-27): views, another date, a technician filter and the open drawer.
  "/dev/demo/office/mgr/calendar?view=week",
  "/dev/demo/office/mgr/calendar?view=month",
  "/dev/demo/office/mgr/calendar?date=2026-10-11",
  "/dev/demo/office/mgr/calendar?tech=y",
  "/dev/demo/office/mgr/calendar?req=48213&n=1",
  "/dev/demo/office/cs/calendar?view=week&req=48205&n=2",
  "/dev/demo/tech/calendar?view=week",
  "/dev/demo/tech/calendar?view=month",
  "/dev/demo/tech/calendar?date=2026-10-19",
  "/dev/demo/tech/done/47800/1?view=week&date=2026-10-21",
] as const;

/** Console errors and uncaught page errors while the test runs. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

const toast = (page: Page) => page.locator(".toast");

/** An account of the Manager or Creator role in a page's payload (escaped or not). */
const MANAGER_OR_CREATOR_ACCOUNT = /role\\?"\s*:\s*\\?"(creator|mgr)\\?"/;

/** The white MODY logo in a dark header (D57 (6)): one per page. */
const officeLogo = (page: Page) => page.locator('.side img[alt="MODY"][src*="/brand/mody-logo-white.png"]');
const techLogo = (page: Page) => page.locator('.ph-head .ph-brand img[alt="MODY"][src*="/brand/mody-logo-white.png"]');

test.describe("demo pages render", () => {
  for (const path of [...DEMO_PAGES, ...DEMO_VIEWS]) {
    test(`${path}: sentinel, test-data strip, no overflow, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await openPage(page, path);
      await expect(page.locator(`[data-fixtures="${FIXTURE_SENTINEL}"]`).first()).toBeAttached();
      const strip = page.getByRole("note", { name: "הדגמה עם נתוני בדיקה" });
      await expect(strip).toBeVisible();
      await expect(strip).toContainText("נתוני בדיקה");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      // D57 (6): one white MODY logo in the screen's dark header; never the dark file, never a light strip.
      if (path.startsWith("/dev/demo/office/")) await expect(officeLogo(page)).toHaveCount(1);
      if (path.startsWith("/dev/demo/tech")) await expect(techLogo(page)).toHaveCount(1);
      await expect(page.locator('img[src*="mody-logo.png"], .work-brand')).toHaveCount(0);
      expect(await horizontalOverflow(page)).toEqual([]);
      expect(await verticalPageOverflow(page), "the document scrolls past the app frame").toBe(0);
      // Let prefetches and hydration finish before reading the console.
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }

  test("unknown call, unknown visit and a closed visit's work screen are 404", async ({ request }) => {
    for (const path of [
      "/dev/demo/office/mgr/calls/99999",
      "/dev/demo/office/xx/calls",
      "/dev/demo/tech/visit/99999/1",
      "/dev/demo/tech/visit/47800/1/work",
      "/dev/demo/tech/visit/47800/1/close",
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain(FIXTURE_SENTINEL);
    }
  });
});

test.describe("calls list", () => {
  test("search narrows the results and updates the URL", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls");
    const table = page.getByRole("table", { name: "קריאות שירות" });
    const shown = page.locator("text=/^מציג \\d+ מתוך \\d+$/");
    const totalOf = async () => Number((await shown.innerText()).match(/מתוך (\d+)/)?.[1]);
    const before = await totalOf();
    expect(before).toBeGreaterThan(1);

    const firstLink = table.locator("tbody tr a.lnk").first();
    const label = (await firstLink.getAttribute("aria-label")) ?? "";
    const customer = label.split(" · ")[1] ?? "";
    expect(customer.length).toBeGreaterThan(1);

    await page.getByLabel("חיפוש קריאות").fill(customer);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect.poll(totalOf).toBeLessThan(before);
    const labels = await table.locator("tbody tr a.lnk").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toContain(customer);
  });

  test("status chip and technician select change the URL and the rows", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls");
    const chips = page.getByRole("group", { name: "סינון לפי סטטוס קריאה" });
    const chip = chips.getByRole("button", { name: /המשך טיפול/ });
    const count = Number((await chip.locator(".num").innerText()).trim());
    await chip.click();
    await expect(page).toHaveURL(/[?&]status=followup/);
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("text=/^מציג \\d+ מתוך \\d+$/")).toContainText(`מתוך ${count}`);

    await page.getByLabel("סינון לפי טכנאי").selectOption("e");
    await expect(page).toHaveURL(/[?&]tech=e/);
    await expect(page).toHaveURL(/[?&]status=followup/);
  });
});

test.describe("call card", () => {
  test("shows customer, product, problem and the visits", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByRole("heading", { name: /לקוח וכתובת/ })).toBeVisible();
    const details = page.locator("section", { has: page.getByRole("heading", { name: "פרטי הקריאה" }) });
    await expect(details).toContainText("מוצר");
    await expect(details).toContainText("תיאור התקלה");
    const visits = page.getByRole("region", { name: "ביקורים בקריאה" });
    await expect(visits.getByRole("article", { name: "ביקור 1" })).toBeVisible();
    await expect(visits.getByRole("article", { name: "ביקור 2" })).toBeVisible();
  });

  test("cancel is a disabled placeholder pending d08 (OF-09); customer service has no cancel", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    const cancel = page.getByRole("button", { name: "ביטול ביקור", exact: true });
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeDisabled();
    await expect(page.getByText("ממתין להחלטת בעלים (d08)")).toBeVisible();

    await openPage(page, "/dev/demo/office/cs/calls/48205");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByRole("button", { name: "ביטול ביקור", exact: true })).toHaveCount(0);
    await expect(page.getByText("ביטול ביקור: אין הרשאה לתפקיד הזה")).toBeVisible();
  });

  test("no actions beyond the demo and the deviations (no reschedule, no office note)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    await expect(page.getByRole("button", { name: "שינוי מועד" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "הוספת הערה" })).toHaveCount(0);
    await page.getByRole("button", { name: "חיוג לטכנאי" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
  });

  test("back button and the demo's header line", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    await expect(page.locator(".ptitle .sub").first()).toContainText("נציגה מטפלת:");
    const details = page.locator("section", { has: page.getByRole("heading", { name: "פרטי הקריאה" }) });
    await expect(details).toContainText("סוג קריאה");
    await expect(details).toContainText("באחריות");
    await page.getByRole("link", { name: "חזרה לקריאות" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calls$/);
  });
});

test.describe("simulated toast", () => {
  test("never blocks a tap and stays above the technician footer", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48205/2/work");
    await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
    await expect(toast(page)).toBeVisible();
    const hit = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(".ph-foot .bigbtn");
      if (!button) return "no footer button";
      const r = button.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el?.closest(".toast") ? "toast" : el?.closest(".ph-foot") ? "footer" : String(el?.className);
    });
    expect(hit).toBe("footer");
    const toastBox = await toast(page).boundingBox();
    const footBox = await page.locator(".ph-foot").boundingBox();
    expect(toastBox && footBox && toastBox.y + toastBox.height <= footBox.y + 1).toBe(true);
    await expect(toast(page)).toHaveCSS("pointer-events", "none");
  });

  test("office navigation: every sidebar item is a link; \"יומן טכנאים\" opens the calendar", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr");
    // D57 (1): the Manager's office home lands on the dashboard.
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/analytics$/);
    await expect(page.locator(".side .nav button")).toHaveCount(0);
    await page.locator(".side").getByRole("link", { name: "יומן טכנאים" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calendar$/);
    await expect(page.locator(".side").getByRole("link", { name: "יומן טכנאים" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("dashboards and access", () => {
  test("landing (D57 (1)): Manager and Creator are redirected (307) to \"דשבורד\"; Customer Service keeps its home", async ({ page }) => {
    for (const role of ["mgr", "creator"] as const) {
      const res = await page.request.get(`/dev/demo/office/${role}`, { maxRedirects: 0 });
      expect(res.status(), role).toBe(307);
      expect(res.headers().location, role).toMatch(new RegExp(`/dev/demo/office/${role}/analytics$`));
    }
    const cs = await page.request.get("/dev/demo/office/cs", { maxRedirects: 0 });
    expect(cs.status()).toBe(200);
    await openPage(page, "/dev/demo/office/creator");
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/analytics$/);
    await expect(sideNav(page).getByRole("link", { name: "דשבורד", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("customer-service home: work queue with test-data note, no dashboard links", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs");
    await expect(page.locator(".od-test-note")).toContainText("נתוני בדיקה");
    await expect(page.getByRole("table", { name: "קריאות שממתינות לשיבוץ" })).toContainText("48230");
    await expect(page.locator('a[href*="/analytics"]')).toHaveCount(0);
  });

  test("manager analytics (D57): three tabs, KPI tiles, test-data note and the technician's reports", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/analytics");
    await expect(page.getByRole("navigation", { name: "לשוניות הדשבורד" }).getByRole("link")).toHaveCount(3);
    await expect(page.locator(".kpis .kpi").first()).toBeVisible();
    expect(await page.locator(".kpis .kpi").count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".od-test-note")).toContainText("נתוני בדיקה");

    await page.getByRole("navigation", { name: "לשוניות הדשבורד" }).getByRole("link", { name: "טכנאים" }).click();
    await expect(page).toHaveURL(/tab=tech/);
    const technicians = page.getByRole("group", { name: "טכנאי:" });
    await expect(technicians.getByRole("link", { name: "יורם" })).toBeVisible();
    await expect(technicians.getByRole("link", { name: "אדי" })).toBeVisible();
    await page.getByRole("link", { name: "הצג דוחות ‹" }).click();
    await expect(page).toHaveURL(/view=reports/);
    await expect(page.locator("table").first()).toBeVisible();
  });

  test("customer service cannot open the dashboards", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/analytics");
    await expect(page.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
    await expect(page.locator(".kpis")).toHaveCount(0);
    await expect(page.locator(".side").getByRole("link", { name: /דשבורד/ })).toHaveCount(0);
    // Query strings do not open a dashboard either.
    await openPage(page, "/dev/demo/office/cs/analytics?tab=tech&tech=y");
    await expect(page.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });
});

test.describe("technician", () => {
  test("home: bell, completed counter, calendar and bottom navigation are links", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    await expect(page.getByRole("link", { name: /התראות/ })).toHaveAttribute("href", "/dev/demo/tech/notifications");
    await expect(page.getByRole("link", { name: /הושלמו/ })).toHaveAttribute("href", "/dev/demo/tech/done");
    await expect(page.getByRole("link", { name: "יומן ›" })).toHaveAttribute("href", "/dev/demo/tech/calendar");
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    await expect(nav.locator("button")).toHaveCount(0);
    await nav.getByRole("link", { name: "פרופיל" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/profile$/);
    await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "יומן" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/calendar$/);
  });

  test("depart and arrive are simulated and open the work screen", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48213/1");
    await page.getByRole("button", { name: /Waze · יציאה ללקוח/ }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("יציאה ללקוח");
    await expect(page.getByText("הסטטוס: בדרך ללקוח")).toBeVisible();

    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await expect(toast(page)).toContainText("הגעה ללקוח");
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/visit\/48213\/1\/work$/);
  });

  test("pickup ticks go through the commands and are simulated (TE-03)", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    const card = page.getByRole("region", { name: "מה לאסוף לפני יציאה" });
    const box = card.getByRole("checkbox").first();
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("סימון נאסף");
    await expect(card).toContainText("1 מתוך");
  });

  test("statuses follow the technician between screens; a sent close leads home", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    const next = page.getByRole("region", { name: "הביקור הבא" });
    await next.getByRole("button", { name: /יוצא · Waze/ }).click();
    await expect(toast(page)).toContainText("יציאה ללקוח");
    await next.getByRole("link", { name: /פרטי קריאה/ }).click();
    await expect(page).toHaveURL(/\/tech\/visit\/\d+\/\d+$/);
    // Client navigation keeps the depart: the visit card shows "בדרך".
    await expect(page.getByText("הסטטוס: בדרך ללקוח")).toBeVisible();
  });

  test("after a sent close the back link goes to the day, and the home shows the visit closed", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48213/1/close");
    await expect(page.getByRole("link", { name: "חזרה לטיפול" })).toBeVisible();
    await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
    await page.getByRole("region", { name: "המשך טיפול" }).getByRole("button").first().click();
    await page.getByLabel(/מה צריך בביקור הבא/).fill("להביא חלק חלופי");
    // The work is not ready (no "after" photo), so the send stays disabled: add it first.
    await page.getByRole("link", { name: "לטיפול ›" }).click();
    await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
    await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("נבדק, נדרש חלק.");
    await page.getByRole("textbox", { name: "סיכום הטיפול" }).blur();
    await page.getByRole("link", { name: "סיום ביקור ›" }).click();
    await expect(page).toHaveURL(/\/48213\/1\/close$/);
    const send = page.locator(".ph-foot .bigbtn");
    await expect(send).toHaveText("שליחה · המשך טיפול");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("heading", { name: /סיום הביקור · ↻ המשך טיפול/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "חזרה לטיפול" })).toHaveCount(0);
    await page.locator(".ph-head").getByRole("link", { name: "חזרה להיום", exact: true }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech$/);
    await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText("נסגר");
  });

  test("a closed visit is read-only", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/47800/1");
    await expect(page.getByText(/🔒 הביקור נסגר בשרת/)).toBeVisible();
    await expect(page.getByRole("button", { name: "הגעתי · התחלת טיפול" })).toHaveCount(0);
  });

  test("work screen: add photo and a mock recording produce visible items", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48213/1/work");
    await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
    await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
    await expect(toast(page)).toContainText(SIMULATED);

    await page.getByRole("group", { name: "אופן הסיכום" }).getByRole("button", { name: /הקלטה/ }).click();
    await page.getByRole("button", { name: "התחלת הקלטה" }).click();
    await expect(page.getByRole("timer")).toBeVisible();
    await page.getByRole("button", { name: "עצירת הקלטה" }).click();
    await expect(page.getByText("הקלטה מדומה · לא נשמרה. לחץ שוב כדי להקליט מחדש.")).toBeVisible();
    await expect(page.getByRole("button", { name: "מחיקה" })).toBeVisible();
  });

  test("close screen: needs an outcome, signature pad draws, sending is simulated", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48205/2/work");
    await page.getByRole("button", { name: "הוספת תמונה אחרי הטיפול" }).click();
    await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
    await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("הוחלף אטם, נבדק ותקין.");
    await page.getByRole("textbox", { name: "סיכום הטיפול" }).blur();
    await page.getByRole("link", { name: "סיום ביקור ›" }).click();
    await expect(page).toHaveURL(/\/48205\/2\/close$/);

    const send = page.locator(".ph-foot .bigbtn, .bigbtn").last();
    await expect(send).toHaveText("בחר תוצאה");
    await expect(send).toBeDisabled();

    await page.getByRole("button", { name: /✓ טופל/ }).click();
    await expect(send).toHaveText("שליחה · הקריאה טופלה");
    await expect(send).toBeDisabled();
    await page.getByPlaceholder("שם הלקוח").fill("לקוח בדיקה");
    await expect(send).toBeDisabled();

    const pad = page.locator("canvas.sig");
    await expect(pad).toHaveAttribute("aria-label", "שטח חתימה · ריק");
    await pad.scrollIntoViewIfNeeded();
    const b = await pad.boundingBox();
    if (!b) throw new Error("no signature pad");
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.3, { steps: 6 });
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7, { steps: 6 });
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.4, { steps: 6 });
    await page.mouse.up();
    await expect(pad).toHaveAttribute("aria-label", "שטח חתימה · יש חתימה");
    // Something was drawn: the canvas has non-transparent pixels.
    const inked = await pad.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d");
      if (!ctx) return 0;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) n++;
      return n;
    });
    expect(inked).toBeGreaterThan(20);

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("heading", { name: /סיום הביקור · ✓ טופל/ })).toBeVisible();
    await expect(page.getByText(/פעולה מדומה/).first()).toBeVisible();
    await expect(page.getByText("בהדגמה שום דבר לא נשמר ולא נשלח מייל.")).toBeVisible();
    await expect(toast(page)).toContainText("לא נשלח מייל");
  });

  test("close screen: follow-up needs a reason and the next-visit note (TE-21)", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/visit/48213/1/close");
    await expect(page.getByText("לפני הסיום")).toBeVisible();
    await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
    const send = page.locator(".bigbtn").last();
    await expect(send).toHaveText("שליחה · המשך טיפול");
    await expect(send).toBeDisabled();
    await page.getByRole("region", { name: "המשך טיפול" }).getByRole("button").first().click();
    await expect(page.getByText(/מה צריך בביקור הבא/).last()).toBeVisible();
    await expect(page.locator(".sub", { hasText: "חסר: מה צריך בביקור הבא" })).toBeVisible();
    await expect(send).toBeDisabled();
  });
});

test.describe("office calendar", () => {
  test("day arrows skip the weekend; \"היום\" returns; segments and technician chips change the URL", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calendar");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toContainText("21.10");
    const steps = page.getByRole("group", { name: "מעבר בין תאריכים" });
    await steps.getByRole("link", { name: "יום העבודה הבא" }).click();
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-22$/);
    await expect(title).toContainText("22.10");
    // Thursday → Sunday: Friday and Saturday are skipped (the demo's calDay).
    await steps.getByRole("link", { name: "יום העבודה הבא" }).click();
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-25$/);
    await steps.getByRole("link", { name: "יום העבודה הקודם" }).click();
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-22$/);
    await steps.getByRole("link", { name: "היום", exact: true }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calendar$/);
    await expect(title).toContainText("21.10");

    // A technician chip filters the day to that technician's column and keeps the view.
    const chips = page.getByRole("group", { name: "טכנאי:" });
    const chip = chips.getByRole("link").nth(1);
    const name = (await chip.innerText()).trim();
    await chip.click();
    await expect(page).toHaveURL(/\/calendar\?tech=[a-z]+$/);
    await expect(chips.getByRole("link", { name })).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".calcol")).toHaveCount(1);
    await expect(page.locator(".calhead")).toContainText(name);

    const views = page.getByRole("group", { name: "תצוגת היומן" });
    await views.getByRole("link", { name: "שבוע" }).click();
    await expect(page).toHaveURL(/[?&]view=week/);
    await expect(page).toHaveURL(/[?&]tech=[a-z]+/);
    await expect(views.getByRole("link", { name: "שבוע" })).toHaveAttribute("aria-current", "true");
    await expect(title).toContainText("שבוע 18.10–22.10");
    await steps.getByRole("link", { name: "השבוע הבא" }).click();
    await expect(page).toHaveURL(/[?&]date=2026-10-28/);
    await expect(title).toContainText("שבוע 25.10–29.10");

    await views.getByRole("link", { name: "חודש" }).click();
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(title).toContainText("אוקטובר 2026");
    // A month day opens that day's day view (the filter stays).
    await page.locator("a.ocal-mcell", { hasText: /^\s*13\b/ }).first().click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(page).toHaveURL(/[?&]date=2026-10-13/);
    await expect(page).toHaveURL(/[?&]tech=[a-z]+/);

    await chips.getByRole("link", { name: "כולם" }).click();
    await expect(page).not.toHaveURL(/tech=/);
    expect(await page.locator(".calcol").count()).toBeGreaterThan(1);
  });

  test("a visit block opens the drawer; Escape, ✕ and the background close it; the drawer links to the call card", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calendar");
    const block = page.locator("a.ocal-ev").first();
    await block.click();
    await expect(page).toHaveURL(/[?&]req=\d+&n=\d+$/);
    const req = new URL(page.url()).searchParams.get("req") ?? "";
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog).toContainText(`פנייה ${req}`);
    await expect(dialog).toContainText("מצב בשטח");
    await expect(dialog).toContainText("🧪 זימון בדיקה");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/req=/);
    await expect(block).toBeFocused();

    await block.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "סגירה" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/req=/);

    await block.click();
    await expect(dialog).toBeVisible();
    // Tab stays inside the open drawer.
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await dialog.getByRole("button", { name: "חיוג לטכנאי" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    const card = dialog.getByRole("link", { name: /לכרטיס הקריאה המלא/ });
    await expect(card).toHaveAttribute("href", `/dev/demo/office/mgr/calls/${req}`);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/dev/demo/office/mgr/calls/${req}$`));
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  });

  test("a click on the dimmed background closes the drawer; a week block opens it too", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/calendar?view=week");
    const block = page.locator("a.ocal-wk-ev").first();
    await block.click();
    await expect(page).toHaveURL(/[?&]view=week&req=\d+&n=\d+$/);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const req = new URL(page.url()).searchParams.get("req") ?? "";
    await expect(dialog.getByRole("link", { name: /לכרטיס הקריאה המלא/ })).toHaveAttribute("href", `/dev/demo/office/cs/calls/${req}`);
    // RTL: .drawer-bg puts the panel (min(440px, 100%)) at the left edge, so the dimmed background
    // is the free area to its right. At 390 the panel fills the width and there is no background
    // to click; at 820 and 1440 there must be one, and a click on it closes the drawer.
    const vp = page.viewportSize();
    const panel = await page.locator(".drawer").boundingBox();
    if (!vp || !panel) throw new Error("no viewport or drawer");
    const hasBackground = panel.x + panel.width < vp.width - 20;
    expect(hasBackground, `dimmed background beside the drawer at ${vp.width}px`).toBe(vp.width > 440);
    if (hasBackground) {
      await page.mouse.click(vp.width - 10, vp.height / 2);
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/\/office\/cs\/calendar\?view=week$/);
    }
  });
});

test.describe("office calendar test data and bounds", () => {
  test("test visits carry 🧪 in the day and week views, and the \"נתוני בדיקה\" note shows (D47, SIM-15)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calendar");
    await expect(page.getByRole("note").filter({ hasText: "היומן כולל נתוני בדיקה" })).toBeVisible();
    await expect(page.locator("a.ocal-ev").first()).toContainText("נתוני בדיקה");
    await expect(page.locator("a.ocal-ev").first().locator(".pill")).toContainText("🧪");

    await openPage(page, "/dev/demo/office/mgr/calendar?view=week");
    await expect(page.getByRole("note").filter({ hasText: "היומן כולל נתוני בדיקה" })).toBeVisible();
    const block = page.locator("a.ocal-wk-ev").first();
    await expect(block).toContainText("🧪");
    await expect(block.locator(".sr-only")).toHaveText(/נתוני בדיקה/);

    await openPage(page, "/dev/demo/office/mgr/calendar?view=month");
    await expect(page.getByRole("note").filter({ hasText: "היומן כולל נתוני בדיקה" })).toBeVisible();
  });

  test("a cancelled visit has no drawer (it is never on a calendar)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calendar?req=48230&n=1");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("21.10");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("month arrows open today or the month's first work day, never a weekend", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calendar?view=month");
    const steps = page.getByRole("group", { name: "מעבר בין תאריכים" });
    // November 2026 starts on a Sunday; August 2026 starts on a Saturday (so its first work day is the 2nd);
    // October 2026 holds the demo's today, which is left out of the address.
    await expect(steps.getByRole("link", { name: "החודש הבא" })).toHaveAttribute("href", /date=2026-11-01/);
    await openPage(page, "/dev/demo/office/mgr/calendar?view=month&date=2026-09-15");
    await expect(steps.getByRole("link", { name: "החודש הקודם" })).toHaveAttribute("href", /date=2026-08-02/);
    await expect(steps.getByRole("link", { name: "החודש הבא" })).toHaveAttribute("href", /view=month(?!.*date=)/);
  });
});

test.describe("showcase: \"הושלמו היום\" with rows", () => {
  test("rows, the 🧪 badge and the pager render without overflow", async ({ page }) => {
    const errors = collectErrors(page);
    await openPage(page, "/dev/showcase");
    const list = page.getByRole("region", { name: "ביקורים שהושלמו היום" });
    await expect(list.getByRole("link")).toHaveCount(3);
    await expect(list.getByRole("link").first()).toContainText("08:00");
    await expect(list.getByRole("link").first()).toContainText("טופל");
    await expect(list.locator(".pill", { hasText: "🧪" })).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "עמודי הביקורים שהושלמו" })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});

test.describe("technician calendar and closed visits", () => {
  test("day / week / month segments and the arrows change the URL; \"יומן\" is the active tab", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/calendar");
    const views = page.getByRole("group", { name: "תצוגת היומן" });
    await expect(views.getByRole("link", { name: "יומי" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("group", { name: "ימי השבוע" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "יומן" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "יום העבודה הבא" }).click();
    await expect(page).toHaveURL(/\/tech\/calendar\?date=2026-10-22$/);
    await page.getByRole("link", { name: "יום העבודה הבא" }).click();
    await expect(page).toHaveURL(/\/tech\/calendar\?date=2026-10-25$/);

    await views.getByRole("link", { name: "שבועי" }).click();
    await expect(page).toHaveURL(/\/tech\/calendar\?view=week&date=2026-10-25$/);
    await expect(views.getByRole("link", { name: "שבועי" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "השבוע שלי" })).toBeVisible();
    await expect(page.getByRole("group", { name: "ימי השבוע" })).toHaveCount(0);
    await page.getByRole("link", { name: "השבוע הקודם" }).click();
    await expect(page).toHaveURL(/view=week&date=2026-10-18$/);

    await views.getByRole("link", { name: "חודשי" }).click();
    await expect(page).toHaveURL(/view=month&date=2026-10-18$/);
    await expect(page.locator("main")).toContainText("לחיצה על יום פותחת אותו");

    await views.getByRole("link", { name: "יומי" }).click();
    await expect(page).toHaveURL(/\/tech\/calendar\?date=2026-10-18$/);
    await expect(page.getByRole("group", { name: "ימי השבוע" })).toBeVisible();
  });

  test("a closed visit in the week opens its read-only view; \"› חזרה\" returns to the same view", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/calendar?view=week");
    const closed = page.getByRole("region", { name: "השבוע שלי" }).locator('a[href*="/dev/demo/tech/done/"]').first();
    await expect(closed).toBeVisible();
    await closed.click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/done\/\d+\/\d+\?view=week&date=2026-10-21$/);
    await expect(page.getByText(/🔒/).first()).toBeVisible();
    // Read-only (D14): no action, input or signature pad on the screen.
    await expect(page.locator(".ph-main").locator("button, input, textarea, select, canvas")).toHaveCount(0);
    await expect(page.locator(".ph-foot")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "יומן" })).toBeVisible();
    await page.locator(".ph-head").getByRole("link", { name: "חזרה ליומן" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/calendar\?view=week&date=2026-10-21$/);
  });

  test("an open visit in the day view opens its visit card", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/calendar");
    const open = page.locator('main a[href*="/dev/demo/tech/visit/"]').first();
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/visit\/\d+\/\d+$/);
  });

  test("done list from the home: read-only and empty today; a done view goes back to the list", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    await page.getByRole("link", { name: /הושלמו/ }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/done$/);
    await expect(page.getByRole("heading", { level: 1, name: "הושלמו היום" })).toBeVisible();
    await expect(page.locator(".ph-head")).toContainText("צפייה בלבד");
    // No fixture visit of the demo technician closed today (as in docs/demo.html).
    await expect(page.getByText("עוד לא הושלמו ביקורים היום")).toBeVisible();
    await expect(page.locator(".ph-main").locator("button, input, textarea, select")).toHaveCount(0);

    await openPage(page, "/dev/demo/tech/done/47800/1");
    await expect(page.getByText(/🔒/).first()).toBeVisible();
    await expect(page.getByText("הסיכום שלך")).toBeVisible();
    await expect(page.locator(".ph-main").locator("button, input, textarea, select, canvas")).toHaveCount(0);
    await page.locator(".ph-head").getByRole("link", { name: "חזרה לרשימת הושלמו היום" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/done$/);
  });

  test("another technician's or an open visit has no done view (404)", async ({ request }) => {
    for (const path of ["/dev/demo/tech/done/48198/1", "/dev/demo/tech/done/48213/1", "/dev/demo/tech/done/99999/1"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain(FIXTURE_SENTINEL);
    }
  });
});

test.describe("technician notifications and profile", () => {
  test("\"סמן הכל כנקרא\" is simulated and moves every item to \"קודמות\"", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "התראות" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^חדשות · \d+$/ })).toBeVisible();
    const markAll = page.getByRole("button", { name: "סמן הכל כנקרא" });
    await markAll.click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("סימון כל ההתראות כנקראו");
    await expect(markAll).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^חדשות/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "קודמות" })).toBeVisible();
    await expect(page.locator("a.tnp-item.unread")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "התראות" })).toBeFocused();
  });

  test("opening an unread notification marks it read (simulated) and opens its visit", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/notifications");
    const item = page.locator("a.tnp-item.unread").first();
    const href = (await item.getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/dev\/demo\/tech(\/visit\/\d+\/\d+)?$/);
    await item.click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("סימון התראה כנקראה");
    await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}$`));
  });

  test("profile: technician, week figures, simulated toggles and dial, disabled placeholders", async ({ page }) => {
    await openPage(page, "/dev/demo/tech/profile");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.locator(".ph-head")).toContainText("טכנאי שירות");
    const week = page.getByRole("region", { name: "השבוע שלי" });
    await expect(week).toContainText("ביקורים השבוע");
    await expect(week).toContainText("טופלו");
    await expect(page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "פרופיל" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // TE-29: no morning pickup reminder toggle.
    await expect(page.getByText(/תזכורת "מה לאסוף"/)).toHaveCount(0);

    const toggle = page.getByRole("switch").first();
    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    await expect(toast(page)).toContainText(SIMULATED);

    await page.getByRole("button", { name: /חיוג למשרד/ }).click();
    await expect(toast(page)).toContainText("לא מתבצעת שיחה");
    await expect(page.getByRole("button", { name: "דיווח" })).toBeDisabled();
    // No sign-out entry: it is not in the demo or the spec (open question to the owner).
    await expect(page.getByRole("button", { name: "התנתקות" })).toHaveCount(0);
  });
});

// Phase E: the Creator viewpoint, Settings (SE-01 to SE-16) and the Manager's account
// administration (D34). Permission values are display only and TEMPORARY (G-04, D51).

const SETTINGS_TABS = ["users", "techs", "places", "reasons", "types", "mail", "template"] as const;
const sideNav = (page: Page) => page.locator(".side").getByRole("navigation", { name: "ניווט ראשי" });

test.describe("office navigation per role (phase E)", () => {
  test("Creator and Manager have \"הגדרות\" and no \"משתמשים\" item (D57: the Manager's opens Settings › משתמשים); customer service has neither", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/creator");
    await expect(sideNav(page).getByRole("link", { name: "הגדרות", exact: true })).toHaveAttribute("href", "/dev/demo/office/creator/settings/users");
    await expect(sideNav(page).getByRole("link", { name: "משתמשים", exact: true })).toHaveCount(0);

    await openPage(page, "/dev/demo/office/mgr");
    await expect(sideNav(page).getByRole("link", { name: "הגדרות", exact: true })).toHaveAttribute("href", "/dev/demo/office/mgr/settings/accounts");
    await expect(sideNav(page).getByRole("link", { name: "משתמשים", exact: true })).toHaveCount(0);

    await openPage(page, "/dev/demo/office/cs");
    await expect(sideNav(page).getByRole("link", { name: "משתמשים", exact: true })).toHaveCount(0);
    await expect(sideNav(page).getByRole("link", { name: "הגדרות", exact: true })).toHaveCount(0);
  });

  test("no usage screen anywhere (OF-15 pending d13): no \"מדדי שימוש\" link for any role or tab", async ({ page }) => {
    for (const path of [
      "/dev/demo",
      "/dev/demo/office/mgr",
      "/dev/demo/office/cs",
      "/dev/demo/office/creator",
      "/dev/demo/office/mgr/users",
      ...SETTINGS_TABS.map((t) => `/dev/demo/office/creator/settings/${t}`),
    ]) {
      await openPage(page, path);
      await expect(page.getByRole("link", { name: /מדדי שימוש/ }), path).toHaveCount(0);
      await expect(page.locator('a[href*="usage"]'), path).toHaveCount(0);
    }
  });

  test("Creator settings: seven tab links, the open one is aria-current, no role switcher in the app (X-02)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const tabs = page.getByRole("navigation", { name: "לשוניות ההגדרות" });
    await expect(tabs.getByRole("link")).toHaveCount(7);
    await expect(tabs.getByRole("link", { name: "משתמשים והרשאות" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "סוגי קריאה" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/settings\/types$/);
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות · סוגי קריאה" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "סוגי קריאה" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("תיקון", { exact: true })).toBeVisible();
    await expect(page.getByText("התקנה", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /תפקיד|צפייה כ/ })).toHaveCount(0);
  });

  test("the open tab is scrolled into the visible part of the tab row (horizontal at 900 px and below)", async ({ page }) => {
    for (const tab of ["template", "mail", "users"] as const) {
      await openPage(page, `/dev/demo/office/creator/settings/${tab}`);
      const row = page.getByRole("navigation", { name: "לשוניות ההגדרות" });
      const current = row.locator('[aria-current="page"]');
      await expect
        .poll(async () => {
          const [r, c] = await Promise.all([row.boundingBox(), current.boundingBox()]);
          return Boolean(r && c && c.x >= r.x - 1 && c.x + c.width <= r.x + r.width + 1);
        }, { message: tab })
        .toBe(true);
      // Only the row scrolls, never the page.
      expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
    }
  });
});

test.describe("settings access (display only, G-04)", () => {
  for (const role of ["mgr", "cs"] as const) {
    test(`${role}: every settings tab shows the no-access card and no settings data`, async ({ page }) => {
      for (const tab of SETTINGS_TABS) {
        const path = `/dev/demo/office/${role}/settings/${tab}`;
        await openPage(page, path);
        await expect(page.getByRole("heading", { name: "אין הרשאה" }), path).toBeVisible();
        await expect(page.getByRole("navigation", { name: "לשוניות ההגדרות" }), path).toHaveCount(0);
        await expect(page.locator("main table, main .tog, main form"), path).toHaveCount(0);
        await expect(page.getByRole("table", { name: "מטריצת ההרשאות" }), path).toHaveCount(0);
      }
      const usersLink = page.getByRole("link", { name: "לניהול משתמשים" });
      await openPage(page, `/dev/demo/office/${role}/settings/users`);
      if (role === "mgr") {
        await expect(usersLink).toHaveAttribute("href", "/dev/demo/office/mgr/settings/accounts");
        await expect(page.getByText(/מנוהלים בלשונית "משתמשים"/)).toBeVisible();
      } else {
        await expect(usersLink).toHaveCount(0);
        // Account administration and the matrix are fixed Creator capabilities: no matrix wording.
        await expect(page.getByText(/זמין ליוצר בלבד/)).toBeVisible();
      }
      // "טכנאים" and "מיילים והתראות" are Creator-only for now (temporary, open owner question).
      for (const tab of ["techs", "mail"] as const) {
        await openPage(page, `/dev/demo/office/${role}/settings/${tab}`);
        await expect(page.getByText(/פתוחה ליוצר בלבד, עד החלטת הבעלים/)).toBeVisible();
        // Not the matrix wording: the matrix cannot grant these tabs.
        await expect(page.getByText(/קובע היוצר במטריצת ההרשאות/)).toHaveCount(0);
      }
      // The operational tabs follow the matrix key "הגדרות" (D35).
      await openPage(page, `/dev/demo/office/${role}/settings/places`);
      await expect(page.getByText(/את ההרשאה "הגדרות" קובע היוצר במטריצת ההרשאות/)).toBeVisible();
    });
  }

  test("customer service has no account administration; the Creator's \"משתמשים\" page points to Settings; the Manager's redirects", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/cs/users");
    await expect(page.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
    await expect(page.locator("main table, main form")).toHaveCount(0);
    await openPage(page, "/dev/demo/office/creator/users");
    await page.getByRole("link", { name: "למשתמשים והרשאות" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/settings\/users$/);
    // D57 (1): the former address of the Manager's account administration redirects (307).
    const res = await page.request.get("/dev/demo/office/mgr/users", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/dev\/demo\/office\/mgr\/settings\/accounts$/);
    await openPage(page, "/dev/demo/office/mgr/users");
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/settings\/accounts$/);
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות · משתמשים" })).toBeVisible();
    await expect(page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" })).toBeVisible();
  });
});

test.describe("permission matrix (SE-02, D33, D51)", () => {
  test("Creator: toggles with aria-pressed, the temporary marker, fixed Creator column, pending cells disabled", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const matrix = page.getByRole("table", { name: "מטריצת ההרשאות" });
    await expect(matrix.locator("tbody tr")).toHaveCount(13);
    await expect(page.getByText("ערכים זמניים · עד שלב 10")).toBeVisible();
    await expect(page.getByText(/הבעלים יאשר את הערכים הסופיים בשלב 10/)).toBeVisible();
    // Display only: the footer says enforcement is on the server and in the database.
    await expect(page.getByText(/ההרשאות נאכפות בשרת ובמסד הנתונים/)).toBeVisible();
    // Creator capabilities are fixed: no toggle in its column.
    await expect(matrix.getByRole("button", { name: /ליוצר$/ })).toHaveCount(0);
    await expect(matrix.getByRole("button", { name: /למנהל$/ })).toHaveCount(13);
    await expect(matrix.getByRole("button", { name: /לשירות לקוחות$/ })).toHaveCount(13);
    for (const key of ["עריכת מוצרים", "טיפול בפריטים לבדיקה", "הקלטות מקוריות"]) {
      await expect(matrix.getByRole("button", { name: `${key} למנהל` })).toHaveAttribute("aria-pressed", /true|false/);
    }
    // Pending cells: Customer Service cancel (d08) and usage for both roles (d13).
    await expect(matrix.getByRole("button", { name: "ביטול קריאה לשירות לקוחות" })).toBeDisabled();
    await expect(matrix.getByRole("button", { name: "מדדי שימוש למנהל" })).toBeDisabled();
    await expect(matrix.getByRole("button", { name: "מדדי שימוש לשירות לקוחות" })).toBeDisabled();
    await expect(matrix.getByText("ממתין להחלטת בעלים (d08)")).toBeVisible();
    // d13 (usage) is pending for every column, the Creator's included: never shown as granted.
    await expect(matrix.getByText("ממתין להחלטת בעלים (d13)")).toHaveCount(3);
    const usage = matrix.locator("tbody tr").filter({ hasText: "מדדי שימוש" });
    await expect(usage).not.toContainText("✓");
    await expect(matrix.locator("tbody tr").filter({ hasText: "יומן טכנאים" })).toContainText("✓ 🔒");
    await expect(matrix.getByRole("button", { name: "ביטול קריאה למנהל" })).toBeEnabled();
  });

  test("toggling a value is simulated (toast) and the switch flips", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const cell = page.getByRole("table", { name: "מטריצת ההרשאות" }).getByRole("button", { name: "יומן טכנאים לשירות לקוחות" });
    const before = await cell.getAttribute("aria-pressed");
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("מטריצת הרשאות");
    await expect(toast(page)).toContainText("ערך זמני");
  });
});

test.describe("account administration (SE-01, D34)", () => {
  test("Creator: every account with 🧪, own row without actions, no password or email editing", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const users = page.getByRole("table", { name: "משתמשים", exact: true });
    // Step 2 PR 2.3: גלעד (a Technician account without a field profile) is the eleventh account.
    await expect(users.locator("tbody tr")).toHaveCount(11);
    await expect(users.locator("tbody tr").filter({ hasText: "🧪" })).toHaveCount(11);
    const own = users.locator("tbody tr").filter({ hasText: "החשבון שלך" });
    await expect(own.getByRole("button")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /סיסמה|שינוי מייל/ })).toHaveCount(0);
    await page.getByRole("button", { name: "+ הוספת משתמש" }).click();
    const form = page.getByRole("form", { name: "הוספת משתמש" });
    // Step 2 PR 2.2 (Q9, TEMPORARY): a Creator account is not offered; the option says why and is disabled.
    const roles = form.getByLabel("הרשאה").locator("option");
    await expect(roles).toHaveText(["שירות לקוחות", "מנהל", "יוצר · ממתין להחלטת בעלים"]);
    await expect(roles.last()).toHaveJSProperty("disabled", true);
    await expect(roles.first()).toHaveJSProperty("disabled", false);
    await expect(form.getByLabel("הרשאה")).toHaveValue("cs");
    await expect(form.locator('option[value="creator"]')).toHaveCount(0);
    await expect(form.getByText("יצירת חשבון יוצר: ממתין להחלטת בעלים.", { exact: false })).toBeVisible();
    await expect(form.locator('input[type="password"]')).toHaveCount(0);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("Creator: \"בקשות לאישור\" offers approve and reject only, never a cancel of a Manager's request (PR 2.2 g)", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const requests = page.getByRole("list", { name: "בקשות לאישור" });
    await expect(requests.getByRole("button", { name: /^אישור: / })).toHaveCount(2);
    await expect(requests.getByRole("button", { name: /^דחייה: / })).toHaveCount(2);
    await expect(requests.getByRole("button", { name: /^ביטול הבקשה/ })).toHaveCount(0);
  });

  test("Creator: rejecting without a reason is blocked; with a reason it is simulated", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const requests = page.getByRole("list", { name: "בקשות לאישור" });
    await expect(page.getByText("2 ממתינות")).toBeVisible();
    await requests.getByRole("button", { name: "דחייה: יצירת חשבון · נציגה 3" }).click();
    const reason = page.getByLabel("סיבת הדחייה (חובה)");
    await expect(reason).toBeFocused();
    expect(await horizontalOverflow(page)).toEqual([]);
    await page.getByRole("button", { name: "שליחת הדחייה" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "יש לכתוב סיבת דחייה" })).toBeVisible();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(toast(page)).toHaveCount(0);

    await reason.fill("אין צורך בחשבון נוסף כרגע");
    await page.getByRole("button", { name: "שליחת הדחייה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("דחיית הבקשה");
    const row = requests.getByRole("listitem").filter({ hasText: "יצירת חשבון · נציגה 3" });
    await expect(row).toContainText("נדחתה");
    await expect(row).toContainText("סיבת הדחייה: אין צורך בחשבון נוסף כרגע");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("Creator: approving a pending request is simulated", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const requests = page.getByRole("list", { name: "בקשות לאישור" });
    const orit = page.getByRole("table", { name: "משתמשים", exact: true }).locator("tbody tr").filter({ hasText: "אורית" });
    // A pending request is decided here, not by a direct activation on the account row (F12).
    await expect(orit.getByRole("button")).toHaveCount(0);
    await expect(orit).toContainText("להחלטה בבקשות");
    await requests.getByRole("button", { name: "אישור: הפעלה מחדש · אורית" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("אישור הבקשה");
    const row = requests.getByRole("listitem").filter({ hasText: "הפעלה מחדש · אורית" });
    await expect(row).toContainText("אושרה");
    await expect(row).toBeFocused();
    // The approved reactivation shows on the account row, as not saved.
    await expect(orit).toContainText("פעיל");
    await expect(orit).not.toContainText("לא פעיל");
    await expect(orit).toContainText("לא נשמר · פעולה מדומה");
  });

  test("Manager: CS and technician accounts only; \"+ בקשת חשבון שירות לקוחות\" makes a pending request (simulated)", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    const accounts = page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" });
    // Step 2 PR 2.3: with גלעד (a Technician account without a field profile).
    await expect(accounts.locator("tbody tr")).toHaveCount(9);
    await expect(accounts.getByText("מנהל", { exact: true })).toHaveCount(0);
    await expect(accounts.getByText("יוצר", { exact: true })).toHaveCount(0);
    // אורית (inactive Customer Service) already has a pending reactivation request.
    await expect(accounts.locator("tbody tr").filter({ hasText: "אורית" })).toContainText("ממתינה לאישור היוצר");
    await expect(page.getByText(/המנהל לא קובע ולא מאפס סיסמאות/)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.getByRole("button", { name: "+ בקשת חשבון שירות לקוחות" }).click();
    const form = page.getByRole("form", { name: "בקשת חשבון שירות לקוחות" });
    expect(await horizontalOverflow(page)).toEqual([]);
    // An empty form is checked before the command runs (no toast).
    await form.getByRole("button", { name: "שליחה לאישור היוצר" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused();
    await expect(form.getByLabel("שם", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(toast(page)).toHaveCount(0);
    // A later field: the first invalid one gets focus.
    await form.getByLabel("שם", { exact: true }).fill("נציגה 4");
    await form.getByRole("button", { name: "שליחה לאישור היוצר" }).click();
    await expect(form.getByLabel("מייל", { exact: true })).toBeFocused();
    await expect(form.getByLabel("מייל", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByLabel("שם", { exact: true })).not.toHaveAttribute("aria-invalid", "true");

    // Step 2 PR 2.2 (h): a request stores no phone; it is added after the account is created.
    await expect(form.getByLabel("טלפון", { exact: true })).toHaveCount(0);
    await expect(form.locator('input[type="tel"]')).toHaveCount(0);
    await expect(form).toContainText("את הטלפון מוסיפים אחרי שהחשבון נוצר.");
    await form.getByLabel("מייל", { exact: true }).fill("rep4@example.test");
    await form.getByRole("button", { name: "שליחה לאישור היוצר" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("בקשה לאישור היוצר");
    await expect(form).toHaveCount(0);
    const mine = page.getByRole("list", { name: "הבקשות שלי" });
    const created = mine.getByRole("listitem").filter({ hasText: "יצירת חשבון · נציגה 4" });
    await expect(created).toContainText("ממתינה לאישור היוצר");
    await expect(created).toContainText("לא נשמר · פעולה מדומה");
    // No account is created until the Creator approves.
    await expect(accounts.locator("tbody tr").filter({ hasText: "נציגה 4" })).toHaveCount(0);
  });

  test("Manager: deactivation asks to confirm, is immediate and simulated; a pending request can be cancelled", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    // שיראל's stored version is 3 (two routine updates): the screen sends the version it read, so
    // the simulated check passes (a screen that sent 1 would be refused as stale, PT409).
    await page.getByRole("button", { name: "השבתת החשבון של שיראל" }).click();
    const confirm = page.getByRole("group", { name: /להשבית את החשבון של שיראל/ });
    await expect(confirm).toContainText("היוצר מקבל התראה באפליקציה");
    await expect(confirm.getByRole("button", { name: "השבתה" })).toBeFocused();
    expect(await horizontalOverflow(page)).toEqual([]);
    await confirm.getByRole("button", { name: "השבתה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("השבתת חשבון");
    const row = page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" }).locator("tbody tr").filter({ hasText: "שיראל" });
    await expect(row).toContainText("לא פעיל");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.getByText("הנתונים השתנו בינתיים")).toHaveCount(0);
    // The confirm panel closed: focus moves to the changed row, never to <body> (F4).
    await expect(row).toBeFocused();

    const mine = page.getByRole("list", { name: "הבקשות שלי" });
    await mine.getByRole("button", { name: "ביטול הבקשה: יצירת חשבון · נציגה 3" }).click();
    await expect(toast(page)).toContainText("ביטול הבקשה");
    await expect(mine.getByRole("listitem").filter({ hasText: "יצירת חשבון · נציגה 3" })).toContainText("בוטלה");
  });
});

test.describe("operational settings (SE-05 to SE-16)", () => {
  test("technicians: 🧪, \"פעיל\" is eligibility for new invitations (SE-05) and toggles simulated", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/techs");
    await expect(page.getByText("🧪").first()).toBeVisible();
    await expect(page.getByText(/זימונים חדשים/).first()).toBeVisible();
    const toggle = page.locator("main .tog:not([disabled])").first();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toast(page)).toContainText(SIMULATED);
    await page.getByRole("button", { name: "+ הוספת טכנאי" }).click();
    await expect(page.getByRole("form", { name: "הוספת טכנאי" })).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("technicians: \"פעיל\" of stored technicians sends their versions (PR 2.2 a) and toggles back (simulated)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/techs");
    for (const name of ["יורם", "אדי"]) {
      const active = page.getByRole("button", { name: `${name} פעיל – מקבל זימונים חדשים` });
      await expect(active).toHaveAttribute("aria-pressed", "true");
      await active.click();
      await expect(active).toHaveAttribute("aria-pressed", "false");
      await expect(toast(page).filter({ hasText: "טכנאי לא פעיל" })).toContainText(SIMULATED);
      await active.click();
      await expect(active).toHaveAttribute("aria-pressed", "true");
      await expect(toast(page).filter({ hasText: "טכנאי פעיל · יקבל זימונים חדשים" })).toContainText(SIMULATED);
    }
    // No refusal ("הנתונים השתנו בינתיים", an unknown technician) on any switch.
    await expect(page.locator("main .set-err")).toHaveCount(0);
  });

  test("places: the seeded places are in use (no delete); a new place can be added and deleted (SE-06)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/places");
    const rows = page.locator("main table tbody tr");
    const seeded = await rows.count();
    expect(seeded).toBeGreaterThan(0);
    // Every seeded place is referenced by a visit: deactivate only.
    await expect(page.getByRole("button", { name: /^מחיקת / })).toHaveCount(0);

    await page.getByRole("button", { name: "+ הוספת מקום" }).click();
    const form = page.getByRole("form", { name: "הוספת מקום איסוף" });
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused();
    expect(await horizontalOverflow(page)).toEqual([]);
    // Invalid input: the invalid field gets focus and aria-invalid, the error is inside the form.
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(form.getByRole("alert")).toContainText("חסר שם המקום");
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused();
    await expect(form.getByLabel("שם", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await form.getByLabel("שם", { exact: true }).fill("סניף בדיקה");
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(form.getByRole("alert")).toContainText("חסרה כתובת");
    await expect(form.getByLabel("כתובת (ל-Waze)")).toBeFocused();
    await expect(toast(page)).toHaveCount(0);

    await form.getByLabel("כתובת (ל-Waze)").fill("רחוב הבדיקה 1, עיר לדוגמה");
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("הוספת מקום איסוף");
    await expect(form).toHaveCount(0);
    const added = rows.filter({ hasText: "סניף בדיקה" });
    await expect(added).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.getByRole("button", { name: /^מחיקת / })).toHaveCount(1);
    await page.getByRole("button", { name: "מחיקת סניף בדיקה" }).click();
    await expect(toast(page).filter({ hasText: "מחיקת מקום איסוף" })).toBeVisible();
    await expect(added).toHaveCount(0);
    await expect(rows).toHaveCount(seeded);
  });

  test("reasons: delete only for unused rows; a new reason can be deleted (simulated); the \"טופל\" text keeps past signatures", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/creator/settings/reasons");
    // The five seeded reasons are used by seeded visits: deactivate only (SE-07).
    await expect(page.locator("main table tbody tr")).toHaveCount(5);
    await expect(page.getByRole("button", { name: /^מחיקת / })).toHaveCount(0);
    await expect(page.getByText(/ערכים התחלתיים, לאימות עם שירות הלקוחות/)).toBeVisible();

    await page.getByLabel("סיבה חדשה").fill("נדרש אישור ספק");
    await page.getByRole("button", { name: "+ הוספת סיבה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    const added = page.locator("main table tbody tr").filter({ hasText: "נדרש אישור ספק" });
    await expect(added).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.getByRole("button", { name: /^מחיקת / })).toHaveCount(1);
    await page.getByRole("button", { name: "מחיקת נדרש אישור ספק" }).click();
    await expect(toast(page)).toContainText("מחיקת סיבת המשך טיפול");
    await expect(added).toHaveCount(0);

    await expect(page.getByText(/חתימות קודמות לא משתנות/)).toBeVisible();
    const save = page.getByRole("button", { name: "שמירת נוסח" });
    await expect(save).toBeDisabled();
  });

  test("mail: completion mail always to Manager and the mailbox (fixed); pending items disabled; in-app technician toggles", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/creator/settings/mail");
    // SE-08 (D09): fixed recipients for both outcomes, never toggles.
    await expect(page.locator(".set-always")).toHaveCount(4);
    await expect(page.getByText("service@example.test")).toHaveCount(2);
    // SE-09 (d10), SE-10 (d11), SE-12 (d09): disabled with a visible hint.
    for (const name of ["מייל לנציגה המטפלת", "צירוף תמונות וסרטונים למייל"]) {
      const toggles = page.getByRole("button", { name, exact: true });
      await expect(toggles).toHaveCount(2);
      for (const t of await toggles.all()) await expect(t).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: "מייל לנציגה על זימון שלא נקלט" })).toBeDisabled();
    await expect(page.getByText(/ממתין להחלטת בעלים \(d10\)/).first()).toBeVisible();
    await expect(page.getByText(/ממתין להחלטת בעלים \(d11\)/).first()).toBeVisible();
    await expect(page.getByText(/ממתין להחלטת בעלים \(d09\)/)).toBeVisible();
    // d11's recommendation is shown as a recommendation, never as the current behaviour.
    await expect(page.getByText("ההמלצה (לא הוחלט): רק קישור לכרטיס הקריאה")).toHaveCount(2);
    // SE-11: in-app notifications, no morning pickup toggle.
    await expect(page.getByText(/מה לאסוף|תזכורת בוקר/)).toHaveCount(0);
    const tech = page.getByRole("button", { name: "התראה לטכנאי: ביטול ביקור" });
    await tech.click();
    await expect(tech).toHaveAttribute("aria-pressed", "false");
    await expect(toast(page)).toContainText(SIMULATED);
  });

  test("template: locked labels cannot be toggled; other labels are simulated; event-driven sync (SE-13 to SE-15)", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/creator/settings/template");
    await expect(page.getByText("[קריאת שירות]")).toBeVisible();
    await expect(page.getByText("מתעדכן אוטומטית כשזימון נוצר או משתנה")).toBeVisible();
    await expect(page.getByText(/כל 5 דקות/)).toHaveCount(0);
    for (const name of ["מספר פנייה חובה", "מספר לקוח חובה"]) {
      const locked = page.getByRole("button", { name, exact: true });
      await expect(locked).toBeDisabled();
      await expect(locked).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.locator(".set-always", { hasText: "תמיד חובה" })).toHaveCount(2);
    await page.getByRole("button", { name: "מספר פנייה חובה", exact: true }).click({ force: true });
    await expect(toast(page)).toHaveCount(0);
    const warranty = page.getByRole("button", { name: "באחריות חובה", exact: true });
    await expect(warranty).toHaveAttribute("aria-pressed", "false");
    await warranty.click();
    await expect(warranty).toHaveAttribute("aria-pressed", "true");
    await expect(toast(page)).toContainText(SIMULATED);
  });
});

// Phase E fix pass: every D34 activation path, the submit flows of every add form, and what the
// browser receives (no sign-in times; account and request ids only on the account screens).
test.describe("account activation paths (D34 a, c)", () => {
  test("Manager: an inactive Customer Service account without a request offers \"בקשת הפעלת חשבון\" (pending, simulated)", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    const accounts = page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" });
    const ronit = accounts.locator("tbody tr").filter({ hasText: "רונית" });
    await expect(ronit).toContainText("לא פעיל");
    await ronit.getByRole("button", { name: "בקשת הפעלת חשבון לחשבון של רונית" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("בקשה לאישור היוצר");
    // Nothing changes until the Creator approves: still inactive, now with a pending request.
    await expect(ronit).toContainText("לא פעיל");
    await expect(ronit).toContainText("ממתינה לאישור היוצר");
    await expect(ronit).toBeFocused();
    const mine = page.getByRole("list", { name: "הבקשות שלי" });
    const created = mine.getByRole("listitem").filter({ hasText: "הפעלת חשבון · רונית" });
    await expect(created).toContainText("ממתינה לאישור היוצר");
    await expect(created).toContainText("לא נשמר · פעולה מדומה");
  });

  test("Manager: a deactivated technician account is activated at once (simulated)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    const beni = page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" }).locator("tbody tr").filter({ hasText: "בני" });
    await expect(beni).toContainText("לא פעיל");
    await beni.getByRole("button", { name: "הפעלת החשבון של בני" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("הפעלת חשבון");
    await expect(beni).not.toContainText("לא פעיל");
    await expect(beni).toContainText("לא נשמר · פעולה מדומה");
    await expect(beni).toBeFocused();
    await expect(page.getByText(/בהדגמה: החשבון של בני היה מופעל מיד/)).toBeVisible();
  });
});

test.describe("add forms (simulated submit flows)", () => {
  test("Creator \"+ הוספת משתמש\": an example.test address only; the new row has 🧪 and is not saved", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/users");
    const users = page.getByRole("table", { name: "משתמשים", exact: true });
    await page.getByRole("button", { name: "+ הוספת משתמש" }).click();
    const form = page.getByRole("form", { name: "הוספת משתמש" });
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused();
    await form.getByLabel("שם", { exact: true }).fill("מנהלת בדיקה");
    await form.getByLabel("מייל", { exact: true }).fill("manager@example.com");
    await form.getByLabel("טלפון", { exact: true }).fill("050-000-0190");
    await form.getByLabel("הרשאה").selectOption("mgr");
    // Test users get example.test addresses only (D47): the simulated command refuses others.
    await form.getByRole("button", { name: "יצירת חשבון" }).click();
    await expect(form.getByRole("alert")).toContainText("רק כתובות @example.test");
    await expect(users.locator("tbody tr").filter({ hasText: "מנהלת בדיקה" })).toHaveCount(0);

    await form.getByLabel("מייל", { exact: true }).fill("manager2@example.test");
    await form.getByRole("button", { name: "יצירת חשבון" }).click();
    await expect(toast(page).filter({ hasText: "יצירת חשבון מנהל" })).toContainText(SIMULATED);
    await expect(form).toHaveCount(0);
    const row = users.locator("tbody tr").filter({ hasText: "מנהלת בדיקה" });
    await expect(row).toContainText("🧪");
    await expect(row).toContainText("מנהל");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.getByText(/בהדגמה: החשבון של מנהלת בדיקה היה נוצר מיד/)).toBeVisible();
  });

  test("Settings › טכנאים \"+ הוספת טכנאי\": the new row is the command's, and its \"פעיל\" switch works", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/techs");
    await page.getByRole("button", { name: "+ הוספת טכנאי" }).click();
    const form = page.getByRole("form", { name: "הוספת טכנאי" });
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused();
    await form.getByLabel("שם", { exact: true }).fill("טכנאי בדיקה");
    await form.getByLabel("מייל ב-Outlook").fill("tech-test@example.test");
    await form.getByLabel("טלפון", { exact: true }).fill("050-000-0191");
    await form.getByLabel("כחול").check();
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page)).toContainText("הוספת טכנאי");
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ הוספת טכנאי" })).toBeFocused();
    const row = page.locator("main table tbody tr").filter({ hasText: "טכנאי בדיקה" });
    await expect(row).toContainText("🧪");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    // The command returned a technician id (not the account id): the switch validates and runs.
    const active = row.getByRole("button", { name: "טכנאי בדיקה פעיל – מקבל זימונים חדשים" });
    await active.click();
    await expect(active).toHaveAttribute("aria-pressed", "false");
    await expect(toast(page).filter({ hasText: "טכנאי לא פעיל" })).toContainText(SIMULATED);
  });

  test("Manager \"+ הוספת טכנאי\": immediate, a technician row with 🧪, not saved", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    await page.getByRole("button", { name: "+ הוספת טכנאי" }).click();
    const form = page.getByRole("form", { name: "הוספת טכנאי" });
    await form.getByLabel("שם", { exact: true }).fill("טכנאי חדש");
    await form.getByLabel("מייל ב-Outlook").fill("new-tech@example.test");
    await form.getByLabel("טלפון", { exact: true }).fill("050-000-0192");
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page)).toContainText("הוספת טכנאי");
    const row = page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" }).locator("tbody tr").filter({ hasText: "טכנאי חדש" });
    await expect(row).toContainText("🧪");
    await expect(row).toContainText("טכנאי");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.getByText(/בהדגמה: הטכנאי טכנאי חדש היה נוסף מיד/)).toBeVisible();
  });

  test("\"שמירת נוסח\": an empty text is blocked inline; a new text is a simulated new version", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/reasons");
    const text = page.getByLabel('הנוסח שהלקוח חותם עליו כשהטכנאי בוחר "טופל"');
    const save = page.getByRole("button", { name: "שמירת נוסח" });
    await text.fill("");
    await save.click();
    await expect(page.getByRole("alert").filter({ hasText: "הנוסח לא יכול להיות ריק" })).toBeVisible();
    await expect(text).toHaveAttribute("aria-invalid", "true");
    await expect(toast(page)).toHaveCount(0);
    await text.fill("הטיפול הסתיים לשביעות רצוני");
    await save.click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("חתימות קודמות שומרות את הנוסח שנחתם");
    await expect(page.getByRole("status").filter({ hasText: "גרסה חדשה בהדגמה · פעולה מדומה, לא נשמרה" })).toBeVisible();
    await expect(save).toBeDisabled();
  });

  test("call types: a duplicate name is blocked; a new type is added, not saved (SE-16)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/settings/types");
    const input = page.getByLabel("סוג קריאה חדש");
    await input.fill("תיקון");
    await page.getByRole("button", { name: "+ הוספת סוג קריאה" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "סוג קריאה בשם הזה כבר קיים" })).toBeVisible();
    await expect(toast(page)).toHaveCount(0);
    await input.fill("בדיקה תקופתית");
    await page.getByRole("button", { name: "+ הוספת סוג קריאה" }).click();
    await expect(toast(page)).toContainText("הוספת סוג קריאה");
    const row = page.locator("main table tbody tr").filter({ hasText: "בדיקה תקופתית" });
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.locator("main table tbody tr")).toHaveCount(3);
    await expect(input).toHaveValue("");
  });
});

test.describe("what the browser receives (P1, P9)", () => {
  onlyInProject("desktop");

  test("no sign-in times anywhere; account and request ids only on the account screens", async ({ page }) => {
    const html = async (path: string) => (await page.request.get(path)).text();
    const managerAccounts = await html("/dev/demo/office/mgr/settings/accounts");
    expect(managerAccounts).not.toContain("lastSignIn");
    expect(managerAccounts).toContain("acc-shirel");
    // The Manager's scope: Customer Service and Technician accounts only (D34). The Creator appears
    // only as the decider of the Manager's own requests ("הבקשות שלי"), never as an account.
    expect(managerAccounts).not.toMatch(MANAGER_OR_CREATOR_ACCOUNT);
    // The former address only redirects (D57): its response carries no account or request ids.
    const redirect = await page.request.get("/dev/demo/office/mgr/users", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const redirectBody = await redirect.text();
    expect(redirectBody).not.toContain("acc-");
    expect(redirectBody).not.toContain("areq-");
    for (const path of [
      "/dev/demo/tech",
      "/dev/demo/tech/profile",
      "/dev/demo/office/mgr",
      "/dev/demo/office/mgr/analytics",
      "/dev/demo/office/mgr/analytics?tab=tech",
      "/dev/demo/office/mgr/analytics?tab=prod",
      "/dev/demo/office/mgr/calls",
      "/dev/demo/office/creator/settings/techs",
    ]) {
      const body = await html(path);
      expect(body, path).not.toContain("acc-creator");
      expect(body, path).not.toContain("acc-shirel");
      expect(body, path).not.toContain("areq-");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Phase F (OF-02, OF-16): "לקוחות" and the customer card, "מוצרים", "זימונים שלא נקלטו" and
// "חזרו מהשטח". Display-only access (G-04); every action simulated.

/** Views of the phase F screens behind query strings (search, paging, filters). */
const PHASE_F_VIEWS = [
  "/dev/demo/office/mgr/customers?q=298747",
  "/dev/demo/office/cs/customers?page=2",
  "/dev/demo/office/mgr/back-from-field?tech=e",
  "/dev/demo/office/creator/products?q=kt-2041",
] as const;

/**
 * The temporary access line of the two work-queue screens (open decision #15, board ref d23): the
 * roles of the fixed rule and the decision's number, never "d23" (it reads as the approved D23).
 */
const WORK_QUEUE_HINT = "הרשאת צפייה זמנית: מנהל, שירות לקוחות ויוצר · ממתין להחלטת בעלים (#15)";

test.describe("phase F views render", () => {
  for (const path of PHASE_F_VIEWS) {
    test(`${path}: sentinel, test-data strip, no overflow, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await openPage(page, path);
      await expect(page.locator(`[data-fixtures="${FIXTURE_SENTINEL}"]`).first()).toBeAttached();
      await expect(page.getByRole("note", { name: "הדגמה עם נתוני בדיקה" })).toBeVisible();
      expect(await horizontalOverflow(page)).toEqual([]);
      expect(await verticalPageOverflow(page), "the document scrolls past the app frame").toBe(0);
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }

  test("an unknown customer is a 404 for every office role", async ({ request }) => {
    for (const path of [
      "/dev/demo/office/mgr/customers/cu-000000",
      "/dev/demo/office/cs/customers/cu-000000",
      "/dev/demo/office/creator/customers/nope",
      "/dev/demo/office/xx/customers",
      "/dev/demo/office/xx/products",
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain(FIXTURE_SENTINEL);
    }
  });
});

test.describe("office navigation per role (phase F, OF-02)", () => {
  const NEW_ITEMS = [
    ["לקוחות", "customers"],
    ["זימונים שלא נקלטו", "unparsed"],
    ["חזרו מהשטח", "back-from-field"],
  ] as const;

  test("customer service: customers and both work-queue screens after \"קריאות\", no products (unchanged by D57)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs");
    const nav = sideNav(page);
    for (const [label, path] of NEW_ITEMS) {
      await expect(nav.getByRole("link", { name: label, exact: true }), label).toHaveAttribute("href", `/dev/demo/office/cs/${path}`);
    }
    await expect(nav.getByRole("link", { name: "מוצרים", exact: true })).toHaveCount(0);
    // Order: after "קריאות" come the three new screens.
    const labels = await nav.getByRole("link").allInnerTexts();
    const at = (l: string) => labels.findIndex((x) => x.trim() === l);
    expect(at("קריאות")).toBeGreaterThan(-1);
    expect(at("לקוחות")).toBe(at("קריאות") + 1);
    expect(at("זימונים שלא נקלטו")).toBe(at("לקוחות") + 1);
    expect(at("חזרו מהשטח")).toBe(at("זימונים שלא נקלטו") + 1);
  });

  test("Manager and Creator: exactly the five D57 items; customers, back from field and products only in the \"מסכים נוספים\" row", async ({
    page,
  }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/calls`);
      const nav = sideNav(page);
      expect((await nav.getByRole("link").allInnerTexts()).map((l) => l.trim()), role).toEqual([
        "דשבורד",
        "יומן טכנאים",
        "קריאות",
        "זימונים שלא נקלטו",
        "הגדרות",
      ]);
      await expect(nav.getByRole("link", { name: "זימונים שלא נקלטו", exact: true }), role).toHaveAttribute(
        "href",
        `/dev/demo/office/${role}/unparsed`,
      );
      for (const label of ["לקוחות", "חזרו מהשטח", "פריטים לבדיקה", "מוצרים", "משתמשים", "לוח בקרה"]) {
        await expect(nav.getByRole("link", { name: label, exact: true }), `${role} ${label}`).toHaveCount(0);
      }
      const related = page.getByRole("navigation", { name: "מסכים נוספים" });
      for (const [label, path] of [...NEW_ITEMS.filter(([, p]) => p !== "unparsed"), ["פריטים לבדיקה", "review"], ["מוצרים", "products"]] as const) {
        await expect(related.getByRole("link", { name: label, exact: true }), `${role} ${label}`).toHaveAttribute(
          "href",
          `/dev/demo/office/${role}/${path}`,
        );
      }
    }
  });

  test("each screen highlights its sidebar item: its own as the current page, an entry-row screen \"קריאות\" without aria-current", async ({
    page,
  }) => {
    for (const [label, path] of NEW_ITEMS) {
      await openPage(page, `/dev/demo/office/cs/${path}`);
      await expect(sideNav(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await openPage(page, "/dev/demo/office/mgr/unparsed");
    await expect(sideNav(page).getByRole("link", { name: "זימונים שלא נקלטו", exact: true })).toHaveAttribute("aria-current", "page");
    for (const path of ["customers", "back-from-field", "products", "customers/cu-298747"]) {
      await openPage(page, `/dev/demo/office/mgr/${path}`);
      const calls = sideNav(page).getByRole("link", { name: "קריאות", exact: true });
      await expect(calls, path).toHaveClass(/(^|\s)on(\s|$)/);
      await expect(calls, path).not.toHaveAttribute("aria-current");
      await expect(sideNav(page).locator("[aria-current]"), path).toHaveCount(0);
    }
  });

  test("the customer-service home links to \"חזרו מהשטח\" from the follow-up work queue", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs");
    const link = page.locator("main").getByRole("link", { name: "למסך חזרו מהשטח ›", exact: true });
    await expect(link).toHaveAttribute("href", "/dev/demo/office/cs/back-from-field");
    await link.click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/cs\/back-from-field$/);
    await expect(page.getByRole("heading", { level: 1, name: "חזרו מהשטח" })).toBeVisible();
  });
});

test.describe("customers and the customer card (OF-05, OF-16)", () => {
  const rowsOf = (page: Page) => page.getByRole("table", { name: "לקוחות" }).locator("tbody tr");

  test("search by customer number and by name changes the URL and filters the rows; clear returns to every customer", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/customers");
    const search = page.getByRole("searchbox", { name: "חיפוש לקוח" });
    const shown = page.locator("main").locator("text=/^מציג \\d+ מתוך \\d+$/");
    const totalOf = async () => Number((await shown.innerText()).match(/מתוך (\d+)/)?.[1]);
    const before = await totalOf();
    expect(before).toBeGreaterThan(40);
    await expect(page.getByRole("navigation", { name: "עמודי הלקוחות" })).toBeVisible();

    await search.fill("298747");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=298747(&|$)/);
    await expect(rowsOf(page)).toHaveCount(1);
    await expect(rowsOf(page).first().getByRole("link", { name: "משפחת לוי · לקוח 298747" })).toBeVisible();
    await expect(rowsOf(page).first().getByText("נתוני בדיקה")).toBeAttached();
    // "↩ מוצר חזר" depends on the temporary return window: labelled pending on the list too.
    await expect(rowsOf(page).first()).toContainText("מוצר חזר");
    await expect(page.locator("main")).toContainText("״מוצר חזר״: חלון זמני · ממתין להחלטת בעלים (d31)");

    await search.fill("אבי כהן");
    await page.getByRole("button", { name: "חיפוש", exact: true }).click();
    // Wait for this search, not the previous one (q=298747 already satisfied a bare /[?&]q=/ and
    // a total below `before`, so the rows could still be the previous result).
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "אבי כהן");
    await expect(rowsOf(page).first().getByRole("link")).toHaveAttribute("aria-label", /אבי כהן/);
    await expect.poll(totalOf).toBeLessThan(before);
    const names = await rowsOf(page).getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toContain("אבי כהן");

    await page.getByRole("link", { name: "ניקוי החיפוש" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect.poll(totalOf).toBe(before);
  });

  test("a search with no match says so; paging changes the URL", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/customers?q=zzzz");
    await expect(page.getByText('לא נמצאו לקוחות עבור "zzzz"')).toBeVisible();
    await openPage(page, "/dev/demo/office/cs/customers");
    await page.getByRole("navigation", { name: "עמודי הלקוחות" }).getByRole("link", { name: "הבא ‹" }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByRole("navigation", { name: "עמודי הלקוחות" })).toContainText("עמוד 2 מתוך");
  });

  test("the card lists the customer's calls with 🧪, the returned product and links to the call card", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/customers");
    await page.getByRole("link", { name: "משפחת לוי · לקוח 298747" }).click();
    await expect(page).toHaveURL(/\/customers\/cu-298747$/);
    await expect(page.getByRole("heading", { level: 1, name: "משפחת לוי" })).toBeVisible();
    await expect(page.locator(".ptitle")).toContainText("מספר לקוח 298747");
    await expect(page.getByRole("region", { name: "קריאות הלקוח לפי סטטוס" })).toBeVisible();
    const calls = page.getByRole("table", { name: /קריאות הלקוח/ });
    await expect(calls.locator("tbody tr")).toHaveCount(3);
    await expect(calls.locator("tbody tr").first().getByText("נתוני בדיקה").first()).toBeAttached();
    const products = page.getByRole("region", { name: /מוצרים של הלקוח/ });
    await expect(products).toContainText("חזר תוך זמן קצר");
    await expect(products).toContainText("ממתין להחלטת בעלים");
    await expect(products.getByRole("link", { name: "ברז מטבח נשלף במסך מוצרים" })).toHaveAttribute(
      "href",
      "/dev/demo/office/mgr/products?q=KT-2041",
    );
    await calls.getByRole("link", { name: "פנייה 48213" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calls\/48213$/);
  });

  test("customer service sees the card without the products link; a status counter opens the calls list by customer number", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/customers/cu-298747");
    await expect(page.getByRole("link", { name: /במסך מוצרים/ })).toHaveCount(0);
    await page.getByRole("region", { name: "קריאות הלקוח לפי סטטוס" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/cs\/calls\?q=298747/);
  });

  test("a status counter opens the calls list with that status and exactly as many rows as it shows", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/customers/cu-298747");
    const resolved = page.getByRole("region", { name: "קריאות הלקוח לפי סטטוס" }).getByRole("link", { name: /^טופלה/ });
    const value = Number(await resolved.locator(".v").innerText());
    expect(value).toBeGreaterThan(0);
    await resolved.click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calls\?(?=.*q=298747)(?=.*status=resolved)/);
    await expect(page.getByRole("table", { name: "קריאות שירות" }).locator("tbody tr")).toHaveCount(value);
  });

  test("the call card's customer link opens the customer card", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/48213");
    await page.getByRole("link", { name: "לכרטיס הלקוח · משפחת לוי" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/customers\/cu-298747$/);
    await expect(page.getByRole("heading", { level: 1, name: "משפחת לוי" })).toBeVisible();
    await page.getByRole("link", { name: "חזרה ללקוחות", exact: true }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/customers$/);
  });
});

test.describe("D57 (9): \"נפתחה\" (opened_at) and \"תחילת טיפול\" (first arrival) are separate fields", () => {
  // Fixture facts (fictional): 48213 (KT-2041, משפחת לוי) opened 19.10 11:21; its first visit is on
  // 21.10 (TODAY, "היום") and has no arrival yet. 47490 (KT-2041) opened 18.08; its first visit
  // arrived 20.08 10:03. 48205 (BT-1120, customer 235395) opened 15.10, first visit 19.10.
  const startLine = (scope: ReturnType<Page["locator"]>, req: string) => scope.locator(`[data-call-start="${req}"]`).filter({ visible: true });

  test("customer card: both labelled fields per call; never a first-visit date under \"נפתחה\"", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/customers/cu-298747");
    const products = page.getByRole("region", { name: /מוצרים של הלקוח/ });
    const latest = startLine(products, "48213");
    await expect(latest).toHaveCount(1);
    await expect(latest).toContainText("קריאה אחרונה");
    await expect(latest.locator('[data-field="opened"]')).toHaveText("נפתחה: 19.10");
    await expect(latest.locator('[data-field="work-start"]')).toHaveText("תחילת טיפול: טרם התחיל");
    const first = startLine(products, "47490");
    await expect(first).toContainText("קריאה ראשונה");
    await expect(first.locator('[data-field="opened"]')).toHaveText("נפתחה: 18.08");
    await expect(first.locator('[data-field="work-start"]')).toHaveText("תחילת טיפול: 20.08 10:03");
    // The return rule and its text use opened_at: 48213 opened 26 days after 47690's closure on 23.9
    // (by its first visit, 21.10 "היום", it would read 28 days).
    await expect(products).toContainText("פנייה 48213 (19.10) נפתחה 26 ימים אחרי סגירת פנייה 47690");
    const text = await products.innerText();
    expect(text).not.toMatch(/\(היום\) נפתחה|נפתחה: היום|נפתחה: 20\.08|נפתחה 28 ימים/);
  });

  test("customer card: the return window counts from opened_at (48205: 21 days, not 25)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/customers/cu-235395");
    const products = page.getByRole("region", { name: /מוצרים של הלקוח/ });
    await expect(products).toContainText("פנייה 48205 (15.10) נפתחה 21 ימים אחרי סגירת פנייה 47700");
    await expect(startLine(products, "48205").locator('[data-field="opened"]')).toHaveText("נפתחה: 15.10");
  });

  test("products screen: the creating call shows both labelled fields, opened_at under \"נפתחה\"", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/products");
    const row = page.getByRole("table", { name: "מוצרים" }).locator("tbody tr").filter({ has: page.getByText("KT-2041", { exact: true }) });
    const line = startLine(row, "47490");
    await expect(line).toHaveCount(1);
    await expect(line.locator('[data-field="opened"]')).toHaveText("נפתחה: 18.08");
    await expect(line.locator('[data-field="work-start"]')).toHaveText("תחילת טיפול: 20.08 10:03");
    // The first visit's date (20.08) never appears under "נפתחה".
    expect(await row.innerText()).not.toContain("נפתחה: 20.08");
  });

  test("the dashboard dialog and the customer card agree on 48213's opening date", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "runs in the desktop project only");
    await openPage(page, `/dev/demo/office/mgr/analytics?tab=prod&detail=prod.skuCalls&group=KT-2041`);
    const row = page.getByRole("dialog").locator("tbody tr").filter({ has: page.getByRole("link", { name: /48213/ }) });
    await expect(row).toContainText("19.10.2026");
    await expect(row).not.toContainText("21.10.2026");
  });
});

test.describe("products (PR-04 to PR-07, D19)", () => {
  const productRow = (page: Page, sku: string) =>
    page.getByRole("table", { name: "מוצרים" }).locator("tbody tr").filter({ has: page.getByText(sku, { exact: true }) });

  test("Manager and Creator are offered the edit; customer service gets \"אין הרשאה\" and no product data", async ({ page }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/products`);
      await expect(page.getByRole("button", { name: /^עריכה · / }).first(), role).toBeVisible();
      await expect(productRow(page, "KT-2041")).toContainText("ברז מטבח נשלף");
    }
    await openPage(page, "/dev/demo/office/cs/products");
    await expect(page.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /עריכה/ })).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain("KT-2041");
  });

  test("an empty brand or supplier shows \"לא הוזן\"; 🧪 on test products; no import and no delete", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/products");
    const mx = productRow(page, "MX-410");
    await expect(mx).toContainText("לא הוזן");
    // Brand and supplier columns above 520 px, the line under the name below it: visible either way.
    await expect(mx.getByText("לא הוזן").filter({ visible: true })).toHaveCount(2);
    await expect(productRow(page, "TB-75").getByText("לא הוזן").filter({ visible: true })).toHaveCount(1);
    await expect(mx.getByText("נתוני בדיקה")).toBeAttached();
    await expect(page.getByRole("button", { name: /ייבוא|מחיקה|מחק/ })).toHaveCount(0);
    await expect(page.locator("main")).toContainText("אין ייבוא מוצרים ואין מחיקה");
    await expect(page.locator("main")).toContainText("לא משנה את השם הקיים");
  });

  test("search by SKU is case-insensitive and in the URL", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/products");
    const search = page.getByRole("searchbox");
    await search.fill("kt-2041");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=kt-2041/);
    await expect(page.getByRole("table", { name: "מוצרים" }).locator("tbody tr")).toHaveCount(1);
    await expect(productRow(page, "KT-2041")).toBeVisible();
  });

  test("edit: an empty name is blocked inline; a change is simulated (toast) and the row is marked not saved", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/products");
    await page.getByRole("button", { name: "עריכה · ברז מטבח נשלף (KT-2041)" }).click();
    const form = page.getByRole("form", { name: "עריכת המוצר KT-2041" });
    const name = form.getByRole("textbox", { name: "שם מוצר" });
    await expect(name).toBeFocused();
    await expect(form).toContainText("לא נערך");
    await expect(form.getByRole("textbox")).toHaveCount(1);

    await name.fill("   ");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("חסר שם מוצר");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(toast(page)).toHaveCount(0);

    await name.fill("ברז מטבח נשלף · דגם 2");
    await form.getByRole("combobox", { name: /^ספק/ }).selectOption({ label: "לא הוזן" });
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(form).toHaveCount(0);
    const row = productRow(page, "KT-2041");
    await expect(row).toContainText("ברז מטבח נשלף · דגם 2");
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
    await expect(page.locator("main")).toContainText("בהדגמה: פרטי המוצר KT-2041 היו מתעדכנים. לא נשמר.");
    await expect(page.getByRole("button", { name: "עריכה · ברז מטבח נשלף · דגם 2 (KT-2041)" })).toBeFocused();
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("edit: an inactive current brand is shown disabled and kept; saving with no change is refused inline", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/products");
    await page.getByRole("button", { name: "עריכה · סוללת אמבטיה לקיר (TB-75)" }).click();
    const form = page.getByRole("form", { name: "עריכת המוצר TB-75" });
    const brand = form.getByRole("combobox", { name: /^מותג/ });
    const inactive = brand.locator("option", { hasText: "הידרו-פלוס (לא פעיל)" });
    await expect(inactive).toHaveCount(1);
    // A disabled <option> (toBeDisabled reads the select's state, not the option's).
    await expect(inactive).toHaveJSProperty("disabled", true);
    await expect(brand).toHaveValue((await inactive.getAttribute("value")) ?? "");
    // No other inactive option is offered.
    await expect(brand.locator("option", { hasText: "(לא פעיל)" })).toHaveCount(1);

    // Nothing changed: refused inline, no command, no toast.
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("אין שינוי לשמור");
    await expect(toast(page)).toHaveCount(0);

    // Another field changed: the inactive brand is not sent, so it stays on the product.
    await form.getByRole("textbox", { name: "שם מוצר" }).fill("סוללת אמבטיה לקיר · חדשה");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    const row = productRow(page, "TB-75");
    await expect(row).toContainText("סוללת אמבטיה לקיר · חדשה");
    await expect(row.getByText("הידרו-פלוס").filter({ visible: true })).toHaveCount(1);
    await expect(row).toContainText("לא נשמר · פעולה מדומה");
  });

  test("edit: Escape closes the form and returns focus to its \"עריכה\"", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/products");
    const edit = page.getByRole("button", { name: "עריכה · כיור אמבטיה + סיפון (BS-220)" });
    await edit.click();
    const form = page.getByRole("form", { name: "עריכת המוצר BS-220" });
    await expect(form).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(toast(page)).toHaveCount(0);
  });
});

test.describe("unparsed invitations (IN-01 to IN-04, OF-16)", () => {
  test("every problem kind with its label; the rep mail pending d09, never sent; the #15 hint; simulator source", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/unparsed");
    const main = page.locator("main");
    await expect(page.getByRole("heading", { level: 1, name: "זימונים שלא נקלטו" })).toBeVisible();
    // The heading ends in Latin ("Outlook"): isolated, so the count stays after it (bidi).
    await expect(page.locator("#unparsed-list-h > bdi")).toHaveText("ממתינים לתיקון ב-Outlook");
    await expect(main).toContainText(WORK_QUEUE_HINT);
    await expect(main).not.toContainText("(d23)");
    const list = page.getByRole("list", { name: "זימונים שלא נקלטו" });
    const items = list.locator(":scope > li");
    await expect(items).toHaveCount(7);
    for (const kind of ["חסר שדה חובה", "מקום איסוף לא מוכר", "ערך לא תקין"]) {
      await expect(list.getByText(kind, { exact: true }).first(), kind).toBeVisible();
    }
    await expect(list).toContainText("מחסן חולון");
    await expect(list).toContainText("לא ברשימת מקומות האיסוף בהגדרות");
    await expect(list).toContainText("צריך להיות:");
    // An unknown SKU is never a reason (IN-02, D19).
    await expect(main).toContainText("מק״ט שלא מופיע ברשימת המוצרים אינו סיבה");
    // Every row: the rep mail is not sent, pending d09 (IN-04).
    await expect(list.getByText("מייל לנציגה: לא נשלח · ממתין להחלטת בעלים (d09)")).toHaveCount(7);
    // No line about an email says it was or will be sent ("נשלח" elsewhere is the corrected invitation).
    const mailLines = (await main.innerText()).split("\n").filter((l) => l.includes("מייל"));
    expect(mailLines.length).toBeGreaterThanOrEqual(7);
    for (const l of mailLines) expect(l).not.toMatch(/(?<!לא )(נשלח|יישלח|נשלחים)/);
    // Source of every invitation: the simulator (SIM-14); event-driven intake, no polling (D08).
    await expect(list.getByText("🧪 זימון בדיקה")).toHaveCount(7);
    await expect(main).toContainText("בלי בדיקה תקופתית");
    // No actions on this screen.
    await expect(main.getByRole("button")).toHaveCount(0);
  });

  test("the screen is the same for the Manager and the Creator (temporary rule, #15)", async ({ page }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/unparsed`);
      await expect(page.locator("main"), role).toContainText(WORK_QUEUE_HINT);
      await expect(page.getByRole("list", { name: "זימונים שלא נקלטו" }).locator(":scope > li"), role).toHaveCount(7);
    }
  });
});

test.describe("back from field (OF-16, D23, D38)", () => {
  const items = (page: Page) => page.getByRole("list", { name: "ביקורים שחזרו מהשטח" }).locator(":scope > li");

  test("the technician filter changes the URL, marks the chip and keeps only that technician's calls", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/back-from-field");
    await expect(page.locator("main")).toContainText(WORK_QUEUE_HINT);
    const all = await items(page).count();
    expect(all).toBeGreaterThan(1);
    const chips = page.getByRole("group", { name: "טכנאי:" });
    await expect(chips.getByRole("link", { name: "כל הטכנאים" })).toHaveAttribute("aria-current", "true");
    await chips.getByRole("link", { name: "אדי" }).click();
    await expect(page).toHaveURL(/[?&]tech=e(&|$)/);
    await expect(chips.getByRole("link", { name: "אדי" })).toHaveAttribute("aria-current", "true");
    await expect(chips.getByRole("link", { name: "כל הטכנאים" })).not.toHaveAttribute("aria-current", "true");
    await expect.poll(() => items(page).count()).toBeLessThan(all);
    const metas = await items(page).locator(".ib-meta").allInnerTexts();
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) {
      expect(m).toContain("אדי");
      expect(m).not.toMatch(/יורם|שמואל/);
    }
    await expect(page.locator("main")).toContainText(/מתוך \d+ בכל הטכנאים/);
    await chips.getByRole("link", { name: "כל הטכנאים" }).click();
    await expect(page).toHaveURL(/\/back-from-field$/);
  });

  test("each row: reason, technician, summary, a call-card link and a disabled Outlook action with the Microsoft 365 hint", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/back-from-field");
    const first = items(page).first();
    await expect(first.locator(".ib-reason")).toContainText("סיבת המשך טיפול");
    await expect(first).toContainText("סיכום הביקור:");
    await expect(first).toContainText(/ממתינה \d+ ימים/);
    const outlook = first.getByRole("button", { name: /^זימון ביקור חדש ב-Outlook/ });
    await expect(outlook).toBeDisabled();
    const hintId = await outlook.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    await expect(page.locator(`[id="${hintId}"]`)).toHaveText("זימון ביקור חדש ב-Outlook יהיה זמין אחרי חיבור Microsoft 365.");
    // Decision codes stay out of the user text (open #15 is shown by its number).
    expect(await page.locator("main").innerText()).not.toMatch(/\b[dD]\d{2}\b/);
    await expect(page.locator(`[id="${hintId}"]`)).toBeVisible();
    // Never a fake Outlook link (OF-08 pattern).
    await expect(page.locator("main").getByRole("link", { name: /Outlook/ })).toHaveCount(0);
    await expect(page.locator('main a[href*="outlook" i]')).toHaveCount(0);
    // Every row's Outlook action is disabled.
    const n = await items(page).count();
    await expect(page.locator("main").getByRole("button", { name: /^זימון ביקור חדש ב-Outlook/, disabled: true })).toHaveCount(n);

    const card = first.getByRole("link", { name: /^לכרטיס הקריאה \d+/ });
    const req = ((await card.getAttribute("aria-label")) ?? "").match(/\d+/)?.[0];
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/dev/demo/office/cs/calls/${req}$`));
  });

  test("the counters: the oldest wait matches the first row (oldest first); the waiting count matches the list total", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/back-from-field");
    await expect(page.locator("main")).toContainText(WORK_QUEUE_HINT);
    const counters = page.getByRole("region", { name: "מוני חזרו מהשטח" });
    const tileValue = (label: string) => counters.locator(".kpi").filter({ has: page.locator(".l", { hasText: label }) }).locator(".v");
    const days = Number((await items(page).first().locator(".ib-wait").innerText()).match(/\d+/)?.[0]);
    expect(days).toBeGreaterThan(0);
    await expect(tileValue("הוותיקה ביותר")).toHaveText(String(days));
    const foot = await page.locator("#back-from-field-list .od-table-foot").innerText();
    const total = Number(foot.match(/מתוך (\d+)/)?.[1]);
    expect(total).toBeGreaterThan(0);
    await expect(tileValue("ממתינות לביקור חדש")).toHaveText(String(total));
  });
});

// ---------------------------------------------------------------------------------------------
// Phase G: "פריטים לבדיקה" (D39, D44), audited corrections of a closed visit on the call card
// (OF-10, D14, D43, D45), the /dev mock outbox (X-06, EM-01 to EM-05, D09) and the technician's
// device sync state (TE-23, TE-24, D06, D46). Display-only access (G-04); every action simulated.

/** Views of the phase G screens behind query strings (status filter, paging, a selected row). */
const PHASE_G_VIEWS = [
  "/dev/demo/office/mgr/review?status=resolved",
  "/dev/demo/office/creator/review?status=all",
  "/dev/demo/outbox?id=ob-48190-1",
  "/dev/demo/outbox?page=2",
] as const;

/** "נשלח" (sent) only ever negated: "לא נשלח", "שום מייל לא נשלח", "אף אחת לא נשלחה". */
const POSITIVE_SENT = /(?<!לא )נשלח/;

test.describe("phase G views render", () => {
  for (const path of PHASE_G_VIEWS) {
    test(`${path}: sentinel, test-data strip, no overflow, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await openPage(page, path);
      await expect(page.locator(`[data-fixtures="${FIXTURE_SENTINEL}"]`).first()).toBeAttached();
      await expect(page.getByRole("note", { name: "הדגמה עם נתוני בדיקה" })).toBeVisible();
      expect(await horizontalOverflow(page)).toEqual([]);
      expect(await verticalPageOverflow(page), "the document scrolls past the app frame").toBe(0);
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }

  test("an unknown review item or role is a 404", async ({ request }) => {
    for (const path of [
      "/dev/demo/office/mgr/review/rv-999",
      "/dev/demo/office/creator/review/nope",
      "/dev/demo/office/xx/review",
      "/dev/demo/office/xx/review/rv-1",
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain(FIXTURE_SENTINEL);
    }
  });
});

test.describe("review items: access per role (matrix key `conflicts`)", () => {
  onlyInProject("desktop");

  test("Manager and Creator reach \"פריטים לבדיקה\" from \"קריאות\" (D57, no count); customer service has neither the link nor any item data", async ({
    page,
  }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/calls`);
      const nav = sideNav(page);
      await expect(nav.getByRole("link", { name: "פריטים לבדיקה" }), role).toHaveCount(0);
      const link = page.getByRole("navigation", { name: "מסכים נוספים" }).getByRole("link", { name: "פריטים לבדיקה", exact: true });
      await expect(link, role).toHaveAttribute("href", `/dev/demo/office/${role}/review`);
      // The mock outbox is a /dev tool: never in the office sidebar (X-06).
      await expect(nav.locator('a[href*="/outbox"]'), role).toHaveCount(0);
    }
    for (const path of ["/dev/demo/office/mgr/review", "/dev/demo/office/mgr/review/rv-6"]) {
      await openPage(page, path);
      const calls = sideNav(page).getByRole("link", { name: "קריאות", exact: true });
      await expect(calls, path).toHaveClass(/(^|\s)on(\s|$)/);
      await expect(calls, path).not.toHaveAttribute("aria-current");
    }
    await openPage(page, "/dev/demo/office/cs/calls");
    await expect(page.getByRole("navigation", { name: "מסכים נוספים" })).toHaveCount(0);

    await openPage(page, "/dev/demo/office/cs");
    await expect(sideNav(page).getByRole("link", { name: "פריטים לבדיקה" })).toHaveCount(0);
    for (const path of ["/dev/demo/office/cs/review", "/dev/demo/office/cs/review/rv-1", "/dev/demo/office/cs/review/rv-7"]) {
      await openPage(page, path);
      await expect(page.getByRole("heading", { name: "אין הרשאה" }), path).toBeVisible();
      await expect(page.locator("main"), path).toContainText("לתפקיד הזה אין גישה לפריטים לבדיקה.");
      // No item is read: no list, no request number, no form.
      const text = await page.locator("main").innerText();
      for (const req of ["48226", "48230", "48190", "יעל שושן"]) expect(text, `${path} ${req}`).not.toContain(req);
      await expect(page.locator("main form"), path).toHaveCount(0);
    }
  });
});

test.describe("review items: the list (D39, D44)", () => {
  const rows = (page: Page, name: string) => page.getByRole("list", { name }).locator(":scope > li");

  test("open items first; counters per status; the status chips are links with aria-current", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review");
    const tiles = page.getByRole("region", { name: "מוני פריטים לבדיקה" });
    const tile = (label: string) => tiles.locator(".kpi").filter({ has: page.locator(".l", { hasText: label }) }).locator(".v");
    await expect(tile("פתוחים")).toHaveText("6");
    await expect(tile("מנהל או יוצר בלבד")).toHaveText("2");
    await expect(tile("הוחלטו")).toHaveText("2");
    await expect(rows(page, "פריטים פתוחים")).toHaveCount(6);
    // Each row: kind, status, source, the call and visit links to the call card.
    const first = rows(page, "פריטים פתוחים").first();
    await expect(first).toContainText("פתוח");
    await expect(first).toContainText(/🧪 זימון בדיקה|📱 מהמכשיר של/);
    await expect(first.getByRole("link", { name: /^כרטיס הקריאה · פנייה \d+$/ })).toHaveAttribute("href", /\/dev\/demo\/office\/mgr\/calls\/\d+$/);
    const visit = page.getByRole("link", { name: "ביקור 1 בכרטיס הקריאה 48226" });
    await expect(visit).toHaveAttribute("href", "/dev/demo/office/mgr/calls/48226#visit-1");
    // The two device items that change a server-closed or cancelled visit are marked 🔒.
    await expect(rows(page, "פריטים פתוחים").filter({ hasText: "מנהל או יוצר בלבד" })).toHaveCount(2);

    const chips = page.getByRole("group", { name: "הצגה:" });
    await expect(chips.getByRole("link", { name: /^פתוחים/ })).toHaveAttribute("aria-current", "true");
    await chips.getByRole("link", { name: /^הוחלטו/ }).click();
    await expect(page).toHaveURL(/[?&]status=resolved(&|$)/);
    await expect(chips.getByRole("link", { name: /^הוחלטו/ })).toHaveAttribute("aria-current", "true");
    await expect(rows(page, "פריטים שהוחלטו")).toHaveCount(2);
    for (const row of await rows(page, "פריטים שהוחלטו").all()) {
      await expect(row).toContainText("הוחלט:");
      // The item's status is "הוחלט", never the visit status "טופל" (rv-3's visit is "טופל").
      await expect(row.locator(".ib-wait")).toHaveText("הוחלט");
      await expect(row.getByRole("link", { name: /^לצפייה בפריט/ })).toBeVisible();
    }
    await chips.getByRole("link", { name: /^הכל/ }).click();
    await expect(page).toHaveURL(/[?&]status=all(&|$)/);
    await expect(rows(page, "כל הפריטים")).toHaveCount(8);
  });

  test("a row opens its item page", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/review");
    await page.getByRole("link", { name: "לטיפול בפריט · התנגשות עריכה · פנייה 48190" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/review\/rv-6$/);
    await expect(page.getByRole("heading", { level: 1, name: "התנגשות עריכה" })).toBeVisible();
    await page.getByRole("link", { name: "חזרה לפריטים לבדיקה" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/review$/);
  });
});

test.describe("review items: both versions and the decision (D44)", () => {
  const fields = (page: Page) => page.locator("#review-fields .rv-field");
  const decision = (page: Page) => page.locator("#review-decision");

  test("both versions per field: base, the system's value and the incoming value, with the conflict marked", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review/rv-6");
    await expect(fields(page)).toHaveCount(2);
    for (const f of await fields(page).all()) {
      await expect(f.locator("dt")).toHaveText(["כשהמכשיר התחיל", "במערכת", "מהמכשיר"]);
      await expect(f.locator("dd")).toHaveCount(3);
    }
    const note = fields(page).filter({ has: page.getByRole("heading", { name: "מה צריך בביקור הבא" }) });
    await expect(note).toContainText("התנגשות · שני הצדדים שינו");
    await expect(note.locator(".rv-cur dd")).toHaveText("להביא מנגנון מילוי WC-300 ולהחליף");
    await expect(note.locator(".rv-inc dd")).toHaveText("להביא מנגנון מילוי WC-300 ולבדוק גם את ברז הניל");
    const summary = fields(page).filter({ has: page.getByRole("heading", { name: "סיכום הטיפול" }) });
    await expect(summary).toContainText("השתנה במכשיר");
    // The device source: operation id and the device-reported send time.
    await expect(page.locator("#review-about")).toContainText("op-48190-1-tablet");
    await expect(page.locator("#review-about")).toContainText("לפי שעון המכשיר");

    await openPage(page, "/dev/demo/office/mgr/review/rv-1");
    await expect(fields(page)).toHaveCount(1);
    const tech = fields(page).first();
    await expect(tech.locator("dt")).toHaveText(["בזימון הקודם", "במערכת", "בזימון החדש"]);
    await expect(tech.locator("dd")).toHaveText(["אדי", "אדי", "שמואל"]);
    await expect(tech).toContainText("השתנה בזימון");
    await expect(page.locator("#review-about")).toContainText("🧪 זימון בדיקה");
    await expect(page.locator("#review-about")).toContainText("זימון אף פעם לא משנה ביקור סגור");
    // Decision codes stay out of the user text.
    expect(await page.locator("main").innerText()).not.toMatch(/\bD\d{2}\b/);
  });

  test("a closed-visit item needs a decision and a note: blocked inline, then simulated with the toast", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review/rv-6");
    const box = decision(page);
    await expect(box).toContainText("הערת החלטה (חובה)");
    const submit = box.getByRole("button", { name: "שמירת ההחלטה" });

    await submit.click();
    await expect(box.getByRole("alert")).toHaveText("יש לבחור החלטה");
    await expect(toast(page)).toHaveCount(0);

    await box.getByRole("radio", { name: /החלת השינוי/ }).check();
    await submit.click();
    const note = box.getByRole("textbox", { name: /הערת החלטה/ });
    await expect(box.getByRole("alert")).toHaveText("יש לכתוב הערת החלטה");
    await expect(note).toHaveAttribute("aria-invalid", "true");
    await expect(note).toBeFocused();
    await expect(toast(page)).toHaveCount(0);

    await note.fill("הטכנאי אישר בטלפון את הפירוט מהמכשיר");
    await submit.click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("פריט לבדיקה · החלת השינוי");
    await expect(box).toContainText("לא נשמר · פעולה מדומה");
    await expect(box).toContainText("בהדגמה ההחלטה לא נשמרת");
    await expect(box).toContainText("הטכנאי אישר בטלפון את הפירוט מהמכשיר");
    await expect(box.locator(".rv-result")).toBeFocused();
  });

  test("per field: a conflicting field must be chosen; the one-sided field is pre-selected", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/review/rv-6");
    const box = decision(page);
    await box.getByRole("radio", { name: /בחירה לפי שדה/ }).check();
    const summaryGroup = box.getByRole("radiogroup", { name: /סיכום הטיפול/ });
    const noteGroup = box.getByRole("radiogroup", { name: /מה צריך בביקור הבא/ });
    await expect(summaryGroup.getByRole("radio", { name: /מהמכשיר/ })).toBeChecked();
    await expect(noteGroup.getByRole("radio", { checked: true })).toHaveCount(0);
    await box.getByRole("textbox", { name: /הערת החלטה/ }).fill("שילוב: הסיכום מהמכשיר, ההערה מהמערכת");
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(box.getByRole("alert")).toHaveText("יש לבחור ערך לכל שדה בהתנגשות");
    await expect(noteGroup).toHaveAttribute("aria-invalid", "true");
    await expect(noteGroup.getByRole("radio").first()).toBeFocused();
    await expect(toast(page)).toHaveCount(0);

    await noteGroup.getByRole("radio", { name: /במערכת/ }).check();
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(toast(page)).toContainText("פריט לבדיקה · בחירה לפי שדה");
    await expect(box).toContainText("הוחלה הגרסה מהמכשיר");
    await expect(box).toContainText("נשאר הערך במערכת");
    await expect(box).toContainText("לא נשמר · פעולה מדומה");
    // The page still fits its frame with the per-field form and its result open.
    expect(await verticalPageOverflow(page), "the document scrolls past the app frame").toBe(0);
  });

  test("after a simulated decision, \"בחירת החלטה אחרת\" brings the form back as it was", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review/rv-2");
    const box = decision(page);
    await box.getByRole("radio", { name: /השארת הקיים/ }).check();
    await box.getByRole("textbox", { name: /הערת החלטה/ }).fill("הכתובת אומתה מול הלקוח");
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(box.getByRole("region", { name: /ההחלטה שנבחרה/ })).toBeFocused();
    await box.getByRole("button", { name: "בחירת החלטה אחרת" }).click();
    const kept = box.getByRole("radio", { name: /השארת הקיים/ });
    await expect(kept).toBeChecked();
    await expect(kept).toBeFocused();
    await expect(box.getByRole("textbox", { name: /הערת החלטה/ })).toHaveValue("הכתובת אומתה מול הלקוח");
    await box.getByRole("radio", { name: /החלת השינוי/ }).check();
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(box).toContainText("החלת השינוי");
    await expect(box).toContainText("לא נשמר · פעולה מדומה");
  });

  test("an invitation item takes an optional note: simulated without one", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review/rv-1");
    const box = decision(page);
    await expect(box).toContainText("הערת החלטה (רשות)");
    await box.getByRole("radio", { name: /השארת הקיים/ }).check();
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(toast(page)).toContainText("פריט לבדיקה · השארת הקיים");
    await expect(box).toContainText("ללא הערה");
    await expect(box).toContainText("לא נשמר · פעולה מדומה");
  });

  test("the offline closure of a cancelled visit names the one-time completion email (Creator)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/review/rv-7");
    await expect(page.locator("#review-about")).toContainText("visit-completion:48230-1");
    await expect(page.locator("#review-about")).toContainText("רק אם הסגירה מתקבלת");
    const box = decision(page);
    await box.getByRole("radio", { name: /החלת השינוי/ }).check();
    await expect(box).toContainText("מייל הסיום ייכנס לתור פעם אחת בלבד, למנהל ולתיבת שירות הלקוחות");
    await box.getByRole("textbox", { name: /הערת החלטה/ }).fill("הלקוח אישר שהטיפול בוצע");
    await box.getByRole("button", { name: "שמירת ההחלטה" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(box).toContainText("בהדגמה מייל הסיום לא נכנס לתור ולא נשלח.");
  });

  test("a resolved item is read-only: the decision, who, when and the note; no form", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/review/rv-3");
    const box = page.getByRole("region", { name: "ההחלטה" });
    await expect(box).toContainText("השארת הקיים");
    await expect(box).toContainText("דורון");
    await expect(box).toContainText("הלקוח אישר בטלפון שהטכנאי באתר");
    await expect(box).toContainText("הפריט סגור לעריכה");
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main").getByRole("radio")).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: "שמירת ההחלטה" })).toHaveCount(0);
    // Both versions stay visible after the decision.
    await expect(fields(page)).toHaveCount(1);
    await expect(fields(page).first().locator("dd")).toHaveText(["בטיפול", "בטיפול", "בוטלה"]);
  });
});

test.describe("closed-visit corrections on the call card (OF-10, D14, D43, D45)", () => {
  const trigger = (page: Page, n: number) => page.getByRole("button", { name: `תיקון ביקור סגור · ביקור ${n}` });
  const history = (page: Page, n: number) => page.locator(`#visit-${n} .vc`);

  test("offered on a closed visit to the Manager and the Creator only; customer service sees the history only", async ({ page }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/calls/47969`);
      await expect(trigger(page, 1), role).toBeVisible();
      await expect(history(page, 1), role).toContainText("תיקונים · 3");
    }
    await openPage(page, "/dev/demo/office/cs/calls/47969");
    await expect(page.getByRole("button", { name: /תיקון ביקור סגור/ })).toHaveCount(0);
    await expect(history(page, 1)).toContainText("תיקונים · 3");
    // Never on an open visit: 48205 has a closed visit 1 ("המשך טיפול") and an open visit 2.
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    await expect(trigger(page, 1)).toBeVisible();
    await expect(trigger(page, 2)).toHaveCount(0);
    await expect(history(page, 2)).toHaveCount(0);
    await openPage(page, "/dev/demo/office/creator/calls/48213");
    await expect(page.getByRole("button", { name: /תיקון ביקור סגור/ })).toHaveCount(0);
  });

  test("technicians never see it: their closed visits stay read-only", async ({ page }) => {
    for (const path of ["/dev/demo/tech/visit/47800/1", "/dev/demo/tech/done/47800/1", "/dev/demo/tech/done/47963/1"]) {
      await openPage(page, path);
      await expect(page.getByText(/תיקון ביקור סגור/), path).toHaveCount(0);
      await expect(page.getByText(/🔒 הביקור נסגר בשרת/), path).toBeVisible();
    }
  });

  test("the history shows each original next to its corrections, with who, when and the reason", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    const h = history(page, 1);
    const group = (label: string) => h.locator(".vc-group").filter({ has: page.locator(".vc-field", { hasText: label }) });
    await expect(group("סיכום הטיפול").locator(".vc-orig")).toContainText("המקור מהטכנאי");
    await expect(group("סיכום הטיפול").locator(".vc-orig")).toContainText("בוצע תיקון, נבדק ותקין.");
    await expect(group("סיכום הטיפול")).toContainText("הוחלפה מחסנית המפצל");
    await expect(group("סיכום הטיפול")).toContainText("דורון");
    await expect(group("סיכום הטיפול")).toContainText("סיבה: הטכנאי מסר בטלפון פירוט שחסר בסיכום");
    // A field time is a new time report; the device's report stays.
    await expect(group("שעת סיום")).toContainText("דיווח זמן חדש · המקור נשמר");
    await expect(group("שעת סיום").locator(".vc-orig")).toContainText("דיווח מהמכשיר");
    await expect(group("שעת סיום").locator(".vc-orig")).toContainText("16:39");
    await expect(group("שעת סיום")).toContainText("16:22");
    // The visit itself shows the current value (the latest correction).
    await expect(page.locator("#visit-1")).toContainText("סיום 16:22");
  });

  test("the dialog: the visit's fields only, never the signed approval text; a reason is required; the correction is simulated", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    await trigger(page, 1).click();
    const dialog = page.getByRole("dialog", { name: /תיקון ביקור סגור/ });
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel("שדה לתיקון");
    await expect(field).toBeFocused();
    // A "טופל" visit: summary, parts and the three field times; no follow-up fields, never the
    // signed approval text, the signer or the signature (D43).
    const options = (await field.locator("option").allInnerTexts()).map((o) => o.trim());
    expect(options).toEqual(["בחירת שדה", "סיכום הטיפול", "חלפים שהוחלפו", "שעת יציאה", "שעת הגעה", "שעת סיום"]);
    for (const o of options) expect(o).not.toMatch(/נוסח|חתימה|חותם|סיבת המשך/);
    await expect(dialog).toContainText("נוסח האישור שנחתם, שם החותם והחתימה לא ניתנים לתיקון");

    await field.selectOption("summary");
    await expect(dialog).toContainText("המקור מהטכנאי");
    await expect(dialog).toContainText("בוצע תיקון, נבדק ותקין.");
    const value = dialog.getByLabel("הערך המתוקן");
    await expect(value).toHaveValue("הוחלפה מחסנית המפצל, נבדק מעבר בין ראש המקלחת לפיה ותקין.");
    await value.fill("הוחלפה מחסנית המפצל, נבדק מעבר ותקין. הלקוח הודרך בשימוש.");
    await dialog.getByRole("button", { name: "שמירת התיקון" }).click();
    const reason = dialog.getByLabel(/סיבת התיקון/);
    await expect(dialog.getByRole("alert")).toHaveText("יש לכתוב סיבה לתיקון");
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toBeFocused();
    await expect(toast(page)).toHaveCount(0);

    await reason.fill("השלמה לפי שיחה עם הטכנאי");
    await dialog.getByRole("button", { name: "שמירת התיקון" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("תיקון ביקור סגור · סיכום הטיפול");
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page, 1)).toBeFocused();
    const h = history(page, 1);
    await expect(h).toContainText("תיקונים · 4");
    await expect(h).toContainText("בהדגמה: התיקון של סיכום הטיפול היה נשמר והמקור נשאר. לא נשמר.");
    const added = h.locator(".vc-row").filter({ hasText: "הלקוח הודרך בשימוש" });
    await expect(added).toContainText("לא נשמר · פעולה מדומה");
    await expect(added).toContainText("דורון");
    await expect(added).toContainText("סיבה: השלמה לפי שיחה עם הטכנאי");
    // The original stays visible.
    await expect(h).toContainText("בוצע תיקון, נבדק ותקין.");
  });

  test("Escape, ✕ and \"ביטול\" close the dialog and return focus; no change is refused inline", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/calls/47948");
    const dialog = page.getByRole("dialog", { name: /תיקון ביקור סגור/ });
    await trigger(page, 1).click();
    // A "המשך טיפול" visit also offers the follow-up reason and the next-visit note.
    const options = await dialog.getByLabel("שדה לתיקון").locator("option").allInnerTexts();
    expect(options).toContain("סיבת המשך טיפול");
    expect(options).toContain("מה צריך בביקור הבא");
    await dialog.getByLabel("שדה לתיקון").selectOption("nextNote");
    await dialog.getByLabel(/סיבת התיקון/).fill("בדיקה");
    await dialog.getByRole("button", { name: "שמירת התיקון" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("אין שינוי לשמור");
    await expect(toast(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page, 1)).toBeFocused();

    await trigger(page, 1).click();
    await dialog.getByRole("button", { name: "סגירה" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page, 1)).toBeFocused();
    await trigger(page, 1).click();
    await dialog.getByRole("button", { name: "ביטול" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page, 1)).toBeFocused();
  });

  test("the dialog fits the screen without sideways scrolling", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    await trigger(page, 1).click();
    await page.getByRole("dialog", { name: /תיקון ביקור סגור/ }).getByLabel("שדה לתיקון").selectOption("parts");
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await verticalPageOverflow(page), "the document scrolls past the app frame").toBe(0);
  });

  test("the dialog is named by its title; Tab and Shift+Tab stay inside it", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "runs in the desktop project only");
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    await trigger(page, 1).click();
    const dialog = page.getByRole("dialog", { name: "תיקון ביקור סגור", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/פנייה 47969 · ביקור 1/);
    const close = dialog.getByRole("button", { name: "סגירה" });
    const cancel = dialog.getByRole("button", { name: "ביטול" });
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    // "ביטול" is the last control: Tab wraps to ✕, the first.
    await cancel.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    // Shift+Tab from ✕ wraps back to "ביטול".
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }
  });

  test("a click on the background closes an untouched dialog, never one with a choice or typed text", async ({ page }) => {
    // The panel is 440px wide: only the desktop width leaves dimmed background beside it.
    test.skip(test.info().project.name !== "desktop", "runs in the desktop project only");
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    const dialog = page.getByRole("dialog", { name: /תיקון ביקור סגור/ });
    await trigger(page, 1).click();
    const panel = await dialog.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    if (!panel) throw new Error("no dialog box");
    // A point of the dimmed background, beside the panel.
    const bg = { x: panel.x > 20 ? 5 : width - 5, y: 5 };
    const clickBackdrop = () => page.mouse.click(bg.x, bg.y);
    await clickBackdrop();
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page, 1)).toBeFocused();

    // A press that starts in the panel and ends on the background is not a background click.
    await trigger(page, 1).click();
    const title = await dialog.getByRole("heading", { name: "תיקון ביקור סגור" }).boundingBox();
    if (!title) throw new Error("no title box");
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(bg.x, bg.y);
    await page.mouse.up();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("שדה לתיקון").selectOption("summary");
    await dialog.getByLabel(/סיבת התיקון/).fill("השלמה");
    await clickBackdrop();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/סיבת התיקון/)).toHaveValue("השלמה");
    // A text selection that starts in the panel and ends on the background does not close it either.
    const reasonBox = await dialog.getByLabel(/סיבת התיקון/).boundingBox();
    if (!reasonBox) throw new Error("no reason box");
    await page.mouse.move(reasonBox.x + reasonBox.width / 2, reasonBox.y + reasonBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bg.x, bg.y);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "ביטול" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("an impossible time order is flagged, not blocked: the correction still runs (simulated)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/creator/calls/47969");
    await trigger(page, 1).click();
    const dialog = page.getByRole("dialog", { name: /תיקון ביקור סגור/ });
    await dialog.getByLabel("שדה לתיקון").selectOption("endAt");
    const flag = dialog.getByRole("note").filter({ hasText: "סדר הזמנים לא סביר" });
    await expect(flag).toHaveCount(0);
    // The end before the arrival.
    await dialog.getByLabel("השעה המתוקנת").fill("06:00");
    await expect(flag).toBeVisible();
    await dialog.getByLabel(/סיבת התיקון/).fill("בדיקת רצף");
    await dialog.getByRole("button", { name: "שמירת התיקון" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(dialog).toHaveCount(0);
    await expect(history(page, 1)).toContainText("06:00");
  });

  test("a corrected visit says \"תוקן במשרד\" and links to its corrections; each test correction has 🧪", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/47969");
    const mark = page.locator("#visit-1").getByRole("link", { name: /תוקן במשרד · 3 תיקונים/ });
    await expect(mark).toHaveAttribute("href", "#visit-1-corrections");
    await expect(page.locator("#visit-1-corrections")).toHaveCount(1);
    const rows = history(page, 1).locator(".vc-row:not(.vc-orig)");
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) await expect(row.locator(".pill", { hasText: "🧪" })).toHaveCount(1);
    // Customer service reads the history (with `card`): the mark is there too, without the action.
    await openPage(page, "/dev/demo/office/cs/calls/47969");
    await expect(page.locator("#visit-1").getByRole("link", { name: /תוקן במשרד/ })).toBeVisible();
    // An uncorrected closed visit has no mark.
    await openPage(page, "/dev/demo/office/mgr/calls/48205");
    await expect(page.locator("#visit-1").getByRole("link", { name: /תוקן במשרד/ })).toHaveCount(0);
  });

  test("technicians see their closed visit as they closed it: no office correction, no correction details (temporary)", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls/47948");
    await expect(page.locator("#visit-1")).toContainText("להחליף את אטם מנגנון המילוי ולבדוק שאין נזילה לאסלה");
    for (const path of ["/dev/demo/tech/done/47948/1", "/dev/demo/tech/visit/47948/1"]) {
      await openPage(page, path);
      const main = page.locator("main");
      await expect(main, path).toContainText("להמשיך את הטיפול ולבדוק שאין נזילה");
      await expect(main, path).not.toContainText("להחליף את אטם מנגנון המילוי");
      for (const word of ["תיקונים", "תוקן", "סיבת התיקון"]) await expect(main, `${path} ${word}`).not.toContainText(word);
    }
  });
});

test.describe("mock outbox (X-06, EM-01 to EM-05, D09)", () => {
  const items = (page: Page) => page.locator(".ob-items > li > a");
  const preview = (page: Page) => page.locator("article.ob-preview");

  test("a developer tool linked from the landing page's tools section, with its banner; nothing is ever sent", async ({ page }) => {
    await openPage(page, "/dev/demo");
    const tools = page.getByRole("navigation", { name: "כלי פיתוח" });
    await tools.getByRole("link", { name: /דואר מדומה/ }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/outbox$/);
    await expect(page.getByRole("note", { name: "כלי פיתוח" })).toHaveText(/כלי פיתוח · דואר מדומה · שום מייל לא נשלח/);
    await expect(page.getByRole("heading", { level: 1, name: "דואר מדומה" })).toBeVisible();
    // Every delivery state says it will not be sent; "נשלח" only ever negated.
    const states = await page.locator(".ob-delivery").allInnerTexts();
    expect(states.length).toBeGreaterThan(40);
    for (const s of states) expect(s.trim()).toBe("לא יישלח · נתוני בדיקה");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(POSITIVE_SENT);
    expect(text).not.toMatch(/\bD\d{2}\b/);
    // Read-only: no send, resend or delete.
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  test("one record per closure: unique request and visit per row, the idempotency key of the visit", async ({ page }) => {
    await openPage(page, "/dev/demo/outbox");
    const lines = await page.locator(".ob-items .ob-item > .sub").allInnerTexts();
    expect(lines.length).toBe(40);
    const refs = lines.map((l) => l.match(/פנייה (\d+) · ביקור (\d+)/)?.slice(1, 3).join("-"));
    expect(refs.every(Boolean)).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    const [req, n] = (refs[0] ?? "").split("-");
    await expect(preview(page).locator("code.ob-key")).toHaveText(`visit-completion:${req}-${n}`);
    await expect(preview(page)).toContainText("מייל אחד לכל סיום ביקור, בלי כפילויות");
    await expect(items(page).first()).toHaveAttribute("aria-current", "true");
  });

  test("recipients: the Manager and the service mailbox for both outcomes; the rep and media pending; the preserved approval text", async ({
    page,
  }) => {
    for (const [id, outcome] of [
      ["ob-48198-1", "done"],
      ["ob-47964-1", "cont"],
    ] as const) {
      await openPage(page, `/dev/demo/outbox?id=${id}`);
      const p = preview(page);
      const to = p.locator(".ob-rcpts").first();
      await expect(to.locator("li"), id).toHaveCount(2);
      await expect(to, id).toContainText("מנהל");
      await expect(to, id).toContainText("@example.test");
      await expect(to, id).toContainText("תיבת שירות הלקוחות");
      await expect(to, id).toContainText("<service@example.test>");
      await expect(p, id).toContainText("איזה מנהל מקבל (מנהל אחד או כל המנהלים): ממתין להחלטת בעלים (d10)");
      await expect(p, id).toContainText("ממתין להחלטה");
      await expect(p, id).toContainText("הנציגה המטפלת");
      await expect(p, id).toContainText("לא בנמענים: ממתין להחלטת בעלים (d10)");
      await expect(p, id).toContainText("לא מצורפים למייל · ממתין להחלטת בעלים (d11) · הצפייה בכרטיס הקריאה");
      await expect(p, id).toContainText("ממתין להחלטת בעלים (d12)");
      // EM-04 business identifiers.
      for (const label of ["מספר פנייה", "מספר משימה", "מספר לקוח", "מספר ביקור", "תוצאה"]) await expect(p, `${id} ${label}`).toContainText(label);
      if (outcome === "done") {
        await expect(p).toContainText('נחתם ע"י');
        await expect(p).toContainText('"קריאת השירות טופלה לשביעות רצון הלקוח"');
        await expect(p).toContainText("הנוסח שהוצג ללקוח בזמן החתימה");
      } else {
        await expect(p).toContainText("סיבת המשך טיפול");
        await expect(p).toContainText("מה צריך לעשות:");
        await expect(p).not.toContainText('נחתם ע"י');
      }
      // Both rows are on the first page: the selected one is marked.
      await expect(page.locator('.ob-items a[aria-current="true"]'), id).toHaveAttribute("href", `/dev/demo/outbox?id=${id}`);
    }
  });

  test("a closure without an approved summary is held (pending decision)", async ({ page }) => {
    await openPage(page, "/dev/demo/outbox?id=ob-48190-1");
    await expect(page.locator('.ob-items a[aria-current="true"]')).toContainText("מוחזק · אין סיכום מאושר");
    await expect(preview(page)).toContainText("מוחזק · אין עדיין סיכום כתוב או תמלול מאושר · ממתין להחלטת בעלים (d06)");
    await expect(preview(page)).toContainText("אין עדיין סיכום מאושר, ולכן המייל מוחזק");
  });

  test("choosing a row selects it in the URL, moves focus to its subject; the card link opens the call card", async ({ page }) => {
    await openPage(page, "/dev/demo/outbox");
    const second = items(page).nth(1);
    const subject = (await second.locator(".ob-subject").innerText()).trim();
    await second.click();
    await expect(page).toHaveURL(/[?&]id=ob-\d+-\d+/);
    await expect(second).toHaveAttribute("aria-current", "true");
    await expect(items(page).first()).not.toHaveAttribute("aria-current", "true");
    const title = page.locator("#ob-preview-title");
    await expect(title).toHaveText(subject);
    await expect(title).toBeFocused();
    const req = subject.match(/פנייה (\d+)/)?.[1];
    const card = preview(page).getByRole("link", { name: "לכרטיס הקריאה ›" });
    await expect(card).toHaveAttribute("href", `/dev/demo/office/mgr/calls/${req}`);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/dev/demo/office/mgr/calls/${req}$`));
  });
});

test.describe("technician sync state (TE-23, TE-24, D06, D46)", () => {
  const banner = (page: Page) => page.getByRole("region", { name: /פריטים עוד לא הגיעו לשרת/ });

  test("home: the pending-operations banner with each visit's pill, the last sync and the warning", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    const b = banner(page);
    await expect(b.getByRole("heading", { level: 2 })).toHaveText("⚠ 3 פריטים עוד לא הגיעו לשרת");
    await expect(b).toContainText("נכשל: 1 · ממתין לסנכרון: 2 · סנכרון אחרון: אתמול 16:32");
    await expect(b.locator('.sy-vhead [data-sync-state="failed"]')).toHaveCount(1);
    await expect(b.locator('.sy-vhead [data-sync-state="pending"]')).toHaveCount(1);
    await expect(b.getByRole("link", { name: "דנה ברק" })).toHaveAttribute("href", "/dev/demo/tech/visit/47963/1");
    await expect(b).toContainText("מה שנמצא רק במכשיר לא ניתן לשחזר");
    // The banner sits above the next visit.
    const above = await b.boundingBox();
    const next = await page.getByRole("region", { name: "הביקור הבא" }).boundingBox();
    expect(above && next && above.y + above.height <= next.y).toBe(true);
  });

  /**
   * Records every sync state and retry label the page shows from now on (a MutationObserver), so a
   * state that lasts only while a command runs ("מסתנכרן", "שולח…") is checked without timing.
   */
  const recordSyncStates = (page: Page) =>
    page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __syncSeen: Set<string> }).__syncSeen = seen;
      const record = () => {
        for (const el of document.querySelectorAll("[data-sync-state]")) seen.add(`state:${el.getAttribute("data-sync-state")}`);
        for (const el of document.querySelectorAll("button.sy-btn")) seen.add(`button:${el.getAttribute("aria-label") ?? el.textContent ?? ""}`);
      };
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
  const seenSyncStates = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { __syncSeen: Set<string> }).__syncSeen]);

  test("home: the banner is small; \"סנכרן עכשיו\" shows \"מסתנכרן\" while it runs and is simulated: nothing is sent", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    const b = banner(page);
    // Per-item detail and "נסה שוב" are on the visit's sync panel, not on the home.
    await expect(b.getByRole("button", { name: /נסה שוב/ })).toHaveCount(0);
    await expect(b.getByRole("list", { name: "ביקורים עם עבודה שממתינה במכשיר" }).locator(":scope > li")).toHaveCount(2);

    await recordSyncStates(page);
    await b.getByRole("button", { name: "סנכרן עכשיו" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("סנכרון עכשיו · שום דבר לא נשלח לשרת");
    await expect(b.locator(".sy-now").getByRole("status")).toHaveText("בהדגמה: 3 פריטים נשארו במכשיר, שום דבר לא נשלח לשרת. לא נשמר.");
    await expect(b.locator(".sy-now").getByRole("alert")).toHaveText("");
    expect(await seenSyncStates(page)).toContain("state:syncing");
    // Back to the reported states: nothing reached the server.
    await expect(b.locator('[data-sync-state="failed"]')).toHaveCount(1);
    await expect(b.locator('[data-sync-state="sent"]')).toHaveCount(0);
    await expect(b.getByRole("button", { name: "סנכרן עכשיו" })).toBeFocused();
  });

  test("the banner's visit link opens the visit card, where \"נסה שוב\" is simulated: \"שולח…\" while it runs, then \"נכשל\" again", async ({
    page,
  }) => {
    await openPage(page, "/dev/demo/tech");
    await banner(page).getByRole("link", { name: "דנה ברק" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/tech\/visit\/47963\/1$/);
    const panel = page.getByRole("region", { name: "סנכרון עם השרת" });
    await expect(panel).toContainText("ההעלאה נכשלה · הקובץ לא הגיע שלם לשרת");
    await expect(panel).toContainText("מה שנמצא רק במכשיר לא ניתן לשחזר");

    await recordSyncStates(page);
    await panel.getByRole("button", { name: "נסה שוב · תמונה אחרי הטיפול · פנייה 47963 · ביקור 1" }).click();
    await expect(toast(page)).toContainText(SIMULATED);
    await expect(toast(page)).toContainText("ניסיון חוזר · שום דבר לא נשלח לשרת");
    const op = panel.locator(".sy-op").filter({ hasText: "תמונה אחרי הטיפול" });
    await expect(op.getByRole("status")).toHaveText("לא נשלח · פעולה מדומה");
    await expect(op.getByRole("alert")).toHaveText("");
    const seen = await seenSyncStates(page);
    expect(seen).toContain("state:syncing");
    // The button's name follows its text while the command runs (label in name).
    expect(seen).toContain("button:שולח… · תמונה אחרי הטיפול · פנייה 47963 · ביקור 1");
    await expect(op.locator('[data-sync-state="failed"]')).toHaveCount(1);
    await expect(panel.locator('[data-sync-state="sent"]')).toHaveCount(0);
  });

  test("closed views: the visit's sync panel at both addresses; a confirmed visit says everything arrived", async ({ page }) => {
    for (const path of ["/dev/demo/tech/done/47963/1", "/dev/demo/tech/visit/47963/1"]) {
      await openPage(page, path);
      const panel = page.getByRole("region", { name: "סנכרון עם השרת" });
      await expect(panel.locator(".sy-head [data-sync-state]"), path).toHaveAttribute("data-sync-state", "failed");
      await expect(panel, path).toContainText("ההעלאה נכשלה · הקובץ לא הגיע שלם לשרת");
      await expect(panel.getByRole("button", { name: /^נסה שוב/ }), path).toBeVisible();
      await expect(panel.getByRole("button", { name: "סנכרן עכשיו" }), path).toBeVisible();
    }
    await page.getByRole("region", { name: "סנכרון עם השרת" }).getByRole("button", { name: /^נסה שוב/ }).click();
    await expect(toast(page)).toContainText("ניסיון חוזר · שום דבר לא נשלח לשרת");

    await openPage(page, "/dev/demo/tech/done/47960/1");
    const confirmed = page.getByRole("region", { name: "סנכרון עם השרת" });
    await expect(confirmed.locator('[data-sync-state="sent"]')).toBeVisible();
    await expect(confirmed).toContainText("כל העבודה של הביקור הגיעה לשרת.");
    await expect(confirmed.getByRole("button")).toHaveCount(0);
    // A visit the device holds nothing about has no panel.
    await openPage(page, "/dev/demo/tech/done/47800/1");
    await expect(page.getByRole("region", { name: "סנכרון עם השרת" })).toHaveCount(0);
  });

  test("the close confirmation shows the sync progression, no step done, and no \"email sent\" claim", async ({ page }) => {
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
    const send = page.locator(".bigbtn").last();
    await expect(send).toBeEnabled();
    await send.click();
    const steps = page.getByRole("region", { name: "מה קורה עם הסיום" });
    await expect(steps).toBeVisible();
    await expect(steps.locator("[data-sync-state]")).toHaveText([/נשמר במכשיר/, /ממתין לסנכרון/, /מסתנכרן/, /נשלח לשרת/]);
    await expect(steps).toContainText("בהדגמה אף שלב לא בוצע");
    await expect(steps.locator(".sy-step-done")).toHaveCount(0);
    await expect(steps).toContainText("רק אחרי שהשרת מקבל את הסיום עם סיכום מאושר");
    // No line claims that an email was sent.
    const lines = (await page.locator("body").innerText()).split("\n").filter((l) => l.includes("מייל"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/(?<!לא )(נשלח|נשלחה|יישלח) (ה)?מייל|מייל (נשלח|יישלח)/);
    expect(await page.locator("body").innerText()).not.toContain("נשלח מייל לשירות הלקוחות");
  });
});

test.describe("what the browser receives (phase G)", () => {
  onlyInProject("desktop");

  test("the call card's corrections and the review items carry no account ids", async ({ page }) => {
    for (const path of [
      "/dev/demo/office/mgr/calls/47969",
      "/dev/demo/office/creator/calls/47969",
      "/dev/demo/office/creator/calls/47948",
      "/dev/demo/office/mgr/review/rv-3",
      "/dev/demo/office/creator/review/rv-6",
      "/dev/demo/outbox",
      "/dev/demo/tech",
    ]) {
      const body = await (await page.request.get(path)).text();
      expect(body, path).not.toMatch(/acc-[a-z]/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// D57 (owner, 2026-11-05): the Manager's and the Creator's five-item navigation with "דשבורד" as
// the landing, the Manager's Settings › "משתמשים" (D34, never the matrix key `settings`), the
// "מסכים נוספים" row on "קריאות" (no counts) and the white MODY logo in the existing dark headers.
// Display only (G-04): every page keeps its own check.

test.describe("D57: the \"מסכים נוספים\" row on \"קריאות\"", () => {
  test("Manager and Creator: four links, no digits, each at least 24px tall; customer service has no row", async ({ page }) => {
    for (const role of ["mgr", "creator"] as const) {
      await openPage(page, `/dev/demo/office/${role}/calls`);
      const row = page.getByRole("navigation", { name: "מסכים נוספים" });
      await expect(row, role).toBeVisible();
      await expect(row.getByRole("link"), role).toHaveText(["לקוחות", "חזרו מהשטח", "פריטים לבדיקה", "מוצרים"]);
      expect(await row.innerText(), role).not.toMatch(/\d/);
      for (const link of await row.getByRole("link").all()) {
        const b = await link.boundingBox();
        expect(b && b.height >= 24, `${role} ${await link.innerText()}`).toBe(true);
      }
      // The row sits between the title and the calls list.
      const [title, rowBox, search] = await Promise.all([
        page.locator(".ptitle").first().boundingBox(),
        row.boundingBox(),
        page.getByRole("searchbox").or(page.getByRole("textbox")).first().boundingBox(),
      ]);
      expect(title && rowBox && rowBox.y >= title.y + title.height - 1, role).toBe(true);
      expect(rowBox && search && rowBox.y + rowBox.height <= search.y + 1, role).toBe(true);
      expect(await horizontalOverflow(page), role).toEqual([]);
    }
    await openPage(page, "/dev/demo/office/cs/calls");
    await expect(page.getByRole("navigation", { name: "מסכים נוספים" })).toHaveCount(0);
  });

  test("a link opens its screen with \"קריאות\" highlighted; the no-access card leads back to \"דשבורד\"", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls");
    await page.getByRole("navigation", { name: "מסכים נוספים" }).getByRole("link", { name: "חזרו מהשטח", exact: true }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/back-from-field$/);
    await expect(page.getByRole("heading", { level: 1, name: "חזרו מהשטח" })).toBeVisible();
    await expect(sideNav(page).locator("a.on")).toHaveText("קריאות");
    // Customer Service's no-access cards lead back to its unchanged home; the Manager's to "דשבורד".
    await openPage(page, "/dev/demo/office/cs/products");
    await expect(page.getByRole("link", { name: "חזרה לבית" })).toHaveAttribute("href", "/dev/demo/office/cs");
    await openPage(page, "/dev/demo/office/mgr/settings/places");
    await expect(page.getByRole("link", { name: "חזרה לדשבורד" })).toHaveAttribute("href", "/dev/demo/office/mgr/analytics");
  });
});

test.describe("D57: the Manager's Settings › \"משתמשים\" (D34 fixed capability)", () => {
  test("the account administration with no tab bar; \"הגדרות\" is the current page; no overflow", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/settings/accounts");
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות · משתמשים" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "לשוניות ההגדרות" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "חשבונות שירות לקוחות וטכנאים" })).toBeVisible();
    await expect(page.getByRole("table", { name: "מטריצת ההרשאות" })).toHaveCount(0);
    await expect(sideNav(page).getByRole("link", { name: "הגדרות", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

test.describe("D57: Settings › \"משתמשים\" and the landing, negative access (raw responses)", () => {
  onlyInProject("desktop");

  const html = async (page: Page, path: string) => (await page.request.get(path)).text();

  test("customer service: \"אין הרשאה\" and no account data; the Creator: a pointer to \"משתמשים והרשאות\" only", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs/settings/accounts");
    await expect(page.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
    await expect(page.locator("main table, main form, main .tog")).toHaveCount(0);
    expect(await html(page, "/dev/demo/office/cs/settings/accounts")).not.toMatch(/acc-[a-z]|areq-/);

    await openPage(page, "/dev/demo/office/creator/settings/accounts");
    await expect(page.getByText("היוצר מנהל את כל החשבונות ומאשר את בקשות המנהל בלשונית משתמשים והרשאות.")).toBeVisible();
    await expect(page.locator("main table, main form, main .tog")).toHaveCount(0);
    expect(await html(page, "/dev/demo/office/creator/settings/accounts")).not.toMatch(/acc-[a-z]|areq-/);
    await page.getByRole("link", { name: "למשתמשים והרשאות" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/creator\/settings\/users$/);
  });

  test("the Manager's \"משתמשים\" never carries the matrix or the Creator's account; `settings` stays off", async ({ page }) => {
    const body = await html(page, "/dev/demo/office/mgr/settings/accounts");
    expect(body).toContain("acc-shirel");
    // No Manager or Creator account (D34 scope); the Creator's own Settings tab has them (control).
    expect(body).not.toMatch(MANAGER_OR_CREATOR_ACCOUNT);
    expect(await html(page, "/dev/demo/office/creator/settings/users")).toMatch(MANAGER_OR_CREATOR_ACCOUNT);
    expect(body).not.toContain("מה כל הרשאה רואה");
    // The matrix table (its name; the screen's own note may mention the matrix in words).
    expect(body).not.toContain('aria-label="מטריצת ההרשאות"');
    expect(body).not.toContain("כל האזנה נרשמת ביומן הביקורת");
    // The matrix value is unchanged: the Manager's "הגדרות" key is still off (SE-03, D33).
    await openPage(page, "/dev/demo/office/creator/settings/users");
    await expect(page.getByRole("button", { name: "הגדרות למנהל", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("the simulated commands' caller is the page's role: `selfRole` mgr on the Manager's tab, creator on the Creator's (PR 2.2 review CA-5)", async ({
    page,
  }) => {
    const selfRole = { mgr: /selfRole\\?"\s*:\s*\\?"mgr\\?"/, creator: /selfRole\\?"\s*:\s*\\?"creator\\?"/ };
    const manager = await html(page, "/dev/demo/office/mgr/settings/accounts");
    expect(manager).toMatch(selfRole.mgr);
    expect(manager).not.toMatch(selfRole.creator);
    for (const path of ["/dev/demo/office/creator/settings/users", "/dev/demo/office/creator/settings/techs"]) {
      const body = await html(page, path);
      expect(body, path).toMatch(selfRole.creator);
      expect(body, path).not.toMatch(selfRole.mgr);
    }
    // Customer Service gets no account state at all.
    expect(await html(page, "/dev/demo/office/cs/settings/accounts")).not.toContain("selfRole");
  });

  test("the landing and the former \"משתמשים\" address answer 307 with the target and no account data", async ({ page }) => {
    for (const [path, target] of [
      ["/dev/demo/office/mgr", "/dev/demo/office/mgr/analytics"],
      ["/dev/demo/office/creator", "/dev/demo/office/creator/analytics"],
      ["/dev/demo/office/mgr/users", "/dev/demo/office/mgr/settings/accounts"],
    ] as const) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(new URL(res.headers().location ?? "", "http://x").pathname, path).toBe(target);
      expect(await res.text(), path).not.toMatch(/acc-[a-z]|areq-|FIXTURE-SENTINEL/);
    }
    // Not an office role: still a 404.
    expect((await page.request.get("/dev/demo/office/tech", { maxRedirects: 0 })).status()).toBe(404);
  });
});

test.describe("D57 (6): the white MODY logo in the existing dark headers", () => {
  /** Width per header: the office sidebar above 900px, its narrow top bar, the technician header. */
  const expected = (kind: "office" | "tech", viewportWidth: number) => (kind === "tech" ? 88 : viewportWidth > 900 ? 132 : 92);

  for (const [kind, path] of [
    ["office", "/dev/demo/office/mgr/calls"],
    ["office", "/dev/demo/office/cs"],
    ["office", "/dev/showcase/office"],
    ["tech", "/dev/demo/tech"],
    ["tech", "/dev/demo/tech/visit/48213/1"],
    ["tech", "/dev/showcase/tech"],
  ] as const) {
    test(`${path}: proportions, size and a dark background behind it`, async ({ page }) => {
      await openPage(page, path);
      const img = kind === "office" ? officeLogo(page) : techLogo(page);
      await expect(img).toHaveCount(1);
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      const facts = await img.evaluate((el: HTMLImageElement) => {
        const r = el.getBoundingClientRect();
        // The nearest painted background behind the logo (the header itself).
        let behind = "";
        for (let n: HTMLElement | null = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
            behind = bg;
            break;
          }
        }
        const style = getComputedStyle(el);
        return {
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          width: r.width,
          height: r.height,
          ownBackground: style.backgroundColor,
          parentBackground: getComputedStyle(el.parentElement as HTMLElement).backgroundColor,
          filter: style.filter,
          blend: style.mixBlendMode,
          behind,
        };
      });
      expect(facts.naturalWidth).toBe(976);
      expect(facts.naturalHeight).toBe(234);
      expect(Math.abs(facts.width / facts.height - 976 / 234) / (976 / 234)).toBeLessThan(0.01);
      expect(facts.width).toBeCloseTo(expected(kind, page.viewportSize()!.width), 0);
      expect(facts.ownBackground).toBe("rgba(0, 0, 0, 0)");
      expect(facts.parentBackground).toBe("rgba(0, 0, 0, 0)");
      expect(facts.filter).toBe("none");
      expect(facts.blend).toBe("normal");
      // --ink (#18212B): the existing dark header, never a light strip.
      expect(facts.behind).toBe("rgb(24, 33, 43)");
      await expect(page.locator('img[src*="mody-logo.png"], .work-brand')).toHaveCount(0);
      expect(await horizontalOverflow(page)).toEqual([]);
    });
  }

  test("at 900px and below the product name stays for screen readers only and the top bar does not grow", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/calls");
    const name = page.locator(".side .brand-name");
    await expect(name).toHaveText("ניהול טכנאים");
    const narrow = page.viewportSize()!.width <= 900;
    const box = await name.boundingBox();
    if (narrow) {
      expect(box && box.width <= 1 && box.height <= 1).toBe(true);
      // The logo sits in the nav row: not taller than a nav link, centred on the first link's row
      // (never a row of its own, also when the nav wraps).
      const [logo, link] = await Promise.all([officeLogo(page).boundingBox(), sideNav(page).getByRole("link").first().boundingBox()]);
      expect(logo && link && logo.height <= link.height).toBe(true);
      expect(logo && link && Math.abs(logo.y + logo.height / 2 - (link.y + link.height / 2))).toBeLessThanOrEqual(8);
    } else {
      await expect(name).toBeVisible();
      const logo = await officeLogo(page).boundingBox();
      expect(logo && box && box.y >= logo.y + logo.height - 1).toBe(true);
    }
  });

  test("the technician header: the logo row is at the end side (left in RTL), above the screen's own header", async ({ page }) => {
    await openPage(page, "/dev/demo/tech");
    const [brand, logo, head] = await Promise.all([
      page.locator(".ph-head > .ph-brand").boundingBox(),
      techLogo(page).boundingBox(),
      page.locator(".ph-head > .ph-brand + *").boundingBox(),
    ]);
    expect(brand && logo && Math.abs(logo.x - brand.x) <= 1).toBe(true);
    expect(brand && head && head.y >= brand.y + brand.height - 1).toBe(true);
    await expect(page.locator(".ph-head > :first-child")).toHaveClass("ph-brand");
  });
});

test.describe("D57 (6): the logo file", () => {
  onlyInProject("desktop");

  test("public/brand/mody-logo-white.png: 976×234, 8-bit RGBA, transparent corner", async () => {
    const { readFileSync } = await import("node:fs");
    const { inflateSync } = await import("node:zlib");
    const png = readFileSync("public/brand/mody-logo-white.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(976);
    expect(png.readUInt32BE(20)).toBe(234);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // colour type: RGBA
    expect(png[28]).toBe(0); // not interlaced
    const idat: Buffer[] = [];
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      const type = png.subarray(at + 4, at + 8).toString("latin1");
      if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    // Scanline 0: a filter byte, then RGBA per pixel. For the first pixel of the first row every
    // PNG filter predicts 0, so the stored byte is the alpha value itself.
    expect(raw[1 + 3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// D57: the manager dashboard (spec-final §10.2). Demo values at DEMO_NOW (21.10.2026 12:45),
// computed from the fictional fixtures with the D57 formulas (the unit tests of the formulas are
// in dashboard-metrics.spec.ts).

const DASH = "/dev/demo/office/mgr/analytics";

/** A dashboard tile by its exact label (a linked tile's label ends with " ›"). */
const dashTile = (page: Page, label: string) =>
  page.locator(".ma-kpis .kpi").filter({ has: page.locator(".l", { hasText: new RegExp(`^${label}( ›)?$`) }) });
const dashValue = (page: Page, label: string) => dashTile(page, label).locator(".v");
/** The visible label of the Technicians toolbar's period. */
const periodLabel = (page: Page) => page.locator(".ma-plabel");
const dialog = (page: Page) => page.getByRole("dialog");
/** Rows of the open dialog's table. */
const dialogRows = (page: Page) => dialog(page).locator("tbody tr");

test.describe("D57 dashboard: numbers on screen", () => {
  onlyInProject("desktop");

  test("General: today, the current month's service metrics, the 30-day highlights and the chart table", async ({ page }) => {
    await openPage(page, DASH);
    await expect(dashValue(page, "מתוכננים")).toHaveText("11");
    await expect(dashValue(page, "בוצעו")).toHaveText("2");
    await expect(dashValue(page, "טרם בוצעו")).toHaveText("6");
    await expect(dashValue(page, "לא בוצעו במועד")).toHaveText("3");
    await expect(dashValue(page, "לא בוצעו במועד")).toHaveCSS("color", "rgb(193, 79, 79)");
    await expect(page.locator(".ma-progress-pct")).toHaveText("18%");
    await expect(page.locator(".ma-mini", { hasText: "2 מתוך 11 הושלמו" })).toBeVisible();

    await expect(page.getByText("אוקטובר 2026 · החודש הנוכחי")).toBeVisible();
    await expect(dashValue(page, "זמן טיפול ממוצע")).toHaveText("47 דק׳");
    await expect(dashValue(page, "זמן נסיעה ממוצע")).toHaveText("32 דק׳");
    await expect(dashValue(page, "פתרון בביקור ראשון")).toHaveText("71%");
    await expect(dashValue(page, "זמן סגירת קריאה")).toHaveText("3.8 ימים");

    await expect(page.getByRole("list", { name: "3 ספקים מובילים" }).locator(".ma-bar-val")).toHaveText([/^106/, /^60/, /^25/]);
    await expect(page.getByRole("list", { name: "5 מק״טים מובילים" }).locator(".ma-bar-val")).toHaveText([/^50/, /^49/, /^39/, /^25/, /^21/]);

    await page.locator(".ma-details > summary").click();
    const rows = page.getByRole("table", { name: /מגמת קריאות שירות/ }).locator("tbody tr");
    await expect(rows).toHaveCount(6);
    const expected = [
      ["אפריל 2026", "אין נתונים", "אין נתונים"],
      ["מאי 2026", "אין נתונים", "אין נתונים"],
      ["יוני 2026", "אין נתונים", "אין נתונים"],
      ["יולי 2026", "1", "1"],
      ["אוגוסט 2026", "2", "2"],
      ["ספטמבר 2026", "28", "4"],
    ];
    for (const [i, cells] of expected.entries()) await expect(rows.nth(i).locator("td")).toHaveText(cells);

    for (const months of [3, 12]) {
      await openPage(page, `${DASH}?months=${months}`);
      await page.locator(".ma-details > summary").click();
      await expect(page.getByRole("table", { name: /מגמת קריאות שירות/ }).locator("tbody tr")).toHaveCount(months);
    }
    await expect(page.getByRole("navigation", { name: "טווח הגרף" }).getByRole("link", { name: "12 חודשים" })).toHaveAttribute("aria-current", "true");
  });

  test("Technicians: יורם by month, week and day; אדי's closure time in hours", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y`);
    await expect(periodLabel(page)).toHaveText("אוקטובר 2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("76");
    await expect(dashValue(page, "ביקורים שבוצעו")).toHaveText("70");
    await expect(dashValue(page, "קריאות שנסגרו")).toHaveText("52");
    await expect(dashValue(page, "זמן טיפול ממוצע")).toHaveText("47 דק׳");
    await expect(dashValue(page, "זמן נסיעה ממוצע")).toHaveText("31 דק׳");
    await expect(dashValue(page, "פתרון בביקור ראשון")).toHaveText("71%");
    await expect(dashValue(page, "זמן סגירת קריאה ממוצע")).toHaveText("3.9 ימים");
    await expect(dashValue(page, "עמידה בתכנון")).toHaveText("הגדרה ממתינה");

    await openPage(page, `${DASH}?tab=tech&tech=y&period=week`);
    await expect(periodLabel(page)).toHaveText("18.10–24.10.2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("24");
    await expect(dashValue(page, "ביקורים שבוצעו")).toHaveText("18");
    await expect(dashValue(page, "קריאות שנסגרו")).toHaveText("12");

    await openPage(page, `${DASH}?tab=tech&tech=y&period=day`);
    await expect(periodLabel(page)).toHaveText("21.10.2026");
    for (const label of ["זמן טיפול ממוצע", "זמן נסיעה ממוצע", "פתרון בביקור ראשון", "זמן סגירת קריאה ממוצע"]) {
      await expect(dashValue(page, label), label).toHaveText(/^—\s*אין מספיק נתונים$/);
      await expect(dashTile(page, label), label).toContainText("אין מספיק נתונים");
    }

    await openPage(page, `${DASH}?tab=tech&tech=e&period=day`);
    await expect(dashValue(page, "זמן סגירת קריאה ממוצע")).toHaveText("47 שעות");
  });

  test("Products & Suppliers: unique calls, warranty and follow-up per SKU, columns and sorting", async ({ page }) => {
    await openPage(page, `${DASH}?tab=prod`);
    const suppliers = page.getByRole("list", { name: "קריאות לפי ספק" });
    await expect(suppliers.locator(".ma-bar-val")).toHaveText([/^108/, /^61/, /^26/, /^2/]);
    await expect(suppliers.locator(".ma-bar-name").last()).toHaveText("לא הוזן");

    const table = page.getByRole("table", { name: "מק״טים עם הכי הרבה קריאות" });
    await expect(table.locator("thead th")).toHaveText(["מק״ט", "מוצר", "מותג", "ספק", "קריאות", "באחריות", "% המשך טיפול", "תקלה נפוצה"]);
    const row = (sku: string) => table.locator("tbody tr").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${sku}$`) }) });
    // Unique calls, not visits: KT-2041 14% and BT-1120 40% (visit-based rates would be 13% and 35%).
    await expect(row("KT-2041").locator("td").nth(4)).toHaveText("52");
    await expect(row("KT-2041").locator("td").nth(5)).toHaveText("87%");
    await expect(row("KT-2041").locator("td").nth(6)).toHaveText("14%");
    await expect(row("BT-1120").locator("td").nth(6)).toHaveText("40%");
    await expect(row("MX-410").locator("td").nth(5)).toHaveText(/^—/);

    const callsHeader = table.locator("thead th").nth(4);
    await expect(callsHeader).toHaveAttribute("aria-sort", "descending");
    await callsHeader.getByRole("link").click();
    await expect(page).toHaveURL(/sort=calls-asc/);
    await expect(table.locator("thead th").nth(4)).toHaveAttribute("aria-sort", "ascending");
    // 1 call each: the tie between MX-410 and TB-75 is broken by SKU.
    await expect(table.locator("tbody tr").first().locator("td").first()).toHaveText("MX-410");
  });
});

test.describe("D57 dashboard: scope, no fabrication, colours", () => {
  test("General: no follow-up or review counters, no work-queue links; computed metrics show numbers", async ({ page }) => {
    await openPage(page, DASH);
    const main = page.locator("main");
    for (const text of ["דורש טיפול", "המשך טיפול פתוחים", "עכשיו בשטח", "דרשו המשך טיפול", "פריטים לבדיקה"]) {
      await expect(main, text).not.toContainText(text);
    }
    await expect(main.locator('a[href*="/review"], a[href*="/back-from-field"], a[href*="/customers"], a[href*="/calls?"]')).toHaveCount(0);
    await expect(dashValue(page, "לא בוצעו במועד")).not.toHaveText("הגדרה ממתינה");
    await expect(dashValue(page, "זמן סגירת קריאה")).not.toHaveText("הגדרה ממתינה");
    // A named group, not an image: an image's children are presentational and must not hold links
    // (axe nested-interactive, WCAG 4.1.2). Its content is hidden from assistive technology.
    const chart = page.getByRole("group", { name: /מגמת קריאות שירות לפי חודש/ });
    await expect(chart).toBeVisible();
    await expect(page.locator('[role="img"] a[href]')).toHaveCount(0);
    expect(await chart.locator("a").count()).toBeGreaterThan(0);
    for (const a of await chart.locator("a").all()) {
      await expect(a).toHaveAttribute("aria-hidden", "true");
      await expect(a).toHaveAttribute("tabindex", "-1");
    }
    // Gridlines at whole-number steps (September's 28 opened calls → a 40 scale: 10 / 20 / 30), never "12.5".
    await expect(chart.locator(".ma-gridline span")).toHaveText(["10", "20", "30"]);
    await expect(page.locator(".ma-gbar-o").last()).toHaveCSS("background-color", "rgb(70, 119, 213)");
    await expect(page.locator(".ma-gbar-c").last()).toHaveCSS("background-color", "rgb(105, 117, 134)");
    await expect(page.locator(".ma-progress .ma-seg-done")).toHaveCSS("background-color", "rgb(70, 119, 213)");
    await expect(page.locator(".ma-progress .ma-seg-pending")).toHaveCSS("background-color", "rgb(185, 193, 205)");
    await expect(page.locator(".ma-progress .ma-seg-missed")).toHaveCSS("background-color", "rgb(193, 79, 79)");
    // 🧪 on the General SKU bars (SIM-17); SKUs are LTR text.
    await expect(page.getByRole("list", { name: "5 מק״טים מובילים" }).locator(".pill").first()).toContainText("🧪");
    for (const sku of await page.getByRole("list", { name: "5 מק״טים מובילים" }).locator(".ma-bar-name bdi").all()) {
      await expect(sku).toHaveAttribute("dir", "ltr");
    }
  });

  test("every \"—\" value has an accessible name", async ({ page }) => {
    for (const path of [`${DASH}?tab=tech&tech=y&period=day`, `${DASH}?tab=prod`]) {
      await openPage(page, path);
      const empties = page.locator(".ma-none");
      expect(await empties.count(), path).toBeGreaterThan(0);
      for (const el of await empties.all()) await expect(el).toContainText(/אין מספיק נתונים|אין נתונים/);
    }
  });

  test("Technicians: three activity tiles in the owner's order, five performance tiles, one technician only", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y`);
    await expect(page.locator(".ma-kpis-3 .kpi .l")).toHaveText([/^ביקורים מתוכננים/, /^ביקורים שבוצעו/, /^קריאות שנסגרו/]);
    await expect(page.locator(".ma-kpis-5 .kpi")).toHaveCount(5);
    await expect(page.locator(".ma-kpis .v", { hasText: "הגדרה ממתינה" })).toHaveCount(1);
    await expect(dashTile(page, "עמידה בתכנון")).not.toHaveAttribute("href", /./);
    // No other technician's name outside the technician buttons.
    const body = await page.locator(".ma-dash").evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelector(".ma-cgroup-tech")?.remove();
      return copy.textContent ?? "";
    });
    expect(body).not.toContain("אדי");
    expect(body).not.toContain("שמואל");
    // At the current period "next" is not a link; a future offset is treated as the current period.
    await expect(page.getByRole("link", { name: "התקופה הבאה" })).toHaveCount(0);
    await openPage(page, `${DASH}?tab=tech&tech=y&offset=1`);
    await expect(periodLabel(page)).toHaveText("אוקטובר 2026");
    await expect(page.getByRole("link", { name: "התקופה הבאה" })).toHaveCount(0);
  });

  test("Technicians: an invalid custom range shows the error and falls back to the current month", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y&period=custom&from=2026-10-10&to=2026-10-01`);
    await expect(page.locator("#ma-range-error")).toHaveText("טווח התאריכים לא תקין: עד היום ולא יותר משנה");
    await expect(page.locator("#ma-range-error")).toHaveAttribute("role", "alert");
    await expect(page.getByLabel("מתאריך")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("עד תאריך")).toHaveAttribute("aria-describedby", "ma-range-error");
    await expect(page.locator(".ma-section .ma-label").first()).toContainText("אוקטובר 2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("76");
  });

  test("Technicians: the reports view has the visits table, no tiles and no counts on the filter chips", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y&view=reports`);
    await expect(page.getByRole("heading", { name: /דוחות הביקורים של יורם · אוקטובר 2026/ })).toBeVisible();
    await expect(page.getByRole("table", { name: "הביקורים של יורם" })).toBeVisible();
    await expect(page.locator(".kpis")).toHaveCount(0);
    for (const chip of await page.getByRole("navigation", { name: "סינון הביקורים" }).getByRole("link").all()) {
      await expect(chip).not.toHaveText(/\d/);
    }
    await page.getByRole("link", { name: /חזרה למדדי הטכנאי/ }).click();
    await expect(page).not.toHaveURL(/view=reports/);
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("76");
  });

  test("Products: supplier card first, no date controls, \"תקלה נפוצה\" unavailable, test badges", async ({ page }) => {
    await openPage(page, `${DASH}?tab=prod`);
    const supplier = page.getByRole("heading", { name: "קריאות לפי ספק" });
    const brand = page.getByRole("heading", { name: "קריאות לפי מותג" });
    const order = await supplier.evaluate((a, b) => Boolean(a.compareDocumentPosition(b as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await brand.elementHandle());
    expect(order).toBe(true);
    await expect(page.locator('input[type="date"], .ma-pill')).toHaveCount(0);
    const table = page.getByRole("table", { name: "מק״טים עם הכי הרבה קריאות" });
    const issues = table.locator("tbody tr td:nth-child(8)");
    await expect(issues).toHaveCount(8);
    for (const cell of await issues.all()) await expect(cell).toHaveText("לא זמין");
    await expect(page.locator("main")).not.toContainText("טפטוף");
    await expect(table.locator("tbody td:first-child", { hasText: "MX-410" })).toHaveCount(1);
    await expect(table.locator("tbody td:first-child", { hasText: "TB-75" })).toHaveCount(1);
    await expect(table.locator("tbody tr").first().locator("td").nth(1)).toContainText("🧪");
    for (const cell of await table.locator("tbody td:first-child").all()) await expect(cell).toHaveAttribute("dir", "ltr");
  });
});

test.describe("D57 dashboard: Technicians toolbar (desktop)", () => {
  onlyInProject("desktop");

  test("order at 1440: technicians right, date navigation centre, periods left; previous right of the label", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y`);
    const [tech, date, periods, prev, label, next] = await Promise.all([
      page.locator(".ma-cgroup-tech").boundingBox(),
      page.locator(".ma-cgroup-date").boundingBox(),
      page.locator(".ma-cgroup-period").boundingBox(),
      page.getByRole("link", { name: "התקופה הקודמת" }).boundingBox(),
      periodLabel(page).boundingBox(),
      page.locator(".ma-pnav > :last-child").boundingBox(),
    ]);
    if (!tech || !date || !periods || !prev || !label || !next) throw new Error("toolbar not laid out");
    expect(tech.x).toBeGreaterThan(date.x + date.width);
    expect(date.x).toBeGreaterThan(periods.x + periods.width);
    expect(prev.x).toBeGreaterThan(label.x + label.width - 1);
    expect(next.x + next.width).toBeLessThan(label.x + 1);
  });

  test("date navigation: the previous month and back", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y`);
    await page.getByRole("link", { name: "התקופה הקודמת" }).click();
    await expect(page).toHaveURL(/offset=-1/);
    await expect(periodLabel(page)).toHaveText("ספטמבר 2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("1");
    await expect(dashValue(page, "ביקורים שבוצעו")).toHaveText("1");
    await expect(dashValue(page, "קריאות שנסגרו")).toHaveText("1");
    await expect(dashValue(page, "זמן טיפול ממוצע")).toHaveText("48 דק׳");
    await expect(dashValue(page, "זמן נסיעה ממוצע")).toHaveText("29 דק׳");
    await expect(dashValue(page, "פתרון בביקור ראשון")).toHaveText("100%");
    await expect(dashValue(page, "זמן סגירת קריאה ממוצע")).toHaveText("2.1 ימים");
    await page.getByRole("link", { name: "התקופה הבאה" }).click();
    await expect(periodLabel(page)).toHaveText("אוקטובר 2026");
    await expect(page).not.toHaveURL(/offset=/);
  });

  test("custom range: the form navigates without a full reload", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=s&period=custom`);
    await page.evaluate(() => {
      (window as unknown as { __maMarker: string }).__maMarker = "kept";
    });
    await page.getByLabel("מתאריך").fill("2026-10-01");
    await page.getByLabel("עד תאריך").fill("2026-10-21");
    await page.getByRole("button", { name: "הצג" }).click();
    await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-21/);
    await expect(page.locator(".ma-section .ma-label").first()).toHaveText("1.10.2026 – 21.10.2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("76");
    await expect(dashValue(page, "ביקורים שבוצעו")).toHaveText("73");
    await expect(dashValue(page, "קריאות שנסגרו")).toHaveText("53");
    await expect(dashValue(page, "זמן טיפול ממוצע")).toHaveText("44 דק׳");
    await expect(dashValue(page, "זמן נסיעה ממוצע")).toHaveText("31 דק׳");
    await expect(dashValue(page, "פתרון בביקור ראשון")).toHaveText("69%");
    await expect(dashValue(page, "זמן סגירת קריאה ממוצע")).toHaveText("3.9 ימים");
    expect(await page.evaluate(() => (window as unknown as { __maMarker?: string }).__maMarker)).toBe("kept");
    // שמואל's values equal his full October ones, so they cannot show that the range reached the
    // metrics. יורם's differ: 1–21.10 gives 74 planned (76 for October), 70 done, 52 closed.
    await page.getByRole("group", { name: "טכנאי:" }).getByRole("link", { name: "יורם" }).click();
    await expect(page).toHaveURL(/tech=y/);
    await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-21/);
    await expect(page.locator(".ma-section .ma-label").first()).toHaveText("1.10.2026 – 21.10.2026");
    await expect(dashValue(page, "ביקורים מתוכננים")).toHaveText("74");
    await expect(dashValue(page, "ביקורים שבוצעו")).toHaveText("70");
    await expect(dashValue(page, "קריאות שנסגרו")).toHaveText("52");
  });

  test("switching technician keeps the period", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y&period=week`);
    await page.getByRole("group", { name: "טכנאי:" }).getByRole("link", { name: "אדי" }).click();
    await expect(page).toHaveURL(/tech=e/);
    await expect(page).toHaveURL(/period=week/);
    await expect(periodLabel(page)).toHaveText("18.10–24.10.2026");
    await expect(page.getByRole("group", { name: "טכנאי:" }).getByRole("link", { name: "אדי" })).toHaveAttribute("aria-current", "true");
  });
});

test.describe("D57 dashboard: Technicians toolbar (phone)", () => {
  onlyInProject("phone");

  test("the three groups stack in DOM order; technicians are direct links; no select; no overflow", async ({ page }) => {
    await openPage(page, `${DASH}?tab=tech&tech=y`);
    const [tech, date, periods] = await Promise.all([
      page.locator(".ma-cgroup-tech").boundingBox(),
      page.locator(".ma-cgroup-date").boundingBox(),
      page.locator(".ma-cgroup-period").boundingBox(),
    ]);
    if (!tech || !date || !periods) throw new Error("toolbar not laid out");
    expect(date.y).toBeGreaterThanOrEqual(tech.y + tech.height - 1);
    expect(periods.y).toBeGreaterThanOrEqual(date.y + date.height - 1);
    await expect(page.getByRole("group", { name: "טכנאי:" }).locator("a")).toHaveCount(3);
    await expect(page.locator(".ma-controls select")).toHaveCount(0);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("the chart's visible month labels do not overlap at 6 and 12 months", async ({ page }) => {
    for (const months of [6, 12]) {
      await openPage(page, `${DASH}${months === 12 ? "?months=12" : ""}`);
      const boxes = await page.locator(".ma-mlabel").evaluateAll((els) =>
        els.filter((el) => getComputedStyle(el).visibility !== "hidden").map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })),
      );
      expect(boxes.length, String(months)).toBeGreaterThan(0);
      const sorted = boxes.sort((a, b) => a.left - b.left);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.left, `${months} months, label ${i}`).toBeGreaterThanOrEqual(sorted[i - 1]!.right);
    }
  });
});

test.describe("D57 dashboard: details dialog", () => {
  onlyInProject("desktop");

  test("a tile opens an accessible dialog: focus inside, trapped, Escape / ✕ / backdrop close, focus returns", async ({ page }) => {
    await openPage(page, DASH);
    const tile = page.locator('[data-detail-key="today.missed"]');
    await tile.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleName("לא בוצעו במועד · 21.10.2026");
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await expect(dialogRows(page)).toHaveCount(3);
    await expect(dialogRows(page).locator("td:first-child")).toHaveText(["48213", "48219", "48226"]);
    for (const row of await dialogRows(page).all()) {
      await expect(row).toContainText(/נקלט אוטומטית מזימון Outlook|זימון בדיקה/);
      await expect(row).toContainText("🧪");
    }
    // Tab and Shift+Tab stay inside.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/detail=/);
    await expect(tile).toBeFocused();

    await tile.click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("link", { name: "סגירה" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/detail=/);

    // A press that starts inside the panel and ends on the backdrop keeps it open; a click on the backdrop closes it.
    await tile.click();
    await expect(dialog(page)).toBeVisible();
    const panel = await dialog(page).boundingBox();
    if (!panel) throw new Error("no dialog box");
    await page.mouse.move(panel.x + panel.width / 2, panel.y + 20);
    await page.mouse.down();
    await page.mouse.move(panel.x + panel.width / 2, Math.max(2, panel.y - 30), { steps: 4 });
    await page.mouse.up();
    await expect(dialog(page)).toBeVisible();
    await page.mouse.click(panel.x + panel.width / 2, Math.max(2, panel.y - 30));
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a direct load opens the dialog with focus inside", async ({ page }) => {
    await openPage(page, `${DASH}?detail=today.planned`);
    await expect(dialog(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await expect(dialogRows(page)).toHaveCount(11);
  });

  test("a supplier's 108 calls over 3 pages; focus stays inside after paging and returns to the row", async ({ page }) => {
    await openPage(page, `${DASH}?tab=prod`);
    const row = page.locator('[data-detail-key="prod.bySupplier|מ.ס. יבוא"]');
    await row.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("מציג 1–50 מתוך 108 קריאות");
    await expect(dialogRows(page)).toHaveCount(50);
    await dialog(page).getByRole("link", { name: "הבא ‹" }).click();
    await expect(page).toHaveURL(/dpage=2/);
    await expect(dialog(page)).toContainText("מציג 51–100 מתוך 108 קריאות");
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await dialog(page).getByRole("link", { name: "הבא ‹" }).click();
    await expect(dialogRows(page)).toHaveCount(8);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test("the chart table's September \"נפתחו\" opens 28 calls", async ({ page }) => {
    await openPage(page, DASH);
    await page.locator(".ma-details > summary").click();
    await page.locator('[data-detail-key="trend.opened|2026-09"]').click();
    await expect(dialog(page)).toHaveAccessibleName("קריאות שנפתחו · ספטמבר 2026");
    await expect(dialogRows(page)).toHaveCount(28);
  });

  test("\"% המשך טיפול\" and \"נדרש המשך טיפול\" agree; the current status stays closed (D57 (5))", async ({ page }) => {
    await openPage(page, `${DASH}?tab=prod&detail=prod.skuCalls&group=KT-1800`);
    await expect(dialogRows(page)).toHaveCount(21);
    const header = await dialog(page).locator("thead th").allTextContents();
    const col = header.indexOf("נדרש המשך טיפול");
    expect(col).toBeGreaterThan(0);
    const yes = dialogRows(page).filter({ has: page.locator(`td:nth-child(${col + 1}):text-is("כן")`) });
    await expect(yes).toHaveCount(4);
    expect((await yes.locator("td:first-child").allTextContents()).sort()).toEqual(["47877", "47881", "47882", "47925"]);
    for (const req of ["47881", "47882"]) {
      await expect(dialogRows(page).filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${req}$`) }) })).toContainText("טופלה");
    }
    for (const cell of await dialog(page).locator("tbody td[dir=ltr]").all()) await expect(cell).toHaveText("KT-1800");
  });

  test("no dialog for pending, unavailable, unknown or off-tab keys, or an unknown group", async ({ page }) => {
    for (const q of [
      "?tab=tech&detail=tech.planAdherence",
      "?tab=prod&detail=prod.topIssue",
      "?detail=bogus",
      "?detail=tech.done",
      "?tab=prod&detail=prod.skuCalls&group=BOGUS",
      "?detail=trend.opened&group=2020-01",
    ]) {
      await openPage(page, `${DASH}${q}`);
      await expect(page.locator(".ma-kpis, .ma-two").first(), q).toBeVisible();
      await expect(dialog(page), q).toHaveCount(0);
    }
  });
});

test.describe("D57 dashboard: what customer service receives (raw responses)", () => {
  onlyInProject("desktop");

  test("no dashboard data and no dialog for a role without a dashboard tab", async ({ page }) => {
    for (const path of [
      "/dev/demo/office/cs/analytics?detail=today.planned",
      "/dev/demo/office/cs/analytics?tab=prod&detail=prod.skuCalls&group=KT-2041",
      "/dev/demo/office/cs/analytics?tab=tech&tech=y&view=reports",
    ]) {
      const body = await (await page.request.get(path)).text();
      expect(body, path).toContain("אין הרשאה");
      // The request URL itself is echoed in the payload, so the SKU's product name stands for it.
      for (const text of ["48213", "48240", "ברז מטבח נשלף", "ma-dialog", "ma-kpis", "ma-controls"]) expect(body, `${path}: ${text}`).not.toContain(text);
    }
  });

  test("the analytics route of a non-office role is 404", async ({ request }) => {
    expect((await request.get("/dev/demo/office/tech/analytics")).status()).toBe(404);
  });
});

test.describe("D57 dashboard: loading and error", () => {
  onlyInProject("desktop");

  for (const width of [390, 820]) {
    test(`no layout shift at ${width}px: the skeleton renders inside the unchanged frame`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, "/dev/demo/office/mgr/calls");
      // The sidebar link prefetches the dashboard's loading state; wait for it, then slow the page.
      await page.waitForResponse((r) => r.url().includes("/analytics") && r.request().headers()["next-router-prefetch"] !== undefined, {
        timeout: 10_000,
      }).catch(() => undefined);
      await page.waitForLoadState("networkidle");
      const frame = () =>
        page.evaluate(() => ({
          top: Math.round(document.querySelector("main.work")?.getBoundingClientRect().top ?? -1),
          side: Math.round(document.querySelector(".side")?.getBoundingClientRect().height ?? -1),
          links: document.querySelectorAll(".side .nav a").length,
        }));
      const before = await frame();
      await page.route(/\/analytics/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.locator(".side").getByRole("link", { name: "דשבורד" }).click();
      // The loading text is a status outside the busy region (announced); the placeholders are busy.
      const skeleton = page.locator('[aria-busy="true"]');
      await expect(skeleton).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "טוען את הדשבורד…" })).toBeVisible();
      await expect(skeleton.getByRole("status")).toHaveCount(0);
      const during = await frame();
      // The skeleton mirrors the page's blocks: the first tile does not move when the data arrives.
      const top = (selector: string) => page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
      const skeletonTile = await top(".ma-skel .ma-skel-kpis .kpi");
      await expect(page.locator(".ma-dash .ma-kpis").first()).toBeVisible({ timeout: 10_000 });
      await expect(skeleton).toHaveCount(0);
      const after = await frame();
      expect(Math.abs((await top(".ma-dash .ma-kpis .kpi")) - skeletonTile)).toBeLessThanOrEqual(2);
      for (const [a, b] of [
        [before, during],
        [during, after],
      ] as const) {
        expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.side - b.side)).toBeLessThanOrEqual(1);
      }
      expect([before.links, during.links, after.links]).toEqual([5, 5, 5]);
    });
  }

  test("error.tsx: retry() and a link without search params; never the error's message or digest", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/dev/demo/office/[role]/analytics/error.tsx", "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("retry()");
    expect(source).toContain("useParams");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("digest");
    // The frame comes from the segment layout; the page and the loading state never draw a second one.
    expect(readFileSync("app/dev/demo/office/[role]/analytics/layout.tsx", "utf8")).toContain("DemoOfficeFrame");
    expect(readFileSync("app/dev/demo/office/[role]/analytics/page.tsx", "utf8")).not.toContain("DemoOfficeFrame");
    expect(readFileSync("app/dev/demo/office/[role]/analytics/loading.tsx", "utf8")).not.toContain("DemoOfficeFrame");
  });

  test("exactly one sidebar on every analytics view", async ({ page }) => {
    for (const q of ["", "?tab=tech&tech=y&view=reports", "?tab=prod&detail=prod.bySupplier&group=__none__"]) {
      await openPage(page, `${DASH}${q}`);
      await expect(page.locator(".side"), q).toHaveCount(1);
    }
    await openPage(page, "/dev/demo/office/cs/analytics");
    await expect(page.locator(".side")).toHaveCount(1);
  });
});

test.describe("D57 dashboard: accessibility and layout details (review fixes)", () => {
  test("SKU bars show the product name wherever the dashboard is at least 600px wide (tablet included)", async ({ page }) => {
    await openPage(page, DASH);
    const name = page.locator(".ma-bars-sku .ma-bar-pname").first();
    if (page.viewportSize()!.width >= 820) await expect(name).toBeVisible();
    else await expect(name).toBeHidden();
  });

  test("no two landmarks share a name; tile groups keep theirs", async ({ page }) => {
    for (const q of ["", "?tab=tech&tech=y", "?tab=prod"]) {
      await openPage(page, `${DASH}${q}`);
      await expect(page.locator(".ma-dash section").first()).toBeVisible();
      const names = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main section[aria-label], main section[aria-labelledby], main [role='region']")].map((el) => {
          const by = el.getAttribute("aria-labelledby");
          return (by ? (document.getElementById(by)?.textContent ?? "") : (el.getAttribute("aria-label") ?? "")).trim();
        }),
      );
      expect(names.length, q).toBeGreaterThan(0);
      expect(new Set(names).size, `${q}: ${names.join(" | ")}`).toBe(names.length);
    }
    await openPage(page, DASH);
    await expect(page.getByRole("region", { name: "פעילות היום" })).toHaveCount(1);
  });

  test("a ranked bar's link is named by its own visible text (WCAG 2.5.3)", async ({ page }) => {
    await openPage(page, DASH);
    const link = page.getByRole("list", { name: "3 ספקים מובילים" }).getByRole("link").first();
    await expect(link).not.toHaveAttribute("aria-label", /./);
    await expect(link).toHaveAccessibleName(/^מ\.ס\. יבוא\s*:\s*106 קריאות · פירוט$/);
  });

  test("dashboard tiles: no arrow glyph; the percent sign in the small unit style", async ({ page }) => {
    await openPage(page, DASH);
    await expect(page.locator(".ma-kpis .od-kpi-go").first()).toBeHidden();
    const first = dashTile(page, "פתרון בביקור ראשון");
    await expect(first.locator(".v")).toHaveText("71%");
    await expect(first.locator(".kpi-pct")).toHaveCSS("font-size", "12px");
  });

  test("the SKU table: headers on one line; the SKU column stays in view while the table scrolls sideways", async ({ page }) => {
    await openPage(page, `${DASH}?tab=prod`);
    const table = page.getByRole("table", { name: "מק״טים עם הכי הרבה קריאות" });
    await expect(table.locator("thead th")).toHaveCount(8);
    for (const th of await table.locator("thead th").all()) await expect(th).toHaveCSS("white-space", "nowrap");
    const heights = await table.locator("thead th").evaluateAll((ths) => ths.map((th) => Math.round(th.getBoundingClientRect().height)));
    expect(new Set(heights).size, heights.join(",")).toBe(1);
    await expect(table.locator("tbody td").first()).toHaveCSS("position", "sticky");
    const scroller = page.getByRole("region", { name: "טבלת המק״טים" });
    const scrolls = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (scrolls) {
      // RTL: scrolling towards the later columns is a negative scrollLeft.
      await scroller.evaluate((el) => {
        el.scrollLeft = -el.scrollWidth;
      });
      const [box, cell] = await Promise.all([scroller.boundingBox(), table.locator("tbody td").first().boundingBox()]);
      expect(box && cell && cell.x + cell.width).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0) - 3);
    }
  });

  test("closing a dialog opened from a chart bar returns focus to the chart table's summary, not to <body>", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "runs in the desktop project only");
    await openPage(page, DASH);
    await page.locator('a.ma-ghalf-o[href*="group=2026-09"]').click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".ma-details > summary")).toBeFocused();
  });
});
