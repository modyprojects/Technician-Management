// Device sync pill (TE-23, TE-24; D06, D46): the honest state of a visit or of one work-queue item
// on the technician's device, "נשמר במכשיר" / "ממתין לסנכרון" / "מסתנכרן" / "נשלח לשרת" /
// "נכשל". A new visual element in the demo's language (.pill), pending the owner's visual
// approval. It is not a visit status (StatusPill): each state has a leading mark, so the two pills
// can sit side by side without reading as one. Screen readers hear "מצב סנכרון: …".
// Presentational and hook-free: used by Server Components and by the live pill (SyncQueue.tsx).
import { DEVICE_SYNC_LABELS, type DeviceSyncState } from "@/features/sync/data/types";

/** Colours and the leading mark per state (demo tokens only). */
export const SYNC_PILL_LOOK: Readonly<Record<DeviceSyncState, { mark: string; bg: string; fg: string }>> = {
  "saved-on-device": { mark: "📱", bg: "var(--line2)", fg: "var(--ink2)" },
  pending: { mark: "⏳", bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  syncing: { mark: "⟳", bg: "var(--accent-l)", fg: "var(--accent-d)" },
  sent: { mark: "✓", bg: "var(--s-done-bg)", fg: "var(--s-done-fg)" },
  failed: { mark: "⚠", bg: "var(--danger-bg)", fg: "var(--danger-fg)" },
};

export function SyncPill({ state }: { state: DeviceSyncState }) {
  const look = SYNC_PILL_LOOK[state];
  return (
    <span className="pill sy-pill" data-sync-state={state} style={{ background: look.bg, color: look.fg }}>
      <span aria-hidden="true">{look.mark} </span>
      <span className="sr-only">מצב סנכרון: </span>
      {DEVICE_SYNC_LABELS[state]}
    </span>
  );
}
