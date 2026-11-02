import { expect, test } from "@playwright/test";
import { CLOSED_URL, DEV_PAGES, OPEN_URL, onlyInProject } from "./helpers";

// One build, two servers: /dev open (local flag) and /dev closed (no flag).
// Each page has a marker that proves its own content is (or is not) in the response.
const MARKERS: Record<(typeof DEV_PAGES)[number], string> = {
  "/dev/showcase": "FIXTURE-SENTINEL",
  "/dev/showcase/tech": "FIXTURE-SENTINEL",
  "/dev/showcase/office": "FIXTURE-SENTINEL",
  "/dev/showcase/sizes": "השוואת גדלים",
};

// Document, RSC navigation, prefetch and prerendered segment requests.
const VARIANTS: [string, (path: string) => string, Record<string, string>][] = [
  ["document", (p) => p, {}],
  ["RSC", (p) => `${p}?_rsc=x`, { RSC: "1" }],
  ["prefetch", (p) => `${p}?_rsc=x`, { RSC: "1", "Next-Router-Prefetch": "1" }],
  ["segment prefetch", (p) => p, { RSC: "1", "Next-Router-Prefetch": "1", "Next-Router-Segment-Prefetch": "/_tree" }],
  [".rsc file", (p) => `${p}.rsc`, {}],
  ["segment file", (p) => `${p}.segments/_tree.segment.rsc`, {}],
];

test.describe("/dev gate", () => {
  onlyInProject("desktop");

  for (const path of DEV_PAGES) {
    const marker = MARKERS[path];

    test(`${path}: open on localhost with the flag (positive control)`, async ({ request }) => {
      const res = await request.get(`${OPEN_URL}${path}`);
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain(marker);
    });

    for (const [name, url, headers] of VARIANTS) {
      test(`${path} (${name}): 404 without content when the gate is closed`, async ({ request }) => {
        const res = await request.get(`${CLOSED_URL}${url(path)}`, { headers, maxRedirects: 0 });
        expect(res.status()).toBe(404);
        expect(await res.text()).not.toContain(marker);
      });

      test(`${path} (${name}): 404 without content for a non-local Host`, async ({ request }) => {
        const res = await request.get(`${OPEN_URL}${url(path)}`, {
          headers: { ...headers, host: "evil.example" },
          maxRedirects: 0,
        });
        expect(res.status()).toBe(404);
        expect(await res.text()).not.toContain(marker);
      });
    }
  }

  test("trailing slash redirects, then the closed gate still returns 404", async ({ request }) => {
    const res = await request.get(`${CLOSED_URL}/dev/showcase/`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const followed = await request.get(`${CLOSED_URL}/dev/showcase/`);
    expect(followed.status()).toBe(404);
    expect(await followed.text()).not.toContain("FIXTURE-SENTINEL");
  });
});
