// The manager dashboard's loading state (spec-final §6.10), inside the unchanged office frame (the
// sidebar and logo stay; analytics/layout.tsx renders the frame). It mirrors the page's blocks with
// the page's own classes, so nothing moves when the dashboard replaces it (D57 review UI-03): the
// title bar (the same heading, sub line and date; the loading text sits where the actions are, at
// the actions' height), the "נתוני בדיקה" note's box when the caller says the data is test data, the
// tab bar, and inside .ma-dash (its gap) the section heads, the tile grid (.ma-skel-kpis shares the
// real grid's columns and tile min-heights), the progress card, the two highlight cards and the chart
// card.
// Accessibility (UI-14): the visible text is a role="status" outside the busy region, so it is
// announced; aria-busy marks the placeholder region only, whose blocks are decorative.
// Server Component; no data. The pulse stops with prefers-reduced-motion.

export function DashboardSkeleton({ date, testNote = false }: { date?: string; testNote?: boolean }) {
  const head = (
    <div className="ma-sec-head" aria-hidden="true">
      <span className="ma-skel-block ma-skel-head" />
    </div>
  );
  const tiles = (
    <div className="ma-skel-kpis" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="kpi ma-skel-block" />
      ))}
    </div>
  );
  return (
    <>
      <div className="ptitle">
        <div>
          <h1>סקירה ניהולית</h1>
          <div className="sub">MODY · מערכת ניהול טכנאים</div>
        </div>
        <div className="od-title-actions" style={{ alignItems: "center" }}>
          {date && <span className="sub">{date}</span>}
          <p role="status" className="sub ma-skel-status">
            טוען את הדשבורד…
          </p>
        </div>
      </div>
      {testNote && (
        // The note's own box with its text hidden: the same height at every width.
        <div className="od-test-note ma-skel-note" aria-hidden="true">
          <span>🧪</span>
          <b>נתוני בדיקה</b>
          <span>המספרים והרשימות כוללים נתוני בדיקה (סביבת בדיקה)</span>
        </div>
      )}
      <div className="ma-tabs-wrap" aria-hidden="true">
        <div className="ma-skel-block ma-skel-tabs" />
      </div>
      <div className="ma-dash ma-skel" aria-busy="true">
        <div className="ma-section">
          {head}
          {tiles}
          <div className="ma-card ma-skel-block ma-skel-progress" aria-hidden="true" />
        </div>
        <div className="ma-section">
          {head}
          {tiles}
        </div>
        <div className="ma-section">
          {head}
          <div className="ma-two" aria-hidden="true">
            <div className="ma-card ma-skel-block ma-skel-card" />
            <div className="ma-card ma-skel-block ma-skel-card" />
          </div>
        </div>
        <div className="ma-card ma-skel-block ma-skel-chart" aria-hidden="true" />
      </div>
    </>
  );
}
