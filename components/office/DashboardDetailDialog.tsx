"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";

// The manager dashboard's details dialog (spec-final §6.9; reference .overlay / .modal): the
// records behind a metric. The page renders it from the URL (`detail`, `group`, `dpage`), so a
// direct load, paging and the back button all work; `closeHref` is the same view without them.
// A modal dialog (patterns of CallDrawer and VisitCorrectionDialog, copied, not shared): focus moves
// to the panel on mount (the page keys the dialog by key, group and page, so paging focuses it
// again), Tab and Shift+Tab stay inside, Escape, ✕ and a press that both starts and ends on the
// dimmed background close it (URL replaced, scroll kept), and focus returns to the element that
// opened it ([data-detail-key]). Without JavaScript, ✕ is a plain link.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const isPlainClick = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** The first visible element that opened this dialog (a tile, a bar row, a table link). */
function opener(returnKey: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-detail-key="${CSS.escape(returnKey)}"]`);
  for (const el of all) if (el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true") return el;
  return null;
}

export function DashboardDetailDialog({
  title,
  description,
  temporary,
  closeHref,
  returnKey,
  children,
}: {
  /** Metric label and scope ("לא בוצעו במועד · 21.10.2026"). */
  title: string;
  /** The registry definition (Hebrew). */
  description: string;
  /** The formula applies a TEMPORARY interpretation (open #20). */
  temporary: boolean;
  /** The dashboard URL without detail / group / dpage. */
  closeHref: string;
  /** data-detail-key of the opener ("today.missed", "prod.bySupplier|<key>"). */
  returnKey: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);
  const pressOnBackdrop = useRef(false);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descId = useId();

  function returnFocus() {
    opener(returnKey)?.focus({ preventScroll: true });
  }

  function close() {
    if (closedRef.current) return;
    closedRef.current = true;
    returnFocus();
    setClosing(true);
    router.replace(closeHref, { scroll: false });
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (closedRef.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const panel = panelRef.current;
    if (e.key !== "Tab" || !panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first || !last) {
      e.preventDefault();
      panel.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /** Focus that leaves the open dialog comes back to it. */
  const onFocusIn = useEffectEvent((e: FocusEvent) => {
    const panel = panelRef.current;
    if (closedRef.current || !panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
    panel.focus({ preventScroll: true });
  });

  /** Closed by a URL change (browser back, another link): focus goes back to the opener. */
  const onUnmount = useEffectEvent(() => {
    if (closedRef.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) returnFocus();
  });

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const keydown = (e: KeyboardEvent) => onKeyDown(e);
    const focusin = (e: FocusEvent) => onFocusIn(e);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      onUnmount();
    };
  }, []);

  if (closing) return null;

  return (
    <div
      className="ma-dialog-bg"
      onPointerDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const fromBackdrop = pressOnBackdrop.current && e.target === e.currentTarget;
        pressOnBackdrop.current = false;
        if (fromBackdrop) close();
      }}
    >
      <div ref={panelRef} className="ma-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1}>
        <div className="ma-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <Link
            className="xbtn"
            href={closeHref}
            replace
            scroll={false}
            prefetch={false}
            aria-label="סגירה"
            onClick={(e) => {
              if (!isPlainClick(e)) return;
              e.preventDefault();
              close();
            }}
          >
            <span aria-hidden="true">✕</span>
          </Link>
        </div>
        <p id={descId} className="ma-dialog-desc">
          {description}
          {temporary && <span className="ma-dialog-tmp">פרשנות זמנית (#20)</span>}
        </p>
        <div className="ma-dialog-body">{children}</div>
      </div>
    </div>
  );
}
