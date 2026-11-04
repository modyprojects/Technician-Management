import { DEVICE_SYNC_PROGRESSION, type DeviceSyncState } from "@/features/sync/data/types";
import { SyncPill } from "./SyncPill";

// The close confirmation's sync progression (TE-23 CHANGE): instead of the demo's "נשלח מייל
// לשירות הלקוחות", the steps a closure goes through on its way to the server, "נשמר במכשיר" →
// "ממתין לסנכרון" → "מסתנכרן" → "נשלח לשרת", and that the completion email goes out only after
// the server accepted the closure (EM-05, D09 recipients). A failed send stays on the device with
// "נסה שוב" (TE-24, D46).
// `reached` is the step the closure reached as the close command reported it; null when no step
// was performed (a simulated close), so no step is shown as done. A new element in the demo's
// language (numbered list, .pill), pending the owner's visual approval. Presentational.

const STEP_TEXT: Readonly<Record<DeviceSyncState, string>> = {
  "saved-on-device": "הסיום והקבצים נשמרים בטלפון.",
  pending: "ממתינים לשליחה, למשל עד שיש קליטה.",
  syncing: "נשלחים לשרת עכשיו.",
  sent: "השרת אישר שקיבל הכל.",
  failed: "השליחה נכשלה. הפריט נשאר בטלפון.",
};

export function SyncProgression({ reached, caption }: { reached: DeviceSyncState | null; caption?: string }) {
  const at = reached ? DEVICE_SYNC_PROGRESSION.indexOf(reached) : -1;
  return (
    <section className="sy-steps-box" aria-labelledby="sy-steps-title">
      <h3 id="sy-steps-title" className="sy-steps-title">
        מה קורה עם הסיום
      </h3>
      {caption && <div className="sub">{caption}</div>}
      <ol className="sy-steps">
        {DEVICE_SYNC_PROGRESSION.map((state, i) => {
          const done = at >= 0 && i <= at;
          return (
            <li key={state} className={done ? "sy-step sy-step-done" : "sy-step"} aria-current={i === at ? "step" : undefined}>
              <span className="sy-step-n num" aria-hidden="true">
                {done ? "✓" : i + 1}
              </span>
              <span className="sy-step-body">
                <SyncPill state={state} />
                <span className="sub">{STEP_TEXT[state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="sub">
        מייל הסיום יוצא למנהל ולתיבת שירות הלקוחות רק אחרי שהשרת מקבל את הסיום עם סיכום מאושר. אם השליחה נכשלת, הסיום נשאר בטלפון ומופיע במסך
        היום עם &quot;נסה שוב&quot;.
      </div>
    </section>
  );
}
