import type { ReactNode } from "react";
import { OfficePhoneBar } from "./OfficePhoneBar";
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
  phoneSignOut,
  children,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  /** False when `activeKey` is the item the open screen belongs to, not its own (no aria-current). */
  activeIsCurrent?: boolean;
  user: { name: string; roleLabel: string; avatarColor: string };
  /** The sign-out control in the sidebar's user block (Step 2 PR 2.3, Q4; OfficeSidebar). */
  signOut?: ReactNode;
  /**
   * D73 (owner, 2026-11-18): the real office passes its sign-out control for the phone drawer; then
   * at 600 px and below the sidebar gives way to OfficePhoneBar (logo left, ☰ right). The /dev/demo
   * showcase passes nothing and keeps its layout.
   */
  phoneSignOut?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={phoneSignOut ? "office office-phonebar" : "office"}>
      {phoneSignOut && <OfficePhoneBar nav={nav} activeKey={activeKey} activeIsCurrent={activeIsCurrent} user={user} signOut={phoneSignOut} />}
      <OfficeSidebar nav={nav} activeKey={activeKey} activeIsCurrent={activeIsCurrent} user={user} signOut={signOut} />
      <main className="work">{children}</main>
    </div>
  );
}
