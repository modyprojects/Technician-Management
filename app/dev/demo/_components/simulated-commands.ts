// The UI demo's Commands (features/data-access/types) as a pure function of the stored state the
// page passed (SimulatedServerState) and the toast callback: every action is SIMULATED (D53).
// Nothing is saved, uploaded, signed or sent. Inputs are validated like a server would (invalid
// input returns ok: false); valid input returns { ok: true, simulated: true, message } after a short
// artificial delay, and the demo toast shows "פעולה מדומה · לא נשמר" with what would have happened.
// Not a client module and no React: SimulatedCommandsProvider (SimulatedCommands.tsx) wraps it in
// useMemo, and the unit tests call it directly with tampered state and no page (Step 2 PR 2.3 U12).
// Screens call useCommands() and never this module directly.
import {
  ACCOUNT_REQUEST_KIND_LABELS,
  ACCOUNT_ROLE_LABELS,
  technicianProfileMissing,
  type AccountRef,
  type AccountRequest,
  type AccountRole,
  type CompletedCreation,
  type CompletedTechnicianProfile,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  accountAdminCallerError,
  accountIdError,
  accountRequestError,
  accountRequestTargetError,
  accountStateCommandError,
  aliasTakenError,
  cancelCreationError,
  cancelRequestError,
  completeCreationError,
  creatorOnlyError,
  credentialEmailError,
  credentialsCallerError,
  decideRequestError,
  deleteAccountError,
  managerOnlyError,
  newAccountError,
  newTechnicianError,
  passwordError,
  profileUpdateCommandError,
  roleChangeError,
  staleVersionError,
  technicianProfileCompletionError,
  technicianUpdateCommandError,
  testAccountEmailError,
  type AccountRequestStored,
  type AccountStored,
  type AccountViewer,
} from "@/features/accounts/data/validate";
import { cancelReasonError } from "@/features/calls/data/validate";
import { ownValue, type CommandResult, type VersionedResult } from "@/features/data-access/common";
import { ACTION_MESSAGES, REQUEST_MESSAGES } from "@/features/data-access/supabase-errors";
import type { Commands } from "@/features/data-access/types";
import { notificationIdsError, notificationPreferencesError } from "@/features/notifications/data/validate";
import { productEditError } from "@/features/products/data/validate";
import { REVIEW_DECISION_LABELS } from "@/features/review/data/types";
import { reviewResolutionError, type ReviewResolveStored } from "@/features/review/data/validate";
import { syncNowError, syncRetryError, type DeviceQueueStored } from "@/features/sync/data/validate";
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
  technicianActiveError,
  templateLabelRequiredError,
} from "@/features/settings/data/validate";
import {
  CORRECTABLE_FIELD_LABELS,
  TIME_CORRECTION_FIELDS,
  visitRefKey,
  type VisitCorrection,
  type VisitRef,
} from "@/features/visits/data/types";
import {
  closeVisitError,
  mediaError,
  mediaIdError,
  partsError,
  pickupCollectedError,
  recordingError,
  summaryError,
  visitCorrectionError,
  visitRefError,
  type VisitCorrectionStored,
} from "@/features/visits/data/validate";

/** The title of every simulated result and toast ("nothing was saved"). */
export const SIMULATED_TITLE = "פעולה מדומה · לא נשמר";

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
  /**
   * Account requests in the viewer's scope by id, as stored: status, version, requester and whether
   * it is an unfulfilled creation (decide only while pending; cancel per cancelRequestError, D34).
   */
  requests?: Readonly<Record<string, AccountRequestStored>>;
  /** Accounts in the viewer's scope by id, as stored (role, state, version, test marker; D34). */
  accounts?: Readonly<Record<string, AccountStored>>;
  /**
   * Who each open creation in `requests` creates (a creation intent or an approved, unfulfilled
   * "create" request), by request id: name, email and role from the stored row. "השלמת יצירה"
   * builds the account from these, never from client values (Step 2 plan §3.8 "Retry").
   */
  creationTargets?: Readonly<Record<string, { name: string; email: string; role: AccountRole }>>;
  /**
   * The technician records on the screen by technician id (version, name, test marker): Settings ›
   * טכנאים, and the account screens for their listed Technician accounts ("עריכת פרטים"). A
   * technician this provider created counts as version 1. Settings › טכנאים also passes `selfRole`
   * ("פעיל" is the Creator's only for now, Q14), never `self` (no account ids there).
   */
  technicians?: Readonly<Record<string, { version: number; name: string; isTest: boolean }>>;
  /** The signed-in account (production: from the session, G-03). */
  self?: AccountRef | null;
  /**
   * The signed-in account's role (production: the session's `profiles.role`, never an argument).
   * Named `selfRole`, not `role`: the Manager's page payload must never hold `role:"mgr"` (its
   * account scope is Customer Service and Technician only; tests/e2e/demo.spec.ts).
   */
  selfRole?: AccountRole;
  /**
   * The signed-in user's name only, for a screen that must not carry account ids (phase E P1:
   * account ids only on the account screens): the call card's closed-visit corrections show who
   * corrected by name. Production: the stored record carries the caller from the session.
   */
  signedInName?: string;
  /**
   * "מוצרים" (PR-06): the products on the screen by SKU (stored version, name for the toast) and
   * the brands and suppliers by id (an edit may choose only an existing, active one).
   */
  products?: {
    items: Readonly<Record<string, { version: number; name: string }>>;
    brands: Readonly<Record<string, { active: boolean }>>;
    suppliers: Readonly<Record<string, { active: boolean }>>;
  };
  /**
   * "פריטים לבדיקה" (D44): the items on the screen by id, with what a resolution is checked against
   * (version, status, offered decisions and fields, the note rule and whether the viewer may
   * resolve it: D14 cases Manager and Creator, others `conflicts`).
   */
  review?: Readonly<Record<string, ReviewResolveStored>>;
  /**
   * "תיקון ביקור סגור" (OF-10, D14): the closed visits on the call card by visitRefKey ("req/n"), with their
   * version, current values, correctable fields, active reasons and whether the viewer may correct.
   */
  corrections?: Readonly<Record<string, VisitCorrectionStored>>;
  /**
   * The technician device's work queue (TE-24, D46): state per operation id. Production checks
   * this on the device itself (the queue is local); the demo technician pages pass it here.
   */
  deviceQueue?: DeviceQueueStored;
};

/**
 * The simulated Commands for one page: `state` is what the page read through the data-access layer
 * (deny by default when a part is missing), `simulate` shows the demo toast with a detail line, and
 * `options.delayMs` (default 250 ms) is the artificial delay before each result.
 */
export function buildSimulatedCommands(
  state: SimulatedServerState,
  simulate: (detail: string) => void,
  options?: { delayMs?: number },
): Commands {
  const delayMs = options?.delayMs ?? DELAY_MS;
  /** Records this provider "created" (simulated): unknown to the stored state, deletable. */
  const created = new Set<string>();
  const remember = (id: string): string => {
    created.add(id);
    return id;
  };

  /** The caller as the server would take it from the session; null without one (deny by default). */
  const viewer: AccountViewer | null = state.self && state.selfRole ? { id: state.self.id, role: state.selfRole } : null;

  /** A technician record as stored: one this provider created counts as version 1 (never stored). */
  const storedTechnician = (id: string): { version: number; name: string; isTest: boolean } | undefined =>
    typeof id === "string" && created.has(id) ? { version: 1, name: "", isTest: true } : ownValue(state.technicians, id);

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
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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
      // OF-10 (D14): only the call card nests the state; elsewhere every check fails (deny by default).
      correct: (input) =>
        run(
          () => [visitCorrectionError(input, ownValue(state.corrections, visitRefKey(input?.visitRef)))],
          () => `תיקון ביקור סגור · ${CORRECTABLE_FIELD_LABELS[input.field]} · ${visitLabel(input.visitRef)} · המקור נשמר`,
          (): { correction: VisitCorrection } => {
            const stored = ownValue(state.corrections, visitRefKey(input.visitRef));
            return {
              correction: {
                id: remember(simId("correction")),
                ref: { req: input.visitRef.req, n: input.visitRef.n },
                field: input.field,
                target: TIME_CORRECTION_FIELDS.includes(input.field) ? "time-report" : "report",
                before: stored?.current[input.field] ?? null,
                after: Array.isArray(input.newValue)
                  ? input.newValue.map((p) => String(p).trim()).filter(Boolean)
                  : typeof input.newValue === "string"
                    ? input.newValue.trim()
                    : null,
                by: state.self ?? { id: "", name: state.signedInName ?? "" },
                at: new Date().toISOString(),
                reason: input.reason.trim(),
                versionBefore: input.expectedVersion,
                versionAfter: input.expectedVersion + 1,
                isTest: true,
              },
            };
          },
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
      // Settings › טכנאים nests the technicians (with versions) and the viewer's role; elsewhere it
      // fails (deny by default). Creator only for now (Q14). Returns the version checked: nothing
      // is stored, so it is unchanged.
      setTechnicianActive: (input) =>
        run(
          () => [technicianActiveError(input, storedTechnician(input?.techId), state.selfRole)],
          () => (input.active ? "טכנאי פעיל · יקבל זימונים חדשים" : "טכנאי לא פעיל · לא יקבל זימונים חדשים, ההיסטוריה נשמרת"),
          (): VersionedResult => ({ version: storedTechnician(input.techId)?.version ?? input.expectedVersion }),
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
    // The account screens nest the accounts and requests in the viewer's scope, the viewer and
    // his role (accountAdminState); elsewhere the stored checks fail (deny by default). Every
    // command checks the caller's role first, as Migration 1's `require_caller` (the shared
    // validators: creatorOnlyError, managerOnlyError, accountAdminCallerError and the command
    // checks below). Not modelled: Migration 1 also refuses a test-marked Creator's decisions,
    // cancellations of others' requests and credential changes (every demo account is
    // test-marked). Versions never advance here (nothing is stored): a versioned command returns
    // the version it checked, and a simulated row offers no second action. "השלמת יצירה"
    // (completeCreation) and "השלמה" (completeTechnicianProfile) build what they create from the
    // stored rows (creationTargets, accounts), never from client values (Step 2 plan §3.8).
    accounts: {
      createAccount: (input) =>
        run(
          () => [creatorOnlyError(state.selfRole), newAccountError(input), testAccountEmailError(input.email)],
          () => `יצירת חשבון ${ACCOUNT_ROLE_LABELS[input.role]} · ${excerpt(input.name, 40)} · לא נוצר משתמש`,
          (): { account: UserAccount } => {
            const account = {
              id: remember(simId("account")),
              name: input.name.trim(),
              role: input.role,
              email: input.email.trim(),
              phone: input.phone.trim(),
              invitationAlias: null,
              active: true,
              deactivatedAt: null,
              technicianId: null,
              version: 1,
              isTest: true,
            };
            // A Technician created here has no technician record yet (Step 2 plan §3.8 phase 4).
            return { account: { ...account, technicianMissing: technicianProfileMissing(account) } };
          },
        ),
      requestAccount: (input) =>
        run(
          () => [
            managerOnlyError(state.selfRole),
            state.self ? null : ACTION_MESSAGES.forbidden,
            accountRequestError(input),
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
                cancelledAfterApproval: false,
                version: 1,
                isTest: true,
              },
            };
          },
        ),
      decideAccountRequest: (input) =>
        run(
          () => [decideRequestError(input, ownValue(state.requests, input?.requestId), state.selfRole)],
          () =>
            input.decision.outcome === "approve"
              ? "אישור הבקשה · נכנסת לתוקף"
              : `דחיית הבקשה · סיבה: ${excerpt(input.decision.reason)}`,
          (): VersionedResult => ({ version: ownValue(state.requests, input.requestId)?.version ?? input.expectedVersion }),
        ),
      cancelAccountRequest: (input) =>
        run(
          () => [cancelRequestError(input, ownValue(state.requests, input?.requestId), viewer)],
          // A creation intent is the viewer's own "יצירה שלא הושלמה", not a request.
          () => (ownValue(state.requests, input.requestId)?.intent ? "ביטול יצירה שלא הושלמה" : "ביטול הבקשה"),
          (): VersionedResult => ({ version: ownValue(state.requests, input.requestId)?.version ?? input.expectedVersion }),
        ),
      deactivateAccount: (input) =>
        run(
          () => [accountStateCommandError("deactivate", input, ownValue(state.accounts, input?.accountId), viewer)],
          // The Creator is notified only of a Manager's deactivation (D34 b); the screen says so.
          () => `השבתת חשבון · ${excerpt(ownValue(state.accounts, input.accountId)?.name ?? "", 40)} · מיידית · נרשם ביומן הביקורת`,
          (): VersionedResult => ({ version: ownValue(state.accounts, input.accountId)?.version ?? input.expectedVersion }),
        ),
      activateAccount: (input) =>
        run(
          () => [accountStateCommandError("activate", input, ownValue(state.accounts, input?.accountId), viewer)],
          () => `הפעלת חשבון · ${excerpt(ownValue(state.accounts, input.accountId)?.name ?? "", 40)} · מיידית`,
          (): VersionedResult => ({ version: ownValue(state.accounts, input.accountId)?.version ?? input.expectedVersion }),
        ),
      // The Manager's accounts tab and the Creator's Settings › טכנאים pass the viewer's role.
      createTechnician: (input) =>
        run(
          () => [accountAdminCallerError(state.selfRole), newTechnicianError(input), testAccountEmailError(input.email)],
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
              version: 1,
              isTest: true,
            };
            const account = {
              id: remember(simId("account")),
              name: technician.name,
              role: "tech" as const,
              email: technician.email,
              phone: technician.phone,
              invitationAlias: null,
              active: true,
              deactivatedAt: null,
              technicianId: technician.id,
              version: 1,
              isTest: true,
            };
            return { technician, account: { ...account, technicianMissing: technicianProfileMissing(account) } };
          },
        ),
      // D34 e, D50: the Creator only. Nothing is stored, sent or returned; the password never
      // appears in a message or a toast.
      // An unknown account is the database's 22023 (assert_can_change_credentials).
      setPassword: (accountId, password) =>
        run(
          () => [
            credentialsCallerError(state.selfRole),
            accountIdError(accountId),
            ownValue(state.accounts, accountId) ? null : ACTION_MESSAGES.invalid,
            passwordError(password),
          ],
          () => `הגדרת סיסמה · ${excerpt(ownValue(state.accounts, accountId)?.name ?? "", 40)} · הסיסמה לא נשמרה ולא נשלחה`,
        ),
      changeEmail: (accountId, email) =>
        run(
          () => {
            const stored = ownValue(state.accounts, accountId);
            return [
              credentialsCallerError(state.selfRole),
              accountIdError(accountId),
              stored ? null : ACTION_MESSAGES.invalid,
              stored ? credentialEmailError(email, stored) : null,
            ];
          },
          () => `שינוי כתובת מייל · ${excerpt(ownValue(state.accounts, accountId)?.name ?? "", 40)} · לא נשמר`,
        ),
      // D34 d (Q14 for a Manager's Outlook email and "פעיל"). An alias another listed account holds
      // is refused as the database's unique constraint would (23505).
      updateProfile: (input) =>
        run(
          () => [
            profileUpdateCommandError(input, ownValue(state.accounts, input?.accountId), viewer),
            aliasTakenError(input?.invitationAlias, input?.accountId, state.accounts ?? {}),
          ],
          () =>
            `עדכון פרטים · ${excerpt(input.name ?? ownValue(state.accounts, input.accountId)?.name ?? "", 40)} · נרשם ביומן הביקורת`,
          (): VersionedResult => ({ version: ownValue(state.accounts, input.accountId)?.version ?? input.expectedVersion }),
        ),
      updateTechnician: (input) =>
        run(
          () => [technicianUpdateCommandError(input, storedTechnician(input?.technicianId), viewer)],
          () => `עדכון פרטי טכנאי · ${excerpt(input.name ?? storedTechnician(input.technicianId)?.name ?? "", 40)}`,
          (): VersionedResult => ({ version: storedTechnician(input.technicianId)?.version ?? input.expectedVersion }),
        ),
      // "השלמת יצירה" (Step 2 plan §3.8 "Retry"): name, email and role come from the stored row
      // (creationTargets), never from the client; no password (Q1). Nothing is created.
      completeCreation: (input) =>
        run(
          () => [
            completeCreationError(input, ownValue(state.requests, input?.requestId), viewer),
            ownValue(state.creationTargets, input?.requestId) ? null : ACTION_MESSAGES.invalid,
          ],
          () => `השלמת יצירה · ${excerpt(ownValue(state.creationTargets, input.requestId)?.name ?? "", 40)} · לא נוצר משתמש`,
          (): CompletedCreation => {
            const target = ownValue(state.creationTargets, input.requestId);
            if (!target) throw new Error("unknown creation");
            const phone = input.phone === null ? "" : input.phone.trim();
            const technician: TechnicianSetting | null =
              target.role === "tech" && input.technician
                ? {
                    id: remember(simId("tech")),
                    name: target.name,
                    color: technicianColorCss(input.technician.color),
                    phone,
                    email: target.email,
                    active: true,
                    device: input.technician.device.trim(),
                    version: 1,
                    isTest: true,
                  }
                : null;
            const account = {
              id: remember(simId("account")),
              name: target.name,
              role: target.role,
              email: target.email,
              phone,
              invitationAlias: null,
              active: true,
              deactivatedAt: null,
              technicianId: technician?.id ?? null,
              version: 1,
              isTest: true,
            };
            return { account: { ...account, technicianMissing: technicianProfileMissing(account) }, technician };
          },
        ),
      // D60 (7) commands of the real unified screen. The /dev/demo prototype shows the pre-D60
      // screens (D61 (1)) and offers none of them; they are simulated with the shared D60 rules so
      // the aggregate stays complete. Nothing is stored or deleted.
      cancelCreation: (input) =>
        run(
          () => {
            const stored = ownValue(state.requests, input?.intentId);
            const mayCancel = stored?.intent === true && (stored.requestedBy === viewer?.id || viewer?.role === "creator");
            return [
              cancelCreationError(input, viewer),
              mayCancel ? null : ACTION_MESSAGES.forbidden,
              stored?.status === "approved" && !stored.fulfilled ? null : REQUEST_MESSAGES.cannotCancel,
              stored ? staleVersionError(input.expectedVersion, stored.version) : null,
            ];
          },
          () => "ביטול יצירה שלא הושלמה",
          (): VersionedResult => ({ version: ownValue(state.requests, input.intentId)?.version ?? input.expectedVersion }),
        ),
      changeRole: (input) =>
        run(
          () => {
            const stored = ownValue(state.accounts, input?.accountId);
            return [
              roleChangeError(input, viewer),
              stored ? null : ACTION_MESSAGES.forbidden,
              stored && stored.technicianId !== null && input.newRole !== stored.role ? "לא ניתן לשנות את התפקיד של חשבון טכנאי." : null,
              stored ? staleVersionError(input.expectedVersion, stored.version) : null,
            ];
          },
          () => `שינוי תפקיד · ${excerpt(ownValue(state.accounts, input.accountId)?.name ?? "", 40)} · ${ACCOUNT_ROLE_LABELS[input.newRole]}`,
          (): VersionedResult => ({ version: ownValue(state.accounts, input.accountId)?.version ?? input.expectedVersion }),
        ),
      deleteAccount: (input) =>
        run(
          () => {
            const stored = ownValue(state.accounts, input?.accountId);
            return [
              deleteAccountError(input, viewer),
              stored && stored.role !== "creator" ? null : ACTION_MESSAGES.forbidden,
              stored ? staleVersionError(input.expectedVersion, stored.version) : null,
            ];
          },
          () => `מחיקת משתמש · ${excerpt(ownValue(state.accounts, input.accountId)?.name ?? "", 40)} · ההיסטוריה נשמרת · לא נמחק`,
          (): VersionedResult => ({ version: ownValue(state.accounts, input.accountId)?.version ?? input.expectedVersion }),
        ),
      // "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4): the Outlook email is the account's
      // stored sign-in email (Q14), never an input. Nothing is created.
      completeTechnicianProfile: (input) =>
        run(
          () => [technicianProfileCompletionError(input, ownValue(state.accounts, input?.accountId), viewer)],
          () => `השלמת פרופיל טכנאי · ${excerpt(ownValue(state.accounts, input.accountId)?.name ?? "", 40)}`,
          (): CompletedTechnicianProfile => {
            const stored = ownValue(state.accounts, input.accountId);
            if (!stored) throw new Error("unknown account");
            return {
              technician: {
                id: remember(simId("tech")),
                name: stored.name,
                color: technicianColorCss(input.color),
                phone: "",
                email: stored.email,
                active: true,
                device: input.device.trim(),
                version: 1,
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
    review: {
      // D44: only the review item page nests the state; elsewhere every check fails (deny by default).
      resolve: (input) =>
        run(
          () => [reviewResolutionError(input, ownValue(state.review, input?.id))],
          () => `פריט לבדיקה · ${REVIEW_DECISION_LABELS[input.decision]} · שתי הגרסאות נשמרות`,
        ),
    },
    sync: {
      // TE-24 (D06: manual sync; no background jobs, D25). The technician pages nest the device
      // queue; elsewhere both fail (deny by default).
      now: () =>
        run(
          () => [syncNowError(state.deviceQueue)],
          () => "סנכרון עכשיו · שום דבר לא נשלח לשרת",
          () => ({
            attempted: Object.values(state.deviceQueue ?? {}).length,
          }),
        ),
      retry: (input) =>
        run(
          () => [syncRetryError(input, ownValue(state.deviceQueue, input?.opId))],
          () => "ניסיון חוזר · שום דבר לא נשלח לשרת",
        ),
    },
  };
}
