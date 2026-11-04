import Link from "next/link";
import { BellLink } from "./BellLink";

// Technician home header (demo techHome() head, TE-01): date, greeting, avatar, bell, counters.
// The bell (BellLink) opens the notifications (TE-28) and "הושלמו ›" the completed-visits list
// ("הושלמו היום", TE-26); both are links (navigation).
export function TechHomeHeader({
  dateLine,
  greeting,
  initial,
  avatarColor,
  unread,
  visitsToday,
  completed,
  notificationsHref,
  completedHref,
}: {
  dateLine: string;
  greeting: string;
  initial: string;
  avatarColor: string;
  unread: number;
  visitsToday: number;
  completed: number;
  /** Notifications screen (TE-28). */
  notificationsHref: string;
  /** Completed-visits list ("הושלמו היום", TE-26). */
  completedHref: string;
}) {
  return (
    <>
      <div className="sub" style={{ color: "var(--on-dark2)" }}>
        {dateLine}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 2,
        }}
      >
        <h1 style={{ fontSize: 22 }}>{greeting}</h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: avatarColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            {initial}
          </span>
          <BellLink href={notificationsHref} unread={unread} />
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div className="stat">
          <b className="num">{visitsToday}</b>
          <span>ביקורים היום</span>
        </div>
        <Link href={completedHref} className="stat">
          <b className="num">{completed}</b>
          <span>הושלמו ›</span>
        </Link>
      </div>
    </>
  );
}
