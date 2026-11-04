import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoneVisitHeader, DoneVisitView } from "@/components/tech/DoneVisitView";
import { SyncVisitPanel } from "@/components/tech/SyncVisitPanel";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { VisitHistory } from "@/components/tech/VisitHistory";
import { VisitInfoCard, VisitPickup, VisitProblem } from "@/components/tech/VisitInfo";
import { PhoneIcon, UserIcon, WhatsAppIcon } from "@/components/ui/Icons";
import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import type { VisitDetail, VisitRef } from "@/features/visits/data/types";
import { DemoTechFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { notificationTimeLabel } from "../../../../_data/dates";
import { techVisitParams } from "../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NavTile, PlaceWazeButton } from "../../../_DemoNav";
import { LiveStatusPill } from "../../../_VisitStatus";
import { VisitFoot, WazeTile } from "./_VisitFlow";

export const dynamicParams = false;

export function generateStaticParams() {
  return techVisitParams();
}

/** The demo technician's visit, or null (another technician's visit is not his to open). */
async function myVisit(req: string, n: string): Promise<VisitDetail | null> {
  const visit = await demoDataAccess.visits.get({ req, n: Number(n) });
  return visit && visit.technician.id === DEMO_TECHNICIAN_ID ? visit : null;
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await myVisit(req, n);
  return { title: visit ? `${visit.customer.name} · ביקור ${visit.n} · הדגמה` : "כרטיס ביקור · הדגמה" };
}

const BACK = { backHref: demoHref.tech(), backLabel: "היום", backAriaLabel: "חזרה למסך היום" } as const;

/**
 * The visit's sync state on the device (TE-23, TE-24): sync.visit(DEMO_TECHNICIAN_ID, ref); nothing
 * when the device holds nothing about the visit.
 */
async function VisitSync({ visitRef }: { visitRef: VisitRef }) {
  const sync = await demoDataAccess.sync.visit(DEMO_TECHNICIAN_ID, visitRef);
  return sync ? <SyncVisitPanel sync={sync} timeLabel={notificationTimeLabel} /> : null;
}

/**
 * A closed visit opened at its visit-card address (a notification, a hand-written URL): the same
 * read-only view as "הושלמו היום" (DoneVisitView; docs/demo.html techDoneView(); D14, TE-26), read
 * through visits.doneVisit (no field times, TE-25), with "› חזרה" to the technician's day.
 */
async function ClosedVisit({ visitRef }: { visitRef: VisitRef }) {
  const visit = await demoDataAccess.visits.doneVisit(DEMO_TECHNICIAN_ID, visitRef);
  if (!visit) notFound();
  return (
    <DemoTechFrame
      activeTab="home"
      activeIsCurrent={false}
      head={<DoneVisitHeader visit={visit} backHref={BACK.backHref} backAriaLabel={BACK.backAriaLabel} />}
    >
      <DoneVisitView visit={visit} sync={<VisitSync visitRef={visitRef} />} />
    </DemoTechFrame>
  );
}

// Technician visit card (docs/demo.html techCall() L517-551; TE-05 to TE-13).
// Reads only through the data-access layer: visits.get(ref) and, while the visit is open,
// visits.history(ref) (D36: earlier closed visits of the same call, only while the technician
// has a current assignment on it). The page enforces D36 here (history only for his open visit);
// the production adapter enforces it under the session and RLS. Another technician's visit is
// not found (G-03: production takes identity from the session; RLS enforces it).
// Open visit: "↻ ביקור המשך" history, the action tiles (Waze runs visits.depart on a scheduled
// visit; dial, WhatsApp and the rep are navigation), the details, fault, technician notes, pickup
// and the visit source, with "הגעתי · התחלת טיפול" (visits.arrive) or "המשך לטיפול ›" below.
// Closed visit: the read-only view of "הושלמו היום" (DoneVisitView, D14), with the bottom navigation
// as the demo's "הושלמו" view; the home's "לו"ז היום" and the landing link straight to
// tech/done/[req]/[n], the home's sync banner links here (its back link returns to "היום").
// Both: the visit's sync state on the device (sync.visit; TE-23, TE-24) when the device holds
// work of it, with "נסה שוב" and "סנכרן עכשיו" (simulated, useCommands().sync).
export default async function TechVisitPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">) {
  const { req, n } = await params;
  const visit = await myVisit(req, n);
  if (!visit) notFound();
  if (!visit.editable) return <ClosedVisit visitRef={{ req: visit.req, n: visit.n }} />;

  const ref = { req: visit.req, n: visit.n };
  const history = await demoDataAccess.visits.history(ref);
  const { customer: cu, call } = visit;
  const rep = call.representative;
  const address = `${cu.address.street}, ${cu.address.city}`;

  return (
    <DemoTechFrame
      head={
        <VisitHeader
          {...BACK}
          meta={`פנייה ${call.req} · משימה ${visit.task} · ביקור ${visit.n}`}
          title={cu.name}
          trailing={
            <>
              {call.isTest && <TestBadge />}
              <LiveStatusPill visit={ref} status={visit.status} />
            </>
          }
        />
      }
      foot={<VisitFoot visit={ref} status={visit.status} workHref={demoHref.work(visit.req, visit.n)} />}
    >
      <VisitHistory items={history} />
      <div role="group" aria-label="ניווט ויצירת קשר" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <WazeTile visit={ref} status={visit.status} address={address} />
        <NavTile
          icon={<PhoneIcon />}
          label="לקוח"
          ariaLabel={`לקוח · חיוג ${cu.phone}`}
          sim={`חיוג ללקוח · ${cu.phone} · לא מתבצעת שיחה בהדגמה`}
        />
        <NavTile
          icon={<WhatsAppIcon />}
          label="וואטסאפ"
          ariaLabel={`וואטסאפ ללקוח · ${cu.phone}`}
          sim={`וואטסאפ ללקוח · ${cu.phone} · לא נפתח בהדגמה`}
        />
        <NavTile
          icon={<UserIcon />}
          label="נציגה"
          ariaLabel={rep.phone ? `נציגה · חיוג ל${rep.name} ${rep.phone}` : `נציגה · ${rep.name} · אין מספר טלפון`}
          sim={`חיוג לנציגה ${rep.name} · ${rep.phone ?? ""} · לא מתבצעת שיחה בהדגמה`}
          disabled={!rep.phone}
        />
      </div>
      <VisitInfoCard visit={visit} />
      <VisitProblem problem={call.problem} techNote={call.techNote} />
      <VisitPickup
        pickup={visit.pickup}
        action={visit.pickup && <PlaceWazeButton place={visit.pickup.place} address={visit.pickup.placeAddress} />}
      />
      <VisitSync visitRef={ref} />
      <VisitSourceLine source={visit.source} />
    </DemoTechFrame>
  );
}
