import { TEST_DATA_LABEL } from "@/components/ui/TestBadge";

// "נתוני בדיקה" banner on dashboards and work queues (demo-deviations SIM-08 / SIM-13, D47): in
// test environments the numbers and lists include test-marked records and say so. Shown only when
// the DTO's `includesTestData` is true; production never counts test records (SIM-08).
// A new visual element in the demo's warning language (--warn-*), pending the owner's visual review.
export function DashboardTestNote({ id, children }: { id?: string; children?: string }) {
  return (
    <div id={id} role="note" className="od-test-note">
      <span aria-hidden="true">🧪</span>
      <b>{TEST_DATA_LABEL}</b>
      <span>{children ?? "המספרים והרשימות כוללים נתוני בדיקה (סביבת בדיקה)"}</span>
    </div>
  );
}
