import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SKELETON_WORK_PHOTOS, skeletonPath, skeletonVisit } from "@/components/tech/visit-flow/fixtures";
import { FlowHeader } from "@/components/tech/visit-flow/VisitParts";
import { WorkFlow } from "@/components/tech/visit-flow/WorkFlow";
import { requireArea } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "טיפול · שלד · ניהול טכנאים" };

// Work screen of the flow skeleton (D81; TE-14, TE-15): reached from "הגעתי · התחלת טיפול" (en
// route) or "המשך לטיפול" (in progress). The status shown is "בטיפול". Fake data only.
export default async function SkeletonWorkPage({ params }: PageProps<"/tech/visit/skeleton/[key]/work">) {
  await requireArea("tech");
  const { key } = await params;
  const visit = skeletonVisit(key);
  if (!visit || (visit.status !== "go" && visit.status !== "work")) notFound();
  const head = <FlowHeader visit={visit} status="work" backHref={skeletonPath(visit.key)} backLabel="פרטי קריאה" backAriaLabel="חזרה לכרטיס הביקור" />;
  const seeded = visit.status === "work" ? SKELETON_WORK_PHOTOS : { before: [], after: [] };
  return <WorkFlow head={head} seeded={seeded} closeHref={skeletonPath(visit.key, "close")} />;
}
