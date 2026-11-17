import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { telHref, wazeHref, whatsappHref } from "@/features/visits/data/links";
import { TECH_DONE_PATH, TECH_HOME_PATH, techVisitPath } from "@/features/visits/data/paths";
import { greetingAt, jerusalemToday } from "@/features/visits/data/today";
import { visitStatusOfDb, warrantyText } from "@/features/visits/supabase/tech";
import { onlyInProject } from "./helpers";

// Step 3, the real technician home and visit card: the pure rules (links, warranty text, the status
// codes, Asia/Jerusalem "today" and the greeting) and source checks of the pages' guards and data
// access. The pages themselves are tested against the local stack (tests/auth/tech-today.spec.ts);
// without the Supabase variables every technician route goes to /login (auth-real-routes.spec.ts).

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

test.describe("technician screens: pure rules", () => {
  onlyInProject("desktop");

  test("Waze, phone and WhatsApp links are built from stored values only, encoded", () => {
    expect(wazeHref("הרצל 14, רחובות")).toBe(`https://waze.com/ul?q=${encodeURIComponent("הרצל 14, רחובות")}&navigate=yes`);
    expect(wazeHref("  ")).toBeNull();
    expect(wazeHref('a"&b=<x>')).toBe("https://waze.com/ul?q=a%22%26b%3D%3Cx%3E&navigate=yes");
    expect(telHref("050-123-4567")).toBe("tel:0501234567");
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
    for (const bad of ["", "abc", "050-123-4567; x", "javascript:alert(1)", "12", "1".repeat(30)]) expect(telHref(bad), bad).toBeNull();
    expect(whatsappHref("050-123-4567")).toBe("https://wa.me/972501234567");
    expect(whatsappHref("+44 20 7946 0958")).toBe("https://wa.me/442079460958");
    expect(whatsappHref("5012345")).toBeNull();
  });

  test("warranty text (TE-08, D42): yes, yes until a month, no, not given", () => {
    expect(warrantyText("yes", null)).toBe("כן");
    expect(warrantyText("yes", "2028-03-01")).toBe("כן · עד 03/2028");
    expect(warrantyText("no", null)).toBe("לא");
    expect(warrantyText(null, null)).toBe("");
  });

  test("the database's status codes map to the five user-facing statuses; cancelled is never shown (D60 (1))", () => {
    expect(["scheduled", "en_route", "in_progress", "done", "followup"].map(visitStatusOfDb).map((s) => s && VISIT_STATUSES[s].label)).toEqual([
      "שובצה",
      "בדרך",
      "בטיפול",
      "טופל",
      "המשך טיפול",
    ]);
    expect(visitStatusOfDb("cancelled")).toBe("cancel");
    for (const bad of ["", "open", "toString", "__proto__", null, 3]) expect(visitStatusOfDb(bad)).toBeNull();
  });

  test("today and the greeting follow Asia/Jerusalem, never the server's zone (G-01)", () => {
    // 22:30 UTC on 2026-11-17 is 00:30 on 2026-11-18 in Jerusalem (UTC+2 in winter).
    expect(jerusalemToday(new Date("2026-11-17T22:30:00Z"))).toBe("2026-11-18");
    expect(jerusalemToday(new Date("2026-07-01T20:59:00Z"))).toBe("2026-07-01");
    expect(greetingAt(new Date("2026-11-17T06:00:00Z"))).toBe("בוקר טוב");
    expect(greetingAt(new Date("2026-11-17T11:00:00Z"))).toBe("צהריים טובים");
    expect(greetingAt(new Date("2026-11-17T18:00:00Z"))).toBe("ערב טוב");
  });

  test("the real addresses", () => {
    expect([TECH_HOME_PATH, TECH_DONE_PATH, techVisitPath("a/b?c")]).toEqual(["/tech", "/tech/done", "/tech/visit/a%2Fb%3Fc"]);
  });
});

test.describe("technician screens: guards and data access (source checks)", () => {
  onlyInProject("desktop");

  test("every technician page checks the session itself and reads through the request-scoped queries", () => {
    for (const p of ["app/(tech)/tech/page.tsx", "app/(tech)/tech/done/page.tsx", "app/(tech)/tech/visit/[id]/page.tsx"]) {
      const source = read(p);
      expect(source, p).toContain('await requireArea("tech")');
      expect(source, p).toContain("techVisitsQueries(me)");
      expect(source, p).not.toMatch(/from "@\/app\/dev|_data\/|_fixtures/);
    }
  });

  test("the queries run under the caller's session: server-only wiring, no secret key, no service role", () => {
    const wiring = read("lib/data/supabase/tech-visits.ts");
    expect(wiring).toContain('import "server-only";');
    expect(wiring).toContain("createUserSupabaseClient()");
    for (const p of ["lib/data/supabase/tech-visits.ts", "features/visits/supabase/tech.ts"]) {
      const source = read(p);
      expect(source, p).not.toMatch(/SECRET|service_role|admin/i);
    }
    const queries = read("features/visits/supabase/tech.ts");
    // Cancelled visits are excluded in the query and again when mapping.
    expect(queries).toContain('.neq("status", "cancelled")');
    expect(queries).toContain('if (status === "cancel") return null;');
    // Never the tables a Technician has no policy on.
    expect(queries).not.toMatch(/from\("(service_calls|customers|products|visit_time_reports)"\)/);
  });
});
