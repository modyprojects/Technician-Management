import Link from "next/link";
import type { ReactNode } from "react";
import { FIXTURE_SENTINEL } from "../../showcase/_fixtures";
import { VIEWPOINTS, type Viewpoint } from "../_data/roles";
import { demoHref } from "../_data/routes";

// Wraps every UI-demo page (D53): carries the fixture sentinel (the bundle check finds demo data
// by it) and a thin "נתוני בדיקה · הדגמה" strip above the screen. The strip takes its own row,
// so it never covers the screen; the screen below keeps the full remaining height (technician
// header and bottom navigation stay fixed) and scrolls inside it.
export function DemoPage({ viewpoint, children }: { viewpoint?: Viewpoint; children: ReactNode }) {
  const who = viewpoint ? ` · ${VIEWPOINTS[viewpoint].label}` : "";
  return (
    <div data-fixtures={FIXTURE_SENTINEL} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        role="note"
        aria-label="הדגמה עם נתוני בדיקה"
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          minHeight: 26,
          paddingBlock: 3,
          paddingInline: "max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-left, 0px))",
          background: "var(--warn-bg)",
          borderBottom: "1px solid var(--warn-bd)",
          color: "var(--warn-fg)",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {`🧪 נתוני בדיקה · הדגמה${who} · פעולות מדומות, שום דבר לא נשמר`}
        </span>
        {viewpoint && (
          <Link href={demoHref.landing()} className="lnk" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            החלפת תצוגה ›
          </Link>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}
