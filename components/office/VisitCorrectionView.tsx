import type { VisitCorrection, VisitCorrectionHistory } from "@/features/visits/data/types";

// The call card's view of a closed visit's corrections (OF-10, D14): what VisitCorrections and
// VisitCorrectionDialog need of VisitCorrectionHistory, with the corrector's name instead of the
// account (no account id reaches the browser through the card: phase E policy P1, account ids
// only on account screens) and the times as labels. Server-safe (no "use client"): the page builds
// the view and passes it to the client part.

/** One listed correction as the card shows it (the DTO's values and test marker; who by name, when as a label). */
export type VisitCorrectionRow = Pick<VisitCorrection, "id" | "field" | "after" | "reason" | "isTest"> & {
  byName: string;
  /** "היום 17:42" (formatted by the page, Asia/Jerusalem). */
  atLabel: string;
};

/** What the card and the dialog need of a VisitCorrectionHistory. */
export type VisitCorrectionView = Pick<VisitCorrectionHistory, "req" | "n" | "version" | "status" | "original" | "current" | "correctable"> & {
  /** Newest first, as the layer returns them (bounded). */
  rows: readonly VisitCorrectionRow[];
  /** Every correction of the visit (more than `rows` when the list was cut). */
  total: number;
};

/** The card's view of a history: names instead of account ids, times as labels. */
export function visitCorrectionView(h: VisitCorrectionHistory, atLabel: (iso: string) => string): VisitCorrectionView {
  return {
    req: h.req,
    n: h.n,
    version: h.version,
    status: h.status,
    original: h.original,
    current: h.current,
    correctable: h.correctable,
    rows: h.corrections.items.map((x) => ({
      id: x.id,
      field: x.field,
      after: x.after,
      reason: x.reason,
      isTest: x.isTest,
      byName: x.by.name,
      atLabel: atLabel(x.at),
    })),
    total: h.corrections.total,
  };
}
