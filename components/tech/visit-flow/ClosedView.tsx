// The technician's closed visit, read-only (D14, TE-26, D79 (2), D95): the lock note, address,
// summary, photos (short-lived signed links created on the server under his own session), and either
// the customer's approval with the signer (the text preserved at signing, D43) or the follow-up
// reason and "מה צריך בביקור הבא". From the day after closing (the details are no longer served)
// only the address, the status and the summary (D79 (2)). No actions, no recorded times (D68).
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { ClosedVisitDetail } from "@/features/visits/data/types";
import { PHASE_TITLE, PHOTO_PHASES } from "@/features/visit-flow/rules";
import type { VisitPhoto } from "@/lib/data/visit-flow";
import { H2, PhotoTile } from "./VisitParts";

export function ClosedView({ visit, photos, reduced }: { visit: ClosedVisitDetail; photos: readonly VisitPhoto[]; reduced: boolean }) {
  const look = visit.status === "done" ? "done" : "cont";
  const s = VISIT_STATUSES[look];
  const a = visit.customer.address;
  return (
    <>
      <div className="note" role="note">
        <span aria-hidden="true">🔒 </span>הביקור נסגר · לצפייה בלבד
      </div>
      {!reduced && look === "cont" && (
        <section className="card" aria-label="המשך טיפול" style={{ padding: "12px 14px", borderColor: s.c, background: s.bg, color: s.fg, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 700 }}>↻ המשך טיפול{visit.followupReason ? ` · ${visit.followupReason}` : ""}</div>
          {visit.nextNote && (
            <div style={{ fontSize: 14 }}>
              <b>מה צריך בביקור הבא: </b>
              {visit.nextNote}
            </div>
          )}
        </section>
      )}
      <section className="card" aria-label="פרטי הביקור" style={{ padding: "4px 14px" }}>
        <div className="row">
          <span className="k">כתובת</span>
          <span>
            {a.street}, {a.city}
          </span>
        </div>
        {!reduced && visit.product.name && (
          <div className="row">
            <span className="k">מוצר</span>
            <span>{visit.product.name}</span>
          </div>
        )}
      </section>
      <section className="card" aria-label="הסיכום שלך" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={H2}>הסיכום שלך</h2>
        <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{visit.summary}</div>
      </section>
      {!reduced &&
        PHOTO_PHASES.map((phase) => {
          const items = photos.filter((p) => p.phase === phase);
          if (!items.length) return null;
          const title = PHASE_TITLE[phase];
          return (
            <section key={phase} className="card" aria-label={title} style={{ padding: "12px 14px" }}>
              <h2 style={H2}>{title}</h2>
              <div className="media" style={{ marginTop: 8 }}>
                {items.map((p, i) => (
                  <PhotoTile key={p.id} label={`תמונה ${i + 1} · ${title}`} url={p.url} isTest={p.isTest} />
                ))}
              </div>
            </section>
          );
        })}
      {!reduced && look === "done" && visit.signedText && (
        <section className="card" aria-label="אישור הלקוח" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={H2}>אישור הלקוח</h2>
          <div style={{ background: s.bg, color: s.fg, borderRadius: 10, padding: "10px 12px", fontWeight: 700, lineHeight: 1.4 }}>&quot;{visit.signedText}&quot;</div>
          {visit.signerName && <div className="sub">חתם/ה: {visit.signerName}</div>}
        </section>
      )}
    </>
  );
}
