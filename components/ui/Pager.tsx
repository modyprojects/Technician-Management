import Link from "next/link";

// Previous / next page links for a server-paged list (OF-04: server-side search and pagination),
// in the demo's visual language (.sub line, .lnk links). Renders nothing for a single page.
export function Pager({
  page,
  pageCount,
  prevHref,
  nextHref,
  label = "עמודי התוצאות",
}: {
  page: number;
  pageCount: number;
  /** Link to the previous page; null on the first page. */
  prevHref: string | null;
  /** Link to the next page; null on the last page. */
  nextHref: string | null;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label={label}
      className="sub"
      style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}
    >
      {prevHref ? (
        <Link className="lnk" href={prevHref} prefetch={false} scroll={false}>
          › הקודם
        </Link>
      ) : (
        <span aria-hidden="true" style={{ opacity: 0.4 }}>
          › הקודם
        </span>
      )}
      <span>
        עמוד <span className="num">{page}</span> מתוך <span className="num">{pageCount}</span>
      </span>
      {nextHref ? (
        <Link className="lnk" href={nextHref} prefetch={false} scroll={false}>
          הבא ‹
        </Link>
      ) : (
        <span aria-hidden="true" style={{ opacity: 0.4 }}>
          הבא ‹
        </span>
      )}
    </nav>
  );
}
