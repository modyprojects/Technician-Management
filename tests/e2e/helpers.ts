import { test, type Page } from "@playwright/test";

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
] as const;

/** The fixture sentinel every showcase and demo page carries (app/dev/showcase/_fixtures.ts). */
export const FIXTURE_SENTINEL = "FIXTURE-SENTINEL-TM-STEP0";

export const DEV_PAGES = [
  "/dev/showcase",
  "/dev/showcase/tech",
  "/dev/showcase/office",
  "/dev/showcase/sizes",
  ...DEMO_PAGES,
] as const;

export const ALL_PAGES = ["/", "/no-such-page", ...DEV_PAGES] as const;

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

export async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`No box for ${selector}`);
  return b;
}
