// In-app notification DTOs (D10, TE-28: created by events; no scheduled reminders in v1, D25).
import type { IsoTimestamp, TestMarker } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";

export type NotificationKind = "new" | "follow" | "change" | "cancel";

export type AppNotification = TestMarker & {
  id: string;
  kind: NotificationKind;
  title: string;
  sub: string;
  /** When the event happened (ISO timestamp); the screen formats it, e.g. "אתמול 17:05". */
  time: IsoTimestamp;
  /** The visit it is about, if any. */
  visit: VisitRef | null;
  read: boolean;
};
