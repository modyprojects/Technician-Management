import Link from "next/link";

// "אין הרשאה" state of the office Settings tabs and "ניהול משתמשים" for a role the screen is not
// offered to (or a pointer to where the role finds it). Follows CalendarNoAccess /
// AnalyticsNoAccess (card + .empty). Display only (G-04): real enforcement is on the server and
// in the database.

/** "אין הרשאה" (or another heading) for a role the screen is not offered to, with a way back. */
export function NoAccessPlaceholder({
  id,
  text,
  backHref,
  backLabel,
  extra,
  heading = "אין הרשאה",
  icon = "🔒",
}: {
  id: string;
  text: string;
  backHref: string;
  backLabel: string;
  /** An optional second link (for example the Manager's "משתמשים" screen). */
  extra?: { href: string; label: string };
  heading?: string;
  icon?: string;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>
          {icon}
        </span>
        <h2 id={id} style={{ fontSize: 18, color: "var(--ink)" }}>
          {heading}
        </h2>
        <p style={{ margin: 0, maxWidth: 460, lineHeight: 1.5 }}>{text}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Link className="btn" href={backHref} prefetch={false}>
            <span aria-hidden="true">› </span>
            חזרה ל{backLabel}
          </Link>
          {extra && (
            <Link className="btn" href={extra.href} prefetch={false}>
              {extra.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
