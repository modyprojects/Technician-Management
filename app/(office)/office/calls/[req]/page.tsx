import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import { OFFICE_CALLS_PATH } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { readsCalls } from "@/features/calls/supabase/list-queries";
import { requireArea } from "@/lib/auth/guards";
import { callCardBrief, callsPermitted } from "@/lib/data/supabase/calls";
import { OfficeFrame } from "../../_OfficeFrame";

export const metadata: Metadata = { title: "כרטיס קריאה · ניהול טכנאים" };

// TEMPORARY: the address a calls-list row opens (/office/calls/<מס׳ פנייה>). The call card itself
// (QA S-07 to S-12, M-05) is the next screen; until it is built this page shows only what identifies
// the call (its number, customer, status and test marker), read under the viewer's own session, and a
// way back. Guarded like the list (requireArea, the matrix key `calls`); a malformed number, or a
// call that does not exist or that the viewer may not read, is a 404 (no difference is shown).
export default async function OfficeCallCardPage({ params }: PageProps<"/office/calls/[req]">) {
  const me = await requireArea("office");
  if (!readsCalls(me)) redirect(LOGIN_NO_ACCESS_PATH);
  const { req } = await params;
  if (!(await callsPermitted())) notFound();
  const call = await callCardBrief(req);
  if (!call) notFound();
  return (
    <OfficeFrame me={me} active="calls">
      <div className="ptitle">
        <div>
          <Link className="lnk" href={OFFICE_CALLS_PATH} prefetch={false}>
            › חזרה לקריאות
          </Link>
          <h1>
            {call.customer} · מס׳ פנייה <span className="num">{call.req}</span>
          </h1>
        </div>
      </div>
      <section className="card sec" aria-labelledby="call-temp-h">
        <h2 id="call-temp-h" className="sr-only">
          כרטיס הקריאה
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <CallStatusPill status={call.status} />
          {call.isTest && <TestBadge label />}
        </div>
        <p className="sub" style={{ margin: "10px 0 0" }}>
          כרטיס הקריאה המלא (פרטי הקריאה, לקוח וכתובת, שיבוץ וכרטיס לכל ביקור) הוא המסך הבא שייבנה.
        </p>
      </section>
    </OfficeFrame>
  );
}
