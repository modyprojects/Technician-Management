import { DashboardSkeleton } from "@/components/office/DashboardSkeleton";

// Instant loading state of the dashboard (spec-final §6.10): inside the segment layout, so the
// sidebar and logo stay in place. Same-route search-param changes keep the current view until the
// new one is ready (Next transitions); this shows on the first navigation to the dashboard.
export default function AnalyticsLoading() {
  return <DashboardSkeleton />;
}
