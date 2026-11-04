// Notifications port. `userId` is a filter; production reads the signed-in user's notifications
// only (session + RLS).
import type { Page, PageRequest } from "@/features/data-access/common";
import type { AppNotification } from "./types";

export interface NotificationsQueries {
  /** Newest first, paged (default 40, at most 100). */
  list(userId: string, page?: PageRequest): Promise<Page<AppNotification>>;
  unreadCount(userId: string): Promise<number>;
}
