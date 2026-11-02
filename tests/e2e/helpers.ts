import { test, type Page } from "@playwright/test";

// Two servers from one production build: /dev open (local flag) and /dev closed (no flag).
export const OPEN_URL = "http://127.0.0.1:3100";
export const CLOSED_URL = "http://127.0.0.1:3101";

export const DEV_PAGES = [
  "/dev/showcase",
  "/dev/showcase/tech",
  "/dev/showcase/office",
  "/dev/showcase/sizes",
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
      if (!insideScroller && /hidden|clip/.test(style.overflowX) && style.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
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
