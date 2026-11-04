import { expect, test, type Page } from "@playwright/test";
import { DEMO_PAGES, FIXTURE_SENTINEL, horizontalOverflow, openPage } from "./helpers";

// UI demo with fictional data (D53, /dev/demo). Runs in the phone (390), tablet (820) and desktop
// (1440) projects unless a block says otherwise. Every action in the demo is simulated: the tests
// check that it says so ("פעולה מדומה · לא נשמר") and that nothing claims a save or an email.

const SIMULATED = "פעולה מדומה · לא נשמר";

/** Views that live behind query strings (tabs, drill-down, filters), on top of DEMO_PAGES. */
const DEMO_VIEWS = [
  "/dev/demo/office/mgr/analytics?tab=tech",
  "/dev/demo/office/mgr/analytics?tab=prod",
  "/dev/demo/office/mgr/analytics?tab=tech&tech=y",
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
      expect(await horizontalOverflow(page)).toEqual([]);
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
    await expect(page.locator(".side .nav button")).toHaveCount(0);
    await page.locator(".side").getByRole("link", { name: "יומן טכנאים" }).click();
    await expect(page).toHaveURL(/\/dev\/demo\/office\/mgr\/calendar$/);
    await expect(page.locator(".side").getByRole("link", { name: "יומן טכנאים" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("dashboards and access", () => {
  test("manager home: KPI tiles, test-data note, awaiting call listed, technician drill-down links", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr");
    const kpis = page.getByRole("region", { name: "מדדי היום" });
    await expect(kpis.locator(".kpi")).toHaveCount(6);
    await expect(page.locator(".od-test-note")).toContainText("נתוני בדיקה");
    // The awaiting-scheduling call is never hidden behind older follow-ups (sorted first).
    await expect(page.getByRole("table", { name: "קריאות שדורשות טיפול" })).toContainText("48230");
    await expect(page.locator('a[href*="/analytics?tab=tech&tech="]').first()).toBeVisible();
  });

  test("customer-service home: work queue with test-data note, no dashboard links", async ({ page }) => {
    await openPage(page, "/dev/demo/office/cs");
    await expect(page.locator(".od-test-note")).toContainText("נתוני בדיקה");
    await expect(page.getByRole("table", { name: "קריאות שממתינות לשיבוץ" })).toContainText("48230");
    await expect(page.locator('a[href*="/analytics"]')).toHaveCount(0);
  });

  test("manager analytics: tabs, KPI tiles, test-data note and the technician drill-down", async ({ page }) => {
    await openPage(page, "/dev/demo/office/mgr/analytics");
    await expect(page.getByRole("navigation", { name: "לשוניות הדשבורד" }).getByRole("link")).toHaveCount(3);
    await expect(page.locator(".kpis .kpi").first()).toBeVisible();
    expect(await page.locator(".kpis .kpi").count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".od-test-note")).toContainText("נתוני בדיקה");

    await page.getByRole("navigation", { name: "לשוניות הדשבורד" }).getByRole("link", { name: "טכנאים" }).click();
    await expect(page).toHaveURL(/tab=tech/);
    await page.getByRole("link", { name: /פירוט הטכנאי/ }).first().click();
    await expect(page).toHaveURL(/tech=/);
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
    await expect(page.getByText(/🔒 הביקור נשלח/)).toBeVisible();
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
