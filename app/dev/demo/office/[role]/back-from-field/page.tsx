import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackFromFieldList, BackFromFieldTechFilter, LATE_AFTER_DAYS, type BackFromFieldTechLink } from "@/components/office/BackFromFieldList";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { Pager } from "@/components/ui/Pager";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { ALL, parseBackFromFieldState, type BackFromFieldState } from "@/features/calls/data/search-params";
import type { OfficeRole } from "@/features/reference/data/types";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS, WORK_QUEUE_SCREENS_DECISION, workQueueScreensOffered } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/back-from-field">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `חזרו מהשטח · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** The demo's 40-row page (OF-04). */
const PAGE_SIZE = 40;

/**
 * Who sees the screen is open decision #15 (board ref d23): TEMPORARY fixed rule for every office
 * role (roles.ts workQueueScreensOffered), labelled as pending (CLAUDE.md: reversible, clearly
 * labelled behaviour). Same line on "זימונים שלא נקלטו".
 */
const ACCESS_HINT = `הרשאת צפייה (החלטה פתוחה #15): בינתיים שירות לקוחות, מנהל ויוצר · ${pendingDecisionHint(WORK_QUEUE_SCREENS_DECISION)}`;

// "חזרו מהשטח" (spec office screens, OF-16): visits closed as "המשך טיפול" whose call has no next
// visit (D38 "followup"), oldest first, with reason, technician, date, customer, city, product and
// summary excerpt; each links to the call card. The row action is a NEW Outlook invitation: until
// Microsoft 365 is connected (D23, `outlookConnected` false) it is disabled with a visible hint,
// never a fake Outlook link (OF-08 pattern). Reads only through the layer: calls.backFromField
// with the URL state (?tech=&page=, 40 per page, OF-04). The counters are server queries too:
// the filtered total, the oldest wait (the first row of page 1, oldest first) and, with a
// technician filter, the total of every technician (limit 1 each).
export default async function OfficeBackFromFieldPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/back-from-field">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = workQueueScreensOffered(role);

  return (
    <DemoOfficeFrame role={role} active="back">
      <div className="ptitle">
        <div>
          <h1>חזרו מהשטח</h1>
          <div className="sub">ביקורים שנסגרו ב&quot;המשך טיפול&quot; ועדיין אין להם ביקור חדש. ביקור חדש נקבע בזימון חדש מ-Outlook.</div>
          <div className="sub">
            <span aria-hidden="true">⏳ </span>
            {ACCESS_HINT}
          </div>
        </div>
      </div>
      {offered ? (
        <BackFromFieldBody role={role} state={parseBackFromFieldState(await searchParams)} />
      ) : (
        <NoAccessPlaceholder
          id="back-from-field-no-access"
          text="לתפקיד הזה אין צפייה בביקורים שחזרו מהשטח."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}

/** The screen body for a role the screen is offered to: counters, technician filter and list. */
async function BackFromFieldBody({ role, state }: { role: OfficeRole; state: BackFromFieldState }) {
  const technicianId = state.tech === ALL ? undefined : state.tech;
  const [page, technicians] = await Promise.all([
    demoDataAccess.calls.backFromField({ asOf: TODAY, technicianId, page: state.page, limit: PAGE_SIZE }),
    demoDataAccess.reference.technicians(),
  ]);
  // Oldest first: page 1 already starts with the oldest row; another page asks for it (limit 1).
  const [firstPage, everyTechnician] = await Promise.all([
    page.page === 1 ? page : demoDataAccess.calls.backFromField({ asOf: TODAY, technicianId, limit: 1 }),
    technicianId ? demoDataAccess.calls.backFromField({ asOf: TODAY, limit: 1 }) : page,
  ]);
  const oldest = firstPage.items[0];
  const includesTestData = page.items.some((x) => x.isTest);

  const href = (p: number) => demoHref.backFromField(role, { tech: state.tech, page: p });
  const techLinks: BackFromFieldTechLink[] = [
    { key: ALL, label: "כל הטכנאים", href: demoHref.backFromField(role), on: !technicianId },
    ...technicians.map((t) => ({
      key: t.id,
      label: t.name,
      color: t.color,
      href: demoHref.backFromField(role, { tech: t.id }),
      on: t.id === technicianId,
    })),
  ];
  const tiles: KpiTile[] = [
    {
      key: "waiting",
      label: "ממתינות לביקור חדש",
      metric: { value: page.total, unit: "count" },
      detail: technicianId ? `מתוך ${everyTechnician.total} בכל הטכנאים` : "קריאות בהמשך טיפול",
      color: "var(--s-cont)",
    },
    {
      key: "oldest",
      label: "הוותיקה ביותר",
      metric: { value: oldest ? oldest.daysWaiting : null, unit: "count" },
      detail: "ימים מאז הביקור",
      color: oldest && oldest.daysWaiting > LATE_AFTER_DAYS ? "var(--danger)" : undefined,
    },
  ];

  return (
    <>
      {includesTestData && <DashboardTestNote id="back-from-field-test-note" />}
      <div className="ib-kpis">
        <KpiGrid label="מוני חזרו מהשטח" describedBy={includesTestData ? "back-from-field-test-note" : undefined} tiles={tiles} />
      </div>
      <BackFromFieldTechFilter links={techLinks} />
      <BackFromFieldList
        id="back-from-field-list"
        page={page}
        today={TODAY}
        callHref={(req) => demoHref.call(role, req)}
        emptyText={technicianId ? "לטכנאי הזה אין ביקורים שחזרו מהשטח וממתינים לביקור חדש" : "אין ביקורים שחזרו מהשטח וממתינים לביקור חדש"}
        emptyAction={
          technicianId ? (
            <Link className="lnk" href={demoHref.backFromField(role)} prefetch={false}>
              להצגת כל הטכנאים ›
            </Link>
          ) : undefined
        }
        footer={
          <Pager
            page={page.page}
            pageCount={page.pageCount}
            prevHref={page.page > 1 ? href(page.page - 1) : null}
            nextHref={page.page < page.pageCount ? href(page.page + 1) : null}
            label="עמודי החוזרים מהשטח"
          />
        }
      />
    </>
  );
}
