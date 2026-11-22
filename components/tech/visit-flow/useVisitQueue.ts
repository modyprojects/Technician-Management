"use client";

// The device work queue in a screen (D95 (d)): the queue's items from IndexedDB, and a sync run
// when the screen opens and on the browser's `online` event (no timers, no background jobs), after
// the technician queues something, and on his "נסה שוב". The port to the server is the server
// actions (lib/actions/visit-flow.ts); a thrown call (no connection) or "retry" keeps the item.
// The upload goes straight to the short-lived signed link the action returned (never logged).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { exclusive, idbVisitFlowStore } from "@/features/visit-flow/idb";
import type { CloseOutcome } from "@/features/visit-flow/rules";
import { syncQueue, type ApiResult, type NewQueueItem, type QueueItem, type VisitFlowApi } from "@/features/visit-flow/queue";
import { addVisitMedia, arriveVisit, closeVisit, confirmVisitMedia } from "@/lib/actions/visit-flow";

class RetryLater extends Error {}

/** A server action's answer for the queue: "retry" becomes a thrown error (keep, try later). */
function port<T>(r: ApiResult<T> | { ok: false; code: "retry" }): ApiResult<T> {
  if (!r.ok && r.code === "retry") throw new RetryLater();
  return r as ApiResult<T>;
}

export const serverApi: VisitFlowApi = {
  arrive: async (i) => port(await arriveVisit(i)),
  addMedia: async (i) => port(await addVisitMedia(i)),
  confirmMedia: async (i) => port(await confirmVisitMedia(i)),
  close: async (i) => port(await closeVisit(i)),
  async upload(url, blob, mime) {
    const res = await fetch(url, { method: "PUT", body: blob, headers: { "content-type": mime, "x-upsert": "false" }, credentials: "omit", cache: "no-store" });
    if (res.ok) return { ok: true, value: null };
    // The object is already there (a replay after an upload whose answer was lost): the
    // confirmation then checks its size and type.
    const text = await res.text().catch(() => "");
    if (res.status === 409 || /duplicate|already exists/i.test(text)) return { ok: true, value: null };
    if (res.status >= 500) throw new RetryLater();
    return { ok: false, code: "upload" };
  },
};

let running: Promise<unknown> | null = null;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export type QueueView = {
  items: QueueItem[];
  loaded: boolean;
  syncing: boolean;
  online: boolean;
  /** Items the server confirmed during this screen's life. */
  sentCount: number;
  /** The field_version a confirmed "הגעתי" reached, per visit (until the page re-reads it). */
  fieldVersions: Record<string, number>;
  /** Closures the server confirmed during this screen's life, per visit. */
  closed: Record<string, CloseOutcome>;
  /** The device store could not be opened (private mode, blocked storage). */
  storeError: boolean;
  enqueue: (items: NewQueueItem[], deleteDraftOf?: string) => Promise<boolean>;
  sync: () => Promise<void>;
};

export function useVisitQueue(userId: string): QueueView {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [sentCount, setSentCount] = useState(0);
  const [storeError, setStoreError] = useState(false);
  const [fieldVersions, setFieldVersions] = useState<Record<string, number>>({});
  const [closed, setClosed] = useState<Record<string, CloseOutcome>>({});
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const all = await idbVisitFlowStore.list();
      if (mounted.current) {
        setItems(all.filter((i) => i.userId === userId));
        setLoaded(true);
      }
    } catch {
      if (mounted.current) {
        setStoreError(true);
        setLoaded(true);
      }
    }
  }, [userId]);

  const sync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await reload();
      return;
    }
    if (running) {
      await running;
      await reload();
      return;
    }
    setSyncing(true);
    const run = exclusive(() => syncQueue(idbVisitFlowStore, serverApi, userId));
    running = run;
    try {
      const report = await run;
      if (report && report.sent > 0) {
        if (mounted.current) {
          setSentCount((n) => n + report.sent);
          setFieldVersions((v) => ({ ...v, ...report.fieldVersions }));
          setClosed((v) => ({ ...v, ...report.closed }));
        }
        router.refresh();
      }
    } catch {
      // A store failure: everything stays on the device; the screen shows the pending state.
    } finally {
      running = null;
      if (mounted.current) setSyncing(false);
      await reload();
    }
  }, [reload, router, userId]);

  useEffect(() => {
    mounted.current = true;
    // The app opening (D95 (d)): one run, after this render.
    void Promise.resolve().then(sync);
    const on = () => void sync();
    window.addEventListener("online", on);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", on);
    };
  }, [sync]);

  const enqueue = useCallback(
    async (newItems: NewQueueItem[], deleteDraftOf?: string) => {
      try {
        await idbVisitFlowStore.add(newItems, deleteDraftOf);
      } catch {
        setStoreError(true);
        return false;
      }
      await reload();
      void sync();
      return true;
    },
    [reload, sync],
  );

  return { items, loaded, syncing, online, sentCount, fieldVersions, closed, storeError, enqueue, sync };
}
