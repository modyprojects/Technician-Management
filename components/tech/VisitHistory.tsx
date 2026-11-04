import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { VisitHistoryItem } from "@/features/visits/data/types";

// "↻ ביקור המשך" box on the technician visit card (docs/demo.html techCall() L519-524; TE-06).
// Same look as the demo (orange border, pale background, "ביקור N · תאריך · טכנאי · סיבה",
// the summary in quotes, the media count). Changes (TE-06, D36, D37):
// - Every earlier closed visit of the same call is shown, newest first (the demo showed only the
//   last one), even when another technician did it.
// - Instead of the previous recording (the demo showed its length) the approved transcription is
//   shown; another technician's recording is never offered.
// - Added: parts replaced (TE-17) and "מה צריך בביקור הבא" (TE-21).
// - Never shown: signatures or signer names, field times, later or concurrent visits. The
//   data-access layer returns only what the technician may see (VisitHistoryItem); this
//   component shows nothing beyond it.
// Presentational. Renders nothing when there is no earlier visit.

/** "2026-10-19" → "19.10". */
const ddmm = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const mediaLabel = (n: number): string =>
  n === 0 ? "אין תמונות או סרטונים" : n === 1 ? "1 תמונה/סרטון" : `${n} תמונות/סרטונים`;

export function VisitHistory({ items }: { items: readonly VisitHistoryItem[] }) {
  if (!items.length) return null;
  const newestFirst = [...items].sort((a, b) => b.n - a.n);
  const title =
    items.length === 1 ? "↻ ביקור המשך · היה כבר ביקור אצל הלקוח" : `↻ ביקור המשך · היו כבר ${items.length} ביקורים אצל הלקוח`;
  return (
    <section
      className="card"
      aria-label="ביקורים קודמים בקריאה"
      style={{ padding: "10px 14px", border: "2px solid var(--s-cont)", background: "var(--prev-bg)" }}
    >
      <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 13, color: "var(--s-cont-fg)" }}>{title}</h2>
      {newestFirst.map((h, i) => {
        const transcript = h.transcript.trim();
        const showTranscript = transcript !== "" && transcript !== h.summary.trim();
        return (
          <article
            key={h.n}
            aria-label={`ביקור ${h.n}`}
            style={i ? { borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 } : undefined}
          >
            <div className="num" style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>
              ביקור {h.n} · {ddmm(h.date)} · {h.technician.name} ·{" "}
              <b style={{ color: "var(--s-cont-fg)" }}>{h.followupReason || VISIT_STATUSES[h.status].label}</b>
            </div>
            {h.summary && <div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 4 }}>&quot;{h.summary}&quot;</div>}
            {showTranscript && (
              <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                <b>תמלול מאושר:</b> {transcript}
              </div>
            )}
            {h.nextNote && (
              <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                <b>מה צריך בביקור הבא:</b> {h.nextNote}
              </div>
            )}
            {h.parts.length > 0 && (
              <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                <b>חלפים שהוחלפו:</b> {h.parts.join(", ")}
              </div>
            )}
            <div className="num" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {mediaLabel(h.mediaCount)}
            </div>
          </article>
        );
      })}
    </section>
  );
}
