import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CallContactActions } from "@/components/office/CallContactActions";
import { CallDetail } from "@/components/office/CallDetail";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { OFFICE_CALLS_PATH } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { isRequestNumber } from "@/features/calls/supabase/card-queries";
import { readsCalls } from "@/features/calls/supabase/list-queries";
import { requireArea } from "@/lib/auth/guards";
import { callCard, callsPermitted, cardPermitted } from "@/lib/data/supabase/calls";
import { OfficeFrame } from "../../_OfficeFrame";

export const metadata: Metadata = { title: "כרטיס קריאה · ניהול טכנאים" };

// The office call card on real data (D60 (5), D88; the skeleton approved 19.11). Server-side, under
// the signed-in office user's own session (RLS): the area guard (office), the office roles that
// read calls (Creator, Manager, Customer Service; never a Technician), and the matrix key `calls`
// (D33). The call, its visits with the office-only field times (D68), the customer, the warranty
// and the customer's other calls are read by lib/data/supabase/calls.ts. A malformed number, a call
// that does not exist and a call the caller may not read are the same 404. The technician's
// report (summary, photos, signature) needs the key `card` as well; the database applies the same
// rule. "התקשר לטכנאי" appears only when the technician's phone is readable and set.
export default async function OfficeCallCardPage({ params }: PageProps<"/office/calls/[req]">) {
  const me = await requireArea("office");
  if (!readsCalls(me)) redirect(LOGIN_NO_ACCESS_PATH);
  const { req } = await params;
  if (!isRequestNumber(req) || !(await callsPermitted())) notFound();
  const [call, showReport] = await Promise.all([callCard(req), cardPermitted()]);
  if (!call) notFound();
  const { technician, ...detail } = call;
  const hasTest = call.isTest || call.visits.some((v) => v.source === "simulator");
  return (
    <OfficeFrame me={me} active="calls">
      {hasTest && <TestDataBanner />}
      <CallDetail
        call={detail}
        backHref={OFFICE_CALLS_PATH}
        showReport={showReport}
        perFieldTestMarks={false}
        actions={<CallContactActions tech={technician} customer={{ name: call.customer.name, phone: call.customer.phone }} />}
      />
    </OfficeFrame>
  );
}
