import { expect, test } from "@playwright/test";
import {
  dbRequestTypeOf,
  isCreationIntentType,
  isDbRequestType,
  requestKindOf,
} from "@/features/accounts/data/db-codes";
import {
  ACCOUNT_REQUEST_KINDS,
  ACCOUNT_ROLE_VALUES,
  activationKind,
  isAccountRole,
  isNewAccountRole,
  isOpenCreation,
  NEW_ACCOUNT_ROLES,
  technicianProfileMissing,
  type NewAccountInput,
} from "@/features/accounts/data/types";
import {
  accountDecisionError,
  accountRequestError,
  accountRequestTargetError,
  accountStateError,
  cancelRequestError,
  CREATOR_ACCOUNT_PENDING,
  credentialEmailError,
  credentialsCallerError,
  expectedVersionError,
  MANAGER_TECHNICIAN_FIELDS_PENDING,
  newAccountError,
  newTechnicianError,
  passwordError,
  pendingRequestError,
  profileUpdateError,
  routineUpdateCallerError,
  staleVersionError,
  technicianUpdateError,
  testAccountEmailError,
  type AccountRequestStored,
  type AccountViewer,
} from "@/features/accounts/data/validate";
import { backFromFieldHref, parseBackFromFieldState } from "@/features/calls/data/search-params";
import { normalizeBackFromFieldQuery } from "@/features/calls/data/validate";
import { customersListHref, parseCustomersListState } from "@/features/customers/data/search-params";
import { isCustomerId, normalizeCustomerListQuery } from "@/features/customers/data/validate";
import { filterListValues, ownValue } from "@/features/data-access/common";
import { ACTION_MESSAGES, databaseErrorMessage, REQUEST_MESSAGES } from "@/features/data-access/supabase-errors";
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
import { offersDecided, reviewDecisionOffered, reviewScreenOffered } from "@/features/review/data/permissions";
import { REVIEW_NOTE_MAX, type ReviewResolveInput } from "@/features/review/data/types";
import { PERMISSION_KEYS, type PermissionKey, type RolePermissions } from "@/features/reference/data/types";
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
  technicianActiveError,
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
    expect(accountRequestError({ kind: "create", name: "נציגה", email: "not-an-email" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "cs" })).toBeNull();
    expect(accountRequestError({ kind: "create", name: "נציגה", email: "rep@example.test" })).toBeNull();
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

  test("decisions: a rejection needs a reason; only a pending request is decided", () => {
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

test.describe("PR 2.2 port alignment (Step 2 plan §3.7 a–j)", () => {
  onlyInProject("desktop");

  test("a. versions: a positive integer; a stale one gets the database's PT409 text", () => {
    for (const bad of [0, -1, 1.5, "1", Number.NaN, undefined, null, Number.POSITIVE_INFINITY]) {
      expect(expectedVersionError(bad), String(bad)).toBe("גרסה לא תקינה");
    }
    expect(expectedVersionError(1)).toBeNull();
    expect(expectedVersionError(7)).toBeNull();
    expect(staleVersionError(2, 3)).toBe(ACTION_MESSAGES.stale);
    expect(staleVersionError(2, 3)).toBe(databaseErrorMessage({ code: "PT409", message: "version conflict" }));
    expect(staleVersionError(3, 3)).toBeNull();
  });

  test("a. Settings › טכנאים \"פעיל\": version checked against the stored technician; unknown is refused", () => {
    const input = { techId: "y", expectedVersion: 1, active: false };
    expect(technicianActiveError(input, { version: 1 })).toBeNull();
    expect(technicianActiveError(input, { version: 2 })).toBe(ACTION_MESSAGES.stale);
    expect(technicianActiveError(input, undefined)).not.toBeNull();
    expect(technicianActiveError({ ...input, expectedVersion: 0 }, { version: 1 })).toBe("גרסה לא תקינה");
    expect(technicianActiveError({ ...input, active: "no" as never }, { version: 1 })).not.toBeNull();
    expect(technicianActiveError({ ...input, techId: "bad id!" }, { version: 1 })).not.toBeNull();
    expect(technicianActiveError(undefined as never, { version: 1 })).not.toBeNull();
  });

  test("f. a new account is Manager, Customer Service or Technician; a Creator is pending the owner (Q9)", () => {
    const base = { name: "בדיקה", email: "x@example.test", phone: "050-000-0000" };
    expect(newAccountError({ ...base, role: "creator" } as never)).toBe(CREATOR_ACCOUNT_PENDING);
    for (const role of ["bogus", "constructor", "manager", "__proto__", "", undefined]) {
      expect(newAccountError({ ...base, role } as never), String(role)).toBe("תפקיד לא תקין");
    }
    for (const role of ["mgr", "cs", "tech"] as const) expect(newAccountError({ ...base, role } satisfies NewAccountInput)).toBeNull();
    expect([...NEW_ACCOUNT_ROLES].sort()).toEqual(["cs", "mgr", "tech"]);
    expect(isNewAccountRole("creator")).toBe(false);
    expect(CREATOR_ACCOUNT_PENDING).not.toMatch(NO_DECISION_CODE);
  });

  test("h. a Manager's Customer Service create request has no phone; its role rules are unchanged", () => {
    expect(accountRequestError({ kind: "create", name: "נציגה 4", email: "rep4@example.test" })).toBeNull();
    expect(accountRequestError({ kind: "create", name: "נציגה 4", email: "" })).not.toBeNull();
    expect(accountRequestError({ kind: "create", name: "  ", email: "rep4@example.test" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "creator" })).not.toBeNull();
    expect(accountRequestError({ kind: "role-change", accountId: "acc-x", newRole: "mgr" })).not.toBeNull();
  });

  test("i. request kinds: role-change <-> role_change; direct_create is a creation intent, never a request", () => {
    expect(requestKindOf("role_change")).toBe("role-change");
    for (const v of ["direct_create", "role-change", "constructor", "__proto__", "toString", null, undefined, 1, "CREATE"]) {
      expect(requestKindOf(v), String(v)).toBeNull();
    }
    expect(dbRequestTypeOf("role-change")).toBe("role_change");
    for (const v of ["role_change", "direct_create", "constructor", "__proto__", null]) expect(dbRequestTypeOf(v), String(v)).toBeNull();
    for (const kind of ACCOUNT_REQUEST_KINDS) expect(requestKindOf(dbRequestTypeOf(kind))).toBe(kind);
    expect(isCreationIntentType("direct_create")).toBe(true);
    expect(isCreationIntentType("create")).toBe(false);
    expect(isDbRequestType("direct_create")).toBe(true);
    expect(isDbRequestType("role-change")).toBe(false);
  });

  test("g. cancel: the requester's pending or open creation; the Creator only an open creation (else he rejects)", () => {
    const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
    const otherMgr: AccountViewer = { id: "acc-other", role: "mgr" };
    const creator: AccountViewer = { id: "acc-creator", role: "creator" };
    const cs: AccountViewer = { id: "acc-shirel", role: "cs" };
    const tech: AccountViewer = { id: "acc-tech-y", role: "tech" };
    const input = { requestId: "areq-1", expectedVersion: 1 };
    const stored = (over: Partial<AccountRequestStored>): AccountRequestStored => ({
      status: "pending",
      version: 1,
      requestedBy: "acc-doron",
      creation: true,
      fulfilled: false,
      ...over,
    });
    const pending = stored({});
    const openCreation = stored({ status: "approved", version: 2 });
    const openInput = { ...input, expectedVersion: 2 };
    const cannot = REQUEST_MESSAGES.cannotCancel;
    const forbidden = ACTION_MESSAGES.forbidden;

    expect(cancelRequestError(input, pending, mgr)).toBeNull();
    expect(cancelRequestError(openInput, openCreation, mgr)).toBeNull();
    expect(cancelRequestError(openInput, stored({ status: "approved", version: 2, fulfilled: true }), mgr)).toBe(cannot);
    expect(cancelRequestError(openInput, stored({ status: "approved", version: 2, creation: false }), mgr)).toBe(cannot);
    expect(cancelRequestError(openInput, stored({ status: "rejected", version: 2 }), mgr)).toBe(cannot);
    expect(cancelRequestError(openInput, stored({ status: "cancelled", version: 2 }), mgr)).toBe(cannot);
    expect(cancelRequestError(input, pending, otherMgr)).toBe(forbidden);
    expect(cancelRequestError(openInput, openCreation, otherMgr)).toBe(forbidden);
    // The Creator rejects a Manager's pending request with a reason; he never cancels it.
    expect(cancelRequestError(input, pending, creator)).toBe(forbidden);
    expect(cancelRequestError(openInput, openCreation, creator)).toBeNull();
    expect(cancelRequestError(openInput, stored({ status: "approved", version: 2, requestedBy: "acc-creator" }), creator)).toBeNull();
    expect(cancelRequestError(openInput, stored({ status: "approved", version: 2, creation: false }), creator)).toBe(cannot);
    for (const viewer of [cs, tech]) {
      expect(cancelRequestError(input, pending, viewer), viewer.role).toBe(forbidden);
      expect(cancelRequestError(openInput, openCreation, viewer), viewer.role).toBe(forbidden);
    }
    expect(cancelRequestError(input, undefined, mgr)).toBe(forbidden);
    expect(cancelRequestError(input, pending, null)).toBe(forbidden);
    expect(cancelRequestError({ ...input, expectedVersion: 3 }, pending, mgr)).toBe(ACTION_MESSAGES.stale);
    expect(cancelRequestError({ ...input, expectedVersion: 0 }, pending, mgr)).toBe("גרסה לא תקינה");
    expect(cancelRequestError({ ...input, requestId: "bad id!" }, pending, mgr)).not.toBeNull();
    expect(cancelRequestError(undefined as never, pending, mgr)).not.toBeNull();
    // The validator's texts are the database's (55000 "the request cannot be cancelled", 42501).
    expect(cannot).toBe(databaseErrorMessage({ code: "55000", message: "the request cannot be cancelled" }));
    expect(forbidden).toBe(databaseErrorMessage({ code: "42501", message: "not authorized" }));
  });

  test("e. routine updates: the Creator any field; the Manager CS and technicians, never Outlook email or \"פעיל\" (Q14)", () => {
    const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
    const creator: AccountViewer = { id: "acc-creator", role: "creator" };
    const profile = { accountId: "acc-shirel", expectedVersion: 1 };
    const techUpdate = { technicianId: "y", expectedVersion: 1 };
    const techTarget = { id: null, role: "tech" as const };
    const csTarget = { id: "acc-shirel", role: "cs" as const };

    expect(routineUpdateCallerError(mgr, techTarget, { ...techUpdate, outlookEmail: "y2@example.test" })).toBe(
      MANAGER_TECHNICIAN_FIELDS_PENDING,
    );
    expect(routineUpdateCallerError(mgr, techTarget, { ...techUpdate, active: false })).toBe(MANAGER_TECHNICIAN_FIELDS_PENDING);
    expect(MANAGER_TECHNICIAN_FIELDS_PENDING).not.toMatch(NO_DECISION_CODE);
    expect(routineUpdateCallerError(mgr, { id: "acc-mgr2", role: "mgr" }, profile)).toBe(ACTION_MESSAGES.forbidden);
    expect(routineUpdateCallerError(mgr, { id: "acc-creator", role: "creator" }, profile)).toBe(ACTION_MESSAGES.forbidden);
    expect(routineUpdateCallerError(mgr, { id: "acc-doron", role: "cs" }, profile)).toBe(ACTION_MESSAGES.forbidden);
    expect(routineUpdateCallerError(mgr, undefined, profile)).toBe(ACTION_MESSAGES.forbidden);
    expect(routineUpdateCallerError(mgr, csTarget, { ...profile, name: "שם", phone: "050-000-0000", invitationAlias: "כינוי" })).toBeNull();
    expect(routineUpdateCallerError(mgr, techTarget, { ...techUpdate, name: "שם", color: "t-e", device: "טאבלט" })).toBeNull();
    expect(
      routineUpdateCallerError(creator, techTarget, { ...techUpdate, name: "שם", color: "t-e", device: null, outlookEmail: "a@example.test", active: false }),
    ).toBeNull();
    expect(routineUpdateCallerError(creator, { id: "acc-doron", role: "mgr" }, profile)).toBeNull();
    for (const role of ["cs", "tech"] as const) {
      expect(routineUpdateCallerError({ id: "acc-x", role }, csTarget, profile), role).toBe(ACTION_MESSAGES.forbidden);
    }
    expect(routineUpdateCallerError(null, csTarget, profile)).toBe(ACTION_MESSAGES.forbidden);
  });

  test("e. routine update fields: name, phone (null clears), alias, colour token, device, Outlook email", () => {
    const profile = { accountId: "acc-shirel", expectedVersion: 1 };
    expect(profileUpdateError({ ...profile, name: "  " })).not.toBeNull();
    expect(profileUpdateError({ ...profile, phone: "abc" })).not.toBeNull();
    expect(profileUpdateError({ ...profile, phone: null })).toBeNull();
    expect(profileUpdateError({ ...profile, invitationAlias: "א".repeat(61) })).toBe("הכינוי ארוך מ-60 תווים");
    expect(profileUpdateError({ ...profile, invitationAlias: "א".repeat(60) })).toBeNull();
    expect(profileUpdateError({ ...profile, invitationAlias: null })).toBeNull();
    expect(profileUpdateError({ ...profile, expectedVersion: 0 })).toBe("גרסה לא תקינה");
    expect(profileUpdateError({ ...profile, accountId: "bad id!" })).not.toBeNull();
    expect(profileUpdateError(undefined as never)).not.toBeNull();
    expect(profileUpdateError({ ...profile, name: "שיראל כהן", phone: "050-000-0102" })).toBeNull();

    const tech = { technicianId: "y", expectedVersion: 1 };
    for (const color of ["var(--t-y)", "url(x)", "t-z"]) {
      expect(technicianUpdateError({ ...tech, color: color as never }), color).toBe("צבע לא תקין");
    }
    expect(technicianUpdateError({ ...tech, device: "x".repeat(41) })).not.toBeNull();
    expect(technicianUpdateError({ ...tech, device: null })).toBeNull();
    expect(technicianUpdateError({ ...tech, outlookEmail: "not-an-email" })).not.toBeNull();
    expect(technicianUpdateError({ ...tech, name: "" })).not.toBeNull();
    expect(technicianUpdateError({ ...tech, active: "yes" as never })).not.toBeNull();
    expect(technicianUpdateError({ ...tech, technicianId: "bad id!" })).not.toBeNull();
    expect(technicianUpdateError({ ...tech, expectedVersion: 1.5 })).toBe("גרסה לא תקינה");
    expect(technicianUpdateError({ ...tech, name: "יורם", color: "t-s", device: "טאבלט", outlookEmail: "y@example.test", active: true })).toBeNull();
  });

  test("c. credentials: the Creator only; a non-empty password of at most 72 bytes, never echoed", () => {
    expect(passwordError("")).toBe("חסרה סיסמה");
    expect(passwordError(undefined)).toBe("חסרה סיסמה");
    expect(passwordError(12345678)).toBe("חסרה סיסמה");
    expect(passwordError("a".repeat(72))).toBeNull();
    const long = "Zq7".repeat(24) + "!";
    expect(long.length).toBe(73);
    expect(passwordError(long)).toBe("הסיסמה ארוכה מדי");
    // 37 Hebrew letters are 74 UTF-8 bytes.
    const hebrew = "ס".repeat(37);
    expect(passwordError(hebrew)).toBe("הסיסמה ארוכה מדי");
    for (const p of ["", long, hebrew, "a".repeat(72)]) {
      const message = passwordError(p);
      if (message && p) expect(message).not.toContain(p);
    }

    expect(credentialEmailError("a@example.com", { isTest: true })).toBe(testAccountEmailError("a@example.com"));
    expect(credentialEmailError("a@example.com", { isTest: false })).toBeNull();
    expect(credentialEmailError("a@example.test", { isTest: true })).toBeNull();
    expect(credentialEmailError("not-an-email", { isTest: false })).toBe("כתובת מייל לא תקינה");
    expect(credentialsCallerError("mgr")).toBe(ACTION_MESSAGES.forbidden);
    expect(credentialsCallerError("cs")).toBe(ACTION_MESSAGES.forbidden);
    expect(credentialsCallerError(undefined)).toBe(ACTION_MESSAGES.forbidden);
    expect(credentialsCallerError("creator")).toBeNull();
  });

  test("j and g. a missing technician profile and an open creation, by their truth tables", () => {
    expect(technicianProfileMissing({ role: "tech", active: true, technicianId: null })).toBe(true);
    expect(technicianProfileMissing({ role: "tech", active: false, technicianId: null })).toBe(false);
    expect(technicianProfileMissing({ role: "tech", active: true, technicianId: "y" })).toBe(false);
    expect(technicianProfileMissing({ role: "cs", active: true, technicianId: null })).toBe(false);

    expect(isOpenCreation({ kind: "create", status: "approved", account: null })).toBe(true);
    expect(isOpenCreation({ kind: "create", status: "approved", account: { id: "acc-rep2", name: "הדס" } })).toBe(false);
    expect(isOpenCreation({ kind: "create", status: "pending", account: null })).toBe(false);
    expect(isOpenCreation({ kind: "activate", status: "approved", account: null })).toBe(false);
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
    source: "device",
    targetVisitClosed: true,
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

  test("review resolution: an invitation never changes a visit that is closed now (D39); keeping the current value stays possible", () => {
    const invitation: ReviewResolveStored = { ...ITEM, source: "invitation", noteRequired: false, conflicts: [] };
    for (const decision of ["apply-incoming", "per-field"] as const) {
      const input = resolve({ decision, ...(decision === "per-field" ? { fields: { summary: "incoming" } } : {}) });
      const e = reviewResolutionError(input, invitation);
      expect(e, decision).toBe("זימון לא משנה ביקור סגור");
      expect(e ?? "").not.toMatch(NO_DECISION_CODE);
      // The same decision is fine while the visit is open, and for a device submission.
      expect(reviewResolutionError(input, { ...invitation, targetVisitClosed: false }), decision).toBeNull();
      expect(reviewResolutionError(input, { ...invitation, source: "device" }), decision).toBeNull();
    }
    expect(reviewResolutionError(resolve({ decision: "keep-current" }), invitation)).toBeNull();
  });

  /** A role's values with every key off except `on` (display only, G-04). */
  const perms = (role: "mgr" | "cs" | "creator", on: readonly PermissionKey[]): RolePermissions => {
    const values = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, on.includes(k)])) as Record<PermissionKey, boolean>;
    return role === "creator" ? { role, status: "fixed", values } : { role, status: "temporary", values };
  };

  test("review screen: offered only with `conflicts` and `card` (review_items are read with `card`)", () => {
    expect(reviewScreenOffered(perms("mgr", ["conflicts", "card"]))).toBe(true);
    expect(reviewScreenOffered(perms("mgr", ["conflicts"]))).toBe(false);
    expect(reviewScreenOffered(perms("mgr", ["card"]))).toBe(false);
    expect(reviewScreenOffered(perms("cs", ["cal", "calls", "card"]))).toBe(false);
  });

  test("review decision: D14 items by the fixed capability; others by `conflicts`; a cancellation also needs a decided `cancel`", () => {
    const closed = { authority: "closed-visit", kind: "edit-conflict" } as const;
    const address = { authority: "conflicts", kind: "address-change" } as const;
    const cancellation = { authority: "conflicts", kind: "cancellation" } as const;
    // D14: the fixed capability decides, whatever the matrix says.
    expect(reviewDecisionOffered({ permissions: perms("mgr", []), closedVisitCapability: true, item: closed })).toBe(true);
    expect(reviewDecisionOffered({ permissions: perms("cs", ["conflicts", "card"]), closedVisitCapability: false, item: closed })).toBe(false);
    // Other items: `conflicts`.
    expect(reviewDecisionOffered({ permissions: perms("cs", ["conflicts"]), closedVisitCapability: false, item: address })).toBe(true);
    expect(reviewDecisionOffered({ permissions: perms("mgr", ["card"]), closedVisitCapability: true, item: address })).toBe(false);
    // A cancellation also needs `cancel`; customer service's `cancel` cell waits for an open
    // decision, so it counts as off even if the value were on.
    expect(reviewDecisionOffered({ permissions: perms("mgr", ["conflicts", "cancel"]), closedVisitCapability: true, item: cancellation })).toBe(true);
    expect(reviewDecisionOffered({ permissions: perms("mgr", ["conflicts"]), closedVisitCapability: true, item: cancellation })).toBe(false);
    expect(reviewDecisionOffered({ permissions: perms("cs", ["conflicts", "cancel"]), closedVisitCapability: false, item: cancellation })).toBe(false);
    expect(offersDecided(perms("cs", ["cancel"]), "cancel")).toBe(false);
    expect(offersDecided(perms("creator", ["cancel"]), "cancel")).toBe(true);
    // The Creator's pending capability (usage) stays off.
    expect(offersDecided(perms("creator", ["usage"]), "usage")).toBe(false);
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
