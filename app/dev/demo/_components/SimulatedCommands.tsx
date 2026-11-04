"use client";

// The UI demo's Commands (features/data-access/types): every action is SIMULATED (D53). Nothing
// is saved, uploaded, signed or sent. Inputs are validated like a server would (invalid input
// returns ok: false); valid input returns { ok: true, simulated: true, message } after a short
// artificial delay, and the demo toast shows "פעולה מדומה · לא נשמר" with what would have happened.
// Screens call useCommands() and never this module directly.
import { useMemo, type ReactNode } from "react";
import { cancelReasonError, noteError, requestNumberError, slotError } from "@/features/calls/data/validate";
import { CommandsProvider } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import type { Commands } from "@/features/data-access/types";
import type { VisitRef } from "@/features/visits/data/types";
import {
  closeVisitError,
  mediaError,
  mediaIdError,
  partsError,
  recordingError,
  summaryError,
  visitRefError,
} from "@/features/visits/data/validate";
import { SIMULATED_TITLE, useSimulate } from "./DemoToast";

/** Short artificial delay so pending states are visible, as with a real request. */
const DELAY_MS = 250;

/** Error for input that a validator could not even read (missing or of the wrong type). */
const INVALID_INPUT = "קלט לא תקין";

const excerpt = (s: string, max = 60): string => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

const visitLabel = (ref: VisitRef): string => `פנייה ${ref.req} · ביקור ${ref.n}`;

const recLabel = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export function SimulatedCommandsProvider({ children }: { children: ReactNode }) {
  const simulate = useSimulate();

  const commands = useMemo<Commands>(() => {
    /**
     * Validates, waits, shows the demo toast and returns the simulated result. Validation, the
     * toast text and the data are built lazily, in that order, so malformed or missing input
     * (possible from untyped callers) returns { ok: false } instead of throwing.
     */
    async function run<T = void>(
      validate: () => (string | null)[],
      detail: () => string,
      data?: () => T,
    ): Promise<CommandResult<T>> {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      let error: string | null;
      let text = "";
      let value: T | undefined;
      try {
        error = validate().find((e) => e !== null) ?? null;
        if (!error) {
          text = detail();
          value = data?.();
        }
      } catch {
        error = INVALID_INPUT;
      }
      if (error) {
        simulate(`לא בוצע: ${error}`);
        return { ok: false, simulated: true, error };
      }
      simulate(text);
      return value === undefined
        ? { ok: true, simulated: true, message: SIMULATED_TITLE }
        : { ok: true, simulated: true, message: SIMULATED_TITLE, data: value };
    }

    return {
      calls: {
        reschedule: (ref, slot) =>
          run(
            () => [visitRefError(ref), slotError(slot)],
            () =>
              `שינוי מועד לביקור ${ref.n} · פנייה ${ref.req}${slot ? ` · ${slot.date} ${slot.start}–${slot.end}` : ""} · בפועל המועד משתנה בזימון ב-Outlook`,
          ),
        addNote: (req, text) =>
          run(
            () => [requestNumberError(req), noteError(text)],
            () => `הערה לפנייה ${req}: ${excerpt(text)}`,
          ),
        cancelVisit: (ref, input) =>
          run(
            () => [visitRefError(ref), cancelReasonError(input?.reason)],
            () => `ביטול ביקור ${ref.n} · פנייה ${ref.req}`,
          ),
      },
      visits: {
        depart: (ref) =>
          run(
            () => [visitRefError(ref)],
            () => `יציאה ללקוח · ${visitLabel(ref)} · הסטטוס היה משתנה ל"בדרך"`,
          ),
        arrive: (ref) =>
          run(
            () => [visitRefError(ref)],
            () => `הגעה ללקוח · ${visitLabel(ref)} · הסטטוס היה משתנה ל"בטיפול"`,
          ),
        saveSummary: (ref, text) =>
          run(
            () => [visitRefError(ref), summaryError(text)],
            () => `שמירת סיכום · ${visitLabel(ref)}`,
          ),
        addMedia: (ref, input) =>
          run(
            () => [visitRefError(ref), mediaError(input)],
            () =>
              `${input.kind === "vid" ? "סרטון" : "תמונה"} ${input.when === "before" ? "לפני" : "אחרי"} הטיפול · ${visitLabel(ref)} · לא הועלה`,
            () => ({
              media: { id: `sim-${ref.req}-${ref.n}-${Date.now()}`, kind: input.kind, when: input.when, isTest: true },
            }),
          ),
        removeMedia: (ref, mediaId) =>
          run(
            () => [visitRefError(ref), mediaIdError(mediaId)],
            () => `הסרת קובץ · ${visitLabel(ref)}`,
          ),
        saveRecording: (ref, input) =>
          run(
            () => [visitRefError(ref), recordingError(input?.seconds)],
            () => `הקלטה ${recLabel(input.seconds)} · ${visitLabel(ref)} · לא הועלתה`,
          ),
        deleteRecording: (ref) =>
          run(
            () => [visitRefError(ref)],
            () => `מחיקת הקלטה · ${visitLabel(ref)}`,
          ),
        saveParts: (ref, parts) =>
          run(
            () => [visitRefError(ref), partsError(parts)],
            () => `חלפים (${parts.length}) · ${visitLabel(ref)}`,
          ),
        close: (ref, input) =>
          run(
            () => [visitRefError(ref), closeVisitError(input)],
            () =>
              input.outcome === "done"
                ? `סיום ביקור · טופל · נחתם ע"י ${excerpt(input.signerName ?? "", 40)} · ${visitLabel(ref)} · לא נשלח מייל`
                : `סיום ביקור · המשך טיפול – ${input.reason ?? ""} · ${visitLabel(ref)} · לא נשלח מייל`,
          ),
      },
    };
  }, [simulate]);

  return <CommandsProvider commands={commands}>{children}</CommandsProvider>;
}
