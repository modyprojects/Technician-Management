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
