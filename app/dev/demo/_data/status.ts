// FICTITIOUS DATA ONLY: status helpers for the demo's records. Allowed only under app/dev (G-05).
// Labels and colours are the production ones from components/ui; this module adds the rules
// that derive them from the demo's records. Client-safe (no seeded data).
import { CALL_STATUSES, CALL_STATUS_ORDER } from "@/components/ui/CallStatusPill";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TEST_DATA_LABEL, VISIT_SOURCE_LABELS } from "@/components/ui/TestBadge";
import type { Call, CallStatus, Visit, VisitStatus } from "./types";

export { CALL_STATUSES, CALL_STATUS_ORDER, TEST_DATA_LABEL, VISIT_SOURCE_LABELS, VISIT_STATUSES };

/** The demo's ST map name for VISIT_STATUSES ({ label, c, bg, fg } per visit status). */
export const ST = VISIT_STATUSES;

/** Visit statuses in the demo's chip and legend order. */
export const VISIT_STATUS_ORDER: readonly VisitStatus[] = ["new", "go", "work", "done", "cont", "cancel"];

/** Open visit statuses (the demo's OPEN): scheduled, en route, in progress. */
export const OPEN: readonly VisitStatus[] = ["new", "go", "work"];

export const isOpenVisit = (v: Pick<Visit, "status">): boolean => OPEN.includes(v.status);

/** Closed by the technician: "טופל" or "המשך טיפול". */
export const isClosedVisit = (v: Pick<Visit, "status">): boolean => v.status === "done" || v.status === "cont";

/** The demo's callStatus(): the last visit's status (visit pills, not the call status). */
export const lastVisitStatus = (c: Call): VisitStatus => c.visits[c.visits.length - 1]?.status ?? "new";

/**
 * Service-call status (D38, demo-deviations OF-17): any open visit → "open"; otherwise the
 * latest closed visit by visit number → "resolved" or "followup"; otherwise (every visit
 * cancelled) → "awaiting".
 */
export function callStatus(c: Call): CallStatus {
  if (c.visits.some(isOpenVisit)) return "open";
  const latestClosed = c.visits.filter(isClosedVisit).sort((a, b) => b.n - a.n)[0];
  if (latestClosed) return latestClosed.status === "done" ? "resolved" : "followup";
  return "awaiting";
}

/** Drawer "מצב בשטח" line (demo drawerHtml()). */
export function visitLiveText(v: Visit): string {
  switch (v.status) {
    case "new":
      return "טרם יצא";
    case "go":
      return `בדרך ללקוח · יצא ${v.departAt ?? ""}`;
    case "work":
      return `הגיע ${v.arriveAt ?? ""} · בטיפול`;
    case "done":
      return `טופל ${v.endAt ?? ""}${v.signer ? ` · נחתם ע"י ${v.signer}` : ""}`;
    case "cont":
      return `הסתיים ${v.endAt ?? ""} · המשך טיפול – ${v.reason ?? ""}`;
    default:
      return "בוטל";
  }
}

/** Paid visit (TE-11): warranty "לא". */
export const isPaidVisit = (c: Pick<Call, "warranty">): boolean => c.warranty.trim() === "לא";

/** Warranty text (TE-08): "לא צוין" when empty. */
export const warrantyText = (c: Pick<Call, "warranty">): string => c.warranty.trim() || "לא צוין";
