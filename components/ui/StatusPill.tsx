// Visit status pill (docs/demo.html ST map and pill()).

export const VISIT_STATUSES = {
  new: { label: "שובצה", bg: "var(--s-new-bg)", fg: "var(--s-new-fg)" },
  go: { label: "בדרך", bg: "var(--s-go-bg)", fg: "var(--s-go-fg)" },
  work: { label: "בטיפול", bg: "var(--s-work-bg)", fg: "var(--s-work-fg)" },
  done: { label: "טופל", bg: "var(--s-done-bg)", fg: "var(--s-done-fg)" },
  cont: { label: "המשך טיפול", bg: "var(--s-cont-bg)", fg: "var(--s-cont-fg)" },
  cancel: { label: "בוטלה", bg: "var(--s-cancel-bg)", fg: "var(--s-cancel-fg)" },
} as const;

export type VisitStatus = keyof typeof VISIT_STATUSES;

export function StatusPill({ status, extra = "" }: { status: VisitStatus; extra?: string }) {
  const s = VISIT_STATUSES[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      {s.label}
      {extra}
    </span>
  );
}
