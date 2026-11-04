"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge, VisitSourceLine } from "@/components/ui/TestBadge";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import type { CalendarVisitDetail } from "@/features/calendar/data/types";
import { calVisitKey } from "./CalendarParts";

// The office calendar's visit drawer (docs/demo.html drawerHtml() L803-815, look .drawer-bg /
// .drawer): request and visit number, customer, status pill, when, technician, phone, address,
// product, SKU, representative, the fault and "מצב בשטח" (field times are office-only, TE-25);
// footer "לכרטיס הקריאה המלא ›" (where the role's matrix value offers `calls`, display only, G-04)
// and the caller's "חיוג לטכנאי" element (a dial is navigation, not a data action: production
// passes a `tel:` link, the UI demo a data-sim button). Read-only: scheduling stays in Outlook
// (OF-03).
// Additions from docs/demo-deviations.md: the visit source line (SIM-14) and 🧪 badges on the test
// customer and product (SIM-16, SIM-17).
// Open state lives in the URL (`req&n`, features/calendar/data/search-params): the page renders
// the drawer and passes the calendar address without the drawer as `closeHref`. A modal dialog:
// focus moves into it, Tab stays inside, Escape, ✕ and a click on the dimmed background close it
// (URL replaced, scroll kept), and focus returns to the visit block that opened it
// (data-cal-visit). Without JavaScript, ✕ is a plain link.

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** "מצב בשטח" (the demo's `live`). */
function fieldState(v: CalendarVisitDetail): string {
  switch (v.status) {
    case "new":
      return "טרם יצא";
    case "go":
      return v.departAt ? `בדרך ללקוח · יצא ${v.departAt}` : "בדרך ללקוח";
    case "work":
      return v.arriveAt ? `הגיע ${v.arriveAt} · בטיפול` : "בטיפול";
    case "done":
      return `טופל${v.endAt ? ` ${v.endAt}` : ""}${v.signerName ? ` · נחתם ע"י ${v.signerName}` : ""}`;
    case "cont":
      return `הסתיים${v.endAt ? ` ${v.endAt}` : ""} · המשך טיפול${v.followupReason ? ` – ${v.followupReason}` : ""}`;
    default:
      return "בוטל";
  }
}

const isPlainClick = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function CallDrawer({
  visit,
  closeHref,
  cardHref,
  dial,
}: {
  visit: CalendarVisitDetail;
  /** The calendar address with the drawer closed (same view, date and technician). */
  closeHref: string;
  /** The full call card; null where the role's matrix value does not offer `calls`. */
  cardHref: string | null;
  /** "חיוג לטכנאי" (production: a `tel:` link with the .btn look); null for none. */
  dial: ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set once the drawer starts closing: later keys and clicks are ignored. */
  const closedRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const subId = useId();
  const titleId = useId();
  const key = calVisitKey(visit);

  /** Focus the visit block that opened the drawer (when it is on the page). */
  function returnFocus() {
    document.querySelector<HTMLElement>(`[data-cal-visit="${CSS.escape(key)}"]`)?.focus();
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
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
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

  /** Focus that leaves the open drawer comes back to it. */
  const onFocusIn = useEffectEvent((e: FocusEvent) => {
    const panel = panelRef.current;
    if (closedRef.current || !panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
    panel.focus({ preventScroll: true });
  });

  /** Closed by a URL change (browser back, another link): focus goes back to the block. */
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

  const { customer: cu, product: p, technician: t } = visit;
  return (
    <div
      className="drawer-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={panelRef} className="drawer ocal-drawer" role="dialog" aria-modal="true" aria-labelledby={`${subId} ${titleId}`} tabIndex={-1}>
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            <div id={subId} className="sub">
              פנייה <span className="num">{visit.req}</span> · ביקור <span className="num">{visit.n}</span>
            </div>
            <h2 id={titleId} className="ocal-drawer-title">
              {cu.name} {cu.isTest && <TestBadge />}
            </h2>
            <div style={{ marginTop: 6 }}>
              <StatusPill status={visit.status} />
            </div>
            <div style={{ marginTop: 6 }}>
              <VisitSourceLine source={visit.source} />
            </div>
          </div>
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
        <div className="db">
          <div className="kv">
            <span>מועד</span>
            <span>
              {dayName(visit.date)}{" "}
              <span className="num">
                {ddmm(visit.date)} · {visit.start}–{visit.end}
              </span>
            </span>
            <span>טכנאי</span>
            <span>
              <span className="dot" style={{ background: t.color }} aria-hidden="true" /> {t.name}
            </span>
            <span>טלפון</span>
            <span dir="ltr" className="num" style={{ textAlign: "right" }}>
              {cu.phone}
            </span>
            <span>כתובת</span>
            <span>{cu.address}</span>
            <span>מוצר</span>
            <span>
              {p.name} {p.isTest && <TestBadge />}
            </span>
            <span>{'מק"ט'}</span>
            <span dir="ltr" style={{ textAlign: "right" }}>
              {p.sku}
            </span>
            <span>נציגה</span>
            <span>{visit.representative}</span>
          </div>
          <div className="card" style={{ padding: "10px 12px", background: "var(--tint)" }}>
            <div className="sub" style={{ fontWeight: 700 }}>
              תיאור התקלה
            </div>
            {visit.problem}
          </div>
          <div className="card" style={{ padding: "10px 12px", background: "var(--tint)" }}>
            <div className="sub" style={{ fontWeight: 700 }}>
              מצב בשטח
            </div>
            {fieldState(visit)}
          </div>
        </div>
        <div className="df">
          {cardHref && (
            <Link className="btn pri" href={cardHref} prefetch={false} style={{ flex: 1 }}>
              לכרטיס הקריאה המלא<span aria-hidden="true"> ›</span>
            </Link>
          )}
          {dial}
        </div>
      </div>
    </div>
  );
}
