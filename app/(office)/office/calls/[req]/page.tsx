import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CallContactActions } from "@/components/office/CallContactActions";
import { CallDetail } from "@/components/office/CallDetail";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { OFFICE_CALLS_PATH } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { readsCalls } from "@/features/calls/supabase/list-queries";
import { requireArea } from "@/lib/auth/guards";
import { callsPermitted } from "@/lib/data/supabase/calls";
import { OfficeFrame } from "../../_OfficeFrame";
import { skeletonCall } from "./_skeletonData";

export const metadata: Metadata = { title: "כרטיס קריאה · ניהול טכנאים" };

// SKELETON (D81): the call card on fictional data, for the owner's review of the layout. It reuses
// CallDetail (D60 (5): header with call buttons, visits first, "לקוח וכתובת", "פרטי הקריאה", other calls). The guard
// is the real one (requireArea, the matrix key `calls`); no call is read: whatever number is in the
// address shows the same fictional call. The real read replaces this after the owner approves.
export default async function OfficeCallCardPage({ params }: PageProps<"/office/calls/[req]">) {
  const me = await requireArea("office");
  if (!readsCalls(me)) redirect(LOGIN_NO_ACCESS_PATH);
  const { req } = await params;
  if (!/^[0-9]{1,12}$/.test(req) || !(await callsPermitted())) notFound();
  const call = skeletonCall(req);
  const lastVisit = [...call.visits].sort((a, b) => b.n - a.n)[0];
  return (
    <OfficeFrame me={me} active="calls">
      <TestDataBanner />
      <CallDetail
        call={call}
        backHref={OFFICE_CALLS_PATH}
        showReport
        perFieldTestMarks={false}
        actions={
          <CallContactActions
            tech={lastVisit?.tech.phone ? { name: lastVisit.tech.name, phone: lastVisit.tech.phone } : null}
            customer={{ name: call.customer.name, phone: call.customer.phone }}
          />
        }
      />
    </OfficeFrame>
  );
}
