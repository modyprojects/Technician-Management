"use client";

// The close screen's header link (docs/demo.html techClose() backBtn, L581): "› חזרה לטיפול"
// while the form is open. After a successful close the work screen is no longer the way back
// (the visit cannot be closed twice), so the link goes to the technician's day instead.
import Link from "next/link";
import type { VisitRef } from "@/features/visits/data/types";
import { useVisitDraft, type WorkSeed } from "./WorkDraft";

export function CloseBackLink({
  visit,
  seed,
  workHref,
  homeHref,
}: {
  visit: VisitRef;
  seed: WorkSeed;
  workHref: string;
  /** The technician's day ("היום"). */
  homeHref: string;
}) {
  const [draft] = useVisitDraft(visit, seed);
  const sent = draft.close.submit.state === "sent";
  return (
    <Link className="ph-back" href={sent ? homeHref : workHref}>
      <span aria-hidden="true">› </span>
      {sent ? "חזרה להיום" : "חזרה לטיפול"}
    </Link>
  );
}
