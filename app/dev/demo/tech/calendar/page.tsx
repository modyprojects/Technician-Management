import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseTechCalendarState } from "@/features/calendar/data/search-params";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { Placeholder } from "../../_components/Placeholder";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";

export const metadata: Metadata = { title: "היומן שלי · טכנאי · הדגמה" };

// PLACEHOLDER (replaced by the screen): technician "היומן שלי" (docs/demo.html techCalendar()
// L603-643; TE-27). The URL is the query (?view=day|week|month&date): calendar.techWeek for the
// day and week views, calendar.techMonth for the month view (G-03: production takes the
// technician from the session).
export default async function TechCalendarPage({ searchParams }: PageProps<"/dev/demo/tech/calendar">) {
  const state = parseTechCalendarState(await searchParams, TODAY);
  const total =
    state.view === "month"
      ? (await demoDataAccess.calendar.techMonth(DEMO_TECHNICIAN_ID, state.date.slice(0, 7)))?.total
      : (await demoDataAccess.calendar.techWeek(DEMO_TECHNICIAN_ID, state.date))?.total;
  if (total === undefined) notFound();
  return (
    <DemoTechFrame activeTab="cal" head={<h1 style={{ fontSize: 22 }}>היומן שלי</h1>}>
      <Placeholder screen={`היומן שלי · ${total} ביקורים`} />
    </DemoTechFrame>
  );
}
