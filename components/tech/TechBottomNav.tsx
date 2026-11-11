import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarIcon, HomeIcon, UserIcon } from "@/components/ui/Icons";

export type TechTab = "home" | "cal" | "prof";

/** Optional link per tab. A tab with a link is a real link; without one, a button. */
export type TechNavHrefs = Partial<Record<TechTab, string>>;

// Demo techNav(): היום / יומן / פרופיל.
const TABS: { key: TechTab; label: string; icon: ReactNode }[] = [
  { key: "home", label: "היום", icon: <HomeIcon /> },
  { key: "cal", label: "יומן", icon: <CalendarIcon /> },
  { key: "prof", label: "פרופיל", icon: <UserIcon /> },
];

export function TechBottomNav({
  active,
  hrefs,
  current = true,
  tabs,
}: {
  active: TechTab;
  hrefs?: TechNavHrefs;
  /**
   * The tabs to show, in the demo's order; default all three. A screen offers only built screens
   * (Step 2 PR 2.3 start prototype, Q18: "היום" and "פרופיל", no "יומן").
   */
  tabs?: readonly TechTab[];
  /** False when the screen belongs to the tab but is not the tab's page (a visit opened from it): the tab looks selected without aria-current. */
  current?: boolean;
}) {
  return (
    <nav className="ph-nav" aria-label="ניווט ראשי">
      {TABS.filter((tab) => !tabs || tabs.includes(tab.key)).map((tab) => {
        const on = tab.key === active;
        const ariaCurrent = on && current ? "page" : undefined;
        const href = hrefs?.[tab.key];
        return href ? (
          <Link key={tab.key} href={href} className={on ? "on" : undefined} aria-current={ariaCurrent}>
            {tab.icon}
            {tab.label}
          </Link>
        ) : (
          <button
            key={tab.key}
            type="button"
            className={on ? "on" : undefined}
            aria-current={ariaCurrent}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
