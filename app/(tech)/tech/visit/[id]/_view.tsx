import { notFound } from "next/navigation";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { VisitHistory } from "@/components/tech/VisitHistory";
import { VisitInfoCard, VisitPickup, VisitProblem } from "@/components/tech/VisitInfo";
import { PlaceWazeLink } from "@/components/tech/VisitLinks";
import { ClosedView } from "@/components/tech/visit-flow/ClosedView";
import { VisitFlow, type FlowStep } from "@/components/tech/visit-flow/VisitFlow";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestDataBanner, TestPill, VisitSourceLine } from "@/components/ui/TestBadge";
import { ddmm } from "@/features/calendar/data/dates";
import { wazeHref } from "@/features/visits/data/links";
import { TECH_HOME_PATH, techVisitPath } from "@/features/visits/data/paths";
import type { VisitDetail } from "@/features/visits/data/types";
import type { TechVisitView as TechVisitData } from "@/features/visits/supabase/tech";
import type { SessionUser } from "@/features/auth/data/types";
import { APPROVAL_TEXT_V1 } from "@/features/visit-flow/rules";
import { flowContext, visitPhotos } from "@/lib/data/visit-flow";
import { TECH_START_HREFS, TECH_START_TABS } from "../../_tabs";

/** "מס׳ פנייה 48213 · משימה 2 · ביקור 1" (D60 (3): the invitation's reference number, "מס׳ פנייה"). */
function metaOf(v: Pick<VisitDetail, "task" | "n"> & { call: { req: string } }): string {
  const parts = [v.call.req ? `מס׳ פנייה ${v.call.req}` : "", `משימה ${v.task}`, `ביקור ${v.n}`].filter(Boolean);
  return parts.join(" · ");
}

// The technician's visit (Step 3 card + D95 visit flow), on real data only, addressed by the visit's
// id; shared by /tech/visit/[id] and its /work and /close entries (the step the flow opens on).
// Each page checks the session itself (requireArea("tech")) and reads the visit under the signed-in
// Technician's own session (RLS): his own visit only; another technician's visit, a cancelled visit
// (D60 (1)) or an unknown id is "not found" (404), with nothing of it rendered. Open visit: the client flow (components/tech/visit-flow/VisitFlow.tsx) with the card's
// details rendered here. Closed visit: read-only (D14, TE-26) with its photos as short-lived signed
// links. No field times for the technician (D68).
export async function VisitScreen({ me, view, step }: { me: SessionUser; view: TechVisitData; step: FlowStep }) {
  const visit = view.detail;
  const showsTestData = visit.call.isTest || visit.customer.isTest || visit.product.isTest;
  const title = visit.customer.name || `ביקור ${visit.n} · ${ddmm(visit.date)}`;

  if (view.kind === "closed") {
    const photos = view.detailsAvailable ? await visitPhotos(me, view.id) : [];
    const head = (
      <VisitHeader
        backHref={TECH_HOME_PATH}
        backLabel="היום"
        backAriaLabel="חזרה למסך היום"
        meta={metaOf(visit)}
        title={title}
        trailing={
          <>
            {visit.call.isTest && <TestPill />}
            <StatusPill status={visit.status} />
          </>
        }
      />
    );
    return (
      <TechShell head={head} activeTab="home" activeIsCurrent={false} navTabs={TECH_START_TABS} navHrefs={TECH_START_HREFS}>
        {showsTestData && <TestDataBanner />}
        <ClosedView visit={view.detail} photos={photos} reduced={!view.detailsAvailable} />
      </TechShell>
    );
  }

  const ctx = await flowContext(me, view.id);
  if (!ctx) notFound();
  const status = visit.status;
  if (status !== "new" && status !== "go" && status !== "work") notFound();
  const { customer: cu, call } = view.detail;
  const address = `${cu.address.street}, ${cu.address.city}`;
  const details = (
    <>
      <VisitHistory items={view.history} />
      <VisitInfoCard visit={view.detail} />
      <VisitProblem problem={call.problem} techNote={call.techNote} />
      <VisitPickup pickup={visit.pickup} action={visit.pickup && <PlaceWazeLink place={visit.pickup.place} address={visit.pickup.placeAddress} />} />
      <VisitSourceLine source={visit.source} />
    </>
  );
  return (
    <VisitFlow
      userId={me.id}
      visitId={view.id}
      serverStatus={status}
      fieldVersion={ctx.fieldVersion}
      isTest={showsTestData}
      meta={metaOf(visit)}
      title={title}
      homeHref={TECH_HOME_PATH}
      basePath={techVisitPath(view.id)}
      initialStep={step}
      address={address}
      customerPhone={cu.phone}
      rep={call.representative}
      wazeHref={wazeHref(address)}
      approvalText={APPROVAL_TEXT_V1}
      reasons={ctx.reasons}
      details={details}
    />
  );
}
