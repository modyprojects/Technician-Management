import type { Metadata } from "next";
import { TechShell } from "@/components/tech/TechShell";
import { TechHomeHeader } from "@/components/tech/TechHomeHeader";
import { BigButton } from "@/components/ui/BigButton";
import { Button } from "@/components/ui/Button";
import { PinIcon } from "@/components/ui/Icons";
import { ListItem } from "@/components/ui/ListItem";
import { StatusPill } from "@/components/ui/StatusPill";
import { FIXTURE_SENTINEL, TECH_HOME } from "../_fixtures";

export const metadata: Metadata = { title: "מסגרת טכנאי · תצוגת פיתוח" };

// Technician shell with fictitious data. Buttons are inert: Step 0 has no behaviour.
export default function TechShellShowcase() {
  const h = TECH_HOME;
  return (
    <div data-fixtures={FIXTURE_SENTINEL} style={{ display: "contents" }}>
      <TechShell
        activeTab="home"
        head={
          <TechHomeHeader
            dateLine={h.dateLine}
            greeting={h.greeting}
            initial={h.initial}
            avatarColor={h.avatarColor}
            unread={h.unread}
            visitsToday={h.schedule.length}
            completed={h.completed}
          />
        }
      >
        <div className="card" style={{ padding: 14, border: "2px solid var(--accent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{h.next.label}</span>
            <StatusPill status={h.next.status} />
          </div>
          <div
            style={{
              fontFamily: "var(--display)",
              fontWeight: 600,
              fontSize: 18,
              marginTop: 6,
            }}
          >
            {h.next.customer}
          </div>
          <div className="sub">{h.next.sub}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BigButton color="var(--accent)" compact>
              <PinIcon /> יוצא · Waze
            </BigButton>
            <Button style={{ flex: 1, height: 44 }}>פרטי קריאה</Button>
          </div>
        </div>

        <section className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px 4px",
            }}
          >
            <b style={{ fontSize: 14 }}>לו&quot;ז היום</b>
            <button type="button" className="chip" style={{ padding: "3px 10px", fontSize: 12 }}>
              יומן ›
            </button>
          </div>
          {h.schedule.map((v) => (
            <ListItem
              key={v.time}
              time={v.time}
              title={v.customer}
              sub={v.sub}
              trailing={<StatusPill status={v.status} />}
            />
          ))}
        </section>
      </TechShell>
    </div>
  );
}
