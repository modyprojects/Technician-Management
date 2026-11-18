// The technician's field actions on the server (Step 4, Version 1): the Migration 7 RPCs and the
// private bucket 'visit-media', over a Supabase client under the TECHNICIAN'S OWN SESSION (the
// writers check the caller, his visit, the transition and the field version; the Storage INSERT
// policy admits only his own pending object path). No secret key, no environment, no server-only
// import: lib/actions/tech-visits.ts wires it per request, and the local-stack tests run it.
// Every input arrives untrusted and is re-validated here (strict Zod, then the database). Answers are
// CommandResults with Hebrew messages only (features/visits/data/field.ts), never a database text.
// Timestamps: the device's values are sent as reported (D45); every server time is the database's.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandResult } from "@/features/data-access/common";
import {
  cleanFieldText,
  closeSchema,
  FIELD_MESSAGES,
  fieldErrorMessage,
  fieldStepSchema,
  imageTypeOf,
  PHOTO_MAX_BYTES,
  photoMetaSchema,
  SIGNATURE_MAX_BYTES,
  type DeviceStamp,
} from "@/features/visits/data/field";

export const VISIT_MEDIA_BUCKET = "visit-media";

type Log = (event: string, code: unknown) => void;
type Fail = { ok: false; simulated: false; error: string };
const fail = (error: string): Fail => ({ ok: false, simulated: false, error });

/** The PNG bytes of a signature data URL, or null (not a PNG data URL, too large, or not a PNG). */
export function signatureBytes(dataUrl: unknown): Uint8Array | null {
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) return null;
  const b64 = dataUrl.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 4) return null;
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  return bytes.length > 0 && bytes.length <= SIGNATURE_MAX_BYTES && imageTypeOf(bytes) === "image/png" ? bytes : null;
}

const deviceArgs = (d: DeviceStamp) => ({
  p_device_tz: d.deviceTz,
  p_device_utc_offset_min: d.deviceUtcOffsetMin,
  p_device_sent_at: d.deviceSentAt,
});

type StepResult = { status: string; fieldVersion: number; replay: boolean };

export type FieldCommands = {
  depart(input: unknown): Promise<CommandResult<StepResult>>;
  arrive(input: unknown): Promise<CommandResult<StepResult>>;
  /** A photo: its metadata and its bytes (already read from the form). */
  addPhoto(meta: unknown, bytes: Uint8Array): Promise<CommandResult<{ mediaId: string }>>;
  close(input: unknown): Promise<CommandResult<{ status: string; callStatus: string; replay: boolean }>>;
};

export function fieldCommandsOf(db: SupabaseClient, log: Log): FieldCommands {
  async function step(fn: "depart_visit" | "arrive_visit", input: unknown): Promise<CommandResult<StepResult>> {
    const parsed = fieldStepSchema.safeParse(input);
    if (!parsed.success) return fail(FIELD_MESSAGES.invalid);
    const v = parsed.data;
    const { data, error } = await db.rpc(fn, {
      p_visit_id: v.visitId,
      p_operation_id: v.operationId,
      p_expected_field_version: v.fieldVersion,
      p_reported_at: v.reportedAt,
      ...deviceArgs(v),
    });
    if (error) {
      log(`tech.${fn}.refused`, error.code);
      return fail(fieldErrorMessage(error.code, error.message));
    }
    const row = Array.isArray(data) ? (data[0] as { out_status?: unknown; out_field_version?: unknown; out_replay?: unknown }) : null;
    if (!row || typeof row.out_status !== "string" || typeof row.out_field_version !== "number") return fail(FIELD_MESSAGES.unknown);
    return { ok: true, simulated: false, data: { status: row.out_status, fieldVersion: row.out_field_version, replay: row.out_replay === true } };
  }

  /** A media row, its object and the stored state, in that order; idempotent per operation id. */
  async function storeMedia(
    visitId: string,
    operationId: string,
    kind: "photo" | "signature",
    phase: "before" | "after" | null,
    bytes: Uint8Array,
    mime: string,
    stamp: DeviceStamp,
  ): Promise<CommandResult<{ mediaId: string }>> {
    const added = await db.rpc("add_visit_media", {
      p_visit_id: visitId,
      p_operation_id: operationId,
      p_kind: kind,
      p_phase: phase,
      p_mime_type: mime,
      p_size_bytes: bytes.length,
      p_captured_at: stamp.reportedAt,
      ...deviceArgs(stamp),
    });
    if (added.error) {
      log("tech.add_visit_media.refused", added.error.code);
      return fail(fieldErrorMessage(added.error.code, added.error.message));
    }
    const row = Array.isArray(added.data) ? (added.data[0] as { out_media_id?: unknown; out_storage_path?: unknown }) : null;
    if (!row || typeof row.out_media_id !== "string" || typeof row.out_storage_path !== "string") return fail(FIELD_MESSAGES.unknown);
    const upload = await db.storage
      .from(VISIT_MEDIA_BUCKET)
      .upload(row.out_storage_path, bytes, { contentType: mime, upsert: false, cacheControl: "3600" });
    // A replayed operation finds its object already stored (a duplicate): confirm decides.
    if (upload.error && !/exist|duplicate/i.test(upload.error.message)) {
      log("tech.media_upload.failed", "storage");
      return fail(FIELD_MESSAGES.notStored);
    }
    const confirmed = await db.rpc("confirm_visit_media", { p_media_id: row.out_media_id });
    if (confirmed.error) {
      log("tech.confirm_visit_media.refused", confirmed.error.code);
      return fail(fieldErrorMessage(confirmed.error.code, confirmed.error.message));
    }
    return { ok: true, simulated: false, data: { mediaId: row.out_media_id } };
  }

  return {
    depart: (input) => step("depart_visit", input),
    arrive: (input) => step("arrive_visit", input),

    async addPhoto(meta, bytes) {
      const parsed = photoMetaSchema.safeParse(meta);
      if (!parsed.success) return fail(FIELD_MESSAGES.invalid);
      if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return fail(FIELD_MESSAGES.tooLarge);
      const type = imageTypeOf(bytes);
      if (!type) return fail(FIELD_MESSAGES.badImage);
      const m = parsed.data;
      return storeMedia(m.visitId, m.operationId, "photo", m.phase, bytes, type, m);
    },

    async close(input) {
      const parsed = closeSchema.safeParse(input);
      if (!parsed.success) return fail(FIELD_MESSAGES.invalid);
      const c = parsed.data;
      const summary = cleanFieldText(c.summary);
      if (!summary) return fail(FIELD_MESSAGES.invalid);
      let signatureMediaId: string | null = null;
      let signer: string | null = null;
      let nextNote: string | null = null;
      if (c.outcome === "done") {
        signer = cleanFieldText(c.signerName);
        const png = signatureBytes(c.signatureDataUrl);
        if (!signer || !png || !c.ackTextSha256 || c.reasonId !== null) return fail(FIELD_MESSAGES.invalid);
        const stored = await storeMedia(c.visitId, c.signatureOperationId, "signature", null, png, "image/png", c);
        if (!stored.ok) return stored;
        signatureMediaId = stored.data?.mediaId ?? null;
      } else {
        nextNote = cleanFieldText(c.nextNote);
        if (!c.reasonId || !nextNote || c.signerName !== null || c.signatureDataUrl !== null) return fail(FIELD_MESSAGES.invalid);
      }
      const { data, error } = await db.rpc("close_visit", {
        p_visit_id: c.visitId,
        p_operation_id: c.operationId,
        p_expected_field_version: c.fieldVersion,
        p_outcome: c.outcome,
        p_summary: summary,
        p_signer_name: signer,
        p_ack_text_sha256: c.outcome === "done" ? c.ackTextSha256 : null,
        p_signature_media_id: signatureMediaId,
        p_followup_reason_id: c.outcome === "followup" ? c.reasonId : null,
        p_next_visit_notes: nextNote,
        p_reported_at: c.reportedAt,
        ...deviceArgs(c),
      });
      if (error) {
        log("tech.close_visit.refused", error.code);
        return fail(fieldErrorMessage(error.code, error.message));
      }
      const row = Array.isArray(data) ? (data[0] as { out_status?: unknown; out_call_status?: unknown; out_replay?: unknown }) : null;
      if (!row || typeof row.out_status !== "string" || typeof row.out_call_status !== "string") return fail(FIELD_MESSAGES.unknown);
      return {
        ok: true,
        simulated: false,
        message: FIELD_MESSAGES.closed,
        data: { status: row.out_status, callStatus: row.out_call_status, replay: row.out_replay === true },
      };
    },
  };
}
