import Link from "next/link";

// "אין הרשאה" on a real Settings screen for a role it is not offered to (Step 2; Customer Service
// on the user management, D60 (7)). Same look as the other no-access states (AnalyticsNoAccess,
// CalendarNoAccess: card + .empty). No hooks; no account data is read for it. Display only (G-04):
// the page decides on the server, and every action is refused on the server and in the database.
export function SettingsNoAccess({ text, backHref, backLabel }: { text: string; backHref: string; backLabel: string }) {
  return (
    <section className="card" aria-labelledby="set-no-access">
      <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ fontSize: 28 }}>
          🔒
        </span>
        <h2 id="set-no-access" style={{ fontSize: 18, color: "var(--ink)" }}>
          אין הרשאה
        </h2>
        <p style={{ margin: 0, maxWidth: 460, lineHeight: 1.5 }}>{text}</p>
        <Link className="btn" href={backHref} prefetch={false}>
          <span aria-hidden="true">› </span>
          חזרה ל{backLabel}
        </Link>
      </div>
    </section>
  );
}
