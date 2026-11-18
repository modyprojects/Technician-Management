import { expect, test, type Page } from "@playwright/test";

// Two servers from one production build: /dev open (local flag) and /dev closed (no flag).
export const OPEN_URL = "http://127.0.0.1:3100";
export const CLOSED_URL = "http://127.0.0.1:3101";

/** UI demo with fictional data (D53): one address per screen and role, plus the closed-visit card. */
export const DEMO_PAGES = [
  "/dev/demo",
  "/dev/demo/office/mgr",
  "/dev/demo/office/cs",
  "/dev/demo/office/mgr/calls",
  "/dev/demo/office/cs/calls",
  "/dev/demo/office/mgr/calls/48213",
  "/dev/demo/office/mgr/calls/48205",
  "/dev/demo/office/mgr/calls/48140",
  "/dev/demo/office/mgr/calls/48230",
  "/dev/demo/office/mgr/calls/47969",
  "/dev/demo/office/cs/calls/48205",
  "/dev/demo/office/mgr/analytics",
  "/dev/demo/office/cs/analytics",
  "/dev/demo/tech",
  "/dev/demo/tech/visit/48213/1",
  "/dev/demo/tech/visit/48205/2",
  "/dev/demo/tech/visit/47800/1",
  "/dev/demo/tech/visit/48213/1/work",
  "/dev/demo/tech/visit/48205/2/work",
  "/dev/demo/tech/visit/48213/1/close",
  "/dev/demo/tech/visit/48205/2/close",
  "/dev/demo/office/mgr/calendar",
  "/dev/demo/office/cs/calendar",
  "/dev/demo/tech/calendar",
  "/dev/demo/tech/done",
  "/dev/demo/tech/done/47800/1",
  "/dev/demo/tech/notifications",
  "/dev/demo/tech/profile",
  // Phase E: the Creator viewpoint, Settings tabs and the Manager's account administration.
  "/dev/demo/office/creator",
  "/dev/demo/office/creator/calendar",
  "/dev/demo/office/creator/calls",
  "/dev/demo/office/creator/calls/48140",
  "/dev/demo/office/creator/analytics",
  "/dev/demo/office/creator/settings/users",
  "/dev/demo/office/creator/settings/techs",
  "/dev/demo/office/creator/settings/places",
  "/dev/demo/office/creator/settings/reasons",
  "/dev/demo/office/creator/settings/types",
  "/dev/demo/office/creator/settings/mail",
  "/dev/demo/office/creator/settings/template",
  "/dev/demo/office/creator/users",
  "/dev/demo/office/mgr/users",
  "/dev/demo/office/cs/users",
  "/dev/demo/office/mgr/settings/users",
  "/dev/demo/office/mgr/settings/techs",
  "/dev/demo/office/mgr/settings/places",
  "/dev/demo/office/mgr/settings/reasons",
  "/dev/demo/office/mgr/settings/types",
  "/dev/demo/office/mgr/settings/mail",
  "/dev/demo/office/mgr/settings/template",
  "/dev/demo/office/cs/settings/users",
  "/dev/demo/office/cs/settings/techs",
  "/dev/demo/office/cs/settings/places",
  "/dev/demo/office/cs/settings/reasons",
  "/dev/demo/office/cs/settings/types",
  "/dev/demo/office/cs/settings/mail",
  "/dev/demo/office/cs/settings/template",
  // Phase F: customers and the customer card, unparsed invitations, back from field, products.
  "/dev/demo/office/mgr/customers",
  "/dev/demo/office/cs/customers",
  "/dev/demo/office/creator/customers",
  "/dev/demo/office/mgr/customers/cu-298747",
  "/dev/demo/office/cs/customers/cu-235395",
  "/dev/demo/office/creator/customers/cu-179962",
  "/dev/demo/office/mgr/unparsed",
  "/dev/demo/office/cs/unparsed",
  "/dev/demo/office/creator/unparsed",
  "/dev/demo/office/mgr/back-from-field",
  "/dev/demo/office/cs/back-from-field",
  "/dev/demo/office/creator/back-from-field",
  "/dev/demo/office/mgr/products",
  "/dev/demo/office/cs/products",
  "/dev/demo/office/creator/products",
  // Phase G: review items (open, resolved, no access), closed-visit corrections on the call card
  // (Creator, customer service), the mock outbox (a /dev tool) and a closed visit with device sync
  // state at both technician addresses.
  "/dev/demo/office/mgr/review",
  "/dev/demo/office/cs/review",
  "/dev/demo/office/creator/review",
  "/dev/demo/office/mgr/review/rv-6",
  "/dev/demo/office/cs/review/rv-1",
  "/dev/demo/office/creator/review/rv-7",
  "/dev/demo/office/mgr/review/rv-3",
  "/dev/demo/office/creator/calls/47948",
  "/dev/demo/office/cs/calls/47969",
  "/dev/demo/outbox",
  "/dev/demo/tech/done/47963/1",
  "/dev/demo/tech/visit/47963/1",
  // D57: Settings › "משתמשים" (the Manager's account administration; no access for customer
  // service; a pointer for the Creator). /dev/demo/office/mgr and /mgr/users above redirect (307):
  // page.goto follows them.
  "/dev/demo/office/mgr/settings/accounts",
  "/dev/demo/office/cs/settings/accounts",
  "/dev/demo/office/creator/settings/accounts",
  // Step 2 PR 2.3 prototypes: the sign-in screen, each role's temporary start screen (Q18) and the
  // technician's minimal profile.
  "/dev/demo/login",
  "/dev/demo/start/creator",
  "/dev/demo/start/mgr",
  "/dev/demo/start/cs",
  "/dev/demo/start/tech",
  "/dev/demo/start/tech/profile",
] as const;

/** The fixture sentinel every showcase and demo page carries (app/dev/showcase/_fixtures.ts). */
export const FIXTURE_SENTINEL = "FIXTURE-SENTINEL-TM-STEP0";

export const DEV_PAGES = [
  "/dev/showcase",
  "/dev/showcase/tech",
  "/dev/showcase/office",
  "/dev/showcase/sizes",
  ...DEMO_PAGES,
  // D65: the password-reset email's preview (fictional link), for the owner's review.
  "/dev/email-preview/password-reset",
] as const;

/**
 * The real routes (Step 2 PR 2.5; the user management, D60 (7)). Without the Supabase variables each
 * one shows /login's unavailable state, except the password-reset screens (D65): /login/forgot shows
 * its form and /login/reset its invalid-link state.
 */
export const REAL_PAGES = [
  "/",
  "/login",
  "/office",
  "/tech",
  "/tech/profile",
  "/login/forgot",
  "/login/reset",
  // The unified user management (D60 (7)): Settings › "משתמשים" / "משתמשים והרשאות".
  "/office/settings",
  "/office/settings/users",
] as const;

export const ALL_PAGES = [...REAL_PAGES, "/no-such-page", ...DEV_PAGES] as const;

export async function openPage(page: Page, path: string) {
  await page.goto(path);
  // Load every face explicitly so layout is measured with the real fonts, not fallbacks.
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
}

/** Runs the calling describe block only in one project (checks that do not depend on width). */
export function onlyInProject(name: "phone" | "tablet" | "desktop") {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== name, `runs in the ${name} project only`);
  });
}

/**
 * Horizontal overflow outside the places where the demo scrolls sideways on purpose
 * (.scrollx tables and the size-view strip). Returns offending descriptions.
 */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    const width = root.clientWidth;
    const scrollers = [root, ...document.querySelectorAll<HTMLElement>(".stage, .ph-main, .work")];
    for (const el of scrollers) {
      if (el.scrollWidth > el.clientWidth + 1) {
        problems.push(`${el.className || el.tagName} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // The scroll wrapper itself is still checked; only its descendants may extend past the viewport.
      const insideScroller = el.parentElement?.closest(".scrollx, [data-size-strip]");
      if (el.matches(".scrollx, [data-size-strip]") && !/auto|scroll/.test(style.overflowX)) {
        problems.push(`<${el.tagName.toLowerCase()} class="${el.className}"> should scroll sideways but does not`);
      }
      // Visually hidden text for screen readers (.sr-only: a 1px clipped box) clips on purpose.
      const visuallyHidden = el.clientWidth <= 1 && el.clientHeight <= 1 && style.position === "absolute";
      if (
        !insideScroller &&
        !visuallyHidden &&
        /hidden|clip/.test(style.overflowX) &&
        style.textOverflow !== "ellipsis" &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        problems.push(`<${el.tagName.toLowerCase()} class="${el.className}"> clips ${el.scrollWidth - el.clientWidth}px of content`);
      }
      if (insideScroller) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.left < -1 || rect.right > width + 1) {
        problems.push(`<${el.tagName.toLowerCase()} class="${el.className}"> spans ${Math.round(rect.left)}..${Math.round(rect.right)} of ${width}`);
      }
    }
    return problems;
  });
}

/**
 * The demo pages scroll inside their frame (.stage, .ph-main), never the document itself: returns
 * how far the document extends below the window (0 when it does not). Absolutely positioned
 * screen-reader text whose containing block is the page can stretch it into empty space.
 */
export async function verticalPageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight - 1));
}

export async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`No box for ${selector}`);
  return b;
}

const centreX = (b: { x: number; width: number }) => b.x + b.width / 2;

/**
 * The sign-in page's layout (owner UI corrections of 2026-11-17, AU-01), shared by the sign-in and
 * the password-reset screens (D65): the logo group sits at the top of the page (.login), 48px down
 * and horizontally centred, and the card is centred in it (vertically when it fits under the logo,
 * otherwise below the logo, never overlapping it); no horizontal overflow. On a real route the page
 * is the whole viewport (`fullViewport`); the prototype keeps the demo's strip above it (dev chrome),
 * so there the page is the area under the strip.
 */
export async function expectLoginLayout(page: Page, fullViewport = false) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  const area = await page.locator("main.login").boundingBox();
  const brand = await page.locator(".login-brand").boundingBox();
  const logo = await page.locator(".brand-logo-login").boundingBox();
  const card = await page.locator(".login-card").boundingBox();
  if (!area || !brand || !logo || !card) throw new Error("no sign-in page");
  if (fullViewport) {
    expect(area.y).toBeLessThanOrEqual(0.5);
    expect(area.height).toBeGreaterThanOrEqual(viewport.height - 0.5);
  }
  // Logo and subtitle at the top (48px down, as before), horizontally centred.
  expect(Math.abs(logo.y - (area.y + 48))).toBeLessThanOrEqual(1);
  expect(Math.abs(centreX(logo) - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(centreX(brand) - viewport.width / 2)).toBeLessThanOrEqual(2);
  // The card: horizontally centred; vertically centred in the page when it fits under the logo,
  // otherwise below the logo (never overlapping it).
  expect(Math.abs(centreX(card) - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(card.y).toBeGreaterThanOrEqual(brand.y + brand.height - 0.5);
  const centredTop = area.y + (area.height - card.height) / 2;
  if (centredTop >= brand.y + brand.height) {
    expect(Math.abs(card.y + card.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(2);
  }
  expect(await horizontalOverflow(page)).toEqual([]);
}
