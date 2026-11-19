import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TEST_DATA_LABEL, TestPill, VisitSourceLine } from "@/components/ui/TestBadge";
import type { ClosedVisitDetail, MediaItem, MediaPhase } from "@/features/visits/data/types";
import { VisitHeader } from "./VisitHeader";

// The technician's own closed visit, read-only (docs/demo.html techDoneView() L663-680; TE-26
// CHANGE: same look, read-only, D14). Look as in the demo: "פנייה · ביקור", customer and status in
// the header; the "🔒" note; the follow-up box; address / product / SKU / fault; "הסיכום שלך" with
// the recording; the before and after media; the customer's approval with the signer.
// Changes (docs/demo-deviations.md and decisions):
// - TE-26, D43: the approval shows the text preserved at signing (`signedText`), never the
//   current Settings text.
// - D36: once the visit is server-closed the technician no longer opens his own recording, so the
//   demo's "▶ הקלטה" playback button becomes a plain line with the recording's length; the
//   approved transcription is shown when it differs from the summary. The signature image the
//   demo showed is not part of the DTO (signer and text only).
// - Added: parts replaced (TE-17); "מה צריך בביקור הבא" (TE-21); the visit source (SIM-14); 🧪
//   badges on a test call, product, recording and on each test photo or video (SIM-15, SIM-17,
//   SIM-19). Never the field times (departure, arrival, end: TE-25 PENDING, office only; the DTO
//   has none). The demo shows no visit date here, so neither does this view.
// - Added: the visit's sync state on the device (TE-23, TE-24), passed by the page as `sync`
//   (SyncVisitPanel) when the device still holds or confirmed work of the visit. Its "נסה שוב" and
//   "סנכרן עכשיו" act on the device's queue only; the visit itself stays read-only.
// - TE-23 wording: the demo's "🔒 הביקור נשלח" becomes "🔒 הביקור נסגר בשרת" (the closure is what
//   the server holds); a file of the visit can still be waiting or failing on the device, which the
//   sync panel under it says, so the note never claims that everything was sent.
// Presentational: a ClosedVisitDetail DTO and the back link; no actions of its own.

const PHASES: readonly [MediaPhase, string][] = [
  ["before", "לפני הטיפול"],
  ["after", "אחרי הטיפול"],
];

/** Recording length in seconds → "1:05". */
const recordingLabel = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

const H2 = { fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 } as const;

export function DoneVisitHeader({
  visit,
  backHref,
  backAriaLabel,
}: {
  visit: ClosedVisitDetail;
  backHref: string;
  /** Accessible name of "› חזרה" (where it goes); contains "חזרה". */
  backAriaLabel: string;
}) {
  return (
    <VisitHeader
      backHref={backHref}
      backLabel="חזרה"
      backAriaLabel={backAriaLabel}
      meta={`פנייה ${visit.call.req} · ביקור ${visit.n}`}
      title={visit.customer.name}
      trailing={
        <>
          {visit.call.isTest && <TestPill />}
          <StatusPill status={visit.status} />
        </>
      }
    />
  );
}

function MediaSection({ title, items }: { title: string; items: readonly MediaItem[] }) {
  if (!items.length) return null;
  return (
    <section className="card" aria-label={title} style={{ padding: "12px 14px" }}>
      <h2 style={H2}>{title}</h2>
      <div className="media" style={{ marginTop: 8 }}>
        {items.map((m, i) => {
          const name = `${m.kind === "vid" ? "סרטון" : "תמונה"} ${i + 1} · ${title}`;
          return (
            <div key={m.id} className={m.kind === "vid" ? "thumb vid" : "thumb"}>
              <span role="img" aria-label={m.isTest ? `${name} · ${TEST_DATA_LABEL}` : name} style={{ position: "absolute", inset: 0 }} />
              {m.isTest && (
                <span aria-hidden="true" style={{ position: "absolute", bottom: 4, insetInlineStart: 4, lineHeight: 1 }}>
                  <TestPill />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DoneVisitView({ visit, sync }: { visit: ClosedVisitDetail; sync?: ReactNode }) {
  const { product: p, customer: cu } = visit;
  const summary = visit.summary.trim();
  const transcript = visit.transcript.trim();
  const showTranscript = transcript !== "" && transcript !== summary;
  const rec = visit.recordingSeconds;
  return (
    <>
      <div className="note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        🔒 הביקור נסגר בשרת. אפשר לצפות בפרטים, אבל לא לערוך אותם.
      </div>

      {sync}

      {visit.status === "cont" && (
        <section
          className="card"
          aria-label="המשך טיפול"
          style={{ padding: "10px 14px", background: "var(--s-cont-bg)", borderColor: "var(--s-cont)" }}
        >
          <b style={{ color: "var(--s-cont-fg)" }}>המשך טיפול · {visit.followupReason}</b>
          <div className="sub">המשרד יקבע ביקור חדש, והוא יופיע אצלך ביומן</div>
          {visit.nextNote && (
            <div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 4, color: "var(--s-cont-fg)" }}>
              <b>מה צריך בביקור הבא:</b> {visit.nextNote}
            </div>
          )}
        </section>
      )}

      <section className="card" aria-label="פרטי הביקור" style={{ padding: "4px 14px" }}>
        <div className="row">
          <span className="k">כתובת</span>
          <b>
            {cu.address.street}, {cu.address.city}
          </b>
        </div>
        <div className="row">
          <span className="k">מוצר</span>
          <span>
            {p.name}
            {p.isTest && (
              <>
                {" "}
                <TestPill />
              </>
            )}
          </span>
        </div>
        <div className="row">
          <span className="k">מק&quot;ט</span>
          <span dir="ltr">{p.sku}</span>
        </div>
        <div className="row">
          <span className="k">תיאור התקלה</span>
          <span>{visit.call.problem}</span>
        </div>
      </section>

      <section className="card" aria-label="הסיכום שלך" style={{ padding: "12px 14px" }}>
        <h2 style={H2}>הסיכום שלך</h2>
        {summary && <div style={{ lineHeight: 1.5, marginTop: 4 }}>{summary}</div>}
        {showTranscript && (
          <div style={{ lineHeight: 1.5, marginTop: 4, fontSize: 14 }}>
            <b>תמלול מאושר:</b> {transcript}
          </div>
        )}
        {rec > 0 && (
          <div className="sub" style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              <span aria-hidden="true">🎙 </span>
              הקלטה <span className="num">{recordingLabel(rec)}</span>
            </span>
            {visit.isTest && <TestPill />}
            <span>· אי אפשר להשמיע אותה אחרי שהביקור נסגר בשרת</span>
          </div>
        )}
        {!summary && !transcript && rec === 0 && <div className="sub">אין סיכום</div>}
      </section>

      {visit.parts.length > 0 && (
        <section className="card" aria-label="חלפים שהוחלפו" style={{ padding: "12px 14px" }}>
          <h2 style={H2}>חלפים שהוחלפו</h2>
          <ul style={{ margin: "4px 0 0", paddingInlineStart: 18, lineHeight: 1.5 }}>
            {visit.parts.map((part, i) => (
              <li key={`${i}-${part}`}>{part}</li>
            ))}
          </ul>
        </section>
      )}

      {PHASES.map(([when, title]) => (
        <MediaSection key={when} title={title} items={visit.media.filter((m) => m.when === when)} />
      ))}

      {visit.status === "done" && (
        <section className="card" aria-label="אישור הלקוח" style={{ padding: "12px 14px" }}>
          <h2 style={H2}>אישור הלקוח</h2>
          {visit.signedText && <div style={{ marginTop: 4, fontSize: 14 }}>&quot;{visit.signedText}&quot;</div>}
          {visit.signerName && (
            <div className="sub" style={{ marginTop: 4 }}>
              נחתם ע&quot;י {visit.signerName}
            </div>
          )}
        </section>
      )}

      <VisitSourceLine source={visit.source} />
    </>
  );
}
