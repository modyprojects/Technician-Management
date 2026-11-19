"use client";

// The frame of the account dialogs (Step 2 PR 2.3: "הגדרת סיסמה", "שינוי כתובת מייל", "עריכת פרטים",
// "השלמת יצירה", "השלמת פרופיל טכנאי"; SE-17, SE-19, SE-20 PROPOSED). The look is the demo's drawer
// (.drawer-bg / .drawer, docs/demo.html L159-164), as "תיקון ביקור סגור" (VisitCorrectionDialog): a
// modal dialog rendered into document.body, outside the card's layout. Behaviour, as that dialog:
// - focus moves into the first field when it opens;
// - Tab and Shift+Tab stay inside it, and focus that leaves it comes back;
// - Escape, ✕ ("סגירה") and the form's "ביטול" close it (not while a command runs);
// - a press that starts and ends on the dimmed background closes it only while the form is
//   untouched (`dirty` false), so typed text is never discarded by a stray click;
// - the caller returns focus to the button that opened it (it knows the opener; on success it may
//   move focus to the changed row instead).
// The form inside is the caller's: `.vc-form` with a `.db` body and a `.df` footer.
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  TECHNICIAN_COLOR_NAMES,
  TECHNICIAN_COLOR_TOKENS,
  technicianColorCss,
  type TechnicianColorToken,
} from "@/features/reference/data/types";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first field of the form: never the hidden username of the password dialog (tabindex -1). */
const FIRST_FIELD = 'form input:not([disabled]):not([tabindex="-1"]), form select:not([disabled]), form textarea:not([disabled])';

export function AccountDialog({
  title,
  sub,
  dirty,
  busy = false,
  onClose,
  children,
}: {
  title: string;
  /** A line above the title. */
  sub?: string;
  /** Something was typed or chosen: the background no longer closes the dialog. */
  dirty: boolean;
  /** A command runs: nothing closes the dialog. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  /** The current press started on the dimmed background (not in the panel). */
  const pressOnBackdrop = useRef(false);

  function close() {
    if (!busy) onClose();
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const panel = panelRef.current;
    if (e.key !== "Tab" || !panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first || !last) {
      e.preventDefault();
      panel.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /** Focus that leaves the open dialog comes back to it. */
  const onFocusIn = useEffectEvent((e: FocusEvent) => {
    const panel = panelRef.current;
    if (!panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
    panel.focus({ preventScroll: true });
  });

  useEffect(() => {
    const panel = panelRef.current;
    const field = panel?.querySelector<HTMLElement>(FIRST_FIELD);
    (field ?? panel)?.focus();
    const keydown = (e: KeyboardEvent) => onKeyDown(e);
    const focusin = (e: FocusEvent) => onFocusIn(e);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
    };
  }, []);

  return createPortal(
    <div
      className="drawer-bg acct-modal-bg"
      onPointerDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const fromBackdrop = pressOnBackdrop.current && e.target === e.currentTarget;
        pressOnBackdrop.current = false;
        if (fromBackdrop && !dirty) close();
      }}
    >
      <div ref={panelRef} className="drawer vc-dialog acct-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            {sub && <div className="sub">{sub}</div>}
            <h2 id={titleId} className="vc-dialog-title">
              {title}
            </h2>
          </div>
          <button type="button" className="xbtn" aria-label="סגירה" onClick={() => close()} disabled={busy}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The dialogs' "the action failed" line (a thrown error; never a server detail). */
export const DIALOG_FAILED = "הפעולה לא בוצעה. נסה שוב.";

/**
 * The dialogs' notes, each a line. `pending` marks a TEMPORARY behaviour that waits for the owner
 * ("ממתין להחלטת בעלים"), in the warning colours.
 */
export function DialogNotes({ notes }: { notes: readonly { text: string; pending?: boolean }[] }) {
  return (
    <ul className="acct-notes">
      {notes.map((n) => (
        <li key={n.text} className={n.pending ? "acct-pending" : undefined}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * "צבע ביומן": the allowlisted colour tokens as radio swatches (pattern: AccountAdminForms "+ הוספת
 * טכנאי"). `value` null: none chosen (a required choice). The swatch is the token's CSS variable,
 * never CSS from input.
 */
export function ColorChoice({
  name,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  /** The radio group's name (unique on the page). */
  name: string;
  value: TechnicianColorToken | null;
  onChange: (token: TechnicianColorToken) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <fieldset className="set-swatches" aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
      <legend>צבע ביומן</legend>
      {TECHNICIAN_COLOR_TOKENS.map((token) => (
        <label key={token} className="set-swatch-opt">
          <input
            type="radio"
            name={name}
            value={token}
            checked={value === token}
            disabled={disabled}
            onChange={() => onChange(token)}
          />
          <span className="set-swatch" style={{ background: technicianColorCss(token) }} aria-hidden="true" />
          {TECHNICIAN_COLOR_NAMES[token]}
        </label>
      ))}
    </fieldset>
  );
}

