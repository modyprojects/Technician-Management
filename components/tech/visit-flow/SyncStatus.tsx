"use client";

// What the device still holds for this visit (D95 as corrected 22.11; D46, TE-23): the "לא נשלח"
// marker until the server confirmed everything, the message of the last failed send ("אין חיבור,
// … הנתונים שמורים בטלפון") or of a refusal, and "שלח שוב", the technician's own action, which
// sends everything in order and is disabled while a send is in flight. Nothing is sent on its own.
// Never a recorded time (D68).
import { SyncPill } from "@/components/tech/SyncPill";
import { QUEUE_ERROR_MESSAGE, type VisitQueueState } from "@/features/visit-flow/queue";

export const NOT_SENT_LABEL = "לא נשלח";
export const ARRIVE_OFFLINE = "אין חיבור, הסטטוס לא נשלח. הנתונים שמורים בטלפון";
export const CLOSE_OFFLINE = "אין חיבור, הסגירה לא נשלחה. הנתונים שמורים בטלפון";

/** The quiet "לא נשלח" marker (the visit card and the "היום" list). */
export function NotSentPill() {
  return (
    <span className="pill" data-unsent="true" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
      <span aria-hidden="true">⏳ </span>
      {NOT_SENT_LABEL}
    </span>
  );
}

export function SyncStatus({
  q,
  sending,
  lastOffline,
  sentCount,
  onSend,
  storeError,
}: {
  q: VisitQueueState;
  sending: boolean;
  lastOffline: boolean;
  sentCount: number;
  onSend: () => void;
  storeError: boolean;
}) {
  if (storeError) {
    return (
      <div role="alert" className="card" style={{ padding: "10px 12px", background: "var(--danger-bg)", color: "var(--danger-fg)", fontSize: 14 }}>
        לא ניתן לשמור בטלפון (אחסון הדפדפן חסום). אל תסגור את המסך לפני שהנתונים נשלחו.
      </div>
    );
  }
  if (q.pending === 0) {
    return sentCount > 0 ? (
      <section aria-label="מצב שליחה" className="card" style={{ padding: "10px 12px" }}>
        <SyncPill state="sent" />
      </section>
    ) : null;
  }
  return (
    <section aria-label="מצב שליחה" className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, borderColor: "var(--warn-bd)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <NotSentPill />
        <span className="sub">{q.pending === 1 ? "פריט אחד שמור בטלפון" : `${q.pending} פריטים שמורים בטלפון`}</span>
      </div>
      {q.error ? (
        <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {QUEUE_ERROR_MESSAGE[q.error]}
        </div>
      ) : (
        lastOffline && (
          <div role="alert" style={{ color: "var(--warn-ink)", fontSize: 14 }}>
            {q.close ? CLOSE_OFFLINE : ARRIVE_OFFLINE}
          </div>
        )
      )}
      <button type="button" className="btn" style={{ alignSelf: "flex-start", padding: "8px 14px", fontWeight: 700 }} onClick={onSend} disabled={sending} aria-busy={sending}>
        {sending ? "שולח…" : "שלח שוב"}
      </button>
    </section>
  );
}
