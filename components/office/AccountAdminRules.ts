// Pure rules of the account screens (SE-01, D34; Step 2 PR 2.3 §3.5): the command inputs they
// send and the rows they show after a result. No hooks, no I/O (precedent: components/tech/CloseRules.ts).
// The screens call these instead of building inputs and versions inline, so the version wiring is
// unit-tested (tests/e2e/data-validate.spec.ts U13; closes PR 2.2 README CA-5 "still uncaught"):
// - every edit sends the version READ (`expectedVersion`), never a hard-coded one;
// - after a STORED result the row keeps the version the command returned (versionAfter); a
//   simulated or failed result keeps the version read.
// What remains untested is that each screen passes these outputs to its command (one line per call
// site): docs/testing.md and the independent review.
import type {
  AccountDecision,
  AccountDecisionInput,
  AccountRequest,
  AccountStateInput,
  CancelAccountRequestInput,
  CancelCreationInput,
  CreationIntent,
  UpdateProfileInput,
  UpdateTechnicianInput,
  UserAccount,
} from "@/features/accounts/data/types";
import type { TechnicianEditField } from "@/features/accounts/data/offers";
import { versionAfter, type CommandResult } from "@/features/data-access/common";
import {
  isTechnicianColorToken,
  technicianColorCss,
  technicianColorTokenOf,
  type TechnicianColorToken,
} from "@/features/reference/data/types";
import type { AccountRequestEntry, AccountTechnicianDetails } from "./AccountAdminParts";

// ---------------------------------------------------------------------------------------------
// Deactivation and activation (AccountAdminScreen)

/** An immediate deactivation or activation of an account at the version read. */
export const stateInput = (a: Pick<UserAccount, "id" | "version">): AccountStateInput => ({ accountId: a.id, expectedVersion: a.version });

/**
 * The account row after a successful (de)activation: the new state, no deactivation time once
 * active again, and the version to send next (versionAfter).
 */
export function accountAfterStateChange<A extends Pick<UserAccount, "active" | "deactivatedAt" | "version">>(
  a: A,
  result: CommandResult<unknown>,
  active: boolean,
): A {
  return { ...a, active, deactivatedAt: active ? null : a.deactivatedAt, version: versionAfter(result, a.version) };
}

// ---------------------------------------------------------------------------------------------
// Requests (AccountAdminRequests) and creation intents

/** The Creator's decision on a request at the version read (never a hard-coded version). */
export const decisionInput = (entry: AccountRequestEntry, decision: AccountDecision): AccountDecisionInput => ({
  requestId: entry.request.id,
  expectedVersion: entry.request.version,
  decision,
});

/** Cancelling a request at the version read. */
export const cancelInput = (entry: AccountRequestEntry): CancelAccountRequestInput => ({
  requestId: entry.request.id,
  expectedVersion: entry.request.version,
});

/** Cancelling one's own open creation intent ("ביטול" on "יצירה שלא הושלמה") at the version read. */
export const intentCancelInput = (intent: Pick<CreationIntent, "id" | "version">): CancelAccountRequestInput => ({
  requestId: intent.id,
  expectedVersion: intent.version,
});

/**
 * "ביטול" of one's own incomplete creation on the real screen (D60 (7); the real action's
 * CancelCreationInput) at the version read.
 */
export const cancelCreationInput = (intent: Pick<CreationIntent, "id" | "version">): CancelCreationInput => ({
  intentId: intent.id,
  expectedVersion: intent.version,
});

/**
 * A request entry after a successful action: the changed request with the version to send next
 * (versionAfter), its outcome time label, and `local` (no further action) when it was simulated.
 */
export function requestEntryAfter(
  entry: AccountRequestEntry,
  request: AccountRequest,
  result: Extract<CommandResult<unknown>, { ok: true }>,
  decidedLabel: string | null,
): AccountRequestEntry {
  return {
    ...entry,
    request: { ...request, version: versionAfter(result, entry.request.version) },
    decidedLabel,
    local: result.simulated,
  };
}

/**
 * The time label of a cancelled request (cancelledRequest): an approved creation keeps its
 * approval's time (Migration 1 keeps its decider), so only a pending request's cancellation is "now".
 */
export const cancelledEntryLabel = (entry: AccountRequestEntry, cancelled: Pick<AccountRequest, "cancelledAfterApproval">): string | null =>
  cancelled.cancelledAfterApproval ? entry.decidedLabel : "עכשיו";

// ---------------------------------------------------------------------------------------------
// Routine edit ("עריכת פרטים", D34 d): patches of the changed fields only

/** What the edit form holds for the account: the texts as typed. */
export type ProfileFormValues = { name: string; phone: string; invitationAlias: string };

/** What the edit form holds for the technician: only the fields it shows (technicianEditFields). */
export type TechnicianFormValues = {
  name?: string;
  /** The chosen colour token; null when none is chosen (an unknown stored colour). */
  color?: TechnicianColorToken | null;
  device?: string;
  outlookEmail?: string;
  active?: boolean;
};

/** Trimmed text, null when empty (Migration 1 stores an empty phone, alias or device as null). */
const optional = (value: string | null | undefined): string | null => {
  const t = typeof value === "string" ? value.trim() : "";
  return t === "" ? null : t;
};

/**
 * The profile patch of an edit: only the changed fields (patch semantics, UpdateProfileInput), the
 * name trimmed, an empty phone or alias as null, with the version read; null when nothing changed.
 */
export function profilePatch(
  a: Pick<UserAccount, "id" | "version" | "name" | "phone" | "invitationAlias">,
  values: ProfileFormValues,
): UpdateProfileInput | null {
  const patch: UpdateProfileInput = { accountId: a.id, expectedVersion: a.version };
  const name = typeof values.name === "string" ? values.name.trim() : "";
  if (name !== a.name) patch.name = name;
  const phone = optional(values.phone);
  if (phone !== optional(a.phone)) patch.phone = phone;
  const alias = optional(values.invitationAlias);
  if (alias !== optional(a.invitationAlias)) patch.invitationAlias = alias;
  return Object.keys(patch).length > 2 ? patch : null;
}

/**
 * The technician patch of an edit: only the changed fields among `fields` (the viewer's:
 * technicianEditFields; a field outside them is dropped, Q14), with the version read; null when
 * nothing changed. The colour is an allowlisted token; an empty device is null. The Outlook email
 * and "פעיל" are compared only when the details carry them (the Creator's view): a value that was
 * never read is never "changed", so a missing field can never send "פעיל" off or a blank email
 * (review N-3).
 */
export function technicianPatch(
  t: AccountTechnicianDetails,
  values: TechnicianFormValues,
  fields: readonly TechnicianEditField[],
): UpdateTechnicianInput | null {
  const allowed = new Set<TechnicianEditField>(fields);
  const patch: UpdateTechnicianInput = { technicianId: t.id, expectedVersion: t.version };
  if (allowed.has("name") && values.name !== undefined) {
    const name = typeof values.name === "string" ? values.name.trim() : "";
    if (name !== t.name) patch.name = name;
  }
  if (allowed.has("color") && isTechnicianColorToken(values.color) && values.color !== technicianColorTokenOf(t.color)) {
    patch.color = values.color;
  }
  if (allowed.has("device") && values.device !== undefined) {
    const device = optional(values.device);
    if (device !== optional(t.device)) patch.device = device;
  }
  if (allowed.has("outlookEmail") && typeof t.outlookEmail === "string" && typeof values.outlookEmail === "string") {
    const email = values.outlookEmail.trim();
    if (email !== t.outlookEmail) patch.outlookEmail = email;
  }
  if (allowed.has("active") && typeof t.active === "boolean" && typeof values.active === "boolean" && values.active !== t.active) {
    patch.active = values.active;
  }
  return Object.keys(patch).length > 2 ? patch : null;
}

/** The account row after a successful profile update: the patched fields and the version to send next. */
export function accountAfterProfileUpdate<A extends Pick<UserAccount, "name" | "phone" | "invitationAlias" | "version">>(
  a: A,
  patch: UpdateProfileInput,
  result: CommandResult<unknown>,
): A {
  return {
    ...a,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone ?? "" } : {}),
    ...(patch.invitationAlias !== undefined ? { invitationAlias: patch.invitationAlias } : {}),
    version: versionAfter(result, a.version),
  };
}

/** The technician details after a successful update: the patched fields and the version to send next. */
export function technicianAfterUpdate(
  t: AccountTechnicianDetails,
  patch: UpdateTechnicianInput,
  result: CommandResult<unknown>,
): AccountTechnicianDetails {
  return {
    ...t,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: technicianColorCss(patch.color) } : {}),
    ...(patch.device !== undefined ? { device: patch.device ?? "" } : {}),
    ...(patch.outlookEmail !== undefined ? { outlookEmail: patch.outlookEmail } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    version: versionAfter(result, t.version),
  };
}
