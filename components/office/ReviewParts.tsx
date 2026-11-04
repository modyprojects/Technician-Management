import { INVITATION_SOURCE_LABELS } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import {
  REVIEW_STATUS_LABELS,
  type ReviewDecision,
  type ReviewFieldChoice,
  type ReviewItemSummary,
  type ReviewKind,
  type ReviewSource,
  type ReviewStatus,
  type ReviewValue,
} from "@/features/review/data/types";

// Shared pieces of "פריטים לבדיקה" (the list and the item view; D39, D43, D44, D45). docs/demo.html
// has no such screen, so they are new visual elements in its language (.pill, .sub, .note): the
// item status, who may decide, where the item came from, a field value (text, list or not set)
// and what each kind means. Server-safe: no hooks, no data. Product text only: decision codes stay
// in comments (phase F review F2); demo-only lines come from the page as props.

/** "🧪 זימון בדיקה" (SIM-14, one label map in TestBadge) or "📱 מהמכשיר של יורם". */
export function reviewSourceText(source: ReviewSource): string {
  return source.kind === "invitation" ? INVITATION_SOURCE_LABELS[source.source] : `📱 מהמכשיר של ${source.technician.name}`;
}

/**
 * Column names of the three versions of a field (D44: per-field base values). `current` is the
 * system's value when the item was stored (version B), `incoming` the submitted one (version A).
 */
export type ReviewVersionLabels = { base: string; current: string; incoming: string };

export function reviewVersionLabels(source: ReviewSource): ReviewVersionLabels {
  return source.kind === "invitation"
    ? { base: "בזימון הקודם", current: "במערכת", incoming: "בזימון החדש" }
    : { base: "כשהמכשיר התחיל", current: "במערכת", incoming: "מהמכשיר" };
}

/** What a per-field choice does, in the form's result and on a resolved item (one wording). */
export function reviewChoiceText(choice: ReviewFieldChoice, labels: ReviewVersionLabels): string {
  return choice === "current" ? "נשאר הערך במערכת" : `הוחלה הגרסה ${labels.incoming}`;
}

/**
 * What each kind means, as the item view explains it (D39 for invitations, D44 for device
 * submissions, D43 approval text, D45 field times). The codes stay out of the visible text.
 */
export const REVIEW_KIND_EXPLANATIONS: Readonly<Record<ReviewKind, string>> = {
  // D39 (amends IN-06 and SIM-03): a visit already en route or in progress.
  reassignment:
    "הזימון השתנה אחרי שהביקור כבר יצא לדרך או התחיל. החלפת טכנאי, ביטול או מחיקה, ושינוי לקוח, כתובת או מק״ט לא מוחלים אוטומטית על ביקור שבדרך או בטיפול: הם ממתינים להחלטה כאן.",
  cancellation:
    "הזימון בוטל או נמחק אחרי שהביקור כבר יצא לדרך או התחיל. ביטול או מחיקה של ביקור שבדרך או בטיפול לא מוחלים אוטומטית: הם ממתינים להחלטה כאן.",
  "address-change":
    "כתובת הביקור השתנתה בזימון אחרי שהביקור כבר יצא לדרך או התחיל. שינוי כתובת בביקור שבדרך או בטיפול לא מוחל אוטומטית: הוא ממתין להחלטה כאן.",
  // D39: call-level identity changes.
  "customer-change":
    "בקריאה קיימת הגיע מספר לקוח אחר, או שם לקוח אחר לאותו מספר לקוח. פרטי הזיהוי של הלקוח וההיסטוריה שלו לא נדרסים בשקט: השינוי מוחל רק אחרי החלטה כאן.",
  "sku-change":
    "בקריאה קיימת הגיע מק״ט אחר. זהות המוצר וההיסטוריה שלו לא נדרסות בשקט: השינוי מוחל רק אחרי החלטה כאן.",
  // D44: conflicts with a device submission.
  "edit-conflict":
    "המכשיר שלח שינוי שמתנגש עם מה שנשמר במערכת. כל שדה מוצג עם הערך שהמכשיר התחיל ממנו: שדה ששינה רק צד אחד ממוזג אוטומטית כשזה בטוח (בביקור שנסגר במערכת אין מיזוג אוטומטי), ושדה ששני הצדדים שינו דורש החלטה מפורשת. ההגשה מהמכשיר נשמרת גם אם היא נדחית.",
  "closure-of-cancelled-visit":
    "המשרד ביטל את הביקור, והמכשיר שלח אחר כך סגירה שלו. הביטול עומד בינתיים; הסגירה, הסיכום והמדיה שנשלחו נשמרים כאן ולא נמחקים. אם הסגירה מתקבלת, מייל הסיום נכנס לתור הדואר פעם אחת בלבד.",
  // D43: the approval text preserved at signing.
  "approval-text-mismatch":
    "נוסח האישור שנשלח עם החתימה לא תואם גרסה שמורה. הנוסח שנחתם נשמר כפי שהוא ולעולם לא מוחלף בנוסח הנוכחי מההגדרות.",
  // D45: device-reported field times.
  "duplicate-time-report":
    "המכשיר דיווח שוב על אותה שעת שטח. הדיווח המקורי לא נדרס; כל תיקון נשמר כרשומה חדשה ומתועדת.",
};

/** Invitation items (D39): what an invitation never does, and what it applied by itself. */
export const INVITATION_REVIEW_RULE =
  "שינויים לא קריטיים מאותו זימון (שעה, הערות לטכנאי, הערות הגעה) מוחלים מיד עם התראה. זימון אף פעם לא משנה ביקור סגור.";

/** Every item (D44): both versions are kept. */
export const BOTH_VERSIONS_RULE = "שתי הגרסאות נשמרות עם הפריט, גם אחרי ההחלטה. שום ערך לא נדרס בשקט.";

/** Items that change a server-closed or cancelled visit (D14, D44; a fixed capability, D33). */
export const CLOSED_VISIT_RULE = "החלטה בפריט הזה משנה ביקור שנסגר במערכת או שבוטל: מנהל או יוצר בלבד, עם הערת החלטה שנשמרת ביומן הביקורת.";

/** How a decision works for this item (shown under each option of the form). */
export function reviewDecisionHint(decision: ReviewDecision, item: Pick<ReviewItemSummary, "kind" | "source">): string {
  const device = item.source.kind === "device";
  if (item.kind === "closure-of-cancelled-visit") {
    // What accepting the closure does to the visit's status is part of open decision #5: not claimed.
    return decision === "apply-incoming"
      ? "הסגירה מהמכשיר מתקבלת: התיעוד והמדיה מצורפים לביקור, ומייל הסיום נכנס לתור הדואר פעם אחת בלבד. מצב הביקור אחרי ההחלטה ממתין להחלטת בעלים."
      : "הביטול עומד. הסגירה והמדיה נשמרות עם הפריט ולא נמחקות.";
  }
  switch (decision) {
    case "apply-incoming":
      return device
        ? "הגרסה מהמכשיר מוחלת. הערך שהיה במערכת נשמר בהיסטוריה."
        : "הערך מהזימון החדש מוחל. הערך הקודם נשמר בהיסטוריה.";
    case "keep-current":
      return device
        ? "הערך במערכת נשאר. ההגשה מהמכשיר נשמרת עם הפריט ולא נמחקת."
        : "הערך במערכת נשאר. הזימון החדש נשמר עם הפריט.";
    case "per-field":
      return "בוחרים לכל שדה איזו גרסה נשארת. שדה ששינה רק צד אחד מסומן מראש לגרסה שהשתנתה.";
  }
}

// "הוחלט" uses its own colours (the accent tint), not the visit status "טופל"'s green, so the item
// status and the visit status next to it never read as one.
const STATUS_STYLE: Readonly<Record<ReviewStatus, { background: string; color: string }>> = {
  open: { background: "var(--s-work-bg)", color: "var(--s-work-fg)" },
  resolved: { background: "var(--accent-l)", color: "var(--accent-d)" },
};

/** "פתוח" / "הוחלט". */
export function ReviewStatusPill({ status }: { status: ReviewStatus }) {
  return (
    <span className="pill" style={STATUS_STYLE[status]}>
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

/** Marks an item that only the Manager or the Creator may decide (D14 cases). */
export function ReviewClosedVisitPill() {
  return (
    <span className="pill rv-auth" title={CLOSED_VISIT_RULE}>
      <span aria-hidden="true">🔒 </span>
      מנהל או יוצר בלבד
    </span>
  );
}

/** "ממתין מהיום", "ממתין יום אחד", "ממתין 3 ימים". */
export function reviewWaitingLabel(days: number): string {
  if (days <= 0) return "ממתין מהיום";
  if (days === 1) return "ממתין יום אחד";
  return `ממתין ${days} ימים`;
}

/** Formats server times for the screen (the page passes its Asia/Jerusalem formatter, G-01). */
export type ReviewTimeLabel = (iso: IsoTimestamp) => string;

/** A field value: text, a list (parts, media) or not set. Untrusted text is plain text only. */
export function ReviewValueText({ value }: { value: ReviewValue }) {
  if (value === null) return <span className="rv-none">לא הוגדר</span>;
  if (typeof value === "string") return value.trim() ? <bdi className="rv-text">{value}</bdi> : <span className="rv-none">ריק</span>;
  if (value.length === 0) return <span className="rv-none">אין</span>;
  return (
    <ul className="rv-vlist">
      {value.map((x, i) => (
        <li key={i}>
          <bdi>{x}</bdi>
        </li>
      ))}
    </ul>
  );
}

/** One line of a value for a compact choice ("מנגנון המילוי לא נסגר…"). */
export function reviewValueExcerpt(value: ReviewValue, max = 60): string {
  if (value === null) return "לא הוגדר";
  const text = typeof value === "string" ? value.trim() : value.join(", ");
  if (!text) return typeof value === "string" ? "ריק" : "אין";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
