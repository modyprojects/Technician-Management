import Link from "next/link";
import type { CSSProperties } from "react";
import { BellIcon } from "@/components/ui/Icons";

const BELL_STYLE: CSSProperties = {
  position: "relative",
  border: 0,
  background: "var(--ink2)",
  color: "var(--on-dark)",
  width: 36,
  height: 36,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
};

// Technician home header (demo techHome() head, TE-01): date, greeting, avatar, bell, counters.
// The bell and "הושלמו ›" are links when their screens exist (notifications, completed visits).
// Until then the caller passes `unavailable` attributes (the UI demo: data-sim, so a click says the
// screen is not part of the demo) instead of leaving dead buttons.
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
  unavailable,
}: {
  dateLine: string;
  greeting: string;
  initial: string;
  avatarColor: string;
  unread: number;
  visitsToday: number;
  completed: number;
  /** Notifications screen; without it the bell is a button carrying `unavailable`. */
  notificationsHref?: string;
  /** Completed-visits list ("הושלמו היום", TE-26); without it the counter is a button carrying `unavailable`. */
  completedHref?: string;
  /** Attributes for the bell and "הושלמו ›" while their screens do not exist (e.g. data-sim). */
  unavailable?: Record<`data-${string}`, string>;
}) {
  const bellLabel = unread ? `התראות, ${unread} חדשות` : "התראות";
  const badge =
    unread > 0 ? (
      <span
        className="num"
        style={{
          position: "absolute",
          top: -3,
          left: -3,
          background: "var(--danger)",
          color: "var(--on-dark)",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          minWidth: 18,
          height: 18,
          padding: "0 4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {unread}
      </span>
    ) : null;
  const completedBody = (
    <>
      <b className="num">{completed}</b>
      <span>הושלמו ›</span>
    </>
  );
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
          {notificationsHref ? (
            <Link href={notificationsHref} aria-label={bellLabel} style={BELL_STYLE}>
              <BellIcon />
              {badge}
            </Link>
          ) : (
            <button type="button" aria-label={bellLabel} style={BELL_STYLE} {...unavailable}>
              <BellIcon />
              {badge}
            </button>
          )}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div className="stat">
          <b className="num">{visitsToday}</b>
          <span>ביקורים היום</span>
        </div>
        {completedHref ? (
          <Link href={completedHref} className="stat">
            {completedBody}
          </Link>
        ) : (
          <button type="button" className="stat" {...unavailable}>
            {completedBody}
          </button>
        )}
      </div>
    </>
  );
}
