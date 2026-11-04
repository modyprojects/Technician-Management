// FICTITIOUS DATA ONLY, copied from the demo's seed data. Allowed only under app/dev (G-05).
// The sentinel lets the bundle check prove this module is absent from builds after go-live.
import type { VisitStatus } from "@/components/ui/StatusPill";
import type { TechDayVisit } from "@/features/visits/data/types";

export const FIXTURE_SENTINEL = "FIXTURE-SENTINEL-TM-STEP0";

export const TECHS = {
  y: { name: "יורם", color: "var(--t-y)" },
  e: { name: "אדי", color: "var(--t-e)" },
  s: { name: "שמואל", color: "var(--t-s)" },
} as const;

export type TechId = keyof typeof TECHS;

export const TECH_HOME = {
  dateLine: "יום רביעי · 21.10.2026",
  greeting: "בוקר טוב, יורם",
  initial: "י",
  avatarColor: "var(--t-y)",
  unread: 3,
  completed: 0,
  next: {
    label: "הביקור הבא · 09:00–11:00",
    status: "new" as VisitStatus,
    customer: "משפחת לוי",
    sub: "הרצל 14, רחובות · ברז מטבח נשלף",
  },
  schedule: [
    { time: "09:00", customer: "משפחת לוי", sub: "רחובות · ברז מטבח נשלף", status: "new" },
    { time: "11:30", customer: "אבי כהן", sub: "נס ציונה · ↻ ביקור המשך", status: "new" },
    { time: "14:00", customer: "רונית מזרחי", sub: "ראשון לציון · מיכל הדחה סמוי", status: "new" },
    { time: "16:00", customer: "קבלן ש.ב. בנייה", sub: "יבנה · ברז מטבח פרח", status: "new" },
  ] satisfies { time: string; customer: string; sub: string; status: VisitStatus }[],
};

// Manager navigation: demo NAV for "מנהל" plus Settings (demo-deviations SE-03).
export const OFFICE_NAV = [
  { key: "cal", label: "יומן טכנאים" },
  { key: "calls", label: "קריאות" },
  { key: "dash", label: "דשבורד" },
  { key: "settings", label: "הגדרות" },
] as const;

export const OFFICE_USER = { name: "דורון", roleLabel: "מנהל", avatarColor: "var(--accent)" };

export const CALL_STATUS_COUNTS: { key: VisitStatus | "all"; label: string; count: number }[] = [
  { key: "all", label: "הכל", count: 189 },
  { key: "new", label: "שובצה", count: 10 },
  { key: "go", label: "בדרך", count: 1 },
  { key: "work", label: "בטיפול", count: 1 },
  { key: "done", label: "טופל", count: 155 },
  { key: "cont", label: "המשך טיפול", count: 22 },
  { key: "cancel", label: "בוטלה", count: 0 },
];

export type CallRow = {
  req: string;
  customer: string;
  city: string;
  product: string;
  sku: string;
  tech: TechId;
  visits: number;
  when: string;
  status: VisitStatus;
  reason?: string;
  rep: string;
};

export const CALL_ROWS: CallRow[] = [
  { req: "48252", customer: "דניאל רז", city: "נס ציונה", product: "מיכל הדחה סמוי", sku: "WC-300", tech: "y", visits: 1, when: "22.10 13:00", status: "new", rep: "שיראל" },
  { req: "48253", customer: "שלומית סויסה", city: "חולון", product: "ברז אמבטיה רב-דרך", sku: "BT-1120", tech: "e", visits: 1, when: "22.10 10:00", status: "new", rep: "שיראל" },
  { req: "48251", customer: "מרים אלון", city: "רחובות", product: "ברז מטבח נשלף", sku: "KT-2041", tech: "y", visits: 1, when: "22.10 09:00", status: "new", rep: "שיראל" },
  { req: "48241", customer: "קבלן ש.ב. בנייה", city: "יבנה", product: "ברז מטבח פרח", sku: "KT-1800", tech: "y", visits: 1, when: "היום 16:00", status: "new", rep: "שיראל" },
  { req: "48140", customer: "אלון דהן", city: "רמלה", product: "מערכת מקלחת תרמוסטטית", sku: "SH-510", tech: "s", visits: 3, when: "היום 15:00", status: "new", rep: "שיראל" },
  { req: "48240", customer: "רונית מזרחי", city: "ראשון לציון", product: "מיכל הדחה סמוי", sku: "WC-300", tech: "y", visits: 1, when: "היום 14:00", status: "new", rep: "שיראל" },
  { req: "48233", customer: "מוטי אזולאי", city: "תל אביב", product: "מיכל הדחה סמוי", sku: "WC-300", tech: "e", visits: 1, when: "היום 13:30", status: "new", rep: "שיראל" },
  { req: "48236", customer: "מרים חדד", city: "לוד", product: "ברז אמבטיה רב-דרך", sku: "BT-1120", tech: "s", visits: 1, when: "היום 12:30", status: "new", rep: "שיראל" },
  { req: "48205", customer: "אבי כהן", city: "נס ציונה", product: "ברז אמבטיה רב-דרך", sku: "BT-1120", tech: "y", visits: 2, when: "היום 11:30", status: "new", rep: "שיראל" },
  { req: "48226", customer: "יעל שושן", city: "בת ים", product: "מערכת מקלחת תרמוסטטית", sku: "SH-510", tech: "e", visits: 1, when: "היום 10:00", status: "go", rep: "שיראל" },
  { req: "48219", customer: "אורן גל", city: "שוהם", product: "ברז מטבח נשלף", sku: "KT-2041", tech: "s", visits: 1, when: "היום 09:40", status: "work", rep: "שיראל" },
  { req: "48213", customer: "משפחת לוי", city: "רחובות", product: "ברז מטבח נשלף", sku: "KT-2041", tech: "y", visits: 1, when: "היום 09:00", status: "new", rep: "שיראל" },
  { req: "48198", customer: "דוד פרץ", city: "חולון", product: "כיור אמבטיה + סיפון", sku: "BS-220", tech: "e", visits: 1, when: "היום 08:00", status: "done", rep: "שיראל" },
  { req: "48190", customer: "נועה ברק", city: "מודיעין", product: "מיכל הדחה סמוי", sku: "WC-300", tech: "s", visits: 1, when: "היום 08:00", status: "cont", reason: "ממתין לחלקי חילוף", rep: "שיראל" },
];

// "הושלמו היום" with rows (R12): the demo fixtures have no visit of the demo technician closed on
// the demo's date, so the non-empty list (rows, 🧪 badge, pager) is shown here with sample DTOs.
export const DONE_TODAY: TechDayVisit[] = [
  {
    req: "48198", n: 1, task: 1, start: "08:00", end: "09:30", status: "done", source: "simulator", customerName: "דוד פרץ",
    address: "סוקולוב 3, חולון", city: "חולון", productName: "כיור אמבטיה + סיפון", isFollowUp: false, pickup: null, isTest: true,
  },
  {
    req: "48190", n: 1, task: 2, start: "10:00", end: "11:30", status: "cont", source: "outlook", customerName: "נועה ברק",
    address: "עמק איילון 12, מודיעין", city: "מודיעין", productName: "מיכל הדחה סמוי", isFollowUp: false, pickup: null, isTest: false,
  },
  {
    req: "48140", n: 3, task: 3, start: "13:00", end: "14:30", status: "done", source: "simulator", customerName: "קבלן ש.ב. בנייה",
    address: "הנשיא 40, יבנה", city: "יבנה", productName: "ברז מטבח פרח", isFollowUp: true, pickup: null, isTest: true,
  },
];
