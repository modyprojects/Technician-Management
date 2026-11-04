// Notifications port. `userId` is a filter; production reads the signed-in user's notifications
// only (session + RLS).
import type { AppNotification } from "./types";

export interface NotificationsQueries {
  /** Newest first. */
  list(userId: string): Promise<AppNotification[]>;
  unreadCount(userId: string): Promise<number>;
}
