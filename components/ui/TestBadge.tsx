// Test-data markers (D47): the 🧪 badge on test records (SIM-15 to SIM-19) and the visit source
// line (TE-12, SIM-14). The badge's look is a new visual element in the demo's language, pending
// the owner's visual approval. The source values are the visit DTO's (features/visits/data/types).
import type { VisitSource } from "@/features/visits/data/types";

export type { VisitSource };

export const TEST_DATA_LABEL = "נתוני בדיקה";

/** The 🧪 badge. Screen readers hear "נתוני בדיקה" (visually hidden text when `label` is off). */
export function TestBadge({ label = false }: { label?: boolean }) {
  return (
    <span className="pill" title={TEST_DATA_LABEL} style={{ background: "var(--warn-bg)", color: "var(--warn-fg)", padding: "1px 7px" }}>
      <span aria-hidden="true">🧪</span>
      {label ? ` ${TEST_DATA_LABEL}` : <span className="sr-only">{TEST_DATA_LABEL}</span>}
    </span>
  );
}

export const VISIT_SOURCE_LABELS = {
  outlook: "📅 נקלט אוטומטית מזימון Outlook",
  simulator: "🧪 זימון בדיקה",
} as const satisfies Record<VisitSource, string>;

/** The demo's source line under the technician card (TE-12), also used in office views (SIM-14). */
export function VisitSourceLine({ source }: { source: VisitSource }) {
  return (
    <div className="sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {VISIT_SOURCE_LABELS[source]}
    </div>
  );
}
