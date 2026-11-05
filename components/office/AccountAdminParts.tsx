import type { CSSProperties, ReactNode } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import type { Bounded } from "@/features/data-access/common";
import {
  ACCOUNT_REQUEST_KIND_LABELS,
  ACCOUNT_REQUEST_STATUS_LABELS,
  ACCOUNT_ROLE_LABELS,
  requestOutcomeLine,
  type AccountRef,
  type AccountRequest,
  type AccountRequestStatus,
  type AccountRole,
  type UserAccount,
} from "@/features/accounts/data/types";

// Shared display parts of account administration (SE-01, D34): the Creator's Settings ›
// "משתמשים והרשאות" and the Manager's "ניהול משתמשים". No hooks: usable from Server and Client
// Components. In the demo's visual language: role pills as the demo's setUsers() rp() (L943,
// ROLE colours L300-305), status pills as its "פעיל" pill, tables as its Settings tables.
// Display only (G-04): every account action is authorized on the server and in the database
// under the caller's session (D34); a screen only decides what to offer.

/** Who the screen administers (display only): the Creator every account, the Manager CS and technicians. */
export type AccountAdminScope = "all" | "cs-tech";

/**
 * One account request with its times already formatted by the page (Asia/Jerusalem, G-01). `local`
 * marks a request the viewer just made or changed with a SIMULATED command: never stored, so it
 * offers no further action and shows "לא נשמר · פעולה מדומה".
 */
export type AccountRequestEntry = {
  request: AccountRequest;
  requestedLabel: string;
  decidedLabel: string | null;
  local?: boolean;
};

/** What the account-administration screen reads (through the data-access layer). */
export type AccountAdminData = {
  scope: AccountAdminScope;
  /** Accounts in the scope (Creator: every role; Manager: Customer Service and technicians). */
  accounts: Bounded<UserAccount>;
  /** Creator: every request (pending first); Manager: the Manager's own requests. */
  requests: Bounded<AccountRequestEntry>;
  /** The signed-in account (production: from the session, G-03); it offers no action on itself. */
  self: AccountRef | null;
};

/**
 * Role pill colours: the demo's ROLE[r].bg (L300-305). The demo's ROLE.tech has no colour (its
 * users table lists no technicians); --muted is a neutral new choice, shown to the owner (SE-01).
 */
const ROLE_BG: Readonly<Record<AccountRole, string>> = {
  creator: "var(--ink)",
  mgr: "var(--accent)",
  cs: "var(--s-work)",
  tech: "var(--muted)",
};

export function RolePill({ role }: { role: AccountRole }) {
  return (
    <span className="pill" style={{ background: ROLE_BG[role], color: "var(--on-dark)" }}>
      {ACCOUNT_ROLE_LABELS[role]}
    </span>
  );
}

export function AccountStatePill({ active }: { active: boolean }) {
  return active ? (
    <span className="pill" style={{ background: "var(--s-done-bg)", color: "var(--s-done-fg)" }}>
      פעיל
    </span>
  ) : (
    <span className="pill" style={{ background: "var(--s-cancel-bg)", color: "var(--s-cancel-fg)" }}>
      לא פעיל
    </span>
  );
}

const REQUEST_STATUS_COLORS: Readonly<Record<AccountRequestStatus, { bg: string; fg: string }>> = {
  pending: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  approved: { bg: "var(--s-done-bg)", fg: "var(--s-done-fg)" },
  rejected: { bg: "var(--danger-bg)", fg: "var(--danger-fg)" },
  cancelled: { bg: "var(--s-cancel-bg)", fg: "var(--s-cancel-fg)" },
};

export function RequestStatusPill({ status }: { status: AccountRequestStatus }) {
  const c = REQUEST_STATUS_COLORS[status];
  return (
    <span className="pill" style={{ background: c.bg, color: c.fg }}>
      {ACCOUNT_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

/** "שירות לקוחות ← טכנאי" for a role change; otherwise the target's role. */
export function requestRoleText(r: AccountRequest): string {
  return r.kind === "role-change" && r.newRole
    ? `${ACCOUNT_ROLE_LABELS[r.target.role]} ← ${ACCOUNT_ROLE_LABELS[r.newRole]}`
    : ACCOUNT_ROLE_LABELS[r.target.role];
}

/** "יצירת חשבון · נציגה 3". */
export const requestTitle = (r: AccountRequest): string => `${ACCOUNT_REQUEST_KIND_LABELS[r.kind]} · ${r.target.name}`;

/**
 * "אושרה על ידי משתמש יוצר · 14.09 12:20" (or who cancelled a pending request); an approved creation
 * cancelled later: "אושרה על ידי … · בוטלה" (requestOutcomeLine).
 */
export function requestOutcomeText(entry: AccountRequestEntry): string | null {
  return requestOutcomeLine(entry.request, entry.decidedLabel);
}

/** Name with the 🧪 badge of a test user (SIM-18) and an optional line under it. */
export function AccountName({ name, isTest, note }: { name: string; isTest: boolean; note?: ReactNode }) {
  return (
    <>
      <b>{name}</b>
      {isTest && (
        <>
          {" "}
          <TestBadge />
        </>
      )}
      {note && (
        <span className="sub" style={{ display: "block", fontSize: 12 }}>
          {note}
        </span>
      )}
    </>
  );
}

export type ActionMessageValue = { kind: "ok" | "error"; text: string } | null;

/**
 * Inline result line of an action. The live region is always rendered (empty when there is no
 * message), so screen readers announce each new result.
 */
export function ActionMessage({ message, style }: { message: ActionMessageValue; style?: CSSProperties }) {
  return (
    <div aria-live="polite" aria-atomic="true" style={style}>
      {message && (
        <span style={{ color: message.kind === "error" ? "var(--danger)" : "var(--s-done-fg)", fontSize: 13, fontWeight: 700 }}>
          {message.text}
        </span>
      )}
    </div>
  );
}
