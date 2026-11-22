"use client";

// The visit's state on the device (TE-23; D46, D95 (d)): "נשמר במכשיר" (offline), "ממתין
// לסנכרון", "מסתנכרן", "נשלח לשרת" or "נכשל" with the inline reason. Nothing queued is ever
// dropped: a refusal stays on the device with its message and "נסה שוב" (the technician's own
// action; no timer). Never a recorded time (D68).
import { SyncPill } from "@/components/tech/SyncPill";
import type { DeviceSyncState } from "@/features/sync/data/types";
import { QUEUE_ERROR_MESSAGE, type VisitQueueState } from "@/features/visit-flow/queue";

export function syncStateOf(q: VisitQueueState, syncing: boolean, online: boolean, sentCount: number): DeviceSyncState | null {
  if (q.pending === 0) return sentCount > 0 ? "sent" : null;
  if (q.error) return "failed";
  if (syncing) return "syncing";
  return online ? "pending" : "saved-on-device";
}

export function SyncStatus({
  q,
  syncing,
  online,
  sentCount,
  onRetry,
  storeError,
}: {
  q: VisitQueueState;
  syncing: boolean;
  online: boolean;
  sentCount: number;
  onRetry: () => void;
  storeError: boolean;
}) {
  if (storeError) {
    return (
      <div role="alert" className="card" style={{ padding: "10px 12px", background: "var(--danger-bg)", color: "var(--danger-fg)", fontSize: 14 }}>
        לא ניתן לשמור במכשיר (אחסון הדפדפן חסום). אל תסגור את המסך עד שיחזור החיבור.
      </div>
    );
  }
  const state = syncStateOf(q, syncing, online, sentCount);
  if (!state) return null;
  return (
    <section aria-label="מצב סנכרון" className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SyncPill state={state} />
        {q.pending > 0 && <span className="sub">{q.pending === 1 ? "פריט אחד במכשיר" : `${q.pending} פריטים במכשיר`}</span>}
      </div>
      {state === "saved-on-device" && <div className="sub">אין חיבור. הנתונים שמורים במכשיר וישלחו כשיחזור החיבור.</div>}
      {q.error && (
        <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {QUEUE_ERROR_MESSAGE[q.error]}
        </div>
      )}
      {q.pending > 0 && !syncing && online && (
        <button type="button" className="btn" style={{ alignSelf: "flex-start", padding: "6px 12px" }} onClick={onRetry}>
          נסה שוב
        </button>
      )}
    </section>
  );
}
