"use client";

// The UI demo's Commands (features/data-access/types): every action is SIMULATED (D53). Nothing
// is saved, uploaded, signed or sent. Inputs are validated like a server would (invalid input
// returns ok: false); valid input returns { ok: true, simulated: true, message } after a short
// artificial delay, and the demo toast shows "פעולה מדומה · לא נשמר" with what would have happened.
// Screens call useCommands() and never this module directly.
import { useMemo, type ReactNode } from "react";
import {
  ACCOUNT_REQUEST_KIND_LABELS,
  ACCOUNT_ROLE_LABELS,
  type AccountRef,
  type AccountRequest,
  type AccountRequestStatus,
  type AccountRole,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  accountDecisionError,
  accountIdError,
  accountRequestError,
  accountRequestTargetError,
  accountStateError,
  newAccountError,
  newTechnicianError,
  pendingRequestError,
  requestIdError,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import { cancelReasonError } from "@/features/calls/data/validate";
import { CommandsProvider } from "@/features/data-access/commands-context";
import { ownValue, type CommandResult } from "@/features/data-access/common";
import type { Commands } from "@/features/data-access/types";
import { notificationIdsError, notificationPreferencesError } from "@/features/notifications/data/validate";
import { productEditError } from "@/features/products/data/validate";
import { technicianColorCss } from "@/features/reference/data/types";
import { PERMISSION_LABELS, TECH_NOTIFICATION_LABELS, type TechnicianSetting } from "@/features/settings/data/types";
import {
  activeFlagError,
  fixedTextError,
  newPlaceError,
  placeDeleteError,
  reasonDeleteError,
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

let simSeq = 0;

/** A simulated id for something a command would have created (nothing is stored). */
const simId = (prefix: string): string => `sim-${prefix}-${Date.now()}-${++simSeq}`;

const NO_ACCOUNT: AccountRef = { id: "", name: "" };

/**
 * What the server would check against stored data, for one screen's scope (read through the
 * data-access layer by the route that offers the actions: app/dev/demo/office/[role]/_simulatedState.ts).
 * Only the Settings and account screens receive it, and only what they act on; every other screen
 * gets the empty state, where these checks fail (deny by default). The real server checks these
 * itself, in the database, under the caller's session.
 */
export type SimulatedServerState = {
  /** Pickup places by id: whether each is referenced (delete only when unreferenced, SE-06). */
  places?: Readonly<Record<string, { inUse: boolean }>>;
  /** Follow-up reasons by id (delete only a user-added, never-used reason, SE-07). */
  reasons?: Readonly<Record<string, { inUse: boolean; userAdded: boolean }>>;
  /** Account requests in the viewer's scope by id: the stored status (decide or cancel only while pending, D34). */
  requests?: Readonly<Record<string, AccountRequestStatus>>;
  /** Accounts in the viewer's scope by id (D34). */
  accounts?: Readonly<Record<string, { name: string; email: string; role: AccountRole; active: boolean }>>;
  /** The signed-in account (production: from the session, G-03). */
  self?: AccountRef | null;
  /**
   * "מוצרים" (PR-06): the products on the screen by SKU (stored version, name for the toast) and
   * the brands and suppliers by id (an edit may choose only an existing, active one).
   */
  products?: {
    items: Readonly<Record<string, { version: number; name: string }>>;
    brands: Readonly<Record<string, { active: boolean }>>;
    suppliers: Readonly<Record<string, { active: boolean }>>;
  };
};

const EMPTY_STATE: SimulatedServerState = {};

export function SimulatedCommandsProvider({ state = EMPTY_STATE, children }: { state?: SimulatedServerState; children: ReactNode }) {
  const simulate = useSimulate();

  const commands = useMemo<Commands>(() => {
    /** Records this provider "created" (simulated): unknown to the stored state, deletable. */
    const created = new Set<string>();
    const remember = (id: string): string => {
      created.add(id);
      return id;
    };

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
            () => ({ id: remember(simId("place")), isTest: true }),
          ),
        setPlaceActive: (id, active) =>
          run(
            () => [settingIdError(id), activeFlagError(active)],
            () => `מקום איסוף · ${active ? "פעיל" : "לא פעיל"}`,
          ),
        deletePlace: (id) =>
          run(
            () => [settingIdError(id), created.has(id) ? null : placeDeleteError(ownValue(state.places, id))],
            () => "מחיקת מקום איסוף",
            () => void created.delete(id),
          ),
        addReason: (name) =>
          run(
            () => [settingNameError(name, "שם הסיבה")],
            () => `הוספת סיבת המשך טיפול · ${excerpt(name, 40)}`,
            () => ({ id: remember(simId("reason")), isTest: true }),
          ),
        setReasonActive: (id, active) =>
          run(
            () => [settingIdError(id), activeFlagError(active)],
            () => `סיבת המשך טיפול · ${active ? "פעילה" : "לא פעילה"}`,
          ),
        deleteReason: (id) =>
          run(
            // A reason created here is user-added and unused; a stored one is checked as the server would.
            () => [settingIdError(id), created.has(id) ? null : reasonDeleteError(ownValue(state.reasons, id))],
            () => "מחיקת סיבת המשך טיפול",
            () => void created.delete(id),
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
            () => ({ id: remember(simId("type")), isTest: true }),
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
            () => [newAccountError(input), testAccountEmailError(input.email)],
            () => `יצירת חשבון ${ACCOUNT_ROLE_LABELS[input.role]} · ${excerpt(input.name, 40)} · לא נוצר משתמש`,
            (): { account: UserAccount } => ({
              account: {
                id: remember(simId("account")),
                name: input.name.trim(),
                role: input.role,
                email: input.email.trim(),
                phone: input.phone.trim(),
                active: true,
                deactivatedAt: null,
                technicianId: null,
                isTest: true,
              },
            }),
          ),
        requestAccount: (input) =>
          run(
            () => [
              accountRequestError(input),
              state.self ? null : "אין משתמש מחובר",
              input.kind === "create"
                ? testAccountEmailError(input.email)
                : accountRequestTargetError(input.kind, ownValue(state.accounts, input.accountId)),
            ],
            () =>
              `בקשה לאישור היוצר · ${ACCOUNT_REQUEST_KIND_LABELS[input.kind]} · ${excerpt(
                input.kind === "create" ? input.name : (ownValue(state.accounts, input.accountId)?.name ?? ""),
                40,
              )} · שום דבר לא משתנה עד האישור`,
            (): { request: AccountRequest } => {
              const existing = input.kind === "create" ? null : ownValue(state.accounts, input.accountId);
              const target =
                input.kind === "create"
                  ? { name: input.name.trim(), email: input.email.trim(), role: "cs" as const }
                  : { name: existing?.name ?? "", email: existing?.email ?? "", role: existing?.role ?? "cs" };
              return {
                request: {
                  id: remember(simId("request")),
                  kind: input.kind,
                  account: input.kind === "create" ? null : { id: input.accountId, name: target.name },
                  target,
                  newRole: input.kind === "role-change" ? input.newRole : null,
                  requestedBy: state.self ?? NO_ACCOUNT,
                  requestedAt: new Date().toISOString(),
                  status: "pending",
                  reason: null,
                  decidedBy: null,
                  decidedAt: null,
                  isTest: true,
                },
              };
            },
          ),
        decideAccountRequest: (requestId, decision) =>
          run(
            () => [requestIdError(requestId), accountDecisionError(decision), pendingRequestError(ownValue(state.requests, requestId))],
            () =>
              decision.outcome === "approve"
                ? "אישור הבקשה · נכנסת לתוקף"
                : `דחיית הבקשה · סיבה: ${excerpt(decision.reason)}`,
          ),
        cancelAccountRequest: (requestId) =>
          run(
            () => [requestIdError(requestId), pendingRequestError(ownValue(state.requests, requestId))],
            () => "ביטול הבקשה",
          ),
        deactivateAccount: (accountId) =>
          run(
            () => [
              accountIdError(accountId),
              state.self && state.self.id === accountId ? "אי אפשר להשבית את החשבון שלך" : null,
              accountStateError("deactivate", ownValue(state.accounts, accountId)?.active),
            ],
            // The Creator is notified only of a Manager's deactivation (D34 b); the screen says so.
            () => `השבתת חשבון · ${excerpt(ownValue(state.accounts, accountId)?.name ?? "", 40)} · מיידית · נרשם ביומן הביקורת`,
          ),
        activateAccount: (accountId) =>
          run(
            () => [accountIdError(accountId), accountStateError("activate", ownValue(state.accounts, accountId)?.active)],
            () => `הפעלת חשבון · ${excerpt(ownValue(state.accounts, accountId)?.name ?? "", 40)} · מיידית`,
          ),
        createTechnician: (input) =>
          run(
            () => [newTechnicianError(input), testAccountEmailError(input.email)],
            () => `הוספת טכנאי · ${excerpt(input.name, 40)} · לא נוצר משתמש`,
            (): { account: UserAccount; technician: TechnicianSetting } => {
              const technician: TechnicianSetting = {
                id: remember(simId("tech")),
                name: input.name.trim(),
                color: technicianColorCss(input.color),
                phone: input.phone.trim(),
                email: input.email.trim(),
                active: true,
                device: input.device.trim(),
                isTest: true,
              };
              return {
                technician,
                account: {
                  id: remember(simId("account")),
                  name: technician.name,
                  role: "tech",
                  email: technician.email,
                  phone: technician.phone,
                  active: true,
                  deactivatedAt: null,
                  technicianId: technician.id,
                  isTest: true,
                },
              };
            },
          ),
      },
      products: {
        // PR-06 (matrix key `products`): only the products page nests the state; elsewhere every
        // check below fails (deny by default).
        update: (input) =>
          run(
            () => [
              productEditError(input, {
                product: ownValue(state.products?.items, input.sku),
                brand: input.brandId ? ownValue(state.products?.brands, input.brandId) : undefined,
                supplier: input.supplierId ? ownValue(state.products?.suppliers, input.supplierId) : undefined,
              }),
            ],
            () =>
              `עריכת מוצר · ${input.sku} · ${excerpt(input.name ?? ownValue(state.products?.items, input.sku)?.name ?? "", 40)}`,
          ),
      },
    };
  }, [simulate, state]);

  return <CommandsProvider commands={commands}>{children}</CommandsProvider>;
}
