import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, submitSignIn } from "./helpers";
import { originOf, SIMULATOR_OFF_PORT, SIMULATOR_PRODUCTION_PORT } from "./servers";

// "זימונים שלא נקלטו" and the Outlook invitation simulator (QA S-05; D24, D47, D57 (1), D60 (4),
// (11)) against the LOCAL Supabase stack (tests/auth/run-local.mjs; never the remote project).
// Fictional, test-marked accounts and data only: every invitation is sent through the real screen
// and the real server action, so the single ingestion service and the database write it (D47).
// Sign-ins are few (the local Auth allows 30 per 5 minutes per IP): one context per role, reused.
//   node tests/auth/run-local.mjs [--with-creator] tests/auth/office-unparsed.spec.ts

const nav = (page: Page) => page.getByRole("navigation", { name: "ניווט ראשי" });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Outlook · זימון בדיקה (סימולטור)" });
const listOf = (page: Page) => page.getByRole("list", { name: "זימונים שלא נקלטו" });
const sql = (query: string) => localSqlValue(query);
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

/** A fresh context signed in as `user` on `origin` (the office start). */
async function signedIn(browser: Browser, user: SeededUser, origin = originOf(3120)): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: origin, locale: "he-IL", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  // Customer Service lands on "קריאות" (/office/calls), the other office roles on /office.
  await expect(page).toHaveURL(/\/office(\/calls)?$/);
  return { context, page };
}

/** The Outlook address of a seeded technician row. */
const outlookOf = (row: string | undefined) => sql(`select outlook_email from public.technicians where id = ${text(row ?? "")}`);

/** The request number in the dialog's body. */
async function requestNumberIn(dialog: Locator): Promise<string> {
  const body = await dialog.getByLabel("גוף הזימון (לפי התבנית)").inputValue();
  const m = /^מספר פנייה: (\S+)$/m.exec(body);
  if (!m?.[1]) throw new Error("no request number in the sample");
  return m[1];
}

async function openSimulator(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "סימולטור זימונים" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

const action = (dialog: Locator, name: string) => dialog.getByRole("group", { name: "פעולה" }).getByText(name, { exact: true });
const send = (dialog: Locator) => dialog.getByRole("button", { name: "שליחה" }).click();
const result = (dialog: Locator) => dialog.getByRole("status");

test.describe.serial("זימונים שלא נקלטו and the invitation simulator (local stack)", () => {
  let cs: { context: BrowserContext; page: Page };
  let mgr: { context: BrowserContext; page: Page };

  test.beforeAll(async ({ browser }) => {
    const users = seeded();
    cs = await signedIn(browser, users.cs);
    mgr = await signedIn(browser, users.mgr);
  });

  test.afterAll(async () => {
    await cs?.context.close();
    await mgr?.context.close();
  });

  test("Customer Service: the navigation of D60 (4) built so far; the screen and its simulator button", async () => {
    const { page } = cs;
    await expect(nav(page).getByRole("link")).toHaveText(["קריאות", "זימונים שלא נקלטו"]);
    await nav(page).getByRole("link", { name: "זימונים שלא נקלטו" }).click();
    await expect(page).toHaveURL(/\/office\/unparsed$/);
    await expect(nav(page).getByRole("link", { name: "זימונים שלא נקלטו" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "זימונים שלא נקלטו" })).toBeVisible();
    await expect(page.locator("#unparsed-list-h > bdi")).toHaveText("ממתינים לתיקון ב-Outlook");
    await expect(page.getByRole("button", { name: "סימולטור זימונים" })).toBeVisible();
    // No demo frame or demo record on a real route (D61).
    await expect(page.locator(".demo-strip, [data-demo]")).toHaveCount(0);
    expect(await page.content()).not.toContain("FIXTURE-SENTINEL");
  });

  test("Customer Service: a valid invitation is ingested once; the same invitation again duplicates nothing", async () => {
    const { page } = cs;
    const attendee = outlookOf(process.env.AUTH_E2E_TECH_ROW);
    const dialog = await openSimulator(page);
    await dialog.getByLabel("אל", { exact: true }).selectOption(attendee);
    const req = await requestNumberIn(dialog);
    await send(dialog);
    await expect(result(dialog)).toContainText(`הזימון נקלט · מס׳ פנייה ${req} · ביקור 1`);
    await expect(result(dialog)).toContainText("נשמר כנתוני בדיקה (🧪 זימון בדיקה). לא נשלח מייל.");
    // Persisted like real data, marked as test data (D47, SIM-07, SIM-08).
    expect(sql(`select count(*) || ':' || bool_and(is_test) || ':' || min(data_source) from public.service_calls where request_number = ${text(req)}`)).toBe("1:true:simulator");
    expect(sql(`select count(*) from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = ${text(req)}`)).toBe("1");

    // The same event, unchanged (same change key): a replay that changes nothing (SIM-05).
    await action(dialog, "שליחה כפולה").click();
    await expect(dialog.getByLabel("זימון קיים")).not.toHaveValue("");
    await send(dialog);
    await expect(result(dialog)).toContainText("זו שליחה כפולה, ולא נוצר ולא השתנה דבר");
    expect(sql(`select count(*) from public.service_calls where request_number = ${text(req)}`)).toBe("1");
    expect(sql(`select count(*) from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = ${text(req)}`)).toBe("1");
    expect(
      sql(`select count(*) from public.calendar_event_changes ch join public.external_calendar_events e on e.id = ch.calendar_event_id
           join public.service_calls c on c.id = e.service_call_id where c.request_number = ${text(req)}`),
    ).toBe("1");
    await dialog.getByRole("button", { name: "סגירה", exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
  });

  test("Manager: an invalid invitation appears on the list with its structured reasons (S-05)", async () => {
    const { page } = mgr;
    await expect(nav(page).getByRole("link")).toHaveText(["דשבורד", "קריאות", "זימונים שלא נקלטו", "הגדרות"]);
    await page.goto("/office/unparsed");
    const dialog = await openSimulator(page);
    await dialog.getByRole("button", { name: "זימון עם שדות חסרים" }).click();
    await expect(action(dialog, "זימון שגוי").locator("input")).toBeChecked();
    await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env.AUTH_E2E_TECH_ROW));
    const req = await requestNumberIn(dialog);
    await send(dialog);
    await expect(result(dialog)).toContainText("הזימון לא נקלט. הוא מופיע ברשימה עם מה שצריך לתקן");
    const reasons = dialog.getByRole("list", { name: "מה לתקן בזימון" });
    await expect(reasons).toContainText("מספר לקוח");
    await expect(reasons).toContainText("טלפון");
    await expect(reasons).toContainText("באחריות");
    // Nothing was created (not ingested), one open unparsed row (D47 test-marked).
    expect(sql(`select count(*) from public.service_calls where request_number = ${text(req)}`)).toBe("0");
    expect(sql(`select count(*) || ':' || bool_and(is_test) from public.calendar_ingestion_errors where request_number = ${text(req)} and status = 'open'`)).toBe("1:true");

    // A valid body for an address that is no technician's: the database's lookup gives the reason.
    await dialog.getByRole("button", { name: "לקוח חדש" }).click();
    await expect(action(dialog, "זימון חדש").locator("input")).toBeChecked();
    await dialog.getByLabel("אל", { exact: true }).selectOption({ label: "כתובת אחרת…" });
    await dialog.getByLabel("כתובת המשתתף").fill("nobody-office@example.test");
    const req2 = await requestNumberIn(dialog);
    await send(dialog);
    await expect(result(dialog)).toContainText("הזימון לא נקלט");
    await expect(dialog.getByRole("list", { name: "מה לתקן בזימון" })).toContainText("טכנאי לא זוהה");
    expect(sql(`select count(*) from public.service_calls where request_number = ${text(req2)}`)).toBe("0");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // The list (refreshed behind the dialog): the rows, newest first, with every reason.
    const row = listOf(page).locator(":scope > li").filter({ hasText: `מס׳ פנייה ${req}` });
    await expect(row).toHaveCount(1);
    await expect(listOf(page).locator(":scope > li").first()).toContainText(`מס׳ פנייה ${req2}`);
    await expect(row).toContainText("🧪 זימון בדיקה");
    await expect(row).toContainText("מייל לנציגה: לא נשלח");
    await expect(row.getByText("חסר שדה חובה").first()).toBeVisible();
    await expect(row).toContainText("מספר לקוח");
    await expect(row).toContainText("ערך לא תקין");
    await expect(row).toContainText("צריך להיות: כן / לא / כן · עד MM/YYYY");
    const row2 = listOf(page).locator(":scope > li").filter({ hasText: `מס׳ פנייה ${req2}` });
    await expect(row2).toContainText("טכנאי לא זוהה");
    await expect(row2).toContainText("לא תואמת למייל ה-Outlook של טכנאי במערכת");
    await expect(row2).toContainText("nobody-office@example.test");
    await expect(page.locator(".test-banner")).toContainText("נתוני בדיקה");
    // One short info box (design-rules.md); the rest is quiet help text.
    await expect(page.locator("main .ib-note")).toHaveCount(1);
    await expect(page.locator("main .ib-note > p")).toHaveCount(1);
    await expect(page.locator("main .ib-note")).not.toContainText("מק״ט");
  });

  test("Manager: update, reschedule, re-assign and cancel one simulated invitation (SIM-03, SIM-04)", async () => {
    const { page } = mgr;
    await page.goto("/office/unparsed");
    const dialog = await openSimulator(page);
    await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env.AUTH_E2E_TECH_ROW));
    const req = await requestNumberIn(dialog);
    await send(dialog);
    await expect(result(dialog)).toContainText(`מס׳ פנייה ${req} · ביקור 1`);
    const visit = (column: string) =>
      sql(`select v.${column} from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = ${text(req)}`);

    // Reschedule: the same visit moves (no second visit).
    await action(dialog, "שינוי מועד").click();
    await dialog.getByLabel("שעת התחלה").fill("13:00");
    await dialog.getByLabel("שעת סיום").fill("14:30");
    await send(dialog);
    await expect(result(dialog)).toContainText("הזימון נקלט");
    expect(sql(`select to_char(v.scheduled_start at time zone 'Asia/Jerusalem', 'HH24:MI') from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = ${text(req)}`)).toBe("13:00");

    // Re-assign to the second technician.
    await action(dialog, "החלפת טכנאי").click();
    await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env.AUTH_E2E_TECH2_ROW));
    await send(dialog);
    await expect(result(dialog)).toContainText("הזימון נקלט");
    expect(visit("technician_id")).toBe(process.env.AUTH_E2E_TECH2_ROW);
    expect(sql(`select count(*) from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = ${text(req)}`)).toBe("1");

    // Cancel: the open visit is not cancelled automatically; a review item (open decision 5, D39).
    await action(dialog, "ביטול זימון").click();
    await expect(dialog.getByLabel("גוף הזימון (לפי התבנית)")).toHaveCount(0);
    await send(dialog);
    await expect(result(dialog)).toContainText("הביטול התקבל ועבר לבדיקה");
    expect(visit("status")).toBe("scheduled");
    // The cancelled invitation can only be sent again as a duplicate.
    await action(dialog, "עדכון זימון").click();
    await send(dialog);
    await expect(dialog.getByText("הזימון הזה בוטל: אפשר רק לשלוח שוב את הביטול")).toBeVisible();
  });

  test("Manager: the form's own errors; nothing is sent", async () => {
    const { page } = mgr;
    await page.goto("/office/unparsed");
    const before = sql("select count(*) from public.calendar_event_changes");
    const dialog = await openSimulator(page);
    // A fresh page remembers no invitation: an update has nothing to update.
    await action(dialog, "עדכון זימון").click();
    await send(dialog);
    await expect(dialog.getByRole("alert")).toHaveText("יש שדות לתקן לפני השליחה.");
    await expect(dialog.getByText("בחרו זימון ששלחתם מהסימולטור")).toBeVisible();
    await expect(dialog.getByLabel("זימון קיים")).toHaveAttribute("aria-invalid", "true");
    // A new invitation without a subject or a valid time.
    await action(dialog, "זימון חדש").click();
    await dialog.getByLabel("נושא", { exact: true }).fill("");
    await dialog.getByLabel("שעת התחלה").fill("9");
    await send(dialog);
    await expect(dialog.getByText("צריך נושא לזימון")).toBeVisible();
    await expect(dialog.getByText("שעה בפורמט 09:00")).toBeVisible();
    await expect(dialog.getByLabel("נושא", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(sql("select count(*) from public.calendar_event_changes")).toBe(before);
  });

  test("Technician: no office screen and no simulator (server-side denial)", async ({ browser }) => {
    const users = seeded();
    const context = await browser.newContext({ locale: "he-IL" });
    const page = await context.newPage();
    await submitSignIn(page, users.tech.email, users.tech.password);
    await expect(page).toHaveURL(/\/tech$/);
    await page.goto("/office/unparsed");
    await expect(page).toHaveURL(/\/login\?state=no-access$/);
    await expect(page.getByRole("button", { name: "סימולטור זימונים" })).toHaveCount(0);
    await context.close();
  });

  for (const [label, port] of [
    ["switched off", SIMULATOR_OFF_PORT],
    ["on Vercel Production (switch on)", SIMULATOR_PRODUCTION_PORT],
  ] as const) {
    test(`the simulator is absent when ${label} (SIM-11); the list still works`, async ({ browser }) => {
      const users = seeded();
      const { context, page } = await signedIn(browser, users.mgr, originOf(port));
      await page.goto("/office/unparsed");
      await expect(page.getByRole("heading", { level: 1, name: "זימונים שלא נקלטו" })).toBeVisible();
      await expect(listOf(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "סימולטור זימונים" })).toHaveCount(0);
      const html = await page.content();
      expect(html).not.toContain("סימולטור זימונים");
      expect(html).not.toContain("Outlook · זימון בדיקה");
      await context.close();
    });
  }

  test("anonymous: /office/unparsed goes to /login", async ({ browser }) => {
    const context = await browser.newContext({ locale: "he-IL" });
    const page = await context.newPage();
    await page.goto("/office/unparsed");
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });
});

test.describe("זימונים שלא נקלטו for the Creator (local stack)", () => {
  test.skip(!creator(), "needs the local Creator: node tests/auth/run-local.mjs --with-creator (Step 2 plan Q6)");

  test("Creator: the navigation of D57 (1) built so far, the list and the simulator", async ({ browser }) => {
    const c = creator()!;
    const { context, page } = await signedIn(browser, c);
    await expect(nav(page).getByRole("link")).toHaveText(["דשבורד", "קריאות", "זימונים שלא נקלטו", "הגדרות"]);
    await nav(page).getByRole("link", { name: "זימונים שלא נקלטו" }).click();
    await expect(listOf(page).locator(":scope > li").first()).toBeVisible();
    const dialog = await openSimulator(page);
    await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(process.env.AUTH_E2E_TECH_ROW));
    const req = await requestNumberIn(dialog);
    await send(dialog);
    await expect(result(dialog)).toContainText(`מס׳ פנייה ${req} · ביקור 1`);
    await context.close();
  });
});
