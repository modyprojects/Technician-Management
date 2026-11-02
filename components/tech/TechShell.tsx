import type { ReactNode } from "react";
import { TechBottomNav, type TechTab } from "./TechBottomNav";

// Technician app shell (demo phone(): .ph-head, scrolling .ph-main, optional .ph-foot and
// bottom nav). Full-bleed at every width; the demo's phone frame is not part of the app.
export function TechShell({
  head,
  children,
  foot,
  activeTab,
}: {
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  activeTab?: TechTab;
}) {
  return (
    <div className="techwrap">
      <div className="phone">
        <header className="ph-head">{head}</header>
        <main className="ph-main">{children}</main>
        {foot && <div className="ph-foot">{foot}</div>}
        {activeTab && <TechBottomNav active={activeTab} />}
      </div>
    </div>
  );
}
