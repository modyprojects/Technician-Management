import Link from "next/link";

// Settings tab list (docs/demo.html offSettings() L938-940): the demo's vertical column of tab
// buttons, here real links (UI demo, D53) with aria-current on the open tab. At 900px and below
// it becomes a horizontal scroller above the body (styles/ui.css "settings-ops"). The page passes
// only the tabs the role is offered (display only, G-04: enforcement is on the server and in the
// database).

export type SettingsTabLink = {
  key: string;
  label: string;
  href: string;
  /** The tab being shown. */
  current: boolean;
};

export function SettingsTabs({ tabs, label = "לשוניות ההגדרות" }: { tabs: readonly SettingsTabLink[]; label?: string }) {
  return (
    <nav className="set-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          prefetch={false}
          className={t.current ? "on" : undefined}
          aria-current={t.current ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
