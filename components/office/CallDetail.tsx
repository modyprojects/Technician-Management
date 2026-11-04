import Link from "next/link";
import type { ReactNode } from "react";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { CallStatus } from "@/features/calls/data/types";
import type { VisitStatus } from "@/features/visits/data/types";
import { VisitTimeline, type RenderRecording, type RenderVisitExtra, type TimelineVisit } from "./VisitTimeline";

// Office service-call card as a full page (docs/demo.html offCard() L834-859, with the fields of
// the calendar drawer drawerHtml() L803-814). Look as in the demo: "› חזרה לקריאות" (L739),
// breadcrumb, title with the customer's name and a status pill, the sub-line "פנייה · נציגה
// מטפלת · ביקורים", cards with key-value rows on the right ("פרטי הקריאה" in the demo's row
// order) and the visit timeline on the left (1 : 1.5); the columns stack only on a narrow work
// area (styles/ui.css, "office-call-detail").
// Changes from the demo (docs/demo-deviations.md): the header pill is the service-call status
// (OF-17, D38); a 🧪 badge on test calls, customers and products (SIM-15 to SIM-17); customer
// number (OF-05); brand and supplier show "לא הוזן" when empty (OF-07); warranty "לא צוין" when
// empty (TE-08); "פתח זימון ב-Outlook" is not shown until Microsoft 365 is connected (OF-08).
// Additions in the demo's visual language: the assignment card (technician, scheduled visits,
// pickup) and other calls of the same customer.
// OF-10 (D14): the caller may add a part at the end of each visit (`renderVisitExtra`): the
// "תיקונים" history of a closed visit and, for Manager and Creator only, "תיקון ביקור סגור"
// (components/office/VisitCorrections). The card itself decides nothing about who may correct.
// Presentational only: the caller passes formatted data and the header actions.

export type CallDetailTech = { name: string; color: string; phone: string };

/** An open visit (scheduled, en route, in progress) in the assignment card. */
export type ScheduledVisit = {
  n: number;
  task: number;
  status: VisitStatus;
  /** "היום · 09:00–11:00" or "חמישי 22.10 · 09:00–10:30". */
  when: string;
  tech: CallDetailTech;
  collect: string;
  collectFrom: string;
};

export type CallAssignment = {
  /** Open visits, in visit order. */
  scheduled: ScheduledVisit[];
  /** Technician of the last visit, shown when nothing is scheduled. */
  lastTech?: { tech: CallDetailTech; caption: string };
  /** Shown when nothing is scheduled. */
  emptyText: string;
};

/** Another call of the same customer. */
export type CustomerCallRow = { req: string; href: string; product: string; when: string; status: CallStatus };

export type CallDetailData = {
  req: string;
  /** Service-call status (D38), calculated by the caller. */
  status: CallStatus;
  isTest: boolean;
  /** "תיקון" / "התקנה". */
  type: string;
  /** Warranty text, "לא צוין" when empty. */
  warranty: string;
  customer: {
    name: string;
    /** Customer number ("מספר לקוח"). */
    number: string;
    phone: string;
    phone2: string;
    /** "הרצל 14, רחובות". */
    address: string;
    building: string;
    floor: string;
    apt: string;
    /** Arrival notes. */
    arrival: string;
    /** Handling representative. */
    rep: string;
    isTest: boolean;
  };
  product: { sku: string; name: string; brand: string; supplier: string; isTest: boolean };
  /** Fault description. */
  desc: string;
  /** "הערות לטכנאי" from the invitation. */
  techNote: string;
  assignment: CallAssignment;
  /** Every visit of the call, in visit order. */
  visits: TimelineVisit[];
  customerCalls: CustomerCallRow[];
};

const NOT_ENTERED = "לא הוזן";

export function CallDetail({
  call,
  backHref,
  actions,
  showReport,
  renderRecording,
  renderVisitExtra,
  customerHref,
}: {
  call: CallDetailData;
  /** The calls list. */
  backHref: string;
  /** The customer card ("לקוחות", OF-16); omitted when the role is not offered it. */
  customerHref?: string;
  /** Header actions, rendered as direct children of the title row: an item with
   *  `flex-basis: 100%` (a confirmation or a form) wraps onto its own row below the title. */
  actions?: ReactNode;
  showReport?: boolean;
  renderRecording?: RenderRecording;
  /** A part at the end of each visit of the timeline (OF-10 corrections); null for none. */
  renderVisitExtra?: RenderVisitExtra;
}) {
  const { customer: cu, product: p } = call;
  const visitCount = call.visits.length === 1 ? "ביקור אחד" : `${call.visits.length} ביקורים`;
  return (
    <>
      <div>
        <Link className="btn" href={backHref} style={{ padding: "6px 12px" }}>
          <span aria-hidden="true">› </span>
          חזרה לקריאות
        </Link>
      </div>
      <nav className="sub" aria-label="נתיב ניווט">
        <Link className="lnk" href={backHref}>
          קריאות
        </Link>{" "}
        › פנייה <span className="num">{call.req}</span>
      </nav>

      <div className="ptitle">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26 }}>{cu.name}</h1>
            <CallStatusPill status={call.status} />
            {call.isTest && <TestBadge />}
          </div>
          <div className="sub">
            פנייה <span className="num">{call.req}</span> · נציגה מטפלת: {cu.rep} · {visitCount}
          </div>
        </div>
        {actions}
      </div>

      <div className="ocd">
        <div className="ocd-cols">
          <div className="grid">
            <section className="card sec">
              {/* The customer-card link sits beside the heading, not inside it (a heading's name stays its title). */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                  לקוח וכתובת
                  {cu.isTest && <TestBadge />}
                </h2>
                {customerHref && (
                  <Link className="lnk" href={customerHref} prefetch={false} aria-label={`לכרטיס הלקוח · ${cu.name}`} style={{ fontSize: 14, fontWeight: 600 }}>
                    לכרטיס הלקוח ›
                  </Link>
                )}
              </div>
              <div className="kv">
                <span>מספר לקוח</span>
                <span className="num">{cu.number}</span>
                <span>טלפון</span>
                <span dir="ltr" className="num" style={{ textAlign: "right" }}>
                  {cu.phone}
                </span>
                {cu.phone2 && (
                  <>
                    <span>טלפון נוסף</span>
                    <span dir="ltr" className="num" style={{ textAlign: "right" }}>
                      {cu.phone2}
                    </span>
                  </>
                )}
                <span>כתובת</span>
                <span>{cu.address}</span>
                <span>בניין / קומה / דירה</span>
                <span>
                  {cu.building || "—"} / {cu.floor || "—"} / {cu.apt || "—"}
                </span>
                {cu.arrival && (
                  <>
                    <span>הערות הגעה</span>
                    <span>{cu.arrival}</span>
                  </>
                )}
              </div>
            </section>

            <section className="card sec">
              <h2>פרטי הקריאה</h2>
              <div className="kv">
                <span>סוג קריאה</span>
                <span>{call.type}</span>
                <span>מוצר</span>
                <span>
                  {p.name} {p.isTest && <TestBadge />}
                </span>
                <span>{'מק"ט'}</span>
                <span dir="ltr" style={{ textAlign: "right" }}>
                  {p.sku}
                </span>
                <span>מותג / ספק</span>
                <span>
                  {p.brand || NOT_ENTERED} · {p.supplier || NOT_ENTERED}
                </span>
                <span>באחריות</span>
                <span>{call.warranty}</span>
                <span>תיאור התקלה</span>
                <span style={{ lineHeight: 1.45 }}>{call.desc}</span>
                {call.techNote && (
                  <>
                    <span>הערות לטכנאי</span>
                    <span style={{ lineHeight: 1.45 }}>{call.techNote}</span>
                  </>
                )}
              </div>
            </section>

            {call.customerCalls.length > 0 && <CustomerCalls rows={call.customerCalls} />}
          </div>

          <div className="grid">
            <Assignment a={call.assignment} />
            <VisitTimeline visits={call.visits} showReport={showReport} renderRecording={renderRecording} renderExtra={renderVisitExtra} />
          </div>
        </div>
      </div>
    </>
  );
}

function TechRow({ tech, caption, aside }: { tech: CallDetailTech; caption?: string; aside?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: tech.color,
          color: "var(--on-dark)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--display)",
          fontWeight: 600,
          fontSize: 18,
          flex: "none",
        }}
      >
        {tech.name.slice(0, 1)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{tech.name}</b>
        <span className="sub" style={{ display: "block" }}>
          <span dir="ltr" className="num">
            {tech.phone}
          </span>
          {caption && ` · ${caption}`}
        </span>
      </span>
      {aside}
    </div>
  );
}

/** Who is assigned and when the next visits are (date, window, status, task, pickup). */
function Assignment({ a }: { a: CallAssignment }) {
  return (
    <section className="card sec">
      <h2>שיבוץ</h2>
      {a.scheduled.length > 0 ? (
        <div className="grid" style={{ gap: 14 }}>
          {a.scheduled.map((s) => (
            <div key={s.n}>
              <TechRow tech={s.tech} caption="טכנאי משובץ" aside={<StatusPill status={s.status} />} />
              <div className="num" style={{ marginTop: 10, fontSize: 14 }}>
                <b>ביקור {s.n}</b> · {s.when} · משימה {s.task}
              </div>
              {s.collect && (
                <div
                  style={{
                    marginTop: 8,
                    background: "var(--warn-bg)",
                    border: "1px solid var(--warn-bd)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 14,
                    color: "var(--warn-ink)",
                  }}
                >
                  <b>לאסוף לפני הביקור:</b> {s.collect} · מ{s.collectFrom}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          {a.lastTech && <TechRow tech={a.lastTech.tech} caption={a.lastTech.caption} />}
          <div className="sub" style={{ marginTop: a.lastTech ? 10 : 0 }}>
            {a.emptyText}
          </div>
        </>
      )}
    </section>
  );
}

function CustomerCalls({ rows }: { rows: readonly CustomerCallRow[] }) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="sec" style={{ paddingBottom: 0 }}>
        <h2>קריאות נוספות של הלקוח</h2>
      </div>
      {rows.map((r) => (
        <Link key={r.req} href={r.href} className="li">
          <span className="t num" style={{ width: 56 }}>
            {r.req}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>{r.product}</b>
            <span className="sub" style={{ display: "block" }}>
              {r.when}
            </span>
          </span>
          <CallStatusPill status={r.status} />
        </Link>
      ))}
    </section>
  );
}
