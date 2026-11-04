import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import type { MediaItem, VisitDetail } from "@/features/visits/data/types";

// Read-only view of the technician's own closed visit (docs/demo.html techDoneView() L663-680;
// TE-26, D14: closed synced visits are read-only to technicians). Look as in the demo: the "🔒"
// note, the follow-up box, address / product / SKU / fault, "הסיכום שלך", the before and after
// media, and the customer's approval. Changes (docs/demo-deviations.md, decisions):
// - TE-26, D43: the approval shows the text preserved at signing (`signedText`), never the
//   current Settings text.
// - D36: once the visit is server-closed the technician no longer opens his own recording, so the
//   demo's "▶ הקלטה" playback is not offered; the approved transcription is shown instead.
// - Added: parts replaced (TE-17), "מה צריך בביקור הבא" (TE-21), the visit source (SIM-14) and
//   🧪 badges on a test product and test media (SIM-17, SIM-19).
// - Field times are never shown to the technician (TE-25 PENDING).
// Presentational: no actions at all.

const PHASES = [
  ["before", "לפני הטיפול"],
  ["after", "אחרי הטיפול"],
] as const;

function MediaSection({ title, items }: { title: string; items: MediaItem[] }) {
  if (!items.length) return null;
  return (
    <section className="card" aria-label={title} style={{ padding: "12px 14px" }}>
      <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}>
        {title}
        {items.some((m) => m.isTest) && <TestBadge />}
      </h2>
      <div className="media" style={{ marginTop: 8 }}>
        {items.map((m) => (
          <div key={m.id} className={m.kind === "vid" ? "thumb vid" : "thumb"} role="img" aria-label={m.kind === "vid" ? "סרטון" : "תמונה"} />
        ))}
      </div>
    </section>
  );
}

export function VisitInfoClosed({ visit }: { visit: VisitDetail }) {
  const { product: p } = visit;
  const transcript = visit.transcript.trim();
  const showTranscript = transcript !== "" && transcript !== visit.summary.trim();
  const lockText =
    visit.status === "cancel"
      ? "🔒 הביקור בוטל. אפשר לצפות בפרטים, אבל לא לערוך אותם."
      : "🔒 הביקור נשלח. אפשר לצפות בפרטים, אבל לא לערוך אותם.";
  return (
    <>
      <div className="note" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {lockText}
      </div>

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
            {visit.customer.address.street}, {visit.customer.address.city}
          </b>
        </div>
        <div className="row">
          <span className="k">מוצר</span>
          <span>
            {p.name}
            {p.isTest && (
              <>
                {" "}
                <TestBadge />
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
        <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 }}>הסיכום שלך</h2>
        {visit.summary && <div style={{ lineHeight: 1.5, marginTop: 4 }}>{visit.summary}</div>}
        {showTranscript && (
          <div style={{ lineHeight: 1.5, marginTop: 4, fontSize: 14 }}>
            <b>תמלול מאושר:</b> {transcript}
          </div>
        )}
        {!visit.summary && !transcript && <div className="sub">אין סיכום</div>}
      </section>

      {visit.parts.length > 0 && (
        <section className="card" aria-label="חלפים שהוחלפו" style={{ padding: "12px 14px" }}>
          <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 }}>חלפים שהוחלפו</h2>
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
          <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 }}>אישור הלקוח</h2>
          {visit.signedText && <div style={{ marginTop: 4, fontSize: 14 }}>&quot;{visit.signedText}&quot;</div>}
          {visit.signerName && <div className="sub" style={{ marginTop: 4 }}>נחתם ע&quot;י {visit.signerName}</div>}
        </section>
      )}

      <VisitSourceLine source={visit.source} />
    </>
  );
}
