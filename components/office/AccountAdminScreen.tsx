"use client";

// Account administration (SE-01, D34; demo setUsers() L942-944 as changed by SE-01): the accounts
// table with role pills and the 🧪 badge of test users (SIM-18), the "+" forms, and the account
// requests. Two scopes (display only, G-04; the server checks every action in the database, D34):
// - "all": the Creator (Settings › "משתמשים והרשאות"): every account; "+ הוספת משתמש"
//   (immediate; technicians are added on Settings › "טכנאים"); deactivate and activate any account
//   but the Creator's own; "בקשות לאישור" with approve / reject (AccountAdminRequests, "decide").
// - "cs-tech": the Manager ("ניהול משתמשים"): Customer Service and Technician accounts only.
//   "+ בקשת חשבון שירות לקוחות" makes a pending request that waits for the Creator (D34 a);
//   "+ הוספת טכנאי" and a technician's activation are immediate (D34 c); deactivation of a Customer
//   Service or Technician account is immediate, audited, and the Creator is notified in the app
//   (D34 b); activating a Customer Service account is a request. "הבקשות שלי" lists the Manager's
//   own requests, with "ביטול הבקשה" while pending. No password or email editing (D34 e).
// Every action runs one command from useCommands().accounts, and the screen reads the result: a
// SIMULATED result (the UI demo) shows the change on its row, marked "לא נשמר · פעולה מדומה", with
// no further action (nothing was stored, so a second action would act on stale data), and says
// "בהדגמה … לא נשמר"; a stored result says what was done (TE-23: never claim a save that did not
// happen). Created rows come from the command (ids and test markers as stored, D47). After an
// action the changed row takes focus (its button is gone).
// - An inactive account with a pending request: the Creator decides it in "בקשות לאישור" (no direct
//   activation beside a pending request); approving an activation or a role change updates the row.
// - At narrow widths the email and the role pill move under the name (styles/ui.css
//   .set-col-wide), so status and actions stay in view.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ACCOUNT_REQUEST_KIND_LABELS,
  activationKind,
  type AccountRequestKind,
  type UserAccount,
} from "@/features/accounts/data/types";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import { AccountForm, type AccountFormKind, type AccountFormResult } from "./AccountAdminForms";
import {
  AccountName,
  AccountStatePill,
  ActionMessage,
  RequestStatusPill,
  RolePill,
  type AccountAdminData,
  type AccountRequestEntry,
  type ActionMessageValue,
} from "./AccountAdminParts";
import { AccountAdminRequests } from "./AccountAdminRequests";
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

/** The result line: what a simulated command would have done, or what a stored one did. */
const said = (simulated: boolean, demo: string, done: string): string => (simulated ? `בהדגמה: ${demo} לא נשמר.` : done);

export function AccountAdminScreen({ scope, accounts, requests, self }: AccountAdminData) {
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
  /** The row whose action just finished: it takes focus, since its button is gone. */
  const [focusRow, setFocusRow] = useState<string | null>(null);

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  const focus = (elementId: string) => document.getElementById(elementId)?.focus();
  const openerId = (kind: AccountFormKind) => `${id}-open-${kind}`;
  const deactivateId = (accountId: string) => `${id}-deact-${accountId}`;
  const rowId = (accountId: string) => `${id}-row-${accountId}`;

  useEffect(() => {
    if (focusRow) document.getElementById(`${id}-row-${focusRow}`)?.focus();
  }, [focusRow, id]);

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
      () => commands.deactivateAccount(a.id),
      (r) => {
        setRows((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: false } : x)));
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
      () => commands.activateAccount(a.id),
      (r) => {
        setRows((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: true, deactivatedAt: null } : x)));
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

  function rowActions(a: UserAccount): ReactNode {
    if (changed.has(a.id)) return <SettingsNotSaved />;
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
          aria-label={`השבתת החשבון של ${a.name}`}
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
          aria-label={`הפעלת החשבון של ${a.name}`}
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
        {rows.length === 0 ? (
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
                  <th scope="col" className={SHORT}>
                    מצב
                  </th>
                  <th scope="col" className="col-fit">
                    פעולות
                  </th>
                </tr>
              </thead>
              <tbody>
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
                        </span>
                      </td>
                      <td className="set-col-wide" dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>
                        {a.email}
                      </td>
                      <td className={`${SHORT} set-col-wide`}>
                        <RolePill role={a.role} />
                      </td>
                      <td className={SHORT}>
                        <AccountStatePill active={a.active} />
                        {pending && (
                          <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
                            בקשה ממתינה
                          </span>
                        )}
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
        entries={reqs}
        total={requests.total + addedRequests}
        self={self}
        onUpdate={onRequestUpdate}
      />

      <div className="note">
        {scope === "all"
          ? "רק היוצר מנהל חשבונות מנהל ויוצר ומחליט על הבקשות של המנהל. אין הרשמה עצמית: חשבונות נוצרים רק כאן. חשבונות מושבתים ולא נמחקים."
          : "ניהול החשבונות הוא יכולת קבועה של המנהל ואינו תלוי במטריצת ההרשאות. המנהל מנהל חשבונות שירות לקוחות וטכנאים בלבד; חשבונות מנהל ויוצר מנוהלים על ידי היוצר. המנהל לא קובע ולא מאפס סיסמאות, ולא משנה מייל של חשבון."}
      </div>
    </>
  );
}
