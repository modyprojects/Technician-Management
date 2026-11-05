import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CallStatusOption, CallTechOption } from "@/components/office/CallFilters";
import type { CallsTableRow } from "@/components/office/CallsTable";
import { RelatedScreens } from "@/components/office/RelatedScreens";
import { CALL_STATUS_ORDER, CALL_STATUSES } from "@/components/ui/CallStatusPill";
import { callFilterOf, parseCallsListState } from "@/features/calls/data/search-params";
import type { CallSummary } from "@/features/calls/data/types";
import { offers } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { dayLabel } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { callsAreaLinks, isOfficeRole, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import type { OfficeRole } from "@/features/reference/data/types";
import { CallsBrowser } from "./_CallsBrowser";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calls">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `קריאות · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** The demo's 40-row page ("מציג 40 מתוך …", OF-04). */
const PAGE_SIZE = 40;

/** One calls-list row (the demo's callsTable() row): the latest visit's technician, date and source. */
function toRow(c: CallSummary, role: OfficeRole): CallsTableRow {
  const v = c.latestVisit;
  return {
    req: c.req,
    href: demoHref.call(role, c.req),
    customer: c.customer.name,
    customerNo: c.customer.number,
    city: c.customer.city,
    product: c.product.name,
    sku: c.product.sku,
    tech: { name: v.technician.name, color: v.technician.color },
    visits: c.visitCount,
    when: `${dayLabel(v.date)} ${v.start}`,
    source: v.source,
    whenCancelled: v.status === "cancel",
    status: c.status,
    reason: c.followupReason ?? undefined,
    rep: c.representative,
    isTest: c.isTest,
  };
}

// Office calls list (docs/demo.html offCalls()/callsTable(), L816-832): search, technician
// filter, status chips with counts (service-call status, OF-17) and 40-row pages; a row opens the
// call card. Reads only through the data-access layer: the URL (?q=&status=&tech=&page=) is the
// query, filtered and paged by calls.list() (OF-04). The export button follows the role's matrix
// value (reference.permissions, display only). Under the title, the "מסכים נוספים" row (D57) links
// the screens that left the Manager's and the Creator's sidebar, each per its own rule and without
// counts (callsAreaLinks; nothing for Customer Service, whose sidebar keeps them).
export default async function OfficeCallsPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/calls">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();

  const state = parseCallsListState(await searchParams);
  const [page, technicians, permissions] = await Promise.all([
    demoDataAccess.calls.list(callFilterOf(state, PAGE_SIZE)),
    demoDataAccess.reference.technicians(),
    demoDataAccess.reference.permissions(role),
  ]);

  // Counts over every call, as in the demo (they do not follow the search or technician filter).
  const statusOptions: CallStatusOption[] = [
    { key: "all", label: "הכל", count: page.allCount },
    ...CALL_STATUS_ORDER.map((key) => ({ key, label: CALL_STATUSES[key].label, count: page.statusCounts[key] })),
  ];
  const techOptions: CallTechOption[] = technicians.map((t) => ({ id: t.id, name: t.name }));

  return (
    <DemoOfficeFrame role={role} active="calls">
      <div className="ptitle">
        <div>
          <h1>קריאות</h1>
          <div className="sub">כל הקריאות שנקלטו מ-Outlook. לחיצה על שורה פותחת את כרטיס הקריאה.</div>
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
      <RelatedScreens links={callsAreaLinks(role, permissions)} />
      <CallsBrowser
        rows={page.items.map((c) => toRow(c, role))}
        total={page.total}
        pageCount={page.pageCount}
        state={{ ...state, page: page.page }}
        statusOptions={statusOptions}
        techOptions={techOptions}
      />
    </DemoOfficeFrame>
  );
}
