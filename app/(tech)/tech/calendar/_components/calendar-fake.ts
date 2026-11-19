import { addDays } from "@/features/calendar/data/dates";
import type { VisitStatus } from "@/features/visits/data/types";

// SKELETON (D81): fictional data only, every record marked as test data (D74). No database.
export type FakeCalendarVisit = {
  start: string;
  customer: string;
  city: string;
  product: string;
  status: VisitStatus;
  isFollowUp?: boolean;
};

export type FakeCalendarDay = { date: string; offset: number; visits: FakeCalendarVisit[] };

// Scope (D83): today and the coming 7 days; no past days. Offsets are days from today.
const BY_OFFSET: Record<number, FakeCalendarVisit[]> = {
  0: [
    { start: "08:30", customer: "מאפיית הגליל", city: "חיפה", product: "מכונת קפה", status: "done" },
    { start: "11:00", customer: "קליניקת שמש", city: "קריית אתא", product: "מזגן מרכזי", status: "work" },
    { start: "14:30", customer: "דפוס אלון", city: "נשר", product: "מדפסת תעשייתית", status: "new", isFollowUp: true },
  ],
  1: [
    { start: "09:00", customer: "מלון הים", city: "נהריה", product: "מערכת השקיה", status: "new" },
    { start: "13:00", customer: "סופר הצפון", city: "עכו", product: "מקרר תעשייתי", status: "new" },
  ],
  2: [],
  3: [{ start: "10:00", customer: "משרדי נוף", city: "חיפה", product: "מערכת אזעקה", status: "new" }],
  5: [{ start: "09:30", customer: "בית ספר הדס", city: "קריית ביאליק", product: "מקרן", status: "new", isFollowUp: true }],
  7: [{ start: "08:00", customer: "מרכז רפואי גל", city: "חיפה", product: "מזגן מרכזי", status: "new" }],
};

export function fakeCalendar(today: string): FakeCalendarDay[] {
  return Array.from({ length: 8 }, (_, offset) => ({ date: addDays(today, offset), offset, visits: BY_OFFSET[offset] ?? [] }));
}
