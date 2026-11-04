// Visit status pill (docs/demo.html ST map and pill()). `c` is the strong colour the demo uses
// for dots, calendar borders and the visit-timeline edge. The status values are the visit DTO's
// (features/visits/data/types).
import type { VisitStatus } from "@/features/visits/data/types";

export type { VisitStatus };

export const VISIT_STATUSES = {
  new: { label: "שובצה", c: "var(--s-new)", bg: "var(--s-new-bg)", fg: "var(--s-new-fg)" },
  go: { label: "בדרך", c: "var(--s-go)", bg: "var(--s-go-bg)", fg: "var(--s-go-fg)" },
  work: { label: "בטיפול", c: "var(--s-work)", bg: "var(--s-work-bg)", fg: "var(--s-work-fg)" },
  done: { label: "טופל", c: "var(--s-done)", bg: "var(--s-done-bg)", fg: "var(--s-done-fg)" },
  cont: { label: "המשך טיפול", c: "var(--s-cont)", bg: "var(--s-cont-bg)", fg: "var(--s-cont-fg)" },
  cancel: { label: "בוטלה", c: "var(--s-cancel)", bg: "var(--s-cancel-bg)", fg: "var(--s-cancel-fg)" },
} as const satisfies Record<VisitStatus, { label: string; c: string; bg: string; fg: string }>;

export function StatusPill({ status, extra = "" }: { status: VisitStatus; extra?: string }) {
  const s = VISIT_STATUSES[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      {s.label}
      {extra}
    </span>
  );
}
