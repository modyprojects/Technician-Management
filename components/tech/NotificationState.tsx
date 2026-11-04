"use client";

// Read state of the technician's notifications screen (docs/demo.html techNotifs() L644-656,
// openNotif and readAll L1133-1134; TE-28). The header ("סמן הכל כנקרא") and the list share it,
// so the provider wraps the whole screen.
// - Opening a notification runs useCommands().notifications.markRead([id]); the item counts as
//   read at once and is restored when the command fails.
// - "סמן הכל כנקרא" runs notifications.markAllRead(); when it succeeds every item moves to
//   "קודמות". In the UI demo both commands are simulated (the provider's toast says nothing was
//   saved), so the read state lives only on this screen (G-02).
// Generic: AppNotification DTOs, no demo or fixture knowledge.
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { AppNotification } from "@/features/notifications/data/types";

const FAILED = "הסימון לא נשמר. נסה שוב.";

type NotificationReadState = {
  /** The notification is unread on this screen. */
  isUnread(n: AppNotification): boolean;
  /** Unread notifications left, on every page. */
  unreadLeft: number;
  /** Marks an opened notification as read (no-op when it already is). */
  markOpened(n: AppNotification): void;
  /** "סמן הכל כנקרא"; resolves to true when it succeeded. */
  markAll(): Promise<boolean>;
  /** "סמן הכל כנקרא" is running. */
  markingAll: boolean;
  /** Hebrew error of the last failed command, or null. */
  error: string | null;
};

const NotificationReadContext = createContext<NotificationReadState | null>(null);

export function useNotificationState(): NotificationReadState {
  const state = use(NotificationReadContext);
  if (!state) throw new Error("useNotificationState() needs a <NotificationsProvider>.");
  return state;
}

export function NotificationsProvider({
  unreadTotal,
  children,
}: {
  /** Unread notifications of the signed-in user (notifications.unreadCount), on every page. */
  unreadTotal: number;
  children: ReactNode;
}) {
  const { notifications } = useCommands();
  // Ids marked read on this screen (all of them were unread before).
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const isUnread = useCallback(
    (n: AppNotification): boolean => !n.read && !allRead && !readIds.has(n.id),
    [allRead, readIds],
  );

  const markOpened = useCallback(
    (n: AppNotification): void => {
      if (!isUnread(n)) return;
      const restore = (message: string) => {
        setReadIds((s) => {
          const next = new Set(s);
          next.delete(n.id);
          return next;
        });
        setError(message);
      };
      setReadIds((s) => new Set(s).add(n.id));
      setError(null);
      notifications.markRead([n.id]).then(
        (result) => {
          if (!result.ok) restore(result.error);
        },
        () => restore(FAILED),
      );
    },
    [isUnread, notifications],
  );

  const markAll = useCallback(async (): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setMarkingAll(true);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await notifications.markAllRead();
      if (!result.ok) failure = result.error;
    } catch {
      failure = FAILED;
    } finally {
      running.current = false;
      setMarkingAll(false);
    }
    if (failure) {
      setError(failure);
      return false;
    }
    setAllRead(true);
    return true;
  }, [notifications]);

  const value = useMemo<NotificationReadState>(
    () => ({
      isUnread,
      unreadLeft: allRead ? 0 : Math.max(0, unreadTotal - readIds.size),
      markOpened,
      markAll,
      markingAll,
      error,
    }),
    [isUnread, allRead, unreadTotal, readIds, markOpened, markAll, markingAll, error],
  );

  return <NotificationReadContext value={value}>{children}</NotificationReadContext>;
}
