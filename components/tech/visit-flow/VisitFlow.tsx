"use client";

// The technician's open visit, end to end on one page (D95 as corrected 22.11; TE-02, TE-13 to
// TE-23): the card with its action, the work screen and the close screen, and the "saved" state
// after sending. The steps switch on the device (the address bar follows as `?step=work|close` with
// history.pushState, no server round trip; the page stays the same route, so a refresh never
// remounts the flow). Version 1 is online only (D06): "הגעתי" and the closure are kept on the
// device first (IndexedDB, with the device time of the tap) and sent at once; when that fails the
// technician sees "אין חיבור, … הנתונים שמורים בטלפון", can go on working and closing, and sends
// everything later with "שלח שוב" (arrival, then media, then the closure; the same operation ids,
// so a resend or a double tap never duplicates). Nothing is sent on its own: no `online` event, no
// sending on app open, no timers. The device's data is deleted only after the server confirmed it.
// "יוצא · Waze" is online only (D71); the Waze tile appears only after it (D95 (e)). The status
// shown is the server's, moved on by what the device holds, with the "לא נשלח" marker beside it.
// No recorded times (D68); no video or recorded summary in this version (D95 (g)).
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { VisitContactTiles } from "@/components/tech/VisitLinks";
import { StatusPill, VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestDataBanner, TestPill } from "@/components/ui/TestBadge";
import { idbVisitFlowStore } from "@/features/visit-flow/idb";
import { deviceClock, effectiveStatus, visitQueueState, type FlowStatus, type NewQueueItem } from "@/features/visit-flow/queue";
import { sha256Hex } from "@/features/visit-flow/rules";
import { stepOf, type FlowStep } from "@/features/visit-flow/steps";
import { departVisit } from "@/lib/actions/visit-flow";
import { ArriveAction, DepartAction, type DepartOutcome } from "./CardActions";
import { CloseFlow, type CloseSubmission } from "./CloseFlow";
import { NotSentPill, SyncStatus } from "./SyncStatus";
import { useVisitQueue } from "./useVisitQueue";
import { WorkFlow } from "./WorkFlow";

export type { FlowStep };

export type VisitFlowProps = {
  userId: string;
  visitId: string;
  serverStatus: "new" | "go" | "work";
  fieldVersion: number;
  isTest: boolean;
  meta: string;
  title: string;
  homeHref: string;
  basePath: string;
  initialStep: FlowStep;
  address: string;
  customerPhone: string;
  rep: { name: string; phone: string | null };
  wazeHref: string | null;
  approvalText: string;
  reasons: readonly { id: string; label: string }[];
  /** The card's details (history, info, problem, pickup, source), rendered on the server. */
  details: ReactNode;
};

const hrefOf = (base: string, step: FlowStep): string => (step === "card" ? base : `${base}?step=${step}`);

export function VisitFlow(p: VisitFlowProps) {
  const queue = useVisitQueue(p.userId);
  const q = visitQueueState(queue.items, p.visitId, p.userId);
  const [departed, setDeparted] = useState<number | null>(null);
  const search = useSearchParams();
  const step = search ? stepOf(search.get("step")) : p.initialStep;
  const departOp = useRef<string | null>(null);

  const fieldVersion = Math.max(p.fieldVersion, departed ?? 0, queue.fieldVersions[p.visitId] ?? 0);
  const server: FlowStatus = departed && p.serverStatus === "new" ? "go" : p.serverStatus;
  const status = effectiveStatus(server, q, { arrived: p.visitId in queue.fieldVersions, closed: queue.closed[p.visitId] ?? null });
  const closedOnDevice = status === "done" || status === "cont";

  // In-flow moves never ask the server (they work offline); Next.js follows pushState.
  const setStep = (next: FlowStep) => {
    window.history.pushState(null, "", hrefOf(p.basePath, next));
    window.scrollTo(0, 0);
  };

  /** The header's back link inside the flow moves on the device too (also offline). */
  const backInFlow = (to: FlowStep) => (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest("a");
    if (!a || a.getAttribute("href") !== hrefOf(p.basePath, to) || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    setStep(to);
  };

  const syncPanel = <SyncStatus q={q} sending={queue.sending} lastOffline={queue.lastOffline} sentCount={queue.sentCount} storeError={queue.storeError} onSend={() => void queue.send()} />;

  const header = (backHref: string, backLabel: string, backAriaLabel: string) => (
    <VisitHeader
      backHref={backHref}
      backLabel={backLabel}
      backAriaLabel={backAriaLabel}
      meta={p.meta}
      title={p.title}
      trailing={
        <>
          {p.isTest && <TestPill />}
          <StatusPill status={status} />
          {q.pending > 0 && <NotSentPill />}
        </>
      }
    />
  );

  const depart = async (): Promise<DepartOutcome> => {
    departOp.current ??= crypto.randomUUID();
    const r = await departVisit({ visitId: p.visitId, operationId: departOp.current, expectedFieldVersion: fieldVersion, clock: deviceClock(), deviceSentAt: new Date().toISOString() });
    if (r.ok) {
      setDeparted(r.value.fieldVersion);
      departOp.current = null;
      return "ok";
    }
    return r.code === "retry" ? "offline" : "refused";
  };

  const arriving = useRef(false);
  const arrive = async () => {
    // A double tap stores one arrival only (one operation id).
    if (arriving.current || q.arrivePending) return;
    arriving.current = true;
    const clock = deviceClock();
    const ok = await queue.enqueue([
      { kind: "arrive", userId: p.userId, visitId: p.visitId, opId: crypto.randomUUID(), queuedAt: new Date().toISOString(), attempts: 0, error: null, expectedFieldVersion: fieldVersion, clock },
    ]);
    arriving.current = false;
    if (!ok) return;
    // The work screen opens at once; the send's answer (or "אין חיבור…") shows there.
    setStep("work");
    await queue.send();
  };

  const submitClose = async (s: CloseSubmission): Promise<string | null> => {
    let draft;
    try {
      draft = await idbVisitFlowStore.getDraft(p.visitId);
    } catch {
      return "לא ניתן לקרוא את הטיפול מהמכשיר. נסה שוב";
    }
    // Only this user's draft (a shared phone; the visit may have been reassigned): never another's.
    if (draft && draft.userId !== p.userId) draft = undefined;
    if (!draft || !draft.summary.trim() || !draft.photos.some((x) => x.phase === "after")) return "חסר: תמונה אחרי הטיפול או סיכום הטיפול. חזור למסך הטיפול";
    const base = { userId: p.userId, visitId: p.visitId, queuedAt: new Date().toISOString(), attempts: 0, error: null } as const;
    const photos = [...draft.photos.filter((x) => x.phase === "before"), ...draft.photos.filter((x) => x.phase === "after")];
    const items: NewQueueItem[] = photos.map((x) => ({
      ...base,
      kind: "media",
      opId: crypto.randomUUID(),
      ref: x.id,
      mediaKind: "photo",
      phase: x.phase,
      mime: x.mime,
      size: x.size,
      blob: x.blob,
      clock: { ...deviceClock(), reportedAt: x.capturedAt },
      mediaId: null,
    }));
    let signatureRef: string | null = null;
    let ack: string | null = null;
    if (s.outcome === "done") {
      const blob = await (await fetch(s.signature)).blob();
      const png = blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
      signatureRef = crypto.randomUUID();
      ack = await sha256Hex(p.approvalText);
      items.push({ ...base, kind: "media", opId: crypto.randomUUID(), ref: signatureRef, mediaKind: "signature", phase: null, mime: "image/png", size: png.size, blob: png, clock: deviceClock(), mediaId: null });
    }
    items.push({
      ...base,
      kind: "close",
      opId: crypto.randomUUID(),
      outcome: s.outcome,
      summary: draft.summary.trim(),
      signerName: s.outcome === "done" ? s.signer : null,
      ackTextSha256: ack,
      signatureRef,
      signatureMediaId: null,
      followupReasonId: s.outcome === "followup" ? s.reasonId : null,
      nextVisitNotes: s.outcome === "followup" ? s.nextNotes : null,
      expectedFieldVersion: q.arrivePending ? null : fieldVersion,
      clock: deviceClock(),
    });
    const ok = await queue.enqueue(items, p.visitId);
    if (!ok) return "לא ניתן לשמור בטלפון. נסה שוב";
    setStep("card");
    void queue.send();
    return null;
  };

  // The closure is on the device (or already sent): a read-only "saved" state until the page
  // re-reads the closed visit from the server.
  if (closedOnDevice) {
    const look = VISIT_STATUSES[status];
    return (
      <TechShell head={header(p.homeHref, "היום", "חזרה למסך היום")}>
        {p.isTest && <TestDataBanner />}
        <section className="card" style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10, borderColor: look.c }}>
          <h2 style={{ fontSize: 18, color: look.fg }}>הביקור נשמר · {status === "done" ? "✓ טופל" : "↻ המשך טיפול"}</h2>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            {q.pending > 0 ? "הסגירה שמורה בטלפון. אם אין חיבור, לחץ ׳שלח שוב׳ כשיחזור. אין צורך למלא שוב." : "נשלח לשרת."}
          </div>
          <Link href={p.homeHref} className="btn" style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
            חזרה להיום
          </Link>
        </section>
        {syncPanel}
      </TechShell>
    );
  }

  // Owner 22.11: one bottom button per stage; a visit in treatment opens straight on the work
  // screen (no intermediate card), which keeps the address, the customer's phone and WhatsApp.
  if (status === "work" && step !== "close") {
    const contact = (
      <section className="card" aria-label="פרטי קשר" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{p.address}</div>
        <VisitContactTiles address={p.address} customerPhone={p.customerPhone} rep={p.rep} />
      </section>
    );
    const head = header(p.homeHref, "היום", "חזרה למסך היום");
    return <WorkFlow head={head} visitId={p.visitId} userId={p.userId} isTest={p.isTest} syncPanel={syncPanel} contact={contact} onFinish={() => setStep("close")} />;
  }
  if (status === "work") {
    const head = <div style={{ display: "contents" }} onClickCapture={backInFlow("work")}>{header(hrefOf(p.basePath, "work"), "לטיפול", "חזרה למסך הטיפול")}</div>;
    return <CloseFlow head={head} approvalText={p.approvalText} reasons={p.reasons} isTest={p.isTest} syncPanel={syncPanel} onSubmit={submitClose} />;
  }

  let foot: ReactNode = null;
  if (status === "new") foot = <DepartAction wazeHref={p.wazeHref} onDepart={depart} />;
  else if (status === "go") foot = <ArriveAction onArrive={() => void arrive()} disabled={!queue.loaded} />;

  return (
    <TechShell head={header(p.homeHref, "היום", "חזרה למסך היום")} foot={foot}>
      {p.isTest && <TestDataBanner />}
      {syncPanel}
      {/* D95 (e): the Waze tile appears only after "יוצא"; before it the footer's "יוצא · Waze" leads. */}
      <VisitContactTiles address={p.address} customerPhone={p.customerPhone} rep={p.rep} hideWaze={status === "new"} />
      {p.details}
    </TechShell>
  );
}
