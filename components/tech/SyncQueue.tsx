"use client";

// Live state of the technician device's work queue (TE-23, TE-24; D06 manual sync, D25 no
// background jobs, D46 the work queue). One provider above every technician screen holds what
// the technician did on the queue in this session, so the home banner, the visit card and the
// closed view show the same states:
// - "סנכרן עכשיו" runs useCommands().sync.now(): every item still in the queue shows "מסתנכרן"
//   while the command runs. The command reports how many items it attempted, not each item's
//   result, so the items go back to their states afterwards; the device's own snapshot (the props)
//   is what changes after a real sync.
// - "נסה שוב" runs useCommands().sync.retry({ opId }) on a failed item only: "מסתנכרן" while it
//   runs; a stored success shows "נשלח לשרת"; a simulated result (the UI demo, nothing was sent)
//   puts the item back to "נכשל" and marks it "לא נשלח · פעולה מדומה"; a failure keeps "נכשל" with
//   the command's error.
// Never a scheduled job and never a claim of background sync: everything here runs on a tap.
// Generic: operation ids and states from DeviceOperation DTOs; no demo or fixture knowledge.
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import { visitSyncState, type DeviceSyncState, type QueuedOperationState } from "@/features/sync/data/types";
import { SyncPill } from "./SyncPill";

const FAILED = "הפעולה לא בוצעה. נסה שוב.";

/** What a queue item carries into the live state: its id and the state the device reported. */
export type QueueItemRef = { opId: string; state: QueuedOperationState };

/** The last result of an action on one item, shown under it. */
type ItemNote = { kind: "simulated" | "stored" | "error"; text: string };

type SyncQueueState = {
  /** The item's state on this screen: a change made here, else the state the device reported. */
  stateOf(item: QueueItemRef): DeviceSyncState;
  noteOf(opId: string): ItemNote | null;
  /** "נסה שוב" is running for the item. */
  retrying(opId: string): boolean;
  /** "סנכרן עכשיו" is running. */
  syncingAll: boolean;
  retry(item: QueueItemRef): Promise<ItemNote | null>;
  /** Null when a sync is already running. */
  syncNow(): Promise<CommandResult<{ attempted: number }> | null>;
};

const SyncQueueContext = createContext<SyncQueueState | null>(null);

export function useSyncQueue(): SyncQueueState {
  const state = use(SyncQueueContext);
  if (!state) throw new Error("useSyncQueue() needs a <SyncQueueProvider> (the technician layout).");
  return state;
}

export function SyncQueueProvider({
  operations,
  children,
}: {
  /** The device's queue items (sync.device), the targets of "סנכרן עכשיו". */
  operations: readonly QueueItemRef[];
  children: ReactNode;
}) {
  const { sync } = useCommands();
  const [changed, setChanged] = useState<Readonly<Record<string, DeviceSyncState>>>({});
  const [notes, setNotes] = useState<Readonly<Record<string, ItemNote | null>>>({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  // The latest changes for the handlers, and synchronous guards against a double tap.
  const latest = useRef(changed);
  const busy = useRef(new Set<string>());
  const busyAll = useRef(false);

  const apply = useCallback((patch: Readonly<Record<string, DeviceSyncState | undefined>>) => {
    const next: Record<string, DeviceSyncState> = { ...latest.current };
    for (const [id, state] of Object.entries(patch)) {
      if (state === undefined) delete next[id];
      else next[id] = state;
    }
    latest.current = next;
    setChanged(next);
  }, []);

  const stateOf = useCallback((item: QueueItemRef): DeviceSyncState => changed[item.opId] ?? item.state, [changed]);

  const retry = useCallback(
    async (item: QueueItemRef): Promise<ItemNote | null> => {
      const id = item.opId;
      const before = latest.current[id];
      if ((before ?? item.state) !== "failed" || busy.current.has(id) || busyAll.current) return null;
      busy.current.add(id);
      setRunning(new Set(busy.current));
      setNotes((n) => ({ ...n, [id]: null }));
      apply({ [id]: "syncing" });
      let note: ItemNote;
      try {
        const r = await sync.retry({ opId: id });
        if (!r.ok) {
          apply({ [id]: before });
          note = { kind: "error", text: r.error };
        } else if (r.simulated) {
          apply({ [id]: before });
          note = { kind: "simulated", text: "לא נשלח · פעולה מדומה" };
        } else {
          apply({ [id]: "sent" });
          note = { kind: "stored", text: r.message ?? "נשלח לשרת" };
        }
      } catch {
        apply({ [id]: before });
        note = { kind: "error", text: FAILED };
      } finally {
        busy.current.delete(id);
        setRunning(new Set(busy.current));
      }
      setNotes((n) => ({ ...n, [id]: note }));
      return note;
    },
    [apply, sync],
  );

  const syncNow = useCallback(async (): Promise<CommandResult<{ attempted: number }> | null> => {
    if (busyAll.current) return null;
    busyAll.current = true;
    setSyncingAll(true);
    const targets = operations.filter((o) => (latest.current[o.opId] ?? o.state) !== "sent" && !busy.current.has(o.opId));
    const before = Object.fromEntries(targets.map((o) => [o.opId, latest.current[o.opId]]));
    apply(Object.fromEntries(targets.map((o) => [o.opId, "syncing" as const])));
    setNotes((n) => ({ ...n, ...Object.fromEntries(targets.map((o) => [o.opId, null])) }));
    let result: CommandResult<{ attempted: number }>;
    try {
      result = await sync.now();
    } catch {
      result = { ok: false, simulated: false, error: FAILED };
    } finally {
      // Back to the states before the attempt: the device's next snapshot reports each item.
      apply(before);
      busyAll.current = false;
      setSyncingAll(false);
    }
    return result;
  }, [apply, operations, sync]);

  const value = useMemo<SyncQueueState>(
    () => ({
      stateOf,
      noteOf: (opId) => notes[opId] ?? null,
      retrying: (opId) => running.has(opId),
      syncingAll,
      retry,
      syncNow,
    }),
    [stateOf, notes, running, syncingAll, retry, syncNow],
  );

  return <SyncQueueContext value={value}>{children}</SyncQueueContext>;
}

/** A visit's pill from its queue items' live states; `fallback` when it has no item here (for example "נשלח לשרת"). */
export function SyncVisitPill({ items, fallback }: { items: readonly QueueItemRef[]; fallback: DeviceSyncState }) {
  const queue = useSyncQueue();
  if (!items.length) return <SyncPill state={fallback} />;
  const queued = items.map((i) => queue.stateOf(i)).filter((s): s is QueuedOperationState => s !== "sent");
  return <SyncPill state={visitSyncState(queued.map((state) => ({ state })))} />;
}

/** One queue item's live pill. */
export function SyncItemPill({ item }: { item: QueueItemRef }) {
  return <SyncPill state={useSyncQueue().stateOf(item)} />;
}

/**
 * "נסה שוב" for a failed item (TE-24) and the result line under it. The button stays while the
 * command runs (aria-disabled), so focus is never lost; when the item is sent and the button goes
 * away, focus moves to the result line.
 */
export function SyncRetry({ item, itemLabel }: { item: QueueItemRef; itemLabel: string }) {
  const queue = useSyncQueue();
  const noteRef = useRef<HTMLDivElement>(null);
  const state = queue.stateOf(item);
  const running = queue.retrying(item.opId);
  const note = queue.noteOf(item.opId);
  const offered = state === "failed" || running;

  async function onRetry() {
    if (running || queue.syncingAll) return;
    const result = await queue.retry(item);
    if (result?.kind === "stored") noteRef.current?.focus();
  }

  return (
    <>
      {offered && (
        <button
          type="button"
          className="btn sy-btn"
          aria-label={`נסה שוב · ${itemLabel}`}
          aria-disabled={running || queue.syncingAll || undefined}
          onClick={() => void onRetry()}
        >
          {running ? "שולח…" : "נסה שוב"}
        </button>
      )}
      <div
        ref={noteRef}
        tabIndex={-1}
        role={note?.kind === "error" ? "alert" : "status"}
        className={note ? `sy-note sy-note-${note.kind}` : "sy-note"}
      >
        {note?.text}
      </div>
    </>
  );
}

/** "סנכרן עכשיו" (D06: manual sync; never scheduled, D25) and its result line. */
export function SyncNow() {
  const queue = useSyncQueue();
  const [result, setResult] = useState<ItemNote | null>(null);

  async function onSync() {
    if (queue.syncingAll) return;
    setResult(null);
    const r = await queue.syncNow();
    if (!r) return;
    if (!r.ok) setResult({ kind: "error", text: r.error });
    else if (r.simulated) {
      const n = r.data?.attempted ?? 0;
      setResult({
        kind: "simulated",
        text: `בהדגמה: ${n === 1 ? "פריט אחד נשאר" : `${n} פריטים נשארו`} במכשיר, שום דבר לא נשלח לשרת. לא נשמר.`,
      });
    } else setResult({ kind: "stored", text: r.message ?? "הסנכרון הסתיים" });
  }

  return (
    <div className="sy-now">
      <button
        type="button"
        className="btn pri sy-btn"
        aria-disabled={queue.syncingAll || undefined}
        onClick={() => void onSync()}
      >
        {queue.syncingAll ? "מסתנכרן…" : "סנכרן עכשיו"}
      </button>
      <div role={result?.kind === "error" ? "alert" : "status"} className={result ? `sy-note sy-note-${result.kind}` : "sy-note"}>
        {result?.text}
      </div>
    </div>
  );
}
