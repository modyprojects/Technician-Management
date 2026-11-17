import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { escapeHtml, PASSWORD_RESET_EMAIL_SUBJECT, passwordResetEmail } from "@/features/auth/password-reset/email";
import { isRecoveryTokenHash, parseResetCompleteInput, parseResetRequestInput } from "@/features/auth/password-reset/input";
import { FORGOT_PASSWORD_PATH, PASSWORD_UPDATED_PATH, RESET_LINK_MINUTES, RESET_PASSWORD_PATH } from "@/features/auth/password-reset/paths";
import { appOriginOf, LOCAL_APP_ORIGIN } from "@/features/auth/password-reset/origin";
import { isAppSessionClaims, isRecentRecoverySession } from "@/features/auth/password-reset/recovery-session";
import { createResetThrottle, resetThrottleKey } from "@/features/auth/password-reset/throttle";
import { authLogLine } from "@/features/auth/sign-in-input";
import { PASSWORD_RESET_MESSAGES as M, SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { deliveryModeOf, mockFileOf, resendConfigOf, type MailMessage } from "@/features/mail/delivery";
import { mockMailLine } from "@/features/mail/mock";
import { RESEND_ENDPOINT, RESEND_TIMEOUT_MS, sendWithResend, type FetchLike } from "@/features/mail/resend";
import { expectLoginLayout, horizontalOverflow, onlyInProject, OPEN_URL, openPage } from "./helpers";

// Self-service password reset (D65). Unit tests of the pure parts (email template, link origin,
// delivery selection, the dormant Resend adapter with a fake fetch, the throttle, the inputs and the
// reset-session rule), source checks of the server modules, and the screens WITHOUT the Supabase
// variables (the default e2e server: delivery disabled, no Auth). The real flow runs against the
// local Supabase stack in tests/auth/password-reset.spec.ts.

const TOKEN = "0f1e2d3c".repeat(7);
const LINK = `https://technician-management.example.test/login/reset?token_hash=${TOKEN}`;
// Fictional values assembled at runtime (no credential-shaped literal in the source).
const FAKE_KEY = ["re", "fictional", "key", "0123456789"].join("_");
const password = ["fictional", "pass", "1234"].join("-");

test.describe("password reset: texts (D65)", () => {
  onlyInProject("desktop");

  test("the owner's wording", () => {
    expect(M.forgotLink).toBe("שכחתי סיסמה");
    expect(M.updated).toBe("הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה.");
    expect(M.forgotTitle).toBe("איפוס סיסמה");
    expect(M.forgotIntro).toBe("הזינו את כתובת המייל של החשבון, ונשלח אליה קישור לבחירת סיסמה חדשה.");
    expect(M.send).toBe("שליחת קישור");
    expect(M.backToLogin).toBe("חזרה לכניסה");
    expect(M.sentTitle).toBe("בדקו את תיבת המייל");
    expect(M.sent).toBe("אם קיים חשבון עם הכתובת הזו, נשלח אליה קישור לבחירת סיסמה חדשה. הקישור תקף לשעה ולשימוש אחד.");
    expect(M.deliveryOff).toBe("שליחת מיילים עדיין אינה פעילה בסביבה הזו. לאיפוס סיסמה פנו ליוצר המערכת.");
    expect(M.resetTitle).toBe("בחירת סיסמה חדשה");
    expect(M.newPassword).toBe("סיסמה חדשה");
    expect(M.confirmPassword).toBe("אימות סיסמה");
    expect(M.save).toBe("שמירת הסיסמה");
    expect(M.invalidLink).toBe("הקישור אינו תקף או שפג תוקפו.");
    expect(M.requestNew).toBe("בקשת קישור חדש");
    expect(FORGOT_PASSWORD_PATH).toBe("/login/forgot");
    expect(RESET_PASSWORD_PATH).toBe("/login/reset");
    expect(PASSWORD_UPDATED_PATH).toBe("/login?state=password-updated");
    expect(RESET_LINK_MINUTES).toBe(60);
  });
});

test.describe("password reset: the email template (D65)", () => {
  onlyInProject("desktop");

  test("Hebrew, RTL, subject, the button and the plain link, expiry, the ignore line and the footer", () => {
    const email = passwordResetEmail({ link: LINK, expiresMinutes: 60 });
    expect(email.subject).toBe("איפוס סיסמה — MODY ניהול טכנאים");
    expect(email.subject).toBe(PASSWORD_RESET_EMAIL_SUBJECT);
    expect(email.html.startsWith("<!doctype html>\n<html dir=\"rtl\" lang=\"he\">")).toBe(true);
    expect(email.html).toContain('<body dir="rtl"');
    expect(email.html).toContain('<meta charset="utf-8">');
    // Table layout for email clients; the brand header (ink) with the text wordmark.
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("background:#18212B");
    expect(email.html).toMatch(/>MODY<\/div>/);
    expect(email.html).toContain("ניהול טכנאים");
    // The button and the link as plain text (both point at the link).
    expect(email.html).toContain(`>בחירת סיסמה חדשה</a>`);
    expect(email.html.split(`href="${LINK}"`)).toHaveLength(3);
    expect(email.html).toContain(`>${LINK}</a>`);
    expect(email.html).toContain("הקישור תקף לשעה ולשימוש אחד.");
    expect(email.html).toContain("אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מהמייל הזה. הסיסמה הנוכחית לא תשתנה.");
    expect(email.html).toContain("MODY · ניהול טכנאים · הודעה אוטומטית, אין להשיב למייל הזה");
    // The text version carries the same content.
    for (const line of [
      LINK,
      "הקישור תקף לשעה ולשימוש אחד.",
      "אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מהמייל הזה. הסיסמה הנוכחית לא תשתנה.",
      "MODY · ניהול טכנאים · הודעה אוטומטית, אין להשיב למייל הזה",
    ]) {
      expect(email.text.split("\n"), line).toContain(line);
    }
    expect(email.text).not.toContain("<");
  });

  test("no external resource: no image, stylesheet, script, font or remote URL other than the link", () => {
    const { html } = passwordResetEmail({ link: LINK, expiresMinutes: 60 });
    expect(html).not.toMatch(/<(img|link|script|style|iframe|object|embed|video|audio|source)\b/i);
    expect(html).not.toMatch(/\bsrc\s*=|url\(|@import|@font-face/i);
    const urls = html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    expect(new Set(urls)).toEqual(new Set([LINK]));
  });

  test("every interpolated value is escaped; only an http(s) link is accepted", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    // The link is normalised (quotes and angle brackets percent-encoded) and `&` escaped.
    const tricky = `https://app.example.test/login/reset?token_hash=${TOKEN}&x="><script>alert(1)</script>`;
    const { html, text } = passwordResetEmail({ link: tricky, expiresMinutes: 60 });
    expect(html).not.toContain("<script");
    // The quote cannot close the attribute: it arrives percent-encoded.
    expect(html).not.toContain('x="');
    expect(html).toContain(`token_hash=${TOKEN}&amp;x=%22%3E%3Cscript`);
    expect(html).not.toMatch(/token_hash=[0-9a-f]+&x=/);
    expect(text).not.toContain("<script");
    for (const link of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "/login/reset?token_hash=abc",
      "ftp://app.example.test/x",
      "https://user:pass@app.example.test/x",
      "https://app.example.test/a b",
      "https://app.example.test/\n",
      "",
    ]) {
      expect(() => passwordResetEmail({ link, expiresMinutes: 60 }), link).toThrow();
    }
  });

  test("the expiry text follows the minutes; nonsense is refused", () => {
    expect(passwordResetEmail({ link: LINK, expiresMinutes: 30 }).text).toContain("הקישור תקף ל-30 דקות ולשימוש אחד.");
    for (const minutes of [0, -1, 1.5, Number.NaN, 24 * 60 + 1]) {
      expect(() => passwordResetEmail({ link: LINK, expiresMinutes: minutes }), String(minutes)).toThrow();
    }
  });
});

test.describe("password reset: the link's origin (never from the request)", () => {
  onlyInProject("desktop");

  test("APP_ORIGIN when set: https, or http on a loopback host only; refused values never fall back", () => {
    expect(appOriginOf({ APP_ORIGIN: "https://technician-management.vercel.app" })).toBe("https://technician-management.vercel.app");
    expect(appOriginOf({ APP_ORIGIN: " https://app.example.test/ " })).toBe("https://app.example.test");
    expect(appOriginOf({ APP_ORIGIN: "http://127.0.0.1:3120" })).toBe("http://127.0.0.1:3120");
    expect(appOriginOf({ APP_ORIGIN: "http://localhost:3000" })).toBe("http://localhost:3000");
    for (const value of [
      "http://app.example.test",
      "https://app.example.test/path",
      "https://app.example.test?x=1",
      "https://app.example.test#x",
      "https://user:pass@app.example.test",
      "javascript:alert(1)",
      "app.example.test",
      "//app.example.test",
      "https://app.example.test\\@evil.example",
    ]) {
      expect(appOriginOf({ APP_ORIGIN: value, VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "ok.vercel.app" }), value).toBeNull();
    }
  });

  test("on Vercel: Production and Preview addresses from the system variables; locally the dev server", () => {
    expect(appOriginOf({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "technician-management.vercel.app" })).toBe(
      "https://technician-management.vercel.app",
    );
    expect(appOriginOf({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "technician-management-git-x-mody-projects.vercel.app" })).toBe(
      "https://technician-management-git-x-mody-projects.vercel.app",
    );
    // Missing or malformed system variables: no link at all (fail closed).
    for (const host of [undefined, "", "https://x.vercel.app", "x.vercel.app/path", "x.vercel.app?y", "evil.example@x", "-x.vercel.app"]) {
      expect(appOriginOf({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: host }), String(host)).toBeNull();
      expect(appOriginOf({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: host }), String(host)).toBeNull();
    }
    // Production never uses the branch address, Preview never the production one.
    expect(appOriginOf({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: "b.vercel.app" })).toBeNull();
    expect(appOriginOf({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "p.vercel.app" })).toBeNull();
    expect(appOriginOf({})).toBe(LOCAL_APP_ORIGIN);
    expect(appOriginOf({ VERCEL_ENV: "development" })).toBe("http://localhost:3000");
  });
});

test.describe("password reset: email delivery selection", () => {
  onlyInProject("desktop");
  const resend = { EMAIL_PROVIDER_API_KEY: FAKE_KEY, EMAIL_FROM_ADDRESS: "MODY <no-reply@mail.example.test>" };

  test("disabled by default and for anything unknown", () => {
    for (const value of [undefined, "", " ", "disabled", "smtp", "MOCKS", "true"]) {
      expect(deliveryModeOf({ EMAIL_DELIVERY: value, ...resend }), String(value)).toBe("disabled");
    }
  });

  test("mock only locally or in CI (no VERCEL_ENV) and only into MAIL_MOCK_FILE (review fix 5)", () => {
    const file = "/tmp/tm-auth-x/mail.jsonl";
    expect(deliveryModeOf({ EMAIL_DELIVERY: "mock", MAIL_MOCK_FILE: file })).toBe("mock");
    expect(deliveryModeOf({ EMAIL_DELIVERY: " Mock ", MAIL_MOCK_FILE: ` ${file} ` })).toBe("mock");
    expect(mockFileOf({ MAIL_MOCK_FILE: ` ${file} ` })).toBe(file);
    // Any Vercel deployment (Production, Preview, development): never, also with a file.
    for (const vercelEnv of ["production", "preview", "development", "anything"]) {
      expect(deliveryModeOf({ EMAIL_DELIVERY: "mock", MAIL_MOCK_FILE: file, VERCEL_ENV: vercelEnv }), vercelEnv).toBe("disabled");
    }
    // No file, or no usable one: disabled (there is no in-memory list that would keep live links).
    for (const value of [undefined, "", " ", "mail.jsonl", "./mail.jsonl", "~/mail.jsonl", "/tmp/a\nb", "/tmp/a\u0000b", `/${"a".repeat(1100)}`]) {
      expect(deliveryModeOf({ EMAIL_DELIVERY: "mock", MAIL_MOCK_FILE: value }), JSON.stringify(value)?.slice(0, 40)).toBe("disabled");
      expect(mockFileOf({ MAIL_MOCK_FILE: value }), JSON.stringify(value)?.slice(0, 40)).toBeNull();
    }
  });

  test("resend needs both the key and the sender (well-formed), else disabled", () => {
    expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", ...resend })).toBe("resend");
    expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", ...resend, EMAIL_FROM_ADDRESS: "no-reply@mail.example.test" })).toBe("resend");
    expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", EMAIL_PROVIDER_API_KEY: FAKE_KEY })).toBe("disabled");
    expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", EMAIL_FROM_ADDRESS: resend.EMAIL_FROM_ADDRESS })).toBe("disabled");
    for (const from of ["not-an-address", "a@b.test\r\nBcc: x@y.test", "MODY <a@b.test>\nX: y"]) {
      expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", ...resend, EMAIL_FROM_ADDRESS: from }), from).toBe("disabled");
    }
    for (const key of ["short", "has space key 123", `${FAKE_KEY}\r\nX: y`]) {
      expect(deliveryModeOf({ EMAIL_DELIVERY: "resend", ...resend, EMAIL_PROVIDER_API_KEY: key })).toBe("disabled");
    }
    expect(resendConfigOf(resend)).toEqual({ apiKey: FAKE_KEY, from: resend.EMAIL_FROM_ADDRESS });
  });

  test("the mock record is one JSON line", () => {
    const message: MailMessage = { to: "a@example.test", subject: "s", html: "<p>h</p>", text: "t\nu" };
    const line = mockMailLine(message, new Date("2026-11-17T10:00:00Z"));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ at: "2026-11-17T10:00:00.000Z", ...message });
  });
});

test.describe("password reset: the dormant Resend adapter (fake fetch only)", () => {
  onlyInProject("desktop");
  const config = { apiKey: FAKE_KEY, from: "MODY <no-reply@mail.example.test>" };
  const message: MailMessage = { to: "someone@example.test", subject: "נושא", html: "<p>גוף</p>", text: "גוף" };

  test("one POST to the Resend API: Bearer key, JSON {from, to, subject, html, text}, no redirects", async () => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    expect(await sendWithResend(config, message, { fetch })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(RESEND_ENDPOINT);
    expect(RESEND_ENDPOINT).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.headers).toEqual({ Authorization: `Bearer ${FAKE_KEY}`, "Content-Type": "application/json" });
    expect(JSON.parse(call?.init.body ?? "null")).toEqual({ from: config.from, to: message.to, subject: message.subject, html: message.html, text: message.text });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
  });

  test("the response body is never read: it is cancelled, on success and on failure (review fix 6)", async () => {
    for (const [ok, status] of [
      [true, 200],
      [false, 422],
      [false, 503],
    ] as const) {
      let cancelled = 0;
      let read = 0;
      const body = {
        cancel: async () => {
          cancelled += 1;
        },
        getReader: () => {
          read += 1;
          throw new Error("the body must not be read");
        },
      };
      await sendWithResend(config, message, { fetch: async () => ({ ok, status, body }) });
      expect(cancelled, String(status)).toBe(1);
      expect(read, String(status)).toBe(0);
    }
    // No body, a body whose cancel fails, or one that throws at once: the result is unchanged.
    expect(await sendWithResend(config, message, { fetch: async () => ({ ok: true, status: 200, body: null }) })).toEqual({ ok: true });
    const rejecting = { cancel: () => Promise.reject(new Error("cancel failed")) };
    expect(await sendWithResend(config, message, { fetch: async () => ({ ok: true, status: 200, body: rejecting }) })).toEqual({ ok: true });
    const throwing = {
      cancel: (): Promise<void> => {
        throw new Error("cancel failed");
      },
    };
    expect(await sendWithResend(config, message, { fetch: async () => ({ ok: false, status: 500, body: throwing }) })).toEqual({
      ok: false,
      code: "provider_unavailable",
    });
    // A real Response's body is cancelled: disturbed, yet never locked by a reader (never read).
    const response = new Response('{"id":"fictional"}', { status: 200 });
    expect(await sendWithResend(config, message, { fetch: async () => response })).toEqual({ ok: true });
    expect(response.bodyUsed).toBe(true);
    expect(response.body?.locked).toBe(false);
  });

  test("failures map to codes that carry no key, address or body", async () => {
    for (const [status, code] of [
      [400, "rejected"],
      [422, "rejected"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
      [503, "provider_unavailable"],
      [404, "failed"],
    ] as const) {
      const result = await sendWithResend(config, message, { fetch: async () => ({ ok: false, status }) });
      expect(result, String(status)).toEqual({ ok: false, code });
    }
    const thrown = await sendWithResend(config, message, {
      fetch: async () => {
        throw new Error(`network failure for ${FAKE_KEY} to ${message.to}`);
      },
    });
    expect(thrown).toEqual({ ok: false, code: "network" });
    expect(JSON.stringify(thrown)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(thrown)).not.toContain(message.to);
  });

  test("a call that does not answer in time is aborted as a timeout", async () => {
    const result = await sendWithResend(config, message, {
      timeoutMs: 30,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(result).toEqual({ ok: false, code: "timeout" });
  });
});

test.describe("password reset: the interim throttle", () => {
  onlyInProject("desktop");

  test("one email per address per minute; addresses are independent", () => {
    let now = 1_000_000;
    const throttle = createResetThrottle({ now: () => now });
    const a = resetThrottleKey("a@example.test");
    const b = resetThrottleKey("b@example.test");
    expect(throttle.allow(a)).toBe(true);
    expect(throttle.allow(a)).toBe(false);
    expect(throttle.allow(b)).toBe(true);
    now += 59_999;
    expect(throttle.allow(a)).toBe(false);
    now += 1;
    expect(throttle.allow(a)).toBe(true);
  });

  test("a cap per instance and minute; fail closed when too many addresses are remembered", () => {
    let now = 0;
    const throttle = createResetThrottle({ now: () => now, perInstancePerMinute: 20 });
    for (let i = 0; i < 20; i++) expect(throttle.allow(resetThrottleKey(`u${i}@example.test`)), String(i)).toBe(true);
    expect(throttle.allow(resetThrottleKey("u20@example.test"))).toBe(false);
    now += 60_000;
    expect(throttle.allow(resetThrottleKey("u20@example.test"))).toBe(true);
    const small = createResetThrottle({ now: () => now, maxAddresses: 2, perInstancePerMinute: 100 });
    expect(small.allow("k1")).toBe(true);
    expect(small.allow("k2")).toBe(true);
    expect(small.allow("k3")).toBe(false);
  });

  test("the key is a SHA-256 of the trimmed, lower-cased address (never the address)", () => {
    const key = resetThrottleKey(" Someone@Example.Test ");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(resetThrottleKey("someone@example.test"));
    expect(key).not.toBe(resetThrottleKey("someone2@example.test"));
  });
});

test.describe("password reset: inputs (re-validated on the server)", () => {
  onlyInProject("desktop");

  test("the request: the sign-in email rule, trimmed and lower-cased; anything else refused", () => {
    expect(parseResetRequestInput({ email: " Someone@Example.TEST " })).toEqual({ email: "someone@example.test" });
    for (const value of [null, undefined, "a@example.test", {}, { email: "" }, { email: "not-an-email" }, { email: 5 }, { email: "a@example.test", extra: 1 }, { email: `${"a".repeat(400)}@example.test` }]) {
      expect(parseResetRequestInput(value), JSON.stringify(value)?.slice(0, 60)).toBeNull();
    }
  });

  test("the new password: non-empty, at most 72 UTF-8 bytes, equal to the confirmation, all before the token", () => {
    expect(parseResetCompleteInput({ tokenHash: TOKEN, password, confirm: password })).toEqual({ ok: true, input: { tokenHash: TOKEN, password } });
    expect(parseResetCompleteInput({ tokenHash: null, password, confirm: password })).toEqual({ ok: true, input: { tokenHash: null, password } });
    expect(parseResetCompleteInput({ password, confirm: password })).toEqual({ ok: true, input: { tokenHash: null, password } });
    expect(parseResetCompleteInput({ tokenHash: "", password, confirm: password })).toEqual({ ok: true, input: { tokenHash: null, password } });
    // 72 bytes is the limit (36 Hebrew letters = 72 bytes).
    const hebrew72 = "א".repeat(36);
    expect(parseResetCompleteInput({ password: hebrew72, confirm: hebrew72 }).ok).toBe(true);
    expect(parseResetCompleteInput({ password: "א".repeat(37), confirm: "א".repeat(37) })).toEqual({ ok: false, problem: "too-long" });
    expect(parseResetCompleteInput({ password: "x".repeat(73), confirm: "x".repeat(73) })).toEqual({ ok: false, problem: "too-long" });
    expect(parseResetCompleteInput({ password: "", confirm: "" })).toEqual({ ok: false, problem: "missing" });
    // A mismatch is found before the token is even looked at (a typo never uses up the link).
    expect(parseResetCompleteInput({ tokenHash: "not a token", password, confirm: `${password}x` })).toEqual({ ok: false, problem: "mismatch" });
    expect(parseResetCompleteInput({ tokenHash: TOKEN, password, confirm: ` ${password}` })).toEqual({ ok: false, problem: "mismatch" });
    expect(parseResetCompleteInput({ tokenHash: "XYZ", password, confirm: password })).toEqual({ ok: false, problem: "token" });
    for (const value of [null, "x", {}, { password }, { password, confirm: password, extra: 1 }, { password: 5, confirm: 5 }, { tokenHash: 5, password, confirm: password }]) {
      expect(parseResetCompleteInput(value), JSON.stringify(value)).toEqual({ ok: false, problem: "malformed" });
    }
  });

  test("the token's format: lower-case hex, bounded", () => {
    expect(isRecoveryTokenHash("ab".repeat(28))).toBe(true);
    for (const value of ["", "AB".repeat(28), "ab".repeat(15), "a".repeat(129), `${"ab".repeat(28)} `, `pkce_${"ab".repeat(28)}`, "%61%62", null, 5, ["ab".repeat(28)]]) {
      expect(isRecoveryTokenHash(value), String(value)).toBe(false);
    }
  });
});

test.describe("password reset: which session may set a password", () => {
  onlyInProject("desktop");
  const now = 1_800_000_000;

  test("a reset-link verification (amr \"otp\", shape pinned in tests/auth) within the last hour", () => {
    expect(isRecentRecoverySession({ amr: [{ method: "otp", timestamp: now - 10 }] }, now)).toBe(true);
    expect(isRecentRecoverySession({ amr: [{ method: "recovery", timestamp: now - 3600 }] }, now)).toBe(true);
    expect(isRecentRecoverySession({ amr: [{ method: "otp", timestamp: now - 3601 }] }, now)).toBe(false);
    expect(isRecentRecoverySession({ amr: [{ method: "otp", timestamp: now + 3600 }] }, now)).toBe(false);
  });

  test("never an ordinary session, and nothing malformed", () => {
    for (const claims of [
      { amr: [{ method: "password", timestamp: now }] },
      { amr: [{ method: "totp", timestamp: now }] },
      { amr: [{ method: "anonymous", timestamp: now }] },
      { amr: [{ method: "otp", timestamp: String(now) }] },
      { amr: [{ method: "otp" }] },
      { amr: "otp" },
      { amr: [] },
      {},
      null,
      undefined,
      "otp",
    ]) {
      expect(isRecentRecoverySession(claims, now), JSON.stringify(claims)).toBe(false);
    }
  });

  test("a reset-link session is never an app sign-in; a password session always is (review fix 2)", () => {
    // Reset-link sessions (an email-token method without "password"), fresh or old.
    for (const claims of [
      { amr: [{ method: "otp", timestamp: now }] },
      { amr: [{ method: "recovery", timestamp: now - 7200 }] },
      { amr: [{ method: "otp", timestamp: now }, { method: "totp", timestamp: now }] },
    ]) {
      expect(isAppSessionClaims(claims), JSON.stringify(claims)).toBe(false);
    }
    // Password sign-ins, also refreshed ones (the amr keeps the original method) and with MFA.
    for (const claims of [
      { amr: [{ method: "password", timestamp: now - 86_400 }] },
      { amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }] },
      { amr: [{ method: "otp", timestamp: now }, { method: "password", timestamp: now }] },
    ]) {
      expect(isAppSessionClaims(claims), JSON.stringify(claims)).toBe(true);
    }
    // Nothing malformed (fail closed).
    for (const claims of [{ amr: [] }, { amr: [{}] }, { amr: [{ method: 5 }] }, { amr: "password" }, {}, null, undefined, "password"]) {
      expect(isAppSessionClaims(claims), JSON.stringify(claims)).toBe(false);
    }
  });
});

test.describe("password reset: server modules", () => {
  onlyInProject("desktop");
  const source = (file: string) => readFileSync(path.resolve(file), "utf8");

  test("the actions are server actions in a server-only module; global sign-out; the origin never from the request", () => {
    const actions = source("lib/actions/password-reset.ts");
    expect(actions.startsWith('"use server";')).toBe(true);
    expect(actions).toContain('import "server-only";');
    expect(actions).toContain('signOut({ scope: "global" })');
    expect(actions).toContain("isSessionCookieName(name)");
    expect(actions).toContain('verifyOtp({ type: "recovery", token_hash: tokenHash })');
    // Review fix 1: nothing whose duration depends on the account runs before the answer; the Auth
    // Admin call, the link and the email run only in the function handed to after().
    const request = actions.slice(actions.indexOf("export async function requestPasswordReset"), actions.indexOf("/** Removes this browser's"));
    expect(request).toContain("after(() => deliverResetLink(email, origin));");
    expect(request).not.toMatch(/createRecoveryTokenHash|sendMail|passwordResetEmail|await /);
    expect(actions.match(/createRecoveryTokenHash\(/g)).toHaveLength(1);
    expect(actions.match(/deliverResetLink\(/g)).toHaveLength(2);
    // Review fix 4: the email goes to the account's own address from the Auth server.
    expect(actions).toContain("sendMail({ to: token.email, ...message })");
    expect(source("lib/auth/password-reset-admin.ts")).toContain("accountEmailOf(data?.user?.email)");
    // Review fix 5: no in-memory mock list.
    expect(source("lib/mail/index.ts")).not.toMatch(/mockMemory|\.push\(/);
    // Review fix 2: the request's session state refuses a reset-link session.
    const session = source("lib/auth/session.ts");
    expect(session).toContain("client.auth.getClaims()");
    expect(session).toContain("if (!isAppSessionClaims(data.claims)) {");
    expect(session.indexOf("isAppSessionClaims(data.claims)")).toBeLessThan(session.indexOf("return await sessionStateOf(client, userId)"));
    // The link's origin comes from configuration only (lib/auth/app-origin.ts).
    expect(actions).not.toMatch(/\bheaders\(\)|x-forwarded-host|\.get\("host"\)/i);
    expect(source("lib/auth/app-origin.ts")).not.toMatch(/next\/headers|headers\(\)/);
    // Logs: event name and code only, through the shared helper; nothing printed directly.
    for (const file of ["lib/actions/password-reset.ts", "lib/auth/password-reset-admin.ts", "lib/mail/index.ts", "lib/auth/app-origin.ts"]) {
      expect(source(file), file).not.toMatch(/console\./);
    }
  });

  test("the Auth Admin call: its own client at call time from the shared schema, the secret key never public", () => {
    const admin = source("lib/auth/password-reset-admin.ts");
    expect(admin).toContain("parseSupabaseAdminEnv({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY })");
    expect(admin).toContain("persistSession: false, autoRefreshToken: false, detectSessionInUrl: false");
    expect(admin).toContain('generateLink({ type: "recovery", email })');
    expect(admin).not.toMatch(/NEXT_PUBLIC_SUPABASE_SECRET|export const client|export \{ client/);
    // Only the token's hash leaves the module, never Supabase's own action link.
    expect(admin).not.toContain("action_link");
  });

  test("auth log lines for the reset carry the outcome code only", () => {
    expect(authLogLine("auth.password_reset.request", "user_not_found")).toBe('{"event":"auth.password_reset.request","code":"user_not_found"}');
    expect(JSON.parse(authLogLine("auth.password_reset.request", "someone@example.test")).code).toBe("unknown");
    expect(JSON.parse(authLogLine("auth.password_reset.complete", `verify_${TOKEN}${TOKEN}`)).code).toBe("unknown");
  });
});

// The screens WITHOUT the Supabase variables and with email delivery disabled (the default e2e
// server), at every width (projects phone, tablet, desktop).
test.describe("password reset screens (no Supabase values, delivery disabled)", () => {
  test("/login: the centred \"שכחתי סיסמה\" link under the card's content; the notice after a reset", async ({ page }) => {
    await openPage(page, "/login");
    const link = page.getByRole("link", { name: M.forgotLink });
    await expect(link).toHaveAttribute("href", FORGOT_PASSWORD_PATH);
    await expect(link.locator("xpath=..")).toHaveCSS("text-align", "center");
    await expect(page.locator(".note")).toHaveCount(0);
    await expectLoginLayout(page, true);
    await openPage(page, PASSWORD_UPDATED_PATH);
    await expect(page.locator(".note")).toHaveText(M.updated);
    await expect(page.locator(".note")).toHaveAttribute("role", "status");
    await expect(page.locator(".note")).not.toHaveCSS("text-align", "center");
    // The URL never selects a sign-in state: the service message stays.
    await expect(page.locator(".login-alert")).toHaveText(SIGN_IN_MESSAGES.service);
    await expectLoginLayout(page, true);
    await link.click();
    await expect(page).toHaveURL(/\/login\/forgot$/);
  });

  test("/login/forgot: the form, the browser's email check, then the delivery-off state", async ({ page }) => {
    await openPage(page, FORGOT_PASSWORD_PATH);
    await expectLoginLayout(page, true);
    await expect(page.getByRole("heading", { level: 1, name: M.forgotTitle })).toHaveCSS("text-align", "center");
    await expect(page.getByText(M.forgotIntro)).toHaveCSS("text-align", "center");
    const email = page.getByLabel("אימייל", { exact: true });
    await expect(email).toHaveAttribute("dir", "ltr");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).not.toHaveAttribute("name", /.*/);
    await expect(page.locator(".login-form label")).not.toHaveCSS("text-align", "center");
    await expect(email).not.toHaveCSS("text-align", "center");
    // The button keeps the sign-in button's full width.
    const card = await page.locator(".login-card").boundingBox();
    const button = await page.getByRole("button", { name: M.send }).boundingBox();
    expect(card && button && Math.abs(card.width - 40 - button.width)).toBeLessThanOrEqual(2);
    await expect(page.getByRole("link", { name: M.backToLogin })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: M.backToLogin }).locator("xpath=..")).toHaveCSS("text-align", "center");

    // The browser's own check (the shared email rule).
    await page.getByRole("button", { name: M.send }).click();
    await expect(page.locator(".set-err")).toHaveText("חסר מייל");
    await expect(email).toBeFocused();
    await email.fill("not-an-email");
    await page.getByRole("button", { name: M.send }).click();
    await expect(page.locator(".set-err")).toHaveText("כתובת מייל לא תקינה");

    // Delivery is disabled here: the environment decides, before any Auth call.
    await email.fill("someone@example.test");
    await page.getByRole("button", { name: M.send }).click();
    await expect(page.locator(".login-alert")).toHaveText(M.deliveryOff);
    await expect(page.locator(".login-alert")).not.toHaveCSS("text-align", "center");
    await expect(page.getByRole("heading", { level: 1, name: M.forgotTitle })).toBeVisible();
    // Review fix 7: the answer replaced the form, so focus moved to the card's heading (no ring).
    const heading = page.getByRole("heading", { level: 1, name: M.forgotTitle });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute("tabindex", "-1");
    await expect(heading).toHaveCSS("outline-style", "none");
    await expect(page.getByLabel("אימייל", { exact: true })).toHaveCount(0);
    await expect(page.getByText(M.sentTitle)).toHaveCount(0);
    await expectLoginLayout(page, true);
    await page.getByRole("link", { name: M.backToLogin }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/login/reset without a token or a reset session: the invalid-link state", async ({ page }) => {
    for (const p of [RESET_PASSWORD_PATH, `${RESET_PASSWORD_PATH}?token_hash=XYZ`, `${RESET_PASSWORD_PATH}?token_hash=`]) {
      await openPage(page, p);
      await expect(page.getByRole("heading", { level: 1, name: M.resetTitle }), p).toBeVisible();
      await expect(page.locator(".login-alert"), p).toHaveText(M.invalidLink);
      await expect(page.locator('input[type="password"]'), p).toHaveCount(0);
      await expect(page.getByRole("link", { name: M.requestNew }), p).toHaveAttribute("href", FORGOT_PASSWORD_PATH);
      await expectLoginLayout(page, true);
    }
  });

  test("/login/reset with a token: the form; nothing external, no referrer; the browser's checks", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await openPage(page, `${RESET_PASSWORD_PATH}?token_hash=${TOKEN}`);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((url) => !url.startsWith(`${OPEN_URL}/`) && !url.startsWith("data:"))).toEqual([]);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expectLoginLayout(page, true);
    await expect(page.getByRole("heading", { level: 1, name: M.resetTitle })).toHaveCSS("text-align", "center");
    const first = page.getByLabel(M.newPassword, { exact: true });
    const second = page.getByLabel(M.confirmPassword, { exact: true });
    for (const input of [first, second]) {
      await expect(input).toHaveAttribute("type", "password");
      await expect(input).toHaveAttribute("autocomplete", "new-password");
      await expect(input).toHaveAttribute("dir", "ltr");
      await expect(input).not.toHaveAttribute("name", /.*/);
    }
    // Each field has its own eye, inside the field; it toggles only its own field.
    const toggles = page.locator(".pw-toggle");
    await expect(toggles).toHaveCount(2);
    const field = await first.boundingBox();
    const icon = await toggles.first().boundingBox();
    expect(field && icon && icon.x >= field.x && icon.x + icon.width <= field.x + field.width).toBe(true);
    await first.fill(password);
    await page.getByRole("button", { name: "הצגת הסיסמה החדשה" }).click();
    await expect(first).toHaveAttribute("type", "text");
    await expect(second).toHaveAttribute("type", "password");
    expect(await page.content()).not.toContain(password);

    // The browser's checks: a mismatch is shown under the fields, nothing is sent.
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") posts += 1;
    });
    await second.fill(`${password}x`);
    await page.getByRole("button", { name: M.save }).click();
    await expect(page.locator(".set-err")).toHaveText(M.mismatch);
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute("aria-invalid", "true");
    // Kept after a refusal in the browser (nothing was sent).
    await expect(first).toHaveValue(password);
    expect(posts).toBe(0);
    await first.fill("x".repeat(73));
    await page.getByRole("button", { name: M.save }).click();
    await expect(page.locator(".set-err")).toHaveText("הסיסמה ארוכה מדי");

    // Without the Supabase values the server cannot verify anything: the service message; the
    // fields are hidden and emptied after the call, and the link stays in the address bar.
    await first.fill(password);
    await second.fill(password);
    await page.getByRole("button", { name: "הצגת אימות הסיסמה" }).click();
    await page.getByRole("button", { name: M.save }).click();
    await expect(page.locator(".login-alert")).toHaveText(M.service);
    expect(posts).toBe(1);
    // Review fix 7: the server's answer is tied to "סיסמה חדשה" and focus returns there; a service
    // failure says nothing about the password (no aria-invalid).
    const alertId = await page.locator(".login-alert").getAttribute("id");
    expect(alertId).toBeTruthy();
    await expect(first).toHaveAttribute("aria-describedby", alertId ?? "missing");
    await expect(first).not.toHaveAttribute("aria-invalid", /.*/);
    await expect(first).toBeFocused();
    await expect(second).not.toHaveAttribute("aria-describedby", /.*/);
    await expect(first).toHaveValue("");
    await expect(second).toHaveValue("");
    await expect(first).toHaveAttribute("type", "password");
    await expect(second).toHaveAttribute("type", "password");
    expect(page.url()).toContain(`token_hash=${TOKEN}`);
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

test.describe("password reset email preview (/dev, gate-protected)", () => {
  test("the real template with a fictional link in a sandboxed frame, and the text version", async ({ page }) => {
    await openPage(page, "/dev/email-preview/password-reset");
    await expect(page.getByRole("heading", { level: 1, name: "תצוגת מייל · איפוס סיסמה" })).toBeVisible();
    await expect(page.getByText(PASSWORD_RESET_EMAIL_SUBJECT, { exact: true })).toBeVisible();
    const frame = page.locator('iframe[title="תצוגת המייל (HTML)"]');
    await expect(frame).toHaveAttribute("sandbox", "");
    const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
    expect(srcdoc).toContain('<html dir="rtl" lang="he">');
    expect(srcdoc).toContain("example.test/login/reset?token_hash=");
    const inner = page.frameLocator('iframe[title="תצוגת המייל (HTML)"]');
    await expect(inner.getByRole("link", { name: "בחירת סיסמה חדשה" })).toBeVisible();
    await expect(page.locator("pre")).toContainText("הקישור תקף לשעה ולשימוש אחד.");
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});
