import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CallStatusOption, CallTechOption } from "@/components/office/CallFilters";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import {
  CALL_STATUS_ORDER,
  CALL_STATUSES,
  CALLS,
  can,
  callStatus,
  dayLabel,
  demoHref,
  isClosedVisit,
  isOfficeRole,
  lastVisit,
  officeRoleParams,
  prod,
  sortCalls,
  tech,
  TECHS,
  VIEWPOINTS,
  type Call,
  type OfficeRole,
} from "../../../_data";
import { CallsBrowser, type DemoCallRow } from "./_CallsBrowser";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calls">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `קריאות · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** One calls-list row (the demo's callsTable() row): the last visit's technician, date and source. */
function toRow(c: Call, role: OfficeRole): DemoCallRow {
  const v = lastVisit(c);
  const t = tech(v.tech);
  const status = callStatus(c);
  // Follow-up reason of the visit that set the call to "המשך טיפול" (its latest closed visit).
  const closed = c.visits.filter(isClosedVisit);
  const reason = status === "followup" ? (closed[closed.length - 1]?.reason ?? undefined) : undefined;
  return {
    req: c.req,
    href: demoHref.call(role, c.req),
    customer: c.customer,
    customerNo: c.customerNo,
    phone: c.phone,
    city: c.city,
    product: prod(c.sku).name,
    sku: c.sku,
    techId: t.id,
    tech: { name: t.name, color: t.color },
    visits: c.visits.length,
    when: `${dayLabel(v.date)} ${v.start}`,
    source: v.source,
    status,
    reason,
    rep: c.rep,
    isTest: c.isTest,
  };
}

// Office calls list (docs/demo.html offCalls()/callsTable(), L816-832): search, technician
// filter, status chips with counts (service-call status, OF-17) and the 40-row table; a row opens
// the call card. Export (OF-14) is pending, so its button only shows the simulated-action notice.
export default async function OfficeCallsPage({ params }: PageProps<"/dev/demo/office/[role]/calls">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();

  const rows = sortCalls(CALLS).map((c) => toRow(c, role));
  // Counts over every call, as in the demo (they do not follow the search or technician filter).
  const statusOptions: CallStatusOption[] = [
    { key: "all", label: "הכל", count: rows.length },
    ...CALL_STATUS_ORDER.map((key) => ({
      key,
      label: CALL_STATUSES[key].label,
      count: rows.filter((r) => r.status === key).length,
    })),
  ];
  const techOptions: CallTechOption[] = TECHS.map((t) => ({ id: t.id, name: t.name }));

  return (
    <DemoOfficeFrame role={role} active="calls">
      <div className="ptitle">
        <div>
          <h1>קריאות</h1>
          <div className="sub">כל הקריאות שנקלטו מ-Outlook. לחיצה על שורה פותחת את כרטיס הקריאה.</div>
        </div>
        {can(role, "export") && (
          <button type="button" className="btn" data-sim="ייצוא ל-Excel ממתין להחלטה · לא נוצר קובץ">
            ייצוא ל-Excel
          </button>
        )}
      </div>
      <CallsBrowser rows={rows} statusOptions={statusOptions} techOptions={techOptions} />
    </DemoOfficeFrame>
  );
}
