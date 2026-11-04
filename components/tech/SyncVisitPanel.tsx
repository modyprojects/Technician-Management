import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import { DEVICE_SYNC_LABELS, type VisitDeviceSync } from "@/features/sync/data/types";
import { attemptsLabel, itemsLabel, operationLabel, QUEUE_WARNING, queueItemRef, sizeLabel } from "./SyncLabels";
import { SyncItemPill, SyncNow, SyncRetry, SyncVisitPill } from "./SyncQueue";

// A visit's sync state on the technician's device (TE-23, TE-24; D06, D46), on the visit card and
// on the read-only view of a closed visit. A new element in the demo's language (card, .row-like
// lines, .pill), pending the owner's visual approval:
// - the title "סנכרון עם השרת" with the visit's live sync pill and the server's last confirmation;
// - each item still in the work queue (photo, video, recording, report, signature, time report):
//   its name, size, when it was saved, the attempts so far, the reason of the last failure, its
//   own pill and, for a failed item, "נסה שוב";
// - "סנכרן עכשיו" (manual sync, D06; never scheduled, D25) and the pending-data warning (D46);
// - nothing left on the device: "כל העבודה של הביקור הגיעה לשרת".
// Sync acts on the device's queue only: the visit itself stays read-only once closed (D14).
// Server Component; the pills and actions are client islands that read SyncQueueProvider (the
// technician layout). The page renders it only when the device holds something about the visit
// (sync.visit is not null).

export function SyncVisitPanel({ sync, timeLabel }: { sync: VisitDeviceSync; timeLabel: (iso: IsoTimestamp) => string }) {
  const ops = sync.operations.items;
  const more = sync.operations.total - ops.length;
  const titleId = `sy-visit-${sync.req}-${sync.n}`;
  const refLine = `פנייה ${sync.req} · ביקור ${sync.n}`;
  return (
    <section className="card sy-panel" aria-labelledby={titleId}>
      <div className="sy-head">
        <div className="sy-title">
          <h2 id={titleId}>סנכרון עם השרת</h2>
          <div className="sub">{sync.confirmedAt ? `אישור אחרון מהשרת: ${timeLabel(sync.confirmedAt)}` : "השרת עוד לא אישר קבלה"}</div>
        </div>
        <SyncVisitPill items={ops.map(queueItemRef)} fallback={sync.state} />
      </div>
      {ops.length > 0 ? (
        <>
          <ul className="sy-ops" aria-label={`פריטים שממתינים במכשיר · ${refLine}`}>
            {ops.map((op) => {
              const label = operationLabel(op);
              const size = sizeLabel(op.sizeBytes);
              return (
                <li key={op.opId} className="sy-op">
                  <div className="sy-op-main">
                    <span className="sy-op-title">
                      <b>{label}</b>
                      {op.isTest && (
                        <>
                          {" "}
                          <TestBadge />
                        </>
                      )}
                      {size && (
                        <span className="sub">
                          {" · "}
                          <bdi dir="ltr">{size}</bdi>
                        </span>
                      )}
                    </span>
                    <span className="sub">
                      נשמר במכשיר {timeLabel(op.savedAt)}
                      {op.attempts > 0 && ` · ${attemptsLabel(op.attempts)}`}
                    </span>
                    {op.state === "failed" && <span className="sy-err">{op.error ?? DEVICE_SYNC_LABELS.failed}</span>}
                  </div>
                  <div className="sy-op-side">
                    <SyncItemPill item={queueItemRef(op)} />
                    <SyncRetry item={queueItemRef(op)} itemLabel={`${label} · ${refLine}`} />
                  </div>
                </li>
              );
            })}
          </ul>
          {more > 0 && <div className="sub">ועוד {itemsLabel(more)} בתור</div>}
          <SyncNow />
          <p className="sub sy-warn">{QUEUE_WARNING}</p>
        </>
      ) : (
        <div className="sub">כל העבודה של הביקור הגיעה לשרת.</div>
      )}
    </section>
  );
}
