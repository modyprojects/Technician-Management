"use server";
// The technician visit flow's server actions (D95; Migration 7). Each action:
// - takes its input as `unknown` and re-validates it (strict Zod shape and the shared rules of
//   features/visit-flow/rules.ts), so the device and the server refuse the same things;
// - admits only an active Technician from the server-validated session (areaDecision "tech");
//   anyone else gets the generic 42501 and the database is not called;
// - calls the Migration 7 public wrappers under the caller's OWN session (RLS; SECURITY INVOKER
//   wrappers over the checked writers), so the database decides: his own visit, the transition,
//   the field_version, the operation id's replay. No secret key anywhere here;
// - answers with a code only (never a database text, a token or a path in a log; docs/security.md §8).
//   A missing configuration or an unexpected failure answers "retry": the device keeps the item.
// App rules on top of the database's (D95 (a)): at most 8 photos per phase, "after" required before a
// closure, images only up to the bucket's 10 MiB ceiling (the compressed blob's declared type and
// size, D95 (h), (i)). Signed upload links are created under the caller's session (the Storage
// INSERT policy admits only his own pending path) and are short-lived; they are never logged.
import "server-only";
import { z } from "zod";
import { isUuid } from "@/features/data-access/common";
import type { ApiResult, QueueErrorCode } from "@/features/visit-flow/queue";
import {
  APPROVAL_TEXT_V1,
  closeInputRefusal,
  isMediaMime,
  MEDIA_MAX_BYTES,
  mediaRefusal,
  NEXT_NOTES_MAX,
  PHOTOS_PER_PHASE_MAX,
  sha256Hex,
  SIGNER_MAX,
  SUMMARY_MAX,
} from "@/features/visit-flow/rules";
import { areaDecision } from "@/features/auth/session-state";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "visit-media";
type Code = QueueErrorCode | "retry";
type Result<T> = { ok: true; value: T } | { ok: false; code: Code };

const uuid = z.string().refine(isUuid);
const instant = z.string().min(10).max(40).refine((s) => Number.isFinite(Date.parse(s)));
const clock = z.strictObject({
  reportedAt: instant,
  deviceTz: z.string().min(1).max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/),
  deviceUtcOffsetMin: z.number().int().min(-840).max(840),
});
const timeInput = z.strictObject({
  visitId: uuid,
  operationId: uuid,
  expectedFieldVersion: z.number().int().min(1),
  clock,
  deviceSentAt: instant,
});
const mediaInput = z.strictObject({
  visitId: uuid,
  operationId: uuid,
  kind: z.enum(["photo", "signature"]),
  phase: z.enum(["before", "after"]).nullable(),
  mimeType: z.string().refine(isMediaMime),
  sizeBytes: z.number().int().min(1).max(MEDIA_MAX_BYTES),
  clock,
  deviceSentAt: instant,
});
const confirmInput = z.strictObject({ mediaId: uuid });
const closeInput = z.strictObject({
  visitId: uuid,
  operationId: uuid,
  expectedFieldVersion: z.number().int().min(1),
  outcome: z.enum(["done", "followup"]),
  summary: z.string().max(SUMMARY_MAX),
  signerName: z.string().max(SIGNER_MAX).nullable(),
  ackTextSha256: z.string().max(64).nullable(),
  signatureMediaId: uuid.nullable(),
  followupReasonId: uuid.nullable(),
  nextVisitNotes: z.string().max(NEXT_NOTES_MAX).nullable(),
  clock,
  deviceSentAt: instant,
});

const DB_CODES: readonly QueueErrorCode[] = ["PT409", "55000", "42501", "22023", "23505"];

/** A database refusal → its code; anything else (network, server) → "retry". */
function codeOf(error: { code?: string } | null): Code {
  const c = error?.code ?? "";
  return (DB_CODES as readonly string[]).includes(c) ? (c as QueueErrorCode) : "retry";
}

type Db = NonNullable<Awaited<ReturnType<typeof createUserSupabaseClient>>>;

/** Runs `fn` for an active Technician under his own session, or refuses. */
async function asTechnician<T>(name: string, fn: (db: Db) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    const decision = areaDecision(await getSessionState(), "tech");
    if (!("allow" in decision) || !decision.allow.technicianId) return { ok: false, code: "42501" };
    const db = await createUserSupabaseClient();
    if (!db) return { ok: false, code: "retry" };
    const r = await fn(db);
    if (!r.ok) logAuthEvent(`visit.${name}.refused`, r.code);
    return r;
  } catch {
    logAuthEvent(`visit.${name}.exception`, "exception");
    return { ok: false, code: "retry" };
  }
}

const rpcArgs = (i: z.infer<typeof timeInput>) => ({
  p_visit_id: i.visitId,
  p_operation_id: i.operationId,
  p_expected_field_version: i.expectedFieldVersion,
  p_reported_at: i.clock.reportedAt,
  p_device_tz: i.clock.deviceTz,
  p_device_utc_offset_min: i.clock.deviceUtcOffsetMin,
  p_device_sent_at: i.deviceSentAt,
});

const statusRow = z.object({ out_status: z.string(), out_field_version: z.number().int() });

/** "יוצא · Waze" (D71): records the departure; Waze opens only after this answers ok. */
export async function departVisit(input: unknown): Promise<Result<{ fieldVersion: number }>> {
  return asTechnician("depart", async (db) => {
    const i = timeInput.safeParse(input);
    if (!i.success) return { ok: false, code: "22023" };
    const { data, error } = await db.rpc("depart_visit", rpcArgs(i.data));
    if (error) return { ok: false, code: codeOf(error) };
    const row = statusRow.safeParse(Array.isArray(data) ? data[0] : data);
    return row.success ? { ok: true, value: { fieldVersion: row.data.out_field_version } } : { ok: false, code: "retry" };
  });
}

/** "הגעתי · התחלת טיפול" (TE-13), also replayed from the device queue. */
export async function arriveVisit(input: unknown): Promise<Result<{ fieldVersion: number }>> {
  return asTechnician("arrive", async (db) => {
    const i = timeInput.safeParse(input);
    if (!i.success) return { ok: false, code: "22023" };
    const { data, error } = await db.rpc("arrive_visit", rpcArgs(i.data));
    if (error) return { ok: false, code: codeOf(error) };
    const row = statusRow.safeParse(Array.isArray(data) ? data[0] : data);
    return row.success ? { ok: true, value: { fieldVersion: row.data.out_field_version } } : { ok: false, code: "retry" };
  });
}

const mediaRow = z.object({ out_media_id: uuid, out_storage_path: z.string().min(1).max(200), out_replay: z.boolean() });

/**
 * A photo or the signature (TE-14, TE-19): the pending row (add_visit_media) and a short-lived
 * signed upload link to exactly its path. A replay answers the same row; when its object is
 * already stored the link is null (the device goes straight to the confirmation).
 */
export async function addVisitMedia(input: unknown): Promise<Result<{ mediaId: string; uploadUrl: string | null }>> {
  return asTechnician<{ mediaId: string; uploadUrl: string | null }>("media", async (db) => {
    const parsed = mediaInput.safeParse(input);
    if (!parsed.success) return { ok: false, code: "22023" };
    const i = parsed.data;
    if (mediaRefusal(i.mimeType, i.sizeBytes)) return { ok: false, code: "22023" };
    if ((i.kind === "photo") !== (i.phase !== null)) return { ok: false, code: "22023" };
    if (i.kind === "signature" && i.mimeType !== "image/png") return { ok: false, code: "22023" };
    // D95 (a): at most 8 photos per phase. A replay of the same operation is not counted again.
    const existing = await db.from("visit_media").select("id").eq("operation_id", i.operationId).maybeSingle();
    if (existing.error) return { ok: false, code: codeOf(existing.error) };
    if (!existing.data && i.kind === "photo") {
      const count = await db
        .from("visit_media")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", i.visitId)
        .eq("kind", "photo")
        .eq("phase", i.phase as string);
      if (count.error) return { ok: false, code: codeOf(count.error) };
      if ((count.count ?? 0) >= PHOTOS_PER_PHASE_MAX) return { ok: false, code: "limit" };
    }
    const { data, error } = await db.rpc("add_visit_media", {
      p_visit_id: i.visitId,
      p_operation_id: i.operationId,
      p_kind: i.kind,
      p_phase: i.phase,
      p_mime_type: i.mimeType,
      p_size_bytes: i.sizeBytes,
      p_captured_at: i.clock.reportedAt,
      p_device_tz: i.clock.deviceTz,
      p_device_utc_offset_min: i.clock.deviceUtcOffsetMin,
      p_device_sent_at: i.deviceSentAt,
    });
    if (error) return { ok: false, code: codeOf(error) };
    const row = mediaRow.safeParse(Array.isArray(data) ? data[0] : data);
    if (!row.success) return { ok: false, code: "retry" };
    const state = await db.from("visit_media").select("state").eq("id", row.data.out_media_id).maybeSingle();
    if (state.error) return { ok: false, code: codeOf(state.error) };
    if ((state.data as { state?: string } | null)?.state === "stored") return { ok: true, value: { mediaId: row.data.out_media_id, uploadUrl: null } };
    const signed = await db.storage.from(BUCKET).createSignedUploadUrl(row.data.out_storage_path);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, code: "upload" };
    return { ok: true, value: { mediaId: row.data.out_media_id, uploadUrl: signed.data.signedUrl } };
  });
}

/** The uploaded object is checked (size and type) and the row becomes 'stored' (idempotent). */
export async function confirmVisitMedia(input: unknown): Promise<Result<null>> {
  return asTechnician("confirm", async (db) => {
    const i = confirmInput.safeParse(input);
    if (!i.success) return { ok: false, code: "22023" };
    const { error } = await db.rpc("confirm_visit_media", { p_media_id: i.data.mediaId });
    return error ? { ok: false, code: codeOf(error) } : { ok: true, value: null };
  });
}

const closeRow = z.object({ out_status: z.string() });

/**
 * The closure (TE-18 to TE-22; D95 (b), (c)): "טופל" with the signer, the stored signature and the
 * hash of the fixed approval text, or "המשך טיפול" with an active reason and the next-visit notes;
 * the written summary on both. At least one stored "after" photo first (D95 (a)), unless the visit
 * is already closed (a replay answers the stored outcome from the database).
 */
export async function closeVisit(input: unknown): Promise<Result<{ status: string }>> {
  return asTechnician("close", async (db) => {
    const parsed = closeInput.safeParse(input);
    if (!parsed.success) return { ok: false, code: "22023" };
    const i = parsed.data;
    if (closeInputRefusal(i)) return { ok: false, code: "22023" };
    if (i.outcome === "done" && i.ackTextSha256 !== (await sha256Hex(APPROVAL_TEXT_V1))) return { ok: false, code: "22023" };
    const visit = await db.from("visits").select("status").eq("id", i.visitId).maybeSingle();
    if (visit.error) return { ok: false, code: codeOf(visit.error) };
    if (!visit.data) return { ok: false, code: "42501" };
    if ((visit.data as { status: string }).status === "in_progress") {
      const after = await db
        .from("visit_media")
        .select("id", { count: "exact", head: true })
        .eq("visit_id", i.visitId)
        .eq("kind", "photo")
        .eq("phase", "after")
        .eq("state", "stored");
      if (after.error) return { ok: false, code: codeOf(after.error) };
      if ((after.count ?? 0) < 1) return { ok: false, code: "after-required" };
    }
    const { data, error } = await db.rpc("close_visit", {
      p_visit_id: i.visitId,
      p_operation_id: i.operationId,
      p_expected_field_version: i.expectedFieldVersion,
      p_outcome: i.outcome,
      p_summary: i.summary,
      p_signer_name: i.signerName,
      p_ack_text_sha256: i.ackTextSha256,
      p_signature_media_id: i.signatureMediaId,
      p_followup_reason_id: i.followupReasonId,
      p_next_visit_notes: i.nextVisitNotes,
      p_reported_at: i.clock.reportedAt,
      p_device_tz: i.clock.deviceTz,
      p_device_utc_offset_min: i.clock.deviceUtcOffsetMin,
      p_device_sent_at: i.deviceSentAt,
    });
    if (error) return { ok: false, code: codeOf(error) };
    const row = closeRow.safeParse(Array.isArray(data) ? data[0] : data);
    return row.success ? { ok: true, value: { status: row.data.out_status } } : { ok: false, code: "retry" };
  });
}

// Keeps the result type of the queue port in step with these actions.
export type VisitActionResult<T> = ApiResult<T> | { ok: false; code: "retry" };
