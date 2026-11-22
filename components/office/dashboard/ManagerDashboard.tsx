import type { ReactNode } from "react";
import { AnalyticsProducts } from "@/components/office/AnalyticsProducts";
import { AnalyticsTabs } from "@/components/office/AnalyticsTabs";
import { DashboardPeriodControls } from "@/components/office/DashboardPeriodControls";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import {
  SKELETON_AS_OF,
  SKELETON_PERMISSIONS,
  SKELETON_TECHNICIANS,
  skeletonGeneral,
  skeletonProducts,
  skeletonTechnician,
} from "@/features/dashboard/skeleton-data";
import { DASHBOARD_PERIOD_KINDS, isDashboardPeriodKind, resolveDashboardPeriod, type DashboardPeriodKind } from "@/features/dashboards/data/periods";
import { DEFAULT_TREND_MONTHS, isSkuSort, isTrendMonths, type SkuSort, type TrendMonths } from "@/features/dashboards/data/types";
import { DashboardGeneral } from "./DashboardGeneral";
import { DashboardTechnician } from "./DashboardTechnician";

// The real Manager / Creator "דשבורד" (D57; docs/design/manager-dashboard-spec.md), SKELETON on
// fake data (D81, approved under D96): the three tabs "כללי", "טכנאים", "מוצרים וספקים", built
// from the same presentational components as the /dev/demo dashboard, with the QA corrections 01
// (D60 (6)). Nothing is read from the database: every figure comes from
// features/dashboard/skeleton-data.ts and the screen says so ("נתוני בדיקה"). The URL only picks
// what is displayed (tab, chart range, technician, period, sort); anything unknown falls back.
// The tabs follow a HARD-CODED fake permission set (SKELETON_PERMISSIONS: dashGen / dashTech /
// dashProd all offered); the real screen takes the role's matrix values (display only, G-04). The
// caller (app/(office)/office/page.tsx) has already run the server guard.

export const DASHBOARD_PATH = "/office";

const TEST_NOTE_ID = "ma-test-note";

const TABS = [
  { key: "gen", label: "כללי", permission: "dashGen" },
  { key: "tech", label: "טכנאים", permission: "dashTech" },
  { key: "prod", label: "מוצרים וספקים", permission: "dashProd" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PERIOD_LABELS: Readonly<Record<DashboardPeriodKind, string>> = { day: "יום", week: "שבוע", month: "חודש", year: "שנה", custom: "מותאם" };

const LEGEND = "\"—\" אין מספיק נתונים · \"לא זמין\" אין נתון מובנה · נתונים חסרים אינם נחשבים כאפס";

type SearchValue = string | string[] | undefined;
const one = (v: SearchValue): string | undefined => (Array.isArray(v) ? v[0] : v);

type View = { tab: TabKey; months: TrendMonths; tech: string; period: DashboardPeriodKind; sort: SkuSort };

/** What the URL asks to display; unknown values fall back to the defaults. */
function parseView(params: Readonly<Record<string, SearchValue>>, offered: readonly TabKey[]): View {
  const tab = TABS.find((t) => t.key === one(params.tab) && offered.includes(t.key))?.key ?? offered[0] ?? "gen";
  const months = Number(one(params.months));
  const tech = one(params.tech);
  const period = one(params.period);
  const sort = one(params.sort);
  return {
    tab,
    months: isTrendMonths(months) ? months : DEFAULT_TREND_MONTHS,
    tech: SKELETON_TECHNICIANS.some((t) => t.id === tech) ? (tech as string) : SKELETON_TECHNICIANS[0].id,
    period: isDashboardPeriodKind(period) ? period : "month",
    sort: isSkuSort(sort) ? sort : "calls-desc",
  };
}

function href(query: Readonly<Record<string, string | number>>): string {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const s = q.toString();
  return s ? `${DASHBOARD_PATH}?${s}` : DASHBOARD_PATH;
}

export function ManagerDashboard({ searchParams }: { searchParams: Readonly<Record<string, SearchValue>> }) {
  const offered = TABS.filter((t) => SKELETON_PERMISSIONS[t.permission]).map((t) => t.key);
  const view = parseView(searchParams, offered);

  const tabs = TABS.filter((t) => offered.includes(t.key)).map((t) => ({
    key: t.key,
    label: t.label,
    href: t.key === "gen" ? DASHBOARD_PATH : href({ tab: t.key }),
    on: t.key === view.tab,
    current: t.key === view.tab,
  }));

  let body: ReactNode;
  if (view.tab === "gen") {
    body = (
      <DashboardGeneral
        general={skeletonGeneral(view.months)}
        monthsHref={(months) => (months === DEFAULT_TREND_MONTHS ? DASHBOARD_PATH : href({ months }))}
        productsHref={offered.includes("prod") ? href({ tab: "prod" }) : null}
        describedBy={TEST_NOTE_ID}
      />
    );
  } else if (view.tab === "tech") {
    // Pure date arithmetic for the labels; the figures stay the same fake month in every period.
    const resolved = resolveDashboardPeriod({ kind: view.period }, SKELETON_AS_OF);
    const custom = resolved.kind === "custom";
    const dashboard = skeletonTechnician(view.tech);
    body = (
      <>
        <DashboardPeriodControls
          technicians={SKELETON_TECHNICIANS.map((t) => ({
            id: t.id,
            name: t.name,
            active: t.active,
            href: href({ tab: "tech", tech: t.id, period: view.period }),
          }))}
          selectedId={view.tech}
          periods={DASHBOARD_PERIOD_KINDS.map((k) => ({
            key: k,
            label: PERIOD_LABELS[k],
            href: href({ tab: "tech", tech: view.tech, period: k }),
            on: k === resolved.kind,
          }))}
          // Skeleton: no previous / next navigation yet (both shown dimmed).
          dateNav={custom ? null : { label: resolved.label, prevHref: null, nextHref: null }}
          custom={
            custom
              ? {
                  action: DASHBOARD_PATH,
                  hidden: { tab: "tech", tech: view.tech, period: "custom" },
                  from: resolved.from,
                  to: resolved.to,
                  max: SKELETON_AS_OF,
                  invalid: false,
                }
              : null
          }
        />
        {dashboard ? (
          <DashboardTechnician dashboard={dashboard} periodLabel={resolved.label} describedBy={TEST_NOTE_ID} />
        ) : (
          <div className="ma-card ma-empty">אין טכנאים להצגה</div>
        )}
      </>
    );
  } else {
    body = (
      <AnalyticsProducts
        products={skeletonProducts(view.sort)}
        detailHref={null}
        sortHref={(s) => href({ tab: "prod", sort: s })}
        pageHref={() => href({ tab: "prod", sort: view.sort })}
        describedBy={TEST_NOTE_ID}
      />
    );
  }

  return (
    <>
      <DashboardTestNote id={TEST_NOTE_ID}>נתונים מדומים לתצוגה בלבד · שלד המסך, ללא נתונים אמיתיים</DashboardTestNote>
      <AnalyticsTabs tabs={tabs} />
      <div className="ma-dash">{body}</div>
      <p className="sub ma-legend">{LEGEND}</p>
    </>
  );
}
