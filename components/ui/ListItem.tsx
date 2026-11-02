import type { ReactNode } from "react";

// Schedule row (.li): time column, title and sub-line, trailing element.
export function ListItem({
  time,
  title,
  sub,
  trailing,
}: {
  time: string;
  title: string;
  sub: string;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" className="li">
      <span className="t num">{time}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        <div className="sub">{sub}</div>
      </span>
      {trailing}
    </button>
  );
}
