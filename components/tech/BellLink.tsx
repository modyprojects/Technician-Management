import Link from "next/link";
import type { CSSProperties } from "react";
import { BellIcon } from "@/components/ui/Icons";

// The technician's bell (docs/demo.html techHome() and techCalendar() heads; TE-28): a round link
// to the notifications with the unread count in a red badge. Shared by the home header and the
// calendar header. Navigation, so a link.

const BELL_STYLE: CSSProperties = {
  position: "relative",
  border: 0,
  background: "var(--ink2)",
  color: "var(--on-dark)",
  width: 36,
  height: 36,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
};

const BADGE_STYLE: CSSProperties = {
  position: "absolute",
  top: -3,
  left: -3,
  background: "var(--danger)",
  color: "var(--on-dark)",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  minWidth: 18,
  height: 18,
  padding: "0 4px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function BellLink({ href, unread, style }: { href: string; unread: number; style?: CSSProperties }) {
  return (
    <Link href={href} aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"} style={style ? { ...BELL_STYLE, ...style } : BELL_STYLE}>
      <BellIcon />
      {unread > 0 && (
        <span className="num" style={BADGE_STYLE}>
          {unread}
        </span>
      )}
    </Link>
  );
}
