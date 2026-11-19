import type { FakeDay, FakeVisit } from "@/components/tech/calendar/types";
import { addDays, weekStartOf } from "@/features/calendar/data/dates";

// SKELETON (D81): fictional data only, every record is test data (D74). No database.
// Two calendar weeks (Sunday to Saturday): the current one and the next. Index 0 = Sunday of this
// week, 7 = Sunday of next week. The days before today carry closed visits (shown in the reduced
// view) and one visit left open on a previous day (Sunday 13:00), which the page must NOT show.
type Row = Omit<FakeVisit, "id">;
const BY_INDEX: Record<number, Row[]> = {
  0: [
    { request: "73021", start: "09:00", end: "10:30", customer: "מאפיית הגליל", city: "חיפה", address: "הנמל 12, חיפה", product: "מכונת קפה", summary: "הוחלף גוף חימום", status: "done" },
    { request: "73033", start: "13:00", end: "14:30", customer: "דפוס אלון", city: "נשר", address: "התעשייה 4, נשר", product: "מדפסת תעשייתית", summary: "נשאר פתוח מיום קודם", status: "work" },
  ],
  1: [
    { request: "73047", start: "08:30", end: "10:00", customer: "קליניקת שמש", city: "קריית אתא", address: "הרצל 8, קריית אתא", product: "מזגן מרכזי", summary: "נוקה וטופל מסנן", status: "done" },
    { request: "73052", start: "11:00", end: "12:00", customer: "סופר הצפון", city: "עכו", address: "ויצמן 31, עכו", product: "מקרר תעשייתי", summary: "תוקן מדחס", status: "done" },
  ],
  2: [{ request: "73066", start: "10:00", end: "11:30", customer: "משרדי נוף", city: "חיפה", address: "מוריה 90, חיפה", product: "מערכת אזעקה", summary: "הותקן חיישן חדש", status: "done" }],
  3: [
    { request: "73081", start: "08:30", end: "10:00", customer: "מאפיית הגליל", city: "חיפה", address: "הנמל 12, חיפה", product: "מכונת קפה", summary: "", status: "done" },
    { request: "73090", start: "11:00", end: "12:30", customer: "קליניקת שמש", city: "קריית אתא", address: "הרצל 8, קריית אתא", product: "מזגן מרכזי", summary: "", status: "work" },
    { request: "73097", start: "14:30", end: "16:00", customer: "דפוס אלון", city: "נשר", address: "התעשייה 4, נשר", product: "מדפסת תעשייתית", summary: "", status: "new", isFollowUp: true },
  ],
  4: [
    { request: "73104", start: "07:00", end: "08:30", customer: "מלון הים", city: "נהריה", address: "הגעתון 2, נהריה", product: "מערכת השקיה", summary: "", status: "new" },
    { request: "73108", start: "10:00", end: "11:00", customer: "סופר הצפון", city: "עכו", address: "ויצמן 31, עכו", product: "מקרר תעשייתי", summary: "", status: "new" },
    { request: "73112", start: "17:30", end: "19:00", customer: "בית קפה הנמל", city: "חיפה", address: "המגדלור 5, חיפה", product: "מכונת קפה", summary: "", status: "new" },
  ],
  5: [],
  6: [{ request: "73120", start: "09:00", end: "10:00", customer: "אולם שמחות כרמל", city: "טירת כרמל", address: "הכרמל 17, טירת כרמל", product: "מערכת קירור", summary: "", status: "new" }],
  7: [
    { request: "73131", start: "08:00", end: "09:30", customer: "מרכז רפואי גל", city: "חיפה", address: "בן גוריון 22, חיפה", product: "מזגן מרכזי", summary: "", status: "new" },
    { request: "73135", start: "10:30", end: "12:00", customer: "בית קפה הנמל", city: "חיפה", address: "המגדלור 5, חיפה", product: "מכונת קפה", summary: "", status: "new" },
  ],
  8: [{ request: "73142", start: "09:30", end: "11:00", customer: "בית ספר הדס", city: "קריית ביאליק", address: "הדס 3, קריית ביאליק", product: "מקרן", summary: "", status: "new", isFollowUp: true }],
  9: [{ request: "73150", start: "13:00", end: "14:30", customer: "מלון הים", city: "נהריה", address: "הגעתון 2, נהריה", product: "מערכת השקיה", summary: "", status: "new" }],
  10: [
    { request: "73158", start: "08:30", end: "10:00", customer: "משרדי נוף", city: "חיפה", address: "מוריה 90, חיפה", product: "מערכת אזעקה", summary: "", status: "new" },
    { request: "73161", start: "11:00", end: "12:30", customer: "דפוס אלון", city: "נשר", address: "התעשייה 4, נשר", product: "מדפסת תעשייתית", summary: "", status: "new" },
  ],
  11: [{ request: "73169", start: "10:00", end: "11:00", customer: "סופר הצפון", city: "עכו", address: "ויצמן 31, עכו", product: "מקרר תעשייתי", summary: "", status: "new" }],
};

/** The 14 days of this calendar week and the next (Sunday first). Past-day filtering is the page's job. */
export function fakeCalendar(today: string): FakeDay[] {
  const start = weekStartOf(today);
  return Array.from({ length: 14 }, (_, i) => ({
    date: addDays(start, i),
    visits: (BY_INDEX[i] ?? []).map((v, n) => ({ ...v, id: `fake-${i}-${n}` })),
  }));
}
