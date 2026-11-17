import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD_RESET_EMAIL_SUBJECT } from "@/features/auth/password-reset/email";
import { isRecentRecoverySession } from "@/features/auth/password-reset/recovery-session";
import { PASSWORD_RESET_MESSAGES as M, SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { seeded, sessionCookies, signInAs, submitSignIn } from "./helpers";

// Self-service password reset (D65) against the LOCAL Supabase stack: the app server runs with the
// mock email delivery into run-local.mjs's temporary file (AUTH_TEST_MAIL_FILE), the local secret
// key for the Auth Admin `generateLink` and APP_ORIGIN = this server (playwright.auth.config.ts).
// Fictional, test-marked accounts (D47); `resetMgr` and `resetInactive` exist for these tests only,
// because their passwords change. New passwords contain the seeded one, so the log check below
// covers them too. Sign-ins are counted (30 per 5 minutes per IP, supabase/config.toml).

const ORIGIN = "http://127.0.0.1:3120";
const LINK = /http:\/\/127\.0\.0\.1:3120\/login\/reset\?token_hash=[0-9a-f]+/;

type MockMail = { at: string; to: string; subject: string; text: string; html: string };

function mails(): MockMail[] {
  const file = process.env.AUTH_TEST_MAIL_FILE;
  if (!file) throw new Error("AUTH_TEST_MAIL_FILE is not set (run tests/auth/run-local.mjs)");
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as MockMail);
}

const mailsTo = (email: string) => mails().filter((m) => m.to === email.toLowerCase());

function onlyMailTo(email: string): MockMail {
  const found = mailsTo(email);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one message, found ${found.length}`);
  return found[0];
}

function serverLog(): string {
  const file = process.env.AUTH_TEST_SERVER_LOG;
  if (!file) throw new Error("AUTH_TEST_SERVER_LOG is not set (run tests/auth/run-local.mjs)");
  return readFileSync(file, "utf8");
}

const logCount = (code: string) =>
  serverLog()
    .split("\n")
    .filter((line) => line.includes('"event":"auth.password_reset.request"') && line.includes(`"code":"${code}"`)).length;

function linkOf(mail: MockMail): string {
  const link = mail.text.match(LINK)?.[0];
  if (!link) throw new Error("no reset link in the message");
  return link;
}

async function requestReset(page: Page, email: string) {
  await page.goto("/login/forgot");
  await page.getByLabel("אימייל", { exact: true }).fill(email);
  await page.getByRole("button", { name: M.send }).click();
  await expect(page.getByRole("heading", { level: 1, name: M.sentTitle })).toBeVisible();
  await expect(page.getByText(M.sent)).toBeVisible();
}

async function submitNewPassword(page: Page, password: string, confirm = password) {
  await page.getByLabel(M.newPassword, { exact: true }).fill(password);
  await page.getByLabel(M.confirmPassword, { exact: true }).fill(confirm);
  await page.getByRole("button", { name: M.save }).click();
}

/** Rewrites the next reset-action POST's arguments (a request that bypasses the browser's checks). */
async function rewriteResetAction(page: Page, change: (args: Record<string, unknown>) => void) {
  let rewritten = false;
  await page.route("**/login/reset*", async (route) => {
    const request = route.request();
    if (rewritten || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    const body = JSON.parse(request.postData() ?? "null") as unknown;
    if (!Array.isArray(body) || typeof body[0] !== "object" || body[0] === null) throw new Error("unexpected server-action body");
    change(body[0] as Record<string, unknown>);
    rewritten = true;
    await route.continue({ postData: JSON.stringify(body) });
  });
  return () => rewritten;
}

async function newPage(contexts: BrowserContext[], browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  contexts.push(context);
  return { context, page: await context.newPage() };
}

test.describe("password reset (D65)", () => {
  test("the whole flow: link by (mock) email, typos keep the link, a weak password keeps the session, success ends every session", async ({ browser }) => {
    test.setTimeout(120_000);
    const { resetMgr: user } = seeded();
    const contexts: BrowserContext[] = [];
    try {
      // An earlier sign-in on another device.
      const earlier = await newPage(contexts, browser);
      await signInAs(earlier.page, user, /\/office$/);

      // "שכחתי סיסמה" on the sign-in screen, then the request (the address in another case).
      const { context, page } = await newPage(contexts, browser);
      await page.goto("/login");
      await page.getByRole("link", { name: M.forgotLink }).click();
      await expect(page).toHaveURL(/\/login\/forgot$/);
      await requestReset(page, user.email.toUpperCase());
      await expect.poll(() => mailsTo(user.email).length).toBe(1);
      const mail = onlyMailTo(user.email);
      expect(mail.subject).toBe(PASSWORD_RESET_EMAIL_SUBJECT);
      expect(mail.html).toContain('<html dir="rtl" lang="he">');
      const link = linkOf(mail);
      // The app's own link (APP_ORIGIN, never the request's Host); the local hash is 56 hex characters.
      expect(link).toMatch(/^http:\/\/127\.0\.0\.1:3120\/login\/reset\?token_hash=[0-9a-f]{56}$/);
      expect(mail.html).toContain(`href="${link}"`);
      expect(mail.html).not.toMatch(/<(img|link|script)\b/i);

      // A second request within a minute sends nothing (the first link stays valid).
      const throttledBefore = logCount("throttled");
      await requestReset(page, user.email);
      await expect.poll(() => logCount("throttled")).toBe(throttledBefore + 1);
      expect(mailsTo(user.email)).toHaveLength(1);

      // The link opens the form; opening it uses nothing (the token is verified on submission only).
      await page.goto(link);
      await expect(page.getByRole("heading", { level: 1, name: M.resetTitle })).toBeVisible();
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
      await page.goto(link);
      await expect(page.getByLabel(M.newPassword, { exact: true })).toBeVisible();

      // A typo, caught in the browser: nothing is sent.
      let posts = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && request.headers()["next-action"]) posts += 1;
      });
      const newPassword = `${user.password}-new`;
      await submitNewPassword(page, newPassword, `${newPassword}x`);
      await expect(page.locator(".set-err")).toHaveText(M.mismatch);
      expect(posts).toBe(0);

      // A typo that bypasses the browser's check: the server refuses it BEFORE it uses the link.
      const wasRewritten = await rewriteResetAction(page, (args) => {
        args.confirm = `${String(args.password)}x`;
      });
      await submitNewPassword(page, newPassword);
      await expect(page.locator(".login-alert")).toHaveText(M.mismatch);
      expect(wasRewritten()).toBe(true);
      await page.unrouteAll({ behavior: "wait" });
      await expect(page).toHaveURL(link);

      // A weak password uses the link; the reset session stays and the token leaves the address bar.
      await submitNewPassword(page, "abc");
      await expect(page.locator(".login-alert")).toHaveText(M.weak);
      await expect(page).toHaveURL(`${ORIGIN}/login/reset`);
      // The fields are emptied after every call.
      await expect(page.getByLabel(M.newPassword, { exact: true })).toHaveValue("");
      await expect(page.getByLabel(M.confirmPassword, { exact: true })).toHaveValue("");
      // A reload keeps the form (the recent reset session), without the token.
      await page.reload();
      await expect(page.getByLabel(M.newPassword, { exact: true })).toBeVisible();

      // The retry succeeds: the sign-in screen with the notice, and no session cookie.
      await submitNewPassword(page, newPassword);
      await expect(page).toHaveURL(/\/login\?state=password-updated$/);
      await expect(page.locator(".note")).toHaveText(M.updated);
      await expect(page.getByLabel("אימייל", { exact: true })).toBeVisible();
      expect(await sessionCookies(context)).toEqual([]);
      expect(await page.content()).not.toContain(newPassword);

      // The earlier session is revoked.
      await earlier.page.goto("/office");
      await expect(earlier.page).toHaveURL(/\/login$/);

      // The old password no longer works; the new one does.
      const fresh = await newPage(contexts, browser);
      await submitSignIn(fresh.page, user.email, user.password);
      await expect(fresh.page.locator(".login-alert")).toHaveText(SIGN_IN_MESSAGES.credentials);
      await submitSignIn(fresh.page, user.email, newPassword);
      await expect(fresh.page).toHaveURL(/\/office$/);

      // The same link again: the invalid-link state, with the way to a new one.
      const again = await newPage(contexts, browser);
      await again.page.goto(link);
      await submitNewPassword(again.page, `${newPassword}-2`);
      await expect(again.page.locator(".login-alert")).toHaveText(M.invalidLink);
      await expect(again.page.getByLabel(M.newPassword, { exact: true })).toHaveCount(0);
      await again.page.getByRole("link", { name: M.requestNew }).click();
      await expect(again.page).toHaveURL(/\/login\/forgot$/);
      expect(await sessionCookies(again.context)).toEqual([]);
    } finally {
      for (const context of contexts) await context.close();
    }
  });

  test("an unknown address gets the same answer and no email", async ({ page }) => {
    const unknown = `nobody-${Date.now()}@example.test`;
    const refusedBefore = logCount("user_not_found");
    await requestReset(page, unknown);
    await expect.poll(() => logCount("user_not_found")).toBe(refusedBefore + 1);
    expect(mailsTo(unknown)).toHaveLength(0);
    // The same screen as for an existing account: only the heading, the text and the way back.
    await expect(page.locator(".login-card")).toHaveText(`${M.sentTitle}${M.sent}${M.backToLogin}`);
  });

  test("a signed-in user who opens the request screen goes to his own start", async ({ page }) => {
    const { mgr } = seeded();
    await signInAs(page, mgr, /\/office$/);
    await page.goto("/login/forgot");
    await expect(page).toHaveURL(/\/office$/);
  });

  test("an ordinary signed-in session can never set a password on the reset screen", async ({ browser, page, context }) => {
    const { mgr } = seeded();
    await signInAs(page, mgr, /\/office$/);
    // Without a token: the invalid-link state (a password session is no reset session).
    await page.goto("/login/reset");
    await expect(page.locator(".login-alert")).toHaveText(M.invalidLink);
    await expect(page.getByLabel(M.newPassword, { exact: true })).toHaveCount(0);
    // A crafted submission without a token is refused on the server too.
    await page.goto(`/login/reset?token_hash=${"ab".repeat(28)}`);
    const wasRewritten = await rewriteResetAction(page, (args) => {
      args.tokenHash = null;
    });
    await submitNewPassword(page, `${mgr.password}-changed`);
    await expect(page.locator(".login-alert")).toHaveText(M.invalidLink);
    expect(wasRewritten()).toBe(true);
    // A made-up token is refused, and the session it was sent from is kept.
    await page.unrouteAll({ behavior: "wait" });
    await page.goto(`/login/reset?token_hash=${"cd".repeat(28)}`);
    await submitNewPassword(page, `${mgr.password}-changed`);
    await expect(page.locator(".login-alert")).toHaveText(M.invalidLink);
    expect((await sessionCookies(context)).length).toBeGreaterThan(0);
    await page.goto("/office");
    await expect(page).toHaveURL(/\/office$/);
    // The password did not change.
    const other = await browser.newContext();
    try {
      await signInAs(await other.newPage(), mgr, /\/office$/);
    } finally {
      await other.close();
    }
  });

  test("a deactivated account can set a new password but still cannot sign in", async ({ page, context }) => {
    const { resetInactive: user } = seeded();
    await requestReset(page, user.email);
    await expect.poll(() => mailsTo(user.email).length).toBe(1);
    await page.goto(linkOf(onlyMailTo(user.email)));
    const newPassword = `${user.password}-new`;
    await submitNewPassword(page, newPassword);
    await expect(page).toHaveURL(/\/login\?state=password-updated$/);
    await expect(page.locator(".note")).toHaveText(M.updated);
    await submitSignIn(page, user.email, newPassword);
    await expect(page.locator(".login-alert")).toHaveText(SIGN_IN_MESSAGES.credentials);
    expect(await sessionCookies(context)).toEqual([]);
  });

  test("pins the reset session's claim shape: amr method \"otp\" (a password sign-in: \"password\")", async ({ page }) => {
    // The Auth user without a profile: its password is not changed here (the token is only verified).
    const { noProfile: user } = seeded();
    await requestReset(page, user.email);
    await expect.poll(() => mailsTo(user.email).length).toBe(1);
    const tokenHash = new URL(linkOf(onlyMailTo(user.email))).searchParams.get("token_hash") ?? "";
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
    const recovery = createClient(url, key, options);
    const verified = await recovery.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    expect(verified.error).toBeNull();
    const claims = (await recovery.auth.getClaims()).data?.claims as unknown as { amr: { method: string; timestamp: number }[] };
    expect(claims.amr.map((entry) => entry.method)).toEqual(["otp"]);
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs((claims.amr[0]?.timestamp ?? 0) - now)).toBeLessThanOrEqual(60);
    expect(isRecentRecoverySession(claims, now)).toBe(true);
    // An hour later the same session may no longer set a password.
    expect(isRecentRecoverySession(claims, now + 3601)).toBe(false);
    const password = createClient(url, key, options);
    expect((await password.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
    const passwordClaims = (await password.auth.getClaims()).data?.claims as unknown as { amr: { method: string }[] };
    expect(passwordClaims.amr.map((entry) => entry.method)).toEqual(["password"]);
    expect(isRecentRecoverySession(passwordClaims, now)).toBe(false);
    await recovery.auth.signOut({ scope: "global" });
  });

  test("no address, password, token or link reaches the server's log", async () => {
    const log = serverLog();
    // The log was captured: the reset events are in it.
    expect(log).toContain('{"event":"auth.password_reset.request","code":"sent"}');
    expect(log).toContain('{"event":"auth.password_reset.complete","code":"updated"}');
    expect(log).toContain('{"event":"auth.password_reset.complete","code":"update_weak_password"}');
    for (const user of Object.values(seeded())) {
      expect(log).not.toContain(user.email);
      expect(log.toLowerCase()).not.toContain(user.email.toLowerCase());
      // New passwords in these tests contain the seeded one.
      expect(log).not.toContain(user.password);
    }
    for (const mail of mails()) {
      const link = linkOf(mail);
      expect(log).not.toContain(link);
      expect(log).not.toContain(new URL(link).searchParams.get("token_hash") ?? "missing");
    }
    expect(log).not.toContain("@example.test");
    expect(log).not.toMatch(/token_hash=/);
    // Every auth event line is exactly {event, code}.
    for (const line of log.split("\n").filter((l) => l.includes('"event":"auth.'))) {
      const parsed = JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown>;
      expect(Object.keys(parsed).sort(), line).toEqual(["code", "event"]);
    }
  });
});
