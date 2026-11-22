import type { ReactNode } from "react";
import { StatusPill, VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import { isClosedVisitStatus, type MediaKind, type MediaPhase, type VisitSource, type VisitStatus } from "@/features/visits/data/types";
import { TimeRange } from "@/components/ui/TimeRange";
import { minutesLabel } from "@/features/calls/data/visit-durations";

// Visit timeline of the office call card (docs/demo.html offCard() visitHtml, L836-846;
// demo-deviations OF-06): one section per visit, newest first, edged in the visit-status colour,
// with field times (office only, TE-25), the pickup item, the technician's summary and recording,
// media and the customer's signature. Visit pills keep the demo's visit statuses (OF-17).
// Additions in the demo's visual language: visit source line (SIM-14), approved transcription
// (TE-15), parts replaced (TE-17), next-visit note (TE-21), the approval text preserved at
// signing instead of the current Settings text (OF-06, D43), and 🧪 on test media (SIM-19).
// Each visit is the anchor `#visit-<n>` (links from "פריטים לבדיקה"); `renderExtra` adds a part at
// the end of a visit (the call card's "תיקונים" of a closed visit, OF-10). A visit with audited
// corrections (`correctedCount`, D14) shows "תוקן" under its header: a link to that part
// (`#visit-<n>-corrections`), where each original stays visible; the values above are the current
// ones.

/** A visit as the office call card shows it. Labels are formatted by the caller. */
export type TimelineVisit = {
  /** Visit number within the call. */
  n: number;
  /** Task number from the invitation. */
  task: number | string;
  status: VisitStatus;
  /** "היום" or "21.10". */
  dateLabel: string;
  start: string;
  end: string;
  tech: { name: string; color: string; phone?: string };
  source: VisitSource;
  /** Field times "HH:MM" (office only, TE-25). */
  departAt: string | null;
  arriveAt: string | null;
  endAt: string | null;
  /** Minutes from arrival to end, or null. */
  treatMin: number | null;
  /** Minutes from departure to arrival and from departure to end, computed by the caller from the
   *  recorded instants (features/calls/data/visit-durations.ts; correct across midnight). When
   *  absent (the demo), they are derived from the "HH:MM" labels above. */
  travelMin?: number | null;
  totalMin?: number | null;
  /** Follow-up reason. */
  reason: string | null;
  summary: string;
  /** Approved transcription of the recording; "" when none. */
  transcript: string;
  /** Recording length ("1:05"), or null when there is no recording. */
  recLabel: string | null;
  media: { kind: MediaKind; when: MediaPhase }[];
  /** Media and recording are test data (D47, SIM-19). */
  mediaIsTest: boolean;
  parts: string[];
  /** "מה צריך בביקור הבא" (follow-up only). */
  nextNote: string;
  signer: string | null;
  /** Approval text shown to the customer at signing (D43). */
  signedText: string | null;
  /** Item to pick up before the visit, and where from. */
  collect: string;
  collectFrom: string;
  /** Audited corrections of the closed visit shown on this card (OF-10); 0 or absent for none. */
  correctedCount?: number;
};

export type RenderRecording = (visit: TimelineVisit) => ReactNode;

/** A part at the end of one visit (for example its corrections); null for none. */
export type RenderVisitExtra = (visit: TimelineVisit) => ReactNode;

export function VisitTimeline({
  visits,
  showReport = true,
  renderRecording,
  renderExtra,
  renderMedia,
  perFieldTestMarks = true,
}: {
  visits: readonly TimelineVisit[];
  /** The technician's report (summary, recording, media, signature): the matrix key `card`. */
  showReport?: boolean;
  /** Recording control for viewers allowed to play originals (D37); otherwise a locked label. */
  renderRecording?: RenderRecording;
  /** A part at the end of each visit (the caller decides per visit). */
  renderExtra?: RenderVisitExtra;
  /** The real card's photos (D92 (2), D95 (f)): replaces the media placeholders when given. */
  renderMedia?: RenderVisitExtra;
  /** False on the real card (D74): no per-field test marks (media, simulator source line). */
  perFieldTestMarks?: boolean;
}) {
  const newestFirst = [...visits].sort((a, b) => b.n - a.n);
  return (
    <section aria-label="ביקורים בקריאה">
      <h2 className="sub" style={{ fontFamily: "var(--body)", fontWeight: 700, marginBottom: 10 }}>
        {visits.length === 1 ? "ביקור אחד" : `${visits.length} ביקורים · מהחדש לישן`}
      </h2>
      <div className="grid">
        {newestFirst.map((v) => (
          <VisitSection key={v.n} v={v} showReport={showReport} renderRecording={renderRecording} renderExtra={renderExtra} renderMedia={renderMedia} perFieldTestMarks={perFieldTestMarks} />
        ))}
      </div>
    </section>
  );
}

const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Whole minutes from one "HH:MM" to another, or null when either is missing or the order is wrong. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const d = toMinutes(to) - toMinutes(from);
  return d >= 0 ? d : null;
}

const timePillStyle = { background: "var(--bg)", color: "var(--ink2)" } as const;
const labelStyle = { fontWeight: 700, marginTop: 12 } as const;

function VisitSection({
  v,
  showReport,
  renderRecording,
  renderExtra,
  renderMedia,
  perFieldTestMarks,
}: {
  v: TimelineVisit;
  showReport: boolean;
  renderRecording?: RenderRecording;
  renderExtra?: RenderVisitExtra;
  renderMedia?: RenderVisitExtra;
  perFieldTestMarks: boolean;
}) {
  const s = VISIT_STATUSES[v.status];
  const hasReport = v.summary || v.recLabel;
  // D60 (5), every closed visit: total (departure to finish) and travel (departure to arrival).
  const closed = isClosedVisitStatus(v.status);
  const travelMin = v.travelMin !== undefined ? v.travelMin : minutesBetween(v.departAt, v.arriveAt);
  const totalMin = v.totalMin !== undefined ? v.totalMin : minutesBetween(v.departAt, v.endAt);
  return (
    <article id={`visit-${v.n}`} className="card vis vc-anchor" style={{ borderRightColor: s.c }} aria-label={`ביקור ${v.n}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 className="num" style={{ fontSize: 16 }}>
          ביקור {v.n} · {v.dateLabel} · <TimeRange start={v.start} end={v.end} />
        </h3>
        <StatusPill status={v.status} extra={v.reason ? ` · ${v.reason}` : ""} />
      </div>
      <div className="sub" style={{ marginTop: 4 }}>
        <span className="dot" style={{ background: v.tech.color }} aria-hidden="true" /> {v.tech.name} · משימה{" "}
        <span className="num">{v.task}</span>
      </div>
      {(perFieldTestMarks || v.source !== "simulator") && (
        <div style={{ marginTop: 4 }}>
          <VisitSourceLine source={v.source} />
        </div>
      )}
      {v.correctedCount ? (
        <div style={{ marginTop: 6 }}>
          <a className="pill vc-mark" href={`#visit-${v.n}-corrections`}>
            תוקן במשרד · {v.correctedCount === 1 ? "תיקון אחד" : `${v.correctedCount} תיקונים`} ›
          </a>
        </div>
      ) : null}

      {(v.departAt || v.arriveAt) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
          {v.departAt && (
            <span className="pill num" style={timePillStyle}>
              יציאה {v.departAt}
            </span>
          )}
          {v.arriveAt && (
            <span className="pill num" style={timePillStyle}>
              הגעה {v.arriveAt}
            </span>
          )}
          {v.endAt && (
            <span className="pill num" style={timePillStyle}>
              סיום {v.endAt}
            </span>
          )}
          {v.endAt && v.treatMin != null && (
            <span className="pill num" style={timePillStyle}>
              בטיפול {minutesLabel(v.treatMin)}
            </span>
          )}
          {closed && travelMin != null && (
            <span className="pill num" style={timePillStyle}>
              זמן נסיעה {minutesLabel(travelMin)}
            </span>
          )}
          {closed && totalMin != null && (
            <span className="pill num" style={timePillStyle}>
              משך כולל {minutesLabel(totalMin)}
            </span>
          )}
        </div>
      )}

      {v.collect && (
        <div
          style={{
            marginTop: 10,
            background: "var(--warn-bg)",
            border: "1px solid var(--warn-bd)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 14,
            color: "var(--warn-ink)",
          }}
        >
          <b>לאסוף:</b> {v.collect} · מ{v.collectFrom}
        </div>
      )}

      {showReport && hasReport && (
        <>
          <div className="sub" style={labelStyle}>
            סיכום הטכנאי
          </div>
          {v.summary && <div style={{ lineHeight: 1.5 }}>{v.summary}</div>}
          {v.recLabel && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              {renderRecording ? renderRecording(v) : <LockedRecording label={v.recLabel} />}
              {perFieldTestMarks && v.mediaIsTest && <TestBadge />}
            </div>
          )}
        </>
      )}

      {showReport && v.transcript && v.transcript !== v.summary && (
        <>
          <div className="sub" style={labelStyle}>
            תמלול ההקלטה (מאושר)
          </div>
          <div style={{ lineHeight: 1.5 }}>{v.transcript}</div>
        </>
      )}

      {showReport && v.parts.length > 0 && (
        <>
          <div className="sub" style={labelStyle}>
            חלפים שהוחלפו
          </div>
          <div>{v.parts.join(" · ")}</div>
        </>
      )}

      {showReport && v.nextNote && (
        <>
          <div className="sub" style={labelStyle}>
            מה צריך בביקור הבא
          </div>
          <div style={{ lineHeight: 1.5 }}>{v.nextNote}</div>
        </>
      )}

      {showReport && renderMedia?.(v)}

      {showReport && !renderMedia && v.media.length > 0 && (
        <>
          <div className="sub" style={{ ...labelStyle, display: "flex", gap: 6, alignItems: "center" }}>
            <span>
              תמונות וסרטונים (<span className="num">{v.media.length}</span>)
            </span>
            {perFieldTestMarks && v.mediaIsTest && <TestBadge />}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {v.media.map((m, i) => (
              <div
                key={i}
                className={m.kind === "vid" ? "thumb vid" : "thumb"}
                style={{ width: 64 }}
                role="img"
                aria-label={`${m.kind === "vid" ? "סרטון" : "תמונה"} · ${m.when === "before" ? "לפני הטיפול" : "אחרי הטיפול"}`}
              />
            ))}
          </div>
        </>
      )}

      {showReport && v.status === "done" && (v.signer || v.signedText) && (
        <>
          <div className="sub" style={labelStyle}>
            חתימת לקוח
          </div>
          <div style={{ fontSize: 14 }}>
            {v.signedText && `"${v.signedText}"`}
            {v.signedText && v.signer && " · "}
            {v.signer}
          </div>
        </>
      )}

      {renderExtra?.(v)}
    </article>
  );
}

/** A recording the viewer may not play (D37: originals need the Creator or the key `recordings`). */
function LockedRecording({ label }: { label: string }) {
  return (
    <span
      className="pill num"
      style={{ background: "var(--bg)", color: "var(--muted)" }}
      title="השמעת ההקלטה המקורית מותרת רק בהרשאה מתאימה"
    >
      <span aria-hidden="true">🔒 </span>
      הקלטה {label} · ללא הרשאת השמעה
    </span>
  );
}
