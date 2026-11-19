import Link from "next/link";
import type { CSSProperties } from "react";
import type { TechCalView } from "./types";

// "יומי / שבועי" (D83: no monthly view); the look of the demo's ".seg button" on links.
const LABELS: Record<TechCalView, string> = { day: "יומי", week: "שבועי" };
const SEG: CSSProperties = { flex: 1, border: 0, background: "transparent", padding: 7, borderRadius: 8, fontWeight: 700, color: "var(--muted)", fontSize: 14, textAlign: "center", textDecoration: "none" };
const ON: CSSProperties = { ...SEG, background: "var(--card)", color: "var(--ink)" };

export function TechCalSwitch({ view, hrefOf }: { view: TechCalView; hrefOf: (v: TechCalView) => string }) {
  return (
    <div role="group" className="seg" aria-label="תצוגת היומן" style={{ flex: "none" }}>
      {(["day", "week"] as const).map((v) => (
        <Link key={v} href={hrefOf(v)} aria-current={v === view ? "page" : undefined} style={v === view ? ON : SEG}>
          {LABELS[v]}
        </Link>
      ))}
    </div>
  );
}
