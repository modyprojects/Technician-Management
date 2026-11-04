"use client";

// The UI demo's Commands (features/data-access/types): every action is SIMULATED (D53). Nothing
// is saved, uploaded, signed or sent. Inputs are validated like a server would (invalid input
// returns ok: false); valid input returns { ok: true, simulated: true, message } after a short
// artificial delay, and the demo toast shows "פעולה מדומה · לא נשמר" with what would have happened.
// Screens call useCommands() and never this module directly.
import { useMemo, type ReactNode } from "react";
import { ACCOUNT_REQUEST_KIND_LABELS, ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import {
  accountDecisionError,
  accountIdError,
  accountRequestError,
  newAccountError,
  newTechnicianError,
  requestIdError,
} from "@/features/accounts/data/validate";
import { cancelReasonError } from "@/features/calls/data/validate";
import { CommandsProvider } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import type { Commands } from "@/features/data-access/types";
import { notificationIdsError, notificationPreferencesError } from "@/features/notifications/data/validate";
import { PERMISSION_LABELS, TECH_NOTIFICATION_LABELS } from "@/features/settings/data/types";
import {
  activeFlagError,
  fixedTextError,
  newPlaceError,
  setPermissionError,
  settingIdError,
  settingNameError,
  techNotificationError,
  technicianIdError,
  templateLabelRequiredError,
} from "@/features/settings/data/validate";
import type { VisitRef } from "@/features/visits/data/types";
import {
  closeVisitError,
  mediaError,
  mediaIdError,
  partsError,
  pickupCollectedError,
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

const onOff = (on: boolean): string => (on ? "פועל" : "כבוי");

/** A simulated id for something a command would have created (nothing is stored). */
const simId = (prefix: string): string => `sim-${prefix}-${Date.now()}`;

/**
 * What the server would check against stored data, for the demo's fixtures (read through the
 * data-access layer by app/dev/demo/layout.tsx): references that forbid a delete, request and
 * account states. The real server checks these itself, under the caller's session.
 */
export type SimulatedServerState = {
  /** Pickup places that are referenced (deactivate only, SE-06). */
  placesInUse: readonly string[];
  /** Follow-up reasons that were used (deactivate only, SE-07). */
  reasonsInUse: readonly string[];
  /** Account requests that can still be decided or cancelled (D34). */
  pendingRequestIds: readonly string[];
  activeAccountIds: readonly string[];
  inactiveAccountIds: readonly string[];
};

export function SimulatedCommandsProvider({ state, children }: { state: SimulatedServerState; children: ReactNode }) {
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
        // OF-09 PENDING (d08): no screen calls this yet (the call card shows a disabled placeholder).
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
            () => `יציאה ללקוח · ${visitLabel(ref)} · הסטטוס היה משתנה ל"בדרך" · Waze לא נפתח בהדגמה`,
          ),
        arrive: (ref) =>
          run(
            () => [visitRefError(ref)],
            () => `הגעה ללקוח · ${visitLabel(ref)} · הסטטוס היה משתנה ל"בטיפול"`,
          ),
        setPickupCollected: (ref, collected) =>
          run(
            () => [visitRefError(ref), pickupCollectedError(collected)],
            () => `${collected ? "סימון נאסף" : "ביטול סימון נאסף"} · ${visitLabel(ref)}`,
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
      notifications: {
        markRead: (ids) =>
          run(
            () => [notificationIdsError(ids)],
            () => (ids.length === 1 ? "סימון התראה כנקראה" : `סימון ${ids.length} התראות כנקראו`),
          ),
        markAllRead: () =>
          run(
            () => [],
            () => "סימון כל ההתראות כנקראו",
          ),
        setPreferences: (prefs) =>
          run(
            () => [notificationPreferencesError(prefs)],
            () =>
              `הגדרות התראות · זימון חדש או שינוי ביומן: ${prefs.newOrChange ? "פועל" : "כבוי"} · צליל התראה: ${prefs.sound ? "פועל" : "כבוי"}`,
          ),
      },
      settings: {
        setPermission: (role, key, value) =>
          run(
            () => [setPermissionError(role, key, value)],
            () =>
              `מטריצת הרשאות · ${PERMISSION_LABELS[key].label} · ${ACCOUNT_ROLE_LABELS[role]}: ${onOff(value)} · ערך זמני עד אישור הבעלים`,
          ),
        setTechnicianActive: (techId, active) =>
          run(
            () => [technicianIdError(techId), activeFlagError(active)],
            () => (active ? "טכנאי פעיל · יקבל זימונים חדשים" : "טכנאי לא פעיל · לא יקבל זימונים חדשים, ההיסטוריה נשמרת"),
          ),
        addPlace: (input) =>
          run(
            () => [newPlaceError(input)],
            () => `הוספת מקום איסוף · ${excerpt(input.name, 40)}`,
            () => ({ id: simId("place") }),
          ),
        setPlaceActive: (id, active) =>
          run(
            () => [settingIdError(id), activeFlagError(active)],
            () => `מקום איסוף · ${active ? "פעיל" : "לא פעיל"}`,
          ),
        deletePlace: (id) =>
          run(
            () => [settingIdError(id), state.placesInUse.includes(id) ? "המקום בשימוש: אפשר רק לכבות אותו" : null],
            () => "מחיקת מקום איסוף",
          ),
        addReason: (name) =>
          run(
            () => [settingNameError(name, "שם הסיבה")],
            () => `הוספת סיבת המשך טיפול · ${excerpt(name, 40)}`,
            () => ({ id: simId("reason") }),
          ),
        setReasonActive: (id, active) =>
          run(
            () => [settingIdError(id), activeFlagError(active)],
            () => `סיבת המשך טיפול · ${active ? "פעילה" : "לא פעילה"}`,
          ),
        deleteReason: (id) =>
          run(
            () => [settingIdError(id), state.reasonsInUse.includes(id) ? "הסיבה בשימוש: אפשר רק לכבות אותה" : null],
            () => "מחיקת סיבת המשך טיפול",
          ),
        setFixedText: (text) =>
          run(
            () => [fixedTextError(text)],
            () => "נוסח \"טופל\" חדש · חתימות קודמות שומרות את הנוסח שנחתם",
            () => ({ versionId: simId("approval-text") }),
          ),
        addCallType: (name) =>
          run(
            () => [settingNameError(name, "שם סוג הקריאה")],
            () => `הוספת סוג קריאה · ${excerpt(name, 40)}`,
            () => ({ id: simId("type") }),
          ),
        setCallTypeActive: (id, active) =>
          run(
            () => [settingIdError(id), activeFlagError(active)],
            () => `סוג קריאה · ${active ? "פעיל" : "לא פעיל"}`,
          ),
        setTechNotification: (key, on) =>
          run(
            () => [techNotificationError(key, on)],
            () => `התראה לטכנאי · ${TECH_NOTIFICATION_LABELS[key]}: ${onOff(on)} · באפליקציה בלבד`,
          ),
        setTemplateLabelRequired: (key, required) =>
          run(
            () => [templateLabelRequiredError(key, required)],
            () => `תבנית זימון · שדה ${required ? "חובה" : "רשות"}`,
          ),
      },
      accounts: {
        createAccount: (input) =>
          run(
            () => [newAccountError(input)],
            () => `יצירת חשבון ${ACCOUNT_ROLE_LABELS[input.role]} · ${excerpt(input.name, 40)} · לא נוצר משתמש`,
            () => ({ accountId: simId("account") }),
          ),
        requestAccount: (input) =>
          run(
            () => [accountRequestError(input)],
            () => `בקשה לאישור היוצר · ${ACCOUNT_REQUEST_KIND_LABELS[input.kind]} · שום דבר לא משתנה עד האישור`,
            () => ({ requestId: simId("request") }),
          ),
        decideAccountRequest: (requestId, decision) =>
          run(
            () => [
              requestIdError(requestId),
              accountDecisionError(decision),
              state.pendingRequestIds.includes(requestId) ? null : "הבקשה כבר לא ממתינה להחלטה",
            ],
            () =>
              decision.outcome === "approve"
                ? "אישור הבקשה · החשבון לא השתנה"
                : `דחיית הבקשה · סיבה: ${excerpt(decision.reason)}`,
          ),
        cancelAccountRequest: (requestId) =>
          run(
            () => [requestIdError(requestId), state.pendingRequestIds.includes(requestId) ? null : "הבקשה כבר לא ממתינה להחלטה"],
            () => "ביטול הבקשה",
          ),
        deactivateAccount: (accountId) =>
          run(
            () => [
              accountIdError(accountId),
              state.activeAccountIds.includes(accountId)
                ? null
                : state.inactiveAccountIds.includes(accountId)
                  ? "החשבון כבר לא פעיל"
                  : "החשבון לא נמצא",
            ],
            () => "השבתת חשבון · מיידית · היוצר מקבל התראה באפליקציה",
          ),
        activateAccount: (accountId) =>
          run(
            () => [
              accountIdError(accountId),
              state.inactiveAccountIds.includes(accountId)
                ? null
                : state.activeAccountIds.includes(accountId)
                  ? "החשבון כבר פעיל"
                  : "החשבון לא נמצא",
            ],
            () => "הפעלת חשבון",
          ),
        createTechnician: (input) =>
          run(
            () => [newTechnicianError(input)],
            () => `הוספת טכנאי · ${excerpt(input.name, 40)} · לא נוצר משתמש`,
            () => ({ accountId: simId("account") }),
          ),
      },
    };
  }, [simulate, state]);

  return <CommandsProvider commands={commands}>{children}</CommandsProvider>;
}
