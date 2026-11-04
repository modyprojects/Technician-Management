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
import { filterListValues, ownValue } from "@/features/data-access/common";
import { parseProductsListState, productsListHref } from "@/features/products/data/search-params";
import { isNormalizedSku, normalizeSku } from "@/features/products/data/types";
import {
  isProductOptionId,
  normalizeProductListQuery,
  PRODUCT_NAME_MAX,
  productEditError,
  productNameError,
  productOptionError,
  productUpdateError,
  productVersionError,
  skuError,
} from "@/features/products/data/validate";
import { outboxHref, parseOutboxViewState } from "@/features/outbox/data/search-params";
import { isOutboxId } from "@/features/outbox/data/validate";
import { parseReviewListState, reviewListHref, reviewListQueryOf } from "@/features/review/data/search-params";
import { REVIEW_NOTE_MAX, type ReviewResolveInput } from "@/features/review/data/types";
import {
  isReviewItemId,
  normalizeReviewListQuery,
  reviewResolutionError,
  reviewResolveInputError,
  type ReviewResolveStored,
} from "@/features/review/data/validate";
import { reasonDeletable } from "@/features/settings/data/types";
import { visitSyncState } from "@/features/sync/data/types";
import { isOperationId, syncNowError, syncRetryError } from "@/features/sync/data/validate";
import { visitRefKey, type CorrectableValues, type VisitCorrectionInput } from "@/features/visits/data/types";
import {
  CORRECTION_REASON_MAX,
  correctionValueError,
  visitCorrectionError,
  visitCorrectionInputError,
  type VisitCorrectionStored,
} from "@/features/visits/data/validate";
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

  test("the edit as the command checks it (productEditError): deny by default without stored data; own keys only", () => {
    const edit = { sku: "KT-2041", expectedVersion: 1, name: "ברז" };
    const nothing = { product: undefined, brand: undefined, supplier: undefined };
    // No stored state (any screen but "מוצרים" in the demo; a product the caller cannot see): refused.
    expect(productEditError(edit, nothing)).toBe("המוצר לא נמצא");
    expect(productEditError(edit, { ...nothing, product: { version: 1 } })).toBeNull();
    expect(productEditError(edit, { ...nothing, product: { version: 2 } })).toBe("המוצר עודכן בינתיים · יש לרענן את הדף");
    // Nothing to change comes first, before any stored lookup.
    expect(productEditError({ sku: "KT-2041", expectedVersion: 1 }, { ...nothing, product: { version: 1 } })).toBe("אין שינוי לשמור");
    // Options: an unknown id is "not found", an inactive one "not active".
    const brands: Readonly<Record<string, { active: boolean }>> = { "br-aqua": { active: true }, "br-hydro": { active: false } };
    const withBrand = (brandId: string) =>
      productEditError({ ...edit, brandId }, { product: { version: 1 }, brand: ownValue(brands, brandId), supplier: undefined });
    expect(withBrand("br-aqua")).toBeNull();
    expect(withBrand("br-hydro")).toBe("המותג לא פעיל");
    expect(withBrand("br-none")).toBe("המותג לא נמצא");
    // Ids with valid key syntax that name Object.prototype members are not stored records.
    for (const id of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(ownValue(brands, id), id).toBeUndefined();
      expect(withBrand(id), id).toBe("המותג לא נמצא");
    }
    expect(ownValue(undefined, "br-aqua")).toBeUndefined();
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

test.describe("phase G validators (D44 review items, OF-10 corrections, TE-24 sync, the /dev outbox)", () => {
  onlyInProject("desktop");

  /** A stored open item with a conflicting field and a required note (the D14 case). */
  const ITEM: ReviewResolveStored = {
    version: 2,
    status: "open",
    decisions: ["apply-incoming", "keep-current", "per-field"],
    choosable: ["summary", "nextNote"],
    conflicts: ["nextNote"],
    noteRequired: true,
    canResolve: true,
  };
  const resolve = (over: Partial<ReviewResolveInput> = {}): ReviewResolveInput => ({
    id: "rv-6",
    expectedVersion: 2,
    decision: "apply-incoming",
    note: "אושר בטלפון",
    ...over,
  });

  test("review resolution: deny by default; caller, status, version, decision, per-field choices and the note are checked", () => {
    expect(reviewResolutionError(resolve(), ITEM)).toBeNull();
    expect(reviewResolutionError(resolve({ decision: "per-field", fields: { summary: "incoming", nextNote: "current" } }), ITEM)).toBeNull();
    const errors = [
      reviewResolutionError(resolve(), undefined),
      reviewResolutionError(resolve(), { ...ITEM, canResolve: false }),
      reviewResolutionError(resolve(), { ...ITEM, status: "resolved" }),
      reviewResolutionError(resolve({ expectedVersion: 1 }), ITEM),
      reviewResolutionError(resolve(), { ...ITEM, decisions: ["keep-current"] }),
      reviewResolutionError(resolve({ decision: "per-field", fields: { summary: "incoming" } }), ITEM),
      reviewResolutionError(resolve({ decision: "per-field", fields: { nextNote: "current", other: "current" } }), ITEM),
      // Own keys only: a prototype name is not a stored field.
      reviewResolutionError(resolve({ decision: "per-field", fields: JSON.parse('{"nextNote":"current","constructor":"current"}') }), ITEM),
      reviewResolutionError(resolve({ note: undefined }), ITEM),
      reviewResolutionError(resolve({ note: "   " }), ITEM),
    ];
    for (const e of errors) {
      expect(e).not.toBeNull();
      expect(e ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(reviewResolutionError(resolve(), undefined)).toBe("הפריט לא נמצא");
    expect(reviewResolutionError(resolve({ note: undefined }), ITEM)).toBe("יש לכתוב הערת החלטה");
    // Without the D14 rule the note is optional.
    expect(reviewResolutionError(resolve({ note: undefined }), { ...ITEM, noteRequired: false })).toBeNull();
  });

  test("review resolution input: shapes a screen never sends are rejected", () => {
    const bad: unknown[] = [
      null,
      "rv-6",
      resolve({ id: "../rv-6" }),
      resolve({ id: "x".repeat(65) }),
      resolve({ expectedVersion: 0 }),
      resolve({ expectedVersion: 1.5 }),
      resolve({ decision: "delete" as never }),
      resolve({ fields: { summary: "incoming" } }),
      resolve({ decision: "per-field" }),
      resolve({ decision: "per-field", fields: {} }),
      resolve({ decision: "per-field", fields: [] as never }),
      resolve({ decision: "per-field", fields: { summary: "mine" as never } }),
      resolve({ decision: "per-field", fields: { "<b>": "current" } }),
      resolve({ note: 7 as never }),
      resolve({ note: "x".repeat(REVIEW_NOTE_MAX + 1) }),
    ];
    for (const input of bad) {
      const e = reviewResolveInputError(input as ReviewResolveInput);
      expect(e, JSON.stringify(input)).not.toBeNull();
      expect(e ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(isReviewItemId("00000000-0000-4000-8000-000000000000")).toBe(true);
    for (const id of ["", "rv 1", "rv/1", null, 6]) expect(isReviewItemId(id), String(id)).toBe(false);
  });

  test("review list query and URL state fall back to safe defaults", () => {
    expect(normalizeReviewListQuery({ status: "deleted" as never, page: -3, limit: 5000 })).toEqual({ status: undefined, page: 1, limit: 100 });
    expect(normalizeReviewListQuery(undefined)).toEqual({ status: undefined, page: 1, limit: 40 });
    expect(parseReviewListState({ status: ["resolved", "open"], page: "2" })).toEqual({ status: "resolved", page: 2 });
    expect(parseReviewListState(new URLSearchParams("status=<x>&page=abc"))).toEqual({ status: "open", page: 1 });
    expect(reviewListQueryOf({ status: "all", page: 3 }, 40)).toEqual({ status: undefined, page: 3, limit: 40 });
    expect(reviewListHref("/r", { status: "open", page: 1 })).toBe("/r");
    expect(reviewListHref("/r", { status: "bogus" as never, page: 0.5 })).toBe("/r");
    expect(reviewListHref("/r", { status: "all", page: 2 })).toBe("/r?status=all&page=2");
  });

  const CURRENT: CorrectableValues = {
    summary: "בוצע תיקון",
    parts: [],
    followupReason: null,
    nextNote: null,
    departAt: "07:30",
    arriveAt: "07:58",
    endAt: "08:40",
  };
  const VISIT: VisitCorrectionStored = {
    version: 3,
    status: "done",
    current: CURRENT,
    correctable: ["summary", "parts", "departAt", "arriveAt", "endAt"],
    canCorrect: true,
    reasons: ["ממתין לחלקי חילוף"],
  };
  const correct = (over: Partial<VisitCorrectionInput> = {}): VisitCorrectionInput => ({
    visitRef: { req: "47969", n: 1 },
    field: "summary",
    newValue: "הוחלפה מחסנית",
    reason: "השלמה לפי הטכנאי",
    expectedVersion: 3,
    ...over,
  });

  test("closed-visit correction: never the signed approval text, the signer or the signature; a reason is required", () => {
    expect(visitCorrectionError(correct(), VISIT)).toBeNull();
    expect(visitCorrectionError(correct({ field: "parts", newValue: ["מחסנית מפצל BT-1120"] }), VISIT)).toBeNull();
    expect(visitCorrectionError(correct({ field: "endAt", newValue: "08:22" }), VISIT)).toBeNull();
    for (const field of ["signedText", "signerName", "signature"]) {
      expect(visitCorrectionInputError(correct({ field: field as never })), field).toBe("נוסח האישור החתום, שם החותם והחתימה אינם ניתנים לתיקון");
    }
    const errors = [
      visitCorrectionError(correct(), undefined),
      visitCorrectionError(correct(), { ...VISIT, canCorrect: false }),
      visitCorrectionError(correct({ expectedVersion: 2 }), VISIT),
      visitCorrectionError(correct({ reason: "  " }), VISIT),
      visitCorrectionError(correct({ reason: "x".repeat(CORRECTION_REASON_MAX + 1) }), VISIT),
      visitCorrectionError(correct({ newValue: " בוצע תיקון " }), VISIT),
      // Follow-up fields only on a visit closed as "המשך טיפול".
      visitCorrectionError(correct({ field: "nextNote", newValue: "להביא חלק" }), VISIT),
      visitCorrectionError(correct({ field: "followupReason", newValue: "ממתין לחלקי חילוף" }), { ...VISIT, correctable: [...VISIT.correctable, "followupReason"] }),
      visitCorrectionError(correct({ field: "followupReason", newValue: "סיבה שלא קיימת" }), {
        ...VISIT,
        status: "cont",
        current: { ...CURRENT, followupReason: "ממתין לחלקי חילוף" },
        correctable: [...VISIT.correctable, "followupReason"],
      }),
      visitCorrectionInputError(correct({ field: "bogus" as never })),
      visitCorrectionInputError(correct({ visitRef: { req: "../x", n: 1 } })),
      visitCorrectionInputError(correct({ visitRef: { req: "47969", n: 0 } })),
      visitCorrectionInputError(correct({ expectedVersion: 0 })),
      visitCorrectionInputError(null as never),
    ];
    for (const e of errors) {
      expect(e).not.toBeNull();
      expect(e ?? "").not.toMatch(NO_DECISION_CODE);
    }
    expect(visitCorrectionError(correct(), undefined)).toBe("הביקור לא נמצא או שאינו סגור");
    expect(visitCorrectionError(correct({ reason: "" }), VISIT)).toBe("יש לכתוב סיבה לתיקון");
  });

  test("corrected values follow each field's rules", () => {
    for (const [field, value] of [
      ["endAt", "25:00"],
      ["endAt", "8:40"],
      ["arriveAt", null],
      ["summary", ""],
      ["summary", ["a"]],
      ["parts", "חלק"],
      ["parts", Array.from({ length: 21 }, (_, i) => `חלק ${i}`)],
      ["parts", ["x".repeat(101)]],
      ["nextNote", "  "],
      ["followupReason", ""],
    ] as const) {
      expect(correctionValueError(field, value as never), `${field}=${JSON.stringify(value)}`).not.toBeNull();
    }
    expect(correctionValueError("departAt", "07:05")).toBeNull();
    expect(correctionValueError("parts", [])).toBeNull();
  });

  test("device sync: retry only a failed item of the queue; sync now needs the queue; a visit's state is its most urgent item", () => {
    expect(syncNowError(undefined)).not.toBeNull();
    expect(syncNowError({})).toBeNull();
    expect(syncRetryError({ opId: "op-47963-1-img2" }, { state: "failed" })).toBeNull();
    for (const [input, stored] of [
      [{ opId: "op-1" }, undefined],
      [{ opId: "op-1" }, { state: "pending" }],
      [{ opId: "op-1" }, { state: "syncing" }],
      [{ opId: "op-1" }, { state: "saved-on-device" }],
      [{ opId: "../op" }, { state: "failed" }],
      [{ opId: "x".repeat(65) }, { state: "failed" }],
      [null, { state: "failed" }],
    ] as const) {
      expect(syncRetryError(input as never, stored), JSON.stringify(input)).not.toBeNull();
    }
    expect(isOperationId("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isOperationId("op 1")).toBe(false);
    expect(visitSyncState([])).toBe("sent");
    expect(visitSyncState([{ state: "pending" }, { state: "failed" }])).toBe("failed");
    expect(visitSyncState([{ state: "saved-on-device" }, { state: "pending" }])).toBe("pending");
    expect(visitSyncState([{ state: "saved-on-device" }, { state: "syncing" }])).toBe("syncing");
    expect(visitRefKey(undefined)).toBe("undefined/undefined");
    expect(visitRefKey({ req: "48213", n: 1 })).toBe("48213/1");
  });

  test("outbox URL state: a malformed id selects nothing; paging is clamped", () => {
    expect(parseOutboxViewState({ id: "ob-48198-1", page: "2" })).toEqual({ page: 2, id: "ob-48198-1" });
    expect(parseOutboxViewState(new URLSearchParams("id=../x&page=-1"))).toEqual({ page: 1, id: null });
    expect(parseOutboxViewState({ id: ["ob-1", "ob-2"] })).toEqual({ page: 1, id: "ob-1" });
    expect(outboxHref("/o", { id: "<script>", page: 1 })).toBe("/o");
    expect(outboxHref("/o", { id: "ob-48198-1", page: 3 })).toBe("/o?page=3&id=ob-48198-1");
    for (const id of ["", "a b", "x".repeat(65), null]) expect(isOutboxId(id), String(id)).toBe(false);
  });
});
