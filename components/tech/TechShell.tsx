import type { ReactNode } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { TechBottomNav, type TechNavHrefs, type TechTab } from "./TechBottomNav";

// Technician app shell (demo phone(): .ph-head, scrolling .ph-main, optional .ph-foot and
// bottom nav). Full-bleed at every width; the demo's phone frame is not part of the app.
// D57 (6): the white MODY logo is the dark header's first row, at the end side (left in RTL,
// opposite the Hebrew titles), above every screen's own header content; no light strip.
export function TechShell({
  head,
  children,
  foot,
  activeTab,
  activeIsCurrent = true,
  navHrefs,
  navTabs,
}: {
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  /** Shows the bottom navigation with this tab selected; omit for screens without it. */
  activeTab?: TechTab;
  /** False on a screen opened from the tab (not the tab's own page): no aria-current. */
  activeIsCurrent?: boolean;
  /** Optional link per bottom-navigation tab; tabs without one render as buttons. */
  navHrefs?: TechNavHrefs;
  /** The bottom-navigation tabs to show (default all three; TechBottomNav `tabs`). */
  navTabs?: readonly TechTab[];
}) {
  return (
    <div className="techwrap">
      <div className="phone">
        <header className="ph-head">
          <div className="ph-brand">
            <BrandLogo className="brand-logo-tech" />
          </div>
          {head}
        </header>
        <main className="ph-main">{children}</main>
        {foot && (
          <div className="ph-foot" role="region" aria-label="פעולות">
            {foot}
          </div>
        )}
        {activeTab && <TechBottomNav active={activeTab} current={activeIsCurrent} hrefs={navHrefs} tabs={navTabs} />}
      </div>
    </div>
  );
}
