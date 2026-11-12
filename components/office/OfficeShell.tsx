import type { ReactNode } from "react";
import { OfficeSidebar, type OfficeNavItem } from "./OfficeSidebar";

// Office shell (demo renderOffice()): dark sidebar on the right, work area beside it.
// At <=900px the sidebar becomes a wrapping top bar (styles/ui.css). Nav items with an
// `href` render as links; items without one render as buttons (Step 0 showcase). `signOut` is the
// caller's sign-out control (Step 2 PR 2.3, Q4): never a fake action here.
export type { OfficeNavItem };

export function OfficeShell({
  nav,
  activeKey,
  activeIsCurrent,
  user,
  signOut,
  children,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  /** False when `activeKey` is the item the open screen belongs to, not its own (no aria-current). */
  activeIsCurrent?: boolean;
  user: { name: string; roleLabel: string; avatarColor: string };
  /** The sign-out control in the sidebar's user block (Step 2 PR 2.3, Q4; OfficeSidebar). */
  signOut?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="office">
      <OfficeSidebar nav={nav} activeKey={activeKey} activeIsCurrent={activeIsCurrent} user={user} signOut={signOut} />
      <main className="work">{children}</main>
    </div>
  );
}
