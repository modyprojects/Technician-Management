import Link from "next/link";
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianRef } from "@/features/reference/data/types";

// Small building blocks shared by the manager dashboards (Analytics*.tsx; docs/demo.html offDash(),
// L860-935). Presentational and server-safe.

/** Short table columns: centred and sized to their content (design-system.md "Tables", G-07). */
export const SHORT_COL = "col-center col-fit";

/** "21.10" (the demo's ddmm). */
export const ddmm = (date: IsoDate): string => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** Minutes as the demo's tables print them ("34 דק׳"; "—" when not measured). */
export const minutesLabel = (m: number | null): string => (m == null ? "—" : `${m} דק׳`);

/** Days a call has been open ("היום", "יום אחד", "9 ימים"). */
export const daysOpenLabel = (days: number): string => (days <= 0 ? "היום" : days === 1 ? "יום אחד" : `${days} ימים`);

/**
 * A technician's name with the colour dot. With `href` it is a real link to the technician
 * drill-down (the demo's data-act="techDetail" buttons, offered only with `dashTech`); without it,
 * plain text.
 */
export function TechName({
  technician,
  href,
  dot = true,
}: {
  technician: Pick<TechnicianRef, "name" | "color">;
  href?: string | null;
  dot?: boolean;
}) {
  const body = (
    <>
      {dot && <span className="dot" aria-hidden="true" style={{ background: technician.color }} />}
      {dot && " "}
      {technician.name}
    </>
  );
  if (!href) return dot ? <span>{body}</span> : <b>{body}</b>;
  return (
    <Link href={href} prefetch={false} className="lnk" aria-label={`${technician.name} · פירוט הטכנאי`}>
      {body}
      <span aria-hidden="true"> ›</span>
    </Link>
  );
}
