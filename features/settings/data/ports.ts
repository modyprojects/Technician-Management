// Settings ports. Implemented by app/dev/demo/_data/adapter.ts (queries, fictional fixtures),
// app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and, later, by Supabase
// adapters that run on the server under the caller's session. Every method is async and returns
// DTOs only. Settings lists are short, owner-maintained lists: each is Bounded (at most
// MAX_PAGE_LIMIT, 100) so a screen can say "ועוד X".
// Who may change what is enforced on the server and in the database (G-04): the matrix only by
// the Creator (D33); operational settings with the matrix key `settings` (D35); technicians by
// the Manager and the Creator (D34 d; "פעיל" and the Outlook email by the Creator only for now,
// Step 2 plan Q14). Screens only decide what to offer.
// The "טופל" text is read with reference.approvalText() (one source for Settings and the close
// screen); it is changed with SettingsCommands.setFixedText.
import type { CommandResult, VersionedResult } from "@/features/data-access/common";
import type { MatrixRole, PermissionKey } from "@/features/reference/data/types";
import type {
  Bounded,
  CallTypeSetting,
  CreatedSetting,
  MailSettings,
  NewPlaceInput,
  PermissionMatrix,
  PlaceSetting,
  ReasonSetting,
  SettingId,
  TechNotificationKey,
  TechnicianActiveInput,
  TechnicianSetting,
  TemplateFieldKey,
  TemplateSettings,
} from "./types";

export interface SettingsQueries {
  /**
   * The editable matrix (SE-02): one row per key with the Manager and Customer Service values,
   * each with its status (temporary until Step 10, D51) and any open decision it waits for. The
   * Creator column is fixed (D33): each row says only whether the Creator's capability waits for
   * an open decision (`usage`, d13).
   */
  permissionMatrix(): Promise<PermissionMatrix>;
  /**
   * Settings › טכנאים, in Settings order (active and inactive). Also read by the account screens'
   * loaders, which pass on only the fields the viewer's edit form shows (Step 2 PR 2.3, Q14).
   */
  technicians(): Promise<Bounded<TechnicianSetting>>;
  /** Settings › מקומות איסוף, in Settings order, with whether each is referenced. */
  places(): Promise<Bounded<PlaceSetting>>;
  /** Settings › סיבות המשך טיפול, in order, with use counts. */
  reasons(): Promise<Bounded<ReasonSetting>>;
  /** Settings › סוגי קריאה (SE-16). */
  callTypes(): Promise<Bounded<CallTypeSetting>>;
  /** Settings › מיילים והתראות (SE-08 to SE-12): fixed recipients and pending items. */
  mail(): Promise<MailSettings>;
  /** Settings › תבנית זימון (SE-13 to SE-15). */
  template(): Promise<TemplateSettings>;
}

/** Settings changes. Results say whether they were simulated (UI demo: always). */
export interface SettingsCommands {
  /**
   * Changes one matrix value (Creator only, D33; audited, effective at once). The Creator is never
   * a matrix role; a pending cell (PENDING_MATRIX_CELLS) is rejected. GAP (Step 10, Step 2 plan
   * Q13): Migration 1 `admin_set_role_permission` also takes `p_expected_version`
   * (`role_permissions.version`); the matrix cells carry no version yet, so the matrix adapter adds
   * it (a cell version and `expectedVersion` here) together with that adapter. No value changes.
   */
  setPermission(role: MatrixRole, key: PermissionKey, value: boolean): Promise<CommandResult>;
  /**
   * "פעיל" of a technician: eligibility for new invitations (SE-05), not sign-in. At the version
   * read (PT409 when it changed); returns the version as stored after it. Creator only for now
   * (TEMPORARY, Step 2 plan Q14; WORKLOG phase E P6): the same field as AccountCommands.updateTechnician's
   * `active` (Migration 1 `admin_update_technician`, which a Manager may call); a Manager is refused
   * with MANAGER_TECHNICIAN_FIELDS_PENDING, never by the matrix key `settings`.
   */
  setTechnicianActive(input: TechnicianActiveInput): Promise<CommandResult<VersionedResult>>;
  /** "+ הוספת מקום" (SE-06). */
  addPlace(input: NewPlaceInput): Promise<CommandResult<CreatedSetting>>;
  setPlaceActive(id: SettingId, active: boolean): Promise<CommandResult>;
  /** Deletes an unused place only; a referenced place can only be deactivated (SE-06). */
  deletePlace(id: SettingId): Promise<CommandResult>;
  /** "+ הוספת סיבה" (SE-07): appended at the end of the order, user-added. */
  addReason(name: string): Promise<CommandResult<CreatedSetting>>;
  setReasonActive(id: SettingId, active: boolean): Promise<CommandResult>;
  /**
   * Deletes a user-added, never-used reason only; an initial (D48) or used reason can only be
   * deactivated (SE-07).
   */
  deleteReason(id: SettingId): Promise<CommandResult>;
  /**
   * Saves a new version of the "טופל" text (SE-07). Past signatures keep the exact text shown at
   * signing (D43); the result carries the new version id.
   */
  setFixedText(text: string): Promise<CommandResult<{ versionId: string }>>;
  /** "+ הוספת סוג קריאה" (SE-16). */
  addCallType(name: string): Promise<CommandResult<CreatedSetting>>;
  setCallTypeActive(id: SettingId, active: boolean): Promise<CommandResult>;
  /** Technician in-app notifications (SE-11). */
  setTechNotification(key: TechNotificationKey, on: boolean): Promise<CommandResult>;
  /** "חובה" of a template label (SE-15). A locked (D17) label is rejected. */
  setTemplateLabelRequired(key: TemplateFieldKey, required: boolean): Promise<CommandResult>;
}
