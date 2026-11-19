// Skeleton fixture of the technician visit flow (D81, D88 module 2): fake, fixed data only, read on
// the server by the skeleton pages under /tech/visit/skeleton. No database, no commands, no
// persistence. Every record is fictional and test-marked (D47, D74). The real flow replaces this
// file with the visit DTOs and the Migration 7 writers once the owner approves the skeleton.
import type { VisitStatus } from "@/features/visits/data/types";

/** One fake visit per state the flow shows. The key is the fixture's own id, never a database id. */
export const SKELETON_KEYS = ["scheduled", "en-route", "in-progress", "closed-done", "closed-cont"] as const;
export type SkeletonKey = (typeof SKELETON_KEYS)[number];

export type SkeletonPhoto = { id: string; label: string };

export type SkeletonClosed = {
  summary: string;
  photos: { before: readonly SkeletonPhoto[]; after: readonly SkeletonPhoto[] };
} & ({ outcome: "done"; signer: string; approvalText: string } | { outcome: "cont"; reason: string; nextNote: string });

export type SkeletonVisit = {
  key: SkeletonKey;
  status: VisitStatus;
  req: string;
  task: number;
  n: number;
  start: string;
  end: string;
  customer: string;
  street: string;
  city: string;
  phone: string;
  rep: { name: string; phone: string | null };
  product: string;
  sku: string;
  problem: string;
  techNote: string;
  isTest: true;
  closed?: SkeletonClosed;
};

/**
 * The fixed result of "יוצא · Waze" in the skeleton: the departure is never recorded, so the screen
 * always shows the D71 failure state (status not updated, "נסה שוב", "פתח Waze בכל זאת"). The
 * success path is the "en-route" visit.
 */
export const SKELETON_DEPARTURE_RESULT = "offline" as const;

/** The "טופל" text above the signature (fixed text, D43: preserved with each signature). */
export const SKELETON_APPROVAL_TEXT = "קריאת השירות טופלה לשביעות רצון הלקוח";

/** Follow-up reasons as Settings would list them. */
export const SKELETON_REASONS = ["ממתין לחלקי חילוף", "נדרש ביקור נוסף", "נדרשת בדיקת מתקין", "הזמנת מוצר חדש", "לקוח לא נמצא"] as const;

/** Photos already taken on the in-progress visit (fake tiles, no image). */
export const SKELETON_WORK_PHOTOS: { before: readonly SkeletonPhoto[]; after: readonly SkeletonPhoto[] } = {
  before: [{ id: "b1", label: "תמונה 1 · לפני הטיפול" }],
  after: [],
};

const base = {
  rep: { name: "שיראל", phone: "050-000-0102" },
  isTest: true,
} as const;

const VISITS: readonly SkeletonVisit[] = [
  {
    ...base,
    key: "scheduled",
    status: "new",
    req: "70412",
    task: 1,
    n: 1,
    start: "13:00",
    end: "14:30",
    customer: "דפוס אלון",
    street: "התעשייה 4",
    city: "נשר",
    phone: "050-123-4567",
    product: "מדפסת תעשייתית",
    sku: "PR-2200",
    problem: "המדפסת עוצרת באמצע עבודה ומציגה שגיאת חום",
    techNote: "חניה מאחורי הבניין, כניסה דרך המחסן",
  },
  {
    ...base,
    key: "en-route",
    status: "go",
    req: "70388",
    task: 1,
    n: 1,
    start: "11:00",
    end: "12:00",
    customer: "קליניקת שמש",
    street: "הרצל 8",
    city: "קריית אתא",
    phone: "050-765-4321",
    product: "מזגן מרכזי",
    sku: "AC-900",
    problem: "המזגן מטפטף מהיחידה הפנימית",
    techNote: "",
  },
  {
    ...base,
    key: "in-progress",
    status: "work",
    req: "70355",
    task: 2,
    n: 1,
    start: "09:30",
    end: "10:30",
    customer: "מאפיית הגליל",
    street: "הנמל 12",
    city: "חיפה",
    phone: "050-222-3333",
    product: "מכונת קפה",
    sku: "CF-310",
    problem: "המכונה לא מחממת מים",
    techNote: "לתאם עם מנהל המשמרת",
  },
  {
    ...base,
    key: "closed-done",
    status: "done",
    req: "70301",
    task: 1,
    n: 1,
    start: "08:00",
    end: "09:00",
    customer: "משרדי נוף",
    street: "מוריה 90",
    city: "חיפה",
    phone: "050-444-5555",
    product: "מערכת אזעקה",
    sku: "AL-120",
    problem: "חיישן בכניסה לא מגיב",
    techNote: "",
    closed: {
      outcome: "done",
      summary: "הוחלף חיישן תנועה בכניסה, נבדקה המערכת כולה והכול תקין.",
      signer: "רונית כהן",
      approvalText: SKELETON_APPROVAL_TEXT,
      photos: {
        before: [{ id: "b1", label: "תמונה 1 · לפני הטיפול" }],
        after: [
          { id: "a1", label: "תמונה 1 · אחרי הטיפול" },
          { id: "a2", label: "תמונה 2 · אחרי הטיפול" },
        ],
      },
    },
  },
  {
    ...base,
    key: "closed-cont",
    status: "cont",
    req: "70290",
    task: 1,
    n: 1,
    start: "15:00",
    end: "16:00",
    customer: "סופר הצפון",
    street: "ויצמן 31",
    city: "עכו",
    phone: "050-666-7777",
    product: "מקרר תעשייתי",
    sku: "RF-450",
    problem: "המקרר לא מגיע לטמפרטורה",
    techNote: "",
    closed: {
      outcome: "cont",
      summary: "המדחס תקין, נמצאה דליפה בצנרת. נדרש חלק שאינו במלאי.",
      reason: "ממתין לחלקי חילוף",
      nextNote: "להביא צינור נחושת 3/8 ולהחליף את הקטע הדולף",
      photos: { before: [], after: [{ id: "a1", label: "תמונה 1 · אחרי הטיפול" }] },
    },
  },
];

/** The fake visit of a key, or null for anything else. */
export function skeletonVisit(key: string): SkeletonVisit | null {
  return VISITS.find((v) => v.key === key) ?? null;
}

export const skeletonVisits = (): readonly SkeletonVisit[] => VISITS;

export const SKELETON_BASE_PATH = "/tech/visit/skeleton";
export const skeletonPath = (key: SkeletonKey, step?: "work" | "close"): string =>
  `${SKELETON_BASE_PATH}/${key}${step ? `/${step}` : ""}`;

/** "מס׳ פנייה 70412 · משימה 1 · ביקור 1". */
export const skeletonMeta = (v: SkeletonVisit): string => `מס׳ פנייה ${v.req} · משימה ${v.task} · ביקור ${v.n}`;
