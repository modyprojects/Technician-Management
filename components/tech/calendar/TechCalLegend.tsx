import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { VisitStatus } from "@/features/visits/data/types";

// The colour key of the technician calendar (owner review of #45, fix c): one fixed line under the
// day strip (daily) or the view switch (weekly). In the weekly view at 390 it is the only key (the
// blocks have no room for a status chip; design-rules.md "Status is never colour alone"). Colours
// come from VISIT_STATUSES only (fix d). "בדרך" is not in the line (owner question, #45).
export const LEGEND_STATUSES = ["new", "work", "done", "cont"] as const satisfies readonly VisitStatus[];

export function TechCalLegend() {
  return (
    <div role="note" aria-label="מקרא צבעים" style={{ display: "flex", gap: 10, fontSize: 11, justifyContent: "center", flexWrap: "nowrap", whiteSpace: "nowrap", flex: "none", color: "var(--muted)" }}>
      {LEGEND_STATUSES.map((k) => (
        <span key={k}>
          <span className="dot" aria-hidden="true" style={{ background: VISIT_STATUSES[k].c }} /> {VISIT_STATUSES[k].label}
        </span>
      ))}
    </div>
  );
}

/** The status as a small text chip on a calendar block (fix b): never colour alone. */
export function TechCalStatusChip({ status }: { status: VisitStatus }) {
  const s = VISIT_STATUSES[status];
  return (
    <span className="pill" style={{ background: "var(--card)", color: s.fg, border: `1px solid ${s.c}`, padding: "0 6px", fontSize: 11, lineHeight: "16px" }}>
      {s.label}
    </span>
  );
}
