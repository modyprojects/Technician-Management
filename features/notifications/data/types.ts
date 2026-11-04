// In-app notification DTOs (D10, TE-28: created by events; no scheduled reminders in v1, D25).
import type { TestMarker } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";

export type NotificationKind = "new" | "follow" | "change" | "cancel";

export type AppNotification = TestMarker & {
  id: string;
  kind: NotificationKind;
  title: string;
  sub: string;
  /** Display time, e.g. "אתמול 17:05" (production: an ISO timestamp formatted by the screen). */
  time: string;
  /** The visit it is about, if any. */
  visit: VisitRef | null;
  read: boolean;
};
