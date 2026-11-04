import Link from "next/link";

// Placeholder states of the office screens that phase E builds next (Settings tabs, "ניהול
// משתמשים"): every link resolves now, and the page says what will be there. The "אין הרשאה" state
// follows CalendarNoAccess / AnalyticsNoAccess (card + .empty). Display only (G-04): real
// enforcement is on the server and in the database.

/** "בבנייה": what the screen will show, as a short list. */
export function ScreenPlaceholder({ id, heading, items }: { id: string; heading: string; items: readonly string[] }) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>
          🛠️
        </span>
        <h2 id={id} style={{ fontSize: 18, color: "var(--ink)" }}>
          {heading}
        </h2>
        <p style={{ margin: 0 }}>המסך בבנייה. מה יופיע כאן:</p>
        <ul style={{ margin: 0, paddingInlineStart: 20, maxWidth: 560, textAlign: "start", lineHeight: 1.6 }}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

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
