import Link from "next/link";
import { Fragment } from "react";

/** One screen of the row: a real link. */
export type RelatedScreenLink = { key: string; label: string; href: string };

/**
 * "מסכים נוספים" (D57 (1)-(2)): one unobtrusive row of text links to the screens a role is offered
 * that are not in its sidebar (for the Manager and the Creator: customers, back from field, review
 * items, products), on the "קריאות" screen. No counts anywhere (TEMPORARY, open #26 (b)): the
 * dashboard and this row carry no follow-up or review-item counters. Renders nothing for an empty
 * list. Display only (G-04): each linked page checks what it offers itself.
 */
export function RelatedScreens({ links }: { links: readonly RelatedScreenLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="מסכים נוספים" className="sub ma-related">
      <span className="ma-related-label">מסכים נוספים:</span>
      {links.map((link, i) => (
        <Fragment key={link.key}>
          {i > 0 && (
            <span className="ma-related-sep" aria-hidden="true">
              ·
            </span>
          )}
          <Link className="lnk" href={link.href}>
            {link.label}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
