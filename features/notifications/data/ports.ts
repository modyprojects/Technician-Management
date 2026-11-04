// Notifications ports. `userId` is a filter; production reads the signed-in user's notifications
// only (session + RLS), and the commands act on the signed-in user's own notifications only.
import type { CommandResult, Page, PageRequest } from "@/features/data-access/common";
import type { AppNotification, NotificationPreferences } from "./types";

export interface NotificationsQueries {
  /** Newest first, paged (default 40, at most 100). The screen splits unread ("חדשות") and read ("קודמות"). */
  list(userId: string, page?: PageRequest): Promise<Page<AppNotification>>;
  unreadCount(userId: string): Promise<number>;
  /** The user's notification settings (profile toggles, TE-29); defaults when never set. */
  preferences(userId: string): Promise<NotificationPreferences>;
}

/** The signed-in user's actions on his notifications. Results say whether they were simulated. */
export interface NotificationCommands {
  /** Marks notifications as read (opening one, demo openNotif); at most MAX_PAGE_LIMIT ids. */
  markRead(ids: readonly string[]): Promise<CommandResult>;
  /** "סמן הכל כנקרא" (demo readAll). */
  markAllRead(): Promise<CommandResult>;
  /** Saves the profile toggles (TE-29: they persist per user). */
  setPreferences(prefs: NotificationPreferences): Promise<CommandResult>;
}
