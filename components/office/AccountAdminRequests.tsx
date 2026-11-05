"use client";

// Account requests (SE-01, D34 a): the Manager's Customer Service create / activate / reactivate /
// role-change requests, with their status (pending / approved / rejected / cancelled) as pills.
// New UI in the demo's visual language (card + rows like its lists, pills like its statuses).
// - mode "decide" (the Creator, Settings › "משתמשים והרשאות", section "בקשות לאישור"): approve, or
//   reject with a required reason typed into an inline field (accounts.decideAccountRequest).
// - mode "own" (the Manager, Settings › "משתמשים", section "הבקשות שלי"): cancel his own pending
//   request, or his own approved creation that has no account yet (requesterMayCancel;
//   accounts.cancelAccountRequest). The Creator never cancels a Manager's pending request: he
//   rejects it with a reason. Each action sends the request's version (`expectedVersion`) and
//   keeps the version a stored action returns (versionAfter), so a later action on the same
//   request never gets a false "data changed". A cancelled approved creation keeps its decider and
//   time (cancelledRequest): the row reads "אושרה על ידי … · בוטלה".
// An approved creation whose account was not created (Variant B; TEMPORARY, Step 2 plan Q15; Step 2
// PR 2.3, SE-20): "החשבון עוד לא נוצר". The Creator ("decide") completes it ("השלמת יצירה",
// CompleteCreationForm; requestCompletionOffered) or cancels it ("ביטול"; creatorCancelOffered),
// never a pending request's cancel (he rejects it with a reason). The Manager ("own") keeps "ביטול
// הבקשה" and reads that the Creator completes it. A cancel keeps the approval's decider and time
// (cancelledEntryLabel). Approving and creating in one action is PR 2.6.
// Nothing changes while a request is pending; every step is audited; no automatic expiry (D25).
// The screen reads each result: a SIMULATED one (the UI demo) shows the outcome on its row, marked
// "לא נשמר · פעולה מדומה", with no further action, and says "בהדגמה … לא נשמר"; a stored one says
// what was done (TE-23). Display only (G-04): the server decides who may act.
import { useEffect, useId, useRef, useState } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import { creatorCancelOffered, requestCompletionOffered, type AccountAdminScope } from "@/features/accounts/data/offers";
import {
  cancelledRequest,
  isOpenCreation,
  requesterMayCancel,
  type AccountRef,
  type AccountRequest,
  type CompletedCreation,
} from "@/features/accounts/data/types";
import { accountDecisionError, REJECTION_REASON_MAX } from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult, VersionedResult } from "@/features/data-access/common";
import {
  ActionMessage,
  RequestStatusPill,
  requestOutcomeText,
  requestRoleText,
  requestTitle,
  said,
  type AccountRequestEntry,
  type ActionMessageValue,
} from "./AccountAdminParts";
import { cancelInput, cancelledEntryLabel, decisionInput, requestEntryAfter } from "./AccountAdminRules";
import { CompleteCreationForm } from "./AccountCompletionForms";
import { SettingsCardHead, SettingsMore, SettingsNotSaved } from "./SettingsShell";

const FAILED = "הפעולה לא בוצעה. נסה שוב.";
const SMALL_BTN = { padding: "5px 12px", fontSize: 13 } as const;

export function AccountAdminRequests({
  mode,
  scope,
  entries,
  total,
  self,
  onUpdate,
  onComplete,
}: {
  mode: "decide" | "own";
  /** The viewer's account scope (display rules, offers.ts). */
  scope: AccountAdminScope;
  entries: readonly AccountRequestEntry[];
  /** Matching requests before the list cap (at most 100 are shown). */
  total: number;
  /** The signed-in account (who decides or cancels). */
  self: AccountRef | null;
  /** Replaces one request after a successful (simulated) action. */
  onUpdate: (entry: AccountRequestEntry) => void;
  /** "השלמת יצירה" succeeded: the created account (and technician) as returned, for the accounts table. */
  onComplete: (created: CompletedCreation, simulated: boolean) => void;
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
  /** The request whose "השלמת יצירה" dialog is open. */
  const [completing, setCompleting] = useState<AccountRequestEntry | null>(null);
  const selfId = self?.id ?? null;
  const completeOpenerId = (requestId: string) => `${id}-complete-${requestId}`;

  useEffect(() => {
    if (rejecting) reasonRef.current?.focus();
  }, [rejecting]);

  useEffect(() => {
    if (focusRow) document.getElementById(`${id}-${focusRow}`)?.focus();
  }, [focusRow, id]);

  const pendingCount = entries.filter((e) => e.request.status === "pending" && !e.local).length;
  const title = mode === "decide" ? "בקשות לאישור" : "הבקשות שלי";

  /**
   * The request after a successful action, with the version a stored action returned; `local` (no
   * further action) when it was simulated.
   */
  function done(
    entry: AccountRequestEntry,
    request: AccountRequest,
    result: Extract<CommandResult<VersionedResult>, { ok: true }>,
    decidedLabel: string | null,
  ) {
    setFocusRow(entry.request.id);
    onUpdate(requestEntryAfter(entry, request, result, decidedLabel));
  }

  /** A decision: the Creator is its decider, now. */
  const decided = (entry: AccountRequestEntry, patch: Partial<AccountRequest>): AccountRequest => ({
    ...entry.request,
    ...patch,
    decidedBy: self,
    decidedAt: new Date().toISOString(),
  });

  /** Runs one command for one request; ignores taps while another action runs. */
  async function act(
    key: string,
    run: () => Promise<CommandResult<VersionedResult>>,
    onOk: (result: Extract<CommandResult<VersionedResult>, { ok: true }>) => void,
  ) {
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

  function approve(entry: AccountRequestEntry) {
    void act(
      `approve-${entry.request.id}`,
      () => accounts.decideAccountRequest(decisionInput(entry, { outcome: "approve" })),
      (r) => {
        done(entry, decided(entry, { status: "approved" }), r, "עכשיו");
        const title = requestTitle(entry.request);
        setMessage({
          kind: "ok",
          text: said(r.simulated, `הבקשה "${title}" הייתה מאושרת ונכנסת לתוקף.`, `הבקשה "${title}" אושרה ונכנסה לתוקף.`),
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
      () => accounts.decideAccountRequest(decisionInput(entry, { outcome: "reject", reason: text })),
      (r) => {
        done(entry, decided(entry, { status: "rejected", reason: text }), r, "עכשיו");
        setRejecting(null);
        setReason("");
        setReasonError(null);
        const title = requestTitle(entry.request);
        setMessage({
          kind: "ok",
          text: said(r.simulated, `הבקשה "${title}" הייתה נדחית, והסיבה נשמרת איתה.`, `הבקשה "${title}" נדחתה, והסיבה נשמרה איתה.`),
        });
      },
    );
  }

  function cancel(entry: AccountRequestEntry) {
    void act(
      `cancel-${entry.request.id}`,
      () => accounts.cancelAccountRequest(cancelInput(entry)),
      (r) => {
        // An approved creation keeps its decider and time (Migration 1): only a pending one is "now".
        const request = cancelledRequest(entry.request, self, new Date().toISOString());
        done(entry, request, r, cancelledEntryLabel(entry, request));
        const title = requestTitle(entry.request);
        setMessage({ kind: "ok", text: said(r.simulated, `הבקשה "${title}" הייתה מבוטלת.`, `הבקשה "${title}" בוטלה.`) });
      },
    );
  }

  /** "השלמת יצירה" succeeded: the request now has its account (no further action), the table gets the row. */
  function completed(entry: AccountRequestEntry, created: CompletedCreation, simulated: boolean) {
    setCompleting(null);
    onUpdate({ ...entry, request: { ...entry.request, account: { id: created.account.id, name: created.account.name } }, local: simulated });
    onComplete(created, simulated);
    setFocusRow(entry.request.id);
    const name = entry.request.target.name;
    setMessage({ kind: "ok", text: said(simulated, `החשבון של ${name} היה נוצר מיד.`, `החשבון של ${name} נוצר.`) });
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
            // The requester cancels a pending request or an approved creation with no account yet.
            const cancellable = mode === "own" && !entry.local && requesterMayCancel(r);
            // Variant B (Q15): an approved creation with no account yet.
            const open = isOpenCreation(r) && !entry.local;
            const completable = mode === "decide" && open && requestCompletionOffered(scope, r, selfId);
            const creatorCancel = mode === "decide" && open && creatorCancelOffered(scope, r, selfId);
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
                  {open && (
                    <div className="sub" style={{ color: "var(--warn-fg)", fontWeight: 700 }}>
                      {mode === "decide" ? "החשבון עוד לא נוצר" : "החשבון עוד לא נוצר · היוצר משלים את היצירה"}
                    </div>
                  )}
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
                  {completable && (
                    <button
                      type="button"
                      id={completeOpenerId(r.id)}
                      className="btn pri"
                      style={SMALL_BTN}
                      disabled={busy !== null}
                      aria-label={`השלמת יצירה: ${requestTitle(r)}`}
                      onClick={() => {
                        setMessage(null);
                        setCompleting(entry);
                      }}
                    >
                      השלמת יצירה
                    </button>
                  )}
                  {creatorCancel && (
                    <button
                      type="button"
                      className="btn"
                      style={SMALL_BTN}
                      disabled={busy !== null}
                      aria-label={`ביטול: ${requestTitle(r)}`}
                      onClick={() => cancel(entry)}
                    >
                      {busy === `cancel-${r.id}` ? "מבטל…" : "ביטול"}
                    </button>
                  )}
                  {cancellable && (
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
      {completing && (
        <CompleteCreationForm
          source={{ kind: "request", request: completing.request, label: completing.decidedLabel ?? "" }}
          onClose={() => {
            const requestId = completing.request.id;
            setCompleting(null);
            // Back to the button that opened it (after the dialog is gone).
            requestAnimationFrame(() => document.getElementById(completeOpenerId(requestId))?.focus());
          }}
          onDone={(created, simulated) => completed(completing, created, simulated)}
        />
      )}
    </section>
  );
}
