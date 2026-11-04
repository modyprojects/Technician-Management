"use client";

// "מה לאסוף לפני יציאה" on the technician home (docs/demo.html techHome() L497-509; TE-03):
// the open visits' pickups grouped by place, a "Waze ›" per place, a "נאסף" checkbox per item
// ("ברז מטבח חלופי · ללוי 09:00") and "X מתוך Y נאסף". Look as in the demo.
// TE-03 (CHANGE): production persists "נאסף" per technician per day. The data-access layer has no
// read field or command for it yet (TODO(TE-03): a `collected` flag on PickupGroup items and a
// visits command to set it), so, as in the demo, the ticks live on this screen only and are not
// saved. No scheduled pickup reminder exists (TE-28, D25): this list is the reminder.
// Presentational apart from the ticks: the caller passes the groups and the "Waze ›" element of
// each place (a navigation affordance, TE-03).
import { useState, type ReactNode } from "react";
import type { PickupGroup } from "@/features/visits/data/types";

const keyOf = (ref: { req: string; n: number }): string => `${ref.req}-${ref.n}`;

/** The demo's "ל<last word of the customer name>" ("משפחת לוי" → "ללוי"). */
const forCustomer = (name: string): string => `ל${name.trim().split(/\s+/).slice(-1)[0] ?? ""}`;

export function PickupsCard({
  groups,
  placeActions,
}: {
  groups: PickupGroup[];
  /** "Waze ›" per place name. */
  placeActions?: Readonly<Record<string, ReactNode>>;
}) {
  const [collected, setCollected] = useState<ReadonlySet<string>>(() => new Set());
  const items = groups.flatMap((g) => g.items);
  if (!items.length) return null;
  const doneN = items.filter((x) => collected.has(keyOf(x.ref))).length;

  function toggle(key: string, on: boolean) {
    setCollected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <section
      className="card"
      aria-label="מה לאסוף לפני יציאה"
      style={{ padding: "10px 14px", background: "var(--warn-bg)", borderColor: "var(--warn-bd)", color: "var(--warn-ink)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 13, color: "var(--warn-fg)" }}>מה לאסוף לפני יציאה</h2>
        <span className="num" style={{ fontSize: 12, color: "var(--warn-fg)" }} aria-live="polite">
          {doneN} מתוך {items.length} נאסף
        </span>
      </div>
      {groups.map((g, i) => (
        <div
          key={g.place}
          style={i ? { borderTop: "1px solid var(--collect-line)", paddingTop: 6, marginTop: 6 } : undefined}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13 }}>{g.place}</b>
            {placeActions?.[g.place]}
          </div>
          {g.items.map((x) => {
            const k = keyOf(x.ref);
            const on = collected.has(k);
            return (
              <label
                key={k}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginTop: 4,
                  fontSize: 13,
                  ...(on ? { textDecoration: "line-through", color: "var(--collect-done)" } : null),
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => toggle(k, e.target.checked)}
                  style={{ width: 18, height: 18, margin: 0, padding: 0, flex: "none" }}
                />
                <span>
                  {x.item} · {forCustomer(x.customerName)} <span className="num">{x.start}</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </section>
  );
}
