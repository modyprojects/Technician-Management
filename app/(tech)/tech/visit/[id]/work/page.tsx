import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FieldVisitProvider } from "@/components/tech/FieldVisitProvider";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { WorkFooter } from "@/components/tech/WorkFooter";
import { WorkScreen } from "@/components/tech/WorkScreen";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { techClosePath, techVisitPath } from "@/features/visits/data/paths";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { FIELD_ACTIONS } from "../../../_field";

export const metadata: Metadata = { title: "טיפול · ניהול טכנאים" };

// The work screen of a visit in progress (docs/demo.html techWork() L552-575; TE-14, TE-15; Step 4,
// Version 1), on real data only (D61): photos before (optional) and after (required, TE-14), taken
// with the camera or picked, compressed in the browser (D13) and stored in the private bucket
// through the Migration 7 writers under the technician's own session; the written summary (a draft
// on this device until the closure stores it; recordings and transcription are Version 2); no parts
// card (Version 2). Only the visit's own technician, only while it is in progress: any other state
// goes back to the visit card; another technician's or a cancelled visit is 404.
export default async function TechWorkPage({ params }: PageProps<"/tech/visit/[id]/work">) {
  const me = await requireArea("tech");
  const { id } = await params;
  const queries = await techVisitsQueries(me);
  const view = await queries.visit(id);
  if (!view) notFound();
  if (view.kind !== "open" || view.detail.status !== "work") redirect(techVisitPath(view.id));
  const photos = await queries.photos(view.id);
  const visit = view.detail;
  const ref = { req: visit.call.req || view.id, n: visit.n };
  const seed = { media: photos, summary: "", recordingSeconds: 0, parts: [] };
  const field = { visitId: view.id, fieldVersion: view.fieldVersion, isTest: visit.isTest, reasons: [] };
  return (
    <TechShell
      head={
        <VisitHeader
          backHref={techVisitPath(view.id)}
          backLabel="כרטיס ביקור"
          backAriaLabel="חזרה לכרטיס הביקור"
          meta={`טיפול · ביקור ${visit.n}`}
          title={visit.customer.name || `ביקור ${visit.n}`}
          trailing={
            <>
              {visit.call.isTest && <TestPill />}
              <StatusPill status={visit.status} />
            </>
          }
        />
      }
      foot={<WorkFooter visit={ref} seed={seed} closeHref={techClosePath(view.id)} />}
    >
      <FieldVisitProvider actions={FIELD_ACTIONS} visit={field}>
        <WorkScreen visit={ref} seed={seed} pickupItem={null} real />
      </FieldVisitProvider>
    </TechShell>
  );
}
