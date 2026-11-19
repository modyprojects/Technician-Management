import type { Metadata } from "next";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { TECH_START_HREFS, TECH_START_TABS } from "../_tabs";
import { CalendarDays } from "./_components/CalendarDays";
import { fakeCalendar } from "./_components/calendar-fake";

export const metadata: Metadata = { title: "יומן · ניהול טכנאים" };

// SKELETON (D81): "יומן", today and the coming 7 days (D83), fictional data only (D74). No database
// and no server logic beyond the role guard (requireArea("tech")).
export default async function TechCalendarPage() {
  const me = await requireArea("tech");
  return (
    <TechShell
      head={<TechStartHead title="יומן" isTest={me.isTest} sub="היום והימים הקרובים" />}
      activeTab="cal"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      <TestDataBanner />
      <CalendarDays days={fakeCalendar(jerusalemToday())} />
    </TechShell>
  );
}
