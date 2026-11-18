import type { ReactNode } from "react";
import { TestPill } from "@/components/ui/TestBadge";
import type { VisitDetail } from "@/features/visits/data/types";

// Details of an open visit on the technician visit card (docs/demo.html techCall() L530-543).
// Look as in the demo: a key-value card (address, building / floor / apartment, arrival notes,
// phone, product, SKU, warranty, handling rep), the fault description, and the yellow
// "לאסוף לפני הביקור" card with "Waze ›" to the pickup place. Changes (docs/demo-deviations.md):
// - D68 (owner, 2026-11-18): no warranty row and no "ביקור בתשלום" marker on technician screens
//   (supersedes TE-11; warranty removed from TE-08 here; the office call card keeps it).
// - Owner, 2026-11-18: building / floor / apartment in three equal columns, label and value
//   centred in each (building right, floor middle, apartment left).
// - TE-09 (ADD): "מספר לקוח".
// - TE-10 (ADD): "הערות לטכנאי" from the invitation, as a note under the fault description.
// - SIM-16, SIM-17: 🧪 badge on a test customer (next to the customer number) and product.
// - Added: the second phone when the invitation has one.
// - Added (Step 3, the coordinator's visit-card list): "סוג קריאה" ("תיקון" / "התקנה", D48).
// Presentational: the caller passes the pickup place's "Waze ›" element.

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="row">
    <span className="k">{k}</span>
    {children}
  </div>
);

const Cell = ({ k, v }: { k: string; v: string }) => (
  <div style={{ textAlign: "center" }}>
    <div className="k" style={{ fontSize: 12 }}>
      {k}
    </div>
    <b>{v || "—"}</b>
  </div>
);

/** Customer, address and product rows (TE-08 to TE-10; no warranty, D68). */
export function VisitInfoCard({ visit }: { visit: VisitDetail }) {
  const { customer: cu, product: p, call } = visit;
  return (
    <section className="card" aria-label="פרטי הלקוח והמוצר" style={{ padding: "4px 14px" }}>
      <Row k="כתובת">
        <b>
          {cu.address.street}, {cu.address.city}
        </b>
      </Row>
      <div className="row" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Cell k="בניין" v={cu.address.building} />
        <Cell k="קומה" v={cu.address.floor} />
        <Cell k="דירה" v={cu.address.apt} />
      </div>
      {cu.arrivalNotes && (
        <Row k="הערות הגעה">
          <span>{cu.arrivalNotes}</span>
        </Row>
      )}
      <Row k="טלפון">
        <span dir="ltr" className="num">
          {cu.phone}
        </span>
      </Row>
      {cu.phone2 && (
        <Row k="טלפון נוסף">
          <span dir="ltr" className="num">
            {cu.phone2}
          </span>
        </Row>
      )}
      <Row k="מספר לקוח">
        <span>
          <span className="num">{cu.number}</span>
          {cu.isTest && (
            <>
              {" "}
              <TestPill />
            </>
          )}
        </span>
      </Row>
      {call.type && (
        <Row k="סוג קריאה">
          <span>{call.type}</span>
        </Row>
      )}
      <Row k="מוצר">
        <span>
          {p.name}
          {p.isTest && (
            <>
              {" "}
              <TestPill />
            </>
          )}
        </span>
      </Row>
      <Row k='מק"ט'>
        <span dir="ltr">{p.sku}</span>
      </Row>
      {call.representative.name && (
        <Row k="נציגה מטפלת">
          <span>{call.representative.name}</span>
        </Row>
      )}
    </section>
  );
}

/** "תיאור התקלה" and, when given, "הערות לטכנאי" (TE-10). */
export function VisitProblem({ problem, techNote }: { problem: string; techNote: string }) {
  return (
    <>
      <section className="card" aria-label="תיאור התקלה" style={{ padding: "10px 14px" }}>
        <h2 className="sub" style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          תיאור התקלה
        </h2>
        <div style={{ fontSize: 15, lineHeight: 1.45 }}>{problem}</div>
      </section>
      {techNote && (
        <section className="note" aria-label="הערות לטכנאי">
          <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 13 }}>הערות לטכנאי</h2>
          <div style={{ fontSize: 14 }}>{techNote}</div>
        </section>
      )}
    </>
  );
}

/** "לאסוף לפני הביקור" (TE-08): the item, the place and its "Waze ›". Nothing when there is no pickup. */
export function VisitPickup({ pickup, action }: { pickup: VisitDetail["pickup"]; action?: ReactNode }) {
  if (!pickup) return null;
  return (
    <section
      className="card"
      aria-label="לאסוף לפני הביקור"
      style={{ padding: "10px 14px", background: "var(--warn-bg)", borderColor: "var(--warn-bd)" }}
    >
      <h2 style={{ fontFamily: "var(--body)", fontSize: 12, color: "var(--warn-fg)", fontWeight: 700 }}>לאסוף לפני הביקור</h2>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          color: "var(--warn-ink)",
          fontSize: 14,
        }}
      >
        <span>
          {pickup.item} · <b>מ{pickup.place}</b>
        </span>
        {action}
      </div>
    </section>
  );
}
