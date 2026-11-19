import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
// CallDetail (D60 (5): header, "פרטי הקריאה", "לקוח וכתובת", "שיבוץ", one card per visit). The guard
// is the real one (requireArea, the matrix key `calls`); no call is read: whatever number is in the
// address shows the same fictional call. The real read replaces this after the owner approves.
export default async function OfficeCallCardPage({ params }: PageProps<"/office/calls/[req]">) {
  const me = await requireArea("office");
  if (!readsCalls(me)) redirect(LOGIN_NO_ACCESS_PATH);
  const { req } = await params;
  if (!/^[0-9]{1,12}$/.test(req) || !(await callsPermitted())) notFound();
  return (
    <OfficeFrame me={me} active="calls">
      <TestDataBanner />
      <CallDetail call={skeletonCall(req)} backHref={OFFICE_CALLS_PATH} showReport />
    </OfficeFrame>
  );
}
