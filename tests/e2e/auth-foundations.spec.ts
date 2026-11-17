import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ACCOUNT_ROLE_VALUES } from "@/features/accounts/data/types";
import { parseSupabasePublicEnv } from "@/features/auth/env-schema";
import { AREA_START, NEXT_PATH_MAX_LENGTH, postSignInPath, safeNextPath } from "@/features/auth/redirects";
import {
  accountAdminScope,
  callsAreaLinks,
  DB_ROLE_VALUES,
  dbRoleOf,
  isDbRole,
  officeLanding,
  officeNav,
  type OfficeNavHrefs,
  officeNavParent,
  officeRoleOf,
  roleArea,
  settingsTabsOffered,
  SIDEBAR_WORK_SCREEN_ROLES,
  uiRoleOf,
} from "@/features/auth/roles";
import { isHttpsRequest, sessionCookieOptions } from "@/features/auth/session-cookies";
import {
  ACTION_MESSAGES,
  AUTH_ADMIN_MESSAGES,
  authAdminErrorMessage,
  databaseErrorKind,
  databaseErrorMessage,
  SIGN_IN_MESSAGES,
  signInFailureKind,
  signInFailureMessage,
} from "@/features/data-access/supabase-errors";
import { PERMISSION_KEYS, type PermissionKey, type RolePermissions } from "@/features/reference/data/types";
import { CREATOR_SETTINGS_SECTIONS } from "@/features/settings/data/types";
import { onlyInProject } from "./helpers";

// Unit tests of the Step 2 foundations (Step 2 plan §5.1): the pure modules in features/ that the
// server-only lib/ wrappers use. No database, network or browser (the lib/ marker check reads the
// source files as text and never imports them). Every value is fictional; key-like strings are
// assembled at runtime so that no credential-shaped literal sits in the source.

const FICTIONAL_KEY = `sb_publishable_${"fictional_unit_test_value"}`;
const HTTPS_URL = "https://fictional-project.supabase.example";

test.describe("Supabase configuration schema (fails closed)", () => {
  onlyInProject("desktop");

  test("a valid https origin and publishable key are configured; the origin loses a trailing slash", () => {
    expect(parseSupabasePublicEnv({ url: `${HTTPS_URL}/`, publishableKey: FICTIONAL_KEY })).toEqual({
      configured: true,
      url: HTTPS_URL,
      publishableKey: FICTIONAL_KEY,
    });
    // Surrounding whitespace (a pasted value) is ignored.
    expect(parseSupabasePublicEnv({ url: ` ${HTTPS_URL} `, publishableKey: ` ${FICTIONAL_KEY}\n` })).toMatchObject({ configured: true });
  });

  test("plain http only on a loopback host (the local stack)", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
      expect(parseSupabasePublicEnv({ url, publishableKey: FICTIONAL_KEY }), url).toMatchObject({ configured: true });
    }
    for (const url of ["http://fictional-project.supabase.example", "http://10.0.0.1:54321", "http://127.0.0.1.example:54321"]) {
      expect(parseSupabasePublicEnv({ url, publishableKey: FICTIONAL_KEY }), url).toEqual({ configured: false, problems: ["url-invalid"] });
    }
  });

  test("missing values: undefined, empty or whitespace only", () => {
    for (const blank of [undefined, "", "   ", "\n"]) {
      expect(parseSupabasePublicEnv({ url: blank, publishableKey: blank })).toEqual({
        configured: false,
        problems: ["url-missing", "publishable-key-missing"],
      });
    }
    // A non-string value (not possible from process.env, but never trusted) counts as missing.
    expect(parseSupabasePublicEnv({ url: 42 as unknown as string, publishableKey: FICTIONAL_KEY })).toEqual({
      configured: false,
      problems: ["url-missing"],
    });
  });

  test("malformed URLs: not an origin, credentials, query, fragment, other schemes, too long", () => {
    for (const url of [
      "fictional-project.supabase.example",
      `${HTTPS_URL}/rest/v1`,
      `${HTTPS_URL}?x=1`,
      `${HTTPS_URL}?`,
      `${HTTPS_URL}#x`,
      "https://user:pass@fictional-project.supabase.example",
      "javascript:alert(1)",
      "ftp://fictional-project.supabase.example",
      "file:///etc/passwd",
      `https://${"a".repeat(2050)}.example`,
    ]) {
      expect(parseSupabasePublicEnv({ url, publishableKey: FICTIONAL_KEY }), url).toEqual({ configured: false, problems: ["url-invalid"] });
    }
  });

  test("only the new publishable key format: legacy JWT keys, secret keys and odd characters are refused", () => {
    const legacyJwtShaped = [`eyJ${"a".repeat(16)}`, `eyJ${"b".repeat(16)}`, "c".repeat(16)].join(".");
    const secretShaped = ["sb", "secret", "fictional_unit_test_value"].join("_");
    for (const publishableKey of [
      legacyJwtShaped,
      secretShaped,
      "sb_publishable_",
      "sb_publishable_has space",
      "sb_publishable_has.dot",
      "SB_PUBLISHABLE_fictional",
      `sb_publishable_${"x".repeat(600)}`,
    ]) {
      expect(parseSupabasePublicEnv({ url: HTTPS_URL, publishableKey })).toEqual({
        configured: false,
        problems: ["publishable-key-invalid"],
      });
    }
  });

  test("a refused configuration reports problem codes only, never the values", () => {
    const secretShaped = ["sb", "secret", "never_echoed_value"].join("_");
    const result = parseSupabasePublicEnv({ url: "http://never-echoed-host.example", publishableKey: secretShaped });
    expect(result).toEqual({ configured: false, problems: ["url-invalid", "publishable-key-invalid"] });
    expect(JSON.stringify(result)).not.toContain("never");
  });
});

test.describe("post-sign-in redirect allowlist (no open redirects)", () => {
  onlyInProject("desktop");

  test("internal paths inside the role's own area are kept", () => {
    for (const next of ["/office", "/office/", "/office/users", "/office/calls?q=abc&page=2", "/office?next=//elsewhere"]) {
      expect(safeNextPath(next, "office"), next).toBe(next);
    }
    for (const next of ["/tech", "/tech/visit/48213/1", "/tech/calendar?view=week&date=2026-11-05"]) {
      expect(safeNextPath(next, "tech"), next).toBe(next);
    }
  });

  test("other hosts, schemes, backslashes, encoded and control characters are refused", () => {
    for (const next of [
      "//evil.example",
      "///evil.example",
      "//evil.example/office",
      "/\\evil.example",
      "\\\\evil.example",
      "/office\\..\\tech",
      "https://evil.example/office",
      "http:/office",
      "javascript:alert(1)",
      "data:text/html,x",
      "/office%2F..%2Ftech",
      "/%2F%2Fevil.example",
      "/office/%2e%2e/tech",
      "%2Foffice",
      "/office\u0000",
      "/office\n/x",
      "/office\r\n",
      "/office\t",
      "/office users",
      "/office#fragment",
      "/office/משתמשים",
      "office",
      "",
    ]) {
      expect(safeNextPath(next, "office"), JSON.stringify(next)).toBeNull();
    }
  });

  test("dot segments, empty segments, neighbours and the other role area are refused", () => {
    for (const next of ["/office/../tech", "/office/./users", "/office/..", "/office//users", "/officers", "/office-x", "/tech", "/tech/office"]) {
      expect(safeNextPath(next, "office"), next).toBeNull();
    }
    for (const next of ["/office", "/office/users", "/technician", "/tech/../office"]) {
      expect(safeNextPath(next, "tech"), next).toBeNull();
    }
  });

  test("non-strings and overlong values are refused; the fallback is the area's start", () => {
    for (const next of [null, undefined, 42, ["/office"], { toString: () => "/office" }]) {
      expect(safeNextPath(next, "office")).toBeNull();
    }
    const long = `/office/${"a".repeat(NEXT_PATH_MAX_LENGTH)}`;
    expect(safeNextPath(long, "office")).toBeNull();
    expect(postSignInPath("//evil.example", "office")).toBe(AREA_START.office);
    expect(postSignInPath("/office/users", "tech")).toBe("/tech");
    expect(postSignInPath(undefined, "tech")).toBe("/tech");
    expect(postSignInPath("/office/users", "office")).toBe("/office/users");
  });
});

test.describe("role codes (database <-> UI) and role areas", () => {
  onlyInProject("desktop");

  test("every database role maps to one UI role and back", () => {
    const pairs = [
      ["creator", "creator"],
      ["manager", "mgr"],
      ["customer_service", "cs"],
      ["technician", "tech"],
    ] as const;
    expect(pairs.map(([db]) => db)).toEqual([...DB_ROLE_VALUES]);
    for (const [db, ui] of pairs) {
      expect(isDbRole(db)).toBe(true);
      expect(uiRoleOf(db)).toBe(ui);
      expect(dbRoleOf(ui)).toBe(db);
    }
    expect(new Set(pairs.map(([, ui]) => ui))).toEqual(new Set(ACCOUNT_ROLE_VALUES));
  });

  test("anything else is no role (deny by default)", () => {
    for (const value of ["admin", "Creator", "MANAGER", "mgr", "", " creator", "constructor", "__proto__", "toString", null, undefined, 1, {}]) {
      expect(isDbRole(value), String(value)).toBe(false);
      expect(uiRoleOf(value), String(value)).toBeNull();
    }
    for (const value of ["manager", "customer_service", "technician", "admin", "constructor", "__proto__", null, 1]) {
      expect(dbRoleOf(value), String(value)).toBeNull();
    }
  });

  test("role areas follow the role, never the device: technicians /tech, office roles /office", () => {
    expect(roleArea("tech")).toBe("tech");
    for (const role of ["creator", "mgr", "cs"] as const) {
      expect(roleArea(role)).toBe("office");
      expect(officeRoleOf(role)).toBe(role);
    }
    expect(officeRoleOf("tech")).toBeNull();
  });

  test("a value that is no role (typing bypassed) has no area and no office role (deny by default)", () => {
    for (const value of ["admin", "office", "Tech", "", "__proto__", "constructor", "toString", null, undefined, 1]) {
      expect(roleArea(value as never), String(value)).toBeNull();
      expect(officeRoleOf(value), String(value)).toBeNull();
    }
  });
});

/** Permission values (display only): the D33 defaults, as served by reference.permissions(role). */
function permissions(role: RolePermissions["role"], on: readonly PermissionKey[]): RolePermissions {
  const values = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, on.includes(key)])) as Record<PermissionKey, boolean>;
  return role === "creator" ? { role, status: "fixed", values } : { role, status: "temporary", values };
}
const MANAGER_DEFAULT = permissions(
  "mgr",
  PERMISSION_KEYS.filter((key) => key !== "settings" && key !== "usage"),
);
const CS_DEFAULT = permissions("cs", ["cal", "calls", "card"]);
const CREATOR_FIXED = permissions(
  "creator",
  PERMISSION_KEYS.filter((key) => key !== "usage"),
);

const ALL_HREFS: OfficeNavHrefs = {
  home: "/x/home",
  cal: "/x/cal",
  calls: "/x/calls",
  customers: "/x/customers",
  unparsed: "/x/unparsed",
  back: "/x/back",
  review: "/x/review",
  analytics: "/x/analytics",
  products: "/x/products",
  users: "/x/users",
  settings: (tab) => `/x/settings/${tab}`,
};

test.describe("navigation helpers per role (display only, G-04)", () => {
  onlyInProject("desktop");

  /** D57 (1): the Manager's and the Creator's sidebar with the default values. */
  const D57_KEYS = ["analytics", "cal", "calls", "unparsed", "settings"] as const;
  const D57_LABELS = ["דשבורד", "יומן טכנאים", "קריאות", "זימונים שלא נקלטו", "הגדרות"];
  const keysOf = (role: "mgr" | "cs" | "creator", p: RolePermissions, hrefs: OfficeNavHrefs = ALL_HREFS) =>
    officeNav(role, p, hrefs).map((item) => item.key);
  const areaKeys = (role: "mgr" | "cs" | "creator", p: RolePermissions) => callsAreaLinks(role, p, ALL_HREFS).map((link) => link.key);
  const flip = (base: RolePermissions, key: PermissionKey): RolePermissions => ({
    ...base,
    values: { ...base.values, [key]: !base.values[key] },
  });

  test("account administration is a fixed capability: Creator all, Manager Customer Service and Technicians, Customer Service none", () => {
    expect(accountAdminScope("creator")).toBe("all");
    expect(accountAdminScope("mgr")).toBe("cs-tech");
    expect(accountAdminScope("cs")).toBeNull();
  });

  test("Settings tabs: the Creator's seven; the Manager 'משתמשים' (D34) without `settings`; the D35 tabs only with `settings`", () => {
    expect(settingsTabsOffered("creator", CREATOR_FIXED)).toEqual(CREATOR_SETTINGS_SECTIONS);
    expect(CREATOR_SETTINGS_SECTIONS).not.toContain("accounts");
    expect(settingsTabsOffered("mgr", MANAGER_DEFAULT)).toEqual(["accounts"]);
    expect(MANAGER_DEFAULT.values.settings).toBe(false);
    expect(settingsTabsOffered("cs", CS_DEFAULT)).toEqual([]);
    expect(settingsTabsOffered("mgr", permissions("mgr", ["settings"]))).toEqual(["accounts", "places", "reasons", "types", "template"]);
    // "accounts" is the Manager's fixed capability: never from `settings`, never for another role.
    expect(settingsTabsOffered("mgr", permissions("mgr", []))).toEqual(["accounts"]);
    for (const on of [[], [...PERMISSION_KEYS]] as const) {
      expect(settingsTabsOffered("cs", permissions("cs", on))).not.toContain("accounts");
      expect(settingsTabsOffered("creator", permissions("creator", on))).not.toContain("accounts");
    }
  });

  test("sidebar per role with the default values: Manager and Creator the five D57 items; Customer Service unchanged", () => {
    expect(keysOf("mgr", MANAGER_DEFAULT)).toEqual(D57_KEYS);
    expect(officeNav("mgr", MANAGER_DEFAULT, ALL_HREFS).map((item) => item.label)).toEqual(D57_LABELS);
    expect(officeNav("mgr", MANAGER_DEFAULT, ALL_HREFS).at(-1)).toEqual({ key: "settings", label: "הגדרות", href: "/x/settings/accounts" });
    expect(keysOf("cs", CS_DEFAULT)).toEqual(["home", "cal", "calls", "customers", "unparsed", "back"]);
    expect(keysOf("creator", CREATOR_FIXED)).toEqual(D57_KEYS);
    const creatorNav = officeNav("creator", CREATOR_FIXED, ALL_HREFS);
    expect(creatorNav.map((item) => item.label)).toEqual(D57_LABELS);
    expect(creatorNav.find((item) => item.key === "settings")).toEqual({ key: "settings", label: "הגדרות", href: "/x/settings/users" });
    expect(creatorNav[0]).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
    expect(officeNav("mgr", MANAGER_DEFAULT, ALL_HREFS)[0]).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
    expect(officeNav("cs", CS_DEFAULT, ALL_HREFS)[0]?.label).toBe("בית");
    // No "לוח בקרה" and no "משתמשים" item for the Manager or the Creator.
    for (const role of ["mgr", "creator"] as const) {
      const labels = officeNav(role, role === "mgr" ? MANAGER_DEFAULT : CREATOR_FIXED, ALL_HREFS).map((item) => item.label);
      expect(labels, role).not.toContain("לוח בקרה");
      expect(labels, role).not.toContain("משתמשים");
    }
  });

  test("per key, from the Manager's default values: only `cal` changes the five items; the entry row follows its own keys", () => {
    const without = (...gone: string[]) => D57_KEYS.filter((key) => !gone.includes(key));
    const area = ["customers", "back", "review", "products"] as const;
    const areaWithout = (...gone: string[]) => area.filter((key) => !gone.includes(key));
    const expected: Record<PermissionKey, { nav: readonly string[]; area: readonly string[] }> = {
      cal: { nav: without("cal"), area },
      calls: { nav: D57_KEYS, area: areaWithout("customers") },
      card: { nav: D57_KEYS, area: areaWithout("review") },
      cancel: { nav: D57_KEYS, area },
      dashGen: { nav: D57_KEYS, area },
      dashTech: { nav: D57_KEYS, area },
      dashProd: { nav: D57_KEYS, area },
      export: { nav: D57_KEYS, area },
      settings: { nav: D57_KEYS, area },
      usage: { nav: D57_KEYS, area },
      products: { nav: D57_KEYS, area: areaWithout("products") },
      conflicts: { nav: D57_KEYS, area: areaWithout("review") },
      recordings: { nav: D57_KEYS, area },
    };
    expect(areaKeys("mgr", MANAGER_DEFAULT)).toEqual(area);
    for (const key of PERMISSION_KEYS) {
      const flipped = flip(MANAGER_DEFAULT, key);
      const nav = officeNav("mgr", flipped, ALL_HREFS);
      expect(
        nav.map((item) => item.key),
        key,
      ).toEqual(expected[key].nav);
      expect(areaKeys("mgr", flipped), key).toEqual(expected[key].area);
      // Two dashboard keys stay on, so the landing stays "דשבורד" whatever the key.
      expect(nav[0], key).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
      // "הגדרות" opens "משתמשים" (D34) first, also with `settings` on.
      expect(nav.at(-1), key).toEqual({ key: "settings", label: "הגדרות", href: "/x/settings/accounts" });
    }
    expect(callsAreaLinks("mgr", MANAGER_DEFAULT, ALL_HREFS)).toEqual([
      { key: "customers", label: "לקוחות", href: "/x/customers" },
      { key: "back", label: "חזרו מהשטח", href: "/x/back" },
      { key: "review", label: "פריטים לבדיקה", href: "/x/review" },
      { key: "products", label: "מוצרים", href: "/x/products" },
    ]);
  });

  test("per key, from Customer Service's default values: a key that is on adds its item; never account administration", () => {
    const base = ["home", "cal", "calls", "customers", "unparsed", "back"] as const;
    const keys = (on: readonly PermissionKey[]) => keysOf("cs", permissions("cs", on));
    expect(keys(["calls", "card"])).toEqual(base.filter((key) => key !== "cal"));
    expect(keys(["cal", "card"])).toEqual(base.filter((key) => key !== "customers"));
    expect(keys(["cal", "calls"])).toEqual(base);
    expect(keys(["cal", "calls", "card", "conflicts"])).toEqual([...base, "review"]);
    expect(keys(["cal", "calls", "conflicts"])).toEqual(base);
    expect(keys(["cal", "calls", "card", "products"])).toEqual([...base, "products"]);
    expect(keys(["cal", "calls", "card", "settings"])).toEqual([...base, "settings"]);
    for (const extra of ["cancel", "export", "usage", "recordings"] as const) {
      expect(keys(["cal", "calls", "card", extra]), extra).toEqual(base);
    }
    expect(keys([...PERMISSION_KEYS])).not.toContain("users");
    // Settings with `settings` on: only the D35 operational tabs, never the Creator's tabs.
    const withSettings = permissions("cs", ["cal", "calls", "card", "settings"]);
    expect(settingsTabsOffered("cs", withSettings)).toEqual(["places", "reasons", "types", "template"]);
    expect(officeNav("cs", withSettings, ALL_HREFS).at(-1)).toEqual({ key: "settings", label: "הגדרות", href: "/x/settings/places" });
  });

  test("Customer Service is unchanged by D57 for every single-key flip: landing, no entry row, no parent highlighting", () => {
    for (const key of PERMISSION_KEYS) {
      const flipped = flip(CS_DEFAULT, key);
      expect(officeLanding("cs", flipped, ALL_HREFS), key).toEqual({
        key: "home",
        label: flipped.values.dashGen ? "לוח בקרה" : "בית",
        href: "/x/home",
      });
      expect(officeNav("cs", flipped, ALL_HREFS)[0], key).toEqual(officeLanding("cs", flipped, ALL_HREFS));
      expect(callsAreaLinks("cs", flipped, ALL_HREFS), key).toEqual([]);
    }
    expect(callsAreaLinks("cs", permissions("cs", [...PERMISSION_KEYS]), ALL_HREFS)).toEqual([]);
    for (const key of ["home", "cal", "calls", "customers", "unparsed", "back", "review", "analytics", "products", "users", "settings"] as const) {
      expect(officeNavParent("cs", key), key).toBeNull();
    }
    expect(SIDEBAR_WORK_SCREEN_ROLES).toEqual(["cs"]);
  });

  test("dashboards: the Manager lands on 'דשבורד' with any one dashboard key, else on 'בית'; never 'לוח בקרה'", () => {
    const dashboards = ["dashGen", "dashTech", "dashProd"] as const;
    const managerWith = (on: readonly PermissionKey[]) =>
      permissions(
        "mgr",
        PERMISSION_KEYS.filter((key) => key !== "settings" && key !== "usage" && !(dashboards as readonly string[]).includes(key)).concat(on),
      );
    const noDashboards = officeNav("mgr", managerWith([]), ALL_HREFS);
    expect(noDashboards.map((item) => item.key)).not.toContain("analytics");
    expect(noDashboards[0]).toEqual({ key: "home", label: "בית", href: "/x/home" });
    expect(officeLanding("mgr", managerWith([]), ALL_HREFS)).toEqual({ key: "home", label: "בית", href: "/x/home" });
    for (const key of dashboards) {
      const nav = officeNav("mgr", managerWith([key]), ALL_HREFS);
      expect(nav[0], key).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
      expect(nav.map((item) => item.key).filter((k) => k === "home"), key).toEqual([]);
      expect(officeLanding("mgr", managerWith([key]), ALL_HREFS), key).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
      expect(officeLanding("creator", permissions("creator", [key]), ALL_HREFS), key).toEqual({
        key: "analytics",
        label: "דשבורד",
        href: "/x/analytics",
      });
    }
    // Without a dashboard address the landing is the home ("בית", never "לוח בקרה").
    expect(officeLanding("mgr", MANAGER_DEFAULT, { home: "/office" })).toEqual({ key: "home", label: "בית", href: "/office" });
    expect(officeLanding("mgr", MANAGER_DEFAULT, {})).toBeNull();
    for (const key of dashboards) {
      const nav = officeNav("cs", permissions("cs", ["cal", "calls", "card", key]), ALL_HREFS);
      expect(nav.find((item) => item.key === "analytics"), key).toEqual({ key: "analytics", label: "דשבורד", href: "/x/analytics" });
      expect(nav[0]?.label, key).toBe(key === "dashGen" ? "לוח בקרה" : "בית");
    }
  });

  test("the Creator: Settings from its first tab and no 'משתמשים' item, whatever the values", () => {
    for (const on of [[], [...PERMISSION_KEYS]] as const) {
      const nav = officeNav("creator", permissions("creator", on), ALL_HREFS);
      expect(nav.map((item) => item.key)).not.toContain("users");
      expect(nav.at(-1)).toEqual({ key: "settings", label: "הגדרות", href: "/x/settings/users" });
      expect(settingsTabsOffered("creator", permissions("creator", on))).toEqual(CREATOR_SETTINGS_SECTIONS);
    }
    // Every Creator-only screen stays reachable from the entry row with the fixed values.
    expect(areaKeys("creator", CREATOR_FIXED)).toEqual(["customers", "back", "review", "products"]);
  });

  test("parent highlighting (D57): entry-row screens belong to 'קריאות', the former 'משתמשים' address to 'הגדרות'", () => {
    for (const role of ["mgr", "creator"] as const) {
      for (const key of ["customers", "back", "review", "products"] as const) expect(officeNavParent(role, key), `${role} ${key}`).toBe("calls");
      expect(officeNavParent(role, "users"), role).toBe("settings");
      for (const key of ["home", "cal", "calls", "unparsed", "analytics", "settings"] as const) {
        expect(officeNavParent(role, key), `${role} ${key}`).toBeNull();
      }
    }
  });

  test("a key that is off hides its item; an item without an address is not listed (only built screens)", () => {
    const noCal = permissions("mgr", ["calls"]);
    expect(keysOf("mgr", noCal)).toEqual(["home", "calls", "unparsed", "settings"]);
    const builtOnly: OfficeNavHrefs = { home: "/office", users: "/office/users" };
    expect(officeNav("mgr", MANAGER_DEFAULT, builtOnly)).toEqual([{ key: "home", label: "בית", href: "/office" }]);
    expect(keysOf("creator", CREATOR_FIXED, { home: "/office" })).toEqual(["home"]);
    expect(officeNav("cs", CS_DEFAULT, {})).toEqual([]);
    expect(callsAreaLinks("mgr", MANAGER_DEFAULT, { customers: "/office/customers" })).toEqual([
      { key: "customers", label: "לקוחות", href: "/office/customers" },
    ]);
  });
});

test.describe("Supabase errors to Hebrew messages (no raw database or Auth text)", () => {
  onlyInProject("desktop");

  test("database errors by SQLSTATE code, never by text or HTTP status", () => {
    const cases: [string, string][] = [
      ["42501", ACTION_MESSAGES.forbidden],
      ["22023", ACTION_MESSAGES.invalid],
      ["23514", ACTION_MESSAGES.invalid],
      ["23502", ACTION_MESSAGES.invalid],
      ["23503", ACTION_MESSAGES.invalid],
      ["23505", ACTION_MESSAGES.duplicate],
      ["PT409", ACTION_MESSAGES.stale],
    ];
    for (const [code, message] of cases) {
      expect(databaseErrorMessage({ code, message: "raw database detail", details: "x", hint: "y" }), code).toBe(message);
    }
    expect(databaseErrorMessage({ code: "42501", status: 200 })).toBe(ACTION_MESSAGES.forbidden);
  });

  test("55000 business refusals by their exact Migration 1 text; any other text is generic", () => {
    const known: [string, string][] = [
      ["an open request exists", "קיימת כבר יצירה פתוחה לכתובת המייל הזו."],
      ["a pending request exists", "קיימת כבר בקשה פתוחה."],
      ["the request is not pending", "הבקשה כבר טופלה."],
      ["the request does not apply", "הבקשה אינה מתאימה לחשבון הזה."],
      ["the request no longer applies", "הבקשה כבר אינה רלוונטית."],
      ["the request cannot be cancelled", "לא ניתן לבטל את הבקשה."],
      ["requires the Creator's approval", "הפעולה דורשת אישור של היוצר."],
      ["the profile is not a Technician", "החשבון אינו חשבון טכנאי."],
      ["the Technician already has a field profile", "לטכנאי כבר יש פרופיל טכנאי."],
      ["profiles: a profile with a technician record keeps its role", "לא ניתן לשנות את התפקיד של חשבון טכנאי."],
      ["profiles: the last active Creator cannot be demoted or deactivated", "לא ניתן להשבית את היוצר הפעיל האחרון או לשנות את תפקידו."],
      ["value locked until an open owner decision", "הערך נעול עד להחלטת הבעלים."],
      ["value already approved", "הערך כבר אושר."],
    ];
    for (const [message, hebrew] of known) {
      expect(databaseErrorMessage({ code: "55000", message }), message).toBe(hebrew);
      expect(databaseErrorKind({ code: "55000", message })).toBe("state");
    }
    for (const message of [
      "a Creator already exists",
      "audit_logs is append-only",
      "AN OPEN REQUEST EXISTS",
      "an open request exists ",
      "constructor",
      "__proto__",
      "",
    ]) {
      expect(databaseErrorMessage({ code: "55000", message }), message).toBe(ACTION_MESSAGES.unknown);
    }
    expect(databaseErrorMessage({ code: "55000" })).toBe(ACTION_MESSAGES.unknown);
  });

  test("missing database objects are their own kind (Migration 1 not applied) with the generic message", () => {
    for (const code of ["PGRST205", "PGRST202", "PGRST204", "PGRST106", "42P01", "42883", "42703", "3F000"]) {
      expect(databaseErrorKind({ code }), code).toBe("missing-object");
      expect(databaseErrorMessage({ code }), code).toBe(ACTION_MESSAGES.unknown);
    }
  });

  test("unknown codes, network failures and non-errors are generic; the raw text never leaks", () => {
    const leaky = { code: "XX000", message: "relation private.secret_table at 10.0.0.5" };
    expect(databaseErrorMessage(leaky)).toBe(ACTION_MESSAGES.unknown);
    expect(databaseErrorMessage(leaky)).not.toContain("secret");
    for (const error of [
      { code: "", message: "TypeError: fetch failed" },
      new TypeError("fetch failed"),
      { code: "constructor" },
      { code: "__proto__" },
      { code: "toString" },
      { code: 42501 },
      { code: "4".repeat(100) },
      null,
      undefined,
      "42501",
      42501,
    ]) {
      expect(databaseErrorKind(error), JSON.stringify(error) ?? String(error)).toBe("unknown");
      expect(databaseErrorMessage(error)).toBe(ACTION_MESSAGES.unknown);
    }
  });

  test("Auth Admin errors by Auth error code; an address already in Auth names a safe request reference only", () => {
    const ref = "0b7e3f1a-1111-4222-8333-944455556666";
    // A Manager is told to ask the Creator; the Creator never is (review N2).
    expect(authAdminErrorMessage({ code: "email_exists", status: 422 }, { requestRef: ref })).toBe(
      `כתובת המייל כבר רשומה במערכת ההתחברות. פנו ליוצר (מספר בקשה ${ref}).`,
    );
    expect(authAdminErrorMessage({ code: "email_exists", status: 422 }, { requestRef: ref, forCreator: true })).toBe(
      `כתובת המייל כבר רשומה במערכת ההתחברות (מספר בקשה ${ref}).`,
    );
    expect(authAdminErrorMessage({ code: "user_already_exists" })).toBe(`${AUTH_ADMIN_MESSAGES.emailExists}. ${AUTH_ADMIN_MESSAGES.askCreator}.`);
    expect(authAdminErrorMessage({ code: "user_already_exists" }, { forCreator: true })).toBe(`${AUTH_ADMIN_MESSAGES.emailExists}.`);
    expect(authAdminErrorMessage({ code: "email_exists" }, { forCreator: true })).not.toContain(AUTH_ADMIN_MESSAGES.askCreator);
    for (const bad of ["<b>x</b>", "a b", "x".repeat(65), ""]) {
      expect(authAdminErrorMessage({ code: "email_exists" }, { requestRef: bad }), bad).toBe(`${AUTH_ADMIN_MESSAGES.emailExists}. ${AUTH_ADMIN_MESSAGES.askCreator}.`);
    }
    expect(authAdminErrorMessage({ code: "weak_password", message: "Password should be at least 6 characters" })).toBe(AUTH_ADMIN_MESSAGES.weakPassword);
    expect(authAdminErrorMessage({ code: "user_not_found" })).toBe(AUTH_ADMIN_MESSAGES.userNotFound);
    expect(authAdminErrorMessage({ code: "over_request_rate_limit", status: 429 })).toBe(AUTH_ADMIN_MESSAGES.rateLimited);
    expect(authAdminErrorMessage({ code: "validation_failed" })).toBe(ACTION_MESSAGES.invalid);
    expect(authAdminErrorMessage({ code: "email_address_invalid" })).toBe(ACTION_MESSAGES.invalid);
    expect(authAdminErrorMessage({ code: "not_admin", status: 403 })).toBe(ACTION_MESSAGES.forbidden);
    for (const error of [{ name: "AuthRetryableFetchError", status: 0 }, { code: "unexpected_failure", status: 500 }, { code: "constructor" }, null]) {
      expect(authAdminErrorMessage(error)).toBe(ACTION_MESSAGES.unknown);
    }
  });

  test("sign-in: account-related refusals share one message; everything else is a service failure", () => {
    for (const error of [
      { code: "invalid_credentials", status: 400 },
      { code: "email_not_confirmed", status: 400 },
      { code: "user_banned", status: 400 },
      { code: "user_not_found", status: 400 },
      { status: 400, message: "Invalid login credentials" },
    ]) {
      expect(signInFailureKind(error), JSON.stringify(error)).toBe("credentials");
      expect(signInFailureMessage(error)).toBe(SIGN_IN_MESSAGES.credentials);
    }
    for (const error of [
      { code: "over_request_rate_limit", status: 429 },
      { code: "unexpected_failure", status: 500 },
      { code: "validation_failed", status: 400 },
      { code: "constructor", status: 400 },
      { name: "AuthRetryableFetchError", status: 0 },
      { status: 503 },
      new TypeError("fetch failed"),
      null,
      "invalid_credentials",
    ]) {
      expect(signInFailureKind(error), JSON.stringify(error) ?? String(error)).toBe("service");
      expect(signInFailureMessage(error)).toBe(SIGN_IN_MESSAGES.service);
    }
    expect(SIGN_IN_MESSAGES.credentials).not.toBe(SIGN_IN_MESSAGES.service);
  });
});

test.describe("session cookie attributes (HttpOnly, SameSite=Lax, Path=/, Secure on https)", () => {
  onlyInProject("desktop");

  test("forced over whatever the library passes; the lifetime is kept", () => {
    const loose = { httpOnly: false, sameSite: "none" as const, path: "/elsewhere", domain: "evil.example", secure: false, maxAge: 0 };
    expect(sessionCookieOptions(loose, true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      domain: undefined,
      secure: true,
      maxAge: 0,
    });
    expect(sessionCookieOptions({ maxAge: 34_560_000 }, false)).toMatchObject({ httpOnly: true, secure: false, maxAge: 34_560_000 });
  });

  test("Secure is dropped only for an explicit plain-http request (the local server)", () => {
    expect(isHttpsRequest("http")).toBe(false);
    expect(isHttpsRequest(" HTTP ")).toBe(false);
    expect(isHttpsRequest("http, https")).toBe(false);
    for (const value of ["https", "https,http", "", null, undefined, "ftp"]) {
      expect(isHttpsRequest(value), String(value)).toBe(true);
    }
  });
});

// CLAUDE.md "server-only module checks"; Step 2 plan §3.1: every lib/ module starts with
// `import "server-only"`, so a client component that imports it fails the build. A `"use server"`
// module (plan §3.1 lib/actions) must start with its directive, so the marker may follow it.
const LEADING_TRIVIA = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;
function startsServerOnly(source: string): boolean {
  let rest = source.replace(/^\uFEFF/, "").replace(LEADING_TRIVIA, "");
  const directive = /^(["'])use server\1[ \t]*;?/.exec(rest);
  if (directive) rest = rest.slice(directive[0].length).replace(LEADING_TRIVIA, "");
  return /^import\s*(["'])server-only\1[ \t]*(?:;|\r?\n|$)/.test(rest);
}

test.describe("lib/ modules are server-only", () => {
  onlyInProject("desktop");

  test("the marker check accepts only the marker as the first statement (after a \"use server\" directive at most)", () => {
    for (const source of [
      'import "server-only";\nexport const a = 1;',
      "// header\n/* more */\nimport 'server-only'\nexport {};",
      '"use server";\n\nimport "server-only";\nexport async function f() {}',
    ]) {
      expect(startsServerOnly(source), source).toBe(true);
    }
    for (const source of [
      "export const a = 1;",
      'import { x } from "y";\nimport "server-only";',
      '// import "server-only";\nexport const a = 1;',
      '/* import "server-only"; */\nexport {};',
      '"use client";\nimport "server-only";',
      'import "server-only-ish";',
      'import "server-only".x;',
      "",
    ]) {
      expect(startsServerOnly(source), source).toBe(false);
    }
  });

  test('every lib/ source file starts with import "server-only"', () => {
    const files = readdirSync(path.resolve("lib"), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file))
      .map((file) => path.join("lib", file).split(path.sep).join("/"))
      .sort();
    // The scan must reach the modules that exist today, or it proves nothing.
    expect(files).toEqual(expect.arrayContaining(["lib/supabase/env.ts", "lib/supabase/server.ts"]));
    const missing = files.filter((file) => !startsServerOnly(readFileSync(path.resolve(file), "utf8")));
    expect(missing).toEqual([]);
  });
});
