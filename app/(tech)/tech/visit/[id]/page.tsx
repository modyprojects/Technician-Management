import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoneVisitView } from "@/components/tech/DoneVisitView";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { VisitHistory } from "@/components/tech/VisitHistory";
import { VisitInfoCard, VisitPickup, VisitProblem } from "@/components/tech/VisitInfo";
import { PlaceWazeLink, VisitContactTiles } from "@/components/tech/VisitLinks";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import { ddmm } from "@/features/calendar/data/dates";
import { TECH_HOME_PATH } from "@/features/visits/data/paths";
import type { VisitDetail } from "@/features/visits/data/types";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { TECH_START_HREFS, TECH_START_TABS } from "../../_tabs";

export const metadata: Metadata = { title: "כרטיס ביקור · ניהול טכנאים" };

const BACK = { backHref: TECH_HOME_PATH, backLabel: "היום", backAriaLabel: "חזרה למסך היום" } as const;

/** "מס׳ פנייה 48213 · משימה 2 · ביקור 1" (D60 (3): the invitation's reference number, "מס׳ פנייה"). */
function metaOf(v: Pick<VisitDetail, "task" | "n"> & { call: { req: string } }): string {
  const parts = [v.call.req ? `מס׳ פנייה ${v.call.req}` : "", `משימה ${v.task}`, `ביקור ${v.n}`].filter(Boolean);
  return parts.join(" · ");
}

// The technician's visit card (docs/demo.html techCall() L517-551; TE-05 to TE-13; Step 3), on real
// data only (D61), addressed by the visit's id. Read under the signed-in Technician's own session
// (lib/data/supabase/tech-visits.ts): his own visit only (RLS); another technician's visit, a
// cancelled visit (D60 (1)) or an unknown id is "not found" (404), with nothing of it rendered.
// Open visit: "↻ ביקור המשך" with the call's earlier closed visits (D36, previous_visits), the
// action tiles as real links (Waze deep link, `tel:` and WhatsApp to the customer, `tel:` to the
// handling representative's work phone, TE-07, D40), the details card (address, building / floor /
// apartment, arrival notes, phone, customer number TE-09, call type, product, SKU, warranty with
// "לא צוין" TE-08 and "₪ ביקור בתשלום" TE-11, handling rep), the fault, "הערות לטכנאי" (TE-10), the
// pickup with "Waze ›", and the visit source (TE-12, SIM-14); 🧪 badges on test records (D47).
// Closed visit ("טופל" / "המשך טיפול"): read-only (D14, TE-26) with the summary, the follow-up reason
// and next-visit note, and the approval text preserved at signing with the signer (D43). No field
// times for the technician (TE-25, open decision 2).
// TEMPORARY (Step 3; the visit flow follows in the next screen): no "הגעתי · התחלת טיפול" footer.
export default async function TechVisitPage({ params }: PageProps<"/tech/visit/[id]">) {
  const me = await requireArea("tech");
  const { id } = await params;
  const queries = await techVisitsQueries(me);
  const view = await queries.visit(id);
  if (!view) notFound();
  const visit = view.detail;
  const title = visit.customer.name || `ביקור ${visit.n} · ${ddmm(visit.date)}`;
  const trailing = (
    <>
      {visit.call.isTest && <TestBadge />}
      <StatusPill status={visit.status} />
    </>
  );

  if (view.kind === "closed") {
    return (
      <TechShell
        head={<VisitHeader {...BACK} meta={metaOf(visit)} title={title} trailing={trailing} />}
        activeTab="home"
        activeIsCurrent={false}
        navTabs={TECH_START_TABS}
        navHrefs={TECH_START_HREFS}
      >
        <DoneVisitView visit={view.detail} />
      </TechShell>
    );
  }

  const { customer: cu, call } = view.detail;
  const address = `${cu.address.street}, ${cu.address.city}`;
  return (
    <TechShell head={<VisitHeader {...BACK} meta={metaOf(visit)} title={title} trailing={trailing} />}>
      <VisitHistory items={view.history} />
      <VisitContactTiles address={address} customerPhone={cu.phone} rep={call.representative} />
      <VisitInfoCard visit={view.detail} />
      <VisitProblem problem={call.problem} techNote={call.techNote} />
      <VisitPickup pickup={visit.pickup} action={visit.pickup && <PlaceWazeLink place={visit.pickup.place} address={visit.pickup.placeAddress} />} />
      <VisitSourceLine source={visit.source} />
    </TechShell>
  );
}
