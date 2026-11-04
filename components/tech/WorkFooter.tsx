"use client";

// Work screen footer (docs/demo.html techWork() foot, L573-574): "סיום ביקור ›" and the readiness
// hint (workHint). The button is a real link to the close screen once the work is ready, and a
// disabled button until then.
import Link from "next/link";
import { useId } from "react";
import type { VisitRef } from "@/features/visits/data/types";
import { useVisitDraft, workHint, workReady, type WorkSeed } from "./WorkDraft";

export function WorkFooter({ visit, seed, closeHref }: { visit: VisitRef; seed: WorkSeed; closeHref: string }) {
  const [draft] = useVisitDraft(visit, seed);
  const hintId = useId();
  const ready = workReady(draft);
  return (
    <>
      {ready ? (
        <Link className="bigbtn" href={closeHref} style={{ background: "var(--ink)" }} aria-describedby={hintId}>
          סיום ביקור ›
        </Link>
      ) : (
        <button type="button" className="bigbtn" style={{ background: "var(--ink)" }} disabled aria-describedby={hintId}>
          סיום ביקור ›
        </button>
      )}
      <div id={hintId} className="sub" aria-live="polite" style={{ textAlign: "center", marginTop: 6 }}>
        {workHint(draft)}
      </div>
    </>
  );
}
