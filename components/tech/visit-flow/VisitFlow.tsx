"use client";

// The technician's open visit, end to end on one page (D95; TE-02, TE-13 to TE-23): the card with
// its action, the work screen and the close screen, and the "saved" state after sending. The steps
// switch on the device (the address bar follows with history.pushState, no server round trip), so
// after "הגעתי" the technician can work and close the visit with no connection: "הגעתי" and the
// closure (with its photos and signature) go to the device work queue and are sent when there is a
// connection (features/visit-flow/queue.ts). "יוצא · Waze" is online only (D71). The status shown
// is the server's, moved on by what the device still holds (effectiveStatus), with the sync state
// beside it ("ממתין לסנכרון", D46). The Waze tile appears only after "יוצא" (D95 (e)). No recorded
// times (D68); no video or recorded summary in this version (D95 (g)).
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TechShell } from "@/components/tech/TechShell";
import { VisitHeader } from "@/components/tech/VisitHeader";
import { VisitContactTiles } from "@/components/tech/VisitLinks";
import { StatusPill, VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestDataBanner, TestPill } from "@/components/ui/TestBadge";
import { idbVisitFlowStore } from "@/features/visit-flow/idb";
import { deviceClock, effectiveStatus, visitQueueState, type FlowStatus, type NewQueueItem } from "@/features/visit-flow/queue";
import { sha256Hex } from "@/features/visit-flow/rules";
import { departVisit } from "@/lib/actions/visit-flow";
import { ArriveAction, ContinueWorkAction, DepartAction, type DepartOutcome } from "./CardActions";
import { CloseFlow, type CloseSubmission } from "./CloseFlow";
import { SyncStatus } from "./SyncStatus";
import { useVisitQueue } from "./useVisitQueue";
import { WorkFlow } from "./WorkFlow";

export type FlowStep = "card" | "work" | "close";

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

const STEP_PATH: Record<FlowStep, string> = { card: "", work: "/work", close: "/close" };

function stepOfPath(path: string, base: string): FlowStep {
  if (path === `${base}/work`) return "work";
  if (path === `${base}/close`) return "close";
  return "card";
}

export function VisitFlow(p: VisitFlowProps) {
  const queue = useVisitQueue(p.userId);
  const q = visitQueueState(queue.items, p.visitId, p.userId);
  const [departed, setDeparted] = useState<number | null>(null);
  const [step, setStepState] = useState<FlowStep>(p.initialStep);
  const departOp = useRef<string | null>(null);

  const fieldVersion = Math.max(p.fieldVersion, departed ?? 0, queue.fieldVersions[p.visitId] ?? 0);
  const server: FlowStatus = departed && p.serverStatus === "new" ? "go" : p.serverStatus;
  const status = effectiveStatus(server, q);
  const closedOnDevice = status === "done" || status === "cont";

  const setStep = (next: FlowStep) => {
    setStepState(next);
    const url = `${p.basePath}${STEP_PATH[next]}`;
    if (window.location.pathname !== url) window.history.pushState(null, "", url);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => setStepState(stepOfPath(window.location.pathname, p.basePath));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [p.basePath]);

  const syncPanel = <SyncStatus q={q} syncing={queue.syncing} online={queue.online} sentCount={queue.sentCount} storeError={queue.storeError} onRetry={() => void queue.sync()} />;

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

  const arrive = async () => {
    const ok = await queue.enqueue([
      { kind: "arrive", userId: p.userId, visitId: p.visitId, opId: crypto.randomUUID(), queuedAt: new Date().toISOString(), attempts: 0, error: null, expectedFieldVersion: fieldVersion, clock: deviceClock() },
    ]);
    if (ok) setStep("work");
  };

  const submitClose = async (s: CloseSubmission): Promise<string | null> => {
    let draft;
    try {
      draft = await idbVisitFlowStore.getDraft(p.visitId);
    } catch {
      return "לא ניתן לקרוא את הטיפול מהמכשיר. נסה שוב";
    }
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
    if (!ok) return "לא ניתן לשמור במכשיר. נסה שוב";
    setStep("card");
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
            {q.pending > 0 ? "הסגירה שמורה במכשיר ותישלח לשרת כשיש חיבור. אין צורך לחזור על הפעולה." : "נשלח לשרת."}
          </div>
          <Link href={p.homeHref} className="btn" style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
            חזרה להיום
          </Link>
        </section>
        {syncPanel}
      </TechShell>
    );
  }

  if (step === "work" && status === "work") {
    return <WorkFlow head={header(p.basePath, "פרטי קריאה", "חזרה לכרטיס הביקור")} visitId={p.visitId} userId={p.userId} isTest={p.isTest} syncPanel={syncPanel} onFinish={() => setStep("close")} />;
  }
  if (step === "close" && status === "work") {
    return <CloseFlow head={header(`${p.basePath}/work`, "לטיפול", "חזרה למסך הטיפול")} approvalText={p.approvalText} reasons={p.reasons} isTest={p.isTest} syncPanel={syncPanel} onSubmit={submitClose} />;
  }

  let foot: ReactNode = null;
  if (status === "new") foot = <DepartAction wazeHref={p.wazeHref} onDepart={depart} />;
  else if (status === "go") foot = <ArriveAction onArrive={() => void arrive()} disabled={!queue.loaded} />;
  else if (status === "work") foot = <ContinueWorkAction onContinue={() => setStep("work")} />;

  return (
    <TechShell head={header(p.homeHref, "היום", "חזרה למסך היום")} foot={foot}>
      {p.isTest && <TestDataBanner />}
      {syncPanel}
      {/* D95 (e): the Waze tile appears only after "יוצא"; before it the footer's "יוצא · Waze" leads. */}
      <VisitContactTiles address={p.address} customerPhone={p.customerPhone} rep={p.rep} waze={status === "new" ? <span hidden /> : undefined} />
      {p.details}
    </TechShell>
  );
}
