// Input checks for account commands, shared by every implementation (the /dev/demo simulation and
// the real server actions; the server always re-validates, and the database checks the caller's
// role under his own session, D34, D60 (7)). The D60 (7) rules of the real actions are at the end.
// Each returns a Hebrew error, or null when valid. They never throw on untyped input, and no
// message ever repeats an input password. Refusals the database also makes about WHO may act or
// WHICH record (42501: an unknown or out-of-scope target too), a request's state (55000: not
// pending, cannot be cancelled, needs the Creator) and the version (PT409) use the text of its
// mapping (features/data-access/supabase-errors.ts), so the simulation and the real adapter say the
// same thing. Input-shape messages ("חסר שם", "מספר טלפון לא תקין" …) are more specific than the
// database's generic 22023 / 23514 text, and the simulation's refusal of an account that already has
// the requested state is its own (the database treats it as a no-op).
import { isUuid } from "@/features/data-access/common";
import { ACTION_MESSAGES, REQUEST_MESSAGES, TECHNICIAN_MESSAGES } from "@/features/data-access/supabase-errors";
import { isTechnicianColorToken, type TechnicianId } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";
import {
  isAccountRole,
  isNewAccountRole,
  MANAGER_CREATABLE_ROLES,
  MANAGER_REQUESTABLE_ROLES,
  type AccountDecision,
  type AccountDecisionInput,
  type AccountId,
  type AccountRequestId,
  type AccountRequestInput,
  type AccountRequestStatus,
  type AccountRole,
  type AccountStateInput,
  type CancelAccountRequestInput,
  type CancelCreationInput,
  type CompleteCreationInput,
  type CompleteTechnicianProfileInput,
  type DeleteAccountInput,
  type NewAccountInput,
  type NewTechnicianInput,
  type RoleChangeInput,
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

/**
 * An account's address (creation, the Creator's email change, a Technician's Outlook email):
 * emailError, and printable ASCII only (review N3). The app lower-cases an address in JavaScript and
 * the database with `lower()`; the two agree only on ASCII, and a creation whose stored address
 * differed from the app's spelling would leave an intent the app refuses to finish. Internationalized
 * addresses are not supported. Sign-in and the password reset keep emailError (they only look up).
 */
export function accountEmailError(email: string): string | null {
  return emailError(email) ?? (/^[\x21-\x7e]+$/.test(email.trim()) ? null : "כתובת מייל לא תקינה");
}

/**
 * A work phone as the database CHECK allows it (`profiles.work_phone ~ '^[0-9+ -]{3,20}$'`): digits,
 * "+", "-" and the ASCII space only (never a tab, a line break or another space character), at most
 * 20 characters after trimming, with at least three digits.
 */
export function phoneError(phone: string): string | null {
  const t = typeof phone === "string" ? phone.trim() : "";
  if (!t) return "חסר טלפון";
  return t.length <= PHONE_MAX && /^[0-9+\- ]+$/.test(t) && /\d{3}/.test(t.replace(/\D/g, "")) ? null : "מספר טלפון לא תקין";
}

/** The reserved domain of test users' emails (docs/database-schema.md, D47). */
export const TEST_EMAIL_DOMAIN = "example.test";

/**
 * A test-marked account (every account the UI demo or a test creates) must use an address in the
 * reserved example.test domain, so it can never reach a real mailbox (D47).
 */
export function testAccountEmailError(email: string): string | null {
  const t = typeof email === "string" ? email.trim().toLowerCase() : "";
  // The left-to-right mark keeps "@example.test" in one piece in a right-to-left line (review S4).
  return t.endsWith(`@${TEST_EMAIL_DOMAIN}`) ? null : `נתוני בדיקה: רק כתובות \u200E@${TEST_EMAIL_DOMAIN}`;
}

/**
 * TEMPORARY (Step 2 plan Q9, PR 1.3 Q11; D49): no Creator account is created through the app until
 * the owner decides. The same words label the option in "+ הוספת משתמש".
 */
export const CREATOR_ACCOUNT_PENDING = "לא ניתן ליצור חשבון יוצר באפליקציה";

/** "+ הוספת משתמש": Manager, Customer Service or Technician (NEW_ACCOUNT_ROLES); a Creator is pending (Q9). */
export function newAccountError(input: NewAccountInput): string | null {
  const role: unknown = input?.role;
  return (
    accountNameError(input?.name) ??
    accountEmailError(input.email) ??
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
      // No phone: a request stores none (Migration 1 `account_requests`, Step 2 plan §3.7 h); a
      // phone, or any other extra field, is refused rather than dropped.
      if (!onlyKeys(input, CREATE_REQUEST_KEYS)) return "קלט לא תקין";
      return accountNameError(input.name) ?? accountEmailError(input.email);
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
  const base = accountNameError(input.name) ?? accountEmailError(input.email) ?? phoneError(input.phone);
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
  // An unknown or out-of-scope account: the database's 42501.
  if (!target) return ACTION_MESSAGES.forbidden;
  if (kind === "role-change") return MANAGER_REQUESTABLE_ROLES.includes(target.role) ? null : "רק היוצר מנהל חשבונות מנהל ויוצר";
  if (target.role !== "cs") return "בקשה לאישור היא רק לחשבון שירות לקוחות";
  return target.active ? "החשבון כבר פעיל" : null;
}

/**
 * Only a pending request can be decided (D34 a). `status` is the stored status, undefined for an
 * unknown request (Migration 1 `decide_account_request`: 22023, then 55000 "the request is not
 * pending"). Cancelling: cancelRequestError().
 */
export function pendingRequestError(status: AccountRequestStatus | undefined): string | null {
  if (!status) return ACTION_MESSAGES.invalid;
  return status === "pending" ? null : REQUEST_MESSAGES.notPending;
}

/**
 * An immediate (de)activation needs the opposite stored state. `active` is undefined when no such
 * account exists in the caller's scope (the database's 42501).
 */
export function accountStateError(action: "deactivate" | "activate", active: boolean | undefined): string | null {
  if (active === undefined) return ACTION_MESSAGES.forbidden;
  if (action === "deactivate") return active ? null : "החשבון כבר לא פעיל";
  return active ? "החשבון כבר פעיל" : null;
}

// ---------------------------------------------------------------------------------------------
// Versions (Step 2 plan §3.7 a): every Migration 1 edit function takes `p_expected_version` and
// refuses a stale one with PT409.

/** The largest version the database stores (`integer` columns and `p_expected_version`). */
export const VERSION_MAX = 2_147_483_647;

/** The version a screen read: a positive integer within the database's `integer` range. */
export function expectedVersionError(version: unknown): string | null {
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 1 && version <= VERSION_MAX
    ? null
    : "גרסה לא תקינה";
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
  /** `profiles.invitation_rep_name` (unique; aliasTakenError simulates the constraint). */
  invitationAlias: string | null;
};

/**
 * An account request as stored (like ReviewResolveStored): its status, version and requester;
 * `creation` for a create (or a creation intent), `fulfilled` once an account is bound to it;
 * `intent` for a creation intent (`direct_create`, an immediate creation's audited authorization)
 * rather than a Manager's request; `requestedRole` the role the row names (a create's target role,
 * an intent's role, the current role of another kind's account).
 */
export type AccountRequestStored = {
  status: AccountRequestStatus;
  version: number;
  requestedBy: AccountId;
  creation: boolean;
  fulfilled: boolean;
  intent: boolean;
  requestedRole: AccountRole;
};

/** Who acts (production: the session's profile id and role, never an argument). */
export type AccountViewer = { id: AccountId; role: AccountRole };

/** The accounts a Manager administers (D34): Customer Service and Technician. */
const MANAGER_SCOPE: readonly AccountRole[] = ["cs", "tech"];

// ---------------------------------------------------------------------------------------------
// Who may call (Migration 1 `require_caller`, 42501). `viewerRole` comes from the session.

/** The Creator only: decisions, "+ הוספת משתמש", passwords and emails (D34). */
export const creatorOnlyError = (viewerRole: unknown): string | null => (viewerRole === "creator" ? null : ACTION_MESSAGES.forbidden);

/** The Manager only: Customer Service requests (Migration 1 `request_account_change`, D34 a). */
export const managerOnlyError = (viewerRole: unknown): string | null => (viewerRole === "mgr" ? null : ACTION_MESSAGES.forbidden);

/** The Creator or the Manager: (de)activation, "+ הוספת טכנאי" and routine updates (D34 b–d). */
export const accountAdminCallerError = (viewerRole: unknown): string | null =>
  viewerRole === "creator" || viewerRole === "mgr" ? null : ACTION_MESSAGES.forbidden;

/**
 * A Manager activates a Technician at once (D34 c), never a Customer Service account: that is a
 * request for the Creator (D34 a; Migration 1 `admin_set_user_active`, 55000).
 */
export function managerActivationError(viewerRole: unknown, targetRole: AccountRole | undefined): string | null {
  return viewerRole === "mgr" && targetRole === "cs" ? REQUEST_MESSAGES.needsCreator : null;
}

/**
 * The Creator's decision, in the order of Migration 1 `decide_account_request`: the caller (Creator
 * only), the input, an unknown request, a request that is no longer pending, then the version
 * (PT409). Not modelled here: the database also refuses a test-marked Creator.
 */
export function decideRequestError(
  input: AccountDecisionInput,
  stored: AccountRequestStored | undefined,
  viewerRole: unknown,
): string | null {
  const caller = creatorOnlyError(viewerRole);
  if (caller) return caller;
  if (!input || typeof input !== "object") return "בקשה לא תקינה";
  return (
    requestIdError(input.requestId) ??
    expectedVersionError(input.expectedVersion) ??
    accountDecisionError(input.decision) ??
    pendingRequestError(stored?.status) ??
    (stored ? staleVersionError(input.expectedVersion, stored.version) : ACTION_MESSAGES.invalid)
  );
}

/**
 * An immediate deactivation or activation, in the order of Migration 1 `admin_set_user_active`: the
 * caller (Creator or Manager), the input, the caller's own account, an unknown or out-of-scope
 * account (the Manager's scope is Customer Service and Technician, D34), a Manager's Customer
 * Service activation (a request instead), then the version (PT409). Last, the simulation refuses an
 * account that already has that state (the database treats it as a no-op). `stored` is the account
 * as the caller may read it, undefined when there is none.
 */
export function accountStateCommandError(
  action: "deactivate" | "activate",
  input: AccountStateInput,
  stored: AccountStored | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  const caller = accountAdminCallerError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object") return "חשבון לא תקין";
  const shape = accountIdError(input.accountId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  if (input.accountId === viewer.id) return ACTION_MESSAGES.forbidden;
  if (!stored || (viewer.role === "mgr" && !MANAGER_SCOPE.includes(stored.role))) return ACTION_MESSAGES.forbidden;
  if (action === "activate" && !stored.active) {
    const needsCreator = managerActivationError(viewer.role, stored.role);
    if (needsCreator) return needsCreator;
  }
  return staleVersionError(input.expectedVersion, stored.version) ?? accountStateError(action, stored.active);
}

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
  return accountEmailError(email) ?? (target?.isTest === false ? null : testAccountEmailError(email));
}

/** Only the Creator sets passwords and changes emails (D34 e). `viewerRole` comes from the session. */
export function credentialsCallerError(viewerRole: unknown): string | null {
  return creatorOnlyError(viewerRole);
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

/** "Nothing to save": a routine update that names no field (as productUpdateError). */
export const NO_CHANGE = "אין שינוי לשמור";

/** Whether every own key of `input` is in `keys` (an extra field is refused, never dropped). */
function onlyKeys(input: object, keys: ReadonlySet<string>): boolean {
  return Object.keys(input).every((k) => keys.has(k));
}

const CREATE_REQUEST_KEYS: ReadonlySet<string> = new Set(["kind", "name", "email"]);
const PROFILE_UPDATE_FIELDS = ["name", "phone", "invitationAlias"] as const;
const PROFILE_UPDATE_KEYS: ReadonlySet<string> = new Set(["accountId", "expectedVersion", ...PROFILE_UPDATE_FIELDS]);
const TECHNICIAN_UPDATE_FIELDS = ["name", "color", "device", "outlookEmail", "active"] as const;
const TECHNICIAN_UPDATE_KEYS: ReadonlySet<string> = new Set(["technicianId", "expectedVersion", ...TECHNICIAN_UPDATE_FIELDS]);

/**
 * The fields of a profile update (the account and the caller are checked by routineUpdateCallerError).
 * Only the UpdateProfileInput keys: an email, a role or a test marker is refused, never dropped
 * (D34 e); a patch that names no field is "nothing to save".
 */
export function profileUpdateError(input: UpdateProfileInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  if (!onlyKeys(input, PROFILE_UPDATE_KEYS)) return "קלט לא תקין";
  const shape = accountIdError(input.accountId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  if (PROFILE_UPDATE_FIELDS.every((k) => input[k] === undefined)) return NO_CHANGE;
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

/**
 * The fields of a technician update; the colour is an allowlisted token, never CSS. Only the
 * UpdateTechnicianInput keys; a patch that names no field is "nothing to save".
 */
export function technicianUpdateError(input: UpdateTechnicianInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  if (!onlyKeys(input, TECHNICIAN_UPDATE_KEYS)) return "קלט לא תקין";
  if (!isTechnicianId(input.technicianId)) return "טכנאי לא תקין";
  const version = expectedVersionError(input.expectedVersion);
  if (version) return version;
  if (TECHNICIAN_UPDATE_FIELDS.every((k) => input[k] === undefined)) return NO_CHANGE;
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
    const e = accountEmailError(input.outlookEmail);
    if (e) return e;
  }
  return input.active === undefined || typeof input.active === "boolean" ? null : "מצב לא תקין";
}

/**
 * TEMPORARY (Step 2 plan Q14): the database lets a Manager change a technician's Outlook email and
 * "פעיל"; the app keeps both for the Creator until the owner decides.
 */
export const MANAGER_TECHNICIAN_FIELDS_PENDING = "רק היוצר משנה מייל ב-Outlook ומצב \"פעיל\".";


/**
 * Who may make a routine update (D34 d; Migration 1 `admin_update_profile`,
 * `admin_update_technician`): the Creator any account; the Manager a Technician or Customer Service
 * account other than his own, without the Outlook email or "פעיל" (Q14). Everyone else, and an
 * unknown target, get "no permission". `target.id` is the account id (null for a technician record,
 * which is never the Manager's own); a target without an id at all is refused (fail closed). It
 * reads `input` as sent (the patch), before an adapter fills the unchanged fields.
 */
export function routineUpdateCallerError(
  viewer: AccountViewer | null | undefined,
  target: { id: AccountId | null; role: AccountRole } | undefined,
  input: UpdateProfileInput | UpdateTechnicianInput,
): string | null {
  if (!viewer || !target) return ACTION_MESSAGES.forbidden;
  if (viewer.role === "creator") return null;
  if (viewer.role !== "mgr") return ACTION_MESSAGES.forbidden;
  if (typeof target.id !== "string" && target.id !== null) return ACTION_MESSAGES.forbidden;
  if (!MANAGER_SCOPE.includes(target.role) || (target.id !== null && isOwnAccount(target.id, viewer))) return ACTION_MESSAGES.forbidden;
  // Read as a technician update: a profile update has neither field (untyped input is checked too).
  const fields: Partial<UpdateTechnicianInput> = input && typeof input === "object" ? (input as Partial<UpdateTechnicianInput>) : {};
  return fields.outlookEmail !== undefined || fields.active !== undefined ? MANAGER_TECHNICIAN_FIELDS_PENDING : null;
}

/**
 * A routine profile update as a command checks it, in the order of Migration 1
 * `admin_update_profile`: the caller's role (Creator or Manager), the input as sent (the patch),
 * who may update this account (routineUpdateCallerError), then the version (PT409). `stored` is the
 * account as the caller may read it, undefined when there is none.
 */
export function profileUpdateCommandError(
  input: UpdateProfileInput,
  stored: Pick<AccountStored, "role" | "version"> | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  return (
    accountAdminCallerError(viewer?.role) ??
    profileUpdateError(input) ??
    routineUpdateCallerError(viewer, stored ? { id: input.accountId, role: stored.role } : undefined, input) ??
    (stored ? staleVersionError(input.expectedVersion, stored.version) : ACTION_MESSAGES.forbidden)
  );
}

/**
 * A routine technician update as a command checks it, in the order of Migration 1
 * `admin_update_technician`: the caller's role, the patch, who may (Q14 for the Manager), a
 * test-marked technician's Outlook email in example.test (D47; Migration 1
 * `technicians_test_outlook_email`), then the version (PT409).
 */
export function technicianUpdateCommandError(
  input: UpdateTechnicianInput,
  stored: { version: number; isTest: boolean } | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  return (
    accountAdminCallerError(viewer?.role) ??
    technicianUpdateError(input) ??
    routineUpdateCallerError(viewer, stored ? { id: null, role: "tech" } : undefined, input) ??
    (input.outlookEmail !== undefined && stored?.isTest !== false ? testAccountEmailError(input.outlookEmail) : null) ??
    (stored ? staleVersionError(input.expectedVersion, stored.version) : ACTION_MESSAGES.forbidden)
  );
}

// ---------------------------------------------------------------------------------------------
// Completing an open creation and a missing technician profile (Step 2 plan §3.8; PR 2.3)

const COMPLETE_CREATION_KEYS: ReadonlySet<string> = new Set(["requestId", "phone", "technician"]);
const COMPLETION_TECHNICIAN_KEYS: ReadonlySet<string> = new Set(["color", "device"]);
const TECHNICIAN_PROFILE_KEYS: ReadonlySet<string> = new Set(["accountId", "color", "device"]);

/** The field-profile part of a completion: an allowlisted colour token and a device. */
function completionTechnicianError(technician: unknown): string | null {
  if (!technician || typeof technician !== "object" || !onlyKeys(technician, COMPLETION_TECHNICIAN_KEYS)) return "קלט לא תקין";
  const t = technician as { color?: unknown; device?: unknown };
  if (!isTechnicianColorToken(t.color)) return "צבע לא תקין";
  return deviceError(t.device as string);
}

/**
 * "השלמת יצירה" (Step 2 plan §3.8 "Retry"), in Migration 1's order: the caller (Creator or
 * Manager; no viewer is refused); the input (only `requestId`, `phone` and `technician`: an email,
 * role, name or test marker is refused, never dropped, since they come from the stored row); who may
 * (the Creator on a Manager's "create" request, Variant B; the requester on his own creation
 * intent; anyone else and an unknown row get "no permission", 42501); the row's state (approved,
 * a creation, no account bound; else 55000 "the request no longer applies"); then the technician
 * fields, present exactly when the row names a Technician. `stored` is the row as the caller may
 * read it, undefined when there is none. No message ever contains an input value.
 */
export function completeCreationError(
  input: CompleteCreationInput,
  stored: AccountRequestStored | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  const caller = accountAdminCallerError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object" || !onlyKeys(input, COMPLETE_CREATION_KEYS)) return "קלט לא תקין";
  const shape =
    requestIdError(input.requestId) ??
    (input.phone === null ? null : phoneError(input.phone)) ??
    (input.technician === undefined ? null : completionTechnicianError(input.technician));
  if (shape) return shape;
  const allowed =
    stored !== undefined &&
    ((viewer.role === "creator" && !stored.intent && stored.creation) || (stored.intent && stored.requestedBy === viewer.id));
  if (!allowed) return ACTION_MESSAGES.forbidden;
  if (!(stored.status === "approved" && stored.creation && !stored.fulfilled)) return REQUEST_MESSAGES.noLongerApplies;
  if (stored.requestedRole === "tech") return input.technician === undefined ? "פרטי הטכנאי לא תקינים" : null;
  return input.technician === undefined ? null : "קלט לא תקין";
}

/**
 * "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4), in the order of Migration 1
 * `admin_create_technician`: the caller (Creator or Manager); the input (only `accountId`, `color`
 * and `device`: the Outlook email is the sign-in email the server reads, never an input); an
 * unknown account, or one outside the Manager's scope (Customer Service and Technician), gets "no
 * permission" (42501); then the account must be a Technician (55000 "the profile is not a
 * Technician") without a field profile (55000 "the Technician already has a field profile").
 */
export function technicianProfileCompletionError(
  input: CompleteTechnicianProfileInput,
  stored: AccountStored | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  const caller = accountAdminCallerError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object" || !onlyKeys(input, TECHNICIAN_PROFILE_KEYS)) return "קלט לא תקין";
  const shape =
    accountIdError(input.accountId) ?? (isTechnicianColorToken(input.color) ? null : "צבע לא תקין") ?? deviceError(input.device);
  if (shape) return shape;
  if (!stored || (viewer.role === "mgr" && !MANAGER_SCOPE.includes(stored.role))) return ACTION_MESSAGES.forbidden;
  if (stored.role !== "tech") return TECHNICIAN_MESSAGES.notTechnician;
  return stored.technicianId === null ? null : TECHNICIAN_MESSAGES.hasProfile;
}

/**
 * An invitation alias that another account already holds: the database's unique constraint
 * (`profiles.invitation_rep_name`, 23505, ACTION_MESSAGES.duplicate), simulated over the accounts
 * the caller can read (TECH: the database checks every account). The alias is compared trimmed;
 * null, "" and a non-string (not in the patch) are never taken. `accountId` is the account being
 * updated (its own alias is not "taken").
 */
export function aliasTakenError(
  alias: unknown,
  accountId: AccountId,
  accounts: Readonly<Record<string, Pick<AccountStored, "invitationAlias">>>,
): string | null {
  const wanted = typeof alias === "string" ? alias.trim() : "";
  if (!wanted) return null;
  const taken = Object.entries(accounts ?? {}).some(
    ([id, a]) => id !== accountId && typeof a?.invitationAlias === "string" && a.invitationAlias.trim() === wanted,
  );
  return taken ? ACTION_MESSAGES.duplicate : null;
}

// ---------------------------------------------------------------------------------------------
// D60 (7) (owner, 2026-11-12; supersedes D34 a and c; Migration 5). The rules of the real server
// actions (lib/actions/accounts.ts through features/accounts/supabase/commands.ts). Each mirrors a
// database refusal, so the app refuses early with the same message; the database decides in any
// case, under the caller's own session, before any Auth Admin call. The D34 request validators
// above (accountRequestError, accountRequestTargetError, decideRequestError, pendingRequestError,
// managerOnlyError, managerActivationError, cancelRequestError and the Variant B branch of
// completeCreationError) are the retired request path: the /dev/demo prototype only (D61 (1)).

/** The Creator acts on another account only: never on his own (passwords and emails: Step 2 plan Q22). */
export const OWN_ACCOUNT_REFUSED = "לא ניתן לבצע את הפעולה הזו על החשבון שלך.";

/** A deletion without the explicit confirmation (D60 (7): "after explicit confirmation"). */
export const DELETE_CONFIRMATION_REQUIRED = "יש לאשר את המחיקה במפורש.";

/** A reason stored with a role change, a deactivation or a deletion: the database's 300 characters. */
export const ACTION_REASON_MAX = 300;

/** An optional reason: absent, or a string of at most ACTION_REASON_MAX characters after trimming. */
export function actionReasonError(reason: unknown): string | null {
  if (reason === undefined) return null;
  if (typeof reason !== "string") return "סיבה לא תקינה";
  return reason.trim().length > ACTION_REASON_MAX ? `הסיבה ארוכה מ-${ACTION_REASON_MAX} תווים` : null;
}

/**
 * Who may create an account of `role` (D60 (7); Migration 5 `authorize_account_creation`): the
 * Creator a Manager, Customer Service or Technician account; the Manager a Customer Service or
 * Technician account; everyone else nothing (42501). A Creator account is never created here
 * (newAccountError: pending the owner, D49). `viewerRole` comes from the session.
 */
export function creationCallerError(viewerRole: unknown, role: unknown): string | null {
  if (viewerRole === "creator") return null;
  if (viewerRole === "mgr") return MANAGER_CREATABLE_ROLES.includes(role as AccountRole) ? null : ACTION_MESSAGES.forbidden;
  return ACTION_MESSAGES.forbidden;
}

/**
 * Whether `accountId` names the viewer's own account. Case-blind: a UUID in upper case names the
 * same row in the database and in Auth, so a plain `===` would let the Creator's own account
 * through the app-only rules (Q22) in another spelling.
 */
export function isOwnAccount(accountId: unknown, viewer: AccountViewer): boolean {
  return typeof accountId === "string" && typeof viewer.id === "string" && accountId.toLowerCase() === viewer.id.toLowerCase();
}

const ROLE_CHANGE_KEYS: ReadonlySet<string> = new Set(["accountId", "expectedVersion", "newRole", "reason"]);
const DELETE_KEYS: ReadonlySet<string> = new Set(["accountId", "expectedVersion", "confirm", "reason"]);
const CANCEL_CREATION_KEYS: ReadonlySet<string> = new Set(["intentId", "expectedVersion"]);

/**
 * The Creator's role change, in the order of Migration 1 `admin_set_user_role`: the caller (the
 * Creator only; Managers never change roles, D60 (7)), the input (only these keys; a new role of
 * NEW_ACCOUNT_ROLES: nothing makes a Creator, D49), never his own account (42501). The database also
 * refuses a Technician with a field profile, the last active Creator and a deleted account (55000).
 * Like the database, it does not refuse another Creator's account as the target; the screen does not
 * offer that row (roleChangeOffered, a display subset, review N6).
 */
export function roleChangeError(input: RoleChangeInput, viewer: AccountViewer | null | undefined): string | null {
  const caller = creatorOnlyError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object" || !onlyKeys(input, ROLE_CHANGE_KEYS)) return "קלט לא תקין";
  const shape = accountIdError(input.accountId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  const role: unknown = input.newRole;
  if (!isNewAccountRole(role)) return role === "creator" ? ACTION_MESSAGES.forbidden : "תפקיד לא תקין";
  const reason = actionReasonError(input.reason);
  if (reason) return reason;
  return isOwnAccount(input.accountId, viewer) ? ACTION_MESSAGES.forbidden : null;
}

/**
 * The Creator's deletion, in the order of Migration 5 `admin_delete_user`: the caller (the Creator
 * only; the Manager never deletes, D60 (7)), the input (only these keys; the explicit confirmation
 * `confirm: true`; a reason of at most 300 characters), never his own account (42501). The database
 * also refuses a Creator account (OQ-1), an unknown one, an account already deleted (55000) and a
 * stale version (PT409).
 */
export function deleteAccountError(input: DeleteAccountInput, viewer: AccountViewer | null | undefined): string | null {
  const caller = creatorOnlyError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object" || !onlyKeys(input, DELETE_KEYS)) return "קלט לא תקין";
  const shape = accountIdError(input.accountId) ?? expectedVersionError(input.expectedVersion);
  if (shape) return shape;
  if (input.confirm !== true) return DELETE_CONFIRMATION_REQUIRED;
  const reason = actionReasonError(input.reason);
  if (reason) return reason;
  return isOwnAccount(input.accountId, viewer) ? ACTION_MESSAGES.forbidden : null;
}

/**
 * The Creator's password and email changes (D34 e, kept by D60 (7)): the Creator only, never on
 * his own account (TEMPORARY, Step 2 plan Q22: no self-service credential screen). The database
 * check (`assert_can_change_credentials`) runs after this, before the Auth Admin call.
 */
export function credentialTargetError(viewer: AccountViewer | null | undefined, accountId: unknown): string | null {
  const caller = credentialsCallerError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  const shape = accountIdError(accountId as AccountId);
  if (shape) return shape;
  return isOwnAccount(accountId, viewer) ? OWN_ACCOUNT_REFUSED : null;
}

/** "ביטול" of an incomplete creation: the caller (Creator or Manager) and the input's shape. */
export function cancelCreationError(input: CancelCreationInput, viewer: AccountViewer | null | undefined): string | null {
  const caller = accountAdminCallerError(viewer?.role);
  if (caller || !viewer) return caller ?? ACTION_MESSAGES.forbidden;
  if (!input || typeof input !== "object" || !onlyKeys(input, CANCEL_CREATION_KEYS)) return "קלט לא תקין";
  return requestIdError(input.intentId) ?? expectedVersionError(input.expectedVersion);
}

/**
 * The stored creation intent a completion acts on (D60 (7); Migration 5 `admin_create_profile`,
 * OQ-4): only the caller's own `direct_create` (anyone else's, an unknown row and a legacy request
 * get "no permission", 42501), and only while it is approved with no account bound (55000 "the
 * request no longer applies").
 */
export function ownCreationIntentError(
  stored: AccountRequestStored | undefined,
  viewer: AccountViewer | null | undefined,
): string | null {
  if (!viewer || !stored || !stored.intent || stored.requestedBy !== viewer.id) return ACTION_MESSAGES.forbidden;
  return stored.status === "approved" && stored.creation && !stored.fulfilled ? null : REQUEST_MESSAGES.noLongerApplies;
}
