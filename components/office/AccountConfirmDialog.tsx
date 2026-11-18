"use client";

// The confirmations of the real user management (D60 (7)), in the account dialogs' drawer
// (AccountDialog: focus moves in, Tab stays inside, Escape and "ביטול" close it, focus returns to the
// opener; never closed while the action runs):
// - "השבתה" (deactivation, immediate, no approval): "an inactive user cannot sign in; history kept";
// - "מחיקה" (the Creator only, Option A): an explicit confirmation, a checkbox that must be ticked
//   before the delete button is enabled (and the action also sends `confirm: true`, which the
//   server requires).
// The caller passes the action; its Hebrew message is shown here on a refusal. A failure that left
// something behind (`settled`, e.g. a deletion stored in the database whose Auth step failed) is
// passed to the caller instead, which closes the dialog and shows it on the card.
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CommandResult } from "@/features/data-access/common";
import { AccountDialog, DIALOG_FAILED } from "./AccountDialog";

export function AccountConfirmDialog({
  title,
  lines,
  acknowledge,
  confirmLabel,
  busyLabel,
  danger = true,
  settled,
  run,
  onDone,
  onSettled,
  onClose,
}: {
  title: string;
  /** The paragraphs that say what will happen. */
  lines: readonly string[];
  /** An explicit confirmation: the checkbox's text; the confirm button waits for it. */
  acknowledge?: string;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  /** Failure messages after which the change partly took effect (closed and shown on the card). */
  settled?: ReadonlySet<string>;
  run: () => Promise<CommandResult<unknown>>;
  onDone: () => void;
  onSettled?: (message: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = acknowledge === undefined || checked;

  async function confirm() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    try {
      const r = await run();
      failure = r.ok ? null : r.error;
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      flushSync(() => setBusy(false));
    }
    if (failure === null) return onDone();
    if (settled?.has(failure) && onSettled) return onSettled(failure);
    setError(failure);
    confirmRef.current?.focus();
  }

  return (
    <AccountDialog title={title} dirty={checked} busy={busy} onClose={onClose}>
      <form
        className="vc-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
        aria-describedby={`${id}-text${error ? ` ${errorId}` : ""}`}
      >
        <div className="db" id={`${id}-text`}>
          {lines.map((line) => (
            <p key={line} className="vc-p acct-confirm-line">
              {line}
            </p>
          ))}
          {acknowledge !== undefined && (
            <label className="acct-check">
              <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
              <span>{acknowledge}</span>
            </label>
          )}
        </div>
        <div className="df">
          <button ref={confirmRef} type="submit" className={danger ? "btn dng" : "btn pri"} disabled={busy || !ready}>
            {busy ? busyLabel : confirmLabel}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          {error && (
            <span id={errorId} role="alert" className="set-err vc-err">
              {error}
            </span>
          )}
        </div>
      </form>
    </AccountDialog>
  );
}
