"use client";

// The technician's unsent work on one visit (work screen and close screen): media, summary,
// recording, parts and the close form. It stands in for the device work queue (D46) and lives in
// memory only: it survives moving between the work and close screens and is gone after a reload
// (as in docs/demo.html, where v.draft and S.close are browser memory, G-02). Every change goes
// through the active Commands first (useCommands()); the draft only mirrors what a command
// accepted. Generic: no demo or fixture knowledge here.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MediaItem, VisitRef } from "@/features/visits/data/types";

/** What the work screen starts from: the visit's saved work (empty for a visit not yet worked on). */
export type WorkSeed = {
  media: MediaItem[];
  summary: string;
  recordingSeconds: number;
  parts: string[];
};

export type SummaryMode = "text" | "rec";
export type CloseOutcome = "done" | "cont";

/** Where sending the close form stands. */
export type CloseSubmit =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "error"; error: string }
  | {
      state: "sent";
      outcome: CloseOutcome;
      /** True when nothing was saved or sent (UI demo); the screen must not claim a save. */
      simulated: boolean;
      message: string;
    };

export type CloseDraft = {
  outcome: CloseOutcome | null;
  /** Follow-up reason ("cont"). */
  reason: string | null;
  /** "מה צריך בביקור הבא" ("cont", TE-21). */
  nextNote: string;
  /** Signer name ("done"). */
  signer: string;
  /** PNG data URL of the signature ("done"); null while the pad is empty. */
  signature: string | null;
  submit: CloseSubmit;
};

export type VisitDraft = {
  media: MediaItem[];
  summary: string;
  /** The summary text last accepted by saveSummary (saved again on blur only when it changed). */
  savedSummary: string;
  recordingSeconds: number;
  /** The last recording command was simulated: say so instead of "נשמרה" (TE-23, G-06). */
  recordingSimulated: boolean;
  mode: SummaryMode;
  parts: string[];
  close: CloseDraft;
};

/**
 * TE-16 is PENDING (open decision 3, d06): closing a visit with a recording only and no written
 * summary waits for the owner's decision. Until then the work screen requires a written summary
 * (deny by default); the recording stays optional. Set to true to restore the demo's rule
 * ("חובה: כתיבה או הקלטה", docs/demo.html workReady()).
 */
export const VOICE_ONLY_CLOSE = false;

/** D13 (provisional) and TE-15: a recording is at most 180 seconds. */
export const RECORDING_LIMIT_SECONDS = 180;

/**
 * Photos and videos per phase (before / after) on one visit. A temporary UI bound until the final
 * counts are decided (open decision 4, d07); the server enforces its own limits.
 */
export const MEDIA_PER_PHASE_MAX = 12;

const EMPTY_CLOSE: CloseDraft = {
  outcome: null,
  reason: null,
  nextNote: "",
  signer: "",
  signature: null,
  submit: { state: "idle" },
};

function draftOf(seed: WorkSeed): VisitDraft {
  return {
    media: [...seed.media],
    summary: seed.summary,
    savedSummary: seed.summary,
    recordingSeconds: seed.recordingSeconds,
    recordingSimulated: false,
    mode: "text",
    parts: [...seed.parts],
    close: EMPTY_CLOSE,
  };
}

const drafts = new Map<string, VisitDraft>();
const listeners = new Set<() => void>();

const keyOf = (ref: VisitRef): string => `${ref.req}/${ref.n}`;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

const serverSnapshot = (): VisitDraft | undefined => undefined;

/** Forgets the visit's draft (after a successful close, as the demo's sendClose() does). */
export function clearVisitDraft(ref: VisitRef): void {
  if (drafts.delete(keyOf(ref))) emit();
}

/** True when the visit's draft holds a successful close. */
export function isVisitDraftSent(ref: VisitRef): boolean {
  return drafts.get(keyOf(ref))?.close.submit.state === "sent";
}

export type UpdateDraft = (change: (draft: VisitDraft) => VisitDraft) => void;

/**
 * The visit's draft and an updater. Several components of one screen (main area and footer)
 * share it. `change` receives the latest draft, so results of commands that finish later never
 * overwrite newer edits.
 */
export function useVisitDraft(ref: VisitRef, seed: WorkSeed): [VisitDraft, UpdateDraft] {
  const key = keyOf(ref);
  const initial = useMemo(() => draftOf(seed), [seed]);
  const getSnapshot = useCallback(() => drafts.get(key), [key]);
  const stored = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const update = useCallback<UpdateDraft>(
    (change) => {
      drafts.set(key, change(drafts.get(key) ?? draftOf(seed)));
      emit();
    },
    [key, seed],
  );
  return [stored ?? initial, update];
}

/** Updates the close form only. */
export const withClose = (draft: VisitDraft, patch: Partial<CloseDraft>): VisitDraft => ({
  ...draft,
  close: { ...draft.close, ...patch },
});

const hasAfterMedia = (d: VisitDraft): boolean => d.media.some((m) => m.when === "after");
const hasSummary = (d: VisitDraft): boolean =>
  d.summary.trim() !== "" || (VOICE_ONLY_CLOSE && d.recordingSeconds > 0);

/** docs/demo.html workReady(): an after photo or video, and a summary. */
export function workReady(d: VisitDraft): boolean {
  return hasSummary(d) && hasAfterMedia(d);
}

/** docs/demo.html workHint(), with TE-16 pending (see VOICE_ONLY_CLOSE). */
export function workHint(d: VisitDraft): string {
  const sum = hasSummary(d);
  const after = hasAfterMedia(d);
  if (sum && after) return "אפשר לסיים את הביקור";
  if (!sum && !after) return "חסרים: תמונה אחרי הטיפול וסיכום";
  if (!after) return "חסרה תמונה או סרטון אחרי הטיפול";
  if (VOICE_ONLY_CLOSE) return "חסר סיכום כתוב או הקלטה";
  return d.recordingSeconds > 0 ? "חסר סיכום כתוב · סגירה עם הקלטה בלבד ממתינה להחלטה" : "חסר סיכום כתוב";
}

/** "1:05" (the demo's recLabel()). */
export const recordingLabel = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
