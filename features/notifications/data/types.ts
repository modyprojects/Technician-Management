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

/**
 * The technician's notification settings (profile, TE-29 and SE-11): in-app only; they persist
 * per user. No morning pickup reminder (TE-28, D25). The sound plays only while the app is open
 * (no push).
 */
export type NotificationPreferences = {
  /** "זימון חדש או שינוי ביומן". */
  newOrChange: boolean;
  /** "צליל התראה". */
  sound: boolean;
};
