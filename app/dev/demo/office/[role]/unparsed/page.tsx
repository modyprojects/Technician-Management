import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { KpiGrid } from "@/components/office/KpiGrid";
import { UnparsedInvitationsList } from "@/components/office/UnparsedInvitationsList";
import { Pager } from "@/components/ui/Pager";
import { clampPage } from "@/features/data-access/common";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { notificationTimeLabel } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS, WORK_QUEUE_ACCESS_HINT, workQueueScreensOffered } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/unparsed">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `זימונים שלא נקלטו · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** Demo-only line under the explanation: Microsoft 365 is not connected, every invitation is simulated (D23, D24, SIM-14). */
const DEMO_SOURCE_NOTE = "בהדגמה כל הזימונים מגיעים מסימולטור הזימונים (🧪 זימון בדיקה): Microsoft 365 עדיין לא מחובר (D23).";

// "זימונים שלא נקלטו" (spec office screens, OF-16, IN-03, IN-04): invitations the ingestion
// service could not ingest, with the missing or invalid field; an unknown SKU is never a reason
// (IN-02, D19). Intake is event-driven (D08). The email to the rep is pending d09 (never shown as
// sent). Reads only through the layer: intake.unparsedInvitations (?page=, 40 per page, OF-04).
// No actions: the invitation is fixed in Outlook. Who sees it is open decision #15 (d23): a
// TEMPORARY fixed rule, labelled on the screen (roles.ts workQueueScreensOffered, WORK_QUEUE_ACCESS_HINT).
export default async function OfficeUnparsedPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/unparsed">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = workQueueScreensOffered(role);
  const sp = await searchParams;
  const page = offered
    ? await demoDataAccess.intake.unparsedInvitations({ page: clampPage(Array.isArray(sp.page) ? sp.page[0] : sp.page) })
    : null;
  const includesTestData = page?.items.some((x) => x.isTest) ?? false;
  const allSimulated = page ? page.items.length > 0 && page.items.every((x) => x.source === "simulator") : false;

  return (
    <DemoOfficeFrame role={role} active="unparsed">
      <div className="ptitle">
        <div>
          <h1>זימונים שלא נקלטו</h1>
          <div className="sub">זימונים שמערכת הקליטה לא קלטה, עם השדה החסר או השגוי. התיקון נעשה בזימון עצמו.</div>
          <div className="sub">
            <span aria-hidden="true">⏳ </span>
            {WORK_QUEUE_ACCESS_HINT}
          </div>
        </div>
      </div>
      {page ? (
        <>
          {includesTestData && <DashboardTestNote id="unparsed-test-note" />}
          <div className="ib-kpis">
            <KpiGrid
              label="מונה זימונים שלא נקלטו"
              describedBy={includesTestData ? "unparsed-test-note" : undefined}
              tiles={[
                {
                  key: "waiting",
                  label: "ממתינים לתיקון",
                  metric: { value: page.total, unit: "count" },
                  detail: "זימונים שלא נקלטו",
                  color: page.total ? "var(--danger)" : undefined,
                },
              ]}
            />
          </div>
          <UnparsedInvitationsList
            id="unparsed-list"
            page={page}
            receivedLabel={notificationTimeLabel}
            note={allSimulated ? DEMO_SOURCE_NOTE : undefined}
            footer={
              <Pager
                page={page.page}
                pageCount={page.pageCount}
                prevHref={page.page > 1 ? demoHref.unparsed(role, page.page - 1) : null}
                nextHref={page.page < page.pageCount ? demoHref.unparsed(role, page.page + 1) : null}
                label="עמודי הזימונים"
              />
            }
          />
        </>
      ) : (
        <NoAccessPlaceholder
          id="unparsed-no-access"
          text="לתפקיד הזה אין צפייה בזימונים שלא נקלטו."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}
