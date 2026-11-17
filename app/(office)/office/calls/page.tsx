import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { CallStatusOption, CallTechOption } from "@/components/office/CallFilters";
import { CallsBrowser } from "@/components/office/CallsBrowser";
import type { CallsTableRow } from "@/components/office/CallsTable";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { SettingsNoAccess } from "@/components/office/SettingsNoAccess";
import { CALL_STATUS_ORDER, CALL_STATUSES } from "@/components/ui/CallStatusPill";
import { OFFICE_UNPARSED_PATH, officeCallPath } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { ddmm } from "@/features/calendar/data/dates";
import { callFilterOf, parseCallsListState } from "@/features/calls/data/search-params";
import type { CallListItem } from "@/features/calls/data/types";
import { CALLS_WINDOW, readsCalls } from "@/features/calls/supabase/list-queries";
import { jerusalemDate } from "@/features/dashboards/data/time";
import { DEFAULT_PAGE_LIMIT } from "@/features/data-access/common";
import { requireArea } from "@/lib/auth/guards";
import { callsListQueries, callsPermitted, callTechnicianOptions } from "@/lib/data/supabase/calls";
import { OfficeFrame } from "../_OfficeFrame";

export const metadata: Metadata = { title: "קריאות · ניהול טכנאים" };

/** One row (the demo's callsTable() row): the latest shown visit's technician, date and source. */
function rowOf(c: CallListItem, today: string): CallsTableRow {
  const v = c.latestVisit;
  return {
    req: c.req,
    href: officeCallPath(c.req),
    customer: c.customer.name,
    customerNo: c.customer.number,
    city: c.customer.city,
    product: c.product.name,
    sku: c.product.sku,
    tech: v ? { name: v.technician.name, color: v.technician.color } : null,
    visits: c.visitCount,
    when: v ? `${v.date === today ? "היום" : ddmm(v.date)} ${v.start}` : "",
    source: v ? v.source : null,
    status: c.status,
    reason: c.followupReason ?? undefined,
    rep: c.representative,
    isTest: c.isTest,
  };
}

// "קריאות" (V1 item 4; QA S-01, S-03, X-01, X-02; D38, D57 (1), D60 (1), (3), (4)): the office calls
// list on real data (Migration 3 under the viewer's own session, RLS), as the approved demo
// (docs/demo.html offCalls()/callsTable() and the UI demo's calls list): search, technician
// filter and service-call status chips with counts in the URL (?q&status&tech&page), 40 rows per
// page, newest first; "מס׳ פנייה" (D60 (3)); the call status (D38), never a cancelled visit
// (D60 (1)); the visit's source and the 🧪 marker of test calls (SIM-14, SIM-15, D47). A row opens
// the call card (/office/calls/<מס׳ פנייה>; the card itself is the next screen).
// Not here (not built, no fake action): the Excel export (Step 8) and the "מסכים נוספים" row (its
// screens are not built; D60 (4)).
// Guard, at the time of the request: requireArea("office") (anonymous → /login; Technicians and
// accounts without access → the no-access state), then the matrix key `calls` on the server (D33;
// the Creator always): without it "אין הרשאה" and nothing is read. The database checks every row
// again (RLS). A failed read throws (a code only, logged): the page fails closed.
export default async function OfficeCallsPage({ searchParams }: PageProps<"/office/calls">) {
  const me = await requireArea("office");
  if (!readsCalls(me)) redirect(LOGIN_NO_ACCESS_PATH);
  if (!(await callsPermitted())) {
    return (
      <OfficeFrame me={me} active="calls">
        <div className="ptitle">
          <h1>קריאות</h1>
        </div>
        <SettingsNoAccess text="לתפקיד שלך אין צפייה בקריאות." backHref={OFFICE_UNPARSED_PATH} backLabel="זימונים שלא נקלטו" />
      </OfficeFrame>
    );
  }

  const state = parseCallsListState(await searchParams);
  const [page, technicians] = await Promise.all([(await callsListQueries()).list(callFilterOf(state, DEFAULT_PAGE_LIMIT)), callTechnicianOptions()]);
  const today = jerusalemDate(new Date().toISOString()) ?? "";

  // Counts over every call the viewer may see, as in the demo (they do not follow the search or technician filter).
  const statusOptions: CallStatusOption[] = [
    { key: "all", label: "הכל", count: page.allCount },
    ...CALL_STATUS_ORDER.map((key) => ({ key, label: CALL_STATUSES[key].label, count: page.statusCounts[key] })),
  ];
  const techOptions: CallTechOption[] = technicians;
  const includesTestData = page.items.some((c) => c.isTest);

  return (
    <OfficeFrame me={me} active="calls">
      <div className="ptitle">
        <div>
          <h1>קריאות</h1>
          <div className="sub">כל הקריאות שנקלטו מהזימונים. לחיצה על שורה פותחת את כרטיס הקריאה.</div>
        </div>
      </div>
      {includesTestData && <DashboardTestNote id="calls-test-note">הרשימה כוללת נתוני בדיקה (סביבת בדיקה)</DashboardTestNote>}
      {page.capped && (
        <div className="note" role="note">
          החיפוש והסינון לפי טכנאי נעשים ב-{CALLS_WINDOW.toLocaleString("en-US")} הקריאות האחרונות שנפתחו. לקריאה ישנה יותר אפשר לסנן לפי סטטוס.
        </div>
      )}
      <CallsBrowser
        rows={page.items.map((c) => rowOf(c, today))}
        total={page.total}
        pageCount={page.pageCount}
        state={{ ...state, page: page.page }}
        statusOptions={statusOptions}
        techOptions={techOptions}
      />
    </OfficeFrame>
  );
}
