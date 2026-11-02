import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { onlyInProject, openPage } from "./helpers";

const DEMO_URL = pathToFileURL(path.resolve("docs/demo.html")).href;
const FONT_TOKENS = new Set(["--display", "--body"]);

// App-only names for colours the demo hard-codes (app/globals.css).
const NAMED_DEMO_COLOURS: Record<string, string> = {
  "--control-line": "#C9D1DA",
  "--danger-line": "#E3A29B",
  "--seg-bg": "#E4E7EB",
  "--stat-line": "#3A4A5B",
  "--note-line": "#B7D4DE",
};

// Every custom property declared in the demo's :root, resolved by the browser.
async function demoRootTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const computed = getComputedStyle(document.documentElement);
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin (Google Fonts) stylesheet
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
          for (const name of Array.from(rule.style)) {
            if (name.startsWith("--")) out[name] = computed.getPropertyValue(name).trim();
          }
        }
      }
    }
    return out;
  });
}

// Normalise colours through the browser (hex case, short forms) and font stacks.
async function normalise(page: Page, tokens: Record<string, string>): Promise<Record<string, string>> {
  return page.evaluate(
    ({ tokens, fontTokens }) => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const out: Record<string, string> = {};
      for (const [name, value] of Object.entries(tokens)) {
        if (fontTokens.includes(name)) {
          out[name] = value
            .split(",")
            .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
            .filter((f) => !/ Fallback$/.test(f))
            .join(",")
            .toLowerCase();
          continue;
        }
        probe.style.color = "";
        probe.style.color = value;
        out[name] = probe.style.color ? getComputedStyle(probe).color : value;
      }
      probe.remove();
      return out;
    },
    { tokens, fontTokens: [...FONT_TOKENS] },
  );
}

test.describe("design tokens", () => {
  onlyInProject("desktop");

  test("every demo :root token has the same value in the app", async ({ page }) => {
    // Tokens come from the demo's inline <style>; its Google Fonts link is not needed here.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(DEMO_URL, { waitUntil: "domcontentloaded" });
    const demoRaw = await demoRootTokens(page);
    expect(Object.keys(demoRaw).length).toBe(46);
    const demo = await normalise(page, demoRaw);

    await openPage(page, "/dev/showcase");
    const appRaw = await page.evaluate((names) => {
      const computed = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((n) => [n, computed.getPropertyValue(n).trim()]));
    }, Object.keys(demoRaw));
    const app = await normalise(page, appRaw);

    expect(app).toEqual(demo);
  });

  test("named versions of hard-coded demo colours keep the demo values", async ({ page }) => {
    const demoSource = readFileSync(path.resolve("docs/demo.html"), "utf8").toUpperCase();
    for (const hex of Object.values(NAMED_DEMO_COLOURS)) expect(demoSource).toContain(hex);
    await openPage(page, "/dev/showcase");
    const appRaw = await page.evaluate((names) => {
      const computed = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((n) => [n, computed.getPropertyValue(n).trim()]));
    }, Object.keys(NAMED_DEMO_COLOURS));
    expect(await normalise(page, appRaw)).toEqual(await normalise(page, NAMED_DEMO_COLOURS));
  });

  test("Rubik and Assistant are loaded in the weights the demo uses", async ({ page }) => {
    await openPage(page, "/dev/showcase");
    // document.fonts.check() falls back to the nearest weight, so list the declared faces instead.
    const faces = await page.evaluate(() =>
      [...new Set(
        [...document.fonts]
          .filter((f) => f.status === "loaded")
          .map((f) => `${f.family.replace(/"/g, "")}:${f.weight}`)
          .filter((s) => /^(Rubik|Assistant):/.test(s)),
      )].sort(),
    );
    expect(faces).toEqual(["Assistant:400", "Assistant:600", "Assistant:700", "Rubik:500", "Rubik:600", "Rubik:700"]);
    const headingFont = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(headingFont).toMatch(/^"?Rubik"?/);
    expect(bodyFont).toMatch(/^"?Assistant"?/);
  });
});
