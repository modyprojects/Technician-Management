import { expect, test } from "@playwright/test";
import { onlyInProject } from "./helpers";

test.describe("security headers", () => {
  onlyInProject("desktop");

  for (const path of ["/", "/dev/showcase", "/no-such-page"]) {
    test(`${path}: baseline headers and noindex`, async ({ request }) => {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
      expect(h["content-security-policy"]).toContain("object-src 'none'");
      expect(h["x-robots-tag"]).toBe("noindex, nofollow");
      expect(h["x-powered-by"]).toBeUndefined();
    });
  }

  test("unknown route returns the Hebrew 404 page", async ({ request }) => {
    const res = await request.get("/no-such-page");
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("העמוד לא נמצא");
  });
});
