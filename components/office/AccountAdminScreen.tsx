"use client";

// Account administration (SE-01, D34; demo setUsers() L942-944 as changed by SE-01): the accounts
// table with role pills and the 🧪 badge of test users (SIM-18), the "+" forms, and the account
// requests. Two scopes (display only, G-04; the server checks every action in the database, D34):
// - "all": the Creator (Settings › "משתמשים והרשאות"): every account; "+ הוספת משתמש"
//   (immediate; technicians are added on Settings › "טכנאים"); deactivate and activate any account
//   but the Creator's own; "בקשות לאישור" with approve / reject (AccountAdminRequests, "decide").
// - "cs-tech": the Manager (Settings › "משתמשים", D57 (1)): Customer Service and Technician accounts only.
//   "+ בקשת חשבון שירות לקוחות" makes a pending request that waits for the Creator (D34 a);
//   "+ הוספת טכנאי" and a technician's activation are immediate (D34 c); deactivation of a Customer
//   Service or Technician account is immediate, audited, and the Creator is notified in the app
//   (D34 b); activating a Customer Service account is a request. "הבקשות שלי" lists the Manager's
//   own requests, with "ביטול הבקשה" while pending. No password or email editing (D34 e).
// Row actions (Step 2 PR 2.3; display rules in features/accounts/data/offers.ts, each mirroring the
// command's caller check; deny by default without a scope or a signed-in account): "עריכה"
// ("עריכת פרטים", AccountEditForm), the Creator's "סיסמה" and "מייל" (AccountCredentialForms; never
// on his own row, TEMPORARY Q22), "השלמה" of "פרופיל טכנאי חסר" (AccountCompletionForms), then the
// state control. The viewer's own open creation intents ("יצירה שלא הושלמה") head the table with
// "השלמת יצירה" and "ביטול"; they are not counted among the accounts. Each dialog is the demo's
// drawer (AccountDialog); closing it returns focus to its opener, a success moves it to the row.
// Each (de)activation and decision sends the version read (`expectedVersion`); a stale one is
// refused with the "data changed" message (PT409). After a STORED action the row keeps the version
// the command returned (versionAfter), so the next action on it is not refused as stale. A stored
// approval of an activation or role change also changes the account, whose new version the
// decision does not return: the real adapter's screen reads the account again (router.refresh,
// Step 2 PR 2.5+) before offering another action on that row.
// Every action runs one command from useCommands().accounts, and the screen reads the result: a
// SIMULATED result (the UI demo) shows the change on its row, marked "לא נשמר · פעולה מדומה", with
// no further action (nothing was stored, so a second action would act on stale data), and says
// "בהדגמה … לא נשמר"; a stored result says what was done (TE-23: never claim a save that did not
// happen). Created rows come from the command (ids and test markers as stored, D47). After an
// action the changed row takes focus (its button is gone).
// - An inactive account with a pending request: the Creator decides it in "בקשות לאישור" (no direct
//   activation beside a pending request); approving an activation or a role change updates the row.
// - At narrow widths (≤ 520 px) the email, the role pill and the state move under the name
//   (styles/ui.css .set-col-wide / .set-inline-narrow), so every row action stays in view without
//   scrolling sideways (review UI-3: the actions cell holds up to five buttons since PR 2.3).
// - Each row button's accessible name starts with its visible word (WCAG 2.5.3, label in name).
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  credentialActionsOffered,
  intentCompletionOffered,
  profileEditOffered,
  technicianEditFields,
  technicianProfileCompletionOffered,
} from "@/features/accounts/data/offers";
import {
  ACCOUNT_REQUEST_KIND_LABELS,
  activationKind,
  type AccountRequestKind,
  type CompletedCreation,
  type UserAccount,
} from "@/features/accounts/data/types";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";
import { AccountForm, type AccountFormKind, type AccountFormResult } from "./AccountAdminForms";
import {
  AccountName,
  AccountStatePill,
  ActionMessage,
  RequestStatusPill,
  RolePill,
  said,
  type AccountAdminData,
  type AccountRequestEntry,
  type AccountTechnicianDetails,
  type ActionMessageValue,
  type CreationIntentEntry,
} from "./AccountAdminParts";
import { AccountAdminRequests } from "./AccountAdminRequests";
import { accountAfterStateChange, intentCancelInput, stateInput } from "./AccountAdminRules";
import { CompleteCreationForm, CompleteTechnicianForm } from "./AccountCompletionForms";
import { EmailForm, PasswordForm } from "./AccountCredentialForms";
import { AccountEditForm } from "./AccountEditForm";
import { SettingsCardHead, SettingsMore, SettingsNotSaved } from "./SettingsShell";

const SHORT = "col-center col-fit";
const FAILED = "הפעולה לא בוצעה. נסה שוב.";
/** Row action buttons: the demo's small table chip (setReasons() "מחיקה", L963), 24px tall at least. */
const ROW_BTN = { padding: "4px 12px", fontSize: 12 } as const;

const OPENERS: Readonly<Record<AccountAdminData["scope"], readonly { kind: AccountFormKind; label: string; primary: boolean }[]>> = {
  all: [{ kind: "account", label: "+ הוספת משתמש", primary: true }],
  "cs-tech": [
    { kind: "cs-request", label: "+ בקשת חשבון שירות לקוחות", primary: true },
    { kind: "tech", label: "+ הוספת טכנאי", primary: false },
  ],
};

/** The row dialogs; each names its row and the button that opened it (focus returns there). */
type RowDialog =
  | { kind: "edit" | "password" | "email" | "complete-tech"; accountId: string; opener: string }
  | { kind: "complete-intent"; intentId: string; opener: string };

/** One "יצירה שלא הושלמה" row; `cancelled`: cancelled by a SIMULATED command (shown, not saved). */
type IntentRow = { entry: CreationIntentEntry; cancelled?: boolean };

/** The technician details a created technician record gives the screen (the viewer's view, Q14). */
function technicianDetailsOf(t: TechnicianSetting, withCreatorFields: boolean): AccountTechnicianDetails {
  const base: AccountTechnicianDetails = { id: t.id, name: t.name, color: t.color, device: t.device, version: t.version, isTest: t.isTest };
  return withCreatorFields ? { ...base, outlookEmail: t.email, active: t.active } : base;
}

/**
 * An account row's state: "פעיל" / "לא פעיל", "פרופיל טכנאי חסר" and "בקשה ממתינה". `narrow`: the
 * copy under the name at ≤ 520 px (the "מצב" column is hidden there, .set-col-wide), start-aligned;
 * otherwise centred in its column.
 */
function AccountState({ active, technicianMissing, pending, narrow = false }: { active: boolean; technicianMissing: boolean; pending: boolean; narrow?: boolean }) {
  const line = { display: "block", marginTop: narrow ? 4 : 3 } as const;
  return (
    <>
      {narrow ? (
        <span style={line}>
          <AccountStatePill active={active} />
        </span>
      ) : (
        <AccountStatePill active={active} />
      )}
      {technicianMissing && (
        <span className="pill acct-warn" style={narrow ? { display: "table", marginTop: 4 } : { display: "table", margin: "4px auto 0" }}>
          פרופיל טכנאי חסר
        </span>
      )}
      {pending && (
        <span className="sub" style={{ ...line, fontSize: 12, marginTop: 3 }}>
          בקשה ממתינה
        </span>
      )}
    </>
  );
}

/** A "יצירה שלא הושלמה" row's state, or "בוטלה" once cancelled; `narrow` as AccountState. */
function IntentState({ cancelled, startedLabel, narrow = false }: { cancelled: boolean; startedLabel: string; narrow?: boolean }) {
  const pill = cancelled ? <RequestStatusPill status="cancelled" /> : <span className="pill acct-warn">יצירה שלא הושלמה</span>;
  return (
    <>
      {narrow ? <span style={{ display: "block", marginTop: 4 }}>{pill}</span> : pill}
      {!cancelled && (
        <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
          התחילה {startedLabel}
        </span>
      )}
    </>
  );
}

export function AccountAdminScreen({ scope, accounts, requests, intents, technicians, self }: AccountAdminData) {
  const { accounts: commands } = useCommands();
  const id = useId();
  const [rows, setRows] = useState<UserAccount[]>(accounts.items);
  const [reqs, setReqs] = useState<AccountRequestEntry[]>(requests.items);
  /** Rows added or changed in the demo (simulated, not stored). */
  const [changed, setChanged] = useState<ReadonlySet<string>>(() => new Set());
  const [openForm, setOpenForm] = useState<AccountFormKind | null>(null);
  const [confirm, setConfirm] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const running = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [intentRows, setIntentRows] = useState<IntentRow[]>(() => intents.items.map((entry) => ({ entry })));
  /** The listed technicians' details, as this screen last saved them (the version to send next). */
  const [techs, setTechs] = useState<Readonly<Record<TechnicianId, AccountTechnicianDetails>>>(technicians);
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  /**
   * The element to focus after a render: the row whose action just finished (its button is gone),
   * or the button that opened a dialog that closed. A new object each time, so it always runs.
   */
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const selfId = self?.id ?? null;

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  const focus = (elementId: string) => document.getElementById(elementId)?.focus();
  const openerId = (kind: AccountFormKind) => `${id}-open-${kind}`;
  const deactivateId = (accountId: string) => `${id}-deact-${accountId}`;
  const rowId = (accountId: string) => `${id}-row-${accountId}`;
  const intentRowId = (intentId: string) => `${id}-intent-${intentId}`;
  const dialogOpenerId = (kind: RowDialog["kind"], key: string) => `${id}-${kind}-${key}`;
  const setFocusRow = (accountId: string) => setFocusTarget({ id: rowId(accountId) });

  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const added = rows.length - accounts.items.length;
  const addedRequests = reqs.length - requests.items.length;
  const pendingFor = (accountId: string) =>
    reqs.find((e) => e.request.status === "pending" && e.request.account?.id === accountId) ?? null;

  /** A simulated change: shown on its row as not saved, with no further action. */
  function markChanged(accountId: string, simulated: boolean) {
    if (simulated) setChanged((prev) => new Set(prev).add(accountId));
  }

  /** Runs one command; ignores taps while another action runs. */
  async function act<T>(key: string, run: () => Promise<CommandResult<T>>, onOk: (r: Extract<CommandResult<T>, { ok: true }>) => void) {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    setMessage(null);
    try {
      const r = await run();
      if (r.ok) onOk(r);
      else setMessage({ kind: "error", text: r.error });
    } catch {
      setMessage({ kind: "error", text: FAILED });
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function onFormDone(result: AccountFormResult) {
    setOpenForm(null);
    if (result.kind === "cs-request") {
      const r = result.request;
      setReqs((prev) => [{ request: r, requestedLabel: "עכשיו", decidedLabel: null, local: result.simulated }, ...prev]);
      setMessage({
        kind: "ok",
        text: said(
          result.simulated,
          `הבקשה לחשבון של ${r.target.name} הייתה נשלחת ליוצר, וממתינה לאישור היוצר. עד האישור לא נוצר חשבון.`,
          `הבקשה לחשבון של ${r.target.name} נשלחה ליוצר וממתינה לאישורו. עד האישור לא נוצר חשבון.`,
        ),
      });
    } else {
      const a = result.account;
      setRows((prev) => [a, ...prev]);
      markChanged(a.id, result.simulated);
      setMessage({
        kind: "ok",
        text:
          result.kind === "tech"
            ? said(result.simulated, `הטכנאי ${a.name} היה נוסף מיד.`, `הטכנאי ${a.name} נוסף.`)
            : said(result.simulated, `החשבון של ${a.name} היה נוצר מיד.`, `החשבון של ${a.name} נוצר.`),
      });
    }
    focus(openerId(result.kind));
  }

  function deactivate(a: UserAccount) {
    void act(
      `deactivate-${a.id}`,
      () => commands.deactivateAccount(stateInput(a)),
      (r) => {
        setRows((prev) => prev.map((x) => (x.id === a.id ? accountAfterStateChange(x, r, false) : x)));
        markChanged(a.id, r.simulated);
        setConfirm(null);
        setFocusRow(a.id);
        const notify = scope === "cs-tech";
        setMessage({
          kind: "ok",
          text: said(
            r.simulated,
            `החשבון של ${a.name} היה מושבת מיד ונרשם ביומן הביקורת${notify ? ", והיוצר היה מקבל התראה באפליקציה" : ""}.`,
            `החשבון של ${a.name} הושבת ונרשם ביומן הביקורת${notify ? ", והיוצר קיבל התראה באפליקציה" : ""}.`,
          ),
        });
      },
    );
  }

  function activate(a: UserAccount) {
    void act(
      `activate-${a.id}`,
      () => commands.activateAccount(stateInput(a)),
      (r) => {
        setRows((prev) => prev.map((x) => (x.id === a.id ? accountAfterStateChange(x, r, true) : x)));
        markChanged(a.id, r.simulated);
        setFocusRow(a.id);
        setMessage({ kind: "ok", text: said(r.simulated, `החשבון של ${a.name} היה מופעל מיד.`, `החשבון של ${a.name} הופעל.`) });
      },
    );
  }

  /** A Manager's activation of a Customer Service account: a request for the Creator (D34 a). */
  function requestActivation(a: UserAccount) {
    const kind: AccountRequestKind = activationKind(a);
    void act(
      `request-${a.id}`,
      () => commands.requestAccount({ kind, accountId: a.id }),
      (r) => {
        if (r.data) {
          const request = r.data.request;
          setReqs((prev) => [{ request, requestedLabel: "עכשיו", decidedLabel: null, local: r.simulated }, ...prev]);
        }
        setFocusRow(a.id);
        const label = ACCOUNT_REQUEST_KIND_LABELS[kind];
        setMessage({
          kind: "ok",
          text: said(
            r.simulated,
            `בקשת ${label} של ${a.name} הייתה נשלחת ליוצר. החשבון נשאר לא פעיל עד האישור.`,
            `בקשת ${label} של ${a.name} נשלחה ליוצר. החשבון נשאר לא פעיל עד האישור.`,
          ),
        });
      },
    );
  }

  /** A request changed in "בקשות לאישור" / "הבקשות שלי": an approved activation or role change updates its account row. */
  function onRequestUpdate(entry: AccountRequestEntry) {
    setReqs((prev) => prev.map((e) => (e.request.id === entry.request.id ? entry : e)));
    const r = entry.request;
    const accountId = r.account?.id;
    if (r.status !== "approved" || !accountId) return;
    if (r.kind === "activate" || r.kind === "reactivate") {
      setRows((prev) => prev.map((x) => (x.id === accountId ? { ...x, active: true, deactivatedAt: null } : x)));
    } else if (r.kind === "role-change" && r.newRole) {
      const role = r.newRole;
      setRows((prev) => prev.map((x) => (x.id === accountId ? { ...x, role } : x)));
    } else {
      return;
    }
    markChanged(accountId, entry.local === true);
  }

  /** Opens a row dialog; the button that opened it gets focus back when it closes. */
  function openDialog(next: RowDialog) {
    setMessage(null);
    setConfirm(null);
    setDialog(next);
  }

  /** Closes the open dialog without a change: focus returns to its opener. */
  function closeDialog() {
    if (dialog) setFocusTarget({ id: dialog.opener });
    setDialog(null);
  }

  /** A dialog's command succeeded: the dialog closes and its row takes focus. */
  function dialogDone(focusId: string, text: string) {
    setDialog(null);
    setFocusTarget({ id: focusId });
    setMessage({ kind: "ok", text });
  }

  const replaceRow = (next: UserAccount) => setRows((prev) => prev.map((x) => (x.id === next.id ? next : x)));

  /** "השלמת יצירה" succeeded: the created account (and technician) join the table. */
  function addCreated(created: CompletedCreation, simulated: boolean) {
    const a = created.account;
    setRows((prev) => [a, ...prev]);
    markChanged(a.id, simulated);
    const t = created.technician;
    if (t) setTechs((prev) => ({ ...prev, [t.id]: technicianDetailsOf(t, scope === "all") }));
  }

  /** "ביטול" of the viewer's own creation intent (cancelRequestError: the requester cancels his own). */
  function cancelIntent(entry: CreationIntentEntry) {
    const intent = entry.intent;
    void act(
      `cancel-intent-${intent.id}`,
      () => commands.cancelAccountRequest(intentCancelInput(intent)),
      (r) => {
        // Simulated: the row stays, marked "בוטלה" and not saved; stored: it is gone.
        setIntentRows((prev) =>
          r.simulated ? prev.map((x) => (x.entry.intent.id === intent.id ? { ...x, cancelled: true } : x)) : prev.filter((x) => x.entry.intent.id !== intent.id),
        );
        // Stored: the row is gone, so focus moves to the card's first "+" button.
        setFocusTarget({ id: r.simulated ? intentRowId(intent.id) : openerId(OPENERS[scope][0]?.kind ?? "account") });
        setMessage({ kind: "ok", text: said(r.simulated, `היצירה של ${intent.name} הייתה מבוטלת.`, `היצירה של ${intent.name} בוטלה.`) });
      },
    );
  }

  /** A small row button that opens a dialog. */
  function rowDialogButton(kind: Exclude<RowDialog["kind"], "complete-intent">, a: UserAccount, label: string, name: string) {
    const opener = dialogOpenerId(kind, a.id);
    return (
      <button
        key={kind}
        type="button"
        id={opener}
        className="chip"
        style={ROW_BTN}
        disabled={busy !== null}
        aria-label={name}
        onClick={() => openDialog({ kind, accountId: a.id, opener })}
      >
        {label}
      </button>
    );
  }

  /**
   * A row's actions, in order: "עריכה", "סיסמה", "מייל", "השלמה", then the state control. Each by its
   * display rule (offers.ts); a row changed by a simulated command offers none.
   */
  function rowActions(a: UserAccount): ReactNode {
    if (changed.has(a.id)) return <SettingsNotSaved />;
    const items: ReactNode[] = [];
    if (profileEditOffered(scope, a, selfId)) items.push(rowDialogButton("edit", a, "עריכה", `עריכה · הפרטים של ${a.name}`));
    if (credentialActionsOffered(scope, a, selfId)) {
      items.push(rowDialogButton("password", a, "סיסמה", `סיסמה · הגדרת סיסמה לחשבון של ${a.name}`));
      items.push(rowDialogButton("email", a, "מייל", `מייל · שינוי כתובת המייל של ${a.name}`));
    }
    if (technicianProfileCompletionOffered(scope, a, selfId)) {
      items.push(rowDialogButton("complete-tech", a, "השלמה", `השלמה · פרופיל הטכנאי של ${a.name}`));
    }
    const state = stateAction(a);
    if (state) items.push(<Fragment key="state">{state}</Fragment>);
    return items.length > 0 ? <div className="acct-actions">{items}</div> : null;
  }

  /** The (de)activation control of a row (unchanged rules, D34). */
  function stateAction(a: UserAccount): ReactNode {
    if (self && a.id === self.id) return null;
    if (scope === "cs-tech" && a.role !== "cs" && a.role !== "tech") return null;
    const pending = pendingFor(a.id);
    if (a.active) {
      return (
        <button
          type="button"
          id={deactivateId(a.id)}
          className="chip"
          style={{ ...ROW_BTN, color: "var(--danger)" }}
          disabled={busy !== null}
          aria-label={`השבתה · החשבון של ${a.name}`}
          onClick={() => {
            setMessage(null);
            setConfirm(a);
          }}
        >
          השבתה
        </button>
      );
    }
    // The Creator decides a pending request in "בקשות לאישור" (a direct activation would leave it pending).
    if (scope === "all" && pending) {
      return (
        <span className="sub" style={{ fontSize: 12 }}>
          להחלטה בבקשות
        </span>
      );
    }
    if (scope === "all" || a.role === "tech") {
      return (
        <button
          type="button"
          className="chip"
          style={ROW_BTN}
          disabled={busy !== null}
          aria-label={`הפעלה · החשבון של ${a.name}`}
          onClick={() => activate(a)}
        >
          {busy === `activate-${a.id}` ? "מפעיל…" : "הפעלה"}
        </button>
      );
    }
    if (pending) return <RequestStatusPill status="pending" />;
    const kind: AccountRequestKind = activationKind(a);
    return (
      <button
        type="button"
        className="chip"
        style={ROW_BTN}
        disabled={busy !== null}
        aria-label={`בקשת ${ACCOUNT_REQUEST_KIND_LABELS[kind]} לחשבון של ${a.name}`}
        onClick={() => requestActivation(a)}
      >
        {busy === `request-${a.id}` ? "שולח…" : `בקשת ${ACCOUNT_REQUEST_KIND_LABELS[kind]}`}
      </button>
    );
  }

  /** The open row dialog, read from the current rows (null when none is open). */
  function renderDialog(): ReactNode {
    if (!dialog) return null;
    if (dialog.kind === "complete-intent") {
      const row = intentRows.find((x) => x.entry.intent.id === dialog.intentId);
      if (!row) return null;
      const intent = row.entry.intent;
      return (
        <CompleteCreationForm
          source={{ kind: "intent", intent, label: row.entry.startedLabel }}
          onClose={closeDialog}
          onDone={(created, simulated) => {
            // The intent row becomes the created account's row.
            setIntentRows((prev) => prev.filter((x) => x.entry.intent.id !== intent.id));
            addCreated(created, simulated);
            dialogDone(rowId(created.account.id), said(simulated, `החשבון של ${intent.name} היה נוצר מיד.`, `החשבון של ${intent.name} נוצר.`));
          }}
        />
      );
    }
    const a = rows.find((x) => x.id === dialog.accountId);
    if (!a) return null;
    switch (dialog.kind) {
      case "password":
        return (
          <PasswordForm
            account={{ id: a.id, name: a.name, email: a.email }}
            onClose={closeDialog}
            onDone={(simulated) => {
              markChanged(a.id, simulated);
              dialogDone(rowId(a.id), said(simulated, `הסיסמה של ${a.name} הייתה נקבעת.`, `הסיסמה של ${a.name} נקבעה. היא לא תוצג שוב.`));
            }}
          />
        );
      case "email":
        return (
          <EmailForm
            account={{ id: a.id, name: a.name, email: a.email, role: a.role, isTest: a.isTest }}
            onClose={closeDialog}
            onDone={(email, simulated) => {
              replaceRow({ ...a, email });
              markChanged(a.id, simulated);
              dialogDone(
                rowId(a.id),
                said(simulated, `כתובת המייל של ${a.name} הייתה משתנה ל-${email}.`, `כתובת המייל של ${a.name} שונתה ל-${email}.`),
              );
            }}
          />
        );
      case "edit": {
        const technician = a.technicianId !== null ? (techs[a.technicianId] ?? null) : null;
        return (
          <AccountEditForm
            account={a}
            technician={technician}
            scope={scope}
            fields={technicianEditFields(scope, selfId)}
            onClose={closeDialog}
            onProfileSaved={(next, simulated) => {
              replaceRow(next);
              markChanged(next.id, simulated);
            }}
            onTechnicianSaved={(next, simulated) => {
              setTechs((prev) => ({ ...prev, [next.id]: next }));
              markChanged(a.id, simulated);
            }}
            onDone={(name, simulated) =>
              dialogDone(
                rowId(a.id),
                said(simulated, `הפרטים של ${name} היו מתעדכנים מיד ונרשמים ביומן הביקורת.`, `הפרטים של ${name} עודכנו ונרשמו ביומן הביקורת.`),
              )
            }
          />
        );
      }
      case "complete-tech":
        return (
          <CompleteTechnicianForm
            account={{ id: a.id, name: a.name, email: a.email }}
            onClose={closeDialog}
            onDone={(created, simulated) => {
              const t = created.technician;
              replaceRow({ ...a, technicianId: t.id, technicianMissing: false });
              setTechs((prev) => ({ ...prev, [t.id]: technicianDetailsOf(t, scope === "all") }));
              markChanged(a.id, simulated);
              dialogDone(rowId(a.id), said(simulated, `פרופיל הטכנאי של ${a.name} היה נוצר מיד.`, `פרופיל הטכנאי של ${a.name} נוצר.`));
            }}
          />
        );
    }
  }

  const title = scope === "all" ? "משתמשים" : "חשבונות שירות לקוחות וטכנאים";
  const formId = `${id}-form`;

  return (
    <>
      <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
        <SettingsCardHead
          id={`${id}-title`}
          title={title}
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {OPENERS[scope].map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  id={openerId(o.kind)}
                  className={o.primary ? "btn pri" : "btn"}
                  aria-expanded={openForm === o.kind}
                  aria-controls={openForm === o.kind ? formId : undefined}
                  onClick={() => {
                    setMessage(null);
                    setOpenForm((cur) => (cur === o.kind ? null : o.kind));
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          }
        />
        {openForm && (
          <AccountForm
            key={openForm}
            formId={formId}
            kind={openForm}
            onDone={onFormDone}
            onCancel={() => {
              const kind = openForm;
              setOpenForm(null);
              focus(openerId(kind));
            }}
          />
        )}
        {rows.length === 0 && intentRows.length === 0 ? (
          <div className="empty">אין חשבונות</div>
        ) : (
          // position: relative keeps the 🧪 badge's screen-reader text inside the sideways scroller.
          <div className="scrollx" style={{ position: "relative" }}>
            <table aria-label={title}>
              <thead>
                <tr>
                  <th scope="col">שם</th>
                  <th scope="col" className="set-col-wide">
                    מייל
                  </th>
                  <th scope="col" className={`${SHORT} set-col-wide`}>
                    הרשאה
                  </th>
                  <th scope="col" className={`${SHORT} set-col-wide`}>
                    מצב
                  </th>
                  <th scope="col" className="col-fit">
                    פעולות
                  </th>
                </tr>
              </thead>
              <tbody>
                {intentRows.map(({ entry, cancelled }) => {
                  const intent = entry.intent;
                  const offered = !cancelled && intentCompletionOffered(scope, intent, selfId);
                  return (
                    <tr key={`intent-${intent.id}`} id={intentRowId(intent.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={intent.name} isTest={intent.isTest} />
                        <span className="set-inline-narrow">
                          <span className="sub" dir="ltr" style={{ display: "block", textAlign: "right", fontSize: 12, overflowWrap: "anywhere" }}>
                            {intent.email}
                          </span>
                          <span style={{ display: "block", marginTop: 4 }}>
                            <RolePill role={intent.role} />
                          </span>
                          <IntentState cancelled={cancelled === true} startedLabel={entry.startedLabel} narrow />
                        </span>
                      </td>
                      <td className="set-col-wide" dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>
                        {intent.email}
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RolePill role={intent.role} />
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <IntentState cancelled={cancelled === true} startedLabel={entry.startedLabel} />
                      </td>
                      <td className="col-fit">
                        {cancelled ? (
                          <SettingsNotSaved />
                        ) : (
                          offered && (
                            <div className="acct-actions">
                              <button
                                type="button"
                                id={dialogOpenerId("complete-intent", intent.id)}
                                className="btn pri"
                                style={ROW_BTN}
                                disabled={busy !== null}
                                aria-label={`השלמת יצירה · ${intent.name}`}
                                onClick={() =>
                                  openDialog({ kind: "complete-intent", intentId: intent.id, opener: dialogOpenerId("complete-intent", intent.id) })
                                }
                              >
                                השלמת יצירה
                              </button>
                              <button
                                type="button"
                                className="chip"
                                style={ROW_BTN}
                                disabled={busy !== null}
                                aria-label={`ביטול · היצירה של ${intent.name}`}
                                onClick={() => cancelIntent(entry)}
                              >
                                {busy === `cancel-intent-${intent.id}` ? "מבטל…" : "ביטול"}
                              </button>
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.map((a) => {
                  const pending = scope === "all" ? pendingFor(a.id) : null;
                  return (
                    <tr key={a.id} id={rowId(a.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={a.name} isTest={a.isTest} note={self && a.id === self.id ? "החשבון שלך" : undefined} />
                        {/* Narrow widths: email and role under the name (their columns are hidden). */}
                        <span className="set-inline-narrow">
                          <span className="sub" dir="ltr" style={{ display: "block", textAlign: "right", fontSize: 12, overflowWrap: "anywhere" }}>
                            {a.email}
                          </span>
                          <span style={{ display: "block", marginTop: 4 }}>
                            <RolePill role={a.role} />
                          </span>
                          <AccountState active={a.active} technicianMissing={a.technicianMissing} pending={pending !== null} narrow />
                        </span>
                      </td>
                      <td className="set-col-wide" dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>
                        {a.email}
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RolePill role={a.role} />
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <AccountState active={a.active} technicianMissing={a.technicianMissing} pending={pending !== null} />
                      </td>
                      <td className="col-fit">{rowActions(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SettingsMore shown={rows.length} total={accounts.total + added} />
        {confirm && (
          <div
            role="group"
            aria-labelledby={`${id}-confirm-title`}
            aria-describedby={`${id}-confirm-text`}
            style={{
              borderTop: "1px solid var(--line)",
              padding: "12px 18px",
              background: "var(--danger-bg)",
              color: "var(--danger-fg)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <b id={`${id}-confirm-title`}>להשבית את החשבון של {confirm.name}?</b>
            <p id={`${id}-confirm-text`} style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              ההשבתה מיידית ולא צריכה אישור: החשבון לא יוכל להיכנס לאפליקציה, וההיסטוריה שלו נשמרת. הפעולה נרשמת ביומן הביקורת
              {scope === "cs-tech" ? ", והיוצר מקבל התראה באפליקציה." : "."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button ref={confirmRef} type="button" className="btn dng" disabled={busy !== null} onClick={() => deactivate(confirm)}>
                {busy === `deactivate-${confirm.id}` ? "משבית…" : "השבתה"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => {
                  const accountId = confirm.id;
                  setConfirm(null);
                  focus(deactivateId(accountId));
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}
        <ActionMessage message={message} style={{ padding: message ? "10px 18px 12px" : 0 }} />
      </section>

      <AccountAdminRequests
        mode={scope === "all" ? "decide" : "own"}
        scope={scope}
        entries={reqs}
        total={requests.total + addedRequests}
        self={self}
        onUpdate={onRequestUpdate}
        onComplete={addCreated}
      />

      {renderDialog()}

      <div className="note">
        {scope === "all"
          ? "רק היוצר מנהל חשבונות מנהל ויוצר ומחליט על הבקשות של המנהל. אין הרשמה עצמית: חשבונות נוצרים רק כאן. חשבונות מושבתים ולא נמחקים."
          : "ניהול החשבונות הוא יכולת קבועה של המנהל ואינו תלוי במטריצת ההרשאות. המנהל מנהל חשבונות שירות לקוחות וטכנאים בלבד; חשבונות מנהל ויוצר מנוהלים על ידי היוצר. המנהל לא קובע ולא מאפס סיסמאות, ולא משנה מייל של חשבון."}
      </div>
    </>
  );
}
