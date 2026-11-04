import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { TechDayVisit } from "@/features/visits/data/types";

// "הושלמו היום" (docs/demo.html techDoneList() L657-662; TE-26 CHANGE: same look, read-only, D14):
// "› חזרה", the title and "N ביקורים · צפייה בלבד" in the header; a row per closed visit (time,
// customer, "city · product", status pill) opening its read-only view; "עוד לא הושלמו ביקורים
// היום" when none. Every row is a link (navigation); nothing on this screen changes data.
// Additions: the 🧪 badge on test calls (SIM-15), the visit's device sync pill when the device
// still holds work of it (TE-23, TE-24) and, for a long day, the pager below the list (Page<T>,
// bounded to 100 per page).
// Presentational: TechDayVisit DTOs plus links.

/** "ביקור אחד" / "4 ביקורים". */
const countLabel = (n: number): string => (n === 1 ? "ביקור אחד" : `${n} ביקורים`);

export function DoneListHeader({ total, backHref }: { total: number; backHref: string }) {
  return (
    <>
      <div>
        <Link className="ph-back" href={backHref} aria-label="חזרה למסך היום">
          <span aria-hidden="true">› </span>
          חזרה
        </Link>
      </div>
      <h1 style={{ fontSize: 22, marginTop: 4 }}>הושלמו היום</h1>
      <div className="sub num" style={{ color: "var(--on-dark2)" }}>
        {countLabel(total)} · צפייה בלבד
      </div>
    </>
  );
}

export type DoneListEntry = {
  visit: TechDayVisit;
  /** The read-only view of the closed visit. */
  href: string;
  /** The visit's sync pill on the device (TE-23); omitted when the device holds nothing about it. */
  sync?: ReactNode;
};

export function DoneList({ entries, pager }: { entries: readonly DoneListEntry[]; pager?: ReactNode }) {
  if (!entries.length) return <div className="empty">עוד לא הושלמו ביקורים היום</div>;
  return (
    <>
      <section className="card" aria-label="ביקורים שהושלמו היום" style={{ overflow: "hidden", flex: "none" }}>
        {entries.map(({ visit: v, href, sync }) => (
          <Link key={`${v.req}-${v.n}`} href={href} className="li">
            <span className="t num">{v.start}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{v.customerName}</b>
              {v.isTest && (
                <>
                  {" "}
                  <TestBadge />
                </>
              )}
              <div className="sub">
                {v.city} · {v.productName}
              </div>
            </span>
            {sync ? (
              <span className="sy-pills">
                <StatusPill status={v.status} />
                {sync}
              </span>
            ) : (
              <StatusPill status={v.status} />
            )}
          </Link>
        ))}
      </section>
      {pager}
    </>
  );
}
