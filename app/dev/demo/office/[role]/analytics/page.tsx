import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AnalyticsGeneral } from "@/components/office/AnalyticsGeneral";
import { AnalyticsNoAccess } from "@/components/office/AnalyticsNoAccess";
import { AnalyticsProducts } from "@/components/office/AnalyticsProducts";
import { AnalyticsTabs } from "@/components/office/AnalyticsTabs";
import { AnalyticsTechDetail } from "@/components/office/AnalyticsTechDetail";
import { AnalyticsTechnicians } from "@/components/office/AnalyticsTechnicians";
import { DashboardDetailDialog } from "@/components/office/DashboardDetailDialog";
import { DashboardDetailTable } from "@/components/office/DashboardDetailTable";
import { DashboardPeriodControls } from "@/components/office/DashboardPeriodControls";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { formatMetric } from "@/components/office/KpiGrid";
import { dayName, monthLabel, MONTH_NAMES } from "@/features/calendar/data/dates";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import {
  detailRowsOffered,
  METRIC_DEFINITIONS,
  NOT_ENTERED_LABEL,
  type DashboardMetricKey,
} from "@/features/dashboards/data/metric-definitions";
import { dateLabel, DASHBOARD_PERIOD_KINDS, monthOfDate, resolveDashboardPeriod, type DashboardPeriodKind } from "@/features/dashboards/data/periods";
import {
  NONE_GROUP_KEY,
  type AnalyticsPeriod,
  type BarRow,
  type GeneralDashboard,
  type Metric,
  type ProductDashboard,
  type TechnicianDashboard,
} from "@/features/dashboards/data/types";
import { offers } from "@/features/reference/data/permissions";
import type { Technician } from "@/features/reference/data/types";
import { demoDataAccess } from "../../../_data/adapter";
import { DEMO_NOW, TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { demoLandingBack, isOfficeRole, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import {
  ANALYTICS_TABS,
  analyticsHref,
  effectiveAnalyticsView,
  offeredAnalyticsTabs,
  orderTechnicians,
  parseAnalyticsState,
  reportsColumnsOffered,
  reportsRowsOffered,
  selectedTechnician,
  type AnalyticsLink,
  type AnalyticsState,
} from "./_state";

// Every office role is listed: the customer-service URL renders the "אין הרשאה" state instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/analytics">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `סקירה ניהולית · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** Id of the "נתוני בדיקה" note; KPI groups point at it (SIM-13). */
const TEST_NOTE_ID = "ma-test-note";

const PERIOD_LABELS: Readonly<Record<DashboardPeriodKind, string>> = { day: "יום", week: "שבוע", month: "חודש", year: "שנה", custom: "מותאם" };

const LEGEND =
  "\"—\" אין מספיק נתונים · \"לא זמין\" אין נתון מובנה · \"הגדרה ממתינה\" ההגדרה ממתינה לאישור הבעלים · נתונים חסרים אינם נחשבים כאפס";

/** "יום רביעי, 21 באוקטובר 2026". */
const longDate = (d: string): string => `יום ${dayName(d)}, ${Number(d.slice(8, 10))} ב${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** A supplier or brand's label from the tab's bars ("" or the none key: "לא הוזן"); the key otherwise. */
function groupLabel(key: string, lists: readonly (readonly BarRow[])[]): string {
  if (key === NONE_GROUP_KEY) return NOT_ENTERED_LABEL;
  for (const list of lists) {
    const row = list.find((r) => r.key === key);
    if (row) return row.label || NOT_ENTERED_LABEL;
  }
  return key;
}

/** The tile value behind an ungrouped key (shown in the dialog). */
function tileMetric(key: DashboardMetricKey, g: GeneralDashboard | null, t: TechnicianDashboard | null): Metric | null {
  const general: Partial<Record<DashboardMetricKey, Metric>> = g
    ? {
        "today.planned": g.today.planned,
        "today.done": g.today.done,
        "today.pending": g.today.pending,
        "today.missed": g.today.missed,
        "service.treat": g.service.treat,
        "service.travel": g.service.travel,
        "service.firstVisit": g.service.firstVisit,
        "service.closeTime": g.service.closeTime,
      }
    : {};
  const tech: Partial<Record<DashboardMetricKey, Metric>> = t
    ? {
        "tech.planned": t.activity.planned,
        "tech.done": t.activity.done,
        "tech.closedCalls": t.activity.closedCalls,
        "tech.treat": t.performance.treat,
        "tech.travel": t.performance.travel,
        "tech.firstVisit": t.performance.firstVisit,
        "tech.closeTime": t.performance.closeTime,
      }
    : {};
  return general[key] ?? tech[key] ?? null;
}

// Manager dashboard (D57; docs/design/manager-dashboard-spec.md and the visual reference
// docs/design/manager-dashboard-demo.html; spec-final §6): three tabs, "כללי", "טכנאים" and
// "מוצרים וספקים", and the details dialog. Reads only through the data-access layer, one method per
// tab (dashboards.generalDashboard / technicianDashboard / productDashboard, plus technicianDetail for
// "דוחות הביקורים" and dashboardDetail for the dialog's rows). `now` is the demo's fixed instant
// (DEMO_NOW), passed by this server page, never taken from the URL.
// Display only (G-04; enforcement is on the server and in the database, D33): reference.permissions
// decides which tabs are offered; no dashboard data is read for a role without a tab; the dialog's
// rows and the reports view's rows need the data key `calls`, its documentation and signature
// columns `card` and its recording marker `recordings`. Anything in the URL that does not fit is
// ignored (effectiveAnalyticsView). The office frame is the segment layout (./layout.tsx).
export default async function OfficeAnalyticsPage({
  params,
  searchParams,
}: PageProps<"/dev/demo/office/[role]/analytics">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);

  const offered = offeredAnalyticsTabs(permissions);
  const state = parseAnalyticsState(await searchParams);
  const view = effectiveAnalyticsView(state, offered);
  if (view.tab === null) {
    return (
      <>
        <div className="ptitle">
          <div>
            <h1>דשבורד</h1>
          </div>
        </div>
        <AnalyticsNoAccess {...demoLandingBack(role, permissions)} />
      </>
    );
  }

  const tab = view.tab;
  const now = DEMO_NOW;
  const asOf = TODAY;
  const base = demoHref.analytics(role);
  const rowsOffered = detailRowsOffered(permissions);
  const callHref = (req: string) => demoHref.call(role, req);

  const tabs = ANALYTICS_TABS.filter((t) => offered.includes(t.key)).map((t) => ({
    key: t.key,
    label: t.label,
    href: analyticsHref(base, { tab: t.key }),
    on: t.key === tab,
    current: t.key === tab && view.view === null && view.detail === null,
  }));

  let body: ReactNode;
  let includesTestData = false;
  let general: GeneralDashboard | null = null;
  let technician: TechnicianDashboard | null = null;
  let products: ProductDashboard | null = null;
  let techContext: { id: string; name: string; period: AnalyticsPeriod; periodLabel: string } | null = null;
  /** The link of the view being shown, with extra keys (the dialog's links and its close link). */
  let viewLink: (extra?: Partial<AnalyticsLink>) => string = (extra) => analyticsHref(base, { tab, ...extra });

  if (tab === "gen") {
    general = await demoDataAccess.dashboards.generalDashboard(now, { months: state.months });
    includesTestData = general.includesTestData;
    const link = (extra?: Partial<AnalyticsLink>) => analyticsHref(base, { tab: "gen", months: state.months, ...extra });
    viewLink = link;
    body = (
      <AnalyticsGeneral
        general={general}
        detailHref={rowsOffered ? (key, group) => link({ detail: key, group }) : null}
        monthsHref={(months) => analyticsHref(base, { tab: "gen", months })}
        productsHref={offered.includes("prod") ? analyticsHref(base, { tab: "prod" }) : null}
        describedBy={general.includesTestData ? TEST_NOTE_ID : undefined}
      />
    );
  } else if (tab === "tech") {
    const resolved = resolveDashboardPeriod({ kind: state.period, offset: state.offset, from: state.from, to: state.to }, asOf);
    const technicians = orderTechnicians(await demoDataAccess.reference.technicians());
    const selected = selectedTechnician(technicians, state.tech);
    const custom = resolved.kind === "custom";
    const link = (extra?: Partial<AnalyticsLink>) =>
      analyticsHref(base, {
        tab: "tech",
        tech: selected?.id,
        period: resolved.kind,
        offset: resolved.offset,
        from: custom ? state.from : undefined,
        to: custom ? state.to : undefined,
        view: view.view,
        ...extra,
      });
    viewLink = link;
    const toolbar = (
      <DashboardPeriodControls
        technicians={technicians.map((t: Technician) => ({
          id: t.id,
          name: t.name,
          active: t.active,
          // Switching technician keeps the period, offset, range and view (filters and pages reset).
          href: link({ tech: t.id }),
        }))}
        selectedId={selected?.id ?? null}
        periods={DASHBOARD_PERIOD_KINDS.map((k) => ({
          key: k,
          label: PERIOD_LABELS[k],
          // Switching period resets the offset (and a custom range starts from this month).
          href: analyticsHref(base, { tab: "tech", tech: selected?.id, period: k, view: view.view }),
          on: k === resolved.kind,
        }))}
        dateNav={
          custom
            ? null
            : {
                label: resolved.label,
                prevHref: resolved.canGoPrev ? link({ offset: resolved.offset - 1 }) : null,
                nextHref: resolved.canGoNext ? link({ offset: resolved.offset + 1 }) : null,
              }
        }
        custom={
          custom
            ? {
                action: base,
                hidden: {
                  tab: "tech",
                  ...(selected ? { tech: selected.id } : {}),
                  period: "custom",
                  ...(view.view === "reports" ? { view: "reports" } : {}),
                },
                from: resolved.from,
                to: resolved.to,
                max: asOf,
                invalid: resolved.error === "invalid-range",
              }
            : null
        }
      />
    );
    // A custom range that fails the check falls back to the current month, and says so.
    const periodLabel = resolved.error ? `${resolved.label} (טווח לא תקין, מוצג החודש הנוכחי)` : resolved.label;
    let content: ReactNode;
    if (!selected) {
      content = <div className="ma-card ma-empty">אין טכנאים להצגה</div>;
    } else if (view.view === "reports") {
      techContext = { id: selected.id, name: selected.name, period: resolved.period, periodLabel };
      const detail = reportsRowsOffered(permissions)
        ? await demoDataAccess.dashboards.technicianDetail(selected.id, resolved.period, {
            filter: state.filter,
            page: state.page,
            limit: MAX_PAGE_LIMIT,
          })
        : null;
      if (detail) includesTestData = detail.includesTestData;
      content = (
        <AnalyticsTechDetail
          name={selected.name}
          periodLabel={periodLabel}
          today={asOf}
          backHref={link({ view: null })}
          rows={
            detail
              ? {
                  detail,
                  filterHref: (filter) => link({ filter }),
                  pageHref: (page) => link({ filter: detail.filter, page }),
                  callHref,
                  columns: reportsColumnsOffered(permissions),
                }
              : null
          }
          describedBy={includesTestData ? TEST_NOTE_ID : undefined}
        />
      );
    } else {
      technician = await demoDataAccess.dashboards.technicianDashboard(selected.id, resolved.period, now);
      if (technician) {
        includesTestData = technician.includesTestData;
        techContext = { id: selected.id, name: selected.name, period: resolved.period, periodLabel };
        content = (
          <AnalyticsTechnicians
            dashboard={technician}
            periodLabel={periodLabel}
            detailHref={rowsOffered ? (key) => link({ detail: key }) : null}
            reportsHref={link({ view: "reports" })}
            describedBy={technician.includesTestData ? TEST_NOTE_ID : undefined}
          />
        );
      } else {
        content = <div className="ma-card ma-empty">הטכנאי לא נמצא.</div>;
      }
    }
    body = (
      <>
        {toolbar}
        {content}
      </>
    );
  } else {
    products = await demoDataAccess.dashboards.productDashboard(now, { page: state.spage, sort: state.sort });
    includesTestData = products.includesTestData;
    const sort = products.sort;
    const page = products.skus.page;
    const link = (extra?: Partial<AnalyticsLink>) => analyticsHref(base, { tab: "prod", sort, spage: page, ...extra });
    viewLink = link;
    body = (
      <AnalyticsProducts
        products={products}
        detailHref={rowsOffered ? (key, group) => link({ detail: key, group }) : null}
        sortHref={(s) => analyticsHref(base, { tab: "prod", sort: s })}
        pageHref={(p) => link({ spage: p })}
        describedBy={products.includesTestData ? TEST_NOTE_ID : undefined}
      />
    );
  }

  const dialog = await detailDialog({
    state,
    detail: view.detail,
    rowsOffered,
    asOf,
    now,
    general,
    technician,
    products,
    techContext,
    viewLink,
    callHref,
  });

  return (
    <>
      <div className="ptitle">
        <div>
          <h1>סקירה ניהולית</h1>
          <div className="sub">MODY · מערכת ניהול טכנאים</div>
        </div>
        <div className="od-title-actions" style={{ alignItems: "center" }}>
          <span className="sub">{longDate(asOf)}</span>
          {offers(permissions, "export") && (
            // TODO(OF-14): no exports port yet (XLSX export is pending a decision). When it exists,
            // this becomes a command through useCommands() / an authorized server route, and data-sim
            // goes (data-sim stays only for navigation affordances such as dial and Waze).
            <button type="button" className="btn" data-sim="ייצוא ל-Excel ממתין להחלטה · לא נוצר קובץ">
              ייצוא ל-Excel
            </button>
          )}
        </div>
      </div>
      {includesTestData && <DashboardTestNote id={TEST_NOTE_ID} />}
      <AnalyticsTabs tabs={tabs} />
      <div className="ma-dash">{body}</div>
      <p className="sub ma-legend">{LEGEND}</p>
      {dialog}
    </>
  );
}

/**
 * The details dialog of the URL's `detail` (spec-final §6.9), or null. With `calls`, the rows come
 * from dashboards.dashboardDetail, and a key or group without records opens nothing. Without
 * `calls`, dashboardDetail is never called: only a tile's dialog opens, with the definition, the
 * value and a sentence saying the records are not shown (grouped dialogs do not open).
 */
async function detailDialog({
  state,
  detail,
  rowsOffered,
  asOf,
  now,
  general,
  technician,
  products,
  techContext,
  viewLink,
  callHref,
}: {
  state: AnalyticsState;
  detail: { key: DashboardMetricKey; group: string | null } | null;
  rowsOffered: boolean;
  asOf: string;
  now: string;
  general: GeneralDashboard | null;
  technician: TechnicianDashboard | null;
  products: ProductDashboard | null;
  techContext: { id: string; name: string; period: AnalyticsPeriod; periodLabel: string } | null;
  viewLink: (extra?: Partial<AnalyticsLink>) => string;
  callHref: (req: string) => string;
}): Promise<ReactNode> {
  if (!detail) return null;
  const { key, group } = detail;
  const def = METRIC_DEFINITIONS[key];
  const isTech = def.tab === "tech";
  if (isTech && !techContext) return null;
  if (!rowsOffered && group !== null) return null;

  const rows = rowsOffered
    ? await demoDataAccess.dashboards.dashboardDetail({
        key,
        now,
        ...(isTech && techContext ? { period: techContext.period, techId: techContext.id } : {}),
        ...(group !== null ? { group } : {}),
        page: state.dpage,
      })
    : null;
  if (rowsOffered && !rows) return null;
  const metric = group === null ? tileMetric(key, general, technician) : null;
  if (!rowsOffered && !metric) return null;

  const supplierBars = [general?.highlights.suppliers.items ?? [], products?.bySupplier.items ?? []];
  const skuName = (sku: string): string =>
    general?.highlights.skus.items.find((r) => r.key === sku)?.name ??
    products?.skus.items.find((r) => r.product.sku === sku)?.product.name ??
    rows?.rows.items[0]?.product.name ??
    "";
  const skuTitle = (sku: string) => {
    const name = skuName(sku);
    return `קריאות למק״ט ${sku}${name ? ` · ${name}` : ""}`;
  };
  const month = (g: string) => monthLabel(g);
  let title: string;
  switch (key) {
    case "top.suppliers":
      title = `קריאות לספק ${groupLabel(group ?? "", supplierBars)} · 30 ימים אחרונים`;
      break;
    case "top.skus":
      title = `${skuTitle(group ?? "")} · 30 ימים אחרונים`;
      break;
    case "trend.opened":
      title = `קריאות שנפתחו · ${month(group ?? "")}`;
      break;
    case "trend.closed":
      title = `קריאות שנסגרו · ${month(group ?? "")}`;
      break;
    case "prod.bySupplier":
      title = `קריאות לספק ${groupLabel(group ?? "", [products?.bySupplier.items ?? []])}`;
      break;
    case "prod.byBrand":
      title = `קריאות למותג ${groupLabel(group ?? "", [products?.byBrand.items ?? []])}`;
      break;
    case "prod.skuCalls":
      title = skuTitle(group ?? "");
      break;
    default:
      title = def.tab === "tech" && techContext
        ? `${def.label} · ${techContext.name} · ${techContext.periodLabel}`
        : key.startsWith("today.")
          ? `${def.label} · ${dateLabel(asOf)}`
          : `${def.label} · ${monthLabel(monthOfDate(asOf))}`;
  }

  const closeHref = viewLink({ detail: null, group: null, dpage: 1 });
  const returnKey = group === null ? key : `${key}|${group}`;
  return (
    <DashboardDetailDialog
      key={`${returnKey}|${state.dpage}`}
      title={title}
      description={def.definition}
      temporary={def.temporary.length > 0}
      closeHref={closeHref}
      returnKey={returnKey}
    >
      {metric && (
        <p className="ma-dialog-value">
          הערך המוצג: <b className="num">{formatMetric(metric)}</b>
        </p>
      )}
      {rows ? (
        <DashboardDetailTable
          detail={rows}
          label={`רשומות · ${title}`}
          callHref={callHref}
          pageHref={(page) => viewLink({ detail: key, group, dpage: page })}
        />
      ) : (
        <p className="ma-empty" style={{ margin: 0 }}>
          פירוט הרשומות אינו מוצג לתפקיד הזה.
        </p>
      )}
    </DashboardDetailDialog>
  );
}

