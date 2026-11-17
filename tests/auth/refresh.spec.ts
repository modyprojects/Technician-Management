import { expect, test, type BrowserContext } from "@playwright/test";
import { seeded, signInAs } from "./helpers";

// Session refresh through proxy.ts (Step 2 plan §3.6). The session cookie's `expires_at` is moved
// into the past, so the next request must refresh the session with the refresh token. The refreshed
// cookies must be saved; otherwise a later request reuses the rotated refresh token, which the Auth
// server refuses after `refresh_token_reuse_interval` (10 s locally) and the user is signed out.

const CHUNK = 3180;

async function expireSession(context: BrowserContext) {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  expect(cookies.length).toBeGreaterThan(0);
  const first = cookies[0];
  if (!first) throw new Error("no session cookie");
  const base = first.name.replace(/\.\d+$/, "");
  const ordered = cookies.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const raw = ordered.map((c) => c.value).join("");
  expect(raw.startsWith("base64-")).toBe(true);
  const session = JSON.parse(Buffer.from(raw.slice(7), "base64url").toString("utf8"));
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  await context.clearCookies({ name: new RegExp(`^${base.replace(/[-]/g, "\\-")}(\\.\\d+)?$`) });
  const parts: [string, string][] =
    value.length <= CHUNK
      ? [[base, value]]
      : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${base}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)] as [string, string]);
  await context.addCookies(parts.map(([name, v]) => ({ name, value: v, domain: first.domain, path: "/", httpOnly: true, sameSite: "Lax" as const, secure: false })));
  return value;
}

test("an expired access token is refreshed and the session survives later requests", async ({ page, context }) => {
  test.setTimeout(60_000);
  const { mgr } = seeded();
  await signInAs(page, mgr, /\/office$/);
  const expired = await expireSession(context);
  await page.goto("/office");
  await expect(page).toHaveURL(/\/office$/);
  const after = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).map((c) => c.value).join("");
  // The refreshed session was saved: the cookie no longer holds the expired session.
  expect(after).not.toBe(expired);
  // Past the reuse interval: the old refresh token would now be refused.
  await page.waitForTimeout(11_000);
  await page.goto("/office");
  await expect(page).toHaveURL(/\/office$/);
  await page.waitForTimeout(1_000);
  await page.goto("/office");
  await expect(page).toHaveURL(/\/office$/);
});
