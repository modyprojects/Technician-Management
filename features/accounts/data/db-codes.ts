// Account-request types: database (`account_requests.request_type`, Migration 1) <-> UI
// (AccountRequestKind). Pure: no data, no I/O. Maps, not object literals, so a value such as
// "constructor" or "__proto__" is never found (as features/auth/roles.ts does for roles).
//
// `direct_create` rows are not requests: they are the audited authorization of an immediate
// creation (a "creation intent", Step 2 plan §3.8). They are never listed among the requests;
// an open one is shown to its requester as "יצירה שלא הושלמה" (PR 2.3).
import type { AccountRequestKind } from "./types";

/** `account_requests.request_type` values (Migration 1, `account_requests_request_type_check`). */
export const DB_REQUEST_TYPE_VALUES = ["create", "activate", "reactivate", "role_change", "direct_create"] as const;
export type DbRequestType = (typeof DB_REQUEST_TYPE_VALUES)[number];

/** The request types a Manager's request may have (everything but the creation intent). */
export type DbRequestKindType = Exclude<DbRequestType, "direct_create">;

const DB_TO_UI: ReadonlyMap<string, AccountRequestKind> = new Map<DbRequestKindType, AccountRequestKind>([
  ["create", "create"],
  ["activate", "activate"],
  ["reactivate", "reactivate"],
  ["role_change", "role-change"],
]);

const UI_TO_DB: ReadonlyMap<string, DbRequestKindType> = new Map(
  [...DB_TO_UI].map(([db, ui]) => [ui, db as DbRequestKindType]),
);

/** Whether `value` is a database request type (including `direct_create`). */
export const isDbRequestType = (value: unknown): value is DbRequestType =>
  typeof value === "string" && (DB_REQUEST_TYPE_VALUES as readonly string[]).includes(value);

/**
 * The UI kind of a database request type; null for `direct_create` (a creation intent, never a
 * request), for the UI spelling "role-change" and for anything else (deny by default).
 */
export function requestKindOf(dbType: unknown): AccountRequestKind | null {
  return typeof dbType === "string" ? (DB_TO_UI.get(dbType) ?? null) : null;
}

/** The database request type of a UI kind; null for anything else. */
export function dbRequestTypeOf(kind: unknown): DbRequestKindType | null {
  return typeof kind === "string" ? (UI_TO_DB.get(kind) ?? null) : null;
}

/** Whether a database row is a creation intent (`direct_create`), not a request. */
export const isCreationIntentType = (dbType: unknown): boolean => dbType === "direct_create";
