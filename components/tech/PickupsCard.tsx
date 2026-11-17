"use client";

// "מה לאסוף לפני יציאה" on the technician home (docs/demo.html techHome() L497-509; TE-03):
// the open visits' pickups grouped by place, a "Waze ›" per place, a "נאסף" checkbox per item
// ("ברז מטבח חלופי · ללוי 09:00") and "X מתוך Y נאסף". Look as in the demo.
// TE-03 (CHANGE): production keeps "נאסף" per technician per day. Each item starts from its DTO
// `collected` value; a tick runs useCommands().visits.setPickupCollected(ref, on): the screen
// shows the tick at once (optimistic) and undoes it, with an inline error, when the command
// fails. In the UI demo the command is simulated (the provider's toast says nothing was saved).
// No scheduled pickup reminder exists (TE-28, D25): this list is the reminder.
// The caller passes the groups and the "Waze ›" element of each place (a navigation affordance).
// Real app (Step 3, TEMPORARY): no database object keeps "נאסף" yet, so the real home passes its own
// `onToggle` (DevicePickups: kept on this device for the day) and a `note` that says so; the demo
// uses useCommands().visits.setPickupCollected.
import { useRef, useState, type ReactNode } from "react";
import { useOptionalCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import type { PickupGroup, VisitRef } from "@/features/visits/data/types";

const keyOf = (ref: { req: string; n: number }): string => `${ref.req}-${ref.n}`;

/** The demo's "ל<last word of the customer name>" ("משפחת לוי" → "ללוי"). */
const forCustomer = (name: string): string => `ל${name.trim().split(/\s+/).slice(-1)[0] ?? ""}`;

export function PickupsCard({
  groups,
  placeActions,
  onToggle,
  note,
}: {
  groups: PickupGroup[];
  /** "Waze ›" per place name. */
  placeActions?: Readonly<Record<string, ReactNode>>;
  /** Keeps a "נאסף" tick; default: the CommandsProvider's visits.setPickupCollected. */
  onToggle?: (ref: VisitRef, collected: boolean) => Promise<CommandResult>;
  /** A short line under the title (where the ticks are kept). */
  note?: string;
}) {
  const commands = useOptionalCommands();
  const setCollected = onToggle ?? commands?.visits.setPickupCollected;
  // Ticks changed on this screen, by "req-n" (an item without a change shows its DTO value).
  const [changed, setChanged] = useState<Readonly<Record<string, boolean>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const running = useRef(new Set<string>());
  const items = groups.flatMap((g) => g.items);
  if (!items.length) return null;
  const isOn = (x: (typeof items)[number]): boolean => changed[keyOf(x.ref)] ?? x.collected;
  const doneN = items.filter(isOn).length;

  async function toggle(ref: VisitRef, before: boolean, on: boolean) {
    const key = keyOf(ref);
    if (running.current.has(key)) return;
    running.current.add(key);
    setChanged((c) => ({ ...c, [key]: on }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    let error: string | null = null;
    try {
      if (!setCollected) throw new Error("no pickup command");
      const result = await setCollected(ref, on);
      if (!result.ok) error = result.error;
    } catch {
      error = "הסימון לא נשמר. נסה שוב.";
    } finally {
      running.current.delete(key);
    }
    if (error) {
      const message = error;
      setChanged((c) => ({ ...c, [key]: before }));
      setErrors((e) => ({ ...e, [key]: message }));
    }
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
      {note && (
        <div style={{ fontSize: 12, color: "var(--warn-fg)", marginBottom: 4 }}>{note}</div>
      )}
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
            const on = isOn(x);
            const error = errors[k];
            return (
              <div key={k}>
                <label
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
                    onChange={(e) => void toggle(x.ref, on, e.target.checked)}
                    style={{ width: 18, height: 18, margin: 0, padding: 0, flex: "none" }}
                  />
                  <span>
                    {x.item} · {forCustomer(x.customerName)} <span className="num">{x.start}</span>
                  </span>
                </label>
                {error && (
                  <div role="alert" style={{ fontSize: 12, color: "var(--danger-fg)", marginTop: 2 }}>
                    {error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
