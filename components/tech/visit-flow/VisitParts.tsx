// Shared pieces of the visit-flow skeleton (D81): the header and the details card of a fake visit.
// Presentational only; no times recorded by the technician are ever shown (D68), no warranty or
// paid-visit marker (D69).
import type { ReactNode } from "react";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { TimeRange } from "@/components/ui/TimeRange";
import type { VisitStatus } from "@/features/visits/data/types";
import { skeletonMeta, type SkeletonVisit } from "./fixtures";

export const H2 = { fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 } as const;

export const Req = () => (
  <span style={{ color: "var(--danger)" }} aria-hidden="true">
    *
  </span>
);

export function FlowHeader({
  visit,
  backHref,
  backLabel,
  backAriaLabel,
  status = visit.status,
}: {
  visit: SkeletonVisit;
  backHref: string;
  backLabel: string;
  backAriaLabel: string;
  status?: VisitStatus;
}) {
  return (
    <VisitHeader
      backHref={backHref}
      backLabel={backLabel}
      backAriaLabel={backAriaLabel}
      meta={skeletonMeta(visit)}
      title={visit.customer}
      trailing={
        <>
          {visit.isTest && <TestPill />}
          <StatusPill status={status} />
        </>
      }
    />
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span>{children}</span>
    </div>
  );
}

/** Address, scheduled window, product and SKU (the planned window is the office's schedule, not a recorded time). */
export function VisitDetailsCard({ visit }: { visit: SkeletonVisit }) {
  return (
    <section className="card" aria-label="פרטי הביקור" style={{ padding: "4px 14px" }}>
      <Row k="כתובת">
        {visit.street}, {visit.city}
      </Row>
      <Row k="מועד מתוכנן">
        <TimeRange start={visit.start} end={visit.end} />
      </Row>
      <Row k="מוצר">{visit.product}</Row>
      <Row k="מק״ט">
        <bdi dir="ltr">{visit.sku}</bdi>
      </Row>
    </section>
  );
}

export function VisitProblemCard({ visit }: { visit: SkeletonVisit }) {
  return (
    <section className="card" aria-label="התקלה" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <h2 style={H2}>התקלה</h2>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{visit.problem}</div>
      {visit.techNote && (
        <div className="note" style={{ fontSize: 13 }}>
          <b>הערות לטכנאי: </b>
          {visit.techNote}
        </div>
      )}
    </section>
  );
}

/** A fake photo tile (no image in the skeleton) with the quiet test marker. */
export function PhotoTile({ label, isTest = true }: { label: string; isTest?: boolean }) {
  return (
    <div className="thumb">
      <span role="img" aria-label={label} style={{ position: "absolute", inset: 0 }} />
      {isTest && (
        <span aria-hidden="true" style={{ position: "absolute", bottom: 4, insetInlineStart: 4, lineHeight: 1 }}>
          <TestPill />
        </span>
      )}
    </div>
  );
}
