// What the close form still needs (docs/demo.html techClose() `ready` and updateSend(), L598 and
// L718-721), plus the work-screen requirements, because the close screen is its own address and
// can be opened before the work is ready. TE-21 (ADD): "מה צריך בביקור הבא" is required for
// "המשך טיפול".
import { workReady, type VisitDraft } from "./WorkDraft";

/** Missing close-form fields, in screen order. */
export function closeFieldsMissing(d: VisitDraft): string[] {
  const k = d.close;
  if (k.outcome === "done") {
    return [!k.signer.trim() && "שם החותם", !k.signature && "חתימת הלקוח"].filter((x): x is string => Boolean(x));
  }
  if (k.outcome === "cont") {
    return [!k.reason && "סיבה", !k.nextNote.trim() && "מה צריך בביקור הבא"].filter((x): x is string => Boolean(x));
  }
  return [];
}

/** True when the form can be sent. */
export function closeReady(d: VisitDraft): boolean {
  return d.close.outcome !== null && workReady(d) && closeFieldsMissing(d).length === 0;
}

/** "חסר: שם החותם", "חסרים: שם החותם וחתימת הלקוח". */
function missingText(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return `חסר: ${items[0]}`;
  return `חסרים: ${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
}

/** The hint under the send button; "" before an outcome is chosen (the button says "בחר תוצאה"). */
export function closeHint(d: VisitDraft): string {
  if (!d.close.outcome) return "";
  const parts = [missingText(closeFieldsMissing(d)), workReady(d) ? "" : "פרטי הטיפול לא הושלמו"].filter(Boolean);
  return parts.length ? parts.join(" · ") : "אפשר לשלוח";
}
