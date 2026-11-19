import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { TechShell } from "@/components/tech/TechShell";
import { VisitContactTiles } from "@/components/tech/VisitLinks";
import { ArriveAction, ContinueWorkAction, DepartAction } from "@/components/tech/visit-flow/CardActions";
import { ClosedView } from "@/components/tech/visit-flow/ClosedView";
import { SKELETON_BASE_PATH, SKELETON_DEPARTURE_RESULT, skeletonPath, skeletonVisit } from "@/components/tech/visit-flow/fixtures";
import { FlowHeader, VisitDetailsCard, VisitProblemCard } from "@/components/tech/visit-flow/VisitParts";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { wazeHref } from "@/features/visits/data/links";
import { requireArea } from "@/lib/auth/guards";
import { TECH_START_HREFS, TECH_START_TABS } from "../../../_tabs";

export const metadata: Metadata = { title: "כרטיס ביקור · שלד · ניהול טכנאים" };

const BACK = { backHref: SKELETON_BASE_PATH, backLabel: "היום", backAriaLabel: "חזרה לרשימת הביקורים" } as const;

// The visit card of the flow skeleton (D81; TE-02, TE-13, D71, D14): one fake visit per state from
// the server-side fixture, with the action area of its status in the footer. A closed visit is
// read-only and has no actions. Fake data only: no database call, nothing is recorded.
export default async function SkeletonVisitCard({ params }: PageProps<"/tech/visit/skeleton/[key]">) {
  await requireArea("tech");
  const { key } = await params;
  const visit = skeletonVisit(key);
  if (!visit) notFound();
  const head = <FlowHeader visit={visit} {...BACK} />;

  if (visit.closed) {
    return (
      <TechShell head={head} activeTab="home" activeIsCurrent={false} navTabs={TECH_START_TABS} navHrefs={TECH_START_HREFS}>
        <TestDataBanner />
        <ClosedView visit={visit} closed={visit.closed} />
      </TechShell>
    );
  }

  const address = `${visit.street}, ${visit.city}`;
  const workHref = skeletonPath(visit.key, "work");
  let foot: ReactNode = null;
  if (visit.status === "new") foot = <DepartAction wazeHref={wazeHref(address)} result={SKELETON_DEPARTURE_RESULT} />;
  else if (visit.status === "go") foot = <ArriveAction workHref={workHref} />;
  else if (visit.status === "work") foot = <ContinueWorkAction workHref={workHref} />;

  return (
    <TechShell head={head} foot={foot}>
      <TestDataBanner />
      <VisitContactTiles address={address} customerPhone={visit.phone} rep={visit.rep} />
      <VisitDetailsCard visit={visit} />
      <VisitProblemCard visit={visit} />
    </TechShell>
  );
}
