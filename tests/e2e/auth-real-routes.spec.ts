import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SessionUser } from "@/features/auth/data/types";
import { OFFICE_START_PATH, officeAvatarColor, officeStartItem, TECH_PROFILE_PATH, TECH_START_PATH } from "@/features/auth/landing";
import { LOGIN_STATES, loginStateOf } from "@/features/auth/login-state";
import {
  areaDecision,
  LOGIN_NO_ACCESS_PATH,
  LOGIN_PATH,
  loginDecision,
  rootRedirect,
  type SessionState,
  startPathOf,
  userLookupFailure,
} from "@/features/auth/session-state";
import { isSessionCookieName } from "@/features/auth/session-cookies";
import { authLogLine, parseSignInInput } from "@/features/auth/sign-in-input";
import { SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { onlyInProject, openPage } from "./helpers";

// Step 2 PR 2.5: the real sign-in and start screens. Unit tests of the pure session decisions
// (no database, network or browser), and the real routes WITHOUT the Supabase variables (the
// default e2e server has none): they must fail closed. The signed-in flows run against the local
// Supabase stack in tests/auth (tests/auth/run-local.mjs).

const user = (role: SessionUser["role"]): SessionUser => ({ id: `id-${role}`, role, name: "בדיקה", technicianId: null, isTest: true });
const signedIn = (role: SessionUser["role"]): SessionState => ({ kind: "signed-in", user: user(role) });
const ANON: SessionState = { kind: "anonymous" };
const NO_ACCESS: SessionState = { kind: "no-access" };
const UNAVAILABLE: SessionState = { kind: "unavailable" };

test.describe("session decisions (fail closed)", () => {
  onlyInProject("desktop");

  test("a page renders only for a signed-in user of its own area", () => {
    for (const role of ["creator", "mgr", "cs"] as const) {
      expect(areaDecision(signedIn(role), "office")).toEqual({ allow: user(role) });
      expect(areaDecision(signedIn(role), "tech")).toEqual({ redirect: LOGIN_NO_ACCESS_PATH });
    }
    expect(areaDecision(signedIn("tech"), "tech")).toEqual({ allow: user("tech") });
    expect(areaDecision(signedIn("tech"), "office")).toEqual({ redirect: LOGIN_NO_ACCESS_PATH });
    for (const area of ["office", "tech"] as const) {
      expect(areaDecision(ANON, area)).toEqual({ redirect: LOGIN_PATH });
      expect(areaDecision(UNAVAILABLE, area)).toEqual({ redirect: LOGIN_PATH });
      expect(areaDecision(NO_ACCESS, area)).toEqual({ redirect: LOGIN_NO_ACCESS_PATH });
    }
  });

  test("a role that is no role (typing bypassed) has no area and no start", () => {
    const odd = { kind: "signed-in", user: { ...user("mgr"), role: "constructor" } } as unknown as SessionState;
    expect(areaDecision(odd, "office")).toEqual({ redirect: LOGIN_NO_ACCESS_PATH });
    expect(areaDecision(odd, "tech")).toEqual({ redirect: LOGIN_NO_ACCESS_PATH });
    expect(rootRedirect(odd)).toBe(LOGIN_NO_ACCESS_PATH);
    expect(loginDecision(odd, false)).toEqual({ show: "no-access" });
  });

  test("/ sends each state to the right place", () => {
    expect(rootRedirect(signedIn("mgr"))).toBe("/office");
    expect(rootRedirect(signedIn("cs"))).toBe("/office");
    expect(rootRedirect(signedIn("creator"))).toBe("/office");
    expect(rootRedirect(signedIn("tech"))).toBe("/tech");
    expect(rootRedirect(ANON)).toBe(LOGIN_PATH);
    expect(rootRedirect(UNAVAILABLE)).toBe(LOGIN_PATH);
    expect(rootRedirect(NO_ACCESS)).toBe(LOGIN_NO_ACCESS_PATH);
    expect(startPathOf(user("tech"))).toBe(TECH_START_PATH);
    expect(startPathOf(user("cs"))).toBe(OFFICE_START_PATH);
  });

  test("/login: only no-access comes from the URL; a signed-in user goes to his start", () => {
    expect(loginDecision(UNAVAILABLE, false)).toEqual({ show: "unavailable" });
    expect(loginDecision(UNAVAILABLE, true)).toEqual({ show: "unavailable" });
    expect(loginDecision(ANON, false)).toEqual({ show: "form" });
    // Nothing to sign out: the form, not the no-access state.
    expect(loginDecision(ANON, true)).toEqual({ show: "form" });
    expect(loginDecision(NO_ACCESS, false)).toEqual({ show: "no-access" });
    expect(loginDecision(signedIn("mgr"), false)).toEqual({ redirect: "/office" });
    expect(loginDecision(signedIn("tech"), false)).toEqual({ redirect: "/tech" });
    expect(loginDecision(signedIn("tech"), true)).toEqual({ show: "no-access" });
    // The URL never selects "failed", "unavailable" or "retry" on the real screen.
    for (const value of ["failed", "unavailable", "retry", "form", "__proto__", undefined, ["no-access"]]) {
      expect(loginStateOf(value) === "no-access", String(value)).toBe(false);
    }
    expect(LOGIN_STATES).toContain("retry");
  });

  test("a failed getUser: no or rejected session is anonymous; a service failure is unavailable", () => {
    expect(userLookupFailure({ name: "AuthSessionMissingError", status: 400 })).toBe("anonymous");
    for (const status of [400, 401, 403, 404]) expect(userLookupFailure({ name: "AuthApiError", status }), String(status)).toBe("anonymous");
    for (const status of [0, 429, 500, 502, 503]) expect(userLookupFailure({ name: "AuthRetryableFetchError", status }), String(status)).toBe("unavailable");
    for (const value of [null, undefined, "error", 42, {}, { status: "401" }]) expect(userLookupFailure(value), String(value)).toBe("unavailable");
  });
});

test.describe("role landing (D57 (1), QA S-01)", () => {
  onlyInProject("desktop");

  test("Manager and Creator land on \"דשבורד\", Customer Service on \"קריאות\"; never \"בית\"", () => {
    expect(officeStartItem("mgr")).toEqual({ key: "analytics", label: "דשבורד" });
    expect(officeStartItem("creator")).toEqual({ key: "analytics", label: "דשבורד" });
    expect(officeStartItem("cs")).toEqual({ key: "calls", label: "קריאות" });
    for (const value of ["tech", "home", "constructor", "__proto__", "", null, undefined]) {
      expect(officeStartItem(value), String(value)).toBeNull();
    }
    expect(officeAvatarColor("cs")).toBe("var(--s-work)");
    expect(TECH_PROFILE_PATH).toBe("/tech/profile");
  });
});

test.describe("sign-in input (re-validated on the server)", () => {
  onlyInProject("desktop");
  const password = ["fictional", "pass", "1234"].join("-");

  test("a well-formed submission is accepted; the email is trimmed; `next` is only carried", () => {
    expect(parseSignInInput({ email: " a@example.test ", password })).toEqual({ email: "a@example.test", password, next: null });
    expect(parseSignInInput({ email: "a@example.test", password, next: "//evil.example" })).toEqual({
      email: "a@example.test",
      password,
      next: "//evil.example",
    });
  });

  test("anything malformed is refused (null)", () => {
    for (const value of [
      null,
      undefined,
      "a@example.test",
      [],
      {},
      { email: "a@example.test" },
      { password },
      { email: "not-an-email", password },
      { email: "a@example.test", password: "" },
      { email: "a@example.test", password: "x".repeat(73) },
      { email: "a@example.test", password: "א".repeat(37) },
      { email: "a@example.test", password: 12345678 },
      { email: "a@example.test", password, extra: true },
      { email: "a@example.test", password, next: 5 },
      { email: "a@example.test", password, next: "/office".padEnd(600, "x") },
      { email: `${"a".repeat(400)}@example.test`, password },
    ]) {
      expect(parseSignInInput(value), JSON.stringify(value)?.slice(0, 80)).toBeNull();
    }
  });

  test("auth log lines carry an event name and a short code only", () => {
    expect(authLogLine("auth.sign_in.failed", "invalid_credentials")).toBe('{"event":"auth.sign_in.failed","code":"invalid_credentials"}');
    expect(authLogLine("auth.sign_in.failed", 429)).toBe('{"event":"auth.sign_in.failed","code":"429"}');
    const email = "someone@example.test";
    for (const code of [email, "has space", "x".repeat(65), { secret: 1 }, undefined, 1.5]) {
      const line = authLogLine("auth.sign_in.failed", code);
      expect(JSON.parse(line).code, String(code)).toBe("unknown");
      expect(line).not.toContain("@");
    }
    expect(JSON.parse(authLogLine("bad event name", "x")).event).toBe("auth.event");
  });
});

test.describe("session cookie names (the sign-out fallback deletes exactly these)", () => {
  onlyInProject("desktop");

  test("Supabase's session cookie, its chunks and the PKCE verifier; nothing else", () => {
    for (const name of [
      "sb-127-auth-token",
      "sb-127-auth-token.0",
      "sb-127-auth-token.1",
      "sb-127-auth-token.12",
      "sb-127-auth-token-code-verifier",
      "sb-ooxozvvrljjkyfduuiks-auth-token",
      "sb-ooxozvvrljjkyfduuiks-auth-token.0",
    ]) {
      expect(isSessionCookieName(name), name).toBe(true);
    }
    for (const name of [
      "sb-127-auth-token.123",
      "sb-127-auth-token-user",
      "sb--auth-token",
      "sb-127-auth-tokens",
      "xsb-127-auth-token",
      "sb-127-auth-token ",
      "__Host-sb-127-auth-token",
      "theme",
      "",
      undefined,
      42,
      `sb-${"a".repeat(200)}-auth-token`,
    ]) {
      expect(isSessionCookieName(name), String(name)).toBe(false);
    }
  });
});

test.describe("server-only modules", () => {
  onlyInProject("desktop");

  test("the sign-in and sign-out actions are server actions in a server-only module", () => {
    const source = readFileSync(path.resolve("lib/actions/auth.ts"), "utf8");
    expect(source.startsWith('"use server";')).toBe(true);
    expect(source).toContain('import "server-only";');
    // This device only (Step 2 plan §3.4), never the library default "global".
    expect(source).toContain('signOut({ scope: "local" })');
    expect(source).not.toMatch(/scope: "global"/);
    // The fallback uses the tested name rule, not a private copy.
    expect(source).toContain("isSessionCookieName(name)");
  });
});

test.describe("real routes without the Supabase variables (fail closed)", () => {
  test("every real page goes to /login, which shows the unavailable state and no form", async ({ page }) => {
    for (const p of ["/", "/office", "/tech", "/tech/profile", "/login", "/login?state=no-access", "/login?state=failed"]) {
      await openPage(page, p);
      await expect(page, p).toHaveURL(/\/login(\?state=(no-access|failed))?$/);
      await expect(page.locator(".login-alert"), p).toHaveText(SIGN_IN_MESSAGES.service);
      await expect(page.getByRole("heading", { level: 1, name: "כניסה" })).toBeVisible();
      await expect(page.locator('input[type="password"]'), p).toHaveCount(0);
      await expect(page.getByRole("button", { name: "יציאה מהחשבון" })).toHaveCount(0);
    }
  });

  test("no sign-up or reset route and no link to one", async ({ page, request }) => {
    for (const p of ["/signup", "/register", "/forgot-password", "/reset-password"]) {
      expect((await request.get(p)).status(), p).toBe(404);
    }
    await openPage(page, "/login");
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.getByText("שכחתי סיסמה")).toHaveCount(0);
  });

  test("real routes never render the demo frame or demo records (D61)", async ({ page }) => {
    for (const p of ["/login", "/office", "/tech"]) {
      await openPage(page, p);
      await expect(page.locator(".demobar, .demo-strip, [data-demo]"), p).toHaveCount(0);
      const html = await page.content();
      expect(html, p).not.toContain("FIXTURE-SENTINEL");
      expect(html, p).not.toContain("הדגמה");
    }
  });
});
