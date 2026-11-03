// Service-call status pill (demo-deviations OF-17, D38): the calls-list status chips and the
// office call-card header show the call's own status, not the last visit's. Visit pills keep
// the demo's visit statuses (StatusPill).
// The colours of "פתוחה" (accent) and "ממתינה לשיבוץ" (warning) are new visual elements in the
// demo's language, pending the owner's visual approval (OF-17); the other two reuse the
// matching visit-status colours.

export const CALL_STATUSES = {
  open: { label: "פתוחה", c: "var(--accent)", bg: "var(--accent-l)", fg: "var(--accent-d)" },
  awaiting: { label: "ממתינה לשיבוץ", c: "var(--warn-bd)", bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  followup: { label: "המשך טיפול", c: "var(--s-cont)", bg: "var(--s-cont-bg)", fg: "var(--s-cont-fg)" },
  resolved: { label: "טופלה", c: "var(--s-done)", bg: "var(--s-done-bg)", fg: "var(--s-done-fg)" },
} as const;

export type CallStatus = keyof typeof CALL_STATUSES;

/** Display order of the calls-list status chips (OF-17 lists them in this order). */
export const CALL_STATUS_ORDER: readonly CallStatus[] = ["open", "awaiting", "followup", "resolved"];

export function CallStatusPill({ status, extra = "" }: { status: CallStatus; extra?: string }) {
  const s = CALL_STATUSES[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      {s.label}
      {extra}
    </span>
  );
}
