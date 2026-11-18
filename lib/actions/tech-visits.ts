"use server";

// The technician's field actions (Step 4, Version 1; Migration 7): "יוצא · Waze", "הגעתי · התחלת
// טיפול", a photo, and the closure ("טופל" / "המשך טיפול"). The real technician pages pass them to
// their client components as props (components/ never imports lib/actions). Each action:
// - takes its input as `unknown` (or a FormData for a photo) and re-validates it
//   (features/visits/supabase/field-commands.ts: strict Zod, then the database);
// - takes the caller from the server-validated session (lib/auth/session.ts): an active Technician
//   with a technician record, never from the input; anything else is refused before any call;
// - runs under the caller's own session: the Migration 7 writers check his visit, the transition and
//   the field version; the Storage policy admits only his own pending object path;
// - answers with Hebrew messages only (no database text, no stack trace; docs/security.md §8) and
//   logs an event name and a code only.
// Next.js checks the Origin of every server-action POST against the Host.
import "server-only";
import type { CommandResult } from "@/features/data-access/common";
import { FIELD_MESSAGES, PHOTO_MAX_BYTES } from "@/features/visits/data/field";
import { fieldCommandsOf, type FieldCommands } from "@/features/visits/supabase/field-commands";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

async function withField<T>(run: (c: FieldCommands) => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
  try {
    const state = await getSessionState();
    if (state.kind === "unavailable") return { ok: false, simulated: false, error: FIELD_MESSAGES.unavailable };
    if (state.kind !== "signed-in" || state.user.role !== "tech" || !state.user.technicianId) {
      return { ok: false, simulated: false, error: FIELD_MESSAGES.forbidden };
    }
    const db = await createUserSupabaseClient();
    if (!db) return { ok: false, simulated: false, error: FIELD_MESSAGES.unavailable };
    return await run(fieldCommandsOf(db, logAuthEvent));
  } catch {
    logAuthEvent("tech.field_action.exception", "exception");
    return { ok: false, simulated: false, error: FIELD_MESSAGES.unknown };
  }
}

/** "יוצא · Waze": scheduled -> en route, with the device's departure time. */
export async function departVisit(input: unknown) {
  return withField((c) => c.depart(input));
}

/** "הגעתי · התחלת טיפול": en route -> in progress, with the device's arrival time. */
export async function arriveVisit(input: unknown) {
  return withField((c) => c.arrive(input));
}

/** A photo of the visit in progress: the form's `meta` (JSON) and `file` (a compressed image). */
export async function addVisitPhoto(form: unknown) {
  return withField(async (c) => {
    if (!(form instanceof FormData)) return { ok: false, simulated: false, error: FIELD_MESSAGES.invalid };
    const file = form.get("file");
    const metaText = form.get("meta");
    if (!(file instanceof Blob) || typeof metaText !== "string" || metaText.length > 2000) {
      return { ok: false, simulated: false, error: FIELD_MESSAGES.invalid };
    }
    if (file.size === 0 || file.size > PHOTO_MAX_BYTES) return { ok: false, simulated: false, error: FIELD_MESSAGES.tooLarge };
    let meta: unknown;
    try {
      meta = JSON.parse(metaText);
    } catch {
      return { ok: false, simulated: false, error: FIELD_MESSAGES.invalid };
    }
    return c.addPhoto(meta, new Uint8Array(await file.arrayBuffer()));
  });
}

/** The closure, "טופל" (with the signature image) or "המשך טיפול" (with its reason and notes). */
export async function closeVisit(input: unknown) {
  return withField((c) => c.close(input));
}
