"use client";

// The visit's data kept on the device (D95 as corrected 22.11: Version 1 is online only, no
// automatic sync, D06). The screen reads what the device holds (IndexedDB) and sends it ONLY when
// the technician acts: his "הגעתי" or closure (one attempt), or "שלח שוב" (everything, in order).
// No `online` event, no sending on app open, no timers. While a send is in flight the button is
// disabled and a second send waits for the first; the fixed operation ids make a resend harmless
// (Migration 7 replay). The port to the server is the server actions (lib/actions/visit-flow.ts);
// a thrown call (no connection) or "retry" keeps everything. The upload goes straight to the
// short-lived signed link the action returned (never logged).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { exclusive, idbVisitFlowStore } from "@/features/visit-flow/idb";
import type { CloseOutcome } from "@/features/visit-flow/rules";
import { syncQueue, type ApiResult, type NewQueueItem, type QueueItem, type SyncReport, type VisitFlowApi } from "@/features/visit-flow/queue";
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
    // The object is already there (a resend after an upload whose answer was lost): the
    // confirmation then checks its size and type.
    const text = await res.text().catch(() => "");
    if (res.status === 409 || /duplicate|already exists/i.test(text)) return { ok: true, value: null };
    if (res.status >= 500) throw new RetryLater();
    return { ok: false, code: "upload" };
  },
};

let running: Promise<SyncReport | null> | null = null;

export type QueueView = {
  items: QueueItem[];
  loaded: boolean;
  sending: boolean;
  /** The last send stopped for a missing connection (its message is shown until the next send). */
  lastOffline: boolean;
  /** Items the server confirmed during this screen's life. */
  sentCount: number;
  /** The field_version a confirmed "הגעתי" reached, per visit (until the page re-reads it). */
  fieldVersions: Record<string, number>;
  /** Closures the server confirmed during this screen's life, per visit. */
  closed: Record<string, CloseOutcome>;
  /** The device store could not be opened (private mode, blocked storage). */
  storeError: boolean;
  /** Keeps items on the device (atomically, with the visit's draft removed when asked). */
  enqueue: (items: NewQueueItem[], deleteDraftOf?: string) => Promise<boolean>;
  /** Sends everything the user's device holds, in order; only on the technician's action. */
  send: () => Promise<SyncReport | null>;
};

export function useVisitQueue(userId: string): QueueView {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastOffline, setLastOffline] = useState(false);
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

  // Reads what the device holds when the screen opens; sends nothing.
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(reload);
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const send = useCallback(async (): Promise<SyncReport | null> => {
    if (running) {
      await running;
      await reload();
      return null;
    }
    setSending(true);
    const run = (async () => {
      try {
        return await exclusive(() => syncQueue(idbVisitFlowStore, serverApi, userId));
      } catch {
        // A store failure: everything stays on the device.
        return null;
      }
    })();
    running = run;
    const report = await run;
    running = null;
    if (mounted.current) {
      setSending(false);
      setLastOffline(Boolean(report?.offline));
      if (report && report.sent > 0) {
        setSentCount((n) => n + report.sent);
        setFieldVersions((v) => ({ ...v, ...report.fieldVersions }));
        setClosed((v) => ({ ...v, ...report.closed }));
      }
    }
    await reload();
    if (report && report.sent > 0) router.refresh();
    return report;
  }, [reload, router, userId]);

  const enqueue = useCallback(
    async (newItems: NewQueueItem[], deleteDraftOf?: string) => {
      try {
        await idbVisitFlowStore.add(newItems, deleteDraftOf);
      } catch {
        setStoreError(true);
        return false;
      }
      await reload();
      return true;
    },
    [reload],
  );

  return { items, loaded, sending, lastOffline, sentCount, fieldVersions, closed, storeError, enqueue, send };
}
