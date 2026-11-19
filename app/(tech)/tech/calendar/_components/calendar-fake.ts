import type { FakeDay, FakeVisit } from "@/components/tech/calendar/types";
import { addDays } from "@/features/calendar/data/dates";

// SKELETON (D81): fictional data only, every record is test data (D74). No database.
// Window (D83): today and the next 6 days, no past days. A visit closed today stays until the end of
// the day; a visit left open on a previous day is not shown (it is not in this window at all).
const BY_OFFSET: Record<number, Omit<FakeVisit, "id">[]> = {
  0: [
    { start: "08:30", end: "10:00", customer: "מאפיית הגליל", city: "חיפה", product: "מכונת קפה", status: "done" },
    { start: "11:00", end: "12:30", customer: "קליניקת שמש", city: "קריית אתא", product: "מזגן מרכזי", status: "work" },
    { start: "14:30", end: "16:00", customer: "דפוס אלון", city: "נשר", product: "מדפסת תעשייתית", status: "new", isFollowUp: true },
  ],
  1: [
    { start: "09:00", end: "10:30", customer: "מלון הים", city: "נהריה", product: "מערכת השקיה", status: "new" },
    { start: "13:00", end: "14:00", customer: "סופר הצפון", city: "עכו", product: "מקרר תעשייתי", status: "new" },
  ],
  2: [],
  3: [{ start: "10:00", end: "11:30", customer: "משרדי נוף", city: "חיפה", product: "מערכת אזעקה", status: "new" }],
  4: [
    { start: "08:00", end: "09:30", customer: "מרכז רפואי גל", city: "חיפה", product: "מזגן מרכזי", status: "new" },
    { start: "10:30", end: "12:00", customer: "בית קפה הנמל", city: "חיפה", product: "מכונת קפה", status: "new" },
  ],
  5: [{ start: "09:00", end: "10:00", customer: "אולם שמחות כרמל", city: "טירת כרמל", product: "מערכת קירור", status: "new" }],
  6: [{ start: "09:30", end: "11:00", customer: "בית ספר הדס", city: "קריית ביאליק", product: "מקרן", status: "new", isFollowUp: true }],
};

export function fakeCalendar(today: string): FakeDay[] {
  return Array.from({ length: 7 }, (_, offset) => ({
    date: addDays(today, offset),
    visits: (BY_OFFSET[offset] ?? []).map((v, i) => ({ ...v, id: `fake-${offset}-${i}` })),
  }));
}
