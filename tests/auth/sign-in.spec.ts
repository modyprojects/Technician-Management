import { expect, test } from "@playwright/test";
import { isSessionCookieName } from "@/features/auth/session-cookies";
import { SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { localSql, seeded, sessionCookies, signInAs, submitSignIn } from "./helpers";

// Real sign-in against the LOCAL Supabase stack (Step 2 plan §5.3, §5.4; Step 2 PR 2.5). Fictional,
// test-marked accounts from global-setup.ts. Every case starts without a session (a fresh context).
// Sign-ins are counted: the local Auth allows 30 per 5 minutes per IP (supabase/config.toml).

test.describe("sign-in and role landing", () => {
  test("Manager: lands on the office start, titled \"דשבורד\", with only the landing item", async ({ page, context }) => {
    const { mgr } = seeded();
    await signInAs(page, mgr, /\/office$/);
    await expect(page.getByRole("heading", { level: 1, name: "דשבורד" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    await expect(nav.getByRole("link")).toHaveText(["דשבורד"]);
    await expect(page.getByText(`שלום, ${mgr.name}`)).toBeVisible();
    await expect(page.locator(".start-role")).toHaveText("הרשאה: מנהל");
    // D47: a test user carries the marker.
    await expect(page.getByText("🧪").first()).toBeVisible();
    // No demo frame or demo record on a real route (D61).
    await expect(page.locator("[data-demo-strip], .demo-strip")).toHaveCount(0);
    // Cookies: HttpOnly, SameSite=Lax, Path=/ (Secure is off only on the local plain-http server).
    const cookies = await sessionCookies(context);
    expect(cookies.length).toBeGreaterThan(0);
    // Every Supabase cookie the library really set is one the sign-out fallback would delete.
    for (const c of (await context.cookies()).filter((c) => c.name.startsWith("sb-"))) {
      expect(isSessionCookieName(c.name), c.name).toBe(true);
    }
    for (const c of cookies) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe("Lax");
      expect(c.path, c.name).toBe("/");
    }
    // Nothing in browser storage.
    const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
    expect(stored).toEqual({ local: 0, session: 0 });
  });

  test("Customer Service: lands on \"קריאות\" (QA S-01), no \"בית\"", async ({ page }) => {
    const { cs } = seeded();
    await signInAs(page, cs, /\/office$/);
    await expect(page.getByRole("heading", { level: 1, name: "קריאות" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    await expect(nav.getByRole("link")).toHaveText(["קריאות"]);
    await expect(page.getByText("בית", { exact: true })).toHaveCount(0);
    await expect(page.locator(".start-role")).toHaveText("הרשאה: שירות לקוחות");
  });

  test("Technician: lands on the technician start; the profile signs out", async ({ page, context }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await expect(page.getByRole("heading", { level: 1, name: `שלום, ${tech.name}` })).toBeVisible();
    await expect(page.locator(".start-role")).toHaveText("הרשאה: טכנאי");
    await page.getByRole("link", { name: "פרופיל" }).click();
    await expect(page).toHaveURL(/\/tech\/profile$/);
    await expect(page.getByRole("heading", { level: 1, name: tech.name })).toBeVisible();
    await page.getByRole("button", { name: "יציאה מהחשבון" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await sessionCookies(context)).toEqual([]);
    await page.goto("/tech");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a signed-in user who opens /login or / goes to his own start", async ({ page }) => {
    const { mgr } = seeded();
    await signInAs(page, mgr, /\/office$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/office$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/office$/);
  });
});

test.describe("credential failures: one message, no session", () => {
  test("wrong password, unknown email, inactive account and no profile look the same", async ({ page, context }) => {
    const { mgr, techInactive, noProfile } = seeded();
    const attempts: [string, string][] = [
      [mgr.email, `${mgr.password}x`],
      [`nobody-${Date.now()}@example.test`, mgr.password],
      [techInactive.email, techInactive.password],
      [noProfile.email, noProfile.password],
    ];
    for (const [email, password] of attempts) {
      await context.clearCookies();
      await submitSignIn(page, email, password);
      await expect(page.locator(".login-alert")).toHaveText(SIGN_IN_MESSAGES.credentials);
      await expect(page).toHaveURL(/\/login$/);
      // The email is kept, the password is not.
      await expect(page.getByLabel("אימייל")).toHaveValue(email);
      await expect(page.getByLabel("סיסמה")).toHaveValue("");
      expect(await sessionCookies(context), email).toEqual([]);
    }
  });
});

test.describe("guards (per page, at the time of the request)", () => {
  test("anonymous: every real page goes to the sign-in form", async ({ page }) => {
    for (const path of ["/", "/office", "/tech", "/tech/profile"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
      await expect(page.getByLabel("אימייל")).toBeVisible();
    }
    // The no-access state needs a session: anonymous gets the form.
    await page.goto("/login?state=no-access");
    await expect(page.getByLabel("אימייל")).toBeVisible();
  });

  test("wrong area: a Technician on /office and a Manager on /tech get the no-access state", async ({ browser }) => {
    const { tech, mgr } = seeded();
    for (const [user, home, other] of [
      [tech, /\/tech$/, "/office"],
      [mgr, /\/office$/, "/tech/profile"],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signInAs(page, user, home);
      await page.goto(other);
      await expect(page).toHaveURL(/\/login\?state=no-access$/);
      await expect(page.getByRole("heading", { level: 1, name: "אין גישה" })).toBeVisible();
      await expect(page.getByText(SIGN_IN_MESSAGES.noAccess)).toBeVisible();
      // Nothing of the other area rendered.
      await expect(page.locator(".office, .phone")).toHaveCount(0);
      await page.getByRole("button", { name: "יציאה מהחשבון" }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(await sessionCookies(context)).toEqual([]);
      await context.close();
    }
  });

  test("deactivated during the session: the next request is denied", async ({ page }) => {
    const { cs } = seeded();
    await signInAs(page, cs, /\/office$/);
    localSql(`update public.profiles set is_active = false where id = '${cs.id}';`);
    try {
      await page.goto("/office");
      await expect(page).toHaveURL(/\/login\?state=no-access$/);
      await expect(page.getByRole("heading", { level: 1, name: "אין גישה" })).toBeVisible();
    } finally {
      localSql(`update public.profiles set is_active = true where id = '${cs.id}';`);
    }
  });
});

test.describe("post-sign-in redirect (no open redirects)", () => {
  test("a safe `next` in the user's own area is followed; another host or area is not", async ({ browser }) => {
    const { mgr } = seeded();
    for (const [next, expected] of [
      ["/office?from=link", /\/office\?from=link$/],
      ["//evil.example/office", /\/office$/],
      ["https://evil.example/office", /\/office$/],
      ["/tech", /\/office$/],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signInAs(page, mgr, expected, `/login?next=${encodeURIComponent(next)}`);
      await context.close();
    }
  });
});

test.describe("server-action protections", () => {
  test("a sign-in POST with a foreign Origin is refused and sets no cookie", async ({ page, playwright }) => {
    const { mgr } = seeded();
    // Capture the real sign-in action request from the browser (and stop it there), then replay it
    // outside the browser, where the Origin header can be set: once from another site (refused by
    // Next.js's server-action Origin check) and once from the app's own origin (the control).
    let captured: { headers: Record<string, string>; body: string } | null = null;
    await page.route("**/login*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        captured = { headers: request.headers(), body: request.postData() ?? "" };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await submitSignIn(page, mgr.email, mgr.password);
    await expect.poll(() => captured !== null).toBe(true);
    const { headers, body } = captured as unknown as { headers: Record<string, string>; body: string };
    const base = new URL(page.url()).origin;
    const replay = async (origin: string) => {
      const api = await playwright.request.newContext();
      const response = await api.post(`${base}/login`, {
        headers: {
          "next-action": headers["next-action"] ?? "",
          "content-type": headers["content-type"] ?? "text/plain;charset=UTF-8",
          accept: "text/x-component",
          origin,
        },
        data: body,
        maxRedirects: 0,
      });
      const setCookie = response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
      await api.dispose();
      return { status: response.status(), sessionCookieSet: setCookie.some((v) => /^sb-[^=]+-auth-token/.test(v) && !/Max-Age=0/i.test(v)) };
    };
    const foreign = await replay("https://evil.example");
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(foreign.sessionCookieSet).toBe(false);
    // Control: the same request from the app's own origin signs in (so the refusal above is the
    // Origin check, not a broken replay).
    const own = await replay(base);
    expect(own.sessionCookieSet).toBe(true);
  });

  test("public sign-up and anonymous sign-in are off", async ({ request }) => {
    // No route in the app.
    expect((await request.get("/signup")).status()).toBe(404);
    expect((await request.get("/register")).status()).toBe(404);
    // The Auth server refuses both with the publishable key (local config: enable_signup = false).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
    const signUp = await request.post(`${url}/auth/v1/signup`, {
      headers: { apikey: key, "content-type": "application/json" },
      // A fictional value assembled at runtime (no credential-shaped literal in the source).
      data: { email: `signup-${Date.now()}@example.test`, password: ["fictional", "signup", String(Date.now())].join("-") },
    });
    expect(signUp.ok()).toBe(false);
    expect((await signUp.json()).error_code).toBe("signup_disabled");
    // An empty body is an anonymous sign-in; the Auth server checks that before public sign-up.
    const anon = await request.post(`${url}/auth/v1/signup`, { headers: { apikey: key, "content-type": "application/json" }, data: {} });
    expect(anon.ok()).toBe(false);
    expect((await anon.json()).error_code).toBe("anonymous_provider_disabled");
  });
});
