"use client";

// "תיקונים" of a server-closed visit on the office call card (OF-10, D14, D45): rendered at the end
// of the visit in the timeline. The visit above shows the current values (the latest correction);
// this part keeps every original visible: per corrected field, the original (as the technician
// closed the visit, or as the device reported the time) and each correction after it, with who,
// when and the mandatory reason. A field time's correction is a new time report (the device's
// report is never overwritten, D45).
// "תיקון ביקור סגור" opens VisitCorrectionDialog: only when `canCorrect` (Manager and Creator, a
// fixed capability, D33; the page decides; display only, G-04). Customer Service sees the history
// only (with `card`); technicians never see this part (their closed visits are read-only, D14).
// A simulated correction is added to this list marked "לא נשמר · פעולה מדומה" (nothing was
// stored, so the visit above does not change); a stored one refreshes the card from the server.
// Props are a view of VisitCorrectionHistory (VisitCorrectionView: the corrector's name only, no
// account id reaches the browser through this part; phase E policy P1).
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CORRECTABLE_FIELD_LABELS, TIME_CORRECTION_FIELDS, type CorrectableVisitField, type VisitCorrection } from "@/features/visits/data/types";
import { ActionMessage, type ActionMessageValue } from "./AccountAdminParts";
import { ReviewValueText } from "./ReviewParts";
import { SettingsNotSaved } from "./SettingsShell";
import { VisitCorrectionDialog } from "./VisitCorrectionDialog";
import type { VisitCorrectionRow, VisitCorrectionView } from "./VisitCorrectionView";

type Entry = { row: VisitCorrectionRow; simulated: boolean };

/** Corrections grouped by field: the field corrected most recently first, each chain oldest first. */
function byField(entries: readonly Entry[]): { field: CorrectableVisitField; chain: Entry[] }[] {
  const groups = new Map<CorrectableVisitField, Entry[]>();
  for (const e of entries) groups.set(e.row.field, [...(groups.get(e.row.field) ?? []), e]);
  return [...groups].map(([field, newestFirst]) => ({ field, chain: [...newestFirst].reverse() }));
}

export function VisitCorrections({
  history,
  canCorrect,
  reasons,
  title,
}: {
  history: VisitCorrectionView;
  /** Whether the viewer's screens offer "תיקון ביקור סגור" (Manager and Creator; display only). */
  canCorrect: boolean;
  /** Active follow-up reasons (Settings), for a corrected follow-up reason. */
  reasons: readonly string[];
  /** The dialog's sub-line: request, visit and customer. */
  title: string;
}) {
  const router = useRouter();
  const id = useId();
  const [added, setAdded] = useState<readonly Entry[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = `${id}-h`;

  // Focus returns to "תיקון ביקור סגור" after the dialog closes (after the re-render without it).
  useEffect(() => {
    if (focusTrigger) triggerRef.current?.focus();
  }, [focusTrigger]);

  const entries: Entry[] = [...added, ...history.rows.map((row) => ({ row, simulated: false }))];
  const groups = byField(entries);
  const total = history.total + added.length;
  if (!groups.length && !canCorrect) return null;

  function close() {
    setOpen(false);
    setFocusTrigger((n) => n + 1);
  }

  function saved(correction: VisitCorrection | null, simulated: boolean) {
    if (correction) {
      const row: VisitCorrectionRow = {
        id: correction.id,
        field: correction.field,
        after: correction.after,
        reason: correction.reason,
        byName: correction.by.name,
        atLabel: "עכשיו",
      };
      setAdded((prev) => [{ row, simulated }, ...prev]);
    }
    const label = correction ? CORRECTABLE_FIELD_LABELS[correction.field] : "הביקור";
    setMessage({
      kind: "ok",
      text: simulated ? `בהדגמה: התיקון של ${label} היה נשמר והמקור נשאר. לא נשמר.` : `התיקון של ${label} נשמר. המקור נשאר גלוי.`,
    });
    close();
    if (!simulated) router.refresh();
  }

  return (
    <section className="vc" aria-labelledby={headingId}>
      <div className="vc-head">
        <h4 id={headingId} className="vc-title">
          תיקונים
          {total > 0 && <span className="sub num">{` · ${total}`}</span>}
        </h4>
        {canCorrect && (
          <button
            ref={triggerRef}
            type="button"
            className="btn vc-btn"
            aria-haspopup="dialog"
            aria-label={`תיקון ביקור סגור · ביקור ${history.n}`}
            onClick={() => {
              setMessage(null);
              setOpen(true);
            }}
          >
            תיקון ביקור סגור
          </button>
        )}
      </div>
      <ActionMessage message={message} style={{ marginTop: message ? 6 : 0 }} />
      {groups.length ? (
        <ul className="vc-list">
          {groups.map(({ field, chain }) => {
            const time = TIME_CORRECTION_FIELDS.includes(field);
            return (
              <li key={field} className="vc-group">
                <div className="vc-field">
                  <b>{CORRECTABLE_FIELD_LABELS[field]}</b>
                  {time && <span className="pill vc-pill">דיווח זמן חדש · המקור נשמר</span>}
                </div>
                <div className="vc-row vc-orig">
                  <span className="vc-k">{time ? "דיווח מהמכשיר" : "המקור מהטכנאי"}</span>
                  <span className="vc-v">
                    <ReviewValueText value={history.original[field]} />
                  </span>
                </div>
                {chain.map(({ row, simulated }) => (
                  <div key={row.id} className="vc-row">
                    <span className="vc-k">תיקון</span>
                    <span className="vc-v">
                      <ReviewValueText value={row.after} />
                      <span className="sub vc-meta">
                        {row.byName} · <span className="num">{row.atLabel}</span> · סיבה: <bdi>{row.reason}</bdi>
                      </span>
                      {simulated && <SettingsNotSaved />}
                    </span>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sub vc-none">אין תיקונים. הערכים כפי שהטכנאי סגר את הביקור.</p>
      )}
      {history.total > history.rows.length && (
        <p className="sub vc-none">
          מוצגים <span className="num">{history.rows.length}</span> התיקונים האחרונים מתוך <span className="num">{history.total}</span>
        </p>
      )}
      {open && <VisitCorrectionDialog history={history} reasons={reasons} title={title} onClose={close} onSaved={saved} />}
    </section>
  );
}
