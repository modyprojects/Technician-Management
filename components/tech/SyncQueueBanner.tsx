import Link from "next/link";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import {
  DEVICE_SYNC_LABELS,
  QUEUED_OPERATION_STATES,
  type DeviceOperation,
  type DeviceSyncSnapshot,
  type QueuedOperationState,
  type VisitDeviceSync,
} from "@/features/sync/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import { attemptsLabel, itemsLabel, operationLabel, QUEUE_WARNING, queueItemRef, sizeLabel } from "./SyncLabels";
import { SyncItemPill, SyncNow, SyncRetry, SyncVisitPill } from "./SyncQueue";

// Pending-operations banner on the technician home (TE-23, TE-24; D06, D46). A new element in the
// demo's language (a warning card like the close screen's "לפני הסיום"), pending the owner's
// visual approval. Shown only while the device's work queue holds items:
// - how many items have not reached the server yet, per state, and the last completed sync;
// - "סנכרן עכשיו" (manual sync, D06; never scheduled, D25);
// - one row per visit with queue items: the customer (a link to the visit), the request and visit
//   numbers and the visit's live sync pill; each failed item with its reason, its attempts and
//   "נסה שוב"; the other items by name;
// - the pending-data warning (D46).
// Server Component; the pills and actions are client islands that read SyncQueueProvider (the
// technician layout). Takes the device snapshot (sync.device) and, from the page, each visit's
// title and link and the time format.

export type SyncVisitInfo = { title: string; href: string };

const isQueued = (v: VisitDeviceSync): boolean => v.operations.items.length > 0;

/** The per-state counts, most urgent first. */
const COUNT_ORDER: readonly QueuedOperationState[] = ["failed", "syncing", "pending", "saved-on-device"];

function FailedItem({ op, visit }: { op: DeviceOperation; visit: VisitRef }) {
  const label = operationLabel(op);
  const size = sizeLabel(op.sizeBytes);
  return (
    <li className="sy-op">
      <div className="sy-op-main">
        <span className="sy-op-title">
          <b>{label}</b>
          {size && (
            <span className="sub">
              {" · "}
              <bdi dir="ltr">{size}</bdi>
            </span>
          )}
        </span>
        <span className="sub">
          {op.error ?? DEVICE_SYNC_LABELS.failed} · {attemptsLabel(op.attempts)}
        </span>
      </div>
      <div className="sy-op-side">
        <SyncItemPill item={queueItemRef(op)} />
        <SyncRetry item={queueItemRef(op)} itemLabel={`${label} · פנייה ${visit.req} · ביקור ${visit.n}`} />
      </div>
    </li>
  );
}

function VisitRow({ visit, info }: { visit: VisitDeviceSync; info: SyncVisitInfo | null }) {
  const ops = visit.operations.items;
  const failed = ops.filter((o) => o.state === "failed");
  const others = ops.filter((o) => o.state !== "failed");
  const more = visit.operations.total - ops.length;
  const refLine = `פנייה ${visit.req} · ביקור ${visit.n}`;
  return (
    <li className="sy-visit">
      <div className="sy-vhead">
        <span className="sy-vtitle">
          {info ? (
            <Link className="lnk" href={info.href}>
              {info.title}
            </Link>
          ) : (
            <b>{refLine}</b>
          )}
          {info && <span className="sub"> · {refLine}</span>}
          {visit.isTest && (
            <>
              {" "}
              <TestBadge />
            </>
          )}
        </span>
        <SyncVisitPill items={ops.map(queueItemRef)} fallback={visit.state} />
      </div>
      {failed.length > 0 && (
        <ul className="sy-ops" aria-label={`פריטים שנכשלו · ${refLine}`}>
          {failed.map((op) => (
            <FailedItem key={op.opId} op={op} visit={visit} />
          ))}
        </ul>
      )}
      {(others.length > 0 || more > 0) && (
        <div className="sub">
          {failed.length ? "עוד בתור" : "בתור"}: {others.map(operationLabel).join(" · ")}
          {more > 0 && `${others.length ? " · " : ""}ועוד ${itemsLabel(more)}`}
        </div>
      )}
    </li>
  );
}

export function SyncQueueBanner({
  snapshot,
  visitInfo,
  timeLabel,
}: {
  snapshot: DeviceSyncSnapshot;
  /** The visit's customer and link (the page reads them through the layer); null shows the numbers only. */
  visitInfo: (ref: VisitRef) => SyncVisitInfo | null;
  timeLabel: (iso: IsoTimestamp) => string;
}) {
  const total = QUEUED_OPERATION_STATES.reduce((sum, s) => sum + snapshot.counts[s], 0);
  if (total === 0) return null;
  const visits = snapshot.visits.items.filter(isQueued);
  const perState = COUNT_ORDER.filter((s) => snapshot.counts[s] > 0)
    .map((s) => `${DEVICE_SYNC_LABELS[s]}: ${snapshot.counts[s]}`)
    .join(" · ");
  const failed = snapshot.counts.failed > 0;
  return (
    <section className="card sy-banner" aria-labelledby="sy-banner-title">
      <div className="sy-head">
        <div className="sy-title">
          <h2 id="sy-banner-title">
            <span aria-hidden="true">{failed ? "⚠ " : "⏳ "}</span>
            {`${itemsLabel(total)} עוד לא ${total === 1 ? "הגיע" : "הגיעו"} לשרת`}
          </h2>
          <div className="sub">{perState}</div>
          <div className="sub">{snapshot.lastSyncAt ? `סנכרון אחרון: ${timeLabel(snapshot.lastSyncAt)}` : "המכשיר עוד לא סונכרן"}</div>
        </div>
        <SyncNow />
      </div>
      {visits.length > 0 && (
        <ul className="sy-visits" aria-label="ביקורים עם עבודה שממתינה במכשיר">
          {visits.map((v) => (
            <VisitRow key={`${v.req}-${v.n}`} visit={v} info={visitInfo(v)} />
          ))}
        </ul>
      )}
      <p className="sub sy-warn">{QUEUE_WARNING}</p>
    </section>
  );
}
