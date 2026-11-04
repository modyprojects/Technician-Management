import type { Metadata } from "next";
import { NotificationHeader } from "@/components/tech/NotificationHeader";
import { NotificationList, type NotificationEntry } from "@/components/tech/NotificationList";
import { NotificationsProvider } from "@/components/tech/NotificationState";
import { Pager } from "@/components/ui/Pager";
import { clampPage } from "@/features/data-access/common";
import type { AppNotification } from "@/features/notifications/data/types";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { demoDataAccess } from "../../_data/adapter";
import { notificationTimeLabel } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

export const metadata: Metadata = { title: "התראות · טכנאי · הדגמה" };

/**
 * Where a notification leads (demo openNotif, L1134): its visit card. Without a visit, as in the
 * demo, the technician's day; a cancelled visit is not on the technician's screens (the visit
 * card serves no cancelled visit), so a cancellation also leads to the day.
 */
const hrefOf = (n: AppNotification): string =>
  n.visit && n.kind !== "cancel" ? demoHref.visit(n.visit.req, n.visit.n) : demoHref.tech();

// Technician notifications, opened from the bell (docs/demo.html techNotifs() L644-656; TE-28:
// in-app only, created by events, no scheduled pickup reminder, D25). Reads only through the
// data-access layer: notifications.list(DEMO_TECHNICIAN_ID, { page }) (paged, newest first; 40 per page, `?page=` from page 2) and
// notifications.unreadCount(DEMO_TECHNICIAN_ID) (G-03: production takes the user from the
// session). The list splits into "חדשות" and "קודמות"; opening an item marks it read and opens its
// visit card; "סמן הכל כנקרא" marks every notification read. Both run through
// useCommands().notifications (markRead, markAllRead) and are simulated in the demo, so the read
// state lasts only while this screen is open (G-02).
export default async function TechNotificationsPage({ searchParams }: PageProps<"/dev/demo/tech/notifications">) {
  const { page } = await searchParams;
  const [list, unread] = await Promise.all([
    demoDataAccess.notifications.list(DEMO_TECHNICIAN_ID, { page: clampPage(page) }),
    demoDataAccess.notifications.unreadCount(DEMO_TECHNICIAN_ID),
  ]);
  const entries: NotificationEntry[] = list.items.map((n) => ({
    notification: n,
    href: hrefOf(n),
    timeLabel: notificationTimeLabel(n.time),
  }));
  return (
    <NotificationsProvider unreadTotal={unread}>
      <DemoTechFrame activeTab="home" activeIsCurrent={false} head={<NotificationHeader backHref={demoHref.tech()} />}>
        <NotificationList
          entries={entries}
          pager={
            <Pager
              page={list.page}
              pageCount={list.pageCount}
              prevHref={list.page > 1 ? demoHref.techNotifications(list.page - 1) : null}
              nextHref={list.page < list.pageCount ? demoHref.techNotifications(list.page + 1) : null}
              label="עמודי ההתראות"
            />
          }
        />
      </DemoTechFrame>
    </NotificationsProvider>
  );
}
