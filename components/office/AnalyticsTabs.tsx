import Link from "next/link";

// Manager dashboard tabs (D57 (3): "כללי", "טכנאים", "מוצרים וספקים"), in the reference's look: a
// segmented white bar whose selected tab has the soft blue background (styles/ui.css .ma-tabs;
// equal full-width segments when the work area is narrower than 850px). Each tab is a real link
// (UI demo, D53). The page passes only the tabs the role's matrix values offer (display only, G-04).

export type AnalyticsTabLink = {
  key: string;
  label: string;
  href: string;
  /** The selected tab. */
  on: boolean;
  /** The link points at the page being shown (false on the technician's reports view). */
  current?: boolean;
};

export function AnalyticsTabs({ tabs, label = "לשוניות הדשבורד" }: { tabs: readonly AnalyticsTabLink[]; label?: string }) {
  return (
    <div className="ma-tabs-wrap">
      <nav className="ma-tabs" aria-label={label}>
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
    </div>
  );
}
