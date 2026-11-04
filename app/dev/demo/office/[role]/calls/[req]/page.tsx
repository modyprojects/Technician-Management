import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallDetail } from "@/components/office/CallDetail";
import { VisitCorrections } from "@/components/office/VisitCorrections";
import { visitCorrectionView } from "@/components/office/VisitCorrectionView";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import { offers } from "@/features/reference/data/permissions";
import { isClosedVisitStatus, isOpenVisitStatus, type VisitCorrectionHistory } from "@/features/visits/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../../_data/adapter";
import { notificationTimeLabel } from "../../../../_data/dates";
import { officeCallParams } from "../../../../_data/params";
import { closedVisitCorrectionsOffered, customersOffered, isOfficeRole } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { correctionsState } from "../../_simulatedState";
import { CallActions } from "./_CallActions";
import { callDetailData } from "./_callDetailData";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeCallParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">): Promise<Metadata> {
  const { req } = await params;
  const c = await demoDataAccess.calls.get(req);
  return { title: c ? `${c.customer.name} · פנייה ${c.req} · הדגמה` : "כרטיס קריאה · הדגמה" };
}

/**
 * Recording control for roles with the matrix key `recordings` (D37): simulated playback.
 * TODO(OF-06): no media port yet. Playback needs a short-lived signed media link from a server
 * port (never a public URL); until then data-sim shows the simulated notice (data-sim stays only
 * for navigation affordances once that port exists).
 */
function playRecording(v: TimelineVisit) {
  return (
    <button type="button" className="btn" data-sim={`השמעת הקלטה ${v.recLabel ?? ""} · ביקור ${v.n}`}>
      <span aria-hidden="true">▶ </span>
      הקלטה <span className="num">{v.recLabel}</span>
    </button>
  );
}

// Office service-call card (demo offCard(), screens 2-4): customer, call and product details,
// assignment, visit timeline and the header actions (a simulated dial; cancel pending d08).
// Reads only through the data-access layer (calls.get, calls.customerHistory,
// reference.permissions, visits.corrections, reference.reasons). The customer section links to
// the customer card (OF-16, `calls`). What each role sees follows the role's matrix values (D33,
// temporary per D51); this only shapes the demo screen (G-04).
// OF-10 (D14): every server-closed visit shows its "תיקונים" (originals kept, who, when, reason)
// where the role's screens show the technician's report (`card`, which also gates
// `visit_corrections` reads); "תיקון ביקור סגור" only for the Manager and the Creator (a fixed
// capability, closedVisitCorrectionsOffered; never a matrix key, D33). The correction runs only
// through useCommands().visits.correct (simulated): the state it is checked against (each closed
// visit's version, current values, correctable fields, the active follow-up reasons and the
// signed-in user's name, never an account id) is nested here only (correctionsState; deny by
// default elsewhere).
export default async function OfficeCallPage({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">) {
  const { role, req } = await params;
  if (!isOfficeRole(role)) notFound();
  const [c, customerCalls, permissions] = await Promise.all([
    demoDataAccess.calls.get(req),
    demoDataAccess.calls.customerHistory(req),
    demoDataAccess.reference.permissions(role),
  ]);
  if (!c) notFound();
  const last = c.visits[c.visits.length - 1]?.technician;
  const showReport = offers(permissions, "card");

  // Corrections are report content: read only where the role's screens show the report.
  const histories: VisitCorrectionHistory[] = showReport
    ? (
        await Promise.all(
          c.visits.filter((v) => isClosedVisitStatus(v.status)).map((v) => demoDataAccess.visits.corrections({ req: c.req, n: v.n })),
        )
      ).filter((h): h is VisitCorrectionHistory => h !== null)
    : [];
  const canCorrect = closedVisitCorrectionsOffered(role) && histories.length > 0;
  const activeReasons = canCorrect ? (await demoDataAccess.reference.reasons()).filter((r) => r.active).map((r) => r.name) : [];
  const state = await correctionsState(role, histories, activeReasons);
  const historyOf = new Map(histories.map((h) => [h.n, h]));
  const customerName = c.customer.name;

  const renderCorrections = (v: TimelineVisit) => {
    const h = historyOf.get(v.n);
    if (!h) return null;
    return (
      <VisitCorrections
        history={visitCorrectionView(h, notificationTimeLabel)}
        canCorrect={canCorrect}
        reasons={activeReasons}
        title={`פנייה ${h.req} · ביקור ${h.n} · ${customerName}`}
      />
    );
  };

  return (
    <DemoOfficeFrame role={role} active="calls">
      <SimulatedCommandsProvider state={state}>
        <CallDetail
          call={callDetailData(c, customerCalls.items, role)}
          backHref={demoHref.calls(role)}
          customerHref={customersOffered(permissions) ? demoHref.customer(role, c.customer.id) : undefined}
          showReport={showReport}
          renderRecording={offers(permissions, "recordings") ? playRecording : undefined}
          renderVisitExtra={histories.length ? renderCorrections : undefined}
          actions={
            <CallActions
              tech={last ? { name: last.name, phone: last.phone } : null}
              hasOpenVisit={c.visits.some((v) => isOpenVisitStatus(v.status))}
              canCancel={offers(permissions, "cancel")}
            />
          }
        />
      </SimulatedCommandsProvider>
    </DemoOfficeFrame>
  );
}
