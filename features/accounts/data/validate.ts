// Input checks for account commands, shared by every implementation (simulated now, the server
// later; the server always re-validates and checks the caller's role in the database, D34).
// Each returns a Hebrew error, or null when valid. They never throw on untyped input, and no
// message ever repeats an input password. Messages that the database also produces are the same
// text as its mapping (features/data-access/supabase-errors.ts), so the simulation and the real
// adapter say the same thing.
import { isUuid } from "@/features/data-access/common";
import { ACTION_MESSAGES, REQUEST_MESSAGES } from "@/features/data-access/supabase-errors";
import { isTechnicianColorToken, type TechnicianId } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";
import {
  isAccountRole,
  isNewAccountRole,
  MANAGER_REQUESTABLE_ROLES,
  type AccountDecision,
  type AccountId,
  type AccountRequestId,
  type AccountRequestInput,
  type AccountRequestStatus,
  type AccountRole,
  type CancelAccountRequestInput,
  type NewAccountInput,
  type NewTechnicianInput,
  type UpdateProfileInput,
  type UpdateTechnicianInput,
} from "./types";

export const ACCOUNT_NAME_MAX = 60;
export const EMAIL_MAX = 254;
export const PHONE_MAX = 20;
export const DEVICE_MAX = 40;
export const REJECTION_REASON_MAX = 300;

const KEY = /^[A-Za-z0-9-]{1,64}$/;

/** Account and request ids: fixture keys now, database UUIDs later. */
export const isAccountId = (value: unknown): value is AccountId => isUuid(value) || (typeof value === "string" && KEY.test(value));

export const accountIdError = (id: AccountId): string | null => (isAccountId(id) ? null : "חשבון לא תקין");

export const requestIdError = (id: AccountRequestId): string | null => (isAccountId(id) ? null : "בקשה לא תקינה");

export function accountNameError(name: string): string | null {
  const t = typeof name === "string" ? name.trim() : "";
  if (!t) return "חסר שם";
  return t.length > ACCOUNT_NAME_MAX ? `השם ארוך מ-${ACCOUNT_NAME_MAX} תווים` : null;
}

/** A plain address check (the server and the Auth provider check again). */
export function emailError(email: string): string | null {
  const t = typeof email === "string" ? email.trim() : "";
  if (!t) return "חסר מייל";
  if (t.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return "כתובת מייל לא תקינה";
  return null;
}

export function phoneError(phone: string): string | null {
  const t = typeof phone === "string" ? phone.trim() : "";
  if (!t) return "חסר טלפון";
  return t.length <= PHONE_MAX && /^[0-9+\-\s]+$/.test(t) && /\d{3}/.test(t.replace(/\D/g, "")) ? null : "מספר טלפון לא תקין";
}

/** The reserved domain of test users' emails (docs/database-schema.md, D47). */
export const TEST_EMAIL_DOMAIN = "example.test";

/**
 * A test-marked account (every account the UI demo or a test creates) must use an address in the
 * reserved example.test domain, so it can never reach a real mailbox (D47).
 */
export function testAccountEmailError(email: string): string | null {
  const t = typeof email === "string" ? email.trim().toLowerCase() : "";
  return t.endsWith(`@${TEST_EMAIL_DOMAIN}`) ? null : `נתוני בדיקה: רק כתובות @${TEST_EMAIL_DOMAIN}`;
}

/**
 * TEMPORARY (Step 2 plan Q9, PR 1.3 Q11; D49): no Creator account is created through the app until
 * the owner decides. The same words label the option in "+ הוספת משתמש".
 */
export const CREATOR_ACCOUNT_PENDING = "יצירת חשבון יוצר: ממתין להחלטת בעלים";

/** "+ הוספת משתמש": Manager, Customer Service or Technician (NEW_ACCOUNT_ROLES); a Creator is pending (Q9). */
export function newAccountError(input: NewAccountInput): string | null {
  const role: unknown = input?.role;
  return (
    accountNameError(input?.name) ??
    emailError(input.email) ??
    phoneError(input.phone) ??
    (isNewAccountRole(role) ? null : role === "creator" ? CREATOR_ACCOUNT_PENDING : "תפקיד לא תקין")
  );
}

/**
 * The shape of a Manager's request. It does not know the target account: every implementation
 * also checks the target's CURRENT role against stored data with accountRequestTargetError() (the
 * server in the database, under the caller's session; D34).
 */
export function accountRequestError(input: AccountRequestInput): string | null {
  switch (input?.kind) {
    case "create":
      // No phone: a request stores none (Migration 1 `account_requests`, Step 2 plan §3.7 h).
      return accountNameError(input.name) ?? emailError(input.email);
    case "activate":
    case "reactivate":
      return accountIdError(input.accountId);
    case "role-change":
      if (accountIdError(input.accountId)) return accountIdError(input.accountId);
      if (!isAccountRole(input.newRole)) return "תפקיד לא תקין";
      return MANAGER_REQUESTABLE_ROLES.includes(input.newRole) ? null : "רק היוצר מנהל חשבונות מנהל ויוצר";
    default:
      return "סוג בקשה לא תקין";
  }
}

export function accountDecisionError(decision: AccountDecision): string | null {
  if (decision?.outcome === "approve") return null;
  if (decision?.outcome === "reject") {
    const reason = typeof decision.reason === "string" ? decision.reason.trim() : "";
    if (!reason) return "יש לכתוב סיבת דחייה";
    return reason.length > REJECTION_REASON_MAX ? `הסיבה ארוכה מ-${REJECTION_REASON_MAX} תווים` : null;
  }
  return "החלטה לא תקינה";
}

export function deviceError(device: string): string | null {
  const t = typeof device === "string" ? device.trim() : "";
  if (!t) return "חסר סוג מכשיר";
  return t.length > DEVICE_MAX ? "סוג המכשיר ארוך מדי" : null;
}

export function newTechnicianError(input: NewTechnicianInput): string | null {
  if (!input || typeof input !== "object") return "פרטי הטכנאי לא תקינים";
  const base = accountNameError(input.name) ?? emailError(input.email) ?? phoneError(input.phone);
  if (base) return base;
  if (!isTechnicianColorToken(input.color)) return "צבע לא תקין";
  return deviceError(input.device);
}

/**
 * The target account of a Manager's request, as stored (D34 a): "activate" and "reactivate" need
 * an inactive Customer Service account; "role-change" a Customer Service or Technician account.
 * `target` is undefined when no such account exists.
 */
export function accountRequestTargetError(
  kind: AccountRequestInput["kind"],
  target: { role: AccountRole; active: boolean } | undefined,
): string | null {
  if (kind === "create") return null;
  if (!target) return "החשבון לא נמצא";
  if (kind === "role-change") return MANAGER_REQUESTABLE_ROLES.includes(target.role) ? null : "רק היוצר מנהל חשבונות מנהל ויוצר";
  if (target.role !== "cs") return "בקשה לאישור היא רק לחשבון שירות לקוחות";
  return target.active ? "החשבון כבר פעיל" : null;
}

/** Only a pending request can be decided (D34 a). `status` is the stored status. Cancelling: cancelRequestError(). */
export function pendingRequestError(status: AccountRequestStatus | undefined): string | null {
  if (!status) return "הבקשה לא נמצאה";
  return status === "pending" ? null : "הבקשה כבר לא ממתינה להחלטה";
}

/** An immediate (de)activation needs the opposite stored state. `active` is undefined when no such account exists. */
export function accountStateError(action: "deactivate" | "activate", active: boolean | undefined): string | null {
  if (active === undefined) return "החשבון לא נמצא";
  if (action === "deactivate") return active ? null : "החשבון כבר לא פעיל";
  return active ? "החשבון כבר פעיל" : null;
}

// ---------------------------------------------------------------------------------------------
// Versions (Step 2 plan §3.7 a): every Migration 1 edit function takes `p_expected_version` and
// refuses a stale one with PT409.

/** The version a screen read: a positive integer (as productUpdateError). */
export function expectedVersionError(version: unknown): string | null {
  return typeof version === "number" && Number.isInteger(version) && version >= 1 ? null : "גרסה לא תקינה";
}

/**
 * A stale version: the record changed since the screen read it. The same text as the database's
 * PT409 mapping (ACTION_MESSAGES.stale), so the simulation and the real adapter say the same thing.
 */
export function staleVersionError(expected: number, storedVersion: number): string | null {
  return expected === storedVersion ? null : ACTION_MESSAGES.stale;
}

/**
 * An account as stored, for the checks a command runs against it (production: the database reads
 * it under the caller's session). `technicianId` is the account's technician record, if any.
 */
export type AccountStored = {
  name: string;
  email: string;
  role: AccountRole;
  active: boolean;
  version: number;
  isTest: boolean;
  technicianId: TechnicianId | null;
};

/**
 * An account request as stored (like ReviewResolveStored): its status, version and requester;
 * `creation` for a create (or a creation intent), `fulfilled` once an account is bound to it.
 */
export type AccountRequestStored = {
  status: AccountRequestStatus;
  version: number;
  requestedBy: AccountId;
  creation: boolean;
  fulfilled: boolean;
};

/** Who acts (production: the session's profile id and role, never an argument). */
export type AccountViewer = { id: AccountId; role: AccountRole };

/**
 * Cancelling a request, in the order of Migration 1 `cancel_account_request` (L1440–1482): the
 * input; then who may (the requester, or the Creator on an approved request; anyone else, and an
 * unknown request, get the same "no permission" message, 42501); then what may be cancelled (a
 * pending request, or an approved creation with no account bound yet; 55000); then the version
 * (PT409). The Creator never cancels a Manager's pending request: he rejects it with a reason.
 * Not modelled here: the database also refuses a test-marked Creator.
 */
export function cancelRequestError(
  input: CancelAccountRequestInput,
  stored: AccountRequestStored | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  if (!input || typeof input !== "object") return "בקשה לא תקינה";
  const shape = requestIdError(input.requestId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  const allowed =
    stored !== undefined &&
    viewer != null &&
    (stored.requestedBy === viewer.id || (viewer.role === "creator" && stored.status === "approved"));
  if (!allowed) return ACTION_MESSAGES.forbidden;
  const cancellable = stored.status === "pending" || (stored.status === "approved" && stored.creation && !stored.fulfilled);
  if (!cancellable) return REQUEST_MESSAGES.cannotCancel;
  return staleVersionError(input.expectedVersion, stored.version);
}

// ---------------------------------------------------------------------------------------------
// Credentials (Creator only; D34 e, D50; Step 2 plan §3.9)

/**
 * The longest password Supabase Auth accepts: bcrypt reads at most 72 bytes (UTF-8). TECH: the plan
 * asks for "non-empty and a maximum length"; strength is Supabase's configured policy (Q12).
 */
export const PASSWORD_MAX_BYTES = 72;

/** A password to set: non-empty, at most PASSWORD_MAX_BYTES UTF-8 bytes, never trimmed. The message never contains it. */
export function passwordError(password: unknown): string | null {
  if (typeof password !== "string" || password === "") return "חסרה סיסמה";
  return new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES ? "הסיסמה ארוכה מדי" : null;
}

/**
 * A new sign-in email. For a test-marked account it stays in example.test: TEMPORARY, an app-only
 * rule (the database check never receives the new email), pending the owner (Step 2 plan Q17).
 */
export function credentialEmailError(email: string, target: { isTest: boolean }): string | null {
  return emailError(email) ?? (target?.isTest === false ? null : testAccountEmailError(email));
}

/** Only the Creator sets passwords and changes emails (D34 e). `viewerRole` comes from the session. */
export function credentialsCallerError(viewerRole: unknown): string | null {
  return viewerRole === "creator" ? null : ACTION_MESSAGES.forbidden;
}

// ---------------------------------------------------------------------------------------------
// Routine updates (D34 d; Step 2 plan §3.7 e). Patch semantics: an omitted field is unchanged,
// null clears it.

/** `profiles.invitation_rep_name`: 1–60 characters, unique (the database refuses a taken one, 23505). */
export const INVITATION_ALIAS_MAX = 60;

/** An invitation alias; null or "" clears it (Migration 1 stores an empty alias as null). */
export function invitationAliasError(alias: string | null): string | null {
  if (alias === null) return null;
  if (typeof alias !== "string") return "כינוי לא תקין";
  return alias.trim().length > INVITATION_ALIAS_MAX ? `הכינוי ארוך מ-${INVITATION_ALIAS_MAX} תווים` : null;
}

/** The fields of a profile update (the account and the caller are checked by routineUpdateCallerError). */
export function profileUpdateError(input: UpdateProfileInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  const shape = accountIdError(input.accountId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  if (input.name !== undefined) {
    const e = accountNameError(input.name);
    if (e) return e;
  }
  if (input.phone !== undefined && input.phone !== null) {
    const e = phoneError(input.phone);
    if (e) return e;
  }
  return input.invitationAlias !== undefined ? invitationAliasError(input.invitationAlias) : null;
}

/** The fields of a technician update; the colour is an allowlisted token, never CSS. */
export function technicianUpdateError(input: UpdateTechnicianInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  if (!isTechnicianId(input.technicianId)) return "טכנאי לא תקין";
  const version = expectedVersionError(input.expectedVersion);
  if (version) return version;
  if (input.name !== undefined) {
    const e = accountNameError(input.name);
    if (e) return e;
  }
  if (input.color !== undefined && !isTechnicianColorToken(input.color)) return "צבע לא תקין";
  if (input.device !== undefined && input.device !== null) {
    const e = deviceError(input.device);
    if (e) return e;
  }
  if (input.outlookEmail !== undefined) {
    const e = emailError(input.outlookEmail);
    if (e) return e;
  }
  return input.active === undefined || typeof input.active === "boolean" ? null : "מצב לא תקין";
}

/**
 * TEMPORARY (Step 2 plan Q14): the database lets a Manager change a technician's Outlook email and
 * "פעיל"; the app keeps both for the Creator until the owner decides.
 */
export const MANAGER_TECHNICIAN_FIELDS_PENDING = "רק היוצר משנה מייל ב-Outlook ומצב \"פעיל\" · ממתין להחלטת בעלים";

/** The accounts a Manager administers (D34): Customer Service and Technician. */
const MANAGER_SCOPE: readonly AccountRole[] = ["cs", "tech"];

/**
 * Who may make a routine update (D34 d; Migration 1 `admin_update_profile`,
 * `admin_update_technician`): the Creator any account; the Manager a Technician or Customer Service
 * account other than his own, without the Outlook email or "פעיל" (Q14). Everyone else, and an
 * unknown target, get "no permission". `target.id` is the account id (null for a technician record,
 * which is never the Manager's own).
 */
export function routineUpdateCallerError(
  viewer: AccountViewer | null | undefined,
  target: { id: AccountId | null; role: AccountRole } | undefined,
  input: UpdateProfileInput | UpdateTechnicianInput,
): string | null {
  if (!viewer || !target) return ACTION_MESSAGES.forbidden;
  if (viewer.role === "creator") return null;
  if (viewer.role !== "mgr") return ACTION_MESSAGES.forbidden;
  if (!MANAGER_SCOPE.includes(target.role) || (target.id !== null && target.id === viewer.id)) return ACTION_MESSAGES.forbidden;
  // Read as a technician update: a profile update has neither field (untyped input is checked too).
  const fields: Partial<UpdateTechnicianInput> = input && typeof input === "object" ? (input as Partial<UpdateTechnicianInput>) : {};
  return fields.outlookEmail !== undefined || fields.active !== undefined ? MANAGER_TECHNICIAN_FIELDS_PENDING : null;
}
