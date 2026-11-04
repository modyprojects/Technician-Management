// FICTITIOUS DATA ONLY: the demo's service calls. Allowed only under app/dev (G-05).
// A faithful port of docs/demo.html seedCalls() (L351-434): same RNG (mulberry32), same seed
// (20261021), same order of random draws, so names, phones, cities, times and statuses match
// the prototype. Fields the demo lacks (ADD rows in demo-deviations) are filled
// deterministically without drawing random numbers, so the demo's sequence is unchanged.
import "server-only";
import { addDays, fromMin, isWork, pad, TODAY } from "./dates";
import { FIXED_TEXT, PRODUCTS, REASONS, TECHS } from "./reference";
import type { Call, MediaItem, Visit } from "./types";

export const SEED = 20261021;

/** The demo's seeded random generator (mulberry32), copied expression for expression. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["דנה", "משה", "רונית", "אבי", "שרה", "יוסי", "מיכל", "דוד", "נועה", "גיל", "רינה", "אלון", "מרים", "חיים", "ליאת", "עדי", "רון", "תמר", "שלומית", "אורי", "הילה", "בני", "קרן", "עמית"];
const LAST = ["לוי", "כהן", "מזרחי", "פרץ", "ביטון", "דהן", "אברהם", "פרידמן", "אזולאי", "שושן", "רוזן", "גל", "חדד", "נחום", "ברק", "אוחיון", "שלום", "עמר", "מלכה", "סויסה"];
const CITIES: readonly (readonly [string, string])[] = [
  ["רחובות", "הרצל"], ["נס ציונה", "הבנים"], ["ראשון לציון", "רוטשילד"], ["חולון", "סוקולוב"], ["בת ים", "בלפור"],
  ["יבנה", "הנשיא"], ["לוד", "הרצל"], ["רמלה", "ויצמן"], ["מודיעין", "עמק דותן"], ["שוהם", "התאנה"],
];

/** Spare part per SKU (ADD TE-17), matching the demo's pickup items. */
const PART: Record<string, string> = {
  "BT-1120": "מחסנית מפצל BT-1120",
  "KT-2041": "ראש נשלף KT-2041",
  "WC-300": "מנגנון מילוי WC-300",
  "SH-510": "קרטוש תרמוסטטי SH-510",
  "KT-1800": "ידית ברז KT-1800",
  "BS-220": "סיפון BS-220",
};

/** "מה צריך בביקור הבא" per follow-up reason (ADD TE-21). */
const NEXT_NOTE: Record<string, string> = {
  "ממתין לחלקי חילוף": "להביא את החלק שהוזמן מהספק ולהתקין",
  "נדרש ביקור נוסף": "להמשיך את הטיפול ולבדוק שאין נזילה",
  "נדרשת בדיקת מתקין": "לתאם הגעה משותפת עם מתקין",
  "הזמנת מוצר חדש": "להתקין את המוצר החדש כשיגיע",
  "לקוח לא נמצא": "לתאם מראש בטלפון עם הלקוח",
};

/** Fictional customer number (ADD TE-09), unique per request number. */
const customerNo = (req: string): string => String(100000 + ((Number(req) * 7919) % 900000));

const img = (when: MediaItem["when"] = "after"): MediaItem => ({ t: "img", when });
const vid = (when: MediaItem["when"] = "after"): MediaItem => ({ t: "vid", when });

/**
 * Source of the fixture visits (SIM-14): the invitation simulator ("🧪 זימון בדיקה"), because
 * Microsoft 365 is not connected (D23) and every fixture is test data (D47). Calls 48241 and
 * 48251 keep "outlook" as labelled examples of the "📅 נקלט אוטומטית מזימון Outlook" line.
 */
const SOURCE: Visit["source"] = "simulator";

/** The demo's V() defaults, plus the ADD fields. */
function V(o: Partial<Visit> & Pick<Visit, "tech" | "date" | "start" | "end">): Visit {
  return {
    n: 1, task: 1, status: "new", departAt: null, arriveAt: null, endAt: null, summary: "", rec: 0, media: [],
    reason: null, signer: null, collect: "", collectFrom: "",
    transcript: "", parts: [], nextNote: "", signedText: null, source: SOURCE,
    ...o,
  };
}

/** The demo's C() defaults, plus the ADD fields. */
function C(o: Partial<Call> & Pick<Call, "req" | "customer" | "phone" | "city" | "street" | "sku" | "desc" | "visits">): Call {
  return {
    customerNo: customerNo(o.req), phone2: "", building: "", floor: "", apt: "", arrival: "", type: "תיקון",
    warranty: "כן", rep: "שיראל", techNote: "", isTest: true,
    ...o,
  };
}

export function seedCalls(): Call[] {
  const rnd = mulberry32(SEED);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const wpick = <T extends { w: number }>(arr: readonly T[]): T => {
    const tot = arr.reduce((a, x) => a + x.w, 0);
    let r = rnd() * tot;
    for (const x of arr) {
      r -= x.w;
      if (r <= 0) return x;
    }
    return arr[0] as T;
  };

  const calls: Call[] = [];
  let req = 47800;
  // Historical: Oct 1 – Oct 20 (the draws below run in the demo's object-literal order).
  for (let d = "2026-10-01"; d <= "2026-10-20"; d = addDays(d, 1)) {
    if (!isWork(d)) continue;
    for (const t of TECHS) {
      const n = 3 + Math.floor(rnd() * 3);
      let start = 8 * 60;
      for (let i = 0; i < n; i++) {
        const p = wpick(PRODUCTS);
        const [city, st] = pick(CITIES);
        const travel = 20 + Math.floor(rnd() * 22) + (t.id === "e" ? 6 : 0);
        const treat = 30 + Math.floor(rnd() * 32) + (t.id === "e" ? 5 : 0);
        const arrive = start + 15;
        const end = arrive + treat;
        const contP = p.sku === "BT-1120" ? 0.5 : p.sku === "WC-300" ? 0.42 : 0.2;
        const cont = rnd() < contP;
        const reqNo = String(req++);
        const customer = pick(FIRST) + " " + pick(LAST);
        const phone = "05" + Math.floor(rnd() * 9) + "-000-" + pad(Math.floor(rnd() * 99)) + pad(Math.floor(rnd() * 99));
        const street = st + " " + (1 + Math.floor(rnd() * 80));
        const floor = String(Math.floor(rnd() * 6));
        const apt = String(1 + Math.floor(rnd() * 20));
        const type = rnd() < 0.85 ? "תיקון" : "התקנה";
        const desc = pick(p.issues);
        const warranty = rnd() < 0.8 ? "כן" : "לא";
        const rep = rnd() < 0.8 ? "שיראל" : "נציגה 2";
        const reason = cont ? wpick(REASONS).name : null;
        const summary = cont ? "נדרש המשך טיפול, הלקוח עודכן." : "בוצע תיקון, נבדק ותקין.";
        const rec = rnd() < 0.55 ? 20 + Math.floor(rnd() * 60) : 0;
        const media: MediaItem[] = [img(), ...(rnd() < 0.3 ? [vid()] : [])];
        // The fictitious customer signs (the demo's literal "הלקוח" read as a name).
        const signer = cont ? null : customer;
        calls.push({
          req: reqNo, customerNo: customerNo(reqNo), customer, phone, phone2: "", city, street, building: "", floor, apt,
          arrival: "", type, sku: p.sku, desc, warranty, rep, techNote: "", isTest: true,
          visits: [
            {
              n: 1, task: 1, tech: t.id, date: d, start: fromMin(start), end: fromMin(start + 90), status: cont ? "cont" : "done",
              departAt: fromMin(arrive - travel), arriveAt: fromMin(arrive), endAt: fromMin(end), reason, summary, rec, media, signer,
              collect: "", collectFrom: "",
              transcript: rec ? summary : "", parts: [], nextNote: reason ? (NEXT_NOTE[reason] ?? "") : "",
              signedText: signer ? FIXED_TEXT : null, source: SOURCE,
            },
          ],
        });
        start += 105 + Math.floor(rnd() * 20);
      }
    }
  }

  // Close most old follow-ups with a second visit (keeps a few open), as in the demo.
  calls
    .filter((c) => c.visits[0]?.status === "cont" && (c.visits[0]?.date ?? "") < "2026-10-14")
    .forEach((c, i) => {
      if (i % 5 === 0) return;
      const d0 = c.visits[0] as Visit;
      let nd = addDays(d0.date, 3 + (i % 4));
      while (!isWork(nd)) nd = addDays(nd, 1);
      if (nd > "2026-10-20") return;
      c.visits.push(
        V({
          n: 2, task: 2, tech: d0.tech, date: nd, start: "15:30", end: "17:00", status: "done", departAt: "15:02", arriveAt: "15:34",
          endAt: "16:20", summary: "הוחלף החלק, הכל תקין.", media: [img()], signer: c.customer,
          parts: PART[c.sku] ? [PART[c.sku] as string] : [], signedText: FIXED_TEXT,
        }),
      );
    });

  // The demo's hand-written calls for today and tomorrow.
  calls.push(
    C({
      req: "48213", customer: "משפחת לוי", phone: "050-000-1122", city: "רחובות", street: "הרצל 14", building: "א", floor: "3", apt: "9",
      arrival: "חניה בכחול-לבן, אינטרקום 9", sku: "KT-2041", desc: "הברז מטפטף גם כשהוא סגור, הלקוחה מדווחת על רטיבות מתחת לכיור.",
      warranty: "כן · עד 03/2028", techNote: "הלקוחה מבקשת טלפון 10 דקות לפני ההגעה.",
      visits: [V({ task: 2, tech: "y", date: TODAY, start: "09:00", end: "11:00", collect: "ברז מטבח חלופי KT-2041", collectFrom: "מרלוג" })],
    }),
    C({
      req: "48205", customer: "אבי כהן", phone: "052-000-3344", city: "נס ציונה", street: "הבנים 7", floor: "1", apt: "2", arrival: "בית פרטי, שער צהוב",
      sku: "BT-1120", desc: "הברז לא מעביר בין ראש מקלחת לפיה.", warranty: "כן · עד 06/2027",
      visits: [
        V({
          n: 1, task: 2, tech: "s", date: "2026-10-19", start: "10:00", end: "12:00", status: "cont", departAt: "09:32", arriveAt: "10:05", endAt: "10:48",
          reason: "ממתין לחלקי חילוף", summary: "המפצל שבור מבפנים, הוזמנה מחסנית מפצל מהספק. הברז פועל חלקית (פיה בלבד).", rec: 65,
          media: [img("before"), img(), vid()],
          transcript: "פירקתי את הברז. המפצל שבור מבפנים, ולכן המים יוצאים רק מהפיה. הזמנתי מחסנית מפצל מהספק. הסברתי ללקוח שבינתיים אפשר להשתמש בפיה בלבד.",
          nextNote: "להביא מחסנית מפצל BT-1120 ולהחליף. לבדוק מעבר בין ראש המקלחת לפיה.",
        }),
        V({ n: 2, task: 3, tech: "y", date: TODAY, start: "11:30", end: "13:00", collect: "מחסנית מפצל BT-1120", collectFrom: "סניף ראשון לציון" }),
      ],
    }),
    C({
      req: "48240", customer: "רונית מזרחי", phone: "053-000-4455", city: "ראשון לציון", street: "ז׳בוטינסקי 30", sku: "WC-300", desc: "ההדחה לא נעצרת.",
      visits: [V({ tech: "y", date: TODAY, start: "14:00", end: "15:30", collect: "מנגנון מילוי WC-300", collectFrom: "סניף בני ברק" })],
    }),
    C({
      req: "48241", customer: "קבלן ש.ב. בנייה", phone: "08-000-6677", city: "יבנה", street: "הנשיא 5", type: "התקנה", sku: "KT-1800",
      desc: "התקנת 4 ברזים בדירות חדשות.", warranty: "לא", techNote: "לתאם בטלפון עם מנהל העבודה באתר.",
      visits: [V({ tech: "y", date: TODAY, start: "16:00", end: "18:00", source: "outlook" })],
    }),
    C({
      req: "48198", customer: "דוד פרץ", phone: "050-000-8899", city: "חולון", street: "סוקולוב 12", sku: "BS-220", desc: "נזילה מהסיפון.",
      visits: [
        V({
          tech: "e", date: TODAY, start: "08:00", end: "09:30", status: "done", departAt: "07:35", arriveAt: "08:02", endAt: "08:52",
          summary: "הוחלף סיפון, נבדק ללא נזילה.", media: [img("before"), img()], signer: "דוד פרץ", parts: ["סיפון BS-220"], signedText: FIXED_TEXT,
        }),
      ],
    }),
    C({
      req: "48226", customer: "יעל שושן", phone: "054-000-1212", city: "בת ים", street: "בלפור 40", sku: "SH-510", desc: "המים לא מתחממים.",
      visits: [V({ tech: "e", date: TODAY, start: "10:00", end: "11:30", status: "go", departAt: "09:40" })],
    }),
    C({
      req: "48233", customer: "מוטי אזולאי", phone: "052-000-3434", city: "תל אביב", street: "אבן גבירול 88", sku: "WC-300", desc: "נזילה מהמיכל לאסלה.",
      visits: [V({ tech: "e", date: TODAY, start: "13:30", end: "15:30" })],
    }),
    C({
      req: "48190", customer: "נועה ברק", phone: "054-000-7788", city: "מודיעין", street: "עמק דותן 22", sku: "WC-300", desc: "מנגנון המילוי לא נסגר.",
      visits: [
        V({
          tech: "s", date: TODAY, start: "08:00", end: "09:30", status: "cont", departAt: "07:30", arriveAt: "07:58", endAt: "08:40",
          reason: "ממתין לחלקי חילוף", summary: "", rec: 51, media: [img(), img()], nextNote: "להביא מנגנון מילוי WC-300 ולהחליף",
        }),
      ],
    }),
    C({
      req: "48219", customer: "אורן גל", phone: "050-000-5656", city: "שוהם", street: "התאנה 3", sku: "KT-2041", desc: "ראש הנשלף לא חוזר למקום.",
      visits: [V({ tech: "s", date: TODAY, start: "09:40", end: "11:20", status: "work", departAt: "09:20", arriveAt: "09:52" })],
    }),
    C({
      req: "48236", customer: "מרים חדד", phone: "053-000-9090", city: "לוד", street: "הרצל 60", sku: "BT-1120", desc: "טפטוף מהפיה.",
      visits: [V({ tech: "s", date: TODAY, start: "12:30", end: "14:00" })],
    }),
    C({
      req: "48140", customer: "אלון דהן", phone: "052-000-2323", city: "רמלה", street: "ויצמן 15", sku: "SH-510", desc: "המים לא מתחממים במקלחת.",
      visits: [
        V({
          n: 1, tech: "s", date: "2026-10-08", start: "10:00", end: "11:30", status: "cont", departAt: "09:30", arriveAt: "10:02", endAt: "10:55",
          reason: "נדרשת בדיקת מתקין", summary: "צנרת חמה לא תקינה, נדרש מתקין.", nextNote: "לתאם הגעה משותפת עם מתקין",
        }),
        V({
          n: 2, task: 2, tech: "s", date: "2026-10-14", start: "13:00", end: "14:30", status: "cont", departAt: "12:40", arriveAt: "13:05", endAt: "13:50",
          reason: "ממתין לחלקי חילוף", summary: "נבדק עם מתקין, הוזמן קרטוש תרמוסטטי.", nextNote: "להביא קרטוש תרמוסטטי SH-510 ולהתקין",
        }),
        V({ n: 3, task: 3, tech: "s", date: TODAY, start: "15:00", end: "17:00", collect: "קרטוש תרמוסטטי SH-510", collectFrom: "מרלוג" }),
      ],
    }),
    C({
      req: "48251", customer: "מרים אלון", phone: "050-000-4141", city: "רחובות", street: "יעקב 9", sku: "KT-2041", desc: "טפטוף מהברז.",
      visits: [V({ tech: "y", date: "2026-10-22", start: "09:00", end: "10:30", source: "outlook" })],
    }),
    C({
      req: "48252", customer: "דניאל רז", phone: "050-000-5252", city: "נס ציונה", street: "ויצמן 3", sku: "WC-300", desc: "ההדחה חלשה.",
      visits: [V({ tech: "y", date: "2026-10-22", start: "13:00", end: "14:30", source: "simulator" })],
    }),
    C({
      req: "48253", customer: "שלומית סויסה", phone: "054-000-5353", city: "חולון", street: "סוקולוב 40", sku: "BT-1120", desc: "המפצל לא מעביר.",
      visits: [V({ tech: "e", date: "2026-10-22", start: "10:00", end: "11:30", source: "simulator" })],
    }),
  );

  // ADD (not in the demo): a call whose only visit was cancelled, so the calls list and call card
  // can show the service-call status "ממתינה לשיבוץ" (OF-17, D38) and a cancelled visit pill.
  calls.push(
    C({
      req: "48230", customer: "חיים אוחיון", phone: "052-000-6060", city: "בת ים", street: "בלפור 12", floor: "4", apt: "11",
      sku: "KT-1800", desc: "ידית רופפת.", rep: "נציגה 2",
      visits: [V({ tech: "e", date: TODAY, start: "12:00", end: "13:00", status: "cancel" })],
    }),
  );
  return calls;
}

/** All demo service calls (computed once). Treat as read-only; copy into client state to change. */
export const CALLS: readonly Call[] = seedCalls();
