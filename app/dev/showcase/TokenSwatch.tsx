"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

// Shows a token swatch with the value the browser actually computed for it.
export function TokenSwatch({ name }: { name: string }) {
  const value = useSyncExternalStore(
    noSubscription,
    () => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    () => "",
  );
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `var(${name})`,
          border: "1px solid var(--line)",
          flex: "none",
        }}
      />
      <span style={{ minWidth: 0 }}>
        <b dir="ltr" style={{ display: "block", fontSize: 13 }}>
          {name}
        </b>
        <span className="sub num" dir="ltr">
          {value}
        </span>
      </span>
    </div>
  );
}
