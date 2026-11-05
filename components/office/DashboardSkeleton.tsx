// The manager dashboard's loading state (spec-final §6.10): placeholders for the title bar, the tab
// bar, four tiles, two cards and the chart, with the block heights of the real layout, inside the
// unchanged office frame (the sidebar and logo stay; analytics/layout.tsx renders the frame). Server
// Component; no data. The pulse stops with prefers-reduced-motion.

export function DashboardSkeleton() {
  return (
    <div className="ma-dash ma-skel" aria-busy="true" aria-live="polite">
      <p className="sub" style={{ margin: 0 }}>
        טוען את הדשבורד…
      </p>
      <div className="ma-skel-block" style={{ height: 44, width: "min(340px, 100%)" }} aria-hidden="true" />
      <div className="ma-skel-tiles" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ma-skel-block" style={{ height: 98 }} />
        ))}
      </div>
      <div className="ma-skel-block" style={{ height: 96 }} aria-hidden="true" />
      <div className="ma-two" aria-hidden="true">
        <div className="ma-skel-block" style={{ height: 180 }} />
        <div className="ma-skel-block" style={{ height: 180 }} />
      </div>
      <div className="ma-skel-block" style={{ height: 330 }} aria-hidden="true" />
    </div>
  );
}
