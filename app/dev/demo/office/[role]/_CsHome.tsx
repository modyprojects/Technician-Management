import Link from "next/link";
import { DashboardSection } from "@/components/office/DashboardSection";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { TechLanes } from "@/components/office/TechLanes";
import { WorkQueueCalls } from "@/components/office/WorkQueueCalls";
import { WorkQueueClosed } from "@/components/office/WorkQueueClosed";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { HomeTitle, homeLinks } from "./_HomeParts";

// Customer-service office home ("בית", screen 9 part 1): the work queue for one date. Lists only
// what customer service works with (no analytics KPIs; the dashboards are the manager's, D33
// defaults): calls awaiting a new invitation, follow-ups that need a new visit, today's visits by
// technician (read-only, like the calendar, matrix key `cal`) and visits closed recently, so the
// customer can be told. Every item links to the call card. Reads only through the data-access
// layer: dashboards.csQueue(TODAY). No data actions here: scheduling is done in Outlook (OF-03).
export async function CsHome({ role }: { role: OfficeRole }) {
  const queue = await demoDataAccess.dashboards.csQueue(TODAY);
  const links = homeLinks(role);
  const visitsToday = queue.todayByTechnician.reduce((n, lane) => n + lane.total, 0);

  const jumps = [
    { id: "cs-awaiting", label: "ממתינות לשיבוץ", count: queue.awaitingScheduling.total },
    { id: "cs-followups", label: "המשך טיפול", count: queue.followupsNeedingVisit.total },
    { id: "cs-today", label: "ביקורים היום", count: visitsToday },
    { id: "cs-closed", label: "נסגרו לאחרונה", count: queue.recentlyClosed.total },
  ];

  return (
    <>
      <HomeTitle
        title="בית"
        date={queue.date}
        sub="מה מחכה לטיפול שירות הלקוחות"
        actions={
          <Link className="btn" href={links.calls()}>
            לכל הקריאות ›
          </Link>
        }
      />
      {queue.includesTestData && <DashboardTestNote />}
      <nav className="od-jump" aria-label="מעבר לרשימה">
        {jumps.map((j) => (
          <a key={j.id} className="chip" href={`#${j.id}`}>
            {j.label}{" "}
            <span className="num" style={{ opacity: 0.6 }}>
              {j.count}
            </span>
          </a>
        ))}
      </nav>
      <DashboardSection
        id="cs-awaiting"
        flush
        title="ממתינות לשיבוץ"
        count={queue.awaitingScheduling.total}
        hint="כל הביקורים בקריאה בוטלו · לתיאום מועד חדש ולשליחת זימון מ-Outlook"
      >
        <WorkQueueCalls
          list={queue.awaitingScheduling}
          callHref={links.call}
          label="קריאות שממתינות לשיבוץ"
          sinceHeader="ממתינה"
          emptyText="אין קריאות שממתינות לשיבוץ"
          footer={
            <Link className="lnk" href={links.callsWith("awaiting")}>
              לרשימה המלאה ›
            </Link>
          }
        />
      </DashboardSection>
      <DashboardSection
        id="cs-followups"
        flush
        title="המשך טיפול – צריך ביקור חדש"
        count={queue.followupsNeedingVisit.total}
        hint="חזרו מהשטח בלי ביקור חדש · הוותיקות קודם · ביקור חדש נקבע בזימון מ-Outlook"
      >
        <WorkQueueCalls
          list={queue.followupsNeedingVisit}
          callHref={links.call}
          label="קריאות בהמשך טיפול שצריכות ביקור חדש"
          emptyText="אין קריאות בהמשך טיפול שמחכות לביקור"
          footer={
            <Link className="lnk" href={links.callsWith("followup")}>
              לרשימה המלאה ›
            </Link>
          }
        />
      </DashboardSection>
      <DashboardSection id="cs-today" title="ביקורים היום לפי טכנאי" count={visitsToday} hint="תצוגה בלבד · לחיצה על ביקור פותחת את כרטיס הקריאה">
        <TechLanes lanes={queue.todayByTechnician} callHref={links.call} />
      </DashboardSection>
      <DashboardSection
        id="cs-closed"
        flush
        title="נסגרו לאחרונה – לעדכון הלקוח"
        count={queue.recentlyClosed.total}
        hint="ביקורים שנסגרו היום וביום העבודה הקודם · החדשים קודם"
      >
        <WorkQueueClosed
          list={queue.recentlyClosed}
          today={queue.date}
          callHref={links.call}
          label="ביקורים שנסגרו לאחרונה"
          emptyText="לא נסגרו ביקורים היום וביום העבודה הקודם"
        />
      </DashboardSection>
    </>
  );
}
