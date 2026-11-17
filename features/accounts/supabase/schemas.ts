// The server's re-validation of every account action's input (docs/security.md §7: validate at
// every trust boundary; CLAUDE.md: Zod for inputs). A server action receives untrusted values: each
// parser below first checks the exact shape with a strict Zod schema (unknown keys, wrong types, ids
// that are not UUIDs and over-long strings are refused, never dropped), then the shared Hebrew rules
// (features/accounts/data/validate.ts), and returns a normalized value or one Hebrew message. When
// the shape is wrong, the Hebrew rule still names the problem where it can; otherwise "קלט לא תקין".
// No message ever repeats an input value (a password above all). Pure: no I/O.
import { z } from "zod";
import {
  NEW_ACCOUNT_ROLES,
  type AccountStateInput,
  type CancelCreationInput,
  type ChangeEmailInput,
  type CompleteCreationInput,
  type CompleteTechnicianProfileInput,
  type DeleteAccountInput,
  type NewAccountInput,
  type NewTechnicianInput,
  type RoleChangeInput,
  type SetPasswordInput,
  type UpdateProfileInput,
  type UpdateTechnicianInput,
} from "@/features/accounts/data/types";
import {
  accountIdError,
  cancelCreationError,
  credentialEmailError,
  credentialTargetError,
  deleteAccountError,
  deviceError,
  EMAIL_MAX,
  emailError,
  expectedVersionError,
  newAccountError,
  newTechnicianError,
  passwordError,
  phoneError,
  profileUpdateError,
  requestIdError,
  roleChangeError,
  technicianUpdateError,
  testAccountEmailError,
  VERSION_MAX,
  type AccountViewer,
} from "@/features/accounts/data/validate";
import { isUuid } from "@/features/data-access/common";
import { isTechnicianColorToken, TECHNICIAN_COLOR_TOKENS } from "@/features/reference/data/types";

/** The message for a value the rules cannot even read (the same words as the demo's commands). */
export const INVALID_INPUT = "קלט לא תקין";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Upper bounds before the specific rules (a hostile client may send megabytes). */
const TEXT_MAX = 400;
const PASSWORD_RAW_MAX = 1024;

const uuid = z.string().refine(isUuid);
const version = z.number().int().min(1).max(VERSION_MAX);
const text = z.string().max(TEXT_MAX);
const email = z.string().max(EMAIL_MAX + 64);
const color = z.enum(TECHNICIAN_COLOR_TOKENS);
const role = z.enum(NEW_ACCOUNT_ROLES);

/** Shape first, then the Hebrew rule (which never throws on untyped input); a rule that throws is "invalid". */
function parse<T>(schema: z.ZodType<T>, input: unknown, rule: (value: T) => string | null): Parsed<T> {
  const shaped = schema.safeParse(input);
  let message: string | null;
  try {
    message = rule((shaped.success ? shaped.data : input) as T);
  } catch {
    message = INVALID_INPUT;
  }
  if (!shaped.success) return { ok: false, error: message ?? INVALID_INPUT };
  return message ? { ok: false, error: message } : { ok: true, value: shaped.data };
}

const trimmed = (value: string): string => value.trim();
const normalizedEmail = (value: string): string => value.trim().toLowerCase();

const newAccountSchema = z.strictObject({ name: text, email, phone: text, role });

/**
 * "+ הוסף משתמש" (an office account, or a Technician account without its field profile). Until
 * go-live every new account is test-marked, so its email is in example.test (D47; Migration 1 CHECK
 * `account_requests_test_email`).
 */
export function parseNewAccount(input: unknown): Parsed<NewAccountInput> {
  const r = parse(newAccountSchema, input, (v) => newAccountError(v) ?? testAccountEmailError(v.email));
  return r.ok
    ? { ok: true, value: { name: trimmed(r.value.name), email: normalizedEmail(r.value.email), phone: trimmed(r.value.phone), role: r.value.role } }
    : r;
}

const newTechnicianSchema = z.strictObject({ name: text, email, phone: text, color, device: text });

/** "+ הוסף משתמש" with the Technician role: the account and its field profile (D47 as above). */
export function parseNewTechnician(input: unknown): Parsed<NewTechnicianInput> {
  const r = parse(newTechnicianSchema, input, (v) => newTechnicianError(v) ?? testAccountEmailError(v.email));
  return r.ok
    ? {
        ok: true,
        value: {
          name: trimmed(r.value.name),
          email: normalizedEmail(r.value.email),
          phone: trimmed(r.value.phone),
          color: r.value.color,
          device: trimmed(r.value.device),
        },
      }
    : r;
}

const completeCreationSchema = z.strictObject({
  requestId: uuid,
  phone: text.nullable(),
  technician: z.strictObject({ color, device: text }).optional(),
});

/** "השלמת יצירה": the intent id, an optional phone and, for a Technician, his colour and device. */
export function parseCompleteCreation(input: unknown): Parsed<CompleteCreationInput> {
  const r = parse(completeCreationSchema, input, (v) => {
    const shape = requestIdError(v?.requestId) ?? (v?.phone === null ? null : phoneError(v?.phone));
    if (shape || v?.technician === undefined) return shape;
    return isTechnicianColorToken(v.technician?.color) ? deviceError(v.technician.device) : "צבע לא תקין";
  });
  if (!r.ok) return r;
  const { requestId, phone, technician } = r.value;
  return {
    ok: true,
    value: {
      requestId: requestId.toLowerCase(),
      phone: phone === null ? null : trimmed(phone),
      ...(technician ? { technician: { color: technician.color, device: trimmed(technician.device) } } : {}),
    },
  };
}

const cancelCreationSchema = z.strictObject({ intentId: uuid, expectedVersion: version });

/** "ביטול" of an incomplete creation (the caller is checked with it: cancelCreationError). */
export function parseCancelCreation(input: unknown, viewer: AccountViewer): Parsed<CancelCreationInput> {
  const r = parse(cancelCreationSchema, input, (v) => cancelCreationError(v, viewer));
  return r.ok ? { ok: true, value: { intentId: r.value.intentId.toLowerCase(), expectedVersion: r.value.expectedVersion } } : r;
}

const accountStateSchema = z.strictObject({ accountId: uuid, expectedVersion: version });

/** An activation or deactivation at the version read. */
export function parseAccountState(input: unknown): Parsed<AccountStateInput> {
  const r = parse(accountStateSchema, input, (v) => accountIdError(v?.accountId) ?? expectedVersionError(v?.expectedVersion));
  return r.ok ? { ok: true, value: { accountId: r.value.accountId.toLowerCase(), expectedVersion: r.value.expectedVersion } } : r;
}

const updateProfileSchema = z.strictObject({
  accountId: uuid,
  expectedVersion: version,
  name: text.optional(),
  phone: text.nullable().optional(),
  invitationAlias: text.nullable().optional(),
});

/** A routine profile update, as a patch (an omitted field is unchanged, null clears it). */
export function parseUpdateProfile(input: unknown): Parsed<UpdateProfileInput> {
  const r = parse(updateProfileSchema, input, (v) => profileUpdateError(v));
  if (!r.ok) return r;
  const v = r.value;
  return {
    ok: true,
    value: {
      accountId: v.accountId.toLowerCase(),
      expectedVersion: v.expectedVersion,
      ...(v.name !== undefined ? { name: trimmed(v.name) } : {}),
      ...(v.phone !== undefined ? { phone: v.phone === null ? null : trimmed(v.phone) } : {}),
      ...(v.invitationAlias !== undefined ? { invitationAlias: v.invitationAlias === null ? null : trimmed(v.invitationAlias) } : {}),
    },
  };
}

const updateTechnicianSchema = z.strictObject({
  technicianId: uuid,
  expectedVersion: version,
  name: text.optional(),
  color: color.optional(),
  device: text.nullable().optional(),
  outlookEmail: email.optional(),
  active: z.boolean().optional(),
});

/** A routine technician update, as a patch (the Manager's Q14 limits are the caller's check). */
export function parseUpdateTechnician(input: unknown): Parsed<UpdateTechnicianInput> {
  const r = parse(updateTechnicianSchema, input, (v) => technicianUpdateError(v));
  if (!r.ok) return r;
  const v = r.value;
  return {
    ok: true,
    value: {
      technicianId: v.technicianId.toLowerCase(),
      expectedVersion: v.expectedVersion,
      ...(v.name !== undefined ? { name: trimmed(v.name) } : {}),
      ...(v.color !== undefined ? { color: v.color } : {}),
      ...(v.device !== undefined ? { device: v.device === null ? null : trimmed(v.device) } : {}),
      ...(v.outlookEmail !== undefined ? { outlookEmail: normalizedEmail(v.outlookEmail) } : {}),
      ...(v.active !== undefined ? { active: v.active } : {}),
    },
  };
}

const technicianProfileSchema = z.strictObject({ accountId: uuid, color, device: text });

/** "השלמה" of "פרופיל טכנאי חסר": colour and device only (the Outlook email is never an input). */
export function parseCompleteTechnicianProfile(input: unknown): Parsed<CompleteTechnicianProfileInput> {
  const r = parse(technicianProfileSchema, input, (v) =>
    accountIdError(v?.accountId) ?? (isTechnicianColorToken(v?.color) ? null : "צבע לא תקין") ?? deviceError(v?.device),
  );
  return r.ok ? { ok: true, value: { accountId: r.value.accountId.toLowerCase(), color: r.value.color, device: trimmed(r.value.device) } } : r;
}

const roleChangeSchema = z.strictObject({ accountId: uuid, expectedVersion: version, newRole: role, reason: text.optional() });

/** The Creator's role change (the caller and his own account are checked with it: roleChangeError). */
export function parseRoleChange(input: unknown, viewer: AccountViewer): Parsed<RoleChangeInput> {
  const r = parse(roleChangeSchema, input, (v) => roleChangeError(v, viewer));
  if (!r.ok) return r;
  const reason = r.value.reason?.trim();
  return {
    ok: true,
    value: {
      accountId: r.value.accountId.toLowerCase(),
      expectedVersion: r.value.expectedVersion,
      newRole: r.value.newRole,
      ...(reason ? { reason } : {}),
    },
  };
}

const deleteSchema = z.strictObject({ accountId: uuid, expectedVersion: version, confirm: z.literal(true), reason: text.optional() });

/** The Creator's deletion with its explicit confirmation (deleteAccountError: caller, confirmation, own account). */
export function parseDeleteAccount(input: unknown, viewer: AccountViewer): Parsed<DeleteAccountInput> {
  const r = parse(deleteSchema, input, (v) => deleteAccountError(v, viewer));
  if (!r.ok) return r;
  const reason = r.value.reason?.trim();
  return {
    ok: true,
    value: { accountId: r.value.accountId.toLowerCase(), expectedVersion: r.value.expectedVersion, confirm: true, ...(reason ? { reason } : {}) },
  };
}

const setPasswordSchema = z.strictObject({ accountId: uuid, password: z.string().max(PASSWORD_RAW_MAX) });

/** The Creator's password change: never his own account; the password is never trimmed or echoed. */
export function parseSetPassword(input: unknown, viewer: AccountViewer): Parsed<SetPasswordInput> {
  const r = parse(setPasswordSchema, input, (v) => credentialTargetError(viewer, v?.accountId) ?? passwordError(v?.password));
  return r.ok ? { ok: true, value: { accountId: r.value.accountId.toLowerCase(), password: r.value.password } } : r;
}

const changeEmailSchema = z.strictObject({ accountId: uuid, email });

/**
 * The Creator's email change: never his own account. Whether the target is test-marked (then the
 * address stays in example.test, D47, Q17) is checked against the stored row: credentialEmailError.
 */
export function parseChangeEmail(input: unknown, viewer: AccountViewer): Parsed<ChangeEmailInput> {
  const r = parse(changeEmailSchema, input, (v) => credentialTargetError(viewer, v?.accountId) ?? emailError(v?.email));
  return r.ok ? { ok: true, value: { accountId: r.value.accountId.toLowerCase(), email: normalizedEmail(r.value.email) } } : r;
}

/** The email rule against the stored target (test-marked: example.test only; app-only, Q17). */
export const changeEmailTargetError = (email: string, target: { isTest: boolean }): string | null => credentialEmailError(email, target);
