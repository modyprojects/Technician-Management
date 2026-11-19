// What the account screens OFFER (display rules, G-04; Step 2 PR 2.3 §4). Pure: no data, no I/O.
// A hidden button is not access control: every action is authorized on the server and in the
// database under the caller's session (D34), and each rule here mirrors the validator the
// commands share (features/accounts/data/validate.ts), so a screen never offers what the command
// refuses (tests/e2e/data-validate.spec.ts "PR 2.3 screens" U1).
// Deny by default (critique B2): every rule takes the viewer's scope (accountAdminScope; null for
// Customer Service, a Technician or no access) and the signed-in account's id (null without a
// session), and offers nothing when either is null.
import type { Bounded } from "@/features/data-access/common";
import {
  isOpenCreation,
  type AccountId,
  type AccountRequest,
  type AccountRole,
  type CreationIntent,
  type NewAccountRole,
  type UserAccount,
} from "./types";

/** Who the screen administers (display only): the Creator every account, the Manager CS and technicians. */
export type AccountAdminScope = "all" | "cs-tech";

/** The fields of the routine technician edit ("עריכת פרטים", D34 d; SE-05). */
export const TECHNICIAN_EDIT_FIELDS = ["name", "color", "device", "outlookEmail", "active"] as const;
export type TechnicianEditField = (typeof TECHNICIAN_EDIT_FIELDS)[number];

/** The Manager's technician fields: never the Outlook email or "פעיל" (TEMPORARY, Step 2 plan Q14). */
const MANAGER_TECHNICIAN_EDIT_FIELDS: readonly TechnicianEditField[] = ["name", "color", "device"];

const known = (scope: AccountAdminScope | null, selfId: AccountId | null): boolean => scope !== null && selfId !== null;

/** The accounts a Manager administers (D34): Customer Service and Technician. */
const managed = (role: AccountRole): boolean => role === "cs" || role === "tech";

/**
 * "סיסמה" and "מייל" (D34 e, D50): the Creator only, on every row but his own (TEMPORARY, Step 2
 * plan Q22: no self-service credential screen, P-6). Mirrors credentialsCallerError.
 */
export const credentialActionsOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "id">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && scope === "all" && row.id !== selfId;

/**
 * "עריכה" (D34 d): the Creator on every row, his own included; the Manager on Customer Service and
 * Technician rows, never his own. Mirrors routineUpdateCallerError.
 */
export const profileEditOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "id" | "role">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && (scope === "all" || (scope === "cs-tech" && managed(row.role) && row.id !== selfId));

/**
 * The technician fields the edit form shows: the Creator every field; the Manager name, colour
 * and device, never the Outlook email or "פעיל" (TEMPORARY, Q14). Mirrors the Q14 branch of
 * routineUpdateCallerError.
 */
export function technicianEditFields(scope: AccountAdminScope | null, selfId: AccountId | null): readonly TechnicianEditField[] {
  if (!known(scope, selfId)) return [];
  return scope === "all" ? TECHNICIAN_EDIT_FIELDS : scope === "cs-tech" ? MANAGER_TECHNICIAN_EDIT_FIELDS : [];
}

/**
 * "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4): the Creator on any such row, the
 * Manager on a Technician row. Mirrors technicianProfileCompletionError, with one difference: it is
 * offered only for ACTIVE accounts (`technicianMissing`, technicianProfileMissing), while the command
 * and Migration 1 (`admin_create_technician`) do not require an active account. The screen offers a
 * subset of what the command allows (an inactive account is completed after its activation); U1
 * pins the difference (review AUTH-N2).
 */
export const technicianProfileCompletionOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "role" | "technicianMissing">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && row.technicianMissing && (scope === "all" || (scope === "cs-tech" && row.role === "tech"));

/**
 * "השלמת יצירה" on a "יצירה שלא הושלמה" row: only the intent's requester (Migration 5 OQ-4).
 * Mirrors ownCreationIntentError (and completeCreationError).
 */
export const intentCompletionOffered = (
  scope: AccountAdminScope | null,
  intent: Pick<CreationIntent, "requestedBy">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && intent.requestedBy.id === selfId;

/**
 * "ביטול" on a "יצירה שלא הושלמה" row: the requester, or the Creator on anyone's open intent (review
 * S3; Migration 1 `cancel_account_request` lets a real Creator cancel an approved request). Mirrors
 * the database's rule; the command refuses nothing more (cancelCreationError checks the shape only).
 */
export const intentCancelOffered = (
  scope: AccountAdminScope | null,
  intent: Pick<CreationIntent, "requestedBy">,
  selfId: AccountId | null,
): boolean => intentCompletionOffered(scope, intent, selfId) || (known(scope, selfId) && scope === "all");

/**
 * "השלמת יצירה" on an approved creation request with no account yet (Variant B; TEMPORARY, Q15):
 * the Creator only (PR 1.3 Q14). Mirrors completeCreationError.
 */
export const requestCompletionOffered = (
  scope: AccountAdminScope | null,
  request: Pick<AccountRequest, "kind" | "status" | "account">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && scope === "all" && isOpenCreation(request);

/**
 * The Creator's "ביטול" of an approved creation request with no account yet (never of a pending
 * request: he rejects it with a reason). Mirrors cancelRequestError.
 */
export const creatorCancelOffered = (
  scope: AccountAdminScope | null,
  request: Pick<AccountRequest, "kind" | "status" | "account">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && scope === "all" && isOpenCreation(request);

/**
 * The viewer's own open creation intents, with `total` their count (critique S2: never the
 * unfiltered total, which would reveal others' intents). No viewer: none. The demo adapter returns
 * every fictional intent; production filters on the server (`requested_by` = the session's user).
 */
export function ownIntents(page: Bounded<CreationIntent>, selfId: AccountId | null): Bounded<CreationIntent> {
  const items = selfId === null ? [] : page.items.filter((i) => i.requestedBy.id === selfId);
  return { items, total: items.length, limit: page.limit };
}

// ---------------------------------------------------------------------------------------------
// D60 (7) (owner, 2026-11-12; Migration 5): what the real unified user-management screen offers.
// Each mirrors a D60 rule of validate.ts (creationCallerError, roleChangeError, deleteAccountError,
// the (de)activation caller check), with deny by default as above; the server and the database
// decide in any case.

/**
 * The roles of "הוסף משתמש" (one button, a role choice; QA M-06, C-01): the Creator Technician,
 * Customer Service and Manager; the Manager Technician and Customer Service. Never Creator
 * (TEMPORARY, Step 2 plan Q9; D49). Mirrors creationCallerError and NEW_ACCOUNT_ROLES.
 */
export function creatableRoles(scope: AccountAdminScope | null, selfId: AccountId | null): readonly NewAccountRole[] {
  if (!known(scope, selfId)) return [];
  return scope === "all" ? CREATOR_CREATABLE_ROLES : scope === "cs-tech" ? MANAGER_CREATABLE : [];
}

const CREATOR_CREATABLE_ROLES: readonly NewAccountRole[] = ["tech", "cs", "mgr"];
const MANAGER_CREATABLE: readonly NewAccountRole[] = ["tech", "cs"];

/**
 * "השבתה" / "הפעלה" (D60 (7): immediate, no Creator approval): the Creator on every row but his own;
 * the Manager on Customer Service and Technician rows, never his own. Mirrors the caller check of
 * `admin_set_user_active` (the database also refuses the last active Creator).
 */
export const stateChangeOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "id" | "role">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && row.id !== selfId && (scope === "all" || (scope === "cs-tech" && managed(row.role)));

/**
 * "שינוי תפקיד" (D60 (7): the Creator only; Managers never change roles): never his own row, not a
 * Technician that has a field profile (Migration 1 `admin_set_user_role` refuses it, 55000) and,
 * as a display choice, never a Creator row (review N6). The screen offers a SUBSET of what the
 * server allows: roleChangeError and `admin_set_user_role` refuse the caller's own account and a
 * new role of Creator (D49), but not a Creator target; the database's last-active-Creator rule is
 * the only guard there. Demoting another Creator is left out of the screen, TEMPORARY, until the
 * owner decides how Creator accounts are managed; the other Creator-row offers ("עריכה", "סיסמה",
 * "מייל", "השבתה") follow their own rules (the database refuses deactivating the last active
 * Creator). tests/e2e/user-management-ui.spec.ts pins the difference.
 */
export const roleChangeOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "id" | "role" | "technicianId">,
  selfId: AccountId | null,
): boolean =>
  known(scope, selfId) && scope === "all" && row.id !== selfId && row.role !== "creator" && !(row.role === "tech" && row.technicianId !== null);

/** The roles a role change may give (never Creator, never the current role). */
export const roleChangeChoices = (current: AccountRole): readonly NewAccountRole[] =>
  CREATOR_CREATABLE_ROLES.filter((r) => r !== current);

/**
 * "מחיקה" (D60 (7) Option A: the Creator only, after an explicit confirmation): never his own row
 * and never a Creator row (TEMPORARY OQ-1; Migration 5 `admin_delete_user` refuses both). Mirrors
 * deleteAccountError.
 */
export const deleteOffered = (
  scope: AccountAdminScope | null,
  row: Pick<UserAccount, "id" | "role">,
  selfId: AccountId | null,
): boolean => known(scope, selfId) && scope === "all" && row.id !== selfId && row.role !== "creator";
