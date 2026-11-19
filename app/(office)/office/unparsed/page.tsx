import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InvitationSimulator } from "@/components/office/InvitationSimulator";
import { UnparsedInvitationsList } from "@/components/office/UnparsedInvitationsList";
import { Pager } from "@/components/ui/Pager";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { accountTimeLabel } from "@/features/accounts/data/time-label";
import { OFFICE_UNPARSED_PATH } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { readsIntake } from "@/features/calendar/supabase/intake-queries";
import { clampPage, DEFAULT_PAGE_LIMIT } from "@/features/data-access/common";
import { jerusalemDate } from "@/features/dashboards/data/time";
import { runInvitationSimulator } from "@/lib/actions/calendar-simulator";
import { requireArea } from "@/lib/auth/guards";
import { calendarSimulatorEnabled } from "@/lib/calendar/simulator-env";
import { intakeQueries, simulatorTechnicians } from "@/lib/data/supabase/intake";
import { OfficeFrame } from "../_OfficeFrame";

export const metadata: Metadata = { title: "זימונים שלא נקלטו · ניהול טכנאים" };

/** The environment line of a test environment: every invitation comes from the simulator (D23, D24, SIM-14). */
const SIMULATOR_SOURCE_NOTE = "בסביבת הבדיקה הזימונים מגיעים מסימולטור הזימונים (🧪 זימון בדיקה): Microsoft 365 עדיין לא מחובר.";

/** `/office/unparsed?page=n` (page 1 has no parameter). */
const pageHref = (page: number): string => (page > 1 ? `${OFFICE_UNPARSED_PATH}?page=${page}` : OFFICE_UNPARSED_PATH);

// "זימונים שלא נקלטו" (QA S-05; D57 (1), D60 (4), (11); spec "Invitation intake", IN-01 to IN-04,
// OF-16): the invitations the single ingestion service could not ingest, newest first, 40 per page,
// each with structured, readable Hebrew reasons and the information needed to fix it in Outlook.
// Real data only (D61): the open rows of `calendar_ingestion_errors` (Migration 6), read under the
// viewer's own session (RLS) by lib/data/supabase/intake.ts. No action on a row: the fix is in the
// invitation itself, and the corrected invitation leaves the list when it is ingested (D08).
// Who sees it: every office role (D57 (1), D60 (4); the gating matrix key is open decision #15, a
// TEMPORARY fixed rule here and in the database's policy, Step 6 OQ-1).
// The Outlook invitation simulator (D24; D60 (11)): its button is rendered only when the server says
// the simulator is on in this environment (CALENDAR_SIMULATOR=1, never on Vercel Production;
// lib/calendar/simulator-env.ts) and the viewer is a Manager, Creator or Customer Service user. No UI
// toggle; when it is off nothing of it reaches the browser, and the server action answers
// "not-found" anyway.
// Guard, at the time of the request (never a layout or the proxy): requireArea("office") sends
// anonymous visitors to /login and Technicians or accounts without access to the no-access state. A
// failed read throws (a code only, logged): the page fails closed.
export default async function OfficeUnparsedPage({ searchParams }: PageProps<"/office/unparsed">) {
  const me = await requireArea("office");
  if (!readsIntake(me)) redirect(LOGIN_NO_ACCESS_PATH);

  const sp = await searchParams;
  const requested = clampPage(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const simulatorOn = calendarSimulatorEnabled();
  const [page, technicians] = await Promise.all([
    (await intakeQueries()).unparsedInvitations({ page: requested, limit: DEFAULT_PAGE_LIMIT }),
    simulatorOn ? simulatorTechnicians() : Promise.resolve([]),
  ]);
  const now = new Date();
  const today = jerusalemDate(now.toISOString()) ?? now.toISOString().slice(0, 10);
  const includesTestData = page.items.some((x) => x.isTest);
  const allSimulated = page.items.length > 0 && page.items.every((x) => x.source === "simulator");

  return (
    <OfficeFrame me={me} active="unparsed">
      {includesTestData && <TestDataBanner />}
      <div className="ptitle">
        <div>
          <h1>זימונים שלא נקלטו</h1>
          <div className="sub">זימונים שמערכת הקליטה לא קלטה, עם הסיבה ומה צריך לתקן. התיקון נעשה בזימון עצמו.</div>
        </div>
        {simulatorOn && <InvitationSimulator run={runInvitationSimulator} technicians={technicians} today={today} />}
      </div>
      <UnparsedInvitationsList
        id="unparsed-list"
        page={page}
        receivedLabel={(iso) => accountTimeLabel(iso, now)}
        note={allSimulated || simulatorOn ? SIMULATOR_SOURCE_NOTE : undefined}
        footer={
          <Pager
            page={page.page}
            pageCount={page.pageCount}
            prevHref={page.page > 1 ? pageHref(page.page - 1) : null}
            nextHref={page.page < page.pageCount ? pageHref(page.page + 1) : null}
            label="עמודי הזימונים"
          />
        }
      />
    </OfficeFrame>
  );
}
