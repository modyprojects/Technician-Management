// The real field actions as a technician page hands them to its client components (Step 4, Version
// 1). Pure types and one browser adapter (no server code, no secret):
// - FieldActions: the shape of the four `"use server"` actions of lib/actions/tech-visits.ts;
// - visitCommandsOfActions: the VisitCommands port over them for ONE visit, so the shared work and
//   close components (components/tech/*) run the real actions through the port the /dev/demo
//   prototype implements with simulated commands.
// Operation ids (D46): one per user intent, kept until the server answers, so a retry after a lost
// answer is a replay on the server (never a second departure or closure); a refused operation is
// not stored by the server, and the next attempt uses a new id. The device's clock values are sent
// as reported (D45). What Version 1 does not store (parts, recordings, removing a stored photo, the
// summary before the closure) answers honestly instead of pretending (G-06).
import type { CommandResult } from "@/features/data-access/common";
import type { VisitCommands } from "./ports";
import { deviceStamp, FIELD_MESSAGES, FIXED_ACK_TEXT } from "./field";
import type { MediaItem } from "./types";

type Action<T> = (input: unknown) => Promise<CommandResult<T>>;

export type FieldActions = {
  departVisit: Action<{ status: string; fieldVersion: number; replay: boolean }>;
  arriveVisit: Action<{ status: string; fieldVersion: number; replay: boolean }>;
  addVisitPhoto: Action<{ mediaId: string }>;
  closeVisit: Action<{ status: string; callStatus: string; replay: boolean }>;
};

/** What the adapter knows about the one visit of the page. */
export type FieldVisit = {
  visitId: string;
  fieldVersion: number;
  isTest: boolean;
  /** Active continuation reasons (label → id). */
  reasons: readonly { id: string; label: string }[];
};

const notSupported = async (): Promise<CommandResult> => ({ ok: false, simulated: false, error: FIELD_MESSAGES.notSupported });

/** sha256 hex of UTF-8 text, in the browser (D43: the device sends the hash of the text it showed). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.normalize("NFC")));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A photo downscaled to at most 1600 px and re-encoded as JPEG (D13), under the server's byte cap. */
export async function compressPhoto(file: Blob, maxBytes: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The VisitCommands of one visit over the real actions. `onChanged` runs after a stored departure
 * or arrival (the page reads the server again).
 */
export function visitCommandsOfActions(actions: FieldActions, visit: FieldVisit, maxPhotoBytes: number): VisitCommands {
  const pending = new Map<string, string>();
  /** The operation id of an intent, kept until the server answered it. */
  const opId = (intent: string): string => {
    const known = pending.get(intent);
    if (known) return known;
    const id = crypto.randomUUID();
    pending.set(intent, id);
    return id;
  };
  async function answered<T>(intent: string, run: () => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
    let result: CommandResult<T>;
    try {
      result = await run();
    } catch {
      // No answer (the network): keep the id, so the retry is a replay on the server.
      return { ok: false, simulated: false, error: FIELD_MESSAGES.unknown };
    }
    pending.delete(intent);
    return result;
  }

  return {
    async depart() {
      const r = await answered("depart", () =>
        actions.departVisit({ visitId: visit.visitId, operationId: opId("depart"), fieldVersion: visit.fieldVersion, ...deviceStamp() }),
      );
      return r.ok ? { ok: true, simulated: false } : r;
    },
    async arrive() {
      const r = await answered("arrive", () =>
        actions.arriveVisit({ visitId: visit.visitId, operationId: opId("arrive"), fieldVersion: visit.fieldVersion, ...deviceStamp() }),
      );
      return r.ok ? { ok: true, simulated: false } : r;
    },
    setPickupCollected: notSupported,
    // The summary is written at the closure (Migration 3 c40); until then it stays in the draft.
    async saveSummary() {
      return { ok: true, simulated: false };
    },
    async addMedia(_ref, input) {
      if (input.kind !== "img" || !input.file) return { ok: false, simulated: false, error: FIELD_MESSAGES.notSupported };
      const photo = await compressPhoto(input.file, maxPhotoBytes);
      if (!photo) return { ok: false, simulated: false, error: FIELD_MESSAGES.tooLarge };
      const intent = `photo:${input.when}:${input.file.size}:${(input.file as File).name ?? ""}`;
      const form = new FormData();
      form.set("meta", JSON.stringify({ visitId: visit.visitId, operationId: opId(intent), phase: input.when, ...deviceStamp() }));
      form.set("file", photo, "photo.jpg");
      const r = await answered(intent, () => actions.addVisitPhoto(form));
      if (!r.ok || !r.data) return r.ok ? { ok: false, simulated: false, error: FIELD_MESSAGES.unknown } : r;
      const media: MediaItem = { id: r.data.mediaId, kind: "img", when: input.when, isTest: visit.isTest, previewUrl: URL.createObjectURL(photo) };
      return { ok: true, simulated: false, data: { media } };
    },
    async removeMedia() {
      return { ok: false, simulated: false, error: FIELD_MESSAGES.noRemove };
    },
    saveRecording: notSupported,
    deleteRecording: notSupported,
    saveParts: notSupported,
    async close(_ref, input) {
      const done = input.outcome === "done";
      const reasonId = done ? null : (visit.reasons.find((r) => r.label === input.reason)?.id ?? null);
      if (!done && !reasonId) return { ok: false, simulated: false, error: FIELD_MESSAGES.invalid };
      const r = await answered(`close:${input.outcome}`, async () =>
        actions.closeVisit({
          visitId: visit.visitId,
          operationId: opId(`close:${input.outcome}`),
          signatureOperationId: opId(`signature:${input.outcome}`),
          fieldVersion: visit.fieldVersion,
          outcome: done ? "done" : "followup",
          summary: input.summary ?? "",
          signerName: done ? (input.signerName ?? "") : null,
          ackTextSha256: done ? await sha256Hex(FIXED_ACK_TEXT) : null,
          signatureDataUrl: done ? (input.signatureDataUrl ?? "") : null,
          reasonId,
          nextNote: done ? null : (input.nextNote ?? ""),
          ...deviceStamp(),
        }),
      );
      // Answered either way: the next attempt signs anew (a stored image of a refused closure stays
      // unreferenced; nothing is deleted).
      pending.delete(`signature:${input.outcome}`);
      return r.ok ? { ok: true, simulated: false, message: r.message } : r;
    },
    correct: async () => ({ ok: false, simulated: false, error: FIELD_MESSAGES.notSupported }),
  };
}
