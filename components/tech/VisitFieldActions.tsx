"use client";

// The real departure and arrival controls of the technician screens (Step 4, Version 1; TE-02,
// TE-13): "יוצא · Waze" (a real Waze link that opens at once, while the departure is recorded on
// the server under the technician's session) and "הגעתי · התחלת טיפול". Each runs its server
// action once (the button is locked while it runs; a lost answer is retried with the same operation
// id, a replay), then reads the server again (router.refresh / the work screen), so every count,
// status and list comes from the database (QA T-02, T-08). An error shows inline; nothing is claimed
// before the server answered (G-06).
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PinIcon } from "@/components/ui/Icons";
import { visitCommandsOfActions, type FieldActions, type FieldVisit } from "@/features/visits/data/field-actions";
import { PHOTO_MAX_BYTES } from "@/features/visits/data/field";

type Props = {
  actions: Pick<FieldActions, "departVisit" | "arriveVisit">;
  visit: Pick<FieldVisit, "visitId" | "fieldVersion" | "isTest">;
};

const unused = async () => ({ ok: false as const, simulated: false, error: "" });

function useField({ actions, visit }: Props) {
  return useMemo(
    () => visitCommandsOfActions({ ...actions, addVisitPhoto: unused, closeVisit: unused }, { ...visit, reasons: [] }, PHOTO_MAX_BYTES),
    [actions, visit],
  );
}

/** "יוצא · Waze": opens Waze (the link) and records the departure. */
export function DepartLink({ wazeHref, address, compact = false, ...props }: Props & { wazeHref: string | null; address: string; compact?: boolean }) {
  const commands = useField(props);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function depart() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await commands.depart({ req: "", n: 0 });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }
  const style = compact ? { height: 44, fontSize: 15, background: "var(--accent)" } : { background: "var(--accent)" };
  return (
    <>
      {wazeHref ? (
        <a
          href={wazeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="bigbtn"
          aria-busy={busy}
          aria-label={`יוצא · Waze · ניווט אל ${address}`}
          style={style}
          onClick={() => void depart()}
        >
          <PinIcon /> יוצא · Waze
        </a>
      ) : (
        <button type="button" className="bigbtn" disabled={busy} aria-busy={busy} style={style} onClick={() => void depart()}>
          <PinIcon /> יוצא
        </button>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 6, color: "var(--danger)", fontSize: 13, fontWeight: 700, textAlign: "center", gridColumn: "1 / -1" }}>
          {error}
        </div>
      )}
    </>
  );
}

/** "הגעתי · התחלת טיפול": records the arrival, then opens the work screen. */
export function ArriveButton({ workHref, ...props }: Props & { workHref: string }) {
  const commands = useField(props);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function arrive() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await commands.arrive({ req: "", n: 0 });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(workHref);
    router.refresh();
  }
  return (
    <>
      <button type="button" className="bigbtn" style={{ background: "var(--s-work)" }} disabled={busy} aria-busy={busy} onClick={() => void arrive()}>
        {busy ? "שומר…" : "הגעתי · התחלת טיפול"}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 6, color: "var(--danger)", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
          {error}
        </div>
      )}
    </>
  );
}
