"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// Settings tab list (docs/demo.html offSettings() L938-940): the demo's vertical column of tab
// buttons, here real links (UI demo, D53) with aria-current on the open tab. At 900px and below
// it becomes a horizontal scroller above the body (`.scrollx`, styles/ui.css "settings-ops"); the
// open tab is scrolled into the visible part of that row, so a later tab is not hidden off-screen.
// The page passes only the tabs the role is offered (display only, G-04: enforcement is on the
// server and in the database).

export type SettingsTabLink = {
  key: string;
  label: string;
  href: string;
  /** The tab being shown. */
  current: boolean;
};

export function SettingsTabs({ tabs, label = "לשוניות ההגדרות" }: { tabs: readonly SettingsTabLink[]; label?: string }) {
  const nav = useRef<HTMLElement>(null);
  const currentKey = tabs.find((t) => t.current)?.key;

  useEffect(() => {
    const row = nav.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    // Only the row scrolls (never the page): bring the open tab fully into view, with a margin.
    const r = row.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    const margin = 16;
    if (l.left < r.left) row.scrollLeft -= r.left - l.left + margin;
    else if (l.right > r.right) row.scrollLeft += l.right - r.right + margin;
  }, [currentKey]);

  return (
    <nav ref={nav} className="set-tabs scrollx" aria-label={label}>
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
