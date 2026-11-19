import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, submitSignIn } from "./helpers";

// "קריאות" on real data (V1 item 4; D38, D60 (1), (3), (4); QA S-01, S-03, X-01, X-02) against the
// LOCAL Supabase stack (tests/auth/run-local.mjs; never the remote project). The calls are made
// through the real simulator dialog on "זימונים שלא נקלטו" and the real server action, so the single
// ingestion service writes them (fictional, test-marked, D47). Few sign-ins (30 per 5 minutes).
//   node tests/auth/run-local.mjs [--with-creator] tests/auth/office-calls-list.spec.ts

const nav = (page: Page) => page.getByRole("navigation", { name: "ניווט ראשי" });
const table = (page: Page) => page.getByRole("table", { name: "קריאות שירות" });
const rows = (page: Page) => table(page).locator("tbody tr");
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;
const run = Math.random().toString(16).slice(2, 8);

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

async function signedIn(browser: Browser, user: SeededUser, home: RegExp): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return { context, page };
}

const outlookOf = (row: string | undefined) => localSqlValue(`select outlook_email from public.technicians where id = ${text(row ?? "")}`);

/** Sends one invitation through the simulator dialog; returns its request number. */
async function sendInvitation(page: Page, o: { techRow: string | undefined; req?: string; customer: string; city: string }): Promise<string> {
  await page.goto("/office/unparsed");
  await page.getByRole("button", { name: "סימולטור זימונים" }).click();
  const dialog = page.getByRole("dialog", { name: "Outlook · זימון בדיקה (סימולטור)" });
  await dialog.getByRole("button", { name: "לקוח חדש" }).click();
  await dialog.getByLabel("אל", { exact: true }).selectOption(outlookOf(o.techRow));
  const body = dialog.getByLabel("גוף הזימון (לפי התבנית)");
  let value = await body.inputValue();
  if (o.req) value = value.replace(/^מספר פנייה: .*$/m, `מספר פנייה: ${o.req}`).replace(/^מספר משימה: .*$/m, "מספר משימה: 2");
  value = value.replace(/^שם לקוח: .*$/m, `שם לקוח: ${o.customer}`).replace(/^עיר: .*$/m, `עיר: ${o.city}`);
  await body.fill(value);
  const req = /^מספר פנייה: (\S+)$/m.exec(value)?.[1] ?? "";
  await dialog.getByRole("button", { name: "שליחה" }).click();
  await expect(dialog.getByRole("status")).toContainText("הזימון נקלט");
  await page.keyboard.press("Escape");
  return req;
}

test.describe.serial("קריאות on real data (local stack)", () => {
  let cs: { context: BrowserContext; page: Page };
  let a = "";
  let b = "";
  const customerA = `לקוחה א ${run}`;
  const customerB = `לקוח ב ${run}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    cs = await signedIn(browser, seeded().cs, /\/office\/calls$/);
    a = await sendInvitation(cs.page, { techRow: process.env.AUTH_E2E_TECH_ROW, customer: customerA, city: "רחובות" });
    b = await sendInvitation(cs.page, { techRow: process.env.AUTH_E2E_TECH2_ROW, customer: customerB, city: "חולון" });
    // A second invitation with A's request number: visit 2 of the same call (X-03), no new call.
    await sendInvitation(cs.page, { techRow: process.env.AUTH_E2E_TECH_ROW, req: a, customer: customerA, city: "רחובות" });
  });

  test.afterAll(async () => {
    await cs?.context.close();
  });

  test("Customer Service lands on \"קריאות\" (S-01); the list, its counts and the 🧪 marker on real rows", async () => {
    const { page } = cs;
    await page.goto("/office");
    await expect(page).toHaveURL(/\/office\/calls$/);
    await expect(page.getByRole("heading", { level: 1, name: "קריאות" })).toBeVisible();
    await expect(nav(page).getByRole("link")).toHaveText(["קריאות", "זימונים שלא נקלטו"]);
    await expect(nav(page).getByRole("link", { name: "קריאות" })).toHaveAttribute("aria-current", "page");
    // D60 (3): "מס׳ פנייה".
    await expect(table(page).getByRole("columnheader", { name: "מס׳ פנייה" })).toBeVisible();
    // The chips count every call the viewer may see, by the database.
    const open = localSqlValue("select count(*) from public.service_calls where status = 'open'");
    const all = localSqlValue("select count(*) from public.service_calls");
    const chips = page.getByRole("group", { name: "סינון לפי סטטוס קריאה" });
    await expect(chips.getByRole("button", { name: `הכל ${all}` })).toBeVisible();
    await expect(chips.getByRole("button", { name: `פתוחה ${open}` })).toBeVisible();
    await expect(page.locator(".test-banner")).toContainText("נתוני בדיקה");
    // Newest first: B (scheduled at the same time, opened later) or A's visit 2 is at the top.
    const rowA = rows(page).filter({ hasText: customerA });
    await expect(rowA).toHaveCount(1);
    await expect(rowA.getByRole("link", { name: `מס׳ פנייה ${a} · ${customerA}` })).toBeVisible();
    // Two visits of one call; the source and the test marker (SIM-14, SIM-15, D47).
    await expect(rowA.locator("td").nth(7)).toHaveText("2");
    // The test marker reads "בדיקה" (D74): exactly one per row, on the call (not repeated on its visit's source).
    await expect(rowA.locator("td").first()).toContainText("בדיקה");
    await expect(rowA.locator("td").nth(8)).not.toContainText("בדיקה");
    await expect(rowA.getByText("נתוני בדיקה")).toHaveCount(1);
    await expect(rowA.locator(".test-mark")).toHaveCount(1);
    await expect(rowA).toContainText("פתוחה");
    await expect(rowA).toContainText("טכנאי בדיקה");
  });

  test("search, technician and status filters live in the URL and narrow the rows", async () => {
    const { page } = cs;
    await page.getByRole("searchbox", { name: "חיפוש קריאות" }).fill(b);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${b}(&|$)`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(customerB);
    await expect(rows(page).first()).toContainText("טכנאי שני בדיקה");
    // A search that matches nothing.
    await page.getByRole("searchbox", { name: "חיפוש קריאות" }).fill(`nothing-${run}`);
    await expect(page.getByText("לא נמצאו קריאות")).toBeVisible();
    await page.getByRole("searchbox", { name: "חיפוש קריאות" }).fill(run);
    await expect(rows(page)).toHaveCount(2);
    // The latest visit's technician.
    await page.getByRole("combobox", { name: "סינון לפי טכנאי" }).selectOption(process.env.AUTH_E2E_TECH2_ROW ?? "");
    await expect(page).toHaveURL(new RegExp(`[?&]tech=${process.env.AUTH_E2E_TECH2_ROW}(&|$)`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(customerB);
    await page.getByRole("combobox", { name: "סינון לפי טכנאי" }).selectOption({ label: "כל הטכנאים" });
    // A status chip.
    const chips = page.getByRole("group", { name: "סינון לפי סטטוס קריאה" });
    await chips.getByRole("button", { name: /^טופלה/ }).click();
    await expect(page).toHaveURL(/[?&]status=resolved(&|$)/);
    await expect(chips.getByRole("button", { name: /^טופלה/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("לא נמצאו קריאות")).toBeVisible();
    await chips.getByRole("button", { name: /^פתוחה/ }).click();
    await expect(rows(page)).toHaveCount(2);
    // A tampered technician value is ignored (no filter), never an error.
    await page.goto(`/office/calls?q=${run}&tech=${encodeURIComponent("x' or 1=1")}`);
    await expect(rows(page)).toHaveCount(2);
  });

  test("a row opens its call's address; the temporary page reads it under the session; unknown numbers are 404", async () => {
    const { page } = cs;
    await page.goto(`/office/calls?q=${a}`);
    await rows(page).first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/office/calls/${a}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${customerA} · מס׳ פנייה ${a}`);
    await expect(page.getByText("נתוני בדיקה")).toBeVisible();
    await page.getByRole("link", { name: "› חזרה לקריאות" }).click();
    await expect(page).toHaveURL(/\/office\/calls$/);
    for (const req of ["NO-SUCH-1", "a%20b", "x".repeat(40)]) {
      const response = await page.goto(`/office/calls/${req}`);
      expect(response?.status(), req).toBe(404);
    }
  });

  test("Manager: the same list in the navigation of D57 (1)", async ({ browser }) => {
    const { context, page } = await signedIn(browser, seeded().mgr, /\/office$/);
    await expect(nav(page).getByRole("link")).toHaveText(["דשבורד", "קריאות", "זימונים שלא נקלטו", "הגדרות"]);
    await nav(page).getByRole("link", { name: "קריאות" }).click();
    await expect(page).toHaveURL(/\/office\/calls$/);
    await page.getByRole("searchbox", { name: "חיפוש קריאות" }).fill(run);
    await expect(rows(page)).toHaveCount(2);
    await context.close();
  });

  test("Technician: no office list and no call (server-side denial); anonymous goes to /login", async ({ browser }) => {
    const { context, page } = await signedIn(browser, seeded().tech, /\/tech$/);
    for (const p of ["/office/calls", `/office/calls/${a}`]) {
      await page.goto(p);
      await expect(page, p).toHaveURL(/\/login\?state=no-access$/);
    }
    await context.close();
    const anonymous = await browser.newContext({ locale: "he-IL" });
    const anon = await anonymous.newPage();
    await anon.goto("/office/calls");
    await expect(anon).toHaveURL(/\/login$/);
    await anonymous.close();
  });
});

test.describe("קריאות for the Creator, and the matrix key `calls` (local stack)", () => {
  test.skip(!creator(), "needs the local Creator: node tests/auth/run-local.mjs --with-creator (Step 2 plan Q6)");

  test("Creator: the list; with `calls` off for Customer Service the page says \"אין הרשאה\" (D33, server-side)", async ({ browser }) => {
    const c = creator()!;
    const { context, page } = await signedIn(browser, c, /\/office$/);
    await expect(nav(page).getByRole("link")).toHaveText(["דשבורד", "קריאות", "זימונים שלא נקלטו", "הגדרות"]);
    await page.goto("/office/calls");
    await expect(table(page)).toBeVisible();
    await context.close();

    // The Creator turns `calls` off for Customer Service through the real, audited matrix RPC.
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect((await db.auth.signInWithPassword({ email: c.email, password: c.password })).error).toBeNull();
    const version = () => Number(localSqlValue("select version from public.role_permissions where role = 'customer_service' and permission_key = 'calls'"));
    const set = async (allowed: boolean) => {
      const { error } = await db.rpc("admin_set_role_permission", {
        p_role: "customer_service",
        p_key: "calls",
        p_allowed: allowed,
        p_expected_version: version(),
        p_reason: "office calls-list test (local stack)",
      });
      expect(error).toBeNull();
    };
    await set(false);
    try {
      const cs = await signedIn(browser, seeded().cs, /\/office\/calls$/);
      await expect(cs.page.getByRole("heading", { level: 2, name: "אין הרשאה" })).toBeVisible();
      await expect(table(cs.page)).toHaveCount(0);
      await cs.page.goto(`/office/calls/${localSqlValue("select request_number from public.service_calls order by opened_at desc limit 1")}`);
      await expect(cs.page.getByRole("heading", { level: 1, name: "העמוד לא נמצא" })).toBeVisible();
      await cs.context.close();
    } finally {
      await set(true);
      await db.auth.signOut({ scope: "local" });
    }
  });
});
