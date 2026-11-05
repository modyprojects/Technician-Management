import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AnalyticsGeneral } from "@/components/office/AnalyticsGeneral";
import { AnalyticsNoAccess } from "@/components/office/AnalyticsNoAccess";
import { AnalyticsProducts } from "@/components/office/AnalyticsProducts";
import { AnalyticsTabs } from "@/components/office/AnalyticsTabs";
import { AnalyticsTechDetail } from "@/components/office/AnalyticsTechDetail";
import { AnalyticsTechnicians } from "@/components/office/AnalyticsTechnicians";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { callsListHref } from "@/features/calls/data/search-params";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import type { TechnicianVisitFilter } from "@/features/dashboards/data/types";
import { offers } from "@/features/reference/data/permissions";
import type { TechnicianId } from "@/features/reference/data/types";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { demoLandingBack, isOfficeRole, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { ANALYTICS_TABS, analyticsHref, monthOf, parseAnalyticsState, type AnalyticsTab } from "./_state";

// Every office role is listed: the customer-service URL renders the "אין הרשאה" state instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/analytics">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `דשבורד · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** Id of the "נתוני בדיקה" note; KPI groups point at it (SIM-13). */
const TEST_NOTE_ID = "ma-test-note";

// Manager dashboards (docs/demo.html offDash(), L860-935; screen 9, part 2): tabs כללי / טכנאים /
// מוצרים וספקים and the technician drill-down, for the month of the demo's today. Reads only
// through the data-access layer: reference.permissions(role) decides which tabs the screen offers
// (display only, deny by default; enforcement is on the server and in the database, G-04),
// dashboards.managerAnalytics(period) feeds the tabs and dashboards.technicianDetail(id, period,
// {filter, page}) the drill-down. The URL (?tab=&tech=&filter=&page=) holds the view, so every tab,
// technician and filter is a real link. No dashboard data is loaded for a role without access.
export default async function OfficeAnalyticsPage({
  params,
  searchParams,
}: PageProps<"/dev/demo/office/[role]/analytics">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);

  const offered = ANALYTICS_TABS.filter((t) => offers(permissions, t.permission));
  if (!offered.length) {
    return (
      <DemoOfficeFrame role={role} active="analytics">
        <div className="ptitle">
          <div>
            <h1>דשבורד</h1>
          </div>
        </div>
        <AnalyticsNoAccess {...demoLandingBack(role, permissions)} />
      </DemoOfficeFrame>
    );
  }

  const state = parseAnalyticsState(await searchParams);
  const tab: AnalyticsTab = offered.some((t) => t.key === state.tab) ? state.tab : (offered[0]?.key ?? "gen");
  const canDrill = offers(permissions, "dashTech");
  const drillTech = canDrill ? state.tech : null;
  const month = monthOf(TODAY);
  const base = demoHref.analytics(role);

  const techHref = (id: TechnicianId, filter: TechnicianVisitFilter = "all") => analyticsHref(base, { tab, tech: id, filter });
  const callHref = (req: string) => demoHref.call(role, req);
  const backHref = analyticsHref(base, { tab });

  const tabs = offered.map((t) => ({
    key: t.key,
    label: t.label,
    href: analyticsHref(base, { tab: t.key }),
    on: t.key === tab,
    current: t.key === tab && !drillTech,
  }));

  let body: ReactNode;
  let includesTestData = false;
  if (drillTech) {
    const [detail, technicians] = await Promise.all([
      // The demo lists all the technician's visits of the month in one table: one page of up to
      // MAX_PAGE_LIMIT rows keeps that for a month and stays bounded for longer periods.
      demoDataAccess.dashboards.technicianDetail(drillTech, month.period, {
        filter: state.filter,
        page: state.page,
        limit: MAX_PAGE_LIMIT,
      }),
      demoDataAccess.reference.technicians(),
    ]);
    if (detail) {
      includesTestData = detail.includesTestData;
      body = (
        <AnalyticsTechDetail
          detail={detail}
          technicians={technicians.filter((t) => t.active)}
          today={TODAY}
          periodName={month.name}
          backHref={backHref}
          techHref={techHref}
          filterHref={(filter) => analyticsHref(base, { tab, tech: drillTech, filter })}
          pageHref={(page) => analyticsHref(base, { tab, tech: drillTech, filter: detail.filter, page })}
          callHref={callHref}
          describedBy={includesTestData ? TEST_NOTE_ID : undefined}
        />
      );
    } else {
      body = (
        <section className="card">
          <div className="empty">
            הטכנאי לא נמצא.{" "}
            <Link className="lnk" href={backHref} prefetch={false}>
              חזרה לדשבורד
            </Link>
          </div>
        </section>
      );
    }
  } else {
    const analytics = await demoDataAccess.dashboards.managerAnalytics(month.period);
    includesTestData = analytics.includesTestData;
    body =
      tab === "tech" ? (
        <AnalyticsTechnicians technicians={analytics.technicians} techHref={techHref} />
      ) : tab === "prod" ? (
        <AnalyticsProducts products={analytics.products} />
      ) : (
        <AnalyticsGeneral
          general={analytics.general}
          techHref={canDrill ? (id) => techHref(id) : null}
          callHref={callHref}
          followupsHref={
            offers(permissions, "calls")
              ? callsListHref(demoHref.calls(role), { q: "", status: "followup", tech: "all", page: 1 })
              : undefined
          }
          describedBy={includesTestData ? TEST_NOTE_ID : undefined}
        />
      );
  }

  return (
    <DemoOfficeFrame role={role} active="analytics">
      <div className="ptitle">
        <div>
          <h1>דשבורד</h1>
          <div className="sub">{month.label} · מחושב מנתוני ההדגמה</div>
        </div>
        {offers(permissions, "export") && (
          // TODO(OF-14): no exports port yet (XLSX export is pending a decision). When it exists,
          // this becomes a command through useCommands() / an authorized server route, and data-sim
          // goes (data-sim stays only for navigation affordances such as dial and Waze).
          <button type="button" className="btn" data-sim="ייצוא ל-Excel ממתין להחלטה · לא נוצר קובץ">
            ייצוא ל-Excel
          </button>
        )}
      </div>
      {includesTestData && <DashboardTestNote id={TEST_NOTE_ID} />}
      <AnalyticsTabs tabs={tabs} />
      {body}
    </DemoOfficeFrame>
  );
}
