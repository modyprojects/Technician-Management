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

/** The simulator's label (SIM-14), shared by visits and by received invitations. */
const SIMULATOR_SOURCE_LABEL = "🧪 זימון בדיקה";

export const VISIT_SOURCE_LABELS = {
  outlook: "📅 נקלט אוטומטית מזימון Outlook",
  simulator: SIMULATOR_SOURCE_LABEL,
} as const satisfies Record<VisitSource, string>;

/**
 * Where a received invitation came from ("פריטים לבדיקה", D39): the same sources as a visit's, but
 * the invitation was not ingested as a visit change (it waits for review), so the Outlook label
 * does not say "נקלט אוטומטית".
 */
export const INVITATION_SOURCE_LABELS = {
  outlook: "📅 זימון Outlook",
  simulator: SIMULATOR_SOURCE_LABEL,
} as const satisfies Record<VisitSource, string>;

/** The demo's source line under the technician card (TE-12), also used in office views (SIM-14). */
export function VisitSourceLine({ source }: { source: VisitSource }) {
  return (
    <div className="sub" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {VISIT_SOURCE_LABELS[source]}
    </div>
  );
}

/** The visit source as a compact icon (tables, lanes); the full label is its accessible name and tooltip. */
export function VisitSourceIcon({ source, className }: { source: VisitSource; className?: string }) {
  const [icon, ...words] = VISIT_SOURCE_LABELS[source].split(" ");
  const label = words.join(" ");
  return (
    <span role="img" aria-label={label} title={label} className={className}>
      {icon}
    </span>
  );
}
