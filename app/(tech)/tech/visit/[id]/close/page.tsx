import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CloseFooter } from "@/components/tech/CloseFooter";
import { CloseScreen } from "@/components/tech/CloseScreen";
import { FieldVisitProvider } from "@/components/tech/FieldVisitProvider";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { FIXED_ACK_TEXT, FIXED_ACK_VERSION_ID } from "@/features/visits/data/field";
import { TECH_HOME_PATH, techVisitPath, techWorkPath } from "@/features/visits/data/paths";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { FIELD_ACTIONS } from "../../../_field";

export const metadata: Metadata = { title: "סיום ביקור · ניהול טכנאים" };

// The closure (docs/demo.html techClose() L579-602; TE-18 to TE-22; QA T-02, T-03, T-09; D60 (2);
// Step 4, Version 1): "✓ טופל" (the fixed Version 1 approval text, the signer's name and the
// signature drawn on the canvas, stored as a PNG image) or "↻ המשך טיפול" (an active continuation
// reason and "מה צריך בביקור הבא"). Mandatory fields are listed under the send button, which stays
// locked while sending; the closure is one server action under the technician's own session
// (Migration 7 close_visit: one transaction, server times, the call status per D38; a repeated
// submission is a replay or refused, never a second closure). After the server stored it, the
// existing confirmation screen with "חזרה להיום" (no automatic navigation). Only the visit's own
// technician, only while it is in progress.
export default async function TechClosePage({ params }: PageProps<"/tech/visit/[id]/close">) {
  const me = await requireArea("tech");
  const { id } = await params;
  const queries = await techVisitsQueries(me);
  const view = await queries.visit(id);
  if (!view) notFound();
  if (view.kind !== "open" || view.detail.status !== "work") redirect(techVisitPath(view.id));
  const [photos, reasons] = await Promise.all([queries.photos(view.id), queries.reasons()]);
  const visit = view.detail;
  const ref = { req: visit.call.req || view.id, n: visit.n };
  const seed = { media: photos, summary: "", recordingSeconds: 0, parts: [] };
  const field = { visitId: view.id, fieldVersion: view.fieldVersion, isTest: visit.isTest, reasons };
  return (
    <TechShell
      head={
        <VisitHeader
          backHref={techWorkPath(view.id)}
          backLabel="טיפול"
          backAriaLabel="חזרה למסך הטיפול"
          meta={`סיום ביקור · ביקור ${visit.n}`}
          title={visit.customer.name || `ביקור ${visit.n}`}
          trailing={
            <>
              {visit.call.isTest && <TestPill />}
              <StatusPill status={visit.status} />
            </>
          }
        />
      }
      foot={
        <FieldVisitProvider actions={FIELD_ACTIONS} visit={field}>
          <CloseFooter visit={ref} seed={seed} approvalTextVersionId={FIXED_ACK_VERSION_ID} homeHref={TECH_HOME_PATH} />
        </FieldVisitProvider>
      }
    >
      <CloseScreen
        visit={ref}
        seed={seed}
        reasons={reasons.map((r) => r.label)}
        approvalText={{ versionId: FIXED_ACK_VERSION_ID, text: FIXED_ACK_TEXT }}
        workHref={techWorkPath(view.id)}
        serverConfirmed
      />
    </TechShell>
  );
}
