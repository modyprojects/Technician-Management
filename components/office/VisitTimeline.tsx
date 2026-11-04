import type { ReactNode } from "react";
import { StatusPill, VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import type { MediaKind, MediaPhase, VisitSource, VisitStatus } from "@/features/visits/data/types";

// Visit timeline of the office call card (docs/demo.html offCard() visitHtml, L836-846;
// demo-deviations OF-06): one section per visit, newest first, edged in the visit-status colour,
// with field times (office only, TE-25), the pickup item, the technician's summary and recording,
// media and the customer's signature. Visit pills keep the demo's visit statuses (OF-17).
// Additions in the demo's visual language: visit source line (SIM-14), approved transcription
// (TE-15), parts replaced (TE-17), next-visit note (TE-21), the approval text preserved at
// signing instead of the current Settings text (OF-06, D43), and 🧪 on test media (SIM-19).

/** A visit as the office call card shows it. Labels are formatted by the caller. */
export type TimelineVisit = {
  /** Visit number within the call. */
  n: number;
  /** Task number from the invitation. */
  task: number;
  status: VisitStatus;
  /** "היום" or "21.10". */
  dateLabel: string;
  start: string;
  end: string;
  tech: { name: string; color: string };
  source: VisitSource;
  /** Field times "HH:MM" (office only, TE-25). */
  departAt: string | null;
  arriveAt: string | null;
  endAt: string | null;
  /** Minutes from arrival to end, or null. */
  treatMin: number | null;
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
};

export type RenderRecording = (visit: TimelineVisit) => ReactNode;

export function VisitTimeline({
  visits,
  showReport = true,
  renderRecording,
}: {
  visits: readonly TimelineVisit[];
  /** The technician's report (summary, recording, media, signature): the matrix key `card`. */
  showReport?: boolean;
  /** Recording control for viewers allowed to play originals (D37); otherwise a locked label. */
  renderRecording?: RenderRecording;
}) {
  const newestFirst = [...visits].sort((a, b) => b.n - a.n);
  return (
    <section aria-label="ביקורים בקריאה">
      <h2 className="sub" style={{ fontFamily: "var(--body)", fontWeight: 700, marginBottom: 10 }}>
        {visits.length === 1 ? "ביקור אחד" : `${visits.length} ביקורים · מהחדש לישן`}
      </h2>
      <div className="grid">
        {newestFirst.map((v) => (
          <VisitSection key={v.n} v={v} showReport={showReport} renderRecording={renderRecording} />
        ))}
      </div>
    </section>
  );
}

const timePillStyle = { background: "var(--bg)", color: "var(--ink2)" } as const;
const labelStyle = { fontWeight: 700, marginTop: 12 } as const;

function VisitSection({
  v,
  showReport,
  renderRecording,
}: {
  v: TimelineVisit;
  showReport: boolean;
  renderRecording?: RenderRecording;
}) {
  const s = VISIT_STATUSES[v.status];
  const hasReport = v.summary || v.recLabel;
  return (
    <article className="card vis" style={{ borderRightColor: s.c }} aria-label={`ביקור ${v.n}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 className="num" style={{ fontSize: 16 }}>
          ביקור {v.n} · {v.dateLabel} · {v.start}–{v.end}
        </h3>
        <StatusPill status={v.status} extra={v.reason ? ` · ${v.reason}` : ""} />
      </div>
      <div className="sub" style={{ marginTop: 4 }}>
        <span className="dot" style={{ background: v.tech.color }} aria-hidden="true" /> {v.tech.name} · משימה{" "}
        <span className="num">{v.task}</span>
      </div>
      <div style={{ marginTop: 4 }}>
        <VisitSourceLine source={v.source} />
      </div>

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
              בטיפול {v.treatMin} דק׳
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
              {v.mediaIsTest && <TestBadge />}
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

      {showReport && v.media.length > 0 && (
        <>
          <div className="sub" style={{ ...labelStyle, display: "flex", gap: 6, alignItems: "center" }}>
            <span>
              תמונות וסרטונים (<span className="num">{v.media.length}</span>)
            </span>
            {v.mediaIsTest && <TestBadge />}
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
