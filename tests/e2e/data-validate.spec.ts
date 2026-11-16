import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";
// U12 unit-tests the pure simulated commands of the UI demo (Step 2 PR 2.3 §3.4): a test, not a
// screen, so the demo-only import rule (eslint.config.mjs FIXTURE_PATTERNS) does not apply here.
// eslint-disable-next-line no-restricted-imports
import { buildSimulatedCommands } from "@/app/dev/demo/_components/simulated-commands";
import {
  accountAfterProfileUpdate,
  accountAfterStateChange,
  cancelInput,
  cancelledEntryLabel,
  decisionInput,
  intentCancelInput,
  profilePatch,
  requestEntryAfter,
  stateInput,
  technicianAfterUpdate,
  technicianPatch,
} from "@/components/office/AccountAdminRules";
import type { AccountTechnicianDetails } from "@/components/office/AccountAdminParts";
import {
  dbRequestTypeOf,
  isCreationIntentType,
  isDbRequestType,
  requestKindOf,
} from "@/features/accounts/data/db-codes";
import {
  creatorCancelOffered,
  credentialActionsOffered,
  intentCompletionOffered,
  ownIntents,
  profileEditOffered,
  requestCompletionOffered,
  TECHNICIAN_EDIT_FIELDS,
  technicianEditFields,
  technicianProfileCompletionOffered,
  type AccountAdminScope,
  type TechnicianEditField,
} from "@/features/accounts/data/offers";
import {
  ACCOUNT_REQUEST_KINDS,
  ACCOUNT_ROLE_VALUES,
  activationKind,
  cancelledAfterApprovalOf,
  cancelledRequest,
  creatorNoticesOf,
  isAccountRole,
  isNewAccountRole,
  isOpenCreation,
  NEW_ACCOUNT_ROLES,
  requesterMayCancel,
  requestOutcomeLine,
  technicianProfileMissing,
  type AccountRequest,
  type AccountRole,
  type CreationIntent,
  type CreatorNotice,
  type NewAccountInput,
  type UpdateTechnicianInput,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  accountAdminCallerError,
  accountDecisionError,
  accountRequestError,
  accountRequestTargetError,
  accountStateCommandError,
  accountStateError,
  aliasTakenError,
  cancelRequestError,
  completeCreationError,
  CREATOR_ACCOUNT_PENDING,
  creatorOnlyError,
  credentialEmailError,
  credentialsCallerError,
  decideRequestError,
  expectedVersionError,
  INVITATION_ALIAS_MAX,
  MANAGER_TECHNICIAN_FIELDS_PENDING,
  managerActivationError,
  managerOnlyError,
  newAccountError,
  newTechnicianError,
  NO_CHANGE,
  passwordError,
  pendingRequestError,
  phoneError,
  profileUpdateCommandError,
  profileUpdateError,
  routineUpdateCallerError,
  staleVersionError,
  technicianProfileCompletionError,
  technicianUpdateCommandError,
  technicianUpdateError,
  testAccountEmailError,
  VERSION_MAX,
  type AccountRequestStored,
  type AccountStored,
  type AccountViewer,
} from "@/features/accounts/data/validate";
import { sessionUserOf } from "@/features/auth/data/session";
import { LOGIN_STATES, loginStateOf } from "@/features/auth/login-state";
import { accountAdminScope } from "@/features/auth/roles";
import { backFromFieldHref, parseBackFromFieldState } from "@/features/calls/data/search-params";
import { normalizeBackFromFieldQuery } from "@/features/calls/data/validate";
import { customersListHref, parseCustomersListState } from "@/features/customers/data/search-params";
import { isCustomerId, normalizeCustomerListQuery } from "@/features/customers/data/validate";
import { filterListValues, ownValue, versionAfter, versionTracker } from "@/features/data-access/common";
import { ACTION_MESSAGES, databaseErrorMessage, REQUEST_MESSAGES, TECHNICIAN_MESSAGES } from "@/features/data-access/supabase-errors";
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
import {
  PERMISSION_KEYS,
  TECHNICIAN_COLOR_TOKENS,
  technicianColorCss,
  technicianColorTokenOf,
  type PermissionKey,
  type RolePermissions,
} from "@/features/reference/data/types";
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
    for (const bad of [0, -1, 1.5, "1", Number.NaN, undefined, null, Number.POSITIVE_INFINITY, 2 ** 31, 1e21]) {
      expect(expectedVersionError(bad), String(bad)).toBe("גרסה לא תקינה");
    }
    expect(expectedVersionError(1)).toBeNull();
    expect(expectedVersionError(7)).toBeNull();
    // The database's `integer` range (review N1).
    expect(expectedVersionError(VERSION_MAX)).toBeNull();
    expect(VERSION_MAX).toBe(2 ** 31 - 1);
    expect(staleVersionError(2, 3)).toBe(ACTION_MESSAGES.stale);
    expect(staleVersionError(2, 3)).toBe(databaseErrorMessage({ code: "PT409", message: "version conflict" }));
    expect(staleVersionError(3, 3)).toBeNull();
  });

  test("a. Settings › טכנאים \"פעיל\": version checked against the stored technician; unknown is refused", () => {
    const input = { techId: "y", expectedVersion: 1, active: false };
    expect(technicianActiveError(input, { version: 1 }, "creator")).toBeNull();
    expect(technicianActiveError(input, { version: 2 }, "creator")).toBe(ACTION_MESSAGES.stale);
    expect(technicianActiveError(input, undefined, "creator")).toBe(ACTION_MESSAGES.forbidden);
    expect(technicianActiveError({ ...input, expectedVersion: 0 }, { version: 1 }, "creator")).toBe("גרסה לא תקינה");
    expect(technicianActiveError({ ...input, expectedVersion: 2 ** 31 }, { version: 1 }, "creator")).toBe("גרסה לא תקינה");
    expect(technicianActiveError({ ...input, active: "no" as never }, { version: 1 }, "creator")).not.toBeNull();
    expect(technicianActiveError({ ...input, techId: "bad id!" }, { version: 1 }, "creator")).not.toBeNull();
    expect(technicianActiveError(undefined as never, { version: 1 }, "creator")).not.toBeNull();
  });

  test("a. \"פעיל\" of a technician is the Creator's only for now (Q14), on both of its command paths (review CA-3/S2)", () => {
    const input = { techId: "y", expectedVersion: 1, active: false };
    // The Manager gets the same TEMPORARY text as accounts.updateTechnician({ active }).
    expect(technicianActiveError(input, { version: 1 }, "mgr")).toBe(MANAGER_TECHNICIAN_FIELDS_PENDING);
    expect(routineUpdateCallerError({ id: "acc-doron", role: "mgr" }, { id: null, role: "tech" }, { technicianId: "y", expectedVersion: 1, active: false })).toBe(
      MANAGER_TECHNICIAN_FIELDS_PENDING,
    );
    for (const role of ["cs", "tech", undefined, null, "manager", "constructor"]) {
      expect(technicianActiveError(input, { version: 1 }, role), String(role)).toBe(ACTION_MESSAGES.forbidden);
    }
  });

  test("a. after a STORED edit the next one sends the returned version; a simulated or failed one keeps the version read (review CA-1)", () => {
    expect(versionAfter({ ok: true, simulated: false, data: { version: 4 } }, 3)).toBe(4);
    expect(versionAfter({ ok: true, simulated: true, data: { version: 4 } }, 3)).toBe(3);
    expect(versionAfter({ ok: false, simulated: false, error: ACTION_MESSAGES.stale }, 3)).toBe(3);
    expect(versionAfter({ ok: true, simulated: false }, 3)).toBe(3);
    for (const bad of [0, -1, 1.5, "4", null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(versionAfter({ ok: true, simulated: false, data: { version: bad } }, 3), String(bad)).toBe(3);
    }
    expect(versionAfter({ ok: true, simulated: false, data: "4" }, 3)).toBe(3);
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
      intent: false,
      requestedRole: "cs",
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

test.describe("PR 2.2 review fixes (who may call, database texts, shapes, pure selections)", () => {
  onlyInProject("desktop");

  const creator: AccountViewer = { id: "acc-creator", role: "creator" };
  const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
  const cs: AccountViewer = { id: "acc-shirel", role: "cs" };
  const tech: AccountViewer = { id: "acc-tech-y", role: "tech" };
  const forbidden = ACTION_MESSAGES.forbidden;
  const account = (over: Partial<AccountStored>): AccountStored => ({
    name: "שיראל",
    email: "shirel@example.test",
    role: "cs",
    active: true,
    version: 3,
    isTest: true,
    technicianId: null,
    invitationAlias: null,
    ...over,
  });

  test("S1/CA-6: who may call each account command (Migration 1 require_caller)", () => {
    expect(creatorOnlyError("creator")).toBeNull();
    expect(managerOnlyError("mgr")).toBeNull();
    for (const role of ["creator", "mgr"]) expect(accountAdminCallerError(role), role).toBeNull();
    for (const role of ["mgr", "cs", "tech", undefined, null, "manager", "__proto__"]) {
      expect(creatorOnlyError(role), String(role)).toBe(forbidden);
    }
    for (const role of ["creator", "cs", "tech", undefined, "manager"]) expect(managerOnlyError(role), String(role)).toBe(forbidden);
    for (const role of ["cs", "tech", undefined, "manager"]) expect(accountAdminCallerError(role), String(role)).toBe(forbidden);
    // A Manager's Customer Service activation is a request (55000 "requires the Creator's approval").
    expect(managerActivationError("mgr", "cs")).toBe(REQUEST_MESSAGES.needsCreator);
    expect(managerActivationError("mgr", "cs")).toBe(databaseErrorMessage({ code: "55000", message: "requires the Creator's approval" }));
    expect(managerActivationError("mgr", "tech")).toBeNull();
    expect(managerActivationError("creator", "cs")).toBeNull();
  });

  test("CA-5/S1: a decision checks the caller, the request, its state and the version, in the database's order", () => {
    const input = { requestId: "areq-1", expectedVersion: 1, decision: { outcome: "approve" as const } };
    const pending: AccountRequestStored = {
      status: "pending",
      version: 1,
      requestedBy: "acc-doron",
      creation: true,
      fulfilled: false,
      intent: false,
      requestedRole: "cs",
    };
    expect(decideRequestError(input, pending, "creator")).toBeNull();
    for (const role of ["mgr", "cs", "tech", undefined]) expect(decideRequestError(input, pending, role), String(role)).toBe(forbidden);
    // The caller comes first: a Manager never learns whether a request exists.
    expect(decideRequestError(input, undefined, "mgr")).toBe(forbidden);
    expect(decideRequestError(input, undefined, "creator")).toBe(ACTION_MESSAGES.invalid);
    for (const status of ["approved", "rejected", "cancelled"] as const) {
      expect(decideRequestError(input, { ...pending, status, version: 2 }, "creator"), status).toBe(REQUEST_MESSAGES.notPending);
    }
    expect(REQUEST_MESSAGES.notPending).toBe(databaseErrorMessage({ code: "55000", message: "the request is not pending" }));
    expect(decideRequestError(input, { ...pending, version: 2 }, "creator")).toBe(ACTION_MESSAGES.stale);
    expect(decideRequestError({ ...input, decision: { outcome: "reject", reason: " " } }, pending, "creator")).toBe("יש לכתוב סיבת דחייה");
    expect(decideRequestError({ ...input, expectedVersion: 0 }, pending, "creator")).toBe("גרסה לא תקינה");
    expect(decideRequestError(undefined as never, pending, "creator")).not.toBeNull();
  });

  test("CA-5/S1: (de)activation checks the caller, scope, self, the Manager's CS activation, then the version", () => {
    const input = { accountId: "acc-shirel", expectedVersion: 3 };
    expect(accountStateCommandError("deactivate", input, account({}), mgr)).toBeNull();
    expect(accountStateCommandError("deactivate", input, account({}), creator)).toBeNull();
    // A screen that sent the wrong version is refused with the PT409 text.
    expect(accountStateCommandError("deactivate", { ...input, expectedVersion: 1 }, account({}), mgr)).toBe(ACTION_MESSAGES.stale);
    for (const viewer of [cs, tech, null]) {
      expect(accountStateCommandError("deactivate", input, account({}), viewer), String(viewer?.role)).toBe(forbidden);
    }
    // Unknown, out of the Manager's scope (Manager, Creator) or himself: 42501, as the database.
    expect(accountStateCommandError("deactivate", input, undefined, mgr)).toBe(forbidden);
    expect(accountStateCommandError("deactivate", { ...input, accountId: "acc-mgr2" }, account({ role: "mgr" }), mgr)).toBe(forbidden);
    expect(accountStateCommandError("deactivate", { ...input, accountId: "acc-creator" }, account({ role: "creator" }), mgr)).toBe(forbidden);
    expect(accountStateCommandError("deactivate", { ...input, accountId: "acc-doron" }, account({ role: "mgr" }), mgr)).toBe(forbidden);
    expect(accountStateCommandError("deactivate", { ...input, accountId: "acc-creator" }, account({ role: "creator" }), creator)).toBe(forbidden);
    // A Manager activates a Technician at once; a Customer Service account only through a request.
    const orit = { accountId: "acc-orit", expectedVersion: 2 };
    expect(accountStateCommandError("activate", orit, account({ active: false, version: 2 }), mgr)).toBe(REQUEST_MESSAGES.needsCreator);
    expect(accountStateCommandError("activate", orit, account({ active: false, version: 2 }), creator)).toBeNull();
    expect(accountStateCommandError("activate", { accountId: "acc-beni", expectedVersion: 2 }, account({ role: "tech", active: false, version: 2 }), mgr)).toBeNull();
    expect(accountStateCommandError("activate", { accountId: "acc-beni", expectedVersion: 1 }, account({ role: "tech", active: false, version: 2 }), mgr)).toBe(
      ACTION_MESSAGES.stale,
    );
    // The simulation's own refusal of a state the account already has (the database: a no-op).
    expect(accountStateCommandError("deactivate", input, account({ active: false }), mgr)).toBe(accountStateError("deactivate", false));
    expect(accountStateCommandError("deactivate", { ...input, expectedVersion: 1.5 }, account({}), mgr)).toBe("גרסה לא תקינה");
    expect(accountStateCommandError("deactivate", undefined as never, account({}), mgr)).not.toBeNull();
  });

  test("CA-7: unknown or out-of-scope records and state refusals use the database mapping's texts", () => {
    expect(pendingRequestError(undefined)).toBe(ACTION_MESSAGES.invalid);
    expect(pendingRequestError("approved")).toBe(databaseErrorMessage({ code: "55000", message: "the request is not pending" }));
    expect(accountStateError("deactivate", undefined)).toBe(databaseErrorMessage({ code: "42501", message: "not authorized" }));
    expect(accountRequestTargetError("activate", undefined)).toBe(forbidden);
  });

  test("S3/N2/N3: routine updates refuse extra keys and an empty patch; the caller comes first", () => {
    const profile = { accountId: "acc-shirel", expectedVersion: 3 };
    for (const extra of [{ email: "new@example.test" }, { role: "creator" }, { isTest: false }, { technicianId: "y" }]) {
      expect(profileUpdateError({ ...profile, name: "שיראל", ...extra } as never), JSON.stringify(extra)).toBe("קלט לא תקין");
    }
    expect(profileUpdateError(profile)).toBe(NO_CHANGE);
    expect(profileUpdateError({ ...profile, name: undefined })).toBe(NO_CHANGE);
    expect(profileUpdateError({ ...profile, phone: null })).toBeNull();
    const techPatch = { technicianId: "y", expectedVersion: 1 };
    for (const extra of [{ email: "x@example.test" }, { role: "mgr" }, { isTest: false }, { accountId: "acc-x" }]) {
      expect(technicianUpdateError({ ...techPatch, name: "יורם", ...extra } as never), JSON.stringify(extra)).toBe("קלט לא תקין");
    }
    expect(technicianUpdateError(techPatch)).toBe(NO_CHANGE);
    expect(technicianUpdateError({ ...techPatch, active: true })).toBeNull();
    // A Manager's Customer Service request names no phone (or any other field): refused, never dropped.
    expect(accountRequestError({ kind: "create", name: "נציגה 4", email: "rep4@example.test", phone: "050-000-0000" } as never)).toBe("קלט לא תקין");

    // N2: a target without an id is refused for the Manager (fail closed).
    expect(routineUpdateCallerError(mgr, { role: "cs" } as never, { ...profile, name: "שם" })).toBe(forbidden);

    // N3: the caller first, then the fields, then who may, then the version (Migration 1's order).
    const stored = { role: "cs" as const, version: 3 };
    for (const viewer of [cs, tech, null]) {
      expect(profileUpdateCommandError({ ...profile, name: "" }, stored, viewer), String(viewer?.role)).toBe(forbidden);
    }
    expect(profileUpdateCommandError({ ...profile, name: "" }, stored, mgr)).toBe("חסר שם");
    expect(profileUpdateCommandError({ ...profile, name: "שיראל כהן" }, stored, mgr)).toBeNull();
    expect(profileUpdateCommandError({ ...profile, name: "שיראל כהן", expectedVersion: 1 }, stored, mgr)).toBe(ACTION_MESSAGES.stale);
    expect(profileUpdateCommandError({ ...profile, accountId: "acc-doron", name: "דורון" }, { role: "mgr", version: 1 }, mgr)).toBe(forbidden);
    expect(profileUpdateCommandError({ ...profile, name: "שיראל כהן" }, undefined, creator)).toBe(forbidden);

    const yoram = { version: 1, isTest: true };
    expect(technicianUpdateCommandError({ ...techPatch, name: "" }, yoram, cs)).toBe(forbidden);
    expect(technicianUpdateCommandError({ ...techPatch, name: "יורם" }, yoram, mgr)).toBeNull();
    expect(technicianUpdateCommandError({ ...techPatch, outlookEmail: "y2@example.test" }, yoram, mgr)).toBe(MANAGER_TECHNICIAN_FIELDS_PENDING);
    expect(technicianUpdateCommandError({ ...techPatch, outlookEmail: "y2@example.com" }, yoram, creator)).toBe(testAccountEmailError("y2@example.com"));
    expect(technicianUpdateCommandError({ ...techPatch, outlookEmail: "y2@example.test" }, yoram, creator)).toBeNull();
    expect(technicianUpdateCommandError({ ...techPatch, name: "יורם", expectedVersion: 2 }, yoram, creator)).toBe(ACTION_MESSAGES.stale);
    expect(technicianUpdateCommandError({ ...techPatch, name: "יורם" }, undefined, creator)).toBe(forbidden);
  });

  test("S4/CA-9: a phone allows only digits, + - and the ASCII space (the database CHECK)", () => {
    for (const bad of ["050\t1234567", "050\n1234567", "050 1234567", "050 1234567", "050 1234567"]) {
      expect(phoneError(bad), JSON.stringify(bad)).toBe("מספר טלפון לא תקין");
      expect(profileUpdateError({ accountId: "acc-shirel", expectedVersion: 3, phone: bad }), JSON.stringify(bad)).toBe("מספר טלפון לא תקין");
    }
    for (const ok of ["050 123 4567", "050-1234567", "+972 50-123-4567", "  050-1234567  "]) expect(phoneError(ok), ok).toBeNull();
  });

  test("CA-2/g: an approved creation cancelled later keeps its approver; the line never names him as the canceller", () => {
    const base: AccountRequest = {
      id: "areq-9",
      kind: "create",
      account: null,
      target: { name: "נציגה 9", email: "rep9@example.test", role: "cs" },
      newRole: null,
      requestedBy: { id: "acc-doron", name: "דורון" },
      requestedAt: "2026-10-20T09:00:00+03:00",
      status: "approved",
      reason: null,
      decidedBy: { id: "acc-creator", name: "משתמש יוצר" },
      decidedAt: "2026-10-20T10:00:00+03:00",
      cancelledAfterApproval: false,
      version: 2,
      isTest: true,
    };
    expect(requesterMayCancel(base)).toBe(true);
    expect(requesterMayCancel({ ...base, status: "pending" })).toBe(true);
    expect(requesterMayCancel({ ...base, account: { id: "acc-rep9", name: "נציגה 9" } })).toBe(false);
    expect(requesterMayCancel({ ...base, kind: "activate", account: { id: "acc-orit", name: "אורית" } })).toBe(false);
    for (const status of ["rejected", "cancelled"] as const) expect(requesterMayCancel({ ...base, status }), status).toBe(false);

    // The Manager cancels at 11:00: the approval (who and when) stays; nobody is named as the canceller.
    const after = cancelledRequest(base, { id: "acc-doron", name: "דורון" }, "2026-10-20T11:00:00+03:00");
    expect(after.status).toBe("cancelled");
    expect(after.cancelledAfterApproval).toBe(true);
    expect(after.decidedBy).toEqual(base.decidedBy);
    expect(after.decidedAt).toBe(base.decidedAt);
    expect(requestOutcomeLine(after, "20.10 10:00")).toBe("אושרה על ידי משתמש יוצר · 20.10 10:00 · בוטלה");
    expect(requestOutcomeLine(after, "20.10 10:00")).not.toContain("דורון");
    // The stored row says the same after a reload (a cancelled "create" whose decider is not its requester).
    expect(cancelledAfterApprovalOf({ kind: "create", status: "cancelled", requestedBy: "acc-doron", decidedBy: "acc-creator" })).toBe(true);

    // A pending request cancelled by its requester names him and the time of the cancellation.
    const pending = { ...base, status: "pending" as const, decidedBy: null, decidedAt: null, version: 1 };
    const cancelled = cancelledRequest(pending, { id: "acc-doron", name: "דורון" }, "2026-10-20T11:00:00+03:00");
    expect(cancelled.cancelledAfterApproval).toBe(false);
    expect(cancelled.decidedBy?.name).toBe("דורון");
    expect(cancelled.decidedAt).toBe("2026-10-20T11:00:00+03:00");
    expect(requestOutcomeLine(cancelled, "עכשיו")).toBe("בוטלה על ידי דורון · עכשיו");
    expect(cancelledAfterApprovalOf({ kind: "create", status: "cancelled", requestedBy: "acc-doron", decidedBy: "acc-doron" })).toBe(false);
    expect(cancelledAfterApprovalOf({ kind: "create", status: "approved", requestedBy: "acc-doron", decidedBy: "acc-creator" })).toBe(false);
    expect(cancelledAfterApprovalOf({ kind: "activate", status: "cancelled", requestedBy: "acc-doron", decidedBy: "acc-creator" })).toBe(false);
    expect(cancelledAfterApprovalOf({ kind: "create", status: "cancelled", requestedBy: "acc-doron", decidedBy: null })).toBe(false);

    expect(requestOutcomeLine({ ...base, status: "pending" }, null)).toBeNull();
    expect(requestOutcomeLine(base, "20.10 10:00")).toBe("אושרה על ידי משתמש יוצר · 20.10 10:00");
    expect(requestOutcomeLine({ ...base, status: "rejected" }, null)).toBe("נדחתה על ידי משתמש יוצר");
  });

  test("CA-5 d: the Creator's notices: Creator only, pending requests only, not his own Outlook change, newest first", () => {
    const notice = (id: string, kind: CreatorNotice["kind"], at: string, actorId: string): CreatorNotice => ({
      id,
      kind,
      at,
      actor: { id: actorId, name: actorId },
      actorRole: actorId === "acc-creator" ? "creator" : "mgr",
      target: { accountId: null, name: "x", role: "cs" },
      requestKind: kind === "pending-request" ? "create" : null,
      isTest: true,
    });
    const requests = [
      { status: "pending" as const, notice: notice("r1", "pending-request", "2026-10-01T09:00:00+03:00", "acc-doron") },
      { status: "approved" as const, notice: notice("r2", "pending-request", "2026-10-05T09:00:00+03:00", "acc-doron") },
      { status: "cancelled" as const, notice: notice("r3", "pending-request", "2026-10-06T09:00:00+03:00", "acc-doron") },
    ];
    const events = [
      notice("e1", "manager-deactivation", "2026-09-01T09:00:00+03:00", "acc-doron"),
      notice("e2", "outlook-email-change", "2026-10-18T10:15:00+03:00", "acc-doron"),
      notice("e3", "outlook-email-change", "2026-10-19T10:15:00+03:00", "acc-creator"),
    ];
    expect(creatorNoticesOf(creator, requests, events).map((n) => n.id)).toEqual(["e2", "r1", "e1"]);
    for (const viewer of [mgr, cs, tech, null, undefined]) {
      expect(creatorNoticesOf(viewer, requests, events), String(viewer?.role)).toEqual([]);
    }
  });

  test("CA-5 d: the session user fails closed (no profile, inactive, malformed)", () => {
    const profile = { id: "acc-doron", role: "mgr" as const, name: "דורון", active: true, technicianId: null, isTest: true };
    expect(sessionUserOf(profile)).toEqual({ id: "acc-doron", role: "mgr", name: "דורון", technicianId: null, isTest: true });
    expect(sessionUserOf({ ...profile, role: "tech", technicianId: "y" })?.technicianId).toBe("y");
    expect(sessionUserOf(null)).toBeNull();
    expect(sessionUserOf(undefined)).toBeNull();
    expect(sessionUserOf({ ...profile, active: false })).toBeNull();
    expect(sessionUserOf({ ...profile, active: "yes" as never })).toBeNull();
    for (const role of ["manager", "constructor", "", undefined]) expect(sessionUserOf({ ...profile, role: role as never }), String(role)).toBeNull();
    expect(sessionUserOf({ ...profile, id: "" })).toBeNull();
    // Never a token or an email (docs/security.md §8).
    expect(Object.keys(sessionUserOf({ ...profile, email: "doron@example.test" } as never) ?? {}).sort()).toEqual(
      ["id", "isTest", "name", "role", "technicianId"],
    );
  });
});

test.describe("PR 2.3 screens (display rules, completion commands, version wiring; pure modules)", () => {
  onlyInProject("desktop");

  const forbidden = ACTION_MESSAGES.forbidden;
  const noLonger = REQUEST_MESSAGES.noLongerApplies;
  /** A password-like value that no message, toast or result may ever repeat (U10, U12). */
  const SECRET = "Pw-Demo-73915!";
  const ROLES = ["creator", "mgr", "cs", "tech"] as const;
  /** The scope a viewer's screens get (features/auth/roles.ts; a Technician has no office scope). */
  const scopeOf = (role: AccountRole): AccountAdminScope | null => (role === "tech" ? null : accountAdminScope(role));
  const techValues = { color: "t-y" as const, device: "סמארטפון" };
  const requestStoredOf = (r: Pick<AccountRequest, "kind" | "status" | "account" | "version" | "target">): AccountRequestStored => ({
    status: r.status,
    version: r.version,
    requestedBy: "acc-doron",
    creation: r.kind === "create",
    fulfilled: r.account !== null,
    intent: false,
    requestedRole: r.target.role,
  });
  const intentStoredOf = (requestedBy: string, role: AccountRole, over: Partial<AccountRequestStored> = {}): AccountRequestStored => ({
    status: "approved",
    version: 1,
    requestedBy,
    creation: true,
    fulfilled: false,
    intent: true,
    requestedRole: role,
    ...over,
  });
  const accountStoredOf = (role: AccountRole, technicianId: string | null, over: Partial<AccountStored> = {}): AccountStored => ({
    name: "גלעד",
    email: "gilad@example.test",
    role,
    active: true,
    version: 1,
    isTest: true,
    technicianId,
    invitationAlias: null,
    ...over,
  });
  const request = (over: Partial<AccountRequest>): AccountRequest => ({
    id: "areq-6",
    kind: "create",
    account: null,
    target: { name: "נציגת ערב", email: "evening-rep@example.test", role: "cs" },
    newRole: null,
    requestedBy: { id: "acc-doron", name: "דורון" },
    requestedAt: "2026-10-19T10:00:00+03:00",
    status: "approved",
    reason: null,
    decidedBy: { id: "acc-creator", name: "משתמש יוצר" },
    decidedAt: "2026-10-19T15:10:00+03:00",
    cancelledAfterApproval: false,
    version: 2,
    isTest: true,
    ...over,
  });

  test("U1: every display rule offers exactly what its command allows; nothing without a scope or a signed-in account", () => {
    const requestCases: AccountRequest[] = [
      request({}),
      request({ status: "pending", decidedBy: null, decidedAt: null, version: 1 }),
      request({ status: "rejected" }),
      request({ status: "cancelled", cancelledAfterApproval: true, version: 3 }),
      request({ account: { id: "acc-rep2", name: "הדס" }, version: 3 }),
      request({ kind: "activate", account: { id: "acc-orit", name: "אורית" } }),
      request({ kind: "role-change", account: { id: "acc-tech-s", name: "שמואל" }, target: { name: "שמואל", email: "shmuel@example.test", role: "tech" } }),
    ];
    let checked = 0;
    for (const viewerRole of ROLES) {
      const scope = scopeOf(viewerRole);
      for (const selfId of [`acc-self-${viewerRole}`, null]) {
        const viewer: AccountViewer | null = selfId ? { id: selfId, role: viewerRole } : null;
        const label = `${viewerRole} self=${selfId ?? "unknown"}`;

        // Technician fields of the edit (Q14): the list holds a field iff the command allows it.
        const fields = technicianEditFields(scope, selfId);
        const fieldInputs: Record<TechnicianEditField, Partial<UpdateTechnicianInput>> = {
          name: { name: "יורם" },
          color: { color: "t-e" },
          device: { device: "טאבלט" },
          outlookEmail: { outlookEmail: "y2@example.test" },
          active: { active: false },
        };
        for (const field of TECHNICIAN_EDIT_FIELDS) {
          const allowed =
            routineUpdateCallerError(viewer, { id: null, role: "tech" }, { technicianId: "y", expectedVersion: 1, ...fieldInputs[field] }) === null;
          expect(fields.includes(field), `${label} field ${field}`).toBe(allowed);
          checked++;
        }

        for (const targetRole of ROLES) {
          for (const own of [false, true]) {
            if (own && targetRole !== viewerRole) continue;
            for (const missing of targetRole === "tech" ? [true, false] : [false]) {
              const rowId = own ? `acc-self-${viewerRole}` : `acc-other-${targetRole}`;
              const row = { id: rowId, role: targetRole, technicianMissing: targetRole === "tech" && missing };
              const name = `${label} → ${targetRole}${own ? " (own)" : ""}${missing ? " missing" : ""}`;

              expect(profileEditOffered(scope, row, selfId), `edit ${name}`).toBe(
                routineUpdateCallerError(viewer, { id: rowId, role: targetRole }, { accountId: rowId, expectedVersion: 1, name: "x" }) === null,
              );
              expect(technicianProfileCompletionOffered(scope, row, selfId), `complete-technician ${name}`).toBe(
                technicianProfileCompletionError(
                  { accountId: rowId, ...techValues },
                  accountStoredOf(targetRole, missing || targetRole !== "tech" ? null : "y"),
                  viewer,
                ) === null,
              );
              // Credentials: offered ⇒ the command's caller check passes; the converse fails only on
              // the Creator's own row (Q22, no self-service) or without a signed-in account.
              const offered = credentialActionsOffered(scope, row, selfId);
              const callerOk = credentialsCallerError(viewer?.role) === null;
              if (offered) expect(callerOk, `credentials ${name}`).toBe(true);
              if (callerOk && !offered) expect(own || selfId === null, `credentials converse ${name}`).toBe(true);
              checked += 3;
            }
          }
        }

        // Creation intents: only the requester completes (and cancels) his own.
        for (const intentRole of ["mgr", "cs", "tech"] as const) {
          for (const requester of [`acc-self-${viewerRole}`, "acc-someone-else"]) {
            const intent = { requestedBy: { id: requester, name: "x" } };
            const stored = intentStoredOf(requester, intentRole);
            const input = { requestId: "aint-1", phone: null, ...(intentRole === "tech" ? { technician: techValues } : {}) };
            const offered = intentCompletionOffered(scope, intent, selfId);
            expect(offered, `intent ${label} ${intentRole} by ${requester}`).toBe(completeCreationError(input, stored, viewer) === null);
            if (offered) expect(cancelRequestError({ requestId: "aint-1", expectedVersion: 1 }, stored, viewer)).toBeNull();
            checked++;
          }
        }

        // Requests: "השלמת יצירה" only on an open creation, the Creator only; his "ביטול" likewise.
        for (const r of requestCases) {
          const stored = requestStoredOf(r);
          const name = `${label} ${r.kind}/${r.status}/${r.account ? "bound" : "open"}`;
          expect(requestCompletionOffered(scope, r, selfId), `request ${name}`).toBe(
            completeCreationError({ requestId: r.id, phone: null }, stored, viewer) === null,
          );
          const cancelOk = cancelRequestError({ requestId: r.id, expectedVersion: r.version }, stored, viewer) === null;
          if (creatorCancelOffered(scope, r, selfId)) expect(cancelOk, `creator cancel ${name}`).toBe(true);
          if (viewerRole === "creator" && selfId) expect(creatorCancelOffered(scope, r, selfId), `creator cancel ⇔ ${name}`).toBe(cancelOk);
          checked++;
        }

        // Deny by default: no scope or no signed-in account offers nothing.
        if (scope === null || selfId === null) {
          const anyRow = { id: "acc-other", role: "tech" as const, technicianMissing: true };
          expect(fields, label).toEqual([]);
          expect(credentialActionsOffered(scope, anyRow, selfId), label).toBe(false);
          expect(profileEditOffered(scope, anyRow, selfId), label).toBe(false);
          expect(technicianProfileCompletionOffered(scope, anyRow, selfId), label).toBe(false);
          expect(intentCompletionOffered(scope, { requestedBy: { id: selfId ?? "acc-other", name: "x" } }, selfId), label).toBe(false);
          expect(requestCompletionOffered(scope, request({}), selfId), label).toBe(false);
          expect(creatorCancelOffered(scope, request({}), selfId), label).toBe(false);
        }
      }
    }
    // Every scope, both self states, every target role: the loops really ran.
    expect(checked).toBeGreaterThan(250);
    // The one documented difference (review AUTH-N2): an INACTIVE Technician account without a field
    // profile (fixture בני). The command allows "השלמה" (Migration 1 does not require an active
    // account); the screen offers it only for active accounts (technicianMissing is
    // technicianProfileMissing, which needs `active`), a subset of what the command allows.
    const inactive = { role: "tech" as const, active: false, technicianId: null };
    const beniRow = { id: "acc-beni", role: "tech" as const, technicianMissing: technicianProfileMissing(inactive) };
    expect(beniRow.technicianMissing).toBe(false);
    for (const viewer of [{ id: "acc-creator", role: "creator" }, { id: "acc-doron", role: "mgr" }] as const) {
      expect(technicianProfileCompletionOffered(accountAdminScope(viewer.role), beniRow, viewer.id), viewer.role).toBe(false);
      const stored = accountStoredOf("tech", null, { active: false });
      expect(technicianProfileCompletionError({ accountId: "acc-beni", ...techValues }, stored, viewer), viewer.role).toBeNull();
    }
    // Clauses that consistent data never reaches, pinned directly (review N-2): the Manager's own row
    // offers no edit even if it read as a Technician's, and only a Technician row offers "השלמה".
    expect(profileEditOffered("cs-tech", { id: "acc-doron", role: "tech" }, "acc-doron")).toBe(false);
    expect(technicianProfileCompletionOffered("cs-tech", { role: "cs", technicianMissing: true }, "acc-doron")).toBe(false);
    // The rules with the demo's real viewers (§4): what each sees.
    expect(technicianEditFields("all", "acc-creator")).toEqual(["name", "color", "device", "outlookEmail", "active"]);
    expect(technicianEditFields("cs-tech", "acc-doron")).toEqual(["name", "color", "device"]);
    expect(credentialActionsOffered("all", { id: "acc-creator" }, "acc-creator")).toBe(false);
    expect(credentialActionsOffered("all", { id: "acc-shirel" }, "acc-creator")).toBe(true);
    expect(profileEditOffered("all", { id: "acc-creator", role: "creator" }, "acc-creator")).toBe(true);
    expect(profileEditOffered("cs-tech", { id: "acc-doron", role: "mgr" }, "acc-doron")).toBe(false);
  });

  test("U2: \"השלמת יצירה\" (completeCreationError): who, which row, its state and the technician fields", () => {
    const creator: AccountViewer = { id: "acc-creator", role: "creator" };
    const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
    const createRequest = intentStoredOf("acc-doron", "cs", { intent: false, version: 2 });
    const mgrIntent = intentStoredOf("acc-doron", "tech");
    const creatorIntent = intentStoredOf("acc-creator", "mgr");
    const cs = { requestId: "areq-6", phone: null };
    const tech = { requestId: "aint-1", phone: "050-000-0000", technician: techValues };

    expect(completeCreationError(cs, createRequest, creator)).toBeNull();
    expect(completeCreationError({ ...cs, requestId: "aint-2" }, creatorIntent, creator)).toBeNull();
    expect(completeCreationError(tech, mgrIntent, creator)).toBe(forbidden);
    expect(completeCreationError(tech, mgrIntent, mgr)).toBeNull();
    expect(completeCreationError(tech, mgrIntent, { id: "acc-mgr2", role: "mgr" })).toBe(forbidden);
    expect(completeCreationError({ ...cs, requestId: "aint-2" }, creatorIntent, mgr)).toBe(forbidden);
    // Only the Creator completes a Manager's approved request (PR 1.3 Q14), never the requester.
    expect(completeCreationError(cs, createRequest, mgr)).toBe(forbidden);
    for (const viewer of [{ id: "acc-shirel", role: "cs" as const }, { id: "acc-tech-y", role: "tech" as const }, null, undefined]) {
      expect(completeCreationError(cs, createRequest, viewer), String(viewer?.role)).toBe(forbidden);
      expect(completeCreationError(tech, mgrIntent, viewer ? { ...viewer, id: "acc-doron" } : viewer), String(viewer?.role)).toBe(forbidden);
    }
    for (const over of [{ status: "pending" as const }, { status: "rejected" as const }, { status: "cancelled" as const }, { fulfilled: true }]) {
      expect(completeCreationError(cs, { ...createRequest, ...over }, creator), JSON.stringify(over)).toBe(noLonger);
      expect(completeCreationError(tech, { ...mgrIntent, ...over }, mgr), JSON.stringify(over)).toBe(noLonger);
    }
    expect(noLonger).toBe("הבקשה כבר אינה רלוונטית.");
    // A non-creation row (activate, role change) is not the Creator's to complete.
    expect(completeCreationError(cs, { ...createRequest, creation: false }, creator)).toBe(forbidden);
    expect(completeCreationError(cs, undefined, creator)).toBe(forbidden);
    expect(completeCreationError({ ...tech, technician: undefined }, mgrIntent, mgr)).toBe("פרטי הטכנאי לא תקינים");
    expect(completeCreationError({ ...cs, technician: techValues }, createRequest, creator)).toBe("קלט לא תקין");
    // Email, role, name and test marker come from the stored row: any of them is refused, never dropped.
    for (const extra of [{ email: "x@example.test" }, { role: "mgr" }, { name: "שם" }, { isTest: false }]) {
      expect(completeCreationError({ ...cs, ...extra } as never, createRequest, creator), JSON.stringify(extra)).toBe("קלט לא תקין");
    }
    expect(completeCreationError({ ...tech, technician: { ...techValues, outlookEmail: "x@example.test" } } as never, mgrIntent, mgr)).toBe("קלט לא תקין");
    expect(completeCreationError({ ...tech, technician: { ...techValues, color: "var(--t-y)" } } as never, mgrIntent, mgr)).toBe("צבע לא תקין");
    expect(completeCreationError({ ...tech, technician: { ...techValues, device: "x".repeat(41) } }, mgrIntent, mgr)).toBe("סוג המכשיר ארוך מדי");
    expect(completeCreationError({ ...cs, phone: "abc" }, createRequest, creator)).toBe("מספר טלפון לא תקין");
    expect(completeCreationError({ ...cs, phone: null }, createRequest, creator)).toBeNull();
    expect(completeCreationError({ ...cs, phone: "050-000-0108" }, createRequest, creator)).toBeNull();
    expect(completeCreationError({ ...cs, requestId: "bad id!" }, createRequest, creator)).toBe("בקשה לא תקינה");
    for (const bad of [undefined, null, "areq-6", 7]) expect(completeCreationError(bad as never, createRequest, creator), String(bad)).toBe("קלט לא תקין");
    // The caller comes first: Customer Service never learns whether a row exists.
    expect(completeCreationError({ ...cs, email: "x" } as never, undefined, { id: "acc-shirel", role: "cs" })).toBe(forbidden);
  });

  test("U3: \"השלמה\" of a missing technician profile (technicianProfileCompletionError)", () => {
    const creator: AccountViewer = { id: "acc-creator", role: "creator" };
    const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
    const input = { accountId: "acc-gilad", ...techValues };
    const gilad = accountStoredOf("tech", null);
    expect(technicianProfileCompletionError(input, gilad, creator)).toBeNull();
    expect(technicianProfileCompletionError(input, gilad, mgr)).toBeNull();
    for (const role of ["mgr", "creator"] as const) {
      expect(technicianProfileCompletionError(input, accountStoredOf(role, null), mgr), role).toBe(forbidden);
    }
    expect(technicianProfileCompletionError(input, accountStoredOf("cs", null), creator)).toBe(TECHNICIAN_MESSAGES.notTechnician);
    expect(technicianProfileCompletionError(input, accountStoredOf("cs", null), mgr)).toBe("החשבון אינו חשבון טכנאי.");
    expect(technicianProfileCompletionError(input, accountStoredOf("tech", "y"), creator)).toBe("לטכנאי כבר יש פרופיל טכנאי.");
    expect(technicianProfileCompletionError({ ...input, color: "var(--t-y)" as never }, gilad, creator)).toBe("צבע לא תקין");
    expect(technicianProfileCompletionError({ ...input, device: "x".repeat(41) }, gilad, creator)).toBe("סוג המכשיר ארוך מדי");
    expect(technicianProfileCompletionError({ ...input, device: " " }, gilad, creator)).toBe("חסר סוג מכשיר");
    for (const extra of [{ outlookEmail: "g@example.test" }, { email: "g@example.test" }, { technicianId: "g" }, { isTest: false }]) {
      expect(technicianProfileCompletionError({ ...input, ...extra } as never, gilad, creator), JSON.stringify(extra)).toBe("קלט לא תקין");
    }
    expect(technicianProfileCompletionError({ ...input, accountId: "bad id!" }, gilad, creator)).toBe("חשבון לא תקין");
    expect(technicianProfileCompletionError(input, undefined, creator)).toBe(forbidden);
    for (const viewer of [{ id: "acc-shirel", role: "cs" as const }, { id: "acc-tech-y", role: "tech" as const }, null]) {
      expect(technicianProfileCompletionError(input, gilad, viewer), String(viewer?.role)).toBe(forbidden);
    }
    expect(technicianProfileCompletionError(undefined as never, gilad, creator)).toBe("קלט לא תקין");
  });

  test("U4: an invitation alias another account holds is refused (the unique constraint); 61 characters are too long", () => {
    const accounts = {
      "acc-shirel": { invitationAlias: "שיראל" },
      "acc-rep2": { invitationAlias: "הדס" },
      "acc-doron": { invitationAlias: null },
    };
    expect(aliasTakenError("שיראל", "acc-rep2", accounts)).toBe(ACTION_MESSAGES.duplicate);
    expect(aliasTakenError("  שיראל ", "acc-rep2", accounts)).toBe("הערך כבר בשימוש.");
    // The stored alias is compared trimmed too (review N-1).
    expect(aliasTakenError("שיראל", "acc-rep2", { "acc-shirel": { invitationAlias: " שיראל " } })).toBe(ACTION_MESSAGES.duplicate);
    expect(ACTION_MESSAGES.duplicate).toBe(databaseErrorMessage({ code: "23505", message: "duplicate key value" }));
    expect(aliasTakenError("שיראל", "acc-shirel", accounts)).toBeNull();
    expect(aliasTakenError("הדס", "acc-rep2", accounts)).toBeNull();
    for (const alias of [null, "", "  ", undefined, "כינוי חדש"]) expect(aliasTakenError(alias, "acc-rep2", accounts), String(alias)).toBeNull();
    // Own keys only: an alias "constructor" is never "taken" by Object.prototype.
    expect(aliasTakenError("constructor", "acc-rep2", accounts)).toBeNull();
    expect(aliasTakenError("שיראל", "acc-rep2", {})).toBeNull();
    expect(profileUpdateError({ accountId: "acc-rep2", expectedVersion: 1, invitationAlias: "א".repeat(61) })).toBe("הכינוי ארוך מ-60 תווים");
    expect(INVITATION_ALIAS_MAX).toBe(60);
  });

  test("U5: technicianColorTokenOf is the inverse of technicianColorCss over the allowlist only", () => {
    for (const token of TECHNICIAN_COLOR_TOKENS) expect(technicianColorTokenOf(technicianColorCss(token))).toBe(token);
    for (const bad of ["t-y", "var(--t-z)", "url(x)", "__proto__", "constructor", "VAR(--T-Y)", " var(--t-y)", "", null, undefined, {}, 1]) {
      expect(technicianColorTokenOf(bad), String(bad)).toBeNull();
    }
  });

  test("U6: loginStateOf reads only the known states; anything else is the form", () => {
    for (const state of LOGIN_STATES) expect(loginStateOf(state)).toBe(state);
    // "retry" (a service failure after a submission, the form kept) since Step 2 PR 2.5.
    expect([...LOGIN_STATES]).toEqual(["form", "failed", "unavailable", "no-access", "retry"]);
    for (const bad of ["FAILED", "constructor", "__proto__", "toString", ["failed"], ["failed", "unavailable"], undefined, null, "", " failed", 1, {}]) {
      expect(loginStateOf(bad), JSON.stringify(bad) ?? String(bad)).toBe("form");
    }
  });

  test("U7: the completion refusals are the texts of Migration 1's 55000 mapping", () => {
    expect(REQUEST_MESSAGES.noLongerApplies).toBe(databaseErrorMessage({ code: "55000", message: "the request no longer applies" }));
    expect(TECHNICIAN_MESSAGES.notTechnician).toBe(databaseErrorMessage({ code: "55000", message: "the profile is not a Technician" }));
    expect(TECHNICIAN_MESSAGES.hasProfile).toBe(databaseErrorMessage({ code: "55000", message: "the Technician already has a field profile" }));
    expect(TECHNICIAN_MESSAGES).toEqual({ notTechnician: "החשבון אינו חשבון טכנאי.", hasProfile: "לטכנאי כבר יש פרופיל טכנאי." });
    for (const text of [REQUEST_MESSAGES.noLongerApplies, TECHNICIAN_MESSAGES.notTechnician, TECHNICIAN_MESSAGES.hasProfile]) {
      expect(text).not.toMatch(NO_DECISION_CODE);
    }
  });

  test("U8: the Creator's notices keep who acted and his role; any other viewer gets none", () => {
    const notice = (id: string, kind: CreatorNotice["kind"], at: string, actorId: string, actorRole: AccountRole | null): CreatorNotice => ({
      id,
      kind,
      at,
      actor: { id: actorId, name: actorId },
      actorRole,
      target: { accountId: "acc-tech-e", name: "אדי", role: "tech" },
      requestKind: kind === "pending-request" ? "create" : null,
      isTest: true,
    });
    const events = [
      notice("aev-3", "outlook-email-change", "2026-10-18T10:15:00+03:00", "acc-doron", "mgr"),
      notice("aev-1", "manager-deactivation", "2026-09-01T09:00:00+03:00", "acc-doron", "mgr"),
      notice("aev-9", "outlook-email-change", "2026-09-02T09:00:00+03:00", "acc-gone", null),
    ];
    const requests = [{ status: "pending" as const, notice: notice("areq-1", "pending-request", "2026-10-20T11:30:00+03:00", "acc-doron", "mgr") }];
    const seen = creatorNoticesOf({ id: "acc-creator", role: "creator" }, requests, events);
    expect(seen.map((n) => [n.id, n.actorRole])).toEqual([
      ["areq-1", "mgr"],
      ["aev-3", "mgr"],
      ["aev-9", null],
      ["aev-1", "mgr"],
    ]);
    for (const viewer of [{ id: "acc-doron", role: "mgr" as const }, { id: "acc-shirel", role: "cs" as const }, null]) {
      expect(creatorNoticesOf(viewer, requests, events), String(viewer?.role)).toEqual([]);
    }
  });

  test("U9: ownIntents keeps only the viewer's intents, and its total counts only them", () => {
    const intent = (id: string, requestedBy: string, role: CreationIntent["role"]): CreationIntent => ({
      id,
      role,
      name: id,
      email: `${id}@example.test`,
      requestedBy: { id: requestedBy, name: requestedBy },
      authorizedAt: "2026-10-20T09:05:00+03:00",
      version: 1,
      isTest: true,
    });
    const page = { items: [intent("aint-1", "acc-doron", "tech"), intent("aint-2", "acc-creator", "mgr")], total: 2, limit: 100 };
    expect(ownIntents(page, "acc-doron")).toEqual({ items: [page.items[0]], total: 1, limit: 100 });
    expect(ownIntents(page, "acc-creator")).toEqual({ items: [page.items[1]], total: 1, limit: 100 });
    expect(ownIntents(page, "acc-shirel")).toEqual({ items: [], total: 0, limit: 100 });
    expect(ownIntents(page, null)).toEqual({ items: [], total: 0, limit: 100 });
    // The Manager's payload never names a Manager account's intent (D34 scope).
    expect(JSON.stringify(ownIntents(page, "acc-doron"))).not.toMatch(/"role":"(mgr|creator)"/);
  });

  test("U10: no new validator repeats an input value in its message", () => {
    const creator: AccountViewer = { id: "acc-creator", role: "creator" };
    const mgr: AccountViewer = { id: "acc-doron", role: "mgr" };
    const createRequest = intentStoredOf("acc-doron", "cs", { intent: false, version: 2 });
    const mgrIntent = intentStoredOf("acc-doron", "tech");
    const messages: (string | null)[] = [
      completeCreationError({ requestId: SECRET, phone: null }, createRequest, creator),
      completeCreationError({ requestId: "areq-6", phone: SECRET }, createRequest, creator),
      completeCreationError({ requestId: "aint-1", phone: null, technician: { color: SECRET as never, device: "x" } }, mgrIntent, mgr),
      completeCreationError({ requestId: "aint-1", phone: null, technician: { color: "t-y", device: SECRET.repeat(4) } }, mgrIntent, mgr),
      completeCreationError({ requestId: "areq-6", phone: null, password: SECRET } as never, createRequest, creator),
      completeCreationError({ requestId: "areq-6", phone: null, [SECRET]: 1 } as never, createRequest, creator),
      completeCreationError({ requestId: "areq-6", phone: null }, createRequest, { id: SECRET, role: "mgr" }),
      technicianProfileCompletionError({ accountId: SECRET, ...techValues }, accountStoredOf("tech", null), creator),
      technicianProfileCompletionError({ accountId: "acc-gilad", color: SECRET as never, device: "x" }, accountStoredOf("tech", null), creator),
      technicianProfileCompletionError({ accountId: "acc-gilad", color: "t-y", device: SECRET.repeat(4) }, accountStoredOf("tech", null), creator),
      technicianProfileCompletionError({ accountId: "acc-gilad", ...techValues, password: SECRET } as never, accountStoredOf("tech", null), creator),
      aliasTakenError(SECRET, "acc-rep2", { "acc-shirel": { invitationAlias: SECRET } }),
      loginStateOf(SECRET),
      passwordError(SECRET.repeat(6)),
    ];
    expect(messages.filter((m) => m !== null).length).toBeGreaterThanOrEqual(12);
    for (const m of messages) if (m !== null) expect(m).not.toContain(SECRET);
  });

  test("U11: nothing outside /dev gains a fake action (import rules in force; no simulation markers or demo imports)", async () => {
    const root = path.resolve(__dirname, "..", "..");
    // 1. The import rules (eslint.config.mjs FIXTURE_PATTERNS and NO_APP_IMPORTS) are still in force.
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: root });
    const restricted = async (code: string, file: string) =>
      ((await eslint.lintText(code, { filePath: path.join(root, file) }))[0]?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports").length;
    const toast = 'import { useSimulate } from "@/app/dev/demo/_components/DemoToast";\nexport const probe = useSimulate;\n';
    for (const file of ["components/office/__probe.tsx", "features/__probe.ts", "lib/__probe.ts", "app/__probe/page.tsx"]) {
      expect(await restricted(toast, file), file).toBeGreaterThan(0);
    }
    const provider = 'import { SimulatedCommandsProvider } from "../../app/dev/demo/_components/SimulatedCommands";\nexport const probe = SimulatedCommandsProvider;\n';
    expect(await restricted(provider, "components/office/__probe.tsx")).toBeGreaterThan(0);
    // Control: the demo itself may use its own components.
    expect(await restricted(toast, "app/dev/demo/__probe.tsx")).toBe(0);
    // NO_APP_IMPORTS on its own (review S-2): a route module that no FIXTURE_PATTERNS entry matches,
    // so only the owner's "shared code never imports app/" rule refuses it in shared code.
    const appModule = 'import RootLayout from "@/app/layout";\nexport const probe = RootLayout;\n';
    for (const file of ["components/office/__probe.tsx", "features/__probe.ts", "lib/__probe.ts"]) {
      expect(await restricted(appModule, file), file).toBeGreaterThan(0);
    }
    // Control: routes may import app/.
    expect(await restricted(appModule, "app/__probe/page.tsx")).toBe(0);

    // 2 and 3. A TypeScript AST scan of every source file outside app/dev (comments are never seen).
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (rel !== "app/dev" && entry.name !== "node_modules") walk(rel);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
          files.push(rel);
        }
      }
    };
    for (const dir of ["components", "features", "lib", "app"]) walk(dir);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.startsWith("app/dev/"))).toBe(false);

    const SIM_IDENTIFIERS = new Set(["useSimulate", "SimulatedCommandsProvider", "buildSimulatedCommands"]);
    const DEMO_MODULE = /(^|\/)dev\/demo\/(_components|_data)(\/|$)/;
    const isDataset = (node: ts.Node) => ts.isPropertyAccessExpression(node) && node.name.text === "dataset";
    /** Every simulation marker and demo import in one source file (comments are never seen). */
    const markersIn = (file: string, text: string): string[] => {
      const found: string[] = [];
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(source) === "data-sim") found.push(`${file}: data-sim attribute`);
        if (ts.isPropertyAccessExpression(node) && node.name.text === "sim" && isDataset(node.expression)) found.push(`${file}: .dataset.sim`);
        // dataset["sim"] (review N-4).
        if (ts.isElementAccessExpression(node) && isDataset(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "sim") {
          found.push(`${file}: dataset["sim"]`);
        }
        // Any string or template text that holds the attribute's name, e.g. a selector (review N-4).
        if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && node.text.includes("data-sim")) {
          found.push(`${file}: "data-sim" in a string`);
        }
        if (ts.isIdentifier(node) && SIM_IDENTIFIERS.has(node.text)) found.push(`${file}: ${node.text}`);
        // 3. Real routes import no demo module (a general ban on app/dev imports is plan P-5, not built).
        if (file.startsWith("app/")) {
          const dynamicArg = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
          const specifier =
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
              ? node.moduleSpecifier.text
              : dynamicArg && ts.isStringLiteral(dynamicArg)
                ? dynamicArg.text
                : null;
          if (specifier !== null && DEMO_MODULE.test(specifier)) found.push(`${file}: imports ${specifier}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    };
    // The scanner itself: each marker form is found; comments and the honest wording are not.
    const probes: [string, string][] = [
      ['export const A = () => <b data-sim="x" />;', "data-sim attribute"],
      ["export const a = (el: HTMLElement) => el.dataset.sim;", ".dataset.sim"],
      ['export const a = (el: HTMLElement) => el.dataset["sim"];', 'dataset["sim"]'],
      ['export const s = "[data-sim]";', '"data-sim" in a string'],
      ["export const s = (v: string) => `button[data-sim=${v}]`;", '"data-sim" in a string'],
      ['import { x } from "@/app/dev/demo/_data/adapter";\nexport const y = x;', "imports @/app/dev/demo/_data/adapter"],
      ["export const f = useSimulate;", "useSimulate"],
    ];
    for (const [code, marker] of probes) expect(markersIn("app/__probe/x.tsx", code).join("\n"), code).toContain(marker);
    expect(markersIn("components/__probe.tsx", '// data-sim useSimulate\nexport const t = "בהדגמה · לא נשמר";\n')).toEqual([]);

    const findings = files.flatMap((file) => markersIn(file, fs.readFileSync(path.join(root, file), "utf8")));
    expect(findings).toEqual([]);
    // 4. The honest demo wording ("בהדגמה …") stays allowed in shared components: it is shown only
    // for a result marked `simulated` (G-06), so it is not a marker this scan looks for.
  });

  test("U12: the simulated commands check the caller and build created records from stored rows only", async () => {
    const details: string[] = [];
    const spy = (detail: string) => void details.push(detail);
    const accounts: Record<string, AccountStored> = {
      "acc-shirel": accountStoredOf("cs", null, { name: "שיראל", email: "shirel@example.test", version: 3, invitationAlias: "שיראל" }),
      "acc-rep2": accountStoredOf("cs", null, { name: "הדס", email: "rep2@example.test", invitationAlias: "הדס" }),
      "acc-mgr2": accountStoredOf("mgr", null, { name: "מנהל 2", email: "mgr2@example.test" }),
      "acc-gilad": accountStoredOf("tech", null),
    };
    const requests: Record<string, AccountRequestStored> = {
      "areq-6": intentStoredOf("acc-doron", "cs", { intent: false, version: 2 }),
      "aint-1": intentStoredOf("acc-doron", "tech"),
      "aint-2": intentStoredOf("acc-creator", "mgr"),
    };
    const creationTargets = {
      "areq-6": { name: "נציגת ערב", email: "evening-rep@example.test", role: "cs" as const },
      "aint-1": { name: "טכנאי חדש", email: "tech-new@example.test", role: "tech" as const },
      "aint-2": { name: "מנהלת משמרת", email: "shift-mgr@example.test", role: "mgr" as const },
    };
    const as = (selfRole: AccountRole | undefined, selfId: string | null = selfRole ? `acc-${selfRole === "mgr" ? "doron" : selfRole}` : null) =>
      buildSimulatedCommands(
        { accounts, requests, creationTargets, self: selfId ? { id: selfId, name: "x" } : null, ...(selfRole ? { selfRole } : {}) },
        spy,
        { delayMs: 0 },
      ).accounts;
    const error = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

    // createAccount: the Creator only (mutation: removing creatorOnlyError(state.selfRole) fails this).
    const newAccount = { name: "נציג", email: "new@example.test", phone: "050-000-0000", role: "cs" as const };
    for (const role of ["mgr", "cs", undefined] as const) expect(error(await as(role).createAccount(newAccount)), String(role)).toBe(forbidden);
    expect((await as("creator").createAccount(newAccount)).ok).toBe(true);
    // requestAccount: the Manager only, with a signed-in account (mutation: managerOnlyError).
    const csRequest = { kind: "create" as const, name: "נציגה 4", email: "rep4@example.test" };
    expect(error(await as("creator").requestAccount(csRequest))).toBe(forbidden);
    expect(error(await as("mgr", null).requestAccount(csRequest))).toBe(forbidden);
    expect((await as("mgr").requestAccount(csRequest)).ok).toBe(true);
    // Credentials: the Creator only.
    expect(error(await as("mgr").setPassword("acc-shirel", "Sim-Pass-4821!"))).toBe(forbidden);
    expect(error(await as("mgr").changeEmail("acc-shirel", "shirel2@example.test"))).toBe(forbidden);
    expect((await as("creator").setPassword("acc-shirel", "Sim-Pass-4821!")).ok).toBe(true);
    expect((await as("creator").changeEmail("acc-shirel", "shirel2@example.test")).ok).toBe(true);

    // completeCreation: who may, no client identity, and the created records come from the stored row.
    expect(error(await as("cs").completeCreation({ requestId: "areq-6", phone: null }))).toBe(forbidden);
    expect(error(await as("mgr").completeCreation({ requestId: "aint-2", phone: null }))).toBe(forbidden);
    expect(error(await as("mgr").completeCreation({ requestId: "areq-6", phone: null }))).toBe(forbidden);
    for (const extra of [{ name: "אחר" }, { email: "other@example.test" }]) {
      expect(error(await as("creator").completeCreation({ requestId: "areq-6", phone: null, ...extra } as never)), JSON.stringify(extra)).toBe(
        "קלט לא תקין",
      );
    }
    // A row with no stored target cannot be completed (deny by default).
    const noTarget = buildSimulatedCommands({ accounts, requests, self: { id: "acc-creator", name: "x" }, selfRole: "creator" }, spy, { delayMs: 0 });
    expect(error(await noTarget.accounts.completeCreation({ requestId: "areq-6", phone: null }))).toBe(ACTION_MESSAGES.invalid);

    details.length = 0;
    const evening = await as("creator").completeCreation({ requestId: "areq-6", phone: " 050-000-0108 " });
    expect(evening.ok).toBe(true);
    if (!evening.ok || !evening.data) throw new Error("no data");
    expect(evening.simulated).toBe(true);
    expect(evening.data.account).toMatchObject({
      name: "נציגת ערב",
      email: "evening-rep@example.test",
      role: "cs",
      phone: "050-000-0108",
      invitationAlias: null,
      active: true,
      technicianId: null,
      technicianMissing: false,
      version: 1,
      isTest: true,
    });
    expect(evening.data.technician).toBeNull();
    expect(details).toEqual(["השלמת יצירה · נציגת ערב · לא נוצר משתמש"]);

    const newTech = await as("mgr").completeCreation({ requestId: "aint-1", phone: null, technician: { color: "t-s", device: "טאבלט" } });
    if (!newTech.ok || !newTech.data) throw new Error("no data");
    expect(newTech.data.account).toMatchObject({ name: "טכנאי חדש", email: "tech-new@example.test", role: "tech", phone: "", technicianMissing: false });
    expect(newTech.data.technician).toMatchObject({ name: "טכנאי חדש", email: "tech-new@example.test", color: "var(--t-s)", device: "טאבלט", version: 1, isTest: true });
    expect(newTech.data.account.technicianId).toBe(newTech.data.technician?.id);
    expect(error(await as("mgr").completeCreation({ requestId: "aint-1", phone: null }))).toBe("פרטי הטכנאי לא תקינים");

    // completeTechnicianProfile: Creator or Manager within scope; the Outlook email is the stored one.
    expect(error(await as("cs").completeTechnicianProfile({ accountId: "acc-gilad", ...techValues }))).toBe(forbidden);
    expect(error(await as("mgr").completeTechnicianProfile({ accountId: "acc-mgr2", ...techValues }))).toBe(forbidden);
    details.length = 0;
    // The device is stored trimmed (review N-1).
    const gilad = await as("mgr").completeTechnicianProfile({ accountId: "acc-gilad", color: "t-e", device: " סמארטפון " });
    if (!gilad.ok || !gilad.data) throw new Error("no data");
    expect(gilad.data.technician).toMatchObject({
      name: "גלעד",
      email: "gilad@example.test",
      color: "var(--t-e)",
      device: "סמארטפון",
      active: true,
      version: 1,
      isTest: true,
    });
    expect(details).toEqual(["השלמת פרופיל טכנאי · גלעד"]);
    expect(error(await as("creator").completeTechnicianProfile({ accountId: "acc-gilad", ...techValues, outlookEmail: "x@example.test" } as never))).toBe(
      "קלט לא תקין",
    );

    // cancelAccountRequest: an intent's toast says it is an incomplete creation, a request's is unchanged.
    details.length = 0;
    expect((await as("mgr").cancelAccountRequest({ requestId: "aint-1", expectedVersion: 1 })).ok).toBe(true);
    expect((await as("mgr").cancelAccountRequest({ requestId: "areq-6", expectedVersion: 2 })).ok).toBe(true);
    expect(details).toEqual(["ביטול יצירה שלא הושלמה", "ביטול הבקשה"]);
    // A stale version is refused (the screen must send the version read: 2 for areq-6).
    expect(error(await as("creator").cancelAccountRequest({ requestId: "areq-6", expectedVersion: 1 }))).toBe(ACTION_MESSAGES.stale);

    // updateProfile: an alias another listed account holds is refused (23505); the caller still comes first.
    expect(error(await as("creator").updateProfile({ accountId: "acc-rep2", expectedVersion: 1, invitationAlias: "שיראל" }))).toBe(
      ACTION_MESSAGES.duplicate,
    );
    expect((await as("creator").updateProfile({ accountId: "acc-rep2", expectedVersion: 1, invitationAlias: "הדסה" })).ok).toBe(true);
    expect(error(await as("cs").updateProfile({ accountId: "acc-rep2", expectedVersion: 1, invitationAlias: "שיראל" }))).toBe(forbidden);
    expect(error(await as("creator").updateProfile(undefined as never))).not.toBeNull();

    // No echo: no toast detail or error ever repeats a password, refusals included.
    details.length = 0;
    const results = [
      await as("creator").setPassword("acc-shirel", SECRET),
      await as("mgr").setPassword("acc-shirel", SECRET),
      await as("creator").setPassword("acc-unknown", SECRET),
      await as("creator").setPassword("acc-shirel", SECRET.repeat(6)),
      await as(undefined, null).setPassword("acc-shirel", SECRET),
    ];
    expect(results.map((r) => r.ok)).toEqual([true, false, false, false, false]);
    expect(details.length).toBe(5);
    for (const text of [...details, ...results.map((r) => JSON.stringify(r))]) expect(text).not.toContain(SECRET);
  });

  test("U13: the screens' inputs carry the version read; rows keep the version a STORED result returned", () => {
    const stored = (version: number) => ({ ok: true as const, simulated: false, message: "", data: { version } });
    const simulated = { ok: true as const, simulated: true, message: "", data: { version: 9 } };
    const failed = { ok: false as const, simulated: false, error: ACTION_MESSAGES.stale };

    const shirel = {
      id: "acc-shirel",
      name: "שיראל",
      role: "cs" as const,
      email: "shirel@example.test",
      phone: "050-000-0102",
      invitationAlias: "שיראל",
      active: true,
      deactivatedAt: null,
      technicianId: null,
      technicianMissing: false,
      version: 3,
      isTest: true,
    } satisfies UserAccount;
    expect(stateInput(shirel)).toEqual({ accountId: "acc-shirel", expectedVersion: 3 });
    expect(accountAfterStateChange(shirel, stored(4), false)).toEqual({ ...shirel, active: false, version: 4 });
    expect(accountAfterStateChange(shirel, simulated, false).version).toBe(3);
    const orit = { ...shirel, active: false, deactivatedAt: "2026-09-01T09:00:00+03:00", version: 2 };
    expect(accountAfterStateChange(orit, stored(3), true)).toEqual({ ...orit, active: true, deactivatedAt: null, version: 3 });
    expect(accountAfterStateChange(orit, failed, true).version).toBe(2);

    const pendingEntry = { request: request({ status: "pending", decidedBy: null, decidedAt: null, version: 5 }), requestedLabel: "היום 08:45", decidedLabel: null };
    expect(decisionInput(pendingEntry, { outcome: "approve" })).toEqual({ requestId: "areq-6", expectedVersion: 5, decision: { outcome: "approve" } });
    expect(decisionInput(pendingEntry, { outcome: "reject", reason: "סיבה" }).expectedVersion).toBe(5);
    expect(cancelInput(pendingEntry)).toEqual({ requestId: "areq-6", expectedVersion: 5 });
    expect(intentCancelInput({ id: "aint-1", version: 4 })).toEqual({ requestId: "aint-1", expectedVersion: 4 });

    const approved = { request: request({}), requestedLabel: "19.10 10:00", decidedLabel: "19.10 15:10" };
    const decided = { ...approved.request, status: "rejected" as const };
    expect(requestEntryAfter(approved, decided, stored(3), "עכשיו")).toEqual({ ...approved, request: { ...decided, version: 3 }, decidedLabel: "עכשיו", local: false });
    expect(requestEntryAfter(approved, decided, simulated, "עכשיו")).toMatchObject({ request: { version: 2 }, local: true });

    // A cancelled approved creation keeps the approval's time; a pending one is cancelled "now".
    const cancelledApproved = cancelledRequest(approved.request, { id: "acc-creator", name: "משתמש יוצר" }, "2026-10-21T12:00:00+03:00");
    expect(cancelledEntryLabel(approved, cancelledApproved)).toBe("19.10 15:10");
    expect(requestOutcomeLine(cancelledApproved, cancelledEntryLabel(approved, cancelledApproved))).toBe("אושרה על ידי משתמש יוצר · 19.10 15:10 · בוטלה");
    const cancelledPending = cancelledRequest(pendingEntry.request, { id: "acc-doron", name: "דורון" }, "2026-10-21T12:00:00+03:00");
    expect(cancelledEntryLabel(pendingEntry, cancelledPending)).toBe("עכשיו");
    // A pending request's cancellation is "now" even when its entry carries a label (review N-1).
    expect(cancelledEntryLabel({ ...pendingEntry, decidedLabel: "19.10 15:10" }, cancelledPending)).toBe("עכשיו");

    // Routine edit: only the changed fields, trimmed, empty → null, the version read; nothing → null.
    const values = { name: "שיראל", phone: "050-000-0102", invitationAlias: "שיראל" };
    expect(profilePatch(shirel, values)).toBeNull();
    expect(profilePatch(shirel, { ...values, name: "  שיראל כהן " })).toEqual({ accountId: "acc-shirel", expectedVersion: 3, name: "שיראל כהן" });
    expect(profilePatch(shirel, { ...values, phone: " ", invitationAlias: "" })).toEqual({
      accountId: "acc-shirel",
      expectedVersion: 3,
      phone: null,
      invitationAlias: null,
    });
    expect(profilePatch(shirel, { ...values, name: "" })).toEqual({ accountId: "acc-shirel", expectedVersion: 3, name: "" });
    expect(profilePatch({ ...shirel, invitationAlias: null }, { ...values, invitationAlias: "  " })).toBeNull();
    // An account without a phone ("" as completeCreation returns it) edited without touching it (review N-1).
    expect(profilePatch({ ...shirel, phone: "" }, { ...values, phone: "" })).toBeNull();

    const eddie: AccountTechnicianDetails = { id: "e", name: "אדי", color: "var(--t-e)", device: "סמארטפון", version: 2, isTest: true };
    const eddieAll: AccountTechnicianDetails = { ...eddie, outlookEmail: "eddie@example.test", active: true };
    const mgrFields = technicianEditFields("cs-tech", "acc-doron");
    const allFields = technicianEditFields("all", "acc-creator");
    expect(technicianPatch(eddie, { name: "אדי", color: "t-e", device: "סמארטפון" }, mgrFields)).toBeNull();
    expect(technicianPatch(eddie, { name: "אדי", color: "t-s", device: " " }, mgrFields)).toEqual({ technicianId: "e", expectedVersion: 2, color: "t-s", device: null });
    // Q14: the Outlook email and "פעיל" are dropped outside the Creator's fields.
    expect(technicianPatch(eddie, { outlookEmail: "x@example.test", active: false }, mgrFields)).toBeNull();
    expect(technicianPatch(eddieAll, { outlookEmail: " eddie2@example.test ", active: false }, allFields)).toEqual({
      technicianId: "e",
      expectedVersion: 2,
      outlookEmail: "eddie2@example.test",
      active: false,
    });
    expect(technicianPatch(eddie, { color: null }, allFields)).toBeNull();
    expect(technicianPatch(eddie, { color: "var(--t-s)" as never }, allFields)).toBeNull();
    expect(technicianPatch(eddie, { name: " אדי לוי " }, [])).toBeNull();
    // Colour and device too are dropped outside the viewer's fields (review N-1).
    expect(technicianPatch(eddie, { color: "t-s", device: "טאבלט" }, [])).toBeNull();
    // A Creator-only value that was never read (details without it) is never "changed": no "פעיל" off
    // and no blank Outlook email (review N-3).
    expect(technicianPatch(eddie, { active: false, outlookEmail: "" }, allFields)).toBeNull();
    expect(technicianPatch(eddie, { device: "טאבלט", active: false }, allFields)).toEqual({ technicianId: "e", expectedVersion: 2, device: "טאבלט" });

    const profile = { accountId: "acc-shirel", expectedVersion: 3, name: "שיראל כהן", phone: null };
    expect(accountAfterProfileUpdate(shirel, profile, stored(4))).toEqual({ ...shirel, name: "שיראל כהן", phone: "", version: 4 });
    expect(accountAfterProfileUpdate(shirel, profile, simulated).version).toBe(3);
    const techUpdate = { technicianId: "e", expectedVersion: 2, color: "t-s" as const, device: null };
    expect(technicianAfterUpdate(eddie, techUpdate, stored(3))).toEqual({ ...eddie, color: "var(--t-s)", device: "", version: 3 });
    expect(technicianAfterUpdate(eddie, techUpdate, simulated).version).toBe(2);
    // The alias, the Outlook email and "פעיל" after a save (review S-1): a later save compares with them.
    expect(accountAfterProfileUpdate(shirel, { accountId: "acc-shirel", expectedVersion: 3, invitationAlias: null }, stored(4))).toEqual({
      ...shirel,
      invitationAlias: null,
      version: 4,
    });
    expect(accountAfterProfileUpdate(shirel, { accountId: "acc-shirel", expectedVersion: 3, invitationAlias: "שירה" }, simulated)).toMatchObject({
      invitationAlias: "שירה",
      version: 3,
    });
    const creatorUpdate = { technicianId: "e", expectedVersion: 2, outlookEmail: "eddie2@example.test", active: false };
    expect(technicianAfterUpdate(eddieAll, creatorUpdate, stored(3))).toEqual({ ...eddieAll, outlookEmail: "eddie2@example.test", active: false, version: 3 });
    // The Manager's details never gain the Creator-only keys.
    expect(Object.keys(technicianAfterUpdate(eddie, techUpdate, stored(3))).sort()).toEqual(["color", "device", "id", "isTest", "name", "version"]);

    // "פעיל" in Settings › טכנאים: one tracker per record across presses.
    const tracker = versionTracker(1);
    expect(tracker.current).toBe(1);
    expect(tracker.record(stored(2))).toBe(2);
    expect(tracker.record(simulated)).toBe(2);
    expect(tracker.record(failed)).toBe(2);
    expect(tracker.current).toBe(2);
    expect(versionTracker(7).record(stored(0))).toBe(7);
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
