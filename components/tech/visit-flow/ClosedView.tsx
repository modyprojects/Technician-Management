// Closed visit, read-only (skeleton, D81; D14, TE-26, D79 (2)): the lock note, address, summary,
// photos, and either the customer's approval with the signer (the text preserved at signing, D43)
// or the follow-up reason and "מה צריך בביקור הבא". No actions, no recorded times (D68).
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { SkeletonClosed, SkeletonVisit } from "./fixtures";
import { H2, PhotoTile } from "./VisitParts";

function Photos({ title, items }: { title: string; items: SkeletonClosed["photos"]["before"] }) {
  if (!items.length) return null;
  return (
    <section className="card" aria-label={title} style={{ padding: "12px 14px" }}>
      <h2 style={H2}>{title}</h2>
      <div className="media" style={{ marginTop: 8 }}>
        {items.map((p) => (
          <PhotoTile key={p.id} label={p.label} />
        ))}
      </div>
    </section>
  );
}

export function ClosedView({ visit, closed }: { visit: SkeletonVisit; closed: SkeletonClosed }) {
  const s = VISIT_STATUSES[closed.outcome];
  return (
    <>
      <div className="note" role="note">
        <span aria-hidden="true">🔒 </span>הביקור נסגר · לצפייה בלבד
      </div>
      {closed.outcome === "cont" && (
        <section className="card" aria-label="המשך טיפול" style={{ padding: "12px 14px", borderColor: s.c, background: s.bg, color: s.fg, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 700 }}>↻ המשך טיפול · {closed.reason}</div>
          <div style={{ fontSize: 14 }}>
            <b>מה צריך בביקור הבא: </b>
            {closed.nextNote}
          </div>
        </section>
      )}
      <section className="card" aria-label="פרטי הביקור" style={{ padding: "4px 14px" }}>
        <div className="row">
          <span className="k">כתובת</span>
          <span>
            {visit.street}, {visit.city}
          </span>
        </div>
        <div className="row">
          <span className="k">מוצר</span>
          <span>{visit.product}</span>
        </div>
      </section>
      <section className="card" aria-label="הסיכום שלך" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={H2}>הסיכום שלך</h2>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{closed.summary}</div>
      </section>
      <Photos title="לפני הטיפול" items={closed.photos.before} />
      <Photos title="אחרי הטיפול" items={closed.photos.after} />
      {closed.outcome === "done" && (
        <section className="card" aria-label="אישור הלקוח" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={H2}>אישור הלקוח</h2>
          <div style={{ background: s.bg, color: s.fg, borderRadius: 10, padding: "10px 12px", fontWeight: 700, lineHeight: 1.4 }}>&quot;{closed.approvalText}&quot;</div>
          <div className="sub">חתם/ה: {closed.signer}</div>
        </section>
      )}
    </>
  );
}
