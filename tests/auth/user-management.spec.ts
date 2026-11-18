import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { testAccountEmailError } from "@/features/accounts/data/validate";
import { ACCOUNT_MESSAGES, ACTION_MESSAGES, PASSWORD_RESET_MESSAGES, SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import type { SeededUser } from "./global-setup";
import { localSql, localSqlValue, seeded, signInAs, submitSignIn } from "./helpers";

// The real unified user management (D60 (7); QA M-06, M-10, C-01, C-02, C-09, S-01) in a browser,
// against a local production build and the LOCAL Supabase stack (tests/auth/run-local.mjs). Every
// account is fictional and test-marked (D47, `@example.test`); the names start with "ב" so they sort
// after the review screenshots' accounts ("א") and before the accounts that earlier runs leave in the
// shared local database (the list shows the first 100 rows, role then name). Sign-ins are counted (the local Auth allows 30 per
// 5 minutes per IP): each actor signs in once per describe block and keeps his page.
//   node tests/auth/run-local.mjs [--with-creator] tests/auth/user-management.spec.ts
// The Creator's cases need --with-creator (TEMPORARY, Step 2 plan Q6) and are skipped without it.

const USERS_PATH = "/office/settings/users";
const run = randomBytes(3).toString("hex");
const email = (tag: string) => `ui-e2e-${tag}-${run}@example.test`;
const nav = (page: Page) => page.getByRole("navigation", { name: "ניווט ראשי" });

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

async function signedIn(browser: Browser, user: SeededUser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signInAs(page, user, /\/office$/);
  return { context, page };
}

/** The row of the account named `name` in the users table. */
const rowOf = (page: Page, name: string) => page.locator("[data-account-row]").filter({ has: page.getByText(name, { exact: true }) });

/** D76: opens the row's ⋮ menu and picks the item whose accessible name matches `item`. */
async function rowAction(page: Page, name: string, item: RegExp | string) {
  await rowOf(page, name).getByRole("button", { name: /^פעולות · / }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** A wide-layout cell of that row: "contact" (email and phone), "role" or "state". */
const cell = (page: Page, name: string, which: "contact" | "role" | "state") =>
  rowOf(page, name).getByRole("cell").nth({ contact: 1, role: 2, state: 3 }[which]);

/** Opens "+ הוסף משתמש" and fills the dialog (the role first). */
async function fillAdd(page: Page, v: { role: string; name: string; email: string; phone: string; color?: string }) {
  await page.getByRole("button", { name: "+ הוסף משתמש" }).click();
  const dialog = page.getByRole("dialog", { name: "הוספת משתמש" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: v.role, exact: true }).check();
  await dialog.getByLabel("שם", { exact: true }).fill(v.name);
  await dialog.getByRole("textbox", { name: /^מייל/ }).fill(v.email);
  await dialog.getByLabel("טלפון עבודה").fill(v.phone);
  if (v.color) await dialog.getByRole("radio", { name: v.color, exact: true }).check();
  return dialog;
}

/** Captures the next server-action POST the page sends (its action id and body), for replay tests. */
function nextActionRequest(page: Page): Promise<Request> {
  return page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
}

test.describe.serial("Manager: Settings › משתמשים (Technician and Customer Service only)", () => {
  let context: BrowserContext;
  let page: Page;
  const techName = `בני טכנאי ${run}`;
  const csName = `בתיה שירות ${run}`;
  let captured: { action: string; body: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await signedIn(browser, seeded().mgr));
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("\"הגדרות\" opens the user management; no Manager or Creator row, no Creator-only control, no requests", async () => {
    await nav(page).getByRole("link", { name: "הגדרות" }).click();
    await expect(page).toHaveURL(new RegExp(`${USERS_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות · משתמשים", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "הגדרות" })).toHaveAttribute("aria-current", "page");
    const table = page.getByRole("table", { name: "משתמשים: טכנאים ושירות לקוחות" });
    await expect(table).toBeVisible();
    // The seeded Customer Service and Technician accounts are listed, the Manager himself is not.
    const users = seeded();
    await expect(rowOf(page, users.cs.name).first()).toBeVisible();
    await expect(rowOf(page, users.mgr.name)).toHaveCount(0);
    for (const pill of ["מנהל", "יוצר"]) await expect(table.locator(".pill").getByText(pill, { exact: true })).toHaveCount(0);
    for (const name of [/^סיסמה/, /^מייל/, /^תפקיד/, /^מחיקה/]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByText("בקשות לאישור")).toHaveCount(0);
    await expect(page.getByText("התראות חשבונות")).toHaveCount(0);
  });

  test("\"+ הוסף משתמש\": a role must be chosen; only Technician and Customer Service are offered", async () => {
    await page.getByRole("button", { name: "+ הוסף משתמש" }).click();
    const dialog = page.getByRole("dialog", { name: "הוספת משתמש" });
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByRole("radio", { name: "טכנאי", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "שירות לקוחות", exact: true })).toBeVisible();
    const roles = dialog.getByRole("radiogroup", { name: "תפקיד" });
    await expect(roles).toHaveAttribute("aria-required", "true");
    await expect(roles.getByText("מנהל", { exact: true })).toHaveCount(0);
    await expect(roles.getByText(/יוצר/)).toHaveCount(0);
    // No password field (D50; Q1).
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await dialog.getByRole("button", { name: "הוספה" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("יש לבחור תפקיד");
    // A test account's address stays in example.test (D47).
    await dialog.getByRole("radio", { name: "שירות לקוחות", exact: true }).check();
    await dialog.getByLabel("שם", { exact: true }).fill("ניסיון");
    await dialog.getByRole("textbox", { name: /^מייל/ }).fill("someone@example.com");
    await dialog.getByLabel("טלפון עבודה").fill("050-0000000");
    await dialog.getByRole("button", { name: "הוספה" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(testAccountEmailError("someone@example.com") ?? "");
    await expect(roles).not.toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("textbox", { name: /^מייל/ })).toHaveAttribute("aria-invalid", "true");
    // Escape closes it; focus returns to the opener.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ הוסף משתמש" })).toBeFocused();
  });

  test("adds a Technician (colour, device) and a Customer Service user at once, test-marked", async () => {
    const dialog = await fillAdd(page, { role: "טכנאי", name: techName, email: email("tech"), phone: "050-1234567" });
    // The technician fields appear with the role.
    await expect(dialog.getByRole("group", { name: "פרטי טכנאי" })).toBeVisible();
    await dialog.getByRole("button", { name: "הוספה" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("יש לבחור צבע ביומן");
    await dialog.getByRole("radio", { name: "כחול", exact: true }).check();
    await dialog.getByRole("button", { name: "הוספה" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`המשתמש טכנאי ${techName} נוצר בלי סיסמה`)).toBeVisible();
    const techRow = rowOf(page, techName);
    await expect(techRow).toBeVisible();
    await expect(techRow.getByText("כחול")).toBeVisible();
    // D74: the quiet per-record marker ("בדיקה", named "נתוני בדיקה").
    await expect(techRow.locator('[title="נתוני בדיקה"]')).toBeVisible();
    expect(localSqlValue(`select is_test || '|' || role || '|' || is_active from public.profiles where full_name = '${techName}'`)).toBe("true|technician|true");
    expect(localSqlValue(`select color || '|' || accepts_invitations from public.technicians t join public.profiles p on p.id = t.profile_id where p.full_name = '${techName}'`)).toBe("t-s|true");

    const requestPromise = nextActionRequest(page);
    const cs = await fillAdd(page, { role: "שירות לקוחות", name: csName, email: email("cs"), phone: "050-7654321" });
    await expect(cs.getByRole("group", { name: "פרטי טכנאי" })).toHaveCount(0);
    await cs.getByRole("button", { name: "הוספה" }).click();
    const request = await requestPromise;
    captured = { action: request.headers()["next-action"] ?? "", body: request.postData() ?? "" };
    await expect(cs).toHaveCount(0);
    await expect(page.getByText(`המשתמש שירות לקוחות ${csName} נוצר בלי סיסמה`)).toBeVisible();
    await expect(rowOf(page, csName)).toBeVisible();
    // Created directly: no Creator approval, no request row (C-02).
    expect(localSqlValue(`select is_active || '|' || is_test from public.profiles where full_name = '${csName}'`)).toBe("true|true");
  });

  test("edits a user's phone; deactivates with the confirmation, then activates again", async () => {
    await rowAction(page, csName, /^עריכה/);
    const edit = page.getByRole("dialog", { name: `עריכת פרטים · ${csName}` });
    await edit.getByLabel("טלפון עבודה").fill("03-5550000");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByText(`הפרטים של ${csName} עודכנו ונרשמו ביומן הביקורת.`)).toBeVisible();
    await expect(cell(page, csName, "contact")).toContainText("03-5550000");

    await rowAction(page, techName, /^השבתה/);
    const confirm = page.getByRole("dialog", { name: `השבתת החשבון · ${techName}` });
    await expect(confirm).toContainText("משתמש לא פעיל לא יכול להיכנס לאפליקציה");
    await expect(confirm).toContainText("ההיסטוריה שלו (ביקורים ופעולות) נשמרת");
    await expect(confirm).toContainText("היוצר מקבל התראה באפליקציה");
    await confirm.getByRole("button", { name: "השבתה" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(cell(page, techName, "state")).toHaveText("לא פעיל");
    expect(localSqlValue(`select is_active from public.profiles where full_name = '${techName}'`)).toBe("f");
    // The history row stays (no deletion): the profile is still there, inactive.
    await rowAction(page, techName, /^הפעלה/);
    await expect(page.getByText(`החשבון של ${techName} הופעל.`)).toBeVisible();
    expect(localSqlValue(`select is_active from public.profiles where full_name = '${techName}'`)).toBe("t");
  });

  test("a tampered submission is refused by the server: a Customer Service creation sent as a Manager", async () => {
    const tampered = `תמנע מנהל ${run}`;
    const address = email("tampered");
    await page.route(`**${USERS_PATH}`, async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) {
        await route.continue({ postData: (r.postData() ?? "").replace('"role":"cs"', '"role":"mgr"') });
      } else {
        await route.continue();
      }
    });
    const dialog = await fillAdd(page, { role: "שירות לקוחות", name: tampered, email: address, phone: "050-1111111" });
    await dialog.getByRole("button", { name: "הוספה" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(ACTION_MESSAGES.forbidden);
    await page.unroute(`**${USERS_PATH}`);
    await page.keyboard.press("Escape");
    expect(localSqlValue(`select count(*) from public.profiles where full_name = '${tampered}'`)).toBe("0");
    expect(localSqlValue(`select count(*) from public.account_requests where email = '${address}'`)).toBe("0");
  });

  test("a tampered deactivation aimed at a Manager account is refused; nothing changes", async () => {
    const target = seeded().resetMgr;
    const csId = localSqlValue(`select id from public.profiles where full_name = '${csName}'`);
    await page.route(`**${USERS_PATH}`, async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) {
        await route.continue({ postData: (r.postData() ?? "").replace(csId, target.id) });
      } else {
        await route.continue();
      }
    });
    await rowAction(page, csName, /^השבתה/);
    const confirm = page.getByRole("dialog", { name: `השבתת החשבון · ${csName}` });
    await confirm.getByRole("button", { name: "השבתה" }).click();
    await expect(confirm.getByRole("alert")).toHaveText(ACTION_MESSAGES.forbidden);
    await page.unroute(`**${USERS_PATH}`);
    await page.keyboard.press("Escape");
    expect(localSqlValue(`select is_active from public.profiles where id = '${target.id}'`)).toBe("t");
    expect(localSqlValue(`select is_active from public.profiles where id = '${csId}'`)).toBe("t");
  });

  test("Customer Service replaying the Manager's own action request is refused (the caller is the session's)", async ({ browser }) => {
    expect(captured?.action).toBeTruthy();
    const { context: csContext, page: csPage } = await signedIn(browser, seeded().cs);
    try {
      const address = email("replay");
      const body = (captured?.body ?? "").replace(/"email":"[^"]*"/, `"email":"${address}"`).replace(/"name":"[^"]*"/, `"name":"תשובה ${run}"`);
      const res = await csPage.request.post(USERS_PATH, {
        headers: { "next-action": captured?.action ?? "", "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: new URL(csPage.url()).origin },
        data: body,
      });
      const text = await res.text();
      expect(text).toContain(ACTION_MESSAGES.forbidden);
      expect(localSqlValue(`select count(*) from public.account_requests where email = '${address}'`)).toBe("0");
    } finally {
      await csContext.close();
    }
  });
});

test.describe("Customer Service and Technician cannot reach the settings routes", () => {
  test("Customer Service: no \"הגדרות\" item; the route shows \"אין הרשאה\" and no account data", async ({ browser }) => {
    const { context, page } = await signedIn(browser, seeded().cs);
    try {
      await expect(nav(page).getByRole("link")).toHaveText(["קריאות"]);
      for (const path of ["/office/settings", USERS_PATH]) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${USERS_PATH}$`));
        await expect(page.getByRole("heading", { level: 2, name: "אין הרשאה" })).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "+ הוסף משתמש" })).toHaveCount(0);
        expect(await page.content()).not.toContain(seeded().tech.name);
      }
    } finally {
      await context.close();
    }
  });

  test("Technician: the settings routes send him to the no-access state of the sign-in screen", async ({ browser }) => {
    const context = await browser.newContext({ locale: "he-IL" });
    const page = await context.newPage();
    try {
      await signInAs(page, seeded().tech, /\/tech$/);
      for (const path of ["/office/settings", USERS_PATH]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login\?state=no-access$/);
        await expect(page.getByRole("table")).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
});

test.describe.serial("Creator: Settings › משתמשים והרשאות (every role)", () => {
  test.skip(!creator(), "needs the local Creator: node tests/auth/run-local.mjs --with-creator (Step 2 plan Q6)");
  let context: BrowserContext;
  let page: Page;
  const name = `ברכה מנהלת ${run}`;
  const first = email("mgr");
  const second = email("mgr-new");
  const password = `${randomBytes(12).toString("base64url")}Aa1!`;

  test.beforeAll(async ({ browser }) => {
    const c = creator();
    if (!c) return;
    ({ context, page } = await signedIn(browser, c));
  });
  test.afterAll(async () => {
    await context?.close();
  });

  /** A fresh browser that tries to sign in as the new account; returns the final URL. */
  async function trySignIn(browser: Browser, address: string): Promise<{ url: string; alert: string | null }> {
    const ctx = await browser.newContext({ locale: "he-IL" });
    const p = await ctx.newPage();
    try {
      await submitSignIn(p, address, password);
      await p.waitForURL(/\/(office|login)(\?.*)?$/);
      await p.waitForLoadState("networkidle");
      const alert = (await p.locator(".login-alert").count()) > 0 ? await p.locator(".login-alert").textContent() : null;
      return { url: p.url(), alert };
    } finally {
      await ctx.close();
    }
  }

  test("the unified list with every role, the notices card, his own row without Creator-only actions", async () => {
    await page.goto(USERS_PATH);
    await expect(page.getByRole("heading", { level: 1, name: "הגדרות · משתמשים והרשאות", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "התראות חשבונות" })).toBeVisible();
    await expect(page.getByText("בקשות לאישור")).toHaveCount(0);
    const own = rowOf(page, creator()?.name ?? "");
    await expect(own.getByText("החשבון שלך")).toBeVisible();
    await own.getByRole("button", { name: /^פעולות · / }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["עריכה"]);
    await page.keyboard.press("Escape");
    // The Manager seeded by global-setup is listed for the Creator.
    await expect(rowOf(page, seeded().mgr.name).first()).toBeVisible();
  });

  test("adds a Manager; the Creator role is shown but cannot be chosen", async () => {
    await page.getByRole("button", { name: "+ הוסף משתמש" }).click();
    const dialog = page.getByRole("dialog", { name: "הוספת משתמש" });
    await expect(dialog.getByRole("radio", { name: "מנהל", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("radio", { name: /^יוצר/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    const d = await fillAdd(page, { role: "מנהל", name, email: first, phone: "052-1112223" });
    await d.getByRole("button", { name: "הוספה" }).click();
    await expect(d).toHaveCount(0);
    await expect(page.getByText(`המשתמש מנהל ${name} נוצר בלי סיסמה`)).toBeVisible();
    await expect(cell(page, name, "contact")).toContainText(first);
  });

  test("changes the role (Manager → Customer Service), sets a password and changes the sign-in email", async () => {
    await rowAction(page, name, /^תפקיד/);
    const role = page.getByRole("dialog", { name: `שינוי תפקיד · ${name}` });
    await expect(role.getByRole("radio", { name: "מנהל", exact: true })).toHaveCount(0);
    await expect(role.getByRole("radio", { name: /יוצר/ })).toHaveCount(0);
    await role.getByRole("radio", { name: "שירות לקוחות", exact: true }).check();
    await role.getByRole("button", { name: "שינוי התפקיד" }).click();
    await expect(role).toHaveCount(0);
    await expect(page.getByText(`התפקיד של ${name} שונה לשירות לקוחות.`)).toBeVisible();
    expect(localSqlValue(`select role from public.profiles where full_name = '${name}'`)).toBe("customer_service");

    await rowAction(page, name, /^סיסמה/);
    const pw = page.getByRole("dialog", { name: `הגדרת סיסמה · ${name}` });
    const field = pw.getByLabel("סיסמה חדשה");
    await expect(field).toHaveAttribute("autocomplete", "new-password");
    await field.fill(password);
    await pw.getByRole("button", { name: "שמירת הסיסמה" }).click();
    await expect(pw).toHaveCount(0);
    await expect(page.getByText(`הסיסמה של ${name} נקבעה. היא לא תוצג שוב.`)).toBeVisible();
    expect(await page.content()).not.toContain(password);

    await rowAction(page, name, /^מייל/);
    const mail = page.getByRole("dialog", { name: `שינוי כתובת מייל · ${name}` });
    await mail.getByLabel("מייל חדש").fill(second);
    await mail.getByRole("button", { name: "שמירת המייל" }).click();
    await expect(mail).toHaveCount(0);
    await expect(page.getByText(`כתובת המייל לכניסה של ${name} עודכנה.`)).toBeVisible();
  });

  test("the account signs in with the new email and the password the Creator set", async ({ browser }) => {
    const r = await trySignIn(browser, second);
    expect(r.url).toMatch(/\/office$/);
  });

  test("deactivated: sign-in refused; reactivated: sign-in works again", async ({ browser }) => {
    await rowAction(page, name, /^השבתה/);
    const confirm = page.getByRole("dialog", { name: `השבתת החשבון · ${name}` });
    await expect(confirm).not.toContainText("היוצר מקבל התראה");
    await confirm.getByRole("button", { name: "השבתה" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(cell(page, name, "state")).toHaveText("לא פעיל");
    const refused = await trySignIn(browser, second);
    expect(refused.url).toMatch(/\/login$/);
    expect(refused.alert).toBe(SIGN_IN_MESSAGES.credentials);

    await rowAction(page, name, /^הפעלה/);
    await expect(page.getByText(`החשבון של ${name} הופעל.`)).toBeVisible();
    const back = await trySignIn(browser, second);
    expect(back.url).toMatch(/\/office$/);
  });

  test("deletes after the explicit confirmation: the row is gone, sign-in refused, history kept", async ({ browser }) => {
    await rowAction(page, name, /^מחיקה/);
    const confirm = page.getByRole("dialog", { name: `מחיקת החשבון · ${name}` });
    const button = confirm.getByRole("button", { name: "מחיקה סופית" });
    await expect(button).toBeDisabled();
    await confirm.getByRole("checkbox").check();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByText(`החשבון של ${name} נמחק. ההתחברות חסומה וההיסטוריה שלו נשמרת.`)).toBeVisible();
    await expect(rowOf(page, name)).toHaveCount(0);
    // Option A: the profile stays (history and attribution), marked deleted and inactive.
    expect(localSqlValue(`select (deleted_at is not null) || '|' || is_active from public.profiles where full_name = '${name}'`)).toBe("true|false");
    const refused = await trySignIn(browser, second);
    expect(refused.url).toMatch(/\/login$/);
    expect(refused.alert).toBe(SIGN_IN_MESSAGES.credentials);
  });

  test("a deletion whose ban did not complete: the card keeps the account and \"נסו שוב\" completes it (review S1)", async () => {
    const retryName = `בועז מחיקה ${run}`;
    const d = await fillAdd(page, { role: "שירות לקוחות", name: retryName, email: email("retry"), phone: "052-3334445" });
    await d.getByRole("button", { name: "הוספה" }).click();
    await expect(d).toHaveCount(0);
    await expect(rowOf(page, retryName)).toBeVisible();
    const id = localSqlValue(`select id from public.profiles where full_name = '${retryName}'`);
    const banned = () => localSqlValue(`select coalesce(banned_until > now(), false) from auth.users where id = '${id}'`);

    // The real server deletes and bans; the browser is told that the ban failed (its answer to this
    // one action is rewritten to the server's revokeIncomplete result), and the ban is lifted in the
    // local database, so only "נסו שוב" can complete it.
    let rewritten = false;
    await page.route(`**${USERS_PATH}`, async (route) => {
      const r = route.request();
      if (rewritten || r.method() !== "POST" || !r.headers()["next-action"]) return route.continue();
      const response = await route.fetch();
      const original = await response.text();
      const body = original.replace(
        /\{"ok":true,"simulated":false,"message":"[^"]*","data":\{"version":\d+\}\}/,
        JSON.stringify({ ok: false, simulated: false, error: ACCOUNT_MESSAGES.revokeIncomplete }),
      );
      rewritten = body !== original;
      await route.fulfill({ response, body });
    });
    await rowAction(page, retryName, /^מחיקה/);
    const confirm = page.getByRole("dialog", { name: `מחיקת החשבון · ${retryName}` });
    await confirm.getByRole("checkbox").check();
    await confirm.getByRole("button", { name: "מחיקה סופית" }).click();
    await expect(confirm).toHaveCount(0);
    await page.unroute(`**${USERS_PATH}`);
    expect(rewritten).toBe(true);
    await expect(page.getByText(ACCOUNT_MESSAGES.revokeIncomplete)).toBeVisible();
    const retry = page.getByRole("button", { name: `נסו שוב · השלמת המחיקה של ${retryName}` });
    await expect(retry).toBeFocused();
    await expect(rowOf(page, retryName)).toHaveCount(0);
    expect(localSqlValue(`select (deleted_at is not null) || '|' || is_active from public.profiles where id = '${id}'`)).toBe("true|false");
    localSql(`update auth.users set banned_until = null where id = '${id}';`);
    expect(banned()).toBe("f");

    await retry.click();
    await expect(page.getByText(`החשבון של ${retryName} נמחק. ההתחברות חסומה וההיסטוריה שלו נשמרת.`)).toBeVisible();
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ הוסף משתמש" })).toBeFocused();
    expect(banned()).toBe("t");
    expect(localSqlValue(`select count(*) from public.audit_logs where target_id = '${id}' and action = 'profile.deleted'`)).toBe("1");
  });

  test("another's open creation: listed with its requester; only \"ביטול\" is offered, and it cancels (review S3)", async () => {
    // An intent the Manager authorized whose Auth step never ran: phase 1 alone, under his own session
    // (the publishable key and the local URL of run-local.mjs; one sign-in).
    const mgr = seeded().mgr;
    const intentName = `תיק פתוח ${run}`;
    const address = email("open-mgr");
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect((await client.auth.signInWithPassword({ email: mgr.email, password: mgr.password })).error).toBeNull();
    const authorized = await client.rpc("authorize_account_creation", { p_role: "customer_service", p_email: address, p_full_name: intentName });
    expect(authorized.error).toBeNull();
    await page.goto(USERS_PATH);
    const row = rowOf(page, intentName);
    await expect(row).toBeVisible();
    // The wide layout's state cell (the narrow copy under the name is hidden at 1440 px).
    await expect(row.getByText("יצירה שלא הושלמה").last()).toBeVisible();
    await expect(row.getByText(`על ידי ${mgr.name}`).last()).toBeVisible();
    await row.getByRole("button", { name: /^פעולות · / }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["ביטול"]);
    await page.keyboard.press("Escape");
    await rowAction(page, intentName, `ביטול · היצירה של ${intentName}`);
    await expect(page.getByText(`היצירה של ${intentName} בוטלה.`)).toBeVisible();
    await expect(rowOf(page, intentName)).toHaveCount(0);
    expect(localSqlValue(`select status from public.account_requests where email = '${address}'`)).toBe("cancelled");
  });
});

/** The reset links the mock delivery wrote for `address` (run-local.mjs's temporary file), oldest first. */
function resetLinksTo(address: string): string[] {
  const file = process.env.AUTH_TEST_MAIL_FILE;
  if (!file) throw new Error("AUTH_TEST_MAIL_FILE is not set (run tests/auth/run-local.mjs)");
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { to: string; text: string })
    .filter((m) => m.to === address.toLowerCase())
    .map((m) => m.text.match(/http:\/\/127\.0\.0\.1:\d+\/login\/reset\?token_hash=[0-9a-f]+/)?.[0] ?? "")
    .filter((link) => link !== "");
}

test.describe("a reset-link session is no app sign-in for the account actions (review S6 a; D65 review fix 2)", () => {
  test("Manager and Creator: account actions replayed with a reset-only session are refused; nothing changes", async ({ browser }) => {
    test.setTimeout(180_000);
    const users = seeded();
    const address = email("reset-replay");
    const M = PASSWORD_RESET_MESSAGES;

    // 1. Two action ids from the Manager's own screen: each POST is captured and aborted (nothing runs).
    const captured: { name: string; action: string; body: string }[] = [];
    let next = "";
    const { context: capContext, page: cap } = await signedIn(browser, users.mgr);
    try {
      await cap.goto(USERS_PATH);
      await cap.route(`**${USERS_PATH}`, async (route) => {
        const r = route.request();
        if (r.method() === "POST" && r.headers()["next-action"]) {
          captured.push({ name: next, action: r.headers()["next-action"] ?? "", body: r.postData() ?? "" });
          await route.abort();
        } else {
          await route.continue();
        }
      });
      next = "createAccount";
      const add = await fillAdd(cap, { role: "שירות לקוחות", name: `תאיפוס ${run}`, email: address, phone: "050-2223334" });
      await add.getByRole("button", { name: "הוספה" }).click();
      await expect.poll(() => captured.length).toBe(1);
      // The dialog ignores Escape while its command runs: wait for the aborted request to settle.
      await expect(add.getByRole("button", { name: "הוספה" })).toBeEnabled();
      await cap.keyboard.press("Escape");
      await expect(add).toHaveCount(0);
      next = "deactivateAccount";
      await rowOf(cap, users.cs.name).first().getByRole("button", { name: /^פעולות · / }).click();
      await cap.getByRole("menuitem", { name: `השבתה · החשבון של ${users.cs.name}` }).click();
      await cap.getByRole("dialog", { name: `השבתת החשבון · ${users.cs.name}` }).getByRole("button", { name: "השבתה" }).click();
      await expect.poll(() => captured.length).toBe(2);
    } finally {
      await capContext.close();
    }
    const target = (JSON.parse(captured[1]?.body ?? "[]") as { accountId?: string }[])[0]?.accountId ?? "";
    expect(target).toMatch(/^[0-9a-f-]{36}$/);
    expect(localSqlValue(`select is_active from public.profiles where id = '${target}'`)).toBe("t");

    // 2. For the Manager and the Creator: a session made by the reset link alone (a weak password keeps it).
    const c = creator();
    for (const who of [users.mgr, ...(c ? [c] : [])]) {
      if (who !== users.mgr) {
        // D67 (a): the reset serves accounts that have signed in before.
        const first = await signedIn(browser, who);
        await first.context.close();
      }
      const context = await browser.newContext({ locale: "he-IL" });
      const page = await context.newPage();
      try {
        const before = resetLinksTo(who.email).length;
        await page.goto("/login/forgot");
        await page.getByLabel("אימייל", { exact: true }).fill(who.email);
        await page.getByRole("button", { name: M.send }).click();
        await expect(page.getByRole("heading", { level: 1, name: M.sentTitle })).toBeVisible();
        await expect.poll(() => resetLinksTo(who.email).length).toBe(before + 1);
        await page.goto(resetLinksTo(who.email).at(-1) ?? "");
        await page.getByLabel(M.newPassword, { exact: true }).fill("abc");
        await page.getByLabel(M.confirmPassword, { exact: true }).fill("abc");
        await page.getByRole("button", { name: M.save }).click();
        await expect(page.locator(".login-alert")).toHaveText(M.weak);

        const origin = new URL(page.url()).origin;
        for (const call of captured) {
          const res = await page.request.post(USERS_PATH, {
            headers: { "next-action": call.action, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin },
            data: call.body,
          });
          expect(await res.text(), `${who.name} ${call.name}`).toContain(ACTION_MESSAGES.forbidden);
        }
        // The app treats the session as anonymous: the settings page goes to the sign-in form.
        await page.goto(USERS_PATH);
        await expect(page).toHaveURL(/\/login$/);
      } finally {
        await context.close();
      }
    }
    expect(localSqlValue(`select count(*) from public.account_requests where email = '${address}'`)).toBe("0");
    expect(localSqlValue(`select is_active from public.profiles where id = '${target}'`)).toBe("t");
  });
});

test.describe("phone layout: nothing overflows at 390 px (owner review 2026-11-18)", () => {
  test("Manager and Creator: rows in every state (active, inactive, incomplete creation, missing technician profile) fit; the ⋮ menu stays on screen", async ({ browser }) => {
    test.setTimeout(180_000);
    const users = seeded();
    // An incomplete creation of the Manager (phase 1 only, under his session) and a Technician
    // profile without its field profile (inserted in the local database, test-marked, D47).
    const intentName = `יצירה פתוחה רוחב ${run}`;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect((await client.auth.signInWithPassword({ email: users.mgr.email, password: users.mgr.password })).error).toBeNull();
    expect((await client.rpc("authorize_account_creation", { p_role: "customer_service", p_email: email("wide-intent"), p_full_name: intentName })).error).toBeNull();
    const missingId = randomUUID();
    const missingName = `טכנאי בלי פרופיל רוחב ${run}`;
    localSql(`
      insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      values ('${missingId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email("wide-missing")}', now(), now());
      insert into public.profiles (id, role, full_name, is_active, is_test) values ('${missingId}', 'technician', '${missingName}', true, true);
    `);
    const c = creator();
    const viewers = [users.mgr, ...(c ? [c] : [])];
    expect(viewers.length, "run with --with-creator so the Creator is checked too").toBe(2);
    for (const who of viewers) {
      const context = await browser.newContext({ locale: "he-IL", viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      try {
        await signInAs(page, who, /\/office/);
        await page.goto(USERS_PATH);
        for (const name of [users.tech.name, users.techInactive.name, intentName, missingName]) {
          // The shared local database can hold earlier runs' seeded accounts with the same name.
          const row = rowOf(page, name).first();
          await expect(row, `${who.name}: ${name}`).toBeVisible();
          await row.scrollIntoViewIfNeeded();
          const box = await row.boundingBox();
          expect(box && box.x >= 0 && box.x + box.width <= 390 + 0.5, `${who.name}: the row of ${name} stays inside 390 px`).toBe(true);
          const menu = row.getByRole("button", { name: /^פעולות · / });
          const mb = await menu.boundingBox();
          expect(mb && mb.x >= 0 && mb.x + mb.width <= 390 + 0.5, `${who.name}: ⋮ of ${name} on screen`).toBe(true);
          await menu.click();
          const list = page.getByRole("menu");
          await expect(list).toBeVisible();
          const lb = await list.boundingBox();
          expect(lb && lb.x >= 0 && lb.x + lb.width <= 390 + 0.5, `${who.name}: the menu of ${name} on screen`).toBe(true);
          await page.keyboard.press("Escape");
          await expect(list).toHaveCount(0);
        }
        const overflow = await page.evaluate(() =>
          [document.documentElement, document.body, ...document.querySelectorAll<HTMLElement>(".stage, .work, .card")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
        );
        expect(overflow, `${who.name}: no horizontal scroll at 390 px`).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
});

test.describe("phone office header (D73) at 390 px", () => {
  test("every office role: the logo keeps its 976×234 proportions (≤ 32 px tall) and the header stays ≤ 60 px", async ({ browser }) => {
    const users = seeded();
    const c = creator();
    const viewers = [users.mgr, users.cs, ...(c ? [c] : [])];
    expect(viewers.length, "run with --with-creator so the Creator is checked too").toBe(3);
    for (const who of viewers) {
      const context = await browser.newContext({ locale: "he-IL", viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      try {
        await signInAs(page, who, /\/office/);
        const header = page.locator(".ophone");
        await expect(header, who.name).toBeVisible();
        await expect(page.locator(".side"), who.name).toBeHidden();
        const logo = header.locator(".ophone-logo");
        const lb = await logo.boundingBox();
        const hb = await header.boundingBox();
        expect(lb, who.name).not.toBeNull();
        expect(lb!.height, `${who.name}: logo height`).toBeLessThanOrEqual(32);
        expect(Math.abs(lb!.width / lb!.height - 976 / 234), `${who.name}: logo aspect ratio`).toBeLessThan(0.1);
        expect(hb!.height, `${who.name}: header height`).toBeLessThanOrEqual(60);
      } finally {
        await context.close();
      }
    }
  });
});
