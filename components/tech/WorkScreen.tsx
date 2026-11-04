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
}: {
  visit: VisitRef;
  /** The visit's saved work (VisitDetail media, summary, recordingSeconds, parts). */
  seed: WorkSeed;
  /** The visit's "לאסוף לפני הביקור" item (offered as a part); null when none. */
  pickupItem: string | null;
}) {
  const [draft, update] = useVisitDraft(visit, seed);
  return (
    <>
      <MediaTiles visit={visit} phase="before" media={draft.media} onChange={update} />
      <MediaTiles visit={visit} phase="after" media={draft.media} onChange={update} />
      <SummaryEditor visit={visit} draft={draft} onChange={update} />
      <PartsEditor visit={visit} parts={draft.parts} pickupItem={pickupItem} onChange={update} />
    </>
  );
}
