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
// - "יצירה שלא הושלמה" rows (the viewer's own creation intents) with "השלמת יצירה" and "ביטול".
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
  intentCompletionOffered,
  profileEditOffered,
  roleChangeOffered,
  stateChangeOffered,
  technicianEditFields,
  technicianProfileCompletionOffered,
  type AccountAdminScope,
} from "@/features/accounts/data/offers";
import type { AccountRef, UserAccount } from "@/features/accounts/data/types";
import { ACCOUNT_MESSAGES } from "@/features/data-access/supabase-errors";
import type { Bounded } from "@/features/data-access/common";
import { TECHNICIAN_COLOR_NAMES, technicianColorTokenOf } from "@/features/reference/data/types";
import { TEST_DATA_LABEL } from "@/components/ui/TestBadge";
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

export function UserManagementScreen({ scope, self, rows, intents, actions }: UserManagementProps) {
  const commands = useMemo(() => accountCommandsOfActions(actions), [actions]);
  return (
    <AccountCommandsProvider commands={commands}>
      <UserManagementBody scope={scope} self={self} rows={rows} intents={intents} />
    </AccountCommandsProvider>
  );
}

function UserManagementBody({ scope, self, rows, intents }: Omit<UserManagementProps, "actions">) {
  const router = useRouter();
  const [reloading, startReload] = useTransition();
  const id = useId();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessageValue>(null);
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
  const rowId = (accountId: string) => `${id}-row-${accountId}`;
  const intentRowId = (intentId: string) => `${id}-intent-${intentId}`;
  const openerId = (kind: string, key: string) => `${id}-${kind}-${key}`;

  // Focus: after each render, the wanted element if it exists; once the reload finished without it
  // (a deleted or cancelled row), the fallback.
  useEffect(() => {
    const wanted = focusWanted.current;
    if (!wanted) return;
    const el = document.getElementById(wanted.id);
    if (el) {
      el.focus();
      focusWanted.current = null;
    } else if (!reloading) {
      document.getElementById(wanted.fallback)?.focus();
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

  function open(next: Dialog) {
    setMessage(null);
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

  function rowButton(kind: Exclude<Dialog["kind"], "add" | "complete-intent">, a: UserAccount, label: string, name: string, danger = false) {
    const opener = openerId(kind, a.id);
    return (
      <button
        key={kind}
        type="button"
        id={opener}
        className="chip"
        style={danger ? { ...ROW_BTN, color: "var(--danger)" } : ROW_BTN}
        disabled={blocked}
        aria-label={name}
        onClick={() => open({ kind, accountId: a.id, opener })}
      >
        {label}
      </button>
    );
  }

  /**
   * A row's actions, two per line: עריכה, השלמה, סיסמה, מייל, תפקיד, then the state control and
   * מחיקה. When a row has both of the last two (the Creator), they share the last line, so "השבתה"
   * and "מחיקה" sit in the same place on every row.
   */
  function rowActions(row: UserManagementRow): ReactNode {
    const a = row.account;
    const main: ReactNode[] = [];
    const last: ReactNode[] = [];
    if (profileEditOffered(scope, a, selfId)) main.push(rowButton("edit", a, "עריכה", `עריכה · הפרטים של ${a.name}`));
    if (technicianProfileCompletionOffered(scope, a, selfId)) {
      main.push(rowButton("complete-tech", a, "השלמה", `השלמה · פרופיל הטכנאי של ${a.name}`));
    }
    if (credentialActionsOffered(scope, a, selfId)) {
      main.push(rowButton("password", a, "סיסמה", `סיסמה · הגדרת סיסמה לחשבון של ${a.name}`));
      main.push(rowButton("email", a, "מייל", `מייל · שינוי כתובת המייל של ${a.name}`));
    }
    if (roleChangeOffered(scope, a, selfId)) main.push(rowButton("role", a, "תפקיד", `תפקיד · שינוי התפקיד של ${a.name}`));
    if (stateChangeOffered(scope, a, selfId)) {
      if (a.active) {
        last.push(rowButton("deactivate", a, "השבתה", `השבתה · החשבון של ${a.name}`, true));
      } else {
        const key = `activate-${a.id}`;
        last.push(
          <button
            key="activate"
            type="button"
            className="chip"
            style={ROW_BTN}
            disabled={blocked}
            aria-label={`הפעלה · החשבון של ${a.name}`}
            onClick={() => void act(key, () => commands.activateAccount(stateInput(a)), activatedLine(a.name), rowId(a.id))}
          >
            {busy === key ? "מפעיל…" : "הפעלה"}
          </button>,
        );
      }
    }
    if (deleteOffered(scope, a, selfId)) last.push(rowButton("delete", a, "מחיקה", `מחיקה · החשבון של ${a.name}`, true));
    if (last.length === 2 && main.length % 2 === 1) main.push(<span key="spacer" aria-hidden="true" />);
    const items = [...main, ...last];
    return items.length > 0 ? <div className="acct-actions">{items.map((item, i) => <Fragment key={i}>{item}</Fragment>)}</div> : null;
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
            onSettled={(text) => finish("error", text, addId)}
          />
        );
    }
  }

  const title = USER_MANAGEMENT_TITLES[scope];
  const tableName = scope === "all" ? "כל המשתמשים" : "משתמשים: טכנאים ושירות לקוחות";
  const empty = accounts.length === 0 && intents.items.length === 0;
  const hasTest = accounts.some((r) => r.account.isTest) || intents.items.some((e) => e.intent.isTest);

  return (
    <>
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
        {empty ? (
          <div className="empty">אין משתמשים להצגה</div>
        ) : (
          // position: relative keeps the 🧪 badge's screen-reader text inside the sideways scroller.
          <div className="scrollx" style={{ position: "relative" }}>
            <table aria-label={tableName}>
              <thead>
                <tr>
                  <th scope="col">שם</th>
                  <th scope="col" className="set-col-wide">
                    מייל · טלפון
                  </th>
                  <th scope="col" className={`${SHORT} set-col-wide`}>
                    תפקיד
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
                {intents.items.map((entry) => {
                  const intent = entry.intent;
                  const opener = openerId("complete-intent", intent.id);
                  const cancelKey = `cancel-${intent.id}`;
                  const state = (
                    <>
                      <span className="pill acct-warn">יצירה שלא הושלמה</span>
                      <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
                        התחילה {entry.startedLabel}
                      </span>
                    </>
                  );
                  return (
                    <tr key={`intent-${intent.id}`} id={intentRowId(intent.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={intent.name} isTest={intent.isTest} />
                        <span className="set-inline-narrow">
                          <span className="sub acct-ltr">{intent.email || "—"}</span>
                          <span style={{ display: "block", marginTop: 4 }}>
                            <RolePill role={intent.role} />
                          </span>
                          <span style={{ display: "block", marginTop: 4 }}>{state}</span>
                        </span>
                      </td>
                      <td className="set-col-wide acct-ltr-cell">{intent.email || "—"}</td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RolePill role={intent.role} />
                      </td>
                      <td className={`${SHORT} set-col-wide`}>{state}</td>
                      <td className="col-fit">
                        {intentCompletionOffered(scope, intent, selfId) && (
                          <div className="acct-actions">
                            <button
                              type="button"
                              id={opener}
                              className="btn pri"
                              style={ROW_BTN}
                              disabled={blocked}
                              aria-label={`השלמת יצירה · ${intent.name}`}
                              onClick={() => open({ kind: "complete-intent", intentId: intent.id, opener })}
                            >
                              השלמת יצירה
                            </button>
                            <button
                              type="button"
                              className="chip"
                              style={ROW_BTN}
                              disabled={blocked}
                              aria-label={`ביטול · היצירה של ${intent.name}`}
                              onClick={() =>
                                void act(cancelKey, () => commands.cancelCreation(cancelCreationInput(intent)), intentCancelledLine(intent.name), addId)
                              }
                            >
                              {busy === cancelKey ? "מבטל…" : "ביטול"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {accounts.map((row) => {
                  const a = row.account;
                  const own = a.id === selfId;
                  return (
                    <tr key={a.id} id={rowId(a.id)} tabIndex={-1} style={{ outlineOffset: -3 }}>
                      <td>
                        <AccountName name={a.name} isTest={a.isTest} note={own ? "החשבון שלך" : undefined} />
                        <TechnicianLine row={row} />
                        {/* Narrow widths: email, phone, role and state under the name (their columns are hidden). */}
                        <span className="set-inline-narrow">
                          <span className="sub acct-ltr">{knownEmail(a.email) ?? "—"}</span>
                          {a.phone && <span className="sub acct-ltr">{a.phone}</span>}
                          <span style={{ display: "block", marginTop: 4 }}>
                            <RolePill role={a.role} />
                          </span>
                          <RowState a={a} narrow />
                        </span>
                      </td>
                      <td className="set-col-wide acct-ltr-cell">
                        {knownEmail(a.email) ?? "—"}
                        {a.phone && <span className="sub acct-ltr">{a.phone}</span>}
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RolePill role={a.role} />
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RowState a={a} />
                      </td>
                      <td className="col-fit">{rowActions(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SettingsMore shown={accounts.length} total={rows.total} />
        {hasTest && (
          // D47: test-marked accounts are labelled; the legend names the badge.
          <div className="sub acct-legend">
            <span aria-hidden="true">🧪</span> {TEST_DATA_LABEL}: חשבונות שנוצרו לבדיקות ואינם חשבונות אמיתיים.
          </div>
        )}
        <ActionMessage message={message} style={{ padding: message ? "10px 18px 12px" : 0 }} />
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
