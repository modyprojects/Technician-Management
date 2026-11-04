import Link from "next/link";
import { DashboardSection } from "@/components/office/DashboardSection";
import { DashboardStatusBar } from "@/components/office/DashboardStatusBar";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { TechLanes } from "@/components/office/TechLanes";
import { WorkQueueCalls } from "@/components/office/WorkQueueCalls";
import { offersAnyDashboard } from "@/features/reference/data/permissions";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { demoHref } from "../../_data/routes";
import { HomeTitle, homeLinks } from "./_HomeParts";

const TEST_NOTE_ID = "od-test-note";

// Manager office home ("לוח בקרה", screen 9 part 1): today at a glance. Ported from the demo's
// dashGen() (L867-890: KPI tiles, "עכשיו בשטח" cards, "המשך טיפול – הכי ותיקים" table) and
// offCal() (L752-814: status colours, legend and the per-technician day), for one date.
// Reads only through the data-access layer: dashboards.officeOverview(TODAY), calls.list (the
// open-calls count, statusCounts) and reference.permissions(role) (the analytics link; display
// only, G-04). No data actions on this screen: every interaction is a link.
export async function ManagerHome({ role }: { role: OfficeRole }) {
  const [overview, calls, permissions] = await Promise.all([
    demoDataAccess.dashboards.officeOverview(TODAY),
    demoDataAccess.calls.list({ statuses: ["open"], limit: 1 }),
    demoDataAccess.reference.permissions(role),
  ]);
  const links = homeLinks(role);
  const k = overview.kpis;

  const tiles: KpiTile[] = [
    { key: "visits", label: "ביקורים היום", metric: k.visitsToday, detail: "לא כולל ביקורים שבוטלו" },
    { key: "field", label: "בשטח עכשיו", metric: k.inFieldNow, detail: "בדרך או בטיפול" },
    {
      key: "completed",
      label: "הושלמו היום",
      metric: k.completedToday,
      color: "var(--s-done)",
      detail: k.visitsToday.value != null ? `מתוך ${k.visitsToday.value} ביקורים` : undefined,
    },
    {
      key: "open",
      label: "קריאות פתוחות",
      metric: { value: calls.statusCounts.open, unit: "count" },
      detail: "עם ביקור מתוכנן או פעיל",
      href: links.callsWith("open"),
    },
    {
      key: "followup",
      label: "המשך טיפול פתוחים",
      metric: k.openFollowups,
      color: "var(--s-cont)",
      detail: "ללא ביקור חדש",
      href: links.callsWith("followup"),
    },
    {
      key: "awaiting",
      label: "ממתינות לשיבוץ",
      metric: k.awaitingScheduling,
      color: "var(--warn-fg)",
      detail: "כל הביקורים בוטלו",
      href: links.callsWith("awaiting"),
    },
  ];

  return (
    <>
      <HomeTitle
        title="לוח בקרה"
        date={overview.date}
        sub="הטכנאים והקריאות היום"
        actions={
          <>
            <Link className="btn" href={links.calls()}>
              לכל הקריאות ›
            </Link>
            {offersAnyDashboard(permissions) && (
              <Link className="btn pri" href={demoHref.analytics()}>
                לדשבורדים ›
              </Link>
            )}
          </>
        }
      />
      {overview.includesTestData && <DashboardTestNote id={TEST_NOTE_ID} />}
      <KpiGrid label="מדדי היום" describedBy={overview.includesTestData ? TEST_NOTE_ID : undefined} tiles={tiles} />
      <DashboardSection id="od-status" title="ביקורים היום לפי סטטוס" count={k.visitsToday.value ?? undefined}>
        <DashboardStatusBar visits={overview.lanes.flatMap((lane) => lane.visits)} />
      </DashboardSection>
      <DashboardSection id="od-field" title="עכשיו בשטח" hint="לחיצה על ביקור פותחת את כרטיס הקריאה">
        <TechLanes lanes={overview.lanes} callHref={links.call} />
      </DashboardSection>
      <DashboardSection
        id="od-attention"
        flush
        title="דורשות טיפול"
        count={overview.attention.total}
        hint="המשך טיפול ללא ביקור חדש, וקריאות שכל הביקורים בהן בוטלו · הוותיקות קודם"
      >
        <WorkQueueCalls
          list={overview.attention}
          callHref={links.call}
          label="קריאות שדורשות טיפול"
          emptyText="אין קריאות שמחכות לטיפול"
          footer={
            <>
              <Link className="lnk" href={links.callsWith("followup")}>
                כל קריאות המשך הטיפול ›
              </Link>
              <Link className="lnk" href={links.callsWith("awaiting")}>
                כל הממתינות לשיבוץ ›
              </Link>
            </>
          }
        />
      </DashboardSection>
    </>
  );
}
