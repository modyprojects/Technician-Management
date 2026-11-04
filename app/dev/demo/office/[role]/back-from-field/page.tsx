import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pager } from "@/components/ui/Pager";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { ALL, parseBackFromFieldState } from "@/features/calls/data/search-params";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { dayLabel, TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS, WORK_QUEUE_SCREENS_DECISION, workQueueScreensOffered } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../_Placeholder";

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

// "חזרו מהשטח" (spec office screens, OF-16): visits closed as "המשך טיפול" whose call has no next
// visit (D38 "followup"), with reason, technician, date and summary excerpt; each links to the call
// card. The row action is a NEW Outlook invitation: until Microsoft 365 is connected (D23,
// `outlookConnected` false) the screen shows it disabled with a visible hint, never a fake Outlook
// link (OF-08 pattern). Who sees the screen is open decision #15 (d23): a TEMPORARY fixed rule for
// every office role with a visible pending hint. PHASE F SCAFFOLD: the body is a placeholder list.
// Reads only through the layer: calls.backFromField (?tech=&page=).
export default async function OfficeBackFromFieldPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/back-from-field">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = workQueueScreensOffered(role);
  const state = parseBackFromFieldState(await searchParams);
  const page = offered
    ? await demoDataAccess.calls.backFromField({
        asOf: TODAY,
        technicianId: state.tech === ALL ? undefined : state.tech,
        page: state.page,
        limit: PAGE_SIZE,
      })
    : null;
  const href = (p: number) => demoHref.backFromField(role, { tech: state.tech, page: p });

  return (
    <DemoOfficeFrame role={role} active="back">
      <div className="ptitle">
        <div>
          <h1>חזרו מהשטח</h1>
          <div className="sub">{pendingDecisionHint(WORK_QUEUE_SCREENS_DECISION)}</div>
        </div>
      </div>
      {page ? (
        <ScreenPlaceholder
          id="back-from-field-list"
          heading="המשך טיפול – צריך ביקור חדש"
          note="המסך בבנייה (שלב F) · הוותיקים קודם"
          total={page.total}
          rows={page.items.map((x) => ({
            key: `${x.req}-${x.n}`,
            href: demoHref.call(role, x.req),
            primary: `${x.customer.name} · פנייה ${x.req} · ביקור ${x.n}`,
            secondary: `${x.reason} · ${x.technician.name} · ${dayLabel(x.date)} · ${x.daysWaiting} ימים${x.summaryExcerpt ? ` · ${x.summaryExcerpt}` : ""}`,
            isTest: x.isTest,
          }))}
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
