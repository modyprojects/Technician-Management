import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";

/** A navigation item. With `href` it is a real link; without it, a button (Step 0 showcase). */
export type OfficeNavItem = { key: string; label: string; href?: string };

export function OfficeSidebar({
  nav,
  activeKey,
  activeIsCurrent = true,
  user,
  signOut,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  /**
   * False when the open screen has no item of its own and `activeKey` names the item it belongs
   * to (D57: a screen of the "מסכים נוספים" row belongs to "קריאות"): the item is highlighted but
   * is not the current page, so it gets no aria-current (precedent: TechShell's bottom navigation).
   */
  activeIsCurrent?: boolean;
  user: { name: string; roleLabel: string; avatarColor: string };
  /**
   * "יציאה" (Step 2 PR 2.3, Q4 TEMPORARY; AU-02): the caller's sign-out control, the last child of
   * the user block. The real app (PR 2.5) passes a `<form action={signOut}>` button; the showcase
   * passes nothing. At 900 px and below only this control stays, at the end of the top bar
   * (styles/ui.css); without it the block shows nothing there.
   */
  signOut?: ReactNode;
}) {
  return (
    <aside className="side">
      {/* D57 (6): the white MODY logo at the top of the dark sidebar (and of its narrow top bar);
          the product name stays under it, visually hidden at 900 px and below (styles/ui.css). */}
      <div className="logo brand">
        <BrandLogo className="brand-logo" />
        <span className="brand-name">ניהול טכנאים</span>
      </div>
      <nav className="nav" aria-label="ניווט ראשי">
        {nav.map((item) => {
          const on = item.key === activeKey;
          const current = on && activeIsCurrent ? "page" : undefined;
          return item.href ? (
            <Link key={item.key} href={item.href} className={on ? "on" : undefined} aria-current={current}>
              {item.label}
            </Link>
          ) : (
            <button key={item.key} type="button" className={on ? "on" : undefined} aria-current={current}>
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="me">
        <span className="av" style={{ background: user.avatarColor }} aria-hidden="true">
          {user.name.slice(0, 1)}
        </span>
        <span className="me-who">
          {user.name}
          <small>הרשאה: {user.roleLabel}</small>
        </span>
        {signOut}
      </div>
    </aside>
  );
}
