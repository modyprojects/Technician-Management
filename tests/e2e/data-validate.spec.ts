import { expect, test } from "@playwright/test";
import { ACCOUNT_ROLE_VALUES, activationKind, isAccountRole } from "@/features/accounts/data/types";
import {
  accountDecisionError,
  accountRequestError,
  accountRequestTargetError,
  accountStateError,
  newTechnicianError,
  pendingRequestError,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import { backFromFieldHref, parseBackFromFieldState } from "@/features/calls/data/search-params";
import { normalizeBackFromFieldQuery } from "@/features/calls/data/validate";
import { customersListHref, parseCustomersListState } from "@/features/customers/data/search-params";
import { isCustomerId, normalizeCustomerListQuery } from "@/features/customers/data/validate";
import { filterListValues } from "@/features/data-access/common";
import { parseProductsListState, productsListHref } from "@/features/products/data/search-params";
import { isNormalizedSku, normalizeSku } from "@/features/products/data/types";
import {
  isProductOptionId,
  normalizeProductListQuery,
  PRODUCT_NAME_MAX,
  productNameError,
  productOptionError,
  productUpdateError,
  productVersionError,
  skuError,
} from "@/features/products/data/validate";
import { reasonDeletable } from "@/features/settings/data/types";
import {
  placeDeleteError,
  reasonDeleteError,
  setPermissionError,
  templateLabelRequiredError,
} from "@/features/settings/data/validate";
import { onlyInProject } from "./helpers";

// Negative tests of the shared validators (features/*/data/validate.ts) that every implementation
// runs: the simulated commands now, the server later (which repeats them under the caller's
// session). The screens hide most of these cases, so only these tests reach them. Pure logic.

/** A user-facing error never names a decision code (d08, D17 ...): the screen shows the pending hint. */
const NO_DECISION_CODE = /\b[dD]\d{2}\b/;

test.describe("settings validators (SE-02, SE-06, SE-07, SE-15)", () => {
  onlyInProject("desktop");

  test("setPermission: the Creator is never a matrix role; pending cells and unknown input are rejected", () => {
    expect(setPermissionError("creator", "cal", true)).not.toBeNull();
    expect(setPermissionError("tech", "cal", true)).not.toBeNull();
    expect(setPermissionError("mgr", "bogus", true)).not.toBeNull();
    expect(setPermissionError("mgr", "cal", "yes")).not.toBeNull();
    for (const [role, key] of [
      ["cs", "cancel"],
      ["cs", "usage"],
      ["mgr", "usage"],
    ] as const) {
      const error = setPermissionError(role, key, true);
      expect(error, `${role}:${key}`).not.toBeNull();
      expect(error ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(setPermissionError("mgr", "cancel", false)).toBeNull();
    expect(setPermissionError("cs", "cal", true)).toBeNull();
  });

  test("template labels: the D17 labels stay required; unknown keys and values are rejected", () => {
    for (const key of ["req", "customerNo"]) {
      const error = templateLabelRequiredError(key, false);
      expect(error, key).not.toBeNull();
      expect(error ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(templateLabelRequiredError("bogus", true)).not.toBeNull();
    expect(templateLabelRequiredError("warranty", "on")).not.toBeNull();
    expect(templateLabelRequiredError("warranty", true)).toBeNull();
  });

  test("deletes: a referenced place, a used reason and an initial reason cannot be deleted", () => {
    expect(placeDeleteError({ inUse: true })).not.toBeNull();
    expect(placeDeleteError(undefined)).not.toBeNull();
    expect(placeDeleteError({ inUse: false })).toBeNull();

    expect(reasonDeleteError({ inUse: true, userAdded: true })).not.toBeNull();
    expect(reasonDeleteError({ inUse: false, userAdded: false })).not.toBeNull();
    expect(reasonDeleteError(undefined)).not.toBeNull();
    expect(reasonDeleteError({ inUse: false, userAdded: true })).toBeNull();

    expect(reasonDeletable({ inUse: false, userAdded: false })).toBe(false);
    expect(reasonDeletable({ inUse: true, userAdded: true })).toBe(false);
    expect(reasonDeletable({ inUse: false, userAdded: true })).toBe(true);
  });
});

test.describe("account validators (D34)", () => {
  onlyInProject("desktop");

  test("a Manager's request never names a Manager or Creator role, and its shape is checked", () => {
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "mgr" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "creator" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "bad id!", newRole: "cs" })).not.toBeNull();
    expect(accountRequestError({ kind: "bogus" } as never)).not.toBeNull();
    expect(accountRequestError({ kind: "create", name: "נציגה", email: "not-an-email", phone: "050-000-0000" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "cs" })).toBeNull();
    expect(accountRequestError({ kind: "create", name: "נציגה", email: "rep@example.test", phone: "050-000-0000" })).toBeNull();
  });

  test("the request's target is checked against its stored role and state", () => {
    expect(accountRequestTargetError("activate", { role: "mgr", active: false })).not.toBeNull();
    expect(accountRequestTargetError("reactivate", { role: "creator", active: false })).not.toBeNull();
    expect(accountRequestTargetError("reactivate", { role: "tech", active: false })).not.toBeNull();
    expect(accountRequestTargetError("activate", { role: "cs", active: true })).not.toBeNull();
    expect(accountRequestTargetError("activate", undefined)).not.toBeNull();
    expect(accountRequestTargetError("role-change", { role: "mgr", active: true })).not.toBeNull();
    expect(accountRequestTargetError("reactivate", { role: "cs", active: false })).toBeNull();
    expect(accountRequestTargetError("role-change", { role: "tech", active: true })).toBeNull();
    expect(accountRequestTargetError("create", undefined)).toBeNull();
  });

  test("decisions: a rejection needs a reason; only a pending request is decided or cancelled", () => {
    expect(accountDecisionError({ outcome: "reject", reason: "   " })).not.toBeNull();
    expect(accountDecisionError({ outcome: "reject", reason: "x".repeat(301) })).not.toBeNull();
    expect(accountDecisionError({ outcome: "maybe" } as never)).not.toBeNull();
    expect(accountDecisionError({ outcome: "reject", reason: "אין צורך" })).toBeNull();
    expect(accountDecisionError({ outcome: "approve" })).toBeNull();

    for (const status of ["approved", "rejected", "cancelled", undefined] as const) {
      expect(pendingRequestError(status), String(status)).not.toBeNull();
    }
    expect(pendingRequestError("pending")).toBeNull();
  });

  test("(de)activation needs the opposite stored state; activate vs reactivate is explicit", () => {
    expect(accountStateError("deactivate", false)).not.toBeNull();
    expect(accountStateError("activate", true)).not.toBeNull();
    expect(accountStateError("deactivate", undefined)).not.toBeNull();
    expect(accountStateError("deactivate", true)).toBeNull();
    expect(accountStateError("activate", false)).toBeNull();
    expect(activationKind({ deactivatedAt: null })).toBe("activate");
    expect(activationKind({ deactivatedAt: "2026-09-01T09:00:00+03:00" })).toBe("reactivate");
  });

  test("test users use example.test addresses; technician inputs are allowlisted", () => {
    expect(testAccountEmailError("someone@example.com")).not.toBeNull();
    expect(testAccountEmailError("someone@example.test.evil.com")).not.toBeNull();
    expect(testAccountEmailError("Someone@Example.Test")).toBeNull();
    const tech = { name: "טכנאי", email: "t@example.test", phone: "050-000-0000", color: "t-y" as const, device: "סמארטפון" };
    expect(newTechnicianError(tech)).toBeNull();
    expect(newTechnicianError({ ...tech, color: "url(https://evil.example)" as never })).not.toBeNull();
    expect(newTechnicianError({ ...tech, device: "  " })).not.toBeNull();
  });
});

test.describe("list filters (deny by default)", () => {
  onlyInProject("desktop");

  test("an unknown filter value never widens a list to every record", () => {
    expect(filterListValues(undefined, isAccountRole, ACCOUNT_ROLE_VALUES)).toBeNull();
    expect(filterListValues(["bogus"], isAccountRole, ACCOUNT_ROLE_VALUES)).toEqual([]);
    expect(filterListValues("cs", isAccountRole, ACCOUNT_ROLE_VALUES)).toEqual([]);
    expect(filterListValues([], isAccountRole, ACCOUNT_ROLE_VALUES)).toEqual([]);
    expect(filterListValues(["cs", "bogus", "cs"], isAccountRole, ACCOUNT_ROLE_VALUES)).toEqual(["cs"]);
    expect(filterListValues([...ACCOUNT_ROLE_VALUES], isAccountRole, ACCOUNT_ROLE_VALUES)).toBeNull();
  });
});

test.describe("phase F validators (PR-06, PR-07, OF-16)", () => {
  onlyInProject("desktop");

  test("SKUs are matched trimmed and upper-case (PR-07)", () => {
    expect(normalizeSku(" kt-2041 ")).toBe("KT-2041");
    expect(isNormalizedSku("KT-2041")).toBe(true);
    expect(isNormalizedSku("kt-2041")).toBe(false);
    expect(isNormalizedSku(" KT-2041")).toBe(false);
    expect(isNormalizedSku("")).toBe(false);
    expect(isNormalizedSku("A\u0000B")).toBe(false);
    expect(isNormalizedSku("X".repeat(41))).toBe(false);
  });

  test("product edit: a valid SKU and version, at least one field, never an empty name", () => {
    const base = { sku: "KT-2041", expectedVersion: 1 };
    expect(productUpdateError({ ...base, name: "ברז" })).toBeNull();
    expect(productUpdateError({ ...base, brandId: null })).toBeNull();
    expect(productUpdateError(base)).not.toBeNull();
    expect(productUpdateError({ ...base, name: "  " })).not.toBeNull();
    expect(productUpdateError({ ...base, sku: "kt-2041", name: "ברז" })).not.toBeNull();
    expect(productUpdateError({ ...base, expectedVersion: 0, name: "ברז" })).not.toBeNull();
    expect(productUpdateError({ ...base, brandId: "../x" })).not.toBeNull();
    expect(productUpdateError(null as never)).not.toBeNull();
  });

  test("product edit against stored data: unknown or inactive options and stale versions are rejected", () => {
    expect(productOptionError(null, undefined, "מותג")).toBeNull();
    expect(productOptionError("br-x", undefined, "מותג")).not.toBeNull();
    expect(productOptionError("br-x", { active: false }, "מותג")).not.toBeNull();
    expect(productOptionError("br-x", { active: true }, "ספק")).toBeNull();
    expect(productVersionError(1, undefined)).not.toBeNull();
    expect(productVersionError(1, { version: 2 })).not.toBeNull();
    expect(productVersionError(2, { version: 2 })).toBeNull();
  });

  test("customer ids and list queries; back from field needs a valid date", () => {
    expect(isCustomerId("cu-298747")).toBe(true);
    expect(isCustomerId("../etc")).toBe(false);
    expect(isCustomerId("")).toBe(false);
    expect(normalizeCustomerListQuery({ q: "x".repeat(300), page: -3, limit: 1000 })).toEqual({ q: "x".repeat(100), page: 1, limit: 100 });
    expect(() => normalizeBackFromFieldQuery({ asOf: "2026-02-31" })).toThrow(RangeError);
    expect(normalizeBackFromFieldQuery({ asOf: "2026-10-21", technicianId: "<b>" }).technicianId).toBeUndefined();
  });
});

test.describe("phase F negative cases (inputs a screen never sends)", () => {
  onlyInProject("desktop");

  test("product edit: names, SKUs and option ids outside the rules are rejected, with no decision code", () => {
    const base = { sku: "KT-2041", expectedVersion: 3 };
    const errors = [
      productNameError(""),
      productNameError(42),
      productNameError("x".repeat(PRODUCT_NAME_MAX + 1)),
      skuError(" KT-2041 "),
      skuError(null),
      productUpdateError({ ...base, name: "x".repeat(PRODUCT_NAME_MAX + 1) }),
      productUpdateError({ ...base, expectedVersion: 1.5, name: "ברז" }),
      productUpdateError({ ...base, expectedVersion: -1, brandId: null }),
      productUpdateError({ ...base, supplierId: "<script>" }),
      productUpdateError({ ...base, brandId: "a".repeat(65) }),
      productUpdateError({ ...base, sku: "", name: "ברז" }),
    ];
    for (const e of errors) {
      expect(e).not.toBeNull();
      expect(e ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(productNameError(`  ${"x".repeat(PRODUCT_NAME_MAX)}  `)).toBeNull();
    expect(productUpdateError({ ...base, supplierId: null, brandId: "br-aqua" })).toBeNull();
    expect(isProductOptionId("br-aqua")).toBe(true);
    expect(isProductOptionId("00000000-0000-4000-8000-000000000000")).toBe(true);
    for (const bad of ["", "../x", "a b", "x".repeat(65), 7, null]) expect(isProductOptionId(bad), String(bad)).toBe(false);
  });

  test("list queries and URL state: oversized, malformed or unknown values fall back to safe defaults", () => {
    expect(normalizeProductListQuery({ q: "y".repeat(500), page: Number.NaN, limit: -5 })).toEqual({ q: "y".repeat(100), page: 1, limit: 1 });
    expect(normalizeProductListQuery(undefined)).toEqual({ q: "", page: 1, limit: 40 });
    expect(normalizeCustomerListQuery(undefined)).toEqual({ q: "", page: 1, limit: 40 });

    for (const parse of [parseCustomersListState, parseProductsListState]) {
      expect(parse({ q: ["a", "b"], page: "-2" })).toEqual({ q: "a", page: 1 });
      expect(parse(new URLSearchParams("q=%20%20&page=abc"))).toEqual({ q: "", page: 1 });
      expect(parse({ q: "z".repeat(300), page: "3" })).toEqual({ q: "z".repeat(100), page: 3 });
    }
    expect(customersListHref("/c", { q: "  ", page: 1 })).toBe("/c");
    expect(customersListHref("/c", { q: "לוי", page: 2 })).toBe(`/c?q=${encodeURIComponent("לוי")}&page=2`);
    expect(productsListHref("/p", { q: "kt-2041", page: 0 })).toBe("/p?q=kt-2041");

    expect(parseBackFromFieldState({ tech: "<b>", page: "0" })).toEqual({ tech: "all", page: 1 });
    expect(parseBackFromFieldState(new URLSearchParams("tech=e&page=2"))).toEqual({ tech: "e", page: 2 });
    expect(backFromFieldHref("/b", { tech: "../x", page: 1.5 })).toBe("/b");
    expect(backFromFieldHref("/b", { tech: "e", page: 2 })).toBe("/b?tech=e&page=2");
  });

  test("customer ids: never a bare path or an oversized key; the back-from-field query clamps paging", () => {
    for (const bad of ["cu-1/../2", "a".repeat(65), " cu-1", null, 298747]) expect(isCustomerId(bad), String(bad)).toBe(false);
    expect(isCustomerId("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(() => normalizeBackFromFieldQuery({ asOf: "21.10.2026" })).toThrow(RangeError);
    expect(() => normalizeBackFromFieldQuery(undefined as never)).toThrow(RangeError);
    expect(normalizeBackFromFieldQuery({ asOf: "2026-10-21", page: 0, limit: 1000 })).toEqual({
      asOf: "2026-10-21",
      technicianId: undefined,
      page: 1,
      limit: 100,
    });
  });
});
