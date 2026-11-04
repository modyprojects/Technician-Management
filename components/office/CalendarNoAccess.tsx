import Link from "next/link";

// "אין הרשאה" state of the office calendar for a role whose matrix values do not offer `cal` (D33;
// both office roles have it by default, temporary per D51). The same state as the dashboards'
// (AnalyticsNoAccess: card + .empty, wording adapted from the demo's empty office view, L739).
// This only shapes the screen: real enforcement is on the server and in the database (G-04).
export function CalendarNoAccess({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <section className="card" aria-labelledby="ocal-no-access">
      <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>
          🔒
        </span>
        <h2 id="ocal-no-access" style={{ fontSize: 18, color: "var(--ink)" }}>
          אין הרשאה
        </h2>
        <p style={{ margin: 0, maxWidth: 460, lineHeight: 1.5 }}>
          לתפקיד הזה אין הרשאה לצפות ביומן הטכנאים. את ההרשאות קובע היוצר במטריצת ההרשאות שבהגדרות.
        </p>
        <Link className="btn" href={backHref} prefetch={false}>
          <span aria-hidden="true">› </span>
          חזרה ל{backLabel}
        </Link>
      </div>
    </section>
  );
}
