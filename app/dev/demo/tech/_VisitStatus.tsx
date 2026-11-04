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

type Action = "depart" | "arrive";

type Flow = {
  /** The status set on this screen, if any (otherwise the DTO's status applies). */
  statusOf: (ref: VisitRef) => VisitStatus | undefined;
  errorOf: (ref: VisitRef) => string | null;
  /** Runs the action from `current`; resolves true when the command succeeded. */
  run: (action: Action, ref: VisitRef, current: VisitStatus) => Promise<boolean>;
};

const FlowContext = createContext<Flow | null>(null);

function useFlow(): Flow {
  const flow = use(FlowContext);
  if (!flow) throw new Error("Wrap the technician screen in <VisitStatusProvider>.");
  return flow;
}

/** Which statuses each action may start from (the demo's flow). */
const FROM: Record<Action, readonly VisitStatus[]> = { depart: ["new"], arrive: ["new", "go"] };
const TO: Record<Action, VisitStatus> = { depart: "go", arrive: "work" };

/**
 * Holds the statuses the technician changed on this screen (by "req-n"); a visit without a change
 * shows the status its DTO carries. Wrap the whole screen (header, content and footer).
 */
export function VisitStatusProvider({ children }: { children: ReactNode }) {
  const { visits: commands } = useCommands();
  const [status, setStatus] = useState<Readonly<Record<string, VisitStatus>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({});
  // The latest statuses for the event handlers (status changes only through run()), and a
  // synchronous guard against a double tap before the pending state renders.
  const latest = useRef(status);
  const running = useRef(new Set<string>());

  const run = useCallback(
    async (action: Action, ref: VisitRef, current: VisitStatus): Promise<boolean> => {
      const key = keyOf(ref);
      const before = latest.current[key] ?? current;
      if (!FROM[action].includes(before) || running.current.has(key)) return false;
      const apply = (next: VisitStatus) => {
        latest.current = { ...latest.current, [key]: next };
        setStatus(latest.current);
      };
      running.current.add(key);
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
      }
      return ok;
    },
    [commands],
  );

  const flow = useMemo<Flow>(
    () => ({
      statusOf: (ref) => status[keyOf(ref)],
      errorOf: (ref) => errors[keyOf(ref)] ?? null,
      run,
    }),
    [status, errors, run],
  );

  return <FlowContext value={flow}>{children}</FlowContext>;
}

/** The visit's live status, the last error and the actions. */
export function useVisitStatus(ref: VisitRef, fallback: VisitStatus) {
  const flow = useFlow();
  const status = flow.statusOf(ref) ?? fallback;
  return {
    status,
    error: flow.errorOf(ref),
    /** "יוצא · Waze" on a scheduled visit ("בדרך"). */
    depart: () => flow.run("depart", ref, status),
    /** "הגעתי" on a scheduled or en-route visit ("בטיפול"). */
    arrive: () => flow.run("arrive", ref, status),
  };
}

/** Status pill that follows the live status. */
export function LiveStatusPill({ visit, status }: { visit: VisitRef; status: VisitStatus }) {
  const live = useVisitStatus(visit, status);
  return <StatusPill status={live.status} />;
}
