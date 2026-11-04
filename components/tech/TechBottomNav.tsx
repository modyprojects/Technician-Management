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
}: {
  active: TechTab;
  hrefs?: TechNavHrefs;
  /** False when the screen belongs to the tab but is not the tab's page (a visit opened from it): the tab looks selected without aria-current. */
  current?: boolean;
}) {
  return (
    <nav className="ph-nav" aria-label="ניווט ראשי">
      {TABS.map((tab) => {
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
