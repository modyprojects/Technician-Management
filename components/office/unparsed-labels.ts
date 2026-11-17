// The names of the reasons on "זימונים שלא נקלטו" (QA S-05) and in the simulator's result
// (components/office/InvitationSimulator.tsx). Pure: shared by the server list and the client dialog.
import type { UnparsedProblem, UnparsedProblemKind, UnparsedTechnicianReason } from "@/features/calendar/data/types";

/** The problem kinds as the screen names them (a technician problem is named by its reason). */
export const UNPARSED_PROBLEM_LABELS = {
  missing: "חסר שדה חובה",
  "unknown-place": "מקום איסוף לא מוכר",
  invalid: "ערך לא תקין",
  technician: "טכנאי לא זוהה",
  conflict: "סתירה לנתונים קיימים",
} as const satisfies Record<UnparsedProblemKind, string>;

/** "טכנאי לא זוהה" says why: no match, an inactive technician, or more than one technician. */
export const UNPARSED_TECHNICIAN_LABELS = {
  unknown: "טכנאי לא זוהה",
  inactive: "טכנאי לא פעיל",
  ambiguous: "יותר מטכנאי אחד",
} as const satisfies Record<UnparsedTechnicianReason, string>;

/** The pill of one problem. */
export const problemKindLabel = (problem: UnparsedProblem): string =>
  problem.kind === "technician" ? UNPARSED_TECHNICIAN_LABELS[problem.reason] : UNPARSED_PROBLEM_LABELS[problem.kind];

