"use client";

// Header of the technician's notifications (docs/demo.html techNotifs() head L650; TE-28):
// "› חזרה", the title and, while anything is unread, "סמן הכל כנקרא" (an action: a button that
// runs notifications.markAllRead() through NotificationsProvider). When it succeeds the button
// goes away, so focus moves to the title instead of being lost.
// Every top-level element is its own child of .ph-head, so above 900px it aligns with the 760px
// content column (TE-31). Needs NotificationsProvider above it.
import Link from "next/link";
import { useRef } from "react";
import { useNotificationState } from "./NotificationState";

export function NotificationHeader({ backHref }: { backHref: string }) {
  const { unreadLeft, markAll, markingAll } = useNotificationState();
  const titleRef = useRef<HTMLHeadingElement>(null);

  async function onMarkAll() {
    if (markingAll) return;
    if (await markAll()) titleRef.current?.focus();
  }

  return (
    <>
      <div>
        <Link className="ph-back" href={backHref} aria-label="חזרה למסך היום">
          <span aria-hidden="true">› </span>
          חזרה
        </Link>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
        <h1 ref={titleRef} tabIndex={-1} style={{ fontSize: 22 }}>
          התראות
        </h1>
        {unreadLeft > 0 && (
          <button
            type="button"
            className="ph-back"
            onClick={() => void onMarkAll()}
            aria-disabled={markingAll || undefined}
            style={{ fontSize: 13, minHeight: 24, whiteSpace: "nowrap" }}
          >
            {markingAll ? "מסמן…" : "סמן הכל כנקרא"}
          </button>
        )}
      </div>
    </>
  );
}
