import type { CSSProperties, ReactNode } from "react";

// Large action button (.bigbtn). The demo sets its colour inline per action.
export function BigButton({
  color,
  disabled = false,
  compact = false,
  children,
}: {
  color: string;
  disabled?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const style: CSSProperties = { background: color };
  if (compact) {
    // Compact variant used on the next-visit card (demo: height 44px, 15px).
    style.height = 44;
    style.fontSize = 15;
  }
  return (
    <button type="button" className="bigbtn" style={style} disabled={disabled}>
      {children}
    </button>
  );
}

// Action tile (.act) used in the technician call card grid.
export function ActionTile({
  icon,
  label,
  primary = false,
}: {
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  const style: CSSProperties | undefined = primary
    ? { background: "var(--accent)", color: "var(--on-dark)", borderColor: "var(--accent)" }
    : undefined;
  return (
    <button type="button" className="act" style={style}>
      {icon}
      {label}
    </button>
  );
}
