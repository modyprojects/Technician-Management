import type { ReactNode } from "react";
import { CalendarIcon, HomeIcon, UserIcon } from "@/components/ui/Icons";

export type TechTab = "home" | "cal" | "prof";

// Demo techNav(): היום / יומן / פרופיל.
const TABS: { key: TechTab; label: string; icon: ReactNode }[] = [
  { key: "home", label: "היום", icon: <HomeIcon /> },
  { key: "cal", label: "יומן", icon: <CalendarIcon /> },
  { key: "prof", label: "פרופיל", icon: <UserIcon /> },
];

export function TechBottomNav({ active }: { active: TechTab }) {
  return (
    <nav className="ph-nav" aria-label="ניווט ראשי">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.key === active ? "on" : undefined}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
