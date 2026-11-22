import type { TechnicianRef } from "@/features/reference/data/types";

// The desktop technician filter of "יומן טכנאים" (owner review 22.11, batch 2): ONE "טכנאים ▾"
// button that opens a list with a checkbox per technician and "כולם" (multi-select; default: all).
// The selection lives in the address as `?techs=id1,id2`: absent = all; unknown ids are ignored;
// nothing left after that = all; every technician chosen = all (the parameter is dropped). The phone
// keeps its single "בחר טכנאי" dropdown (`?tech=`, D97). Pure: the page passes the technicians it read.

/** The address parameter of the desktop selection. */
export const TECHS_PARAM = "techs";

/** The most ids read from the address (bounded; the technicians read are capped as well). */
const MAX_IDS = 200;

/**
 * The chosen technicians in the order of `technicians` (by name), or null for all: absent, empty,
 * only unknown ids, or every technician chosen.
 */
export function parseTechs(raw: string | string[] | undefined, technicians: readonly Pick<TechnicianRef, "id">[]): string[] | null {
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (!value) return null;
  const asked = new Set(value.split(",", MAX_IDS).map((s) => s.trim()).filter(Boolean));
  const chosen = technicians.filter((t) => asked.has(t.id)).map((t) => t.id);
  if (chosen.length === 0 || chosen.length === technicians.length) return null;
  return chosen;
}

/** The `techs` value for a selection (null = all: no parameter). */
export function techsParamOf(chosen: readonly string[] | null, technicians: readonly Pick<TechnicianRef, "id">[]): string | null {
  if (chosen === null) return null;
  const set = new Set(chosen);
  const ids = technicians.filter((t) => set.has(t.id)).map((t) => t.id);
  return ids.length === 0 || ids.length === technicians.length ? null : ids.join(",");
}

/** The button's text: "כל הטכנאים", the technician's name when exactly one, else "N טכנאים". */
export function techsLabelOf(chosen: readonly string[] | null, technicians: readonly Pick<TechnicianRef, "id" | "name">[]): string {
  if (chosen === null) return "כל הטכנאים";
  if (chosen.length === 1) return technicians.find((t) => t.id === chosen[0])?.name ?? "טכנאי אחד";
  return `${chosen.length} טכנאים`;
}
