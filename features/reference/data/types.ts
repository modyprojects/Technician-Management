// Reference data DTOs: technicians, products, follow-up reasons, pickup places, office roles and
// the permission matrix. Pure types (no data). See features/data-access/common.ts.
import type { TestMarker } from "@/features/data-access/common";

/** Technician id (a profile id in production). */
export type TechnicianId = string;

export type Technician = TestMarker & {
  id: TechnicianId;
  name: string;
  /**
   * CSS colour, e.g. "var(--t-y)" (Settings › טכנאים). Components put it into inline styles, so
   * TODO(production adapter): store only an allowlisted token and map it to `var(--t-…)`; never
   * pass stored CSS through (docs/architecture-data-access.md, "How a Supabase adapter plugs in").
   */
  color: string;
  phone: string;
  /** Outlook attendee address. */
  email: string;
  active: boolean;
};

/**
 * Allowlisted technician colour tokens (app/globals.css `--t-*`). Inputs name a token, never CSS;
 * the adapter maps a token to `var(--t-…)` (docs/architecture-data-access.md, "Colours from the
 * database").
 */
export const TECHNICIAN_COLOR_TOKENS = ["t-y", "t-e", "t-s"] as const;
export type TechnicianColorToken = (typeof TECHNICIAN_COLOR_TOKENS)[number];

export const isTechnicianColorToken = (value: unknown): value is TechnicianColorToken =>
  typeof value === "string" && (TECHNICIAN_COLOR_TOKENS as readonly string[]).includes(value);

/** What other DTOs carry about a technician. */
export type TechnicianRef = Pick<Technician, "id" | "name" | "color" | "phone">;

/** Product built from invitations (D19): brand and supplier are optional ("" when not entered). */
export type Product = TestMarker & {
  /** Normalized unique SKU ("מק״ט"). */
  sku: string;
  name: string;
  brand: string;
  supplier: string;
};

/** Follow-up reason ("סיבת המשך טיפול", Settings). */
export type Reason = TestMarker & { name: string; active: boolean };

/** Pickup place ("מקום איסוף", Settings). */
export type Place = TestMarker & {
  name: string;
  /** "מרכז לוגיסטי" / "סניף". */
  type: string;
  address: string;
  phone: string;
  hours: string;
  active: boolean;
};

/**
 * The "טופל" approval text the customer signs (Settings, D35). Every edit creates a new,
 * immutable version. The close command sends the version shown at signing, and the server keeps
 * that exact text with the signature (D43, TE-19); editing the text never changes past signatures.
 */
export type ApprovalText = TestMarker & {
  /** Immutable version identifier of the text. */
  versionId: string;
  text: string;
};

/**
 * Office roles (the office viewpoints): Manager, Customer Service and the Creator. The Creator's
 * capabilities are FIXED (D33): it is never a matrix role and has every capability.
 */
export const OFFICE_ROLE_VALUES = ["mgr", "cs", "creator"] as const;
export type OfficeRole = (typeof OFFICE_ROLE_VALUES)[number];

export const isOfficeRole = (value: unknown): value is OfficeRole =>
  typeof value === "string" && (OFFICE_ROLE_VALUES as readonly string[]).includes(value);

/**
 * Roles governed by the editable permission matrix (D33): Manager and Customer Service only.
 * Technician and Creator capabilities are fixed, never matrix values.
 */
export const MATRIX_ROLE_VALUES = ["mgr", "cs"] as const;
export type MatrixRole = (typeof MATRIX_ROLE_VALUES)[number];

export const isMatrixRole = (value: unknown): value is MatrixRole => value === "mgr" || value === "cs";

/** Permission-matrix keys (D33, demo-deviations SE-02). */
export const PERMISSION_KEYS = [
  "cal",
  "calls",
  "card",
  "cancel",
  "dashGen",
  "dashTech",
  "dashProd",
  "export",
  "settings",
  "usage",
  "products",
  "conflicts",
  "recordings",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);

/** D51: a matrix value stays "temporary" until the owner approves the final matrix in Step 10. */
export type MatrixValueStatus = "temporary" | "approved";

/**
 * Status of a role's values: a matrix value's status (D51), or "fixed" for the Creator, whose
 * capabilities are never matrix values (D33) and are not temporary.
 */
export type PermissionValueStatus = MatrixValueStatus | "fixed";

/**
 * A role's capabilities as the screens see them. Display only: what a screen offers. Enforcement
 * is always on the server and in the database (RLS, grants, server functions); never use this as
 * access control. Matrix roles carry matrix values (temporary per D51); the Creator carries every
 * key true with the status "fixed".
 */
export type RolePermissions =
  | {
      role: MatrixRole;
      status: MatrixValueStatus;
      values: Readonly<Record<PermissionKey, boolean>>;
    }
  | {
      role: "creator";
      status: "fixed";
      values: Readonly<Record<PermissionKey, true>>;
    };
