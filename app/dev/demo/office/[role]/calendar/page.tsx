import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { officeCalendarFilterOf, parseOfficeCalendarState } from "@/features/calendar/data/search-params";
import { offers } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { Placeholder } from "../../../_components/Placeholder";
import { demoDataAccess } from "../../../_data/adapter";
import { TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, VIEWPOINTS } from "../../../_data/roles";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calendar">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `יומן טכנאים · ${VIEWPOINTS[role].label} · הדגמה` };
}

// PLACEHOLDER (replaced by the screen): office "יומן טכנאים" (docs/demo.html offCal() L752-802,
// drawer drawerHtml() L803-815; OF-03). The URL is the query (features/calendar/data/search-params:
// ?view&date&tech&req&n): calendar.officeDay / officeWeek / officeMonth with the technician filter,
// and calendar.visit(ref) for the open drawer. Matrix key `cal` (display only, G-04).
export default async function OfficeCalendarPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/calendar">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!offers(permissions, "cal")) {
    return (
      <DemoOfficeFrame role={role} active="cal">
        <Placeholder screen="יומן טכנאים · אין הרשאה לתפקיד הזה" />
      </DemoOfficeFrame>
    );
  }

  const state = parseOfficeCalendarState(await searchParams, TODAY);
  const filter = officeCalendarFilterOf(state);
  const { calendar } = demoDataAccess;
  const [total, drawer] = await Promise.all([
    state.view === "month"
      ? calendar.officeMonth(state.date.slice(0, 7), filter).then((m) => m.total)
      : state.view === "week"
        ? calendar.officeWeek(state.date, filter).then((w) => w.total)
        : calendar.officeDay(state.date, filter).then((d) => d.total),
    state.visit ? calendar.visit(state.visit) : null,
  ]);

  return (
    <DemoOfficeFrame role={role} active="cal">
      <Placeholder screen={`יומן טכנאים · ${total} ביקורים${drawer ? ` · ${drawer.customer.name}` : ""}`} />
    </DemoOfficeFrame>
  );
}
