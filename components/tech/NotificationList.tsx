"use client";

// The technician's notifications (docs/demo.html techNotifs() L644-656; TE-28 CHANGE: in-app
// only, created by events: new visit, follow-up, change, cancel; no scheduled pickup reminder,
// D25). Unread items under "חדשות · N" on the accent tint with a dot, read items under
// "קודמות", newest first; each with the kind's icon and colour (the demo's NK map, without
// "collect"), title, time and detail line; "אין התראות" when there are none; the demo's hint
// line at the bottom.
// Each item is a link to what it is about (the demo's openNotif opened the visit card); opening
// an unread one also marks it read (NotificationsProvider). A failed command shows its error
// here.
// Addition: 🧪 badge on test notifications (D47). Needs NotificationsProvider above it.
// Presentational: the caller passes the DTOs with their links and formatted times.
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import type { AppNotification, NotificationKind } from "@/features/notifications/data/types";
import { useNotificationState } from "./NotificationState";

export type NotificationEntry = {
  notification: AppNotification;
  /** Where the item leads: the visit card, or the technician's day when there is no visit. */
  href: string;
  /** The time as the screen shows it ("אתמול 17:05"). */
  timeLabel: string;
};

/** Icon and circle colour per kind (demo NK, L639). */
const KINDS: Record<NotificationKind, { icon: string; bg: string }> = {
  new: { icon: "🆕", bg: "var(--s-new-bg)" },
  follow: { icon: "↻", bg: "var(--s-cont-bg)" },
  change: { icon: "🕑", bg: "var(--s-go-bg)" },
  cancel: { icon: "✕", bg: "var(--danger-bg)" },
};

const HEADING_STYLE = { fontFamily: "var(--body)", fontWeight: 700 } as const;

function NotificationItem({ entry, unread }: { entry: NotificationEntry; unread: boolean }) {
  const { markOpened } = useNotificationState();
  const { notification: n, href, timeLabel } = entry;
  const kind = KINDS[n.kind];
  return (
    <Link href={href} className={unread ? "tnp-item unread" : "tnp-item"} onClick={() => markOpened(n)}>
      <span aria-hidden="true" className="tnp-icon" style={{ background: kind.bg }}>
        {kind.icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>{n.title}</b>
            {n.isTest && (
              <>
                {" "}
                <TestBadge />
              </>
            )}
          </span>
          <time className="sub num" dateTime={n.time} style={{ whiteSpace: "nowrap", fontSize: 12 }}>
            {timeLabel}
          </time>
        </span>
        <span className="sub" style={{ display: "block", marginTop: 2, color: "var(--ink2)" }}>
          {n.sub}
        </span>
      </span>
      {unread && <span aria-hidden="true" className="dot" style={{ background: "var(--accent)", marginTop: 6 }} />}
    </Link>
  );
}

function NotificationGroup({ title, entries, unread }: { title: string; entries: NotificationEntry[]; unread: boolean }) {
  const headingId = useId();
  return (
    <>
      <h2 id={headingId} className="sub num" style={HEADING_STYLE}>
        {title}
      </h2>
      <section className="card" aria-labelledby={headingId} style={{ overflow: "hidden", flex: "none" }}>
        <ul className="tnp-list">
          {entries.map((entry) => (
            <li key={entry.notification.id}>
              <NotificationItem entry={entry} unread={unread} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function NotificationList({ entries, pager }: { entries: readonly NotificationEntry[]; pager?: ReactNode }) {
  const { isUnread, error } = useNotificationState();
  const fresh = entries.filter((e) => isUnread(e.notification));
  const earlier = entries.filter((e) => !isUnread(e.notification));
  return (
    <>
      {error && (
        <div
          role="alert"
          className="note"
          style={{ background: "var(--danger-bg)", borderColor: "var(--danger-line)", color: "var(--danger-fg)" }}
        >
          {error}
        </div>
      )}
      {fresh.length > 0 && <NotificationGroup title={`חדשות · ${fresh.length}`} entries={fresh} unread />}
      {earlier.length > 0 && <NotificationGroup title="קודמות" entries={earlier} unread={false} />}
      {entries.length === 0 && <div className="empty">אין התראות</div>}
      {pager}
      <div className="sub" style={{ textAlign: "center" }}>
        לחיצה על התראה פותחת את הקריאה. אילו התראות נשלחות קובעים בהגדרות ← מיילים והתראות.
      </div>
    </>
  );
}
