import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD_RESET_MESSAGES, SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { seeded, signInAs, submitSignIn } from "./helpers";

// On demand only (SCREENSHOTS=1): the Step 2 PR 2.5 review images of the REAL screens, from a local
// production build signed in to the LOCAL stack with the fictional, test-marked accounts of
// global-setup.ts (D47). No password is typed into any image: the form is shot empty, and the
// failed state after the field was emptied. The unavailable state (no Supabase variables) comes
// from tests/e2e/screenshots.spec.ts ("step2-pr25").
//   SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build tests/auth/screenshots.spec.ts
const OUT = path.resolve("docs/review/step2-pr25");
const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
}

for (const size of SIZES) {
  test(`real sign-in and start screens at ${size.width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const users = seeded();
    const file = (name: string) => path.join(OUT, `${size.width}-${name}.png`);
    const fresh = async () => {
      const context = await browser.newContext({ viewport: size, locale: "he-IL" });
      return { context, page: await context.newPage() };
    };

    {
      const { context, page } = await fresh();
      await page.goto("/login");
      await ready(page);
      await page.screenshot({ path: file("login-form") });
      // A credential failure: the message above the form; the password field is empty again.
      await submitSignIn(page, users.mgr.email, `${users.mgr.password}x`);
      await expect(page.locator(".login-alert")).toHaveText(SIGN_IN_MESSAGES.credentials);
      await expect(page.getByLabel("סיסמה", { exact: true })).toHaveValue("");
      await ready(page);
      await page.screenshot({ path: file("login-failed") });
      await context.close();
    }

    for (const [name, user, home] of [
      ["start-mgr", users.mgr, /\/office$/],
      ["start-cs", users.cs, /\/office$/],
      ["start-tech", users.tech, /\/tech$/],
    ] as const) {
      const { context, page } = await fresh();
      await signInAs(page, user, home);
      await ready(page);
      await page.screenshot({ path: file(name) });
      if (name === "start-tech") {
        await page.goto("/tech/profile");
        await ready(page);
        await page.screenshot({ path: file("start-tech-profile") });
        // The no-access state: a Technician who opens an office page.
        await page.goto("/office");
        await expect(page).toHaveURL(/\/login\?state=no-access$/);
        await ready(page);
        await page.screenshot({ path: file("login-no-access") });
      }
      await context.close();
    }
  });
}

// D65, the self-service password reset on the LOCAL stack (mock email delivery): the sign-in screen
// with "שכחתי סיסמה", the sign-in screen after a reset (the notice) and the request's "sent" answer
// (for a fictional address that has no account, so nothing is delivered). The other reset screens
// come from tests/e2e/screenshots.spec.ts ("step2-password-reset").
//   SCREENSHOTS=1 node tests/auth/run-local.mjs --no-build tests/auth/screenshots.spec.ts -g "password reset"
const OUT_RESET = path.resolve("docs/review/step2-password-reset");

for (const size of SIZES) {
  test(`password reset screens (local stack) at ${size.width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, locale: "he-IL" });
    const page = await context.newPage();
    const file = (name: string) => path.join(OUT_RESET, `${size.width}-${name}.png`);
    try {
      await page.goto("/login");
      await expect(page.getByRole("link", { name: PASSWORD_RESET_MESSAGES.forgotLink })).toBeVisible();
      await ready(page);
      await page.screenshot({ path: file("login-link") });
      await page.goto("/login?state=password-updated");
      await expect(page.locator(".note")).toHaveText(PASSWORD_RESET_MESSAGES.updated);
      await ready(page);
      await page.screenshot({ path: file("login-updated") });
      await page.goto("/login/forgot");
      await page.getByLabel("אימייל", { exact: true }).fill(`screens-${size.width}@example.test`);
      await page.getByRole("button", { name: PASSWORD_RESET_MESSAGES.send }).click();
      await expect(page.getByRole("heading", { level: 1, name: PASSWORD_RESET_MESSAGES.sentTitle })).toBeVisible();
      await ready(page);
      await page.screenshot({ path: file("forgot-sent") });
    } finally {
      await context.close();
    }
  });
}
