"use client";

// The Outlook invitation simulator inside "זימונים שלא נקלטו" (D24; D60 (11), resolving open
// decision 27; SIM-01 to SIM-05, SIM-10, SIM-11; X-05: the demo's Outlook modal, docs/demo.html
// L1020-1036, ".modal-bg" / ".modal" / ".ol-top"). The page renders this component ONLY where the
// server says the simulator is on (CALENDAR_SIMULATOR=1; on Vercel Production only while testingPeriod, D90) and the
// caller's role may use it (Manager, Creator, Customer Service): there is no UI toggle, and a hidden
// button is not the control. The server action checks the switch, the input and the caller again,
// and the database decides (Migration 6).
// The form sends create, update, reschedule, re-assign, cancel, duplicate and invalid invitations
// through the existing server action, which passes them to the single ingestion service (SIM-06).
// Invitations sent from this page are kept in this screen's memory only (never in browser storage),
// so an update, cancellation or duplicate names one of them. Every record the simulator creates is
// test data (D47) and nothing sends email (SIM-09). Invitation text is plain text everywhere.
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  hasErrors,
  initialFormValues,
  needsExisting,
  sampleInvitation,
  sendsFields,
  sentAfter,
  sentInvitationLabel,
  SIMULATOR_ACTION_HINTS,
  SIMULATOR_ACTION_LABELS,
  SIMULATOR_FORM_ACTIONS,
  SIMULATOR_SAMPLE_LABELS,
  SIMULATOR_SAMPLES,
  simulatorFormErrors,
  simulatorRequestOf,
  simulatorResultView,
  type SentInvitation,
  type SimulatorFormAction,
  type SimulatorFormErrors,
  type SimulatorFormValues,
  type SimulatorResultView,
  type SimulatorRun,
  type SimulatorSample,
} from "@/features/calendar/data/simulator-form";
import type { IsoDate } from "@/features/data-access/common";
import { problemKindLabel } from "./unparsed-labels";

/** A technician the "אל" field offers: his name and Outlook address (Settings › טכנאים). */
export type SimulatorTechnician = { id: string; name: string; email: string };

/** The "אל" select's value for an address typed by hand. */
const OTHER = "__other";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A fresh fictional number (D47): six digits for a request, "SC-" and five digits for a customer. */
function freshIds(): { requestNumber: string; customerNumber: string } {
  const n = (digits: number) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, "0");
  return { requestNumber: `9${n(5)}`, customerNumber: `SC-${n(5)}` };
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <span id={id} className="sim-err">
      {text}
    </span>
  );
}

function ResultPanel({ view }: { view: SimulatorResultView }) {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the result is below the long body: bring it into view when it arrives.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [view]);
  return (
    <div ref={ref} className={`sim-result sim-${view.tone}`} role="status">
      <b>{view.title}</b>
      {view.lines.map((line) => (
        <span key={line} className="sim-line">
          {line}
        </span>
      ))}
      {view.problems.length > 0 && (
        <ul className="sim-problems" aria-label="מה לתקן בזימון">
          {view.problems.map((p, i) => (
            <li key={`${i}-${p.kind}-${p.field}`}>
              <span className="pill ib-kind">{problemKindLabel(p)}</span>{" "}
              <b>{p.label}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SimulatorDialog({
  titleId,
  busy,
  onClose,
  children,
}: {
  titleId: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onClose();
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
    panelRef.current?.focus();
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
    <div className="sim-bg">
      <div ref={panelRef} className="sim-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function InvitationSimulator({
  run,
  technicians,
  today,
}: {
  /** The server action (lib/actions/calendar-simulator.ts runInvitationSimulator), passed by the page. */
  run: SimulatorRun;
  /** Technicians that accept invitations, for "אל". */
  technicians: readonly SimulatorTechnician[];
  /** Today in Asia/Jerusalem (the server's date, so the first render matches). */
  today: IsoDate;
}) {
  const router = useRouter();
  const id = useId();
  const titleId = `${id}-title`;
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<SimulatorFormValues | null>(null);
  const [other, setOther] = useState(false);
  const [errors, setErrors] = useState<SimulatorFormErrors>({});
  const [result, setResult] = useState<SimulatorResultView | null>(null);
  const [busy, setBusy] = useState(false);
  /** Invitations sent from this page, newest first (this screen's memory only). */
  const [sent, setSent] = useState<SentInvitation[]>([]);

  const techEmails = new Set(technicians.map((t) => t.email));

  function openDialog() {
    if (!values) {
      const first = technicians[0]?.email ?? "";
      setValues(initialFormValues(today, freshIds(), first));
      setOther(first === "");
    }
    setResult(null);
    setErrors({});
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    openerRef.current?.focus();
  }

  function patch(next: Partial<SimulatorFormValues>) {
    setValues((v) => (v ? { ...v, ...next } : v));
  }

  /** Fills the fields from an invitation sent before (an update starts from its last version). */
  function chooseExisting(eventId: string, action: SimulatorFormAction) {
    const known = sent.find((s) => s.eventId === eventId);
    if (known?.fields && sendsFields(action)) {
      patch({ existing: eventId, ...known.fields });
      setOther(!techEmails.has(known.fields.attendee));
    } else patch({ existing: eventId });
  }

  function chooseAction(action: SimulatorFormAction) {
    if (!values) return;
    setErrors({});
    setResult(null);
    if (action === "create") {
      patch({ action, existing: "" });
      return;
    }
    const existing = values.existing || (needsExisting(action) ? (sent.find((s) => !s.cancelled || action === "duplicate")?.eventId ?? "") : "");
    patch({ action });
    if (existing) chooseExisting(existing, action);
  }

  /** A sample is always a NEW invitation (the demo's samples, X-05): never a version of one sent before. */
  function applySample(sample: SimulatorSample) {
    const follow = sent.find((s) => s.requestNumber)?.requestNumber ?? null;
    const s = sampleInvitation(sample, freshIds(), follow);
    patch({ subject: s.subject, body: s.body, date: today, start: "09:00", end: "11:00", action: sample === "missing" ? "invalid" : "create", existing: "" });
    setErrors({});
    setResult(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values || busy) return;
    const found = simulatorFormErrors(values, sent);
    setErrors(found);
    if (hasErrors(found)) {
      setResult(null);
      return;
    }
    const request = simulatorRequestOf(values, sent);
    if (!request) return;
    setBusy(true);
    setResult(null);
    try {
      const answer = await run(request);
      setResult(simulatorResultView(answer));
      const previous = sent.find((s) => s.eventId === values.existing) ?? null;
      const entry = sentAfter(answer, values, previous);
      if (entry) {
        setSent((list) => [entry, ...list.filter((s) => s.eventId !== entry.eventId)]);
        // The next send of the same form is a new version of this invitation, never a second call.
        if (values.action === "create" || values.action === "invalid") patch({ existing: entry.eventId, action: values.action === "create" ? "update" : "invalid" });
        router.refresh();
      }
    } catch {
      setResult(simulatorResultView({ ok: false, error: "failed" }));
    } finally {
      setBusy(false);
    }
  }

  const v = values;
  const err = (key: keyof SimulatorFormErrors) => (errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${key}-err` } : {});
  const showExisting = v !== null && (needsExisting(v.action) || (v.action === "invalid" && sent.length > 0));

  return (
    <>
      <button ref={openerRef} type="button" className="btn" onClick={openDialog} aria-haspopup="dialog">
        <span aria-hidden="true">🧪 </span>סימולטור זימונים
      </button>
      {open && v && (
        <SimulatorDialog titleId={titleId} busy={busy} onClose={closeDialog}>
          <div className="sim-top">
            <b id={titleId}>Outlook · זימון בדיקה (סימולטור)</b>
            <button type="button" className="xbtn sim-x" onClick={closeDialog} aria-label="סגירה" disabled={busy}>
              ✕
            </button>
          </div>
          <form className="sim-body" noValidate onSubmit={onSubmit} aria-labelledby={titleId}>
            <div className="note">
              כך הנציגה עובדת: זימון רגיל ב-Outlook לפי התבנית, והאפליקציה קוראת אותו לבד. כל זימון מכאן נשמר כנתוני בדיקה (🧪 זימון בדיקה), ולא נשלח
              ממנו מייל. אפשר לערוך כל שדה, או לבחור דוגמה:
              <div className="sim-samples">
                {SIMULATOR_SAMPLES.map((s) => (
                  <button key={s} type="button" className="btn" onClick={() => applySample(s)} disabled={busy}>
                    {SIMULATOR_SAMPLE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <fieldset className="sim-actions">
              <legend>פעולה</legend>
              <div className="sim-chips">
                {SIMULATOR_FORM_ACTIONS.map((a) => (
                  <label key={a} className={v.action === a ? "chip on" : "chip"}>
                    <input type="radio" name={`${id}-action`} value={a} checked={v.action === a} onChange={() => chooseAction(a)} className="sr-only" />
                    {SIMULATOR_ACTION_LABELS[a]}
                  </label>
                ))}
              </div>
              <p className="sub sim-hint">{SIMULATOR_ACTION_HINTS[v.action]}</p>
            </fieldset>

            {showExisting && (
              <div className="sim-row">
                <label htmlFor={`${id}-existing`}>זימון קיים</label>
                <div className="sim-cell">
                  <select id={`${id}-existing`} value={v.existing} onChange={(e) => chooseExisting(e.target.value, v.action)} {...err("existing")}>
                    <option value="">{v.action === "invalid" ? "זימון חדש" : sent.length ? "בחרו זימון" : "עוד לא נשלחו זימונים מהמסך הזה"}</option>
                    {sent.map((s) => (
                      <option key={s.eventId} value={s.eventId}>
                        {sentInvitationLabel(s)}
                      </option>
                    ))}
                  </select>
                  <FieldError id={`${id}-existing-err`} text={errors.existing} />
                </div>
              </div>
            )}

            {sendsFields(v.action) && (
              <>
                <div className="sim-row">
                  <label htmlFor={`${id}-to`}>אל</label>
                  <div className="sim-cell">
                    <select
                      id={`${id}-to`}
                      value={other ? OTHER : v.attendee}
                      onChange={(e) => {
                        if (e.target.value === OTHER) {
                          setOther(true);
                          patch({ attendee: "" });
                        } else {
                          setOther(false);
                          patch({ attendee: e.target.value });
                        }
                      }}
                      {...(other ? {} : err("attendee"))}
                    >
                      {technicians.map((t) => (
                        <option key={t.id} value={t.email}>
                          {`${t.name} <${t.email}>`}
                        </option>
                      ))}
                      <option value={OTHER}>כתובת אחרת…</option>
                    </select>
                    {other && (
                      <input
                        type="email"
                        dir="ltr"
                        aria-label="כתובת המשתתף"
                        placeholder="name@example.test"
                        value={v.attendee}
                        onChange={(e) => patch({ attendee: e.target.value })}
                        autoComplete="off"
                        {...err("attendee")}
                      />
                    )}
                    <FieldError id={`${id}-attendee-err`} text={errors.attendee} />
                  </div>
                </div>
                <div className="sim-row">
                  <label htmlFor={`${id}-subject`}>נושא</label>
                  <div className="sim-cell">
                    <input id={`${id}-subject`} value={v.subject} onChange={(e) => patch({ subject: e.target.value })} autoComplete="off" {...err("subject")} />
                    <FieldError id={`${id}-subject-err`} text={errors.subject} />
                  </div>
                </div>
                <div className="sim-row">
                  <label htmlFor={`${id}-date`}>מועד</label>
                  <div className="sim-cell">
                    <div className="sim-when">
                      <input id={`${id}-date`} type="date" value={v.date} onChange={(e) => patch({ date: e.target.value })} {...err("date")} />
                      <input
                        aria-label="שעת התחלה"
                        inputMode="numeric"
                        value={v.start}
                        onChange={(e) => patch({ start: e.target.value })}
                        className="sim-time"
                        {...err("start")}
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        aria-label="שעת סיום"
                        inputMode="numeric"
                        value={v.end}
                        onChange={(e) => patch({ end: e.target.value })}
                        className="sim-time"
                        {...err("end")}
                      />
                    </div>
                    <FieldError id={`${id}-date-err`} text={errors.date} />
                    <FieldError id={`${id}-start-err`} text={errors.start} />
                    <FieldError id={`${id}-end-err`} text={errors.end} />
                  </div>
                </div>
                <label htmlFor={`${id}-body`} className="sub sim-body-label">
                  גוף הזימון (לפי התבנית)
                </label>
                <textarea id={`${id}-body`} rows={14} value={v.body} onChange={(e) => patch({ body: e.target.value })} className="sim-text" spellCheck={false} />
              </>
            )}

            {hasErrors(errors) && (
              <p className="sim-result sim-error" role="alert">
                יש שדות לתקן לפני השליחה.
              </p>
            )}
            {result && <ResultPanel view={result} />}

            <div className="sim-foot">
              <button type="submit" className="btn pri" disabled={busy} aria-busy={busy}>
                {busy ? "שולח…" : "שליחה"}
              </button>
              <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
                סגירה
              </button>
            </div>
          </form>
        </SimulatorDialog>
      )}
    </>
  );
}
