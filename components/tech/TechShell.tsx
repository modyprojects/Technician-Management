import type { ReactNode } from "react";
import { TechBottomNav, type TechNavHrefs, type TechTab } from "./TechBottomNav";

// Technician app shell (demo phone(): .ph-head, scrolling .ph-main, optional .ph-foot and
// bottom nav). Full-bleed at every width; the demo's phone frame is not part of the app.
export function TechShell({
  head,
  children,
  foot,
  activeTab,
  activeIsCurrent = true,
  navHrefs,
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
}) {
  return (
    <div className="techwrap">
      <div className="phone">
        <header className="ph-head">{head}</header>
        <main className="ph-main">{children}</main>
        {foot && (
          <div className="ph-foot" role="region" aria-label="פעולות">
            {foot}
          </div>
        )}
        {activeTab && <TechBottomNav active={activeTab} current={activeIsCurrent} hrefs={navHrefs} />}
      </div>
    </div>
  );
}
