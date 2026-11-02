import type { ReactNode } from "react";
import { OfficeSidebar, type OfficeNavItem } from "./OfficeSidebar";

// Office shell (demo renderOffice()): dark sidebar on the right, work area beside it.
// At <=900px the sidebar becomes a wrapping top bar (styles/ui.css).
export function OfficeShell({
  nav,
  activeKey,
  user,
  children,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  user: { name: string; roleLabel: string; avatarColor: string };
  children: ReactNode;
}) {
  return (
    <div className="office">
      <OfficeSidebar nav={nav} activeKey={activeKey} user={user} />
      <main className="work">{children}</main>
    </div>
  );
}
