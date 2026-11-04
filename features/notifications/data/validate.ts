// Input checks for notification commands, shared by every implementation (simulated now, the
// server later; the server always re-validates). Each returns a Hebrew error, or null when valid.
import { isUuid, MAX_PAGE_LIMIT } from "@/features/data-access/common";
import type { NotificationPreferences } from "./types";

/** Notification ids: fixture keys now, database UUIDs later. */
export const isNotificationId = (value: unknown): value is string =>
  isUuid(value) || (typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value));

export function notificationIdsError(ids: readonly string[]): string | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PAGE_LIMIT) return "בחירת התראות לא תקינה";
  return ids.every(isNotificationId) ? null : "התראה לא תקינה";
}

export function notificationPreferencesError(prefs: NotificationPreferences): string | null {
  return typeof prefs?.newOrChange === "boolean" && typeof prefs.sound === "boolean" ? null : "הגדרות התראות לא תקינות";
}
