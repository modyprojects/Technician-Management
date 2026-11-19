"use client";

// The real unified user management (D60 (7); QA M-06, M-10, C-01, C-02, C-09): one screen for the
// Manager's Settings › "משתמשים" (scope "cs-tech": Technician and Customer Service users) and the
// Creator's Settings › "משתמשים והרשאות" (scope "all": every role). Real data only (D61): the page
// reads the rows under the viewer's own session (lib/data/supabase/accounts.ts) and passes the real
// server actions (lib/actions/accounts.ts) as `actions`; components/ never imports lib/actions.
// In the demo's visual language (setUsers() L942-944 as amended by SE-01, SE-17 to SE-20), reusing
// the prototype's parts and dialogs (AccountAdminParts, AccountDialog, AccountEditForm,
// AccountCredentialForms, AccountCompletionForms) through AccountCommandsProvider.
// - One "+ הוסף משתמש" with a role choice (AccountAddDialog): the Creator Technician, Customer
//   Service or Manager; the Manager Technician or Customer Service; never Creator (Q9).
// - Row actions by the display rules of features/accounts/data/offers.ts (each mirrors the server's
//   check; deny by default): "עריכה" (both), "סיסמה" and "מייל" (the Creator, never his own row),
//   "השלמה" of "פרופיל טכנאי חסר", "תפקיד" (the Creator only), "השבתה" with a confirmation ("an
//   inactive user cannot sign in; history kept") / "הפעלה", "מחיקה" (the Creator only, after an
//   explicit confirmation). No "בקשות לאישור" anywhere (C-02).
// - "יצירה שלא הושלמה" rows: the requester's own with "השלמת יצירה" and "ביטול"; for the Creator
//   also other people's open intents, with "ביטול" only and the requester's name (review S3).
// - A deletion stored in the database whose Auth ban failed (ACCOUNT_MESSAGES.revokeIncomplete):
//   the row is gone, so the card keeps the account and its version and offers "נסו שוב", which sends
//   the same deletion again; the server then repeats only the ban (review S1).
// - Every edit sends the version read (`expectedVersion`); after every action the page is read
//   again (router.refresh), so the rows and their versions are the database's, and a stale one
//   shows the server's "data changed" message (PT409). The row buttons wait while it reloads.
// - No password is ever kept or shown: the password dialog's field is uncontrolled and emptied after
//   the call (AccountCredentialForms; autocomplete "new-password").
// - Accessible: each dialog is modal (focus moves in, Tab stays inside, Escape closes, focus returns
//   to its opener); a success moves focus to the changed row (or to "+ הוסף משתמש" when the row is
//   gone); results are announced in a live region. At ≤ 520 px the email, role and state move under
//   the name, so every action stays in view without a sideways scroll (SE-17).
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { AccountCommandsProvider, useAccountCommands } from "@/features/accounts/commands-context";
import { accountCommandsOfActions, type AccountActions } from "@/features/accounts/data/actions";
import {
  creatableRoles,
  credentialActionsOffered,
  deleteOffered,
  intentCancelOffered,
  intentCompletionOffered,
  profileEditOffered,
  roleChangeOffered,
  stateChangeOffered,
  technicianEditFields,
  technicianProfileCompletionOffered,
  type AccountAdminScope,
} from "@/features/accounts/data/offers";
import { ACCOUNT_ROLE_LABELS, type AccountRef, type UserAccount } from "@/features/accounts/data/types";
import { ACCOUNT_MESSAGES } from "@/features/data-access/supabase-errors";
import type { Bounded } from "@/features/data-access/common";
import { TECHNICIAN_COLOR_NAMES, technicianColorTokenOf } from "@/features/reference/data/types";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { AccountAddDialog } from "./AccountAddDialog";
import { AccountName, AccountStatePill, ActionMessage, RolePill, type ActionMessageValue, type CreationIntentEntry } from "./AccountAdminParts";
import { cancelCreationInput, stateInput } from "./AccountAdminRules";
import { CompleteCreationForm, CompleteTechnicianForm } from "./AccountCompletionForms";
import { AccountConfirmDialog } from "./AccountConfirmDialog";
import { EmailForm, PasswordForm } from "./AccountCredentialForms";
import { DIALOG_FAILED } from "./AccountDialog";
import { AccountEditForm } from "./AccountEditForm";
import { AccountRoleDialog } from "./AccountRoleDialog";
import { SettingsCardHead, SettingsMore } from "./SettingsShell";
import {
  activatedLine,
  createdLine,
  deactivatedLine,
  deletedLine,
  editedLine,
  emailLine,
  intentCancelledLine,
  intentCompletedLine,
  passwordLine,
  roleChangedLine,
  technicianCompletedLine,
  USER_MANAGEMENT_SUBS,
  USER_MANAGEMENT_TITLES,
  type UserManagementRow,
} from "./UserManagementRules";

const SHORT = "col-center col-fit";
/** Row action buttons: the demo's small table chip, 24 px tall at least. */
const ROW_BTN = { padding: "4px 12px", fontSize: 12 } as const;
/** A deletion stored in the database whose Auth step failed: the row is gone, the message stays. */
const DELETE_SETTLED: ReadonlySet<string> = new Set([ACCOUNT_MESSAGES.revokeIncomplete]);

/** A deletion whose Auth ban is still to be completed ("נסו שוב", review S1): what the retry sends. */
type DeleteRetry = { accountId: string; version: number; name: string };

type Dialog =
  | { kind: "add"; opener: string }
  | { kind: "edit" | "password" | "email" | "complete-tech" | "role" | "deactivate" | "delete"; accountId: string; opener: string }
  | { kind: "complete-intent"; intentId: string; opener: string };

export type UserManagementProps = {
  scope: AccountAdminScope;
  /** The signed-in account (from the session); it never gets the actions that are not his. */
  self: AccountRef;
  rows: Bounded<UserManagementRow>;
  /** The viewer's own open creation intents ("יצירה שלא הושלמה"). */
  intents: Bounded<CreationIntentEntry>;
  /** The real server actions (lib/actions/accounts.ts), passed in by the page. */
  actions: AccountActions;
  /** Cards shown under the test-data banner and above the users card (the Creator's notices, D74). */
  top?: ReactNode;
};

/** The email as the viewer may know it (TEMPORARY, Step 2 plan Q5): null when unknown ("—"). */
const knownEmail = (email: string): string | null => (email.trim() === "" ? null : email);

/** A Technician's line under his name: his calendar colour and, for the Creator, "לא מקבל זימונים חדשים". */
function TechnicianLine({ row }: { row: UserManagementRow }) {
  const t = row.technician;
  if (!t) return null;
  const token = technicianColorTokenOf(t.color);
  return (
    <span className="sub acct-tech-line">
      {token && (
        <>
          <span className="set-swatch" style={{ background: t.color }} aria-hidden="true" /> {TECHNICIAN_COLOR_NAMES[token]}
        </>
      )}
      {t.active === false && <>{token ? " · " : ""}לא מקבל זימונים חדשים</>}
    </span>
  );
}

/** The row's state: "פעיל" / "לא פעיל" and "פרופיל טכנאי חסר". */
function RowState({ a, narrow = false }: { a: UserAccount; narrow?: boolean }) {
  return (
    <>
      {narrow ? (
        <span style={{ display: "block", marginTop: 4 }}>
          <AccountStatePill active={a.active} />
        </span>
      ) : (
        <AccountStatePill active={a.active} />
      )}
      {a.technicianMissing && (
        <span className="pill acct-warn" style={narrow ? { display: "table", marginTop: 4 } : { display: "table", margin: "4px auto 0" }}>
          פרופיל טכנאי חסר
        </span>
      )}
    </>
  );
}

/** D72: phone layout at 600 px and below (cards); the table above. Before hydration: the table. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 600px)");
    const update = () => setNarrow(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function UserManagementScreen({ scope, self, rows, intents, actions, top }: UserManagementProps) {
  const commands = useMemo(() => accountCommandsOfActions(actions), [actions]);
  return (
    <AccountCommandsProvider commands={commands}>
      <UserManagementBody scope={scope} self={self} rows={rows} intents={intents} top={top} />
    </AccountCommandsProvider>
  );
}

function UserManagementBody({ scope, self, rows, intents, top }: Omit<UserManagementProps, "actions">) {
  const router = useRouter();
  const [reloading, startReload] = useTransition();
  const id = useId();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const [deleteRetry, setDeleteRetry] = useState<DeleteRetry | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserAccount["role"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "incomplete">("all");
  const narrow = useNarrow();
  const running = useRef(false);
  /** An element to focus once it exists (a row that a reload brings), with a fallback. */
  const focusWanted = useRef<{ id: string; fallback: string } | null>(null);
  /** The open edit dialog stored a part: read the page again when it closes. */
  const savedInDialog = useRef(false);
  const selfId = self.id;
  const accounts = rows.items;
  const roles = creatableRoles(scope, selfId);
  const commands = useAccountCommands();

  const addId = `${id}-add`;
  const retryId = `${id}-delete-retry`;
  const rowId = (accountId: string) => `${id}-row-${accountId}`;
  const intentRowId = (intentId: string) => `${id}-intent-${intentId}`;
  const openerId = (kind: string, key: string) => `${id}-${kind}-${key}`;

  // Focus: after each render, the wanted element once it exists and can take focus (a button waits
  // while the page reloads, e.g. "נסו שוב"); once the reload finished without it (a deleted or
  // cancelled row), the fallback.
  useEffect(() => {
    const wanted = focusWanted.current;
    if (!wanted) return;
    const el = document.getElementById(wanted.id);
    const waiting = el instanceof HTMLButtonElement && el.disabled;
    if (el && !waiting) {
      el.focus();
      focusWanted.current = null;
    } else if (!reloading) {
      (el ?? document.getElementById(wanted.fallback))?.focus();
      focusWanted.current = null;
    }
  });

  /** Reads the page again: the rows, their versions and the intents come from the database. */
  const reload = () => startReload(() => router.refresh());
  const wantFocus = (target: string) => (focusWanted.current = { id: target, fallback: addId });
  const blocked = busy !== null || reloading;

  /** Runs one inline action (activation, cancelling an intent); ignores taps while another runs. */
  async function act(key: string, run: () => Promise<{ ok: boolean; error?: string }>, okText: string, focusTarget: string) {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    setMessage(null);
    setDeleteRetry(null);
    try {
      const r = await run();
      if (r.ok) {
        setMessage({ kind: "ok", text: okText });
        wantFocus(focusTarget);
      } else {
        setMessage({ kind: "error", text: r.error ?? DIALOG_FAILED });
      }
    } catch {
      setMessage({ kind: "error", text: DIALOG_FAILED });
    } finally {
      running.current = false;
      setBusy(null);
      reload();
    }
  }

  /**
   * "נסו שוב" after a deletion whose ban failed (review S1): the same deletion again, with the version
   * the dialog sent; the server sees the account already deleted and repeats only the ban. The offer
   * stays while the ban is still incomplete; any other answer ends it.
   */
  async function retryDeletion() {
    const target = deleteRetry;
    if (!target || running.current) return;
    running.current = true;
    setBusy("delete-retry");
    setMessage(null);
    try {
      const r = await commands.deleteAccount({ accountId: target.accountId, expectedVersion: target.version, confirm: true });
      if (r.ok) {
        setDeleteRetry(null);
        setMessage({ kind: "ok", text: deletedLine(target.name) });
        wantFocus(addId);
      } else {
        const again = r.error === ACCOUNT_MESSAGES.revokeIncomplete;
        if (!again) setDeleteRetry(null);
        setMessage({ kind: "error", text: r.error });
        wantFocus(again ? retryId : addId);
      }
    } catch {
      setMessage({ kind: "error", text: DIALOG_FAILED });
      wantFocus(retryId);
    } finally {
      running.current = false;
      setBusy(null);
      reload();
    }
  }

  function open(next: Dialog) {
    setMessage(null);
    setDeleteRetry(null);
    savedInDialog.current = false;
    setDialog(next);
  }

  /** Closed without a change: focus returns to the opener. */
  function close() {
    if (dialog) wantFocus(dialog.opener);
    setDialog(null);
    if (savedInDialog.current) reload();
  }

  /** A dialog's action succeeded (or settled): the message, focus on `target`, and a reload. */
  function finish(kind: "ok" | "error", text: string, target: string) {
    setDialog(null);
    setMessage({ kind, text });
    wantFocus(target);
    reload();
  }

  /** D76: a row's actions as ⋮ menu items, in the owner's order; each offer mirrors the server's rule. */
  function rowItems(row: UserManagementRow): RowMenuItem[] {
    const a = row.account;
    const items: RowMenuItem[] = [];
    if (profileEditOffered(scope, a, selfId)) items.push({ key: "edit", label: "עריכה", name: `עריכה · הפרטים של ${a.name}` });
    if (technicianProfileCompletionOffered(scope, a, selfId)) {
      items.push({ key: "complete-tech", label: "השלמה", name: `השלמה · פרופיל הטכנאי של ${a.name}` });
    }
    if (credentialActionsOffered(scope, a, selfId)) {
      items.push({ key: "password", label: "סיסמה", name: `סיסמה · הגדרת סיסמה לחשבון של ${a.name}` });
      items.push({ key: "email", label: "מייל", name: `מייל · שינוי כתובת המייל של ${a.name}` });
    }
    if (roleChangeOffered(scope, a, selfId)) items.push({ key: "role", label: "תפקיד", name: `תפקיד · שינוי התפקיד של ${a.name}` });
    if (stateChangeOffered(scope, a, selfId)) {
      items.push(
        a.active
          ? { key: "deactivate", label: "השבתה", name: `השבתה · החשבון של ${a.name}` }
          : { key: "activate", label: "הפעלה", name: `הפעלה · החשבון של ${a.name}` },
      );
    }
    if (deleteOffered(scope, a, selfId)) items.push({ key: "delete", label: "מחיקה", name: `מחיקה · החשבון של ${a.name}`, danger: true });
    return items;
  }

  /** Runs a row's ⋮ choice (an event handler). */
  function selectRowAction(a: UserAccount, key: string, opener: string) {
    if (key === "activate") {
      void act(`activate-${a.id}`, () => commands.activateAccount(stateInput(a)), activatedLine(a.name), opener);
      return;
    }
    open({ kind: key as Exclude<Dialog["kind"], "add" | "complete-intent">, accountId: a.id, opener });
  }

  /** An open creation intent's ⋮ items: "השלמת יצירה" (the requester) and "ביטול". */
  function intentItems(entry: CreationIntentEntry): RowMenuItem[] {
    const intent = entry.intent;
    const items: RowMenuItem[] = [];
    if (intentCompletionOffered(scope, intent, selfId)) items.push({ key: "complete", label: "השלמת יצירה", name: `השלמת יצירה · ${intent.name}` });
    if (intentCancelOffered(scope, intent, selfId)) items.push({ key: "cancel", label: "ביטול", name: `ביטול · היצירה של ${intent.name}` });
    return items;
  }

  function selectIntentAction(entry: CreationIntentEntry, key: string, opener: string) {
    const intent = entry.intent;
    if (key === "complete") open({ kind: "complete-intent", intentId: intent.id, opener });
    else void act(`cancel-${intent.id}`, () => commands.cancelCreation(cancelCreationInput(intent)), intentCancelledLine(intent.name), addId);
  }

  function renderDialog(): ReactNode {
    if (!dialog) return null;
    if (dialog.kind === "add") {
      return (
        <AccountAddDialog
          roles={roles}
          creatorOptionShown={scope === "all"}
          onClose={close}
          onDone={({ name, role, account }) => finish("ok", createdLine(name, role, scope), account ? rowId(account.id) : addId)}
          onSettled={(text) => finish("error", text, addId)}
        />
      );
    }
    if (dialog.kind === "complete-intent") {
      const entry = intents.items.find((x) => x.intent.id === dialog.intentId);
      if (!entry) return null;
      return (
        <CompleteCreationForm
          source={{ kind: "intent", intent: entry.intent, label: entry.startedLabel }}
          onClose={close}
          onDone={(created) => finish("ok", intentCompletedLine(entry.intent.name), rowId(created.account.id))}
        />
      );
    }
    const row = accounts.find((x) => x.account.id === dialog.accountId);
    if (!row) return null;
    const a = row.account;
    const email = knownEmail(a.email);
    switch (dialog.kind) {
      case "edit":
        return (
          <AccountEditForm
            account={a}
            technician={row.technician}
            scope={scope}
            fields={technicianEditFields(scope, selfId)}
            onClose={close}
            onProfileSaved={() => void (savedInDialog.current = true)}
            onTechnicianSaved={() => void (savedInDialog.current = true)}
            onDone={(name) => finish("ok", editedLine(name), rowId(a.id))}
          />
        );
      case "password":
        return (
          <PasswordForm
            account={{ id: a.id, name: a.name, email }}
            onClose={close}
            onDone={() => finish("ok", passwordLine(a.name), rowId(a.id))}
          />
        );
      case "email":
        return (
          <EmailForm
            account={{ id: a.id, name: a.name, email, role: a.role, isTest: a.isTest }}
            onClose={close}
            onDone={() => finish("ok", emailLine(a.name), rowId(a.id))}
          />
        );
      case "complete-tech":
        return (
          <CompleteTechnicianForm
            account={{ id: a.id, name: a.name, email }}
            onClose={close}
            onDone={() => finish("ok", technicianCompletedLine(a.name), rowId(a.id))}
          />
        );
      case "role":
        return <AccountRoleDialog account={a} onClose={close} onDone={(role) => finish("ok", roleChangedLine(a.name, role), rowId(a.id))} />;
      case "deactivate":
        return (
          <AccountConfirmDialog
            title={`השבתת החשבון · ${a.name}`}
            lines={[
              "ההשבתה מיידית. משתמש לא פעיל לא יכול להיכנס לאפליקציה, וההיסטוריה שלו (ביקורים ופעולות) נשמרת.",
              `הפעולה נרשמת ביומן הביקורת${scope === "cs-tech" ? ", והיוצר מקבל התראה באפליקציה" : ""}. אפשר להפעיל את החשבון מחדש.`,
            ]}
            confirmLabel="השבתה"
            busyLabel="משבית…"
            run={() => commands.deactivateAccount(stateInput(a))}
            onClose={close}
            onDone={() => finish("ok", deactivatedLine(a.name, scope), rowId(a.id))}
          />
        );
      case "delete":
        return (
          <AccountConfirmDialog
            title={`מחיקת החשבון · ${a.name}`}
            lines={[
              "המחיקה סופית: החשבון לא יוכל להיכנס לאפליקציה לעולם, הוא יוסתר מהרשימות ולא ניתן יהיה להפעיל אותו מחדש.",
              "ההיסטוריה נשמרת: ביקורים, פעולות ושם המשתמש בהם לא נמחקים. הפעולה נרשמת ביומן הביקורת.",
            ]}
            acknowledge={`אני מאשר/ת את מחיקת החשבון של ${a.name}`}
            confirmLabel="מחיקה סופית"
            busyLabel="מוחק…"
            settled={DELETE_SETTLED}
            run={() => commands.deleteAccount({ accountId: a.id, expectedVersion: a.version, confirm: true })}
            onClose={close}
            onDone={() => finish("ok", deletedLine(a.name), addId)}
            onSettled={(text) => {
              // The profile is deleted, the ban is not: keep what the retry needs (the row is gone).
              if (text === ACCOUNT_MESSAGES.revokeIncomplete) setDeleteRetry({ accountId: a.id, version: a.version, name: a.name });
              finish("error", text, text === ACCOUNT_MESSAGES.revokeIncomplete ? retryId : addId);
            }}
          />
        );
    }
  }

  const title = USER_MANAGEMENT_TITLES[scope];
  const tableName = scope === "all" ? "כל המשתמשים" : "משתמשים: טכנאים ושירות לקוחות";
  const hasTest = accounts.some((r) => r.account.isTest) || intents.items.some((e) => e.intent.isTest);
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const matches = (name: string, email: string, phone: string) =>
    q === "" ||
    name.toLowerCase().includes(q) ||
    email.toLowerCase().includes(q) ||
    (qDigits !== "" && phone.replace(/\D/g, "").includes(qDigits));
  const shownIntents = intents.items.filter(
    (e) =>
      (roleFilter === "all" || e.intent.role === roleFilter) &&
      (statusFilter === "all" || statusFilter === "incomplete") &&
      matches(e.intent.name, e.intent.email, ""),
  );
  const shownRows = accounts.filter(
    (r) =>
      (roleFilter === "all" || r.account.role === roleFilter) &&
      (statusFilter === "all" || (statusFilter === "active" ? r.account.active : statusFilter === "inactive" ? !r.account.active : false)) &&
      matches(r.account.name, r.account.email, r.account.phone),
  );
  const filtered = q !== "" || roleFilter !== "all" || statusFilter !== "all";
  const empty = shownRows.length === 0 && shownIntents.length === 0;
  const roleOptions = [...new Set([...accounts.map((r) => r.account.role), ...intents.items.map((e) => e.intent.role)])];

  const intentState = (entry: CreationIntentEntry) => {
    const intent = entry.intent;
    // The Creator also sees other people's open intents (review S3): who started it.
    const byOther = intent.requestedBy.id !== selfId ? ` · על ידי ${intent.requestedBy.name || "משתמש אחר"}` : "";
    return (
      <>
        <span className="pill acct-warn">יצירה שלא הושלמה</span>
        <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
          התחילה {entry.startedLabel}
          {byOther}
        </span>
      </>
    );
  };

  return (
    <>
      {hasTest && <TestDataBanner />}
      {top}
      <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`} aria-busy={reloading || undefined}>
        <SettingsCardHead
          id={`${id}-title`}
          title={title}
          sub={USER_MANAGEMENT_SUBS[scope]}
          action={
            roles.length > 0 ? (
              <button
                type="button"
                id={addId}
                className="btn pri"
                aria-haspopup="dialog"
                disabled={busy !== null}
                onClick={() => open({ kind: "add", opener: addId })}
              >
                + הוסף משתמש
              </button>
            ) : undefined
          }
        />
        <div className="acct-filters" role="search" aria-label="חיפוש וסינון משתמשים">
          <input
            type="search"
            className="acct-search"
            placeholder="חיפוש לפי שם, טלפון או מייל"
            aria-label="חיפוש לפי שם, טלפון או מייל"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="סינון לפי תפקיד" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}>
            <option value="all">כל התפקידים</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ACCOUNT_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select aria-label="סינון לפי מצב" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">כל המצבים</option>
            <option value="active">פעיל</option>
            <option value="inactive">לא פעיל</option>
            {intents.items.length > 0 && <option value="incomplete">יצירה שלא הושלמה</option>}
          </select>
        </div>
        {empty ? (
          <div className="empty">{filtered ? "אין משתמשים שמתאימים לחיפוש" : "אין משתמשים להצגה"}</div>
        ) : narrow ? (
          // Phone (D72): one card per user; role and state on one line; the ⋮ menu (D76).
          <ul className="acct-cards" aria-label={tableName}>
            {shownIntents.map((entry) => {
              const intent = entry.intent;
              const opener = openerId("menu-intent", intent.id);
              return (
                <li key={`intent-${intent.id}`} data-account-row="" id={intentRowId(intent.id)} tabIndex={-1} className="acct-card">
                  <div className="acct-card-text">
                    <AccountName name={intent.name} isTest={intent.isTest} />
                    <span className="sub acct-ltr acct-wrap">{intent.email || "—"}</span>
                    <span className="acct-chips">
                      <RolePill role={intent.role} />
                    </span>
                    <span style={{ display: "block", marginTop: 6 }}>{intentState(entry)}</span>
                  </div>
                  <RowMenu id={opener} name={intent.name} items={intentItems(entry)} onSelect={(k) => selectIntentAction(entry, k, opener)} disabled={blocked} />
                </li>
              );
            })}
            {shownRows.map((row) => {
              const a = row.account;
              const opener = openerId("menu", a.id);
              return (
                <li key={a.id} data-account-row="" id={rowId(a.id)} tabIndex={-1} className="acct-card">
                  <div className="acct-card-text">
                    <AccountName name={a.name} isTest={a.isTest} note={a.id === selfId ? "החשבון שלך" : undefined} />
                    <TechnicianLine row={row} />
                    <span className="sub acct-ltr acct-wrap">{knownEmail(a.email) ?? "—"}</span>
                    {a.phone && <span className="sub acct-ltr">{a.phone}</span>}
                    <span className="acct-chips">
                      <RolePill role={a.role} />
                      <AccountStatePill active={a.active} />
                      {a.technicianMissing && <span className="pill acct-warn">פרופיל טכנאי חסר</span>}
                    </span>
                  </div>
                  <RowMenu id={opener} name={a.name} items={rowItems(row)} onSelect={(k) => selectRowAction(a, k, opener)} disabled={blocked} />
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="scrollx" style={{ position: "relative" }}>
            <table aria-label={tableName}>
              <thead>
                <tr>
                  <th scope="col">שם</th>
                  <th scope="col">מייל · טלפון</th>
                  <th scope="col" className={SHORT}>
                    תפקיד
                  </th>
                  <th scope="col" className={SHORT}>
                    מצב
                  </th>
                  <th scope="col" className="col-fit">
                    <span className="sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownIntents.map((entry) => {
                  const intent = entry.intent;
                  const opener = openerId("menu-intent", intent.id);
                  return (
                    <tr key={`intent-${intent.id}`} data-account-row="" id={intentRowId(intent.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={intent.name} isTest={intent.isTest} />
                      </td>
                      <td className="acct-ltr-cell">{intent.email || "—"}</td>
                      <td className={SHORT}>
                        <RolePill role={intent.role} />
                      </td>
                      <td className={SHORT}>{intentState(entry)}</td>
                      <td className="col-fit">
                        <RowMenu id={opener} name={intent.name} items={intentItems(entry)} onSelect={(k) => selectIntentAction(entry, k, opener)} disabled={blocked} />
                      </td>
                    </tr>
                  );
                })}
                {shownRows.map((row) => {
                  const a = row.account;
                  const opener = openerId("menu", a.id);
                  return (
                    <tr key={a.id} data-account-row="" id={rowId(a.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={a.name} isTest={a.isTest} note={a.id === selfId ? "החשבון שלך" : undefined} />
                        <TechnicianLine row={row} />
                      </td>
                      <td className="acct-ltr-cell">
                        {knownEmail(a.email) ?? "—"}
                        {a.phone && <span className="sub acct-ltr">{a.phone}</span>}
                      </td>
                      <td className={SHORT}>
                        <RolePill role={a.role} />
                      </td>
                      <td className={SHORT}>
                        <RowState a={a} />
                      </td>
                      <td className="col-fit">
                        <RowMenu id={opener} name={a.name} items={rowItems(row)} onSelect={(k) => selectRowAction(a, k, opener)} disabled={blocked} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SettingsMore shown={accounts.length} total={rows.total} />
        <ActionMessage message={message} style={{ padding: message ? `10px 18px ${deleteRetry ? 6 : 12}px` : 0 }} />
        {deleteRetry && (
          <div style={{ padding: message ? "0 18px 12px" : "10px 18px 12px" }}>
            <button
              type="button"
              id={retryId}
              className="chip"
              style={ROW_BTN}
              disabled={blocked}
              aria-label={`נסו שוב · השלמת המחיקה של ${deleteRetry.name}`}
              onClick={() => void retryDeletion()}
            >
              {busy === "delete-retry" ? "מנסה שוב…" : "נסו שוב"}
            </button>
          </div>
        )}
      </section>

      {renderDialog()}

      <div className="note">
        {scope === "all"
          ? "רק היוצר מנהל חשבונות מנהל ויוצר, משנה תפקידים, קובע סיסמאות ומשנה מייל לכניסה, ומוחק משתמשים (לאחר אישור מפורש). אין הרשמה עצמית: משתמשים נוצרים רק כאן. משתמש לא פעיל לא יכול להיכנס, וההיסטוריה שלו נשמרת."
          : "המנהל מוסיף טכנאים ונציגי שירות לקוחות, עורך את פרטיהם ומפעיל או משבית אותם, מיד וללא אישור. המנהל לא משנה תפקיד, לא קובע סיסמאות, לא משנה מייל לכניסה ולא מוחק משתמשים. משתמש לא פעיל לא יכול להיכנס, וההיסטוריה שלו נשמרת."}
      </div>
    </>
  );
}
