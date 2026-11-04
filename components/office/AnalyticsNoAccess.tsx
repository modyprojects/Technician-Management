import Link from "next/link";

// "אין הרשאה" state of the manager dashboards for a role whose matrix values offer no dashboard
// tab (dashGen / dashTech / dashProd; D33 defaults, temporary per D51). Wording adapted from the
// demo's empty office view (docs/demo.html L739: "להרשאה הזו אין מסכים פעילים..."). This only
// shapes the screen: real enforcement is on the server and in the database (G-04). A new state in
// the demo's visual language (card + .empty), pending the owner's visual review.
export function AnalyticsNoAccess({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <section className="card" aria-labelledby="ma-no-access">
      <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>
          🔒
        </span>
        <h2 id="ma-no-access" style={{ fontSize: 18, color: "var(--ink)" }}>
          אין הרשאה
        </h2>
        <p style={{ margin: 0, maxWidth: 460, lineHeight: 1.5 }}>
          לתפקיד הזה אין הרשאה לצפות בדשבורד. את ההרשאות קובע היוצר במטריצת ההרשאות שבהגדרות.
        </p>
        <Link className="btn" href={backHref} prefetch={false}>
          <span aria-hidden="true">› </span>
          חזרה ל{backLabel}
        </Link>
      </div>
    </section>
  );
}
