// Navigation affordances that leave the app (phone call, WhatsApp, Waze) on the demo's technician
// screens. In production they are real links: `tel:` and WhatsApp to the customer and to the
// handling rep's phone from her profile (TE-07), and a Waze deep link to the address or the
// pickup place (TE-02, TE-03). The UI demo opens nothing: each is a button with data-sim, so the
// demo toast says what would open (navigation only, never a data action; DemoToast.tsx).
// No hooks: usable from Server and Client Components.
import type { CSSProperties, ReactNode } from "react";

const LINK_LOOK: CSSProperties = {
  border: 0,
  background: "none",
  fontSize: 12,
  color: "var(--accent)",
  fontWeight: 700,
  whiteSpace: "nowrap",
  padding: "4px 0",
};

/** "Waze ›" to a pickup place (demo "wazePlace", L1114). */
export function PlaceWazeButton({ place, address }: { place: string; address: string | null }) {
  return (
    <button
      type="button"
      style={LINK_LOOK}
      aria-label={`Waze · ניווט אל ${place}`}
      data-sim={`ניווט ב-Waze אל ${place}${address ? ` · ${address}` : ""} · לא נפתח בהדגמה`}
    >
      Waze <span aria-hidden="true">›</span>
    </button>
  );
}

/** One of the visit card's action tiles (.act) that only navigates: dial, WhatsApp, Waze. */
export function NavTile({
  icon,
  label,
  ariaLabel,
  sim,
  primary = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  /** Accessible name; contains `label`. */
  ariaLabel: string;
  /** What would open (the demo toast's detail line). */
  sim: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="act"
      aria-label={ariaLabel}
      data-sim={sim}
      disabled={disabled}
      style={{
        ...(primary ? { background: "var(--accent)", color: "var(--on-dark)", borderColor: "var(--accent)" } : null),
        ...(disabled ? { opacity: 0.45 } : null),
      }}
    >
      {icon}
      {label}
    </button>
  );
}
