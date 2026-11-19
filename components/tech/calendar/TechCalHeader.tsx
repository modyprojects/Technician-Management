import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Header of the technician calendar (demo techCalendar() head L606-608): title and "‹ label ›".
// No bell (D83). Daily: arrows over today..today+6. Weekly: the current and the next week only. At
// the edge the arrow is a dimmed, disabled span: no past days or weeks (D83).
const ARROW: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 32, minHeight: 32 };

function Arrow({ href, glyph, name }: { href: string | null; glyph: string; name: string }) {
  if (!href) {
    return (
      <span className="ph-back" role="img" aria-label={`${name} (לא זמין)`} style={{ ...ARROW, opacity: 0.35 }}>
        <span aria-hidden="true">{glyph}</span>
      </span>
    );
  }
  return (
    <Link className="ph-back" href={href} aria-label={name} style={ARROW}>
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}

export type TechCalArrows = { prevHref: string | null; nextHref: string | null; prevName?: string; nextName?: string };

export function TechCalHeader({ label, arrows }: { label: ReactNode; arrows: TechCalArrows }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <h1 style={{ fontSize: 22 }}>היומן שלי</h1>
      <span style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--on-dark3)" }}>
        <Arrow href={arrows.prevHref} glyph="‹" name={arrows.prevName ?? "היום הקודם"} />
        <span className="num" aria-live="polite" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
          {label}
        </span>
        <Arrow href={arrows.nextHref} glyph="›" name={arrows.nextName ?? "היום הבא"} />
      </span>
    </div>
  );
}
