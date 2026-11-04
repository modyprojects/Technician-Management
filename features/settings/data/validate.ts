// Input checks for settings commands, shared by every implementation (simulated now, the server
// later; the server always re-validates, and checks the caller's role and `settings` itself).
// Each returns a Hebrew error, or null when valid.
import { isUuid } from "@/features/data-access/common";
import { isMatrixRole, isPermissionKey, type TechnicianId } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";
import {
  isLockedTemplateField,
  isTechNotificationKey,
  isTemplateFieldKey,
  pendingMatrixDecision,
  type NewPlaceInput,
  type SettingId,
} from "./types";

export const SETTING_NAME_MAX = 60;
export const PLACE_FIELD_MAX = 120;
export const FIXED_TEXT_MAX = 300;

/** Settings record ids: fixture keys now, database UUIDs later. */
export const isSettingId = (value: unknown): value is SettingId =>
  isUuid(value) || (typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value));

export const settingIdError = (id: SettingId): string | null => (isSettingId(id) ? null : "פריט לא תקין");

export const activeFlagError = (active: boolean): string | null => (typeof active === "boolean" ? null : "מצב לא תקין");

export const technicianIdError = (id: TechnicianId): string | null => (isTechnicianId(id) ? null : "טכנאי לא תקין");

/** A required short name (reason, call type, place). */
export function settingNameError(name: string, what = "שם"): string | null {
  const t = typeof name === "string" ? name.trim() : "";
  if (!t) return `חסר ${what}`;
  return t.length > SETTING_NAME_MAX ? `${what} ארוך מ-${SETTING_NAME_MAX} תווים` : null;
}

export function setPermissionError(role: unknown, key: unknown, value: unknown): string | null {
  if (role === "creator") return "היכולות של היוצר קבועות ואינן חלק ממטריצת ההרשאות";
  if (!isMatrixRole(role)) return "תפקיד לא תקין";
  if (!isPermissionKey(key)) return "הרשאה לא תקינה";
  if (typeof value !== "boolean") return "ערך לא תקין";
  const pending = pendingMatrixDecision(role, key);
  return pending ? `ממתין להחלטה (${pending})` : null;
}

export function newPlaceError(input: NewPlaceInput): string | null {
  const nameError = settingNameError(input?.name, "שם המקום");
  if (nameError) return nameError;
  if (!(typeof input.address === "string" && input.address.trim())) return "חסרה כתובת";
  for (const v of [input.type, input.address, input.phone, input.hours]) {
    if (typeof v !== "string") return "פרטי המקום לא תקינים";
    if (v.trim().length > PLACE_FIELD_MAX) return `שדה ארוך מ-${PLACE_FIELD_MAX} תווים`;
  }
  return null;
}

/** The "טופל" text: required, one paragraph, at most FIXED_TEXT_MAX characters. */
export function fixedTextError(text: string): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return "הנוסח לא יכול להיות ריק";
  return t.length > FIXED_TEXT_MAX ? `הנוסח ארוך מ-${FIXED_TEXT_MAX} תווים` : null;
}

export function techNotificationError(key: unknown, on: unknown): string | null {
  if (!isTechNotificationKey(key)) return "התראה לא תקינה";
  return typeof on === "boolean" ? null : "ערך לא תקין";
}

export function templateLabelRequiredError(key: unknown, required: unknown): string | null {
  if (!isTemplateFieldKey(key)) return "תווית לא תקינה";
  if (typeof required !== "boolean") return "ערך לא תקין";
  return isLockedTemplateField(key) ? "שדה חובה קבוע (D17): אי אפשר לשנות" : null;
}
