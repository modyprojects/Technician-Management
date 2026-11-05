"use client";

// Simulated-action feedback for the UI demo (D53). Nothing in the demo is saved or sent, so every
// action that would change data, call, navigate outside or send shows this toast instead.
// - Any element with data-sim="detail" (also in Server Components) shows the toast on click;
//   the click's default action is prevented. data-sim is only for navigation affordances (dial,
//   Waze) and for the two features that have no port yet (export OF-14, recording playback
//   OF-06; TODOs at their buttons). Data actions go through useCommands().
// - Client components call useSimulate()("detail").
// - Bottom-nav and sidebar buttons without a link (screens outside the demo) say so, under the
//   title "לא בהדגמה" (nothing was attempted, so "לא נשמר" would not fit).
// - The toast never takes clicks (styles/ui.css .toast, pointer-events: none) and, on technician
//   screens, sits above the footer and bottom navigation, so it never blocks the main buttons.
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SIMULATED_TITLE } from "./simulated-commands";

const NOT_IN_DEMO = "המסך הזה אינו חלק מההדגמה";
/** Title of the "not in the demo" toast: nothing was attempted, so nothing "was not saved". */
const NOT_IN_DEMO_TITLE = "לא בהדגמה";
const TOAST_MS = 4200; // as in the demo's toast()
/** Gap between the toast and the technician footer or bottom navigation. */
const TOAST_GAP_PX = 12;

type Simulate = (detail?: string) => void;

type Toast = { id: number; title: string; detail: string; bottom: number | null };

/**
 * Where the toast sits: above the technician footer (main buttons) and bottom navigation, so it
 * never covers them (WCAG 2.4.11); null keeps the stylesheet's position (office screens).
 */
function toastBottom(): number | null {
  let top = Infinity;
  for (const bar of document.querySelectorAll<HTMLElement>(".ph-foot, .ph-nav")) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0) top = Math.min(top, r.top);
  }
  return Number.isFinite(top) ? Math.max(0, window.innerHeight - top) + TOAST_GAP_PX : null;
}

const SimulateContext = createContext<Simulate>(() => {});

/** Returns simulate(detail?): shows "פעולה מדומה · לא נשמר" with an optional detail line. */
export function useSimulate(): Simulate {
  return use(SimulateContext);
}

export function DemoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);

  const simulate = useCallback<Simulate>((detail = "") => {
    seq.current += 1;
    const notInDemo = detail === NOT_IN_DEMO;
    setToast({
      id: seq.current,
      title: notInDemo ? NOT_IN_DEMO_TITLE : SIMULATED_TITLE,
      detail,
      bottom: toastBottom(),
    });
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
          <div key={toast.id} className="toast" style={toast.bottom === null ? undefined : { bottom: toast.bottom }}>
            {toast.title}
            {toast.detail && (
              <div style={{ fontWeight: 400, fontSize: 13, marginTop: 2, color: "var(--on-dark3)" }}>{toast.detail}</div>
            )}
          </div>
        )}
      </div>
    </SimulateContext>
  );
}
