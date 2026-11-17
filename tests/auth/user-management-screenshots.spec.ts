import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { SeededUser } from "./global-setup";
import { localSqlValue, seeded, signInAs } from "./helpers";

// On demand only (SCREENSHOTS=1): the review images of the real unified user management (D60 (7);
// D62 (6): every new screen and state at 390, 820 and 1440 px), from a local production build signed
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
  { width: 820, height: 1180 },
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
  const context = await browser.newContext({ locale: "he-IL", viewport: SIZES[2] });
  const page = await context.newPage();
  await signInAs(page, user, home);
  return { context, page };
}

const rowOf = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) }).first();

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
    await rowOf(c, PEOPLE.mgrByCreator).getByRole("button", { name: /^סיסמה/ }).click();
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
      await rowOf(c, PEOPLE.csToTech).getByRole("button", { name: /^תפקיד/ }).click();
      const role = c.getByRole("dialog", { name: `שינוי תפקיד · ${PEOPLE.csToTech}` });
      await role.getByRole("radio", { name: "טכנאי", exact: true }).check();
      await role.getByRole("button", { name: "שינוי התפקיד" }).click();
      await expect(role).toHaveCount(0);
    }
    await expect(rowOf(c, PEOPLE.csToTech).getByText("פרופיל טכנאי חסר").last()).toBeVisible();

    mgr = await signedIn(browser, avital, /\/office$/);
    const m = mgr.page;
    await m.goto(USERS_PATH);
    await add(m, { role: "שירות לקוחות", name: PEOPLE.csByMgr, email: mail("orit"), phone: "050-2223344" });
    await add(m, { role: "טכנאי", name: PEOPLE.techBlue, email: mail("avi"), phone: "052-3334455", color: "כחול" });
    await add(m, { role: "טכנאי", name: PEOPLE.techGreen, email: mail("alon"), phone: "054-4445566", color: "ירוק" });
    // Her deactivation: a notice for the Creator (D34 b).
    if ((await rowOf(m, PEOPLE.techGreen).getByRole("button", { name: /^השבתה/ }).count()) > 0) {
      await rowOf(m, PEOPLE.techGreen).getByRole("button", { name: /^השבתה/ }).click();
      await m.getByRole("dialog").getByRole("button", { name: "השבתה" }).click();
      await expect(m.getByRole("dialog")).toHaveCount(0);
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
      await rowOf(m, PEOPLE.techBlue).getByRole("button", { name: /^עריכה/ }).click();
      await shot(m, "edit-mgr");
      await m.keyboard.press("Escape");
      await rowOf(m, PEOPLE.csByMgr).getByRole("button", { name: /^השבתה/ }).click();
      await shot(m, "deactivate-confirm");
      await m.keyboard.press("Escape");

      // The Creator's list with the notices card.
      const c = cre.page;
      await c.goto(USERS_PATH);
      await shot(c, "creator-list");
      await shot(c, "creator-notices", c.locator("section.card").filter({ has: c.getByRole("heading", { name: "התראות חשבונות" }) }));
      // "פרופיל טכנאי חסר" with "השלמה".
      await rowOf(c, PEOPLE.csToTech).scrollIntoViewIfNeeded();
      await shot(c, "creator-tech-missing");
      // The Creator's edit of a Technician (Outlook email and "פעיל").
      await rowOf(c, PEOPLE.techBlue).getByRole("button", { name: /^עריכה/ }).click();
      await shot(c, "edit-creator");
      await c.keyboard.press("Escape");
      // Role change, password (empty), email and deletion dialogs on the Creator's Manager.
      await rowOf(c, PEOPLE.mgrByCreator).getByRole("button", { name: /^תפקיד/ }).click();
      await shot(c, "role-change");
      await c.keyboard.press("Escape");
      await rowOf(c, PEOPLE.mgrByCreator).getByRole("button", { name: /^סיסמה/ }).click();
      await expect(c.getByLabel("סיסמה חדשה")).toHaveValue("");
      await shot(c, "password-empty");
      await c.keyboard.press("Escape");
      await rowOf(c, PEOPLE.mgrByCreator).getByRole("button", { name: /^מייל/ }).click();
      await shot(c, "email-change");
      await c.keyboard.press("Escape");
      await rowOf(c, PEOPLE.mgrByCreator).getByRole("button", { name: /^מחיקה/ }).click();
      await shot(c, "delete-confirm");
      await c.keyboard.press("Escape");
      await expect(c.getByRole("dialog")).toHaveCount(0);

      // Customer Service: no "הגדרות" item; the route shows "אין הרשאה".
      const s = cs.page;
      await s.goto(USERS_PATH);
      await expect(s.getByRole("heading", { name: "אין הרשאה" })).toBeVisible();
      await shot(s, "cs-no-access");
    });
  }
});
