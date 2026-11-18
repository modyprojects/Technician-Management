"use client";

// Technician work screen body (docs/demo.html techWork(), L552-575): media before (optional) and
// after (required), the treatment summary (written or recorded), then the parts replaced (TE-17).
// The footer button and its readiness hint are WorkFooter, which reads the same visit draft.
// Receives DTO-derived props only; every action goes through useCommands().
import type { VisitRef } from "@/features/visits/data/types";
import { MediaTiles } from "./MediaTiles";
import { PartsEditor } from "./PartsEditor";
import { SummaryEditor } from "./SummaryEditor";
import { useVisitDraft, type WorkSeed } from "./WorkDraft";

export function WorkScreen({
  visit,
  seed,
  pickupItem,
  real = false,
}: {
  visit: VisitRef;
  /** The visit's saved work (VisitDetail media, summary, recordingSeconds, parts). */
  seed: WorkSeed;
  /** The visit's "לאסוף לפני הביקור" item (offered as a part); null when none. */
  pickupItem: string | null;
  /**
   * The real app's Version 1 (Step 4): real photos (camera or file), no videos, no removal of a
   * stored photo, a written summary only (recordings are Version 2), and no parts card (no table
   * for parts yet; Version 2).
   */
  real?: boolean;
}) {
  const [draft, update] = useVisitDraft(visit, seed);
  const media = { capture: real, videos: !real, removable: !real };
  return (
    <>
      <MediaTiles visit={visit} phase="before" media={draft.media} onChange={update} {...media} />
      <MediaTiles visit={visit} phase="after" media={draft.media} onChange={update} {...media} />
      <SummaryEditor visit={visit} draft={draft} onChange={update} recording={!real} />
      {!real && <PartsEditor visit={visit} parts={draft.parts} pickupItem={pickupItem} onChange={update} />}
    </>
  );
}
