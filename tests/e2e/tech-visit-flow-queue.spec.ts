import { expect, test } from "@playwright/test";
import { acceptable, compressionAttempts, fitWithin, LONG_EDGE_MAX, LONG_EDGE_MIN, outputMime, TARGET_BYTES } from "@/features/visit-flow/image";
import {
  effectiveStatus,
  syncQueue,
  visitQueueState,
  type QueueErrorCode,
  type NewQueueItem,
  type QueueItem,
  type VisitFlowApi,
  type VisitFlowStore,
  type WorkDraft,
} from "@/features/visit-flow/queue";
import { APPROVAL_TEXT_V1, closeInputRefusal, closeMissing, MEDIA_MAX_BYTES, mediaRefusal, photoRoom, sha256Hex, workMissing } from "@/features/visit-flow/rules";
import { onlyInProject } from "./helpers";

// The visit flow's device work queue and pure rules (D46, D95 (a) to (d), (h)): ordering per visit
// (arrive → media → close), replay with stable operation ids (exactly once), persistence across a
// reload (a new store over the same saved data), the error states (a refusal keeps the item and
// holds the visit's later items; a lost connection stops the run and keeps everything), and the
// photo compression's sizing. No server, no browser: an in-memory store and a fake server with the
// Migration 7 writers' replay rule (the same operation id returns the stored outcome).

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clock = { reportedAt: "2026-11-22T08:00:00.000Z", deviceTz: "Asia/Jerusalem", deviceUtcOffsetMin: 120 };

/** Saved data that outlives a store instance (what IndexedDB keeps across a reload). */
type Saved = { items: Map<number, QueueItem>; drafts: Map<string, WorkDraft>; next: number };
const newSaved = (): Saved => ({ items: new Map(), drafts: new Map(), next: 1 });

function memoryStore(saved: Saved): VisitFlowStore {
  const copy = <T>(x: T): T => structuredClone(x);
  return {
    async list() {
      return [...saved.items.values()].sort((a, b) => a.seq - b.seq).map(copy);
    },
    async add(items: NewQueueItem[], deleteDraftOf?: string) {
      const out = items.map((i) => ({ ...i, seq: saved.next++ }) as QueueItem);
      for (const i of out) saved.items.set(i.seq, copy(i));
      if (deleteDraftOf) saved.drafts.delete(deleteDraftOf);
      return out.map(copy);
    },
    async put(item) {
      saved.items.set(item.seq, copy(item));
    },
    async remove(seq) {
      saved.items.delete(seq);
    },
    async getDraft(visitId) {
      return saved.drafts.get(visitId) ?? null;
    },
    async putDraft(d) {
      saved.drafts.set(d.visitId, d);
    },
  };
}

type Visit = { status: "en_route" | "in_progress" | "done" | "followup"; fieldVersion: number };

/** A fake server with the M7 writers' rules that matter to the queue. */
function fakeServer(visits: Record<string, Visit>) {
  const ops = new Map<string, unknown>();
  const media = new Map<string, { visitId: string; stored: boolean; uploaded: boolean }>();
  const calls: string[] = [];
  let offline = false;
  let failNext: { call: string; code?: QueueErrorCode } | null = null;
  const visit = (id: string): Visit => {
    const v = visits[id];
    if (!v) throw new Error("unknown visit");
    return v;
  };
  const applied = { arrive: 0, close: 0, media: 0 };
  const gate = (name: string) => {
    calls.push(name);
    if (offline) throw new Error("Failed to fetch");
    if (failNext && failNext.call === name) {
      const f = failNext;
      failNext = null;
      if (!f.code) throw new Error("Failed to fetch");
      return { ok: false as const, code: f.code };
    }
    return null;
  };
  const api: VisitFlowApi = {
    async arrive(i) {
      const g = gate("arrive");
      if (g) return g;
      if (ops.has(i.operationId)) return { ok: true, value: ops.get(i.operationId) as { fieldVersion: number } };
      const v = visit(i.visitId);
      if (v.status !== "en_route") return { ok: false, code: "55000" };
      if (v.fieldVersion !== i.expectedFieldVersion) return { ok: false, code: "PT409" };
      v.status = "in_progress";
      v.fieldVersion++;
      applied.arrive++;
      const out = { fieldVersion: v.fieldVersion };
      ops.set(i.operationId, out);
      return { ok: true, value: out };
    },
    async addMedia(i) {
      const g = gate("addMedia");
      if (g) return g;
      let id = ops.get(i.operationId) as string | undefined;
      if (!id) {
        if (visit(i.visitId).status !== "in_progress") return { ok: false, code: "55000" };
        id = `m-${i.operationId}`;
        ops.set(i.operationId, id);
        media.set(id, { visitId: i.visitId, stored: false, uploaded: false });
        applied.media++;
      }
      return { ok: true, value: { mediaId: id, uploadUrl: media.get(id)?.stored ? null : `https://storage.test/${id}` } };
    },
    async upload(url) {
      const g = gate("upload");
      if (g) return g;
      const m = media.get(url.split("/").pop() ?? "");
      if (m) m.uploaded = true;
      return { ok: true, value: null };
    },
    async confirmMedia(i) {
      const g = gate("confirm");
      if (g) return g;
      const m = media.get(i.mediaId);
      if (!m?.uploaded) return { ok: false, code: "55000" };
      m.stored = true;
      return { ok: true, value: null };
    },
    async close(i) {
      const g = gate("close");
      if (g) return g;
      if (ops.has(i.operationId)) return { ok: true, value: ops.get(i.operationId) as { status: string } };
      const v = visit(i.visitId);
      if (v.status !== "in_progress") return { ok: false, code: "55000" };
      if (v.fieldVersion !== i.expectedFieldVersion) return { ok: false, code: "PT409" };
      if (i.outcome === "done" && !(i.signatureMediaId && media.get(i.signatureMediaId)?.stored)) return { ok: false, code: "22023" };
      v.status = i.outcome;
      v.fieldVersion++;
      applied.close++;
      const out = { status: i.outcome };
      ops.set(i.operationId, out);
      return { ok: true, value: out };
    },
  };
  return {
    api,
    calls,
    applied,
    visits,
    setOffline: (o: boolean) => {
      offline = o;
    },
    failOnce: (call: string, code?: "PT409" | "55000" | "42501") => {
      failNext = { call, code };
    },
  };
}

let opN = 0;
const op = () => `00000000-0000-4000-8000-${String(++opN).padStart(12, "0")}`;
const base = (visitId: string, userId = USER) => ({ userId, visitId, queuedAt: clock.reportedAt, attempts: 0, error: null });
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

/** "הגעתי" then the closure "טופל" with one before, one after photo and the signature (offline-queued). */
function arriveAndClose(visitId: string, fieldVersion: number, userId = USER): NewQueueItem[] {
  const sig = `sig-${visitId}`;
  return [
    { ...base(visitId, userId), kind: "arrive", opId: op(), expectedFieldVersion: fieldVersion, clock },
    { ...base(visitId, userId), kind: "media", opId: op(), ref: "p1", mediaKind: "photo", phase: "before", mime: "image/jpeg", size: 4, blob: png(), clock, mediaId: null },
    { ...base(visitId, userId), kind: "media", opId: op(), ref: "p2", mediaKind: "photo", phase: "after", mime: "image/jpeg", size: 4, blob: png(), clock, mediaId: null },
    { ...base(visitId, userId), kind: "media", opId: op(), ref: sig, mediaKind: "signature", phase: null, mime: "image/png", size: 4, blob: png(), clock, mediaId: null },
    {
      ...base(visitId, userId),
      kind: "close",
      opId: op(),
      outcome: "done",
      summary: "הוחלף חלק",
      signerName: "לקוח בדיקה",
      ackTextSha256: "0".repeat(64),
      signatureRef: sig,
      signatureMediaId: null,
      followupReasonId: null,
      nextVisitNotes: null,
      expectedFieldVersion: null,
      clock,
    },
  ];
}

test.describe("visit flow work queue (D46, D95 (d))", () => {
  onlyInProject("desktop");

  test("order per visit: arrive, then each media (add, upload, confirm), then close; values flow forward", async () => {
    const saved = newSaved();
    const store = memoryStore(saved);
    const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 2 } });
    await store.add(arriveAndClose(V1, 2));
    const report = await syncQueue(store, server.api, USER);
    expect(report).toEqual({ sent: 5, offline: false, failed: 0, fieldVersions: { [V1]: 3 }, closed: { [V1]: "done" } });
    expect(server.calls).toEqual(["arrive", ...Array(3).fill(["addMedia", "upload", "confirm"]).flat(), "close"]);
    expect(server.visits[V1]).toEqual({ status: "done", fieldVersion: 4 });
    expect(saved.items.size).toBe(0);
  });

  test("offline: nothing is sent or dropped; reconnecting sends everything exactly once", async () => {
    const saved = newSaved();
    const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 1 } });
    await memoryStore(saved).add(arriveAndClose(V1, 1));
    server.setOffline(true);
    const first = await syncQueue(memoryStore(saved), server.api, USER);
    expect(first.offline).toBe(true);
    expect(saved.items.size).toBe(5);
    expect([...saved.items.values()].every((i) => i.error === null)).toBe(true);
    server.setOffline(false);
    await syncQueue(memoryStore(saved), server.api, USER);
    // A second run (another `online` event, the app reopening) finds nothing to send.
    await syncQueue(memoryStore(saved), server.api, USER);
    expect(server.applied).toEqual({ arrive: 1, media: 3, close: 1 });
    expect(saved.items.size).toBe(0);
  });

  test("replay: an answer lost mid-way is retried with the same operation ids and applied once", async () => {
    const saved = newSaved();
    const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 1 } });
    await memoryStore(saved).add(arriveAndClose(V1, 1));
    const ids = [...saved.items.values()].map((i) => i.opId);
    // The connection drops on the second upload: arrive and the first photo are done.
    let uploads = 0;
    const flaky: VisitFlowApi = {
      ...server.api,
      upload: async (u, b, m) => {
        if (++uploads === 2) throw new Error("Failed to fetch");
        return server.api.upload(u, b, m);
      },
    };
    const first = await syncQueue(memoryStore(saved), flaky, USER);
    expect(first).toMatchObject({ sent: 2, offline: true });
    const left = [...saved.items.values()];
    expect(left.map((i) => i.kind)).toEqual(["media", "media", "close"]);
    // The pending photo kept its media id; the closure got the field_version from "הגעתי".
    expect(left[0]).toMatchObject({ kind: "media", mediaId: `m-${ids[2]}` });
    expect(left[2]).toMatchObject({ kind: "close", expectedFieldVersion: 2 });
    expect(left.map((i) => i.opId)).toEqual(ids.slice(2));
    await syncQueue(memoryStore(saved), server.api, USER);
    expect(server.applied).toEqual({ arrive: 1, media: 3, close: 1 });
    // A whole replay of an already applied closure answers the stored outcome, nothing twice.
    const again = arriveAndClose(V1, 1).slice(-1);
    await memoryStore(saved).add([{ ...again[0], opId: ids[4] } as NewQueueItem]);
    const lastClose = [...saved.items.values()][0];
    if (!lastClose) throw new Error("not queued");
    if (lastClose.kind === "close") Object.assign(lastClose, { expectedFieldVersion: 2, signatureMediaId: `m-${ids[3]}` });
    await memoryStore(saved).put(lastClose);
    await syncQueue(memoryStore(saved), server.api, USER);
    expect(server.applied.close).toBe(1);
    expect(saved.items.size).toBe(0);
  });

  test("persistence across a reload: a new store over the saved data holds the same items in order", async () => {
    const saved = newSaved();
    const items = arriveAndClose(V1, 1);
    await memoryStore(saved).add(items);
    await memoryStore(saved).putDraft({ visitId: V2, userId: USER, summary: "טיוטה", photos: [] });
    const reloaded = memoryStore(saved);
    const list = await reloaded.list();
    expect(list.map((i) => i.kind)).toEqual(["arrive", "media", "media", "media", "close"]);
    expect(list.map((i) => i.opId)).toEqual(items.map((i) => i.opId));
    expect((await reloaded.getDraft(V2))?.summary).toBe("טיוטה");
    expect(visitQueueState(list, V1, USER)).toMatchObject({ pending: 5, arrivePending: true, error: null });
  });

  test("queuing the closure removes the work draft in the same step", async () => {
    const saved = newSaved();
    const store = memoryStore(saved);
    await store.putDraft({ visitId: V1, userId: USER, summary: "s", photos: [] });
    await store.add(arriveAndClose(V1, 1).slice(1), V1);
    expect(await store.getDraft(V1)).toBeNull();
    expect(saved.items.size).toBe(4);
  });

  for (const code of ["PT409", "55000", "42501"] as const) {
    test(`a refusal (${code}) keeps the item with its error, holds the visit's later items, and other visits go on`, async () => {
      const saved = newSaved();
      const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 1 }, [V2]: { status: "en_route", fieldVersion: 1 } });
      await memoryStore(saved).add([...arriveAndClose(V1, 1), ...arriveAndClose(V2, 1)]);
      server.failOnce("arrive", code);
      const r = await syncQueue(memoryStore(saved), server.api, USER);
      expect(r).toMatchObject({ failed: 1, offline: false, sent: 5 });
      const left = [...saved.items.values()];
      expect(left).toHaveLength(5);
      expect(left.every((i) => i.visitId === V1)).toBe(true);
      expect(left[0]).toMatchObject({ kind: "arrive", error: code, attempts: 1 });
      const state = visitQueueState(left, V1, USER);
      expect(state).toMatchObject({ pending: 5, error: code });
      // The technician's "נסה שוב": the same items, the same ids, applied once.
      await syncQueue(memoryStore(saved), server.api, USER);
      expect(saved.items.size).toBe(0);
      expect(server.applied).toEqual({ arrive: 2, media: 6, close: 2 });
    });
  }

  test("a closure whose field_version changed (PT409) is never dropped", async () => {
    const saved = newSaved();
    const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 1 } });
    await memoryStore(saved).add(arriveAndClose(V1, 1));
    await syncQueue(memoryStore(saved), { ...server.api, close: async () => ({ ok: false, code: "PT409" }) }, USER);
    await syncQueue(memoryStore(saved), { ...server.api, close: async () => ({ ok: false, code: "PT409" }) }, USER);
    const left = [...saved.items.values()];
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "close", error: "PT409", attempts: 2, expectedFieldVersion: 2 });
  });

  test("only the signed-in user's items are sent", async () => {
    const saved = newSaved();
    const server = fakeServer({ [V1]: { status: "en_route", fieldVersion: 1 } });
    await memoryStore(saved).add(arriveAndClose(V1, 1, OTHER_USER));
    const r = await syncQueue(memoryStore(saved), server.api, USER);
    expect(r.sent).toBe(0);
    expect(server.calls).toEqual([]);
    expect(saved.items.size).toBe(5);
  });

  test("the status the technician sees: the server's, moved on by the device's queue", () => {
    const none = { pending: 0, arrivePending: false, close: null, error: null };
    expect(effectiveStatus("go", none)).toBe("go");
    expect(effectiveStatus("go", { ...none, pending: 1, arrivePending: true })).toBe("work");
    const close = arriveAndClose(V1, 1).at(-1) as QueueItem & { kind: "close" };
    expect(effectiveStatus("go", { ...none, pending: 2, arrivePending: true, close })).toBe("done");
    expect(effectiveStatus("work", { ...none, pending: 1, close: { ...close, outcome: "followup" } })).toBe("cont");
    expect(effectiveStatus("done", none)).toBe("done");
    // Confirmed by the server on this screen, before the page re-reads the visit: never a step back.
    expect(effectiveStatus("go", none, { arrived: true, closed: null })).toBe("work");
    expect(effectiveStatus("work", none, { arrived: true, closed: "followup" })).toBe("cont");
  });
});

test.describe("visit flow rules (D95 (a) to (c))", () => {
  onlyInProject("desktop");

  test("photos: images only, 1 byte to 10 MiB, 8 per phase, after required", () => {
    expect(mediaRefusal("image/jpeg", 1)).toBeNull();
    expect(mediaRefusal("image/webp", MEDIA_MAX_BYTES)).toBeNull();
    expect(mediaRefusal("image/png", MEDIA_MAX_BYTES + 1)).not.toBeNull();
    expect(mediaRefusal("video/mp4", 10)).not.toBeNull();
    expect(mediaRefusal("image/gif", 10)).not.toBeNull();
    expect(mediaRefusal("image/jpeg", 0)).not.toBeNull();
    expect(photoRoom(0)).toBe(8);
    expect(photoRoom(8)).toBe(0);
    expect(photoRoom(9)).toBe(0);
    expect(workMissing(0, "")).toEqual(["תמונה אחרי הטיפול", "סיכום הטיפול"]);
    expect(workMissing(1, "  ")).toEqual(["סיכום הטיפול"]);
    expect(workMissing(1, "בוצע")).toEqual([]);
  });

  test("close: טופל needs signer and signature; המשך טיפול needs reason and notes; both the summary", () => {
    const draft = { outcome: null, signer: "", hasSignature: false, reasonId: null, nextNotes: "" };
    expect(closeMissing(draft)).toEqual(["תוצאה"]);
    expect(closeMissing({ ...draft, outcome: "done" })).toEqual(["שם החותם", "חתימת הלקוח"]);
    expect(closeMissing({ ...draft, outcome: "done", signer: "א", hasSignature: true })).toEqual([]);
    expect(closeMissing({ ...draft, outcome: "followup" })).toEqual(["סיבה", "מה צריך בביקור הבא"]);
    const done = { outcome: "done" as const, summary: "s", signerName: "א", ackTextSha256: "a".repeat(64), signatureMediaId: V1, followupReasonId: null, nextVisitNotes: null };
    expect(closeInputRefusal(done)).toBeNull();
    expect(closeInputRefusal({ ...done, summary: " " })).toBe("summary-required");
    expect(closeInputRefusal({ ...done, signatureMediaId: null })).toBe("signature-required");
    expect(closeInputRefusal({ ...done, signerName: "" })).toBe("signature-required");
    const cont = { outcome: "followup" as const, summary: "s", signerName: null, ackTextSha256: null, signatureMediaId: null, followupReasonId: V2, nextVisitNotes: "להביא חלק" };
    expect(closeInputRefusal(cont)).toBeNull();
    expect(closeInputRefusal({ ...cont, followupReasonId: null })).toBe("reason-required");
    expect(closeInputRefusal({ ...cont, nextVisitNotes: "" })).toBe("reason-required");
    expect(closeInputRefusal({ ...cont, summary: "" })).toBe("summary-required");
    expect(closeInputRefusal({ ...cont, signerName: "x" })).toBe("invalid");
  });

  test("the approval text's sha256 (the device sends it; the server holds the same text)", async () => {
    const { createHash } = await import("node:crypto");
    expect(await sha256Hex(APPROVAL_TEXT_V1)).toBe(createHash("sha256").update(APPROVAL_TEXT_V1, "utf8").digest("hex"));
  });
});

test.describe("photo compression sizing (D95 (h))", () => {
  onlyInProject("desktop");

  test("the long edge is capped, the aspect ratio kept, never enlarged", () => {
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: LONG_EDGE_MAX, height: 1440 });
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({ width: 1440, height: LONG_EDGE_MAX });
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: 4000, height: 10 }, 1000)).toEqual({ width: 1000, height: 3 });
    expect(LONG_EDGE_MAX).toBeGreaterThanOrEqual(1600);
    expect(LONG_EDGE_MAX).toBeLessThanOrEqual(2000);
  });

  test("the attempts: the quality ladder first, then smaller edges, never under the minimum", () => {
    const a = compressionAttempts({ width: 4032, height: 3024 });
    expect(a[0]).toEqual({ edge: LONG_EDGE_MAX, quality: 0.85 });
    expect(a.slice(0, 4).map((x) => x.quality)).toEqual([0.85, 0.75, 0.65, 0.55]);
    expect(a.slice(4).every((x) => x.edge < LONG_EDGE_MAX && x.edge >= LONG_EDGE_MIN)).toBe(true);
    const small = compressionAttempts({ width: 900, height: 700 });
    expect(small.every((x) => x.edge === 900)).toBe(true);
  });

  test("acceptance: under the ~2 MB target, or under the 10 MiB ceiling on the last attempt only", () => {
    expect(acceptable(TARGET_BYTES, false)).toBe(true);
    expect(acceptable(TARGET_BYTES + 1, false)).toBe(false);
    expect(acceptable(TARGET_BYTES + 1, true)).toBe(true);
    expect(acceptable(MEDIA_MAX_BYTES + 1, true)).toBe(false);
    expect(acceptable(0, true)).toBe(false);
  });

  test("output: JPEG, or WebP when the input is WebP and the browser encodes it", () => {
    expect(outputMime("image/jpeg", true)).toBe("image/jpeg");
    expect(outputMime("image/png", true)).toBe("image/jpeg");
    expect(outputMime("image/heic", true)).toBe("image/jpeg");
    expect(outputMime("image/webp", true)).toBe("image/webp");
    expect(outputMime("image/webp", false)).toBe("image/jpeg");
  });
});
