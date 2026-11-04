import Form from "next/form";
import Link from "next/link";
import { MAX_QUERY_LENGTH } from "@/features/data-access/common";

// Search box of a server-searched list ("לקוחות": OF-05, the customer number is searchable;
// "מוצרים": PR-07, the SKU is matched normalized). A GET form: the text goes into the URL (?q=) and
// the server searches and pages (OF-04 semantics); a new search starts again at page 1.
// next/form navigates on the client without a full reload and works without JavaScript.
// Presentational: the caller passes the list's address, the query and the Hebrew labels.

export function ListSearch({
  action,
  query,
  clearHref,
  formLabel,
  inputLabel,
  placeholder,
}: {
  /** The list's address without a query string. */
  action: string;
  /** The current search text (from the URL). */
  query: string;
  /** The list without a search; null when nothing is searched. */
  clearHref: string | null;
  /** Accessible name of the search landmark ("חיפוש לקוחות"). */
  formLabel: string;
  /** Accessible name of the search box ("חיפוש לקוח"). */
  inputLabel: string;
  /** What can be searched ("חיפוש לפי שם, מספר לקוח, טלפון או עיר"). */
  placeholder: string;
}) {
  return (
    <Form
      action={action}
      prefetch={false}
      scroll={false}
      role="search"
      aria-label={formLabel}
      style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        // A new URL (back / forward, "ניקוי החיפוש") shows its own text.
        key={query}
        type="search"
        name="q"
        defaultValue={query}
        placeholder={placeholder}
        aria-label={inputLabel}
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
