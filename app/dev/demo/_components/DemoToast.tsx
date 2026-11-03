"use client";

// Simulated-action feedback for the UI demo (D53). Nothing in the demo is saved or sent, so every
// action that would change data, call, navigate outside or send shows this toast instead.
// - Any element with data-sim="detail" (also in Server Components) shows the toast on click;
//   the click's default action is prevented.
// - Client components call useSimulate()("detail").
// - Bottom-nav and sidebar buttons without a link (screens outside the demo) say so.
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export const SIMULATED_TITLE = "פעולה מדומה · לא נשמר";
const NOT_IN_DEMO = "המסך הזה אינו חלק מההדגמה";
const TOAST_MS = 4200; // as in the demo's toast()

type Simulate = (detail?: string) => void;

const SimulateContext = createContext<Simulate>(() => {});

/** Returns simulate(detail?): shows "פעולה מדומה · לא נשמר" with an optional detail line. */
export function useSimulate(): Simulate {
  return use(SimulateContext);
}

export function DemoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; detail: string } | null>(null);
  const seq = useRef(0);

  const simulate = useCallback<Simulate>((detail = "") => {
    seq.current += 1;
    setToast({ id: seq.current, detail });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const sim = event.target.closest<HTMLElement>("[data-sim]");
      if (sim) {
        if (sim.matches(":disabled, [aria-disabled='true']")) return;
        event.preventDefault();
        simulate(sim.dataset.sim ?? "");
        return;
      }
      if (event.target.closest(".ph-nav button, .side .nav button")) simulate(NOT_IN_DEMO);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [simulate]);

  return (
    <SimulateContext value={simulate}>
      {children}
      <div role="status">
        {toast && (
          <div key={toast.id} className="toast">
            {SIMULATED_TITLE}
            {toast.detail && (
              <div style={{ fontWeight: 400, fontSize: 13, marginTop: 2, color: "var(--on-dark3)" }}>{toast.detail}</div>
            )}
          </div>
        )}
      </div>
    </SimulateContext>
  );
}
