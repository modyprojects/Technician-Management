// Server-side reads of the visit flow (D95). Server-only; every read runs under the signed-in
// user's OWN session (RLS), never the secret key:
// - flowContext: the visit's field_version (the base of the device's operations, Migration 7) and
//   the active continuation reasons (followup_reasons_select_technician);
// - visitPhotos / callPhotos: the stored photos of a visit (visit_media, RLS: the visit's current
//   technician, or an office user with `card` and (`cal` or `calls`)) as SHORT-LIVED signed links
//   created under the same session (the Storage SELECT policy checks the caller again). Never a
//   public URL; a link is never logged. The signature image is not served here (the screens show
//   the signer and the approval text preserved at signing, D43).
import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/features/auth/data/types";
import { isUuid } from "@/features/data-access/common";
import type { PhotoPhase } from "@/features/visit-flow/rules";
import { logAuthEvent } from "@/lib/auth/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "visit-media";
/** Signed photo links live 5 minutes (a page renders them at once; a reload issues new ones). */
export const SIGNED_URL_SECONDS = 300;
/** At most this many photos are signed per page (the server allows 30 media per visit). */
const PHOTOS_MAX = 120;

export type FlowReason = { id: string; label: string };
export type FlowContext = { fieldVersion: number; reasons: FlowReason[] };
export type VisitPhoto = { id: string; phase: PhotoPhase; url: string; isTest: boolean };

class VisitFlowReadError extends Error {}

/** The flow context of `me`'s own visit, or null when it is not readable (not his, unknown). */
export async function flowContext(me: SessionUser, visitId: string): Promise<FlowContext | null> {
  if (me.role !== "tech" || !me.technicianId || !isUuid(visitId)) return null;
  const db = await createUserSupabaseClient();
  if (!db) throw new VisitFlowReadError("not-configured");
  const [visit, reasons] = await Promise.all([
    db.from("visits").select("field_version").eq("id", visitId).eq("technician_id", me.technicianId).maybeSingle(),
    db.from("followup_reasons").select("id, label_he").eq("is_active", true).order("sort_order").limit(50),
  ]);
  if (visit.error || reasons.error) {
    logAuthEvent("visit.read.context_failed", visit.error?.code ?? reasons.error?.code ?? "error");
    throw new VisitFlowReadError("read");
  }
  const v = z.object({ field_version: z.number().int().min(1) }).safeParse(visit.data);
  if (!v.success) return null;
  const rows = z.array(z.object({ id: z.string().refine(isUuid), label_he: z.string().min(1).max(60) })).parse(reasons.data ?? []);
  return { fieldVersion: v.data.field_version, reasons: rows.map((r) => ({ id: r.id, label: r.label_he })) };
}

const mediaRowSchema = z.object({
  id: z.string().refine(isUuid),
  visit_id: z.string().refine(isUuid),
  phase: z.enum(["before", "after"]),
  storage_path: z.string().min(1).max(200),
  is_test: z.boolean(),
});
type MediaRow = z.infer<typeof mediaRowSchema>;

type Db = NonNullable<Awaited<ReturnType<typeof createUserSupabaseClient>>>;

/** Stored photos of these visits, signed under the caller's session; grouped by visit id. */
async function signedPhotos(db: Db, visitIds: string[]): Promise<Map<string, VisitPhoto[]>> {
  const out = new Map<string, VisitPhoto[]>();
  if (!visitIds.length) return out;
  const res = await db
    .from("visit_media")
    .select("id, visit_id, phase, storage_path, is_test")
    .in("visit_id", visitIds)
    .eq("kind", "photo")
    .eq("state", "stored")
    .order("received_at")
    .limit(PHOTOS_MAX);
  if (res.error) {
    logAuthEvent("visit.read.media_failed", res.error.code);
    throw new VisitFlowReadError("read");
  }
  const rows: MediaRow[] = z.array(mediaRowSchema).parse(res.data ?? []);
  if (!rows.length) return out;
  const signed = await db.storage.from(BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    SIGNED_URL_SECONDS,
  );
  if (signed.error) {
    logAuthEvent("visit.read.sign_failed", "storage");
    throw new VisitFlowReadError("sign");
  }
  const byPath = new Map<string, string>();
  for (const s of signed.data ?? []) if (s.path && s.signedUrl && !s.error) byPath.set(s.path, s.signedUrl);
  for (const r of rows) {
    const url = byPath.get(r.storage_path);
    if (!url) continue;
    const list = out.get(r.visit_id) ?? [];
    list.push({ id: r.id, phase: r.phase, url, isTest: r.is_test });
    out.set(r.visit_id, list);
  }
  return out;
}

/** The technician's own visit's stored photos (the closed view). */
export async function visitPhotos(me: SessionUser, visitId: string): Promise<VisitPhoto[]> {
  if (me.role !== "tech" || !isUuid(visitId)) return [];
  const db = await createUserSupabaseClient();
  if (!db) throw new VisitFlowReadError("not-configured");
  return (await signedPhotos(db, [visitId])).get(visitId) ?? [];
}

/**
 * The office call card's photos (D92 (2), OF-06), by visit number, for the call `req`. Read under
 * the office user's session: without `card` (and `cal` or `calls`) RLS returns no rows, so nothing
 * is signed. The page asks only when the card's report is shown.
 */
export async function callPhotos(req: string): Promise<Map<number, VisitPhoto[]>> {
  const out = new Map<number, VisitPhoto[]>();
  const db = await createUserSupabaseClient();
  if (!db) throw new VisitFlowReadError("not-configured");
  const call = await db.from("service_calls").select("id").eq("request_number", req).maybeSingle();
  if (call.error) {
    logAuthEvent("visit.read.call_failed", call.error.code);
    throw new VisitFlowReadError("read");
  }
  const callId = (call.data as { id?: string } | null)?.id;
  if (!callId) return out;
  const visits = await db.from("visits").select("id, visit_number").eq("service_call_id", callId).limit(100);
  if (visits.error) {
    logAuthEvent("visit.read.visits_failed", visits.error.code);
    throw new VisitFlowReadError("read");
  }
  const rows = z.array(z.object({ id: z.string().refine(isUuid), visit_number: z.number().int() })).parse(visits.data ?? []);
  const photos = await signedPhotos(
    db,
    rows.map((r) => r.id),
  );
  for (const r of rows) {
    const p = photos.get(r.id);
    if (p?.length) out.set(r.visit_number, p);
  }
  return out;
}
