import { DashboardSkeleton } from "@/components/office/DashboardSkeleton";
import { longDateLabel } from "@/features/dashboards/data/periods";
import { TODAY } from "../../../_data/dates";

// Instant loading state of the dashboard (spec-final §6.10): inside the segment layout, so the
// sidebar and logo stay in place. Same-route search-param changes keep the current view until the
// new one is ready (Next transitions); this shows on the first navigation to the dashboard. The demo's
// date is fixed and every demo record is test data (D47), so the title's date and the "נתוני בדיקה"
// note's box are known before the data arrives and the page does not move when it does.
export default function AnalyticsLoading() {
  return <DashboardSkeleton date={longDateLabel(TODAY)} testNote />;
}
