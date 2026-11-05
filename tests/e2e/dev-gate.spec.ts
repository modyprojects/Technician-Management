import { expect, test } from "@playwright/test";
import { CLOSED_URL, DEMO_PAGES, DEV_PAGES, OPEN_URL, onlyInProject } from "./helpers";

// One build, two servers: /dev open (local flag) and /dev closed (no flag).
// Each page has a marker that proves its own content is (or is not) in the response.
// Every UI-demo page carries the fixture sentinel (DemoPage).
const MARKERS: Record<(typeof DEV_PAGES)[number], string> = {
  "/dev/showcase": "FIXTURE-SENTINEL",
  "/dev/showcase/tech": "FIXTURE-SENTINEL",
  "/dev/showcase/office": "FIXTURE-SENTINEL",
  "/dev/showcase/sizes": "השוואת גדלים",
  ...(Object.fromEntries(DEMO_PAGES.map((p) => [p, "FIXTURE-SENTINEL"])) as Record<(typeof DEMO_PAGES)[number], string>),
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

  test("demo views behind query strings: 404 without content when the gate is closed", async ({ request }) => {
    for (const path of [
      "/dev/demo/office/mgr/calls?q=%D7%9B&status=followup&tech=e&page=2",
      "/dev/demo/office/mgr/analytics?tab=tech&tech=y&filter=cont",
      "/dev/demo/office/cs/analytics?tab=tech",
      "/dev/demo/office/mgr/calendar?view=week&date=2026-10-12&tech=y&req=48213&n=1",
      "/dev/demo/office/cs/calendar?view=month",
      "/dev/demo/tech/calendar?view=week&date=2026-10-19",
      "/dev/demo/tech/done?page=2",
      "/dev/demo/tech/done/47800/1?view=week&date=2026-10-21",
      "/dev/demo/tech/notifications?page=2",
      "/dev/demo/office/mgr/customers?q=%D7%9C%D7%95%D7%99&page=2",
      "/dev/demo/office/cs/back-from-field?tech=e&page=2",
      "/dev/demo/office/cs/unparsed?page=2",
      "/dev/demo/office/creator/products?q=kt-2041",
      "/dev/demo/office/mgr/review?status=resolved&page=2",
      "/dev/demo/outbox?page=2&id=ob-47969-1",
      // D57: the dashboard's views and the Manager's Settings › "משתמשים".
      "/dev/demo/office/mgr/analytics?tab=tech&period=custom&from=2026-10-01&to=2026-10-21",
      "/dev/demo/office/mgr/analytics?detail=today.missed",
      "/dev/demo/office/mgr/settings/accounts",
    ]) {
      const variants: Record<string, string>[] = [{}, { RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }];
      for (const headers of variants) {
        const res = await request.get(`${CLOSED_URL}${path}`, { headers, maxRedirects: 0 });
        expect(res.status(), path).toBe(404);
        expect(await res.text(), path).not.toContain("FIXTURE-SENTINEL");
      }
    }
  });

  test("the office landing's redirect (D57) never leaks past a closed gate: 404, no location", async ({ request }) => {
    for (const path of ["/dev/demo/office/mgr", "/dev/demo/office/creator", "/dev/demo/office/mgr/users"]) {
      const res = await request.get(`${CLOSED_URL}${path}`, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      expect(res.headers().location, path).toBeUndefined();
      expect(await res.text(), path).not.toContain("FIXTURE-SENTINEL");
    }
  });

  test("trailing slash redirects, then the closed gate still returns 404", async ({ request }) => {
    const res = await request.get(`${CLOSED_URL}/dev/showcase/`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const followed = await request.get(`${CLOSED_URL}/dev/showcase/`);
    expect(followed.status()).toBe(404);
    expect(await followed.text()).not.toContain("FIXTURE-SENTINEL");
  });
});
