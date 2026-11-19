// SKELETON (D81): fictional data only, no database calls. Every record is test data (D47, D74).
// Replaced by the real calendar queries in the build step; the DTO types are the existing calendar
// types, so the screen does not change when the data is wired.
import { addDays, toMinutes, weekStartOf } from "@/features/calendar/data/dates";
import type {
  CalendarVisit,
  CalendarVisitDetail,
  OfficeCalendarDay,
  OfficeCalendarWeek,
  OfficeDayLane,
  PlacedCalendarVisit,
} from "@/features/calendar/data/types";
import { CALENDAR_LANE_LIMIT, CALENDAR_WEEK_DAY_LIMIT } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianRef } from "@/features/reference/data/types";

/** The skeleton's "today" (Thursday). */
export const SKELETON_TODAY: IsoDate = "2026-11-19";

/** Colour-blind-safe technician colours (D77: ten to choose from; four are in use here). */
export const SKELETON_TECHNICIANS: readonly TechnicianRef[] = [
  { id: "t1", name: "אבי כהן", color: "#0072B2", phone: "050-0000001" },
  { id: "t2", name: "מוטי לוי", color: "#D55E00", phone: "050-0000002" },
  { id: "t3", name: "שירן אדר", color: "#009E73", phone: "050-0000003" },
  { id: "t4", name: "דור פרץ", color: "#CC79A7", phone: "050-0000004" },
];

type Seed = [
  offset: number,
  tech: string,
  start: string,
  end: string,
  status: CalendarVisit["status"],
  customer: string,
  city: string,
  product: string,
  req?: string,
  n?: number,
];

// offset = work day (0 = Sunday ... 4 = Thursday of the week of 15.11); 5 and 6 = Sunday and Monday after.
const SEEDS: readonly Seed[] = [
  [0, "t1", "08:30", "10:00", "done", "משפחת לוי", "רחובות", "ברז מטבח נשלף"],
  [0, "t2", "09:00", "10:30", "done", "רותם אלמוג", "חולון", "מסנן מים"],
  [0, "t1", "11:00", "12:30", "cont", "דנה כהן", "ראשון לציון", "סוללת אמבטיה"],
  [1, "t3", "08:00", "09:30", "done", "יוסי מזרחי", "נס ציונה", "מיכל הדחה סמוי"],
  [1, "t1", "10:00", "11:30", "done", "אילנה שגב", "יבנה", "ברז מטבח נשלף"],
  [1, "t4", "13:00", "14:00", "done", "נועה ברק", "לוד", "מסנן מים"],
  [2, "t2", "08:30", "10:00", "done", "משפחת פרידמן", "רמלה", "סוללת אמבטיה"],
  [2, "t3", "10:30", "12:00", "done", "גיל אשכנזי", "רחובות", "מיכל הדחה סמוי"],
  [2, "t1", "14:00", "15:30", "cont", "טל וינטר", "אשדוד", "ברז מטבח נשלף"],
  [3, "t4", "08:00", "09:00", "done", "ענת רוזן", "חולון", "מסנן מים"],
  [3, "t2", "09:30", "11:00", "done", "משפחת חדד", "בת ים", "סוללת אמבטיה"],
  [3, "t3", "12:00", "13:30", "done", "עמית נבון", "ראשון לציון", "ברז מטבח נשלף"],
  [4, "t1", "08:30", "10:00", "done", "משפחת לוי", "רחובות", "ברז מטבח נשלף", "SK-1008", 2],
  [4, "t1", "10:30", "12:00", "work", "רותם אלמוג", "חולון", "מסנן מים"],
  [4, "t1", "13:00", "14:30", "new", "דנה כהן", "ראשון לציון", "סוללת אמבטיה"],
  [4, "t2", "09:00", "10:30", "go", "יוסי מזרחי", "נס ציונה", "מיכל הדחה סמוי"],
  [4, "t2", "11:00", "12:00", "new", "אילנה שגב", "יבנה", "ברז מטבח נשלף"],
  [4, "t2", "11:30", "13:00", "new", "נועה ברק", "לוד", "מסנן מים"],
  [4, "t3", "08:00", "09:30", "done", "משפחת פרידמן", "רמלה", "סוללת אמבטיה"],
  [4, "t3", "15:00", "16:30", "new", "גיל אשכנזי", "רחובות", "מיכל הדחה סמוי"],
  // t4 has no visit on Thursday: an empty lane.
  [5, "t1", "09:00", "10:30", "new", "טל וינטר", "אשדוד", "ברז מטבח נשלף"],
  [5, "t3", "10:00", "11:30", "new", "ענת רוזן", "חולון", "מסנן מים"],
  [6, "t2", "08:30", "10:00", "new", "משפחת חדד", "בת ים", "סוללת אמבטיה"],
];

const BASE_WEEK: IsoDate = "2026-11-15";

const ALL_VISITS: readonly CalendarVisit[] = SEEDS.map(
  ([offset, tech, start, end, status, customerName, city, productName, req, n], i) => {
    const t = SKELETON_TECHNICIANS.find((x) => x.id === tech) ?? SKELETON_TECHNICIANS[0]!;
    const visitNo = n ?? 1;
    return {
      req: req ?? `SK-${1000 + i}`,
      n: visitNo,
      date: addDays(BASE_WEEK, offset >= 5 ? offset + 2 : offset),
      start,
      end,
      status,
      source: i % 2 ? "simulator" : "outlook",
      technician: { id: t.id, name: t.name, color: t.color },
      customerName,
      city,
      productName,
      isFollowUp: visitNo > 1,
      isTest: true,
    };
  },
);

const byStart = (a: CalendarVisit, b: CalendarVisit): number =>
  toMinutes(a.start) - toMinutes(b.start) || a.technician.id.localeCompare(b.technician.id);

/** Overlap placement (the demo's laneLayout, simplified): a visit sits beside the ones it overlaps. */
function place(visits: CalendarVisit[]): PlacedCalendarVisit[] {
  const placed: PlacedCalendarVisit[] = [];
  let cluster: PlacedCalendarVisit[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((v) => v.lane + 1));
    for (const v of cluster) placed.push({ ...v, lanes });
    cluster = [];
  };
  for (const v of visits) {
    if (cluster.length && toMinutes(v.start) >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => toMinutes(c.end) > toMinutes(v.start)).map((c) => c.lane));
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ ...v, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, toMinutes(v.end));
  }
  flush();
  return placed;
}

export function skeletonDay(date: IsoDate, tech: string): OfficeCalendarDay {
  const technicians = SKELETON_TECHNICIANS.filter((t) => tech === "all" || t.id === tech);
  const lanes: OfficeDayLane[] = technicians.map((t) => {
    const own = ALL_VISITS.filter((v) => v.date === date && v.technician.id === t.id).sort(byStart);
    return { technician: t, visits: { items: place(own), total: own.length, limit: CALENDAR_LANE_LIMIT } };
  });
  return {
    date,
    filter: { technicianId: tech === "all" ? null : tech, statuses: [] },
    includesTestData: true,
    lanes,
    total: lanes.reduce((s, l) => s + l.visits.total, 0),
  };
}

export function skeletonWeek(date: IsoDate, tech: string): OfficeCalendarWeek {
  const weekStart = weekStartOf(date);
  const days = [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(weekStart, i);
    const own = ALL_VISITS.filter((v) => v.date === d && (tech === "all" || v.technician.id === tech)).sort(byStart);
    return { date: d, visits: { items: own, total: own.length, limit: CALENDAR_WEEK_DAY_LIMIT } };
  });
  return {
    weekStart,
    filter: { technicianId: tech === "all" ? null : tech, statuses: [] },
    includesTestData: true,
    days,
    total: days.reduce((s, d) => s + d.visits.total, 0),
  };
}

export function skeletonVisitDetail(req: string, n: number): CalendarVisitDetail | null {
  const v = ALL_VISITS.find((x) => x.req === req && x.n === n);
  const tech = v && SKELETON_TECHNICIANS.find((t) => t.id === v.technician.id);
  if (!v || !tech) return null;
  return {
    req: v.req,
    n: v.n,
    date: v.date,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    isTest: true,
    technician: tech,
    customer: { name: v.customerName, phone: "050-0000000", isTest: true, address: `הרצל 14, ${v.city}` },
    product: { sku: "SK-0001", name: v.productName, isTest: true },
    representative: "נציגת שירות",
    problem: "תקלה לדוגמה (נתוני בדיקה)",
    departAt: v.status === "new" ? null : v.start,
    arriveAt: v.status === "new" || v.status === "go" ? null : v.start,
    endAt: v.status === "done" || v.status === "cont" ? v.end : null,
    signerName: v.status === "done" ? "לקוח לדוגמה" : null,
    followupReason: v.status === "cont" ? "חלק חסר" : null,
  };
}
