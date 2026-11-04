// FICTITIOUS DATA ONLY: the technician's in-app notifications. Allowed only under app/dev (G-05).
// From docs/demo.html freshState().notifs (L326-331) without the 07:00 "מה לאסוף" reminder:
// v1 has no scheduled pickup reminder (demo-deviations TE-28, D25). Client-safe.
// Times are ISO timestamps: the demo's "אתמול HH:MM" is 20.10.2026 (Israel summer time, +03:00);
// the screen formats them (dates.ts notificationTimeLabel).
import type { DemoNotification, NotificationKind } from "./types";

export const NOTIFICATIONS: readonly DemoNotification[] = [
  { id: 3, kind: "new", title: "קריאה חדשה שובצה לך", sub: "דניאל רז · נס ציונה · חמישי 22.10 · 13:00", at: "2026-10-20T17:05:00+03:00", req: "48252", n: 1, read: false },
  { id: 2, kind: "new", title: "קריאה חדשה שובצה לך", sub: "מרים אלון · רחובות · חמישי 22.10 · 09:00", at: "2026-10-20T16:40:00+03:00", req: "48251", n: 1, read: false },
  { id: 1, kind: "follow", title: "נקבע ביקור המשך", sub: "אבי כהן · נס ציונה · היום 11:30 · ביקור 2", at: "2026-10-20T15:10:00+03:00", req: "48205", n: 2, read: true },
];

/** Icon and circle background per kind (the demo's NK map, without "collect"). */
export const NOTIFICATION_KINDS: Record<NotificationKind, { icon: string; bg: string }> = {
  new: { icon: "🆕", bg: "var(--s-new-bg)" },
  follow: { icon: "↻", bg: "var(--s-cont-bg)" },
  change: { icon: "🕑", bg: "var(--s-go-bg)" },
  cancel: { icon: "✕", bg: "var(--danger-bg)" },
};

export const unreadCount = (list: readonly DemoNotification[] = NOTIFICATIONS): number => list.filter((x) => !x.read).length;
