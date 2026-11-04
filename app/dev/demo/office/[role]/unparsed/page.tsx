import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pager } from "@/components/ui/Pager";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { clampPage } from "@/features/data-access/common";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { jerusalemDateTime, ddmm } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS, WORK_QUEUE_SCREENS_DECISION, workQueueScreensOffered } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../_Placeholder";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/unparsed">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `זימונים שלא נקלטו · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** "21.10 09:02". */
function receivedLabel(iso: string): string {
  const local = jerusalemDateTime(iso);
  return local ? `${ddmm(local.date)} ${local.time}` : "";
}

// "זימונים שלא נקלטו" (spec office screens, OF-16, IN-03, IN-04): invitations the ingestion
// service could not ingest, with the missing or invalid field; an unknown SKU is never a reason
// (IN-02, D19). Intake is event-driven (D08). The email to the rep is pending d09 (never shown as
// sent). Who sees the screen is open decision #15 (d23): a TEMPORARY fixed rule for every office
// role (roles.ts workQueueScreensOffered) with a visible pending hint. PHASE F SCAFFOLD: the body
// is a placeholder list. Reads only through the layer: intake.unparsedInvitations (?page=).
export default async function OfficeUnparsedPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/unparsed">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = workQueueScreensOffered(role);
  const sp = await searchParams;
  const page = offered
    ? await demoDataAccess.intake.unparsedInvitations({ page: clampPage(Array.isArray(sp.page) ? sp.page[0] : sp.page) })
    : null;

  return (
    <DemoOfficeFrame role={role} active="unparsed">
      <div className="ptitle">
        <div>
          <h1>זימונים שלא נקלטו</h1>
          <div className="sub">{pendingDecisionHint(WORK_QUEUE_SCREENS_DECISION)}</div>
        </div>
      </div>
      {page ? (
        <ScreenPlaceholder
          id="unparsed-list"
          heading="זימונים שממתינים לתיקון"
          note="המסך בבנייה (שלב F)"
          total={page.total}
          rows={page.items.map((x) => ({
            key: x.id,
            primary: x.subject,
            secondary: `התקבל ${receivedLabel(x.receivedAt)} · ${x.organizer.name ?? x.organizer.email} · ${x.problems
              .map((p) => (p.kind === "missing" ? `חסר: ${p.label}` : p.kind === "unknown-place" ? `מקום איסוף לא מוכר: ${p.value}` : `ערך לא תקין ב${p.label}: ${p.value}`))
              .join(" · ")} · מייל לנציגה: ${pendingDecisionHint(x.repMail.decision)}`,
            isTest: x.isTest,
          }))}
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
