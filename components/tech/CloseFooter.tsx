"use client";

// Close screen footer (docs/demo.html techClose() foot, L597-600, and sendClose(), L1124-1130):
// the send button in the outcome's colour ("בחר תוצאה" / "שליחה · הקריאה טופלה" / "שליחה · המשך
// טיפול"), disabled until the form is complete, with the missing items under it. Sending runs
// useCommands().visits.close(ref, input) (after saving a summary edited since its last save);
// errors show here. After a successful close the footer links back to the technician's day.
import Link from "next/link";
import { useId } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { CloseVisitInput, VisitRef } from "@/features/visits/data/types";
import { closeHint, closeReady } from "./CloseRules";
import { useVisitDraft, withClose, type WorkSeed } from "./WorkDraft";

export function CloseFooter({
  visit,
  seed,
  approvalTextVersionId,
  homeHref,
}: {
  visit: VisitRef;
  seed: WorkSeed;
  /** Version of the approval text shown with the signature (D43). */
  approvalTextVersionId: string;
  /** The technician's day ("היום"). */
  homeHref: string;
}) {
  const { visits } = useCommands();
  const [draft, update] = useVisitDraft(visit, seed);
  const hintId = useId();
  const k = draft.close;

  if (k.submit.state === "sent") {
    return (
      <Link className="bigbtn" href={homeHref} style={{ background: "var(--ink)" }}>
        חזרה להיום ›
      </Link>
    );
  }

  const sending = k.submit.state === "sending";
  const ready = closeReady(draft);
  const hint = closeHint(draft);
  const label = sending
    ? "שולח…"
    : k.outcome === "cont"
      ? "שליחה · המשך טיפול"
      : k.outcome === "done"
        ? "שליחה · הקריאה טופלה"
        : "בחר תוצאה";

  async function send() {
    const outcome = k.outcome;
    if (!outcome || !closeReady(draft)) return;
    update((d) => withClose(d, { submit: { state: "sending" } }));
    const fail = (error: string) => update((d) => withClose(d, { submit: { state: "error", error } }));

    // The close carries no summary: a summary edited since its last save is saved first.
    if (draft.summary !== draft.savedSummary) {
      const text = draft.summary;
      const saved = await visits.saveSummary(visit, text);
      if (!saved.ok) return fail(saved.error);
      update((d) => ({ ...d, savedSummary: text }));
    }

    const input: CloseVisitInput =
      outcome === "done"
        ? { outcome, signerName: k.signer.trim(), signatureDataUrl: k.signature ?? "", approvalTextVersionId }
        : { outcome, reason: k.reason ?? "", nextNote: k.nextNote.trim() };
    const r = await visits.close(visit, input);
    if (!r.ok) return fail(r.error);
    update((d) => withClose(d, { submit: { state: "sent", outcome, simulated: r.simulated, message: r.message ?? "" } }));
  }

  return (
    <>
      <button
        type="button"
        className="bigbtn"
        style={{ background: k.outcome === "cont" ? "var(--s-cont)" : "var(--s-done)" }}
        disabled={!ready || sending}
        aria-busy={sending}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => void send()}
      >
        {label}
      </button>
      {k.submit.state === "error" ? (
        <div role="alert" style={{ textAlign: "center", marginTop: 6, color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
          {k.submit.error}
        </div>
      ) : (
        hint && (
          <div id={hintId} className="sub" aria-live="polite" style={{ textAlign: "center", marginTop: 6 }}>
            {hint}
          </div>
        )
      )}
    </>
  );
}
