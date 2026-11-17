import Link from "next/link";
import { TestPill } from "@/components/ui/TestBadge";
import { BellLink } from "./BellLink";

// Technician home header (demo techHome() head, TE-01): date, greeting, avatar, bell, counters.
// The bell (BellLink) opens the notifications (TE-28) and "הושלמו ›" the completed-visits list
// ("הושלמו היום", TE-26); both are links (navigation). The bell is shown only with a notifications
// screen to open: the real app has no notifications until Step 7 (TE-28, D25), so it shows none
// rather than a bell that leads nowhere (G-06).
export function TechHomeHeader({
  dateLine,
  greeting,
  isTest = false,
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
  /** The 🧪 badge of a test user beside the greeting (SIM-18). */
  isTest?: boolean;
  initial: string;
  avatarColor: string;
  /** Unread notifications; with `notificationsHref` only. */
  unread?: number;
  visitsToday: number;
  completed: number;
  /** Notifications screen (TE-28); without it no bell is shown. */
  notificationsHref?: string;
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
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <h1 style={{ fontSize: 22 }}>{greeting}</h1>
          {isTest && <TestPill />}
        </span>
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
          {notificationsHref && <BellLink href={notificationsHref} unread={unread ?? 0} />}
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
