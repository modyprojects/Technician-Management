import Link from "next/link";

// Manager dashboard tabs (docs/demo.html offDash() ".tabs", L865): כללי / טכנאים / מוצרים וספקים.
// The demo switches tabs with buttons over in-memory state; here each tab is a real link (UI demo,
// D53), styled like the demo's tab buttons (styles/ui.css "manager-analytics", .ma-tab). The page
// passes only the tabs the role's matrix values offer (display only, G-04).

export type AnalyticsTabLink = {
  key: string;
  label: string;
  href: string;
  /** The selected tab (underlined). */
  on: boolean;
  /** The link points at the page being shown (false while the technician drill-down is open). */
  current?: boolean;
};

export function AnalyticsTabs({ tabs, label = "לשוניות הדשבורד" }: { tabs: readonly AnalyticsTabLink[]; label?: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          prefetch={false}
          className={t.on ? "ma-tab on" : "ma-tab"}
          aria-current={t.current ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
