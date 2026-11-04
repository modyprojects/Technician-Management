import type { ReactNode } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import type { VisitDetail } from "@/features/visits/data/types";

// Details of an open visit on the technician visit card (docs/demo.html techCall() L530-543).
// Look as in the demo: a key-value card (address, building / floor / apartment, arrival notes,
// phone, product, SKU, warranty, handling rep), the fault description, and the yellow
// "לאסוף לפני הביקור" card with "Waze ›" to the pickup place. Changes (docs/demo-deviations.md):
// - TE-08: warranty shows "לא צוין" when empty.
// - TE-09 (ADD): "מספר לקוח".
// - TE-10 (ADD): "הערות לטכנאי" from the invitation, as a note under the fault description.
// - TE-11 (ADD): "ביקור בתשלום" marker when the warranty is "לא".
// - SIM-16, SIM-17: 🧪 badge on a test customer (next to the customer number) and product.
// - Added: the second phone when the invitation has one.
// Presentational: the caller passes the pickup place's "Waze ›" element.

export const WARRANTY_NOT_GIVEN = "לא צוין";

/** TE-11: the warranty field says the visit is not covered. */
export const isPaidVisit = (warranty: string): boolean => warranty.trim() === "לא";

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="row">
    <span className="k">{k}</span>
    {children}
  </div>
);

const Cell = ({ k, v }: { k: string; v: string }) => (
  <div>
    <div className="k" style={{ fontSize: 12 }}>
      {k}
    </div>
    <b>{v || "—"}</b>
  </div>
);

/** Customer, address and product rows (TE-08 to TE-11). */
export function VisitInfoCard({ visit }: { visit: VisitDetail }) {
  const { customer: cu, product: p, call } = visit;
  const warranty = call.warranty.trim();
  return (
    <section className="card" aria-label="פרטי הלקוח והמוצר" style={{ padding: "4px 14px" }}>
      <Row k="כתובת">
        <b>
          {cu.address.street}, {cu.address.city}
        </b>
      </Row>
      <div className="row" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
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
              <TestBadge />
            </>
          )}
        </span>
      </Row>
      <Row k="מוצר">
        <span>
          {p.name}
          {p.isTest && (
            <>
              {" "}
              <TestBadge />
            </>
          )}
        </span>
      </Row>
      <Row k='מק"ט'>
        <span dir="ltr">{p.sku}</span>
      </Row>
      <Row k="באחריות">
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontWeight: 700, color: warranty.startsWith("כן") ? "var(--s-done)" : "var(--muted)" }}>
            {warranty || WARRANTY_NOT_GIVEN}
          </span>
          {isPaidVisit(warranty) && (
            <span className="pill" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              ₪ ביקור בתשלום
            </span>
          )}
        </span>
      </Row>
      <Row k="נציגה מטפלת">
        <span>{call.representative.name}</span>
      </Row>
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
