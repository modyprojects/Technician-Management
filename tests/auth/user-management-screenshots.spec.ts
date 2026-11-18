import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, signInAs } from "./helpers";

// On demand only (SCREENSHOTS=1): the review images of the real unified user management (D60 (7);
// D62 (6) as amended by D72: every new screen and state at 390 and 1440 px), from a local production build signed
// in to the LOCAL stack (tests/auth/run-local.mjs --with-creator). Every account is fictional and
// test-marked (D47, `@example.test`); the fixed fictional names start with "א" so they head their
// role in the list. No password is typed into any image: the password dialog is shot empty.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs --with-creator tests/auth/user-management-screenshots.spec.ts
// The data is made through the real screens and reused by later runs: the Creator adds the
// fictional Manager "אביטל כהן" and sets her password ("סיסמה", a new random one per run, never
// shown); she signs in, adds Technician and Customer Service users and deactivates one (a notice for
// the Creator); the Creator adds a Customer Service user and changes his role to Technician
// ("פרופיל טכנאי חסר"). The incomplete creation is phase 1 alone (`authorize_account_creation` under
// her own session), the exact state an interrupted creation leaves (Step 2 plan §3.8).
const OUT = path.resolve("docs/review/step2-user-management-ui");
const USERS_PATH = "/office/settings/users";
const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const run = randomBytes(3).toString("hex");
const mail = (tag: string) => `ui-shot-${tag}-${run}@example.test`;

const PEOPLE = {
  csByMgr: "אורית לוי",
  techBlue: "אבי מזרחי",
  techGreen: "אלון פרץ",
  intent: "אריאל שמש",
  mgrByCreator: "אביטל כהן",
  csToTech: "אסף ברק",
} as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

async function signedIn(browser: Browser, user: SeededUser, home: RegExp): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: SIZES[1] });
  const page = await context.newPage();
  await signInAs(page, user, home);
  return { context, page };
}

const rowOf = (page: Page, name: string) => page.locator("[data-account-row]").filter({ has: page.getByText(name, { exact: true }) }).first();

/** D76: opens the row's ⋮ menu and picks the item whose accessible name matches `item`. */
async function rowAction(page: Page, name: string, item: RegExp | string) {
  await rowAction(page, name, /^פעולות · /);
  await page.getByRole("menuitem", { name: item }).click();
}

/** Whether a listed (not deleted) account of that name exists: later runs reuse the data. */
const exists = (name: string) => localSqlValue(`select count(*) from public.profiles where full_name = '${name}' and deleted_at is null`) !== "0";

async function add(page: Page, v: { role: string; name: string; email: string; phone: string; color?: string }) {
  if (exists(v.name)) return;
  await page.getByRole("button", { name: "+ הוסף משתמש" }).click();
  const dialog = page.getByRole("dialog", { name: "הוספת משתמש" });
  await dialog.getByRole("radio", { name: v.role, exact: true }).check();
  await dialog.getByLabel("שם", { exact: true }).fill(v.name);
  await dialog.getByRole("textbox", { name: /^מייל/ }).fill(v.email);
  await dialog.getByLabel("טלפון עבודה").fill(v.phone);
  if (v.color) await dialog.getByRole("radio", { name: v.color, exact: true }).check();
  await dialog.getByRole("button", { name: "הוספה" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rowOf(page, v.name)).toBeVisible();
}

test.describe.serial("user management review images", () => {
  test.skip(!creator(), "needs the local Creator (--with-creator)");
  let mgr: { context: BrowserContext; page: Page };
  let cre: { context: BrowserContext; page: Page };
  let cs: { context: BrowserContext; page: Page };
  /** The fictional Manager of the images, with this run's password. */
  let avital: SeededUser;

  test.beforeAll(async ({ browser }) => {
    cre = await signedIn(browser, creator() as SeededUser, /\/office$/);
    cs = await signedIn(browser, seeded().cs, /\/office$/);
  });
  test.afterAll(async () => {
    for (const x of [mgr, cre, cs]) await x?.context.close();
  });

  test("fictional, test-marked data through the real screens", async ({ browser }) => {
    test.setTimeout(150_000);
    const c = cre.page;
    await c.goto(USERS_PATH);
    await add(c, { role: "מנהל", name: PEOPLE.mgrByCreator, email: mail("avital"), phone: "053-5556677" });
    // Her first password, set by the Creator (TEMPORARY Q1); typed here, never in an image.
    const password = `${randomBytes(12).toString("base64url")}Aa1!`;
    await rowAction(c, PEOPLE.mgrByCreator, /^סיסמה/);
    await c.getByLabel("סיסמה חדשה").fill(password);
    await c.getByRole("button", { name: "שמירת הסיסמה" }).click();
    await expect(c.getByRole("dialog")).toHaveCount(0);
    const [id = "", address = ""] = localSqlValue(
      `select p.id || '|' || u.email from public.profiles p join auth.users u on u.id = p.id where p.full_name = '${PEOPLE.mgrByCreator}' and p.deleted_at is null`,
    ).split("|");
    avital = { id, email: address, password, name: PEOPLE.mgrByCreator };
    await add(c, { role: "שירות לקוחות", name: PEOPLE.csToTech, email: mail("asaf"), phone: "058-6667788" });
    // A role change to Technician leaves "פרופיל טכנאי חסר" until "השלמה".
    if (localSqlValue(`select role from public.profiles where full_name = '${PEOPLE.csToTech}' and deleted_at is null`) !== "technician") {
      await rowAction(c, PEOPLE.csToTech, /^תפקיד/);
      const role = c.getByRole("dialog", { name: `שינוי תפקיד · ${PEOPLE.csToTech}` });
      await role.getByRole("radio", { name: "טכנאי", exact: true }).check();
      await role.getByRole("button", { name: "שינוי התפקיד" }).click();
      await expect(role).toHaveCount(0);
    }
    // A Technician without a field profile (read from the database: the Creator's list shows the
    // first 100 rows, role then name, and the shared local database may hold more accounts).
    expect(
      localSqlValue(
        `select p.role || '|' || (t.id is null) from public.profiles p left join public.technicians t on t.profile_id = p.id where p.full_name = '${PEOPLE.csToTech}' and p.deleted_at is null`,
      ),
    ).toBe("technician|true");

    mgr = await signedIn(browser, avital, /\/office$/);
    const m = mgr.page;
    await m.goto(USERS_PATH);
    await add(m, { role: "שירות לקוחות", name: PEOPLE.csByMgr, email: mail("orit"), phone: "050-2223344" });
    await add(m, { role: "טכנאי", name: PEOPLE.techBlue, email: mail("avi"), phone: "052-3334455", color: "כחול" });
    await add(m, { role: "טכנאי", name: PEOPLE.techGreen, email: mail("alon"), phone: "054-4445566", color: "ירוק" });
    // Her deactivation: a notice for the Creator (D34 b).
    await rowOf(m, PEOPLE.techGreen).getByRole("button", { name: /^פעולות · / }).click();
    if ((await m.getByRole("menuitem", { name: /^השבתה/ }).count()) > 0) {
      await m.getByRole("menuitem", { name: /^השבתה/ }).click();
      await m.getByRole("dialog").getByRole("button", { name: "השבתה" }).click();
      await expect(m.getByRole("dialog")).toHaveCount(0);
    } else {
      await m.keyboard.press("Escape");
    }
    const open = localSqlValue(
      `select count(*) from public.account_requests where full_name = '${PEOPLE.intent}' and requested_by = '${avital.id}' and status = 'approved' and target_profile_id is null`,
    );
    if (open === "0") await openIntent(avital);
  });

  /** Phase 1 of a Technician creation under her own session: "יצירה שלא הושלמה". */
  async function openIntent(user: SeededUser) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    expect(signInError).toBeNull();
    const { error } = await client.rpc("authorize_account_creation", { p_role: "technician", p_email: mail("ariel"), p_full_name: PEOPLE.intent });
    expect(error).toBeNull();
    await client.auth.signOut({ scope: "local" });
  }

  for (const size of SIZES) {
    test(`the screens and states at ${size.width}px`, async () => {
      test.setTimeout(180_000);
      const file = (name: string) => path.join(OUT, `${size.width}-${name}.png`);
      const shot = async (page: Page, name: string, target?: Locator) => {
        await ready(page);
        if (target) await target.screenshot({ path: file(name) });
        else await page.screenshot({ path: file(name) });
      };
      for (const x of [mgr, cre, cs]) await x.page.setViewportSize(size);

      // The settings navigation (the Manager's office start: "דשבורד" and "הגדרות").
      const m = mgr.page;
      await m.goto("/office");
      await shot(m, "nav-mgr");

      // The Manager's list: Technician and Customer Service users, the incomplete creation on top.
      await m.goto(USERS_PATH);
      await expect(rowOf(m, PEOPLE.intent)).toBeVisible();
      await shot(m, "mgr-list");
      await shot(m, "mgr-incomplete-row", rowOf(m, PEOPLE.intent));

      // "+ הוסף משתמש": empty, with the technician fields, with a validation error.
      await m.getByRole("button", { name: "+ הוסף משתמש" }).click();
      const dialog = m.getByRole("dialog", { name: "הוספת משתמש" });
      await shot(m, "add-empty");
      await dialog.getByRole("radio", { name: "טכנאי", exact: true }).check();
      await dialog.getByLabel("שם", { exact: true }).fill("אלה ברגר");
      await shot(m, "add-technician");
      await dialog.getByRole("textbox", { name: /^מייל/ }).fill("ella@example.com");
      await dialog.getByRole("button", { name: "הוספה" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await shot(m, "add-validation");
      await m.keyboard.press("Escape");
      await m.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // The Manager's edit of a Technician (no Outlook email or "פעיל": Q14) and the deactivation.
      await rowAction(m, PEOPLE.techBlue, /^עריכה/);
      await shot(m, "edit-mgr");
      await m.keyboard.press("Escape");
      await rowAction(m, PEOPLE.csByMgr, /^השבתה/);
      await shot(m, "deactivate-confirm");
      await m.keyboard.press("Escape");

      // The Creator's list with the notices card.
      const c = cre.page;
      await c.goto(USERS_PATH);
      await shot(c, "creator-list");
      await shot(c, "creator-notices", c.locator("section.card").filter({ has: c.getByRole("heading", { name: "התראות חשבונות" }) }));
      // Another's open creation (her "יצירה שלא הושלמה"): who started it, "ביטול" only (review S3).
      await expect(rowOf(c, PEOPLE.intent).getByRole("button")).toHaveText(["ביטול"]);
      await shot(c, "creator-other-intent", rowOf(c, PEOPLE.intent));
      // Technician rows come after every Manager and Customer Service row in the Creator's list,
      // which shows the first 100: when the shared local database holds more, these two states are
      // not on the page and their earlier images are kept (recorded as an annotation).
      const notOnPage = (name: string) =>
        test.info().annotations.push({ type: "not retaken", description: `${size.width}-${name}: the row is beyond the list's first 100` });
      // "פרופיל טכנאי חסר" with "השלמה".
      if ((await rowOf(c, PEOPLE.csToTech).count()) > 0) {
        await rowOf(c, PEOPLE.csToTech).scrollIntoViewIfNeeded();
        await shot(c, "creator-tech-missing");
      } else {
        notOnPage("creator-tech-missing");
      }
      // The Creator's edit of a Technician (Outlook email and "פעיל").
      if ((await rowOf(c, PEOPLE.techBlue).count()) > 0) {
        await rowAction(c, PEOPLE.techBlue, /^עריכה/);
        await shot(c, "edit-creator");
        await c.keyboard.press("Escape");
      } else {
        notOnPage("edit-creator");
      }
      // Role change, password (empty), email and deletion dialogs on the Creator's Manager.
      await rowAction(c, PEOPLE.mgrByCreator, /^תפקיד/);
      await shot(c, "role-change");
      await c.keyboard.press("Escape");
      await rowAction(c, PEOPLE.mgrByCreator, /^סיסמה/);
      await expect(c.getByLabel("סיסמה חדשה")).toHaveValue("");
      await shot(c, "password-empty");
      await c.keyboard.press("Escape");
      await rowAction(c, PEOPLE.mgrByCreator, /^מייל/);
      await shot(c, "email-change");
      await c.keyboard.press("Escape");
      await rowAction(c, PEOPLE.mgrByCreator, /^מחיקה/);
      await shot(c, "delete-confirm");
      await c.keyboard.press("Escape");
      await expect(c.getByRole("dialog")).toHaveCount(0);

      // A deletion whose Auth ban did not complete (review S1): the message and "נסו שוב". A fresh
      // fictional account per width is deleted for real; the browser is told the ban failed (the
      // answer to this one action is rewritten), so the image shows the state the server reports then.
      const doomed = `אבנר זמני ${size.width}-${run}`;
      await add(c, { role: "שירות לקוחות", name: doomed, email: mail(`doomed-${size.width}`), phone: "050-9990000" });
      let rewritten = false;
      await c.route(`**${USERS_PATH}`, async (route) => {
        const r = route.request();
        if (rewritten || r.method() !== "POST" || !r.headers()["next-action"]) return route.continue();
        const response = await route.fetch();
        const original = await response.text();
        const body = original.replace(
          /\{"ok":true,"simulated":false,"message":"[^"]*","data":\{"version":\d+\}\}/,
          JSON.stringify({ ok: false, simulated: false, error: "המשתמש נמחק במערכת, אבל חסימת ההתחברות לא הושלמה. נסו שוב כדי להשלים אותה." }),
        );
        rewritten = body !== original;
        await route.fulfill({ response, body });
      });
      await rowAction(c, doomed, /^מחיקה/);
      const confirm = c.getByRole("dialog", { name: `מחיקת החשבון · ${doomed}` });
      await confirm.getByRole("checkbox").check();
      await confirm.getByRole("button", { name: "מחיקה סופית" }).click();
      await expect(confirm).toHaveCount(0);
      await c.unroute(`**${USERS_PATH}`);
      expect(rewritten).toBe(true);
      const retry = c.getByRole("button", { name: `נסו שוב · השלמת המחיקה של ${doomed}` });
      await expect(retry).toBeFocused();
      await retry.scrollIntoViewIfNeeded();
      await shot(c, "delete-retry");
      await retry.click();
      await expect(retry).toHaveCount(0);

      // Customer Service: no "הגדרות" item; the route shows "אין הרשאה".
      const s = cs.page;
      await s.goto(USERS_PATH);
      await expect(s.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
      await shot(s, "cs-no-access");
    });
  }
});
