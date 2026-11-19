import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloseFlow } from "@/components/tech/visit-flow/CloseFlow";
import { SKELETON_APPROVAL_TEXT, SKELETON_BASE_PATH, SKELETON_REASONS, skeletonPath, skeletonVisit } from "@/components/tech/visit-flow/fixtures";
import { FlowHeader } from "@/components/tech/visit-flow/VisitParts";
import { requireArea } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "סיום ביקור · שלד · ניהול טכנאים" };

// Close screen of the flow skeleton (D81; TE-18 to TE-22): "טופל" with the fixed text, signer and
// signature, or "המשך טיפול" with a reason and the next-visit note. Fake data only.
export default async function SkeletonClosePage({ params }: PageProps<"/tech/visit/skeleton/[key]/close">) {
  await requireArea("tech");
  const { key } = await params;
  const visit = skeletonVisit(key);
  if (!visit || (visit.status !== "go" && visit.status !== "work")) notFound();
  const head = <FlowHeader visit={visit} status="work" backHref={skeletonPath(visit.key, "work")} backLabel="לטיפול" backAriaLabel="חזרה למסך הטיפול" />;
  return <CloseFlow head={head} approvalText={SKELETON_APPROVAL_TEXT} reasons={SKELETON_REASONS} homeHref={SKELETON_BASE_PATH} />;
}
