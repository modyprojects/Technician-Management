// Reference data DTOs: technicians, products, follow-up reasons, pickup places, office roles and
// the permission matrix. Pure types (no data). See features/data-access/common.ts.
import type { TestMarker } from "@/features/data-access/common";

/** Technician id (a profile id in production). */
export type TechnicianId = string;

export type Technician = TestMarker & {
  id: TechnicianId;
  name: string;
  /** CSS colour, e.g. "var(--t-y)" (Settings › טכנאים). */
  color: string;
  phone: string;
  /** Outlook attendee address. */
  email: string;
  active: boolean;
};

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

/** Office roles governed by the permission matrix (D33). Creator and Technician are fixed. */
export const OFFICE_ROLE_VALUES = ["mgr", "cs"] as const;
export type OfficeRole = (typeof OFFICE_ROLE_VALUES)[number];

export const isOfficeRole = (value: unknown): value is OfficeRole => value === "mgr" || value === "cs";

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

/** D51: values stay "temporary" until the owner approves the final matrix in Step 10. */
export type PermissionValueStatus = "temporary" | "approved";

/**
 * A role's matrix values. Display only: what a screen offers. Enforcement is always on the
 * server and in the database (RLS, grants, server functions); never use this as access control.
 */
export type RolePermissions = {
  role: OfficeRole;
  status: PermissionValueStatus;
  values: Readonly<Record<PermissionKey, boolean>>;
};
