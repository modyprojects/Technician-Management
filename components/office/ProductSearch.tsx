import Form from "next/form";
import Link from "next/link";
import { MAX_QUERY_LENGTH } from "@/features/data-access/common";

// Search box of the "מוצרים" list (PR-06; PR-07: the SKU is matched normalized). A GET form:
// the text goes into the URL (?q=) and the server searches and pages (OF-04 semantics); a new
// search starts again at page 1. next/form navigates on the client without a full reload and
// works without JavaScript. Presentational: the caller passes the list's address and the query.

export function ProductSearch({
  action,
  query,
  clearHref,
}: {
  /** The list's address without a query string. */
  action: string;
  /** The current search text (from the URL). */
  query: string;
  /** The list without a search; null when nothing is searched. */
  clearHref: string | null;
}) {
  return (
    <Form
      action={action}
      prefetch={false}
      scroll={false}
      role="search"
      aria-label="חיפוש מוצרים"
      style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        // A new URL (back / forward, "ניקוי החיפוש") shows its own text.
        key={query}
        type="search"
        name="q"
        defaultValue={query}
        placeholder="חיפוש לפי מק״ט, שם, מותג או ספק"
        aria-label="חיפוש מוצר"
        maxLength={MAX_QUERY_LENGTH}
        enterKeyHint="search"
        autoComplete="off"
        style={{ flex: 1, minWidth: 200, padding: "10px 14px" }}
      />
      <button type="submit" className="btn pri">
        חיפוש
      </button>
      {clearHref && (
        <Link className="lnk" href={clearHref} prefetch={false} scroll={false} style={{ display: "inline-block", paddingBlock: 4 }}>
          ניקוי החיפוש
        </Link>
      )}
    </Form>
  );
}
