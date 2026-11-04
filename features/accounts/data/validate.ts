// Input checks for account commands, shared by every implementation (simulated now, the server
// later; the server always re-validates and checks the caller's role in the database, D34).
// Each returns a Hebrew error, or null when valid.
import { isUuid } from "@/features/data-access/common";
import { isTechnicianColorToken } from "@/features/reference/data/types";
import {
  isAccountRole,
  MANAGER_REQUESTABLE_ROLES,
  type AccountDecision,
  type AccountId,
  type AccountRequestId,
  type AccountRequestInput,
  type AccountRequestStatus,
  type AccountRole,
  type NewAccountInput,
  type NewTechnicianInput,
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

export function newAccountError(input: NewAccountInput): string | null {
  return (
    accountNameError(input?.name) ??
    emailError(input.email) ??
    phoneError(input.phone) ??
    (isAccountRole(input.role) ? null : "תפקיד לא תקין")
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
      return accountNameError(input.name) ?? emailError(input.email) ?? phoneError(input.phone);
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

/** Only a pending request can be decided or cancelled (D34 a). `status` is the stored status. */
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
