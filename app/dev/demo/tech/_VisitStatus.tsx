"use client";

// Live visit status for the technician screens (docs/demo.html "waze" and "arrived" actions,
// L1113 and L1115): "יוצא · Waze" turns "שובצה" into "בדרך" (TE-02) and "הגעתי" turns "שובצה" or
// "בדרך" into "בטיפול" (TE-13). The actions go through the data-access layer
// (useCommands().visits.depart / arrive); the screen shows the new status at once (optimistic)
// and goes back to the previous status, with the error, when the command fails.
// In the UI demo the commands are simulated (D53): the provider's toast says
// "פעולה מדומה · לא נשמר", nothing is saved, and a reload shows the fixture status again.
// The departure and arrival times are recorded by the server and never shown to the technician
// (TE-25 PENDING).
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { useCommands } from "@/features/data-access/commands-context";
import type { VisitRef, VisitStatus } from "@/features/visits/data/types";

const keyOf = (ref: VisitRef): string => `${ref.req}-${ref.n}`;

type Flow = {
  statusOf: (ref: VisitRef) => VisitStatus | undefined;
  pendingOf: (ref: VisitRef) => boolean;
  errorOf: (ref: VisitRef) => string | null;
  /** "יוצא · Waze" on a scheduled visit. Resolves true when the command succeeded. */
  depart: (ref: VisitRef) => Promise<boolean>;
  /** "הגעתי" on a scheduled or en-route visit. Resolves true when the command succeeded. */
  arrive: (ref: VisitRef) => Promise<boolean>;
};

const FlowContext = createContext<Flow | null>(null);

function useFlow(): Flow {
  const flow = use(FlowContext);
  if (!flow) throw new Error("Wrap the technician screen in <VisitStatusProvider>.");
  return flow;
}

/** Which statuses each action may start from (the demo's flow). */
const FROM: Record<"depart" | "arrive", readonly VisitStatus[]> = { depart: ["new"], arrive: ["new", "go"] };
const TO: Record<"depart" | "arrive", VisitStatus> = { depart: "go", arrive: "work" };

export function VisitStatusProvider({
  visits,
  children,
}: {
  /** The visits on screen with their status from the data-access layer. */
  visits: readonly { ref: VisitRef; status: VisitStatus }[];
  children: ReactNode;
}) {
  const { visits: commands } = useCommands();
  const [status, setStatus] = useState<Readonly<Record<string, VisitStatus>>>(() =>
    Object.fromEntries(visits.map((x) => [keyOf(x.ref), x.status])),
  );
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({});
  // The latest statuses for the event handlers (status changes only through run()), and a
  // synchronous guard against a double tap before the pending state renders.
  const latest = useRef(status);
  const running = useRef(new Set<string>());

  const run = useCallback(
    async (action: "depart" | "arrive", ref: VisitRef): Promise<boolean> => {
      const key = keyOf(ref);
      const before = latest.current[key];
      if (!before || !FROM[action].includes(before) || running.current.has(key)) return false;
      const apply = (next: VisitStatus) => {
        latest.current = { ...latest.current, [key]: next };
        setStatus(latest.current);
      };
      running.current.add(key);
      setPending((p) => new Set(p).add(key));
      setErrors((e) => ({ ...e, [key]: null }));
      apply(TO[action]);
      let ok = false;
      try {
        const result = action === "depart" ? await commands.depart(ref) : await commands.arrive(ref);
        ok = result.ok;
        if (!result.ok) {
          apply(before);
          setErrors((e) => ({ ...e, [key]: result.error }));
        }
      } catch {
        apply(before);
        setErrors((e) => ({ ...e, [key]: "הפעולה לא בוצעה. נסה שוב." }));
      } finally {
        running.current.delete(key);
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
      return ok;
    },
    [commands],
  );

  const flow = useMemo<Flow>(
    () => ({
      statusOf: (ref) => status[keyOf(ref)],
      pendingOf: (ref) => pending.has(keyOf(ref)),
      errorOf: (ref) => errors[keyOf(ref)] ?? null,
      depart: (ref) => run("depart", ref),
      arrive: (ref) => run("arrive", ref),
    }),
    [status, pending, errors, run],
  );

  return <FlowContext value={flow}>{children}</FlowContext>;
}

/** The visit's live status, pending flag, last error and actions. */
export function useVisitStatus(ref: VisitRef, fallback: VisitStatus) {
  const flow = useFlow();
  return {
    status: flow.statusOf(ref) ?? fallback,
    pending: flow.pendingOf(ref),
    error: flow.errorOf(ref),
    depart: () => flow.depart(ref),
    arrive: () => flow.arrive(ref),
  };
}

/** Status pill that follows the live status. */
export function LiveStatusPill({ visit, status }: { visit: VisitRef; status: VisitStatus }) {
  const live = useVisitStatus(visit, status);
  return <StatusPill status={live.status} />;
}
