"use client";

// Account requests (SE-01, D34 a): the Manager's Customer Service create / activate / reactivate /
// role-change requests, with their status (pending / approved / rejected / cancelled) as pills.
// New UI in the demo's visual language (card + rows like its lists, pills like its statuses).
// - mode "decide" (the Creator, Settings › "משתמשים והרשאות", section "בקשות לאישור"): approve, or
//   reject with a required reason typed into an inline field (accounts.decideAccountRequest).
// - mode "own" (the Manager, "ניהול משתמשים", section "הבקשות שלי"): cancel a pending request
//   (accounts.cancelAccountRequest).
// Nothing changes while a request is pending; every step is audited; no automatic expiry (D25).
// The screen reads each result: a SIMULATED one (the UI demo) shows the outcome on its row, marked
// "לא נשמר · פעולה מדומה", with no further action, and says "בהדגמה … לא נשמר"; a stored one says
// what was done (TE-23). Display only (G-04): the server decides who may act.
import { useEffect, useId, useRef, useState } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import type { AccountRef, AccountRequest } from "@/features/accounts/data/types";
import { accountDecisionError, REJECTION_REASON_MAX } from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import {
  ActionMessage,
  RequestStatusPill,
  requestOutcomeText,
  requestRoleText,
  requestTitle,
  type AccountRequestEntry,
  type ActionMessageValue,
} from "./AccountAdminParts";
import { SettingsCardHead, SettingsMore, SettingsNotSaved } from "./SettingsShell";

const FAILED = "הפעולה לא בוצעה. נסה שוב.";
const SMALL_BTN = { padding: "5px 12px", fontSize: 13 } as const;

/** The result line: what a simulated command would have done, or what a stored one did. */
const said = (simulated: boolean, demo: string, done: string): string => (simulated ? `בהדגמה: ${demo} לא נשמר.` : done);

export function AccountAdminRequests({
  mode,
  entries,
  total,
  self,
  onUpdate,
}: {
  mode: "decide" | "own";
  entries: readonly AccountRequestEntry[];
  /** Matching requests before the list cap (at most 100 are shown). */
  total: number;
  /** The signed-in account (who decides or cancels). */
  self: AccountRef | null;
  /** Replaces one request after a successful (simulated) action. */
  onUpdate: (entry: AccountRequestEntry) => void;
}) {
  const { accounts } = useCommands();
  const id = useId();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const running = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  /** The row whose action just finished: it takes focus, since its buttons are gone. */
  const [focusRow, setFocusRow] = useState<string | null>(null);

  useEffect(() => {
    if (rejecting) reasonRef.current?.focus();
  }, [rejecting]);

  useEffect(() => {
    if (focusRow) document.getElementById(`${id}-${focusRow}`)?.focus();
  }, [focusRow, id]);

  const pendingCount = entries.filter((e) => e.request.status === "pending" && !e.local).length;
  const title = mode === "decide" ? "בקשות לאישור" : "הבקשות שלי";

  /** The request after a successful action; `local` (no further action) when it was simulated. */
  function done(entry: AccountRequestEntry, patch: Partial<AccountRequest>, simulated: boolean) {
    setFocusRow(entry.request.id);
    onUpdate({
      ...entry,
      request: { ...entry.request, ...patch, decidedBy: self, decidedAt: new Date().toISOString() },
      decidedLabel: "עכשיו",
      local: simulated,
    });
  }

  /** Runs one command for one request; ignores taps while another action runs. */
  async function act(key: string, run: () => Promise<CommandResult>, onOk: (simulated: boolean) => void) {
    if (running.current) return;
    running.current = true;
    setBusy(key);
    setMessage(null);
    try {
      const r = await run();
      if (r.ok) onOk(r.simulated);
      else setMessage({ kind: "error", text: r.error });
    } catch {
      setMessage({ kind: "error", text: FAILED });
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function approve(entry: AccountRequestEntry) {
    void act(
      `approve-${entry.request.id}`,
      () => accounts.decideAccountRequest(entry.request.id, { outcome: "approve" }),
      (simulated) => {
        done(entry, { status: "approved" }, simulated);
        const title = requestTitle(entry.request);
        setMessage({
          kind: "ok",
          text: said(simulated, `הבקשה "${title}" הייתה מאושרת ונכנסת לתוקף.`, `הבקשה "${title}" אושרה ונכנסה לתוקף.`),
        });
      },
    );
  }

  function reject(entry: AccountRequestEntry) {
    const text = reason.trim();
    const invalid = accountDecisionError({ outcome: "reject", reason: text });
    if (invalid) {
      setReasonError(invalid);
      reasonRef.current?.focus();
      return;
    }
    void act(
      `reject-${entry.request.id}`,
      () => accounts.decideAccountRequest(entry.request.id, { outcome: "reject", reason: text }),
      (simulated) => {
        done(entry, { status: "rejected", reason: text }, simulated);
        setRejecting(null);
        setReason("");
        setReasonError(null);
        const title = requestTitle(entry.request);
        setMessage({
          kind: "ok",
          text: said(simulated, `הבקשה "${title}" הייתה נדחית, והסיבה נשמרת איתה.`, `הבקשה "${title}" נדחתה, והסיבה נשמרה איתה.`),
        });
      },
    );
  }

  function cancel(entry: AccountRequestEntry) {
    void act(
      `cancel-${entry.request.id}`,
      () => accounts.cancelAccountRequest(entry.request.id),
      (simulated) => {
        done(entry, { status: "cancelled" }, simulated);
        const title = requestTitle(entry.request);
        setMessage({ kind: "ok", text: said(simulated, `הבקשה "${title}" הייתה מבוטלת.`, `הבקשה "${title}" בוטלה.`) });
      },
    );
  }

  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
      <SettingsCardHead
        id={`${id}-title`}
        title={title}
        sub={
          mode === "decide"
            ? "בקשות של המנהל לחשבונות שירות לקוחות: יצירה, הפעלה, הפעלה מחדש ושינוי תפקיד. שום דבר לא משתנה עד שהיוצר מאשר; דחייה נשמרת עם סיבה, וכל צעד נרשם ביומן הביקורת."
            : "יצירה, הפעלה, הפעלה מחדש ושינוי תפקיד של חשבון שירות לקוחות נכנסים לתוקף רק אחרי אישור היוצר. עד אז שום דבר לא משתנה."
        }
        action={
          pendingCount > 0 ? (
            <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
              {pendingCount === 1 ? "בקשה אחת ממתינה" : `${pendingCount} ממתינות`}
            </span>
          ) : undefined
        }
      />
      {entries.length === 0 ? (
        <div className="empty">אין בקשות</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label={title}>
          {entries.map((entry) => {
            const r = entry.request;
            const outcome = requestOutcomeText(entry);
            const actionable = r.status === "pending" && !entry.local;
            const isRejecting = rejecting === r.id && actionable && mode === "decide";
            const reasonId = `${id}-${r.id}-reason`;
            const reasonErrorId = `${id}-${r.id}-reason-error`;
            return (
              <li
                key={r.id}
                id={`${id}-${r.id}`}
                tabIndex={-1}
                style={{
                  padding: "12px 18px",
                  borderTop: "1px solid var(--line2)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px 16px",
                  alignItems: "flex-start",
                  outlineOffset: -3,
                }}
              >
                <div style={{ flex: "1 1 260px", minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.5 }}>
                  <b>{requestTitle(r)}</b>
                  {r.isTest && (
                    <>
                      {" "}
                      <TestBadge />
                    </>
                  )}
                  <div className="sub">
                    <span dir="ltr">{r.target.email}</span> · {requestRoleText(r)}
                  </div>
                  <div className="sub">
                    {`נשלחה ${entry.requestedLabel}`}
                    {mode === "decide" && r.requestedBy.name ? ` · על ידי ${r.requestedBy.name}` : ""}
                  </div>
                  {outcome && <div className="sub">{outcome}</div>}
                  {r.status === "rejected" && r.reason && <div className="sub">סיבת הדחייה: {r.reason}</div>}
                  {entry.local && (
                    <div>
                      <SettingsNotSaved />
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <RequestStatusPill status={r.status} />
                  {actionable && mode === "decide" && !isRejecting && (
                    <>
                      <button
                        type="button"
                        className="btn pri"
                        style={SMALL_BTN}
                        disabled={busy !== null}
                        aria-label={`אישור: ${requestTitle(r)}`}
                        onClick={() => approve(entry)}
                      >
                        אישור
                      </button>
                      <button
                        type="button"
                        className="btn dng"
                        style={SMALL_BTN}
                        disabled={busy !== null}
                        aria-label={`דחייה: ${requestTitle(r)}`}
                        onClick={() => {
                          setRejecting(r.id);
                          setReason("");
                          setReasonError(null);
                          setMessage(null);
                        }}
                      >
                        דחייה
                      </button>
                    </>
                  )}
                  {actionable && mode === "own" && (
                    <button
                      type="button"
                      className="btn"
                      style={SMALL_BTN}
                      disabled={busy !== null}
                      aria-label={`ביטול הבקשה: ${requestTitle(r)}`}
                      onClick={() => cancel(entry)}
                    >
                      {busy === `cancel-${r.id}` ? "מבטל…" : "ביטול הבקשה"}
                    </button>
                  )}
                </div>
                {isRejecting && (
                  <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 700 }}>
                      סיבת הדחייה (חובה)
                    </label>
                    <textarea
                      id={reasonId}
                      rows={2}
                      ref={reasonRef}
                      value={reason}
                      maxLength={REJECTION_REASON_MAX}
                      aria-required="true"
                      aria-invalid={reasonError ? true : undefined}
                      aria-describedby={reasonError ? reasonErrorId : undefined}
                      placeholder="למשל: אין צורך בחשבון נוסף כרגע"
                      style={{ width: "100%", display: "block" }}
                      onChange={(e) => {
                        setReason(e.target.value);
                        if (reasonError) setReasonError(null);
                      }}
                    />
                    {reasonError && (
                      <div id={reasonErrorId} role="alert" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
                        {reasonError}
                      </div>
                    )}
                    <div className="sub">הסיבה נשמרת עם הבקשה.</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn dng" disabled={busy !== null} onClick={() => reject(entry)}>
                        {busy === `reject-${r.id}` ? "שולח…" : "שליחת הדחייה"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => {
                          setRejecting(null);
                          setReasonError(null);
                          // Back to the row, whose "דחייה" button returns.
                          document.getElementById(`${id}-${r.id}`)?.focus();
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SettingsMore shown={entries.length} total={total} />
      <ActionMessage message={message} style={{ padding: message ? "0 18px 12px" : 0 }} />
    </section>
  );
}
