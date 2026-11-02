import type { ReactNode } from "react";

export function Chip({
  on = false,
  count,
  children,
}: {
  on?: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button type="button" className={on ? "chip on" : "chip"} aria-pressed={on}>
      {children}
      {count !== undefined && (
        <>
          {" "}
          <span style={{ opacity: 0.6 }} className="num">
            {count}
          </span>
        </>
      )}
    </button>
  );
}
