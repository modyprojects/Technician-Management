// The device store of the visit flow in IndexedDB (D46 work queue; D95 (d)), browser only, no
// dependency. Two object stores: "queue" (the work queue, key seq, auto-increment) and "drafts"
// (the work screen's photos and summary per visit, key visitId). Blobs are stored as they are: the
// compressed photos and the signature PNG (D95 (i)). Nothing here deletes an item on its own: only
// the queue engine removes an item after the server confirmed it (features/visit-flow/queue.ts).
import type { NewQueueItem, QueueItem, VisitFlowStore, WorkDraft } from "./queue";

const DB_NAME = "tm-visit-flow";
const DB_VERSION = 1;
const QUEUE = "queue";
const DRAFTS = "drafts";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "visitId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("indexeddb-open"));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb-tx"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb-abort"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb-request"));
  });
}

export const idbVisitFlowStore: VisitFlowStore = {
  async list() {
    const db = await open();
    const tx = db.transaction(QUEUE, "readonly");
    const items = await request(tx.objectStore(QUEUE).getAll() as IDBRequest<QueueItem[]>);
    return items.sort((a, b) => a.seq - b.seq);
  },
  async add(items: NewQueueItem[], deleteDraftOf?: string) {
    const db = await open();
    const tx = db.transaction([QUEUE, DRAFTS], "readwrite");
    const q = tx.objectStore(QUEUE);
    // Every request is issued before the first await, so the transaction stays one unit.
    const pending = items.map((i) => request(q.add(i)));
    if (deleteDraftOf) tx.objectStore(DRAFTS).delete(deleteDraftOf);
    const [keys] = await Promise.all([Promise.all(pending), done(tx)]);
    return items.map((i, n) => ({ ...i, seq: Number(keys[n]) }) as QueueItem);
  },
  async put(item: QueueItem) {
    const db = await open();
    const tx = db.transaction(QUEUE, "readwrite");
    tx.objectStore(QUEUE).put(item);
    await done(tx);
  },
  async remove(seq: number) {
    const db = await open();
    const tx = db.transaction(QUEUE, "readwrite");
    tx.objectStore(QUEUE).delete(seq);
    await done(tx);
  },
  async getDraft(visitId: string) {
    const db = await open();
    const tx = db.transaction(DRAFTS, "readonly");
    return ((await request(tx.objectStore(DRAFTS).get(visitId))) as WorkDraft | undefined) ?? null;
  },
  async putDraft(draft: WorkDraft) {
    const db = await open();
    const tx = db.transaction(DRAFTS, "readwrite");
    tx.objectStore(DRAFTS).put(draft);
    await done(tx);
  },
};

/** Runs `fn` alone across this browser's tabs (Web Locks when present), so two tabs never send at once. */
export async function exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return fn();
  return (await locks.request("tm-visit-flow-sync", { ifAvailable: true }, async (lock) => (lock ? fn() : null))) as T | null;
}
