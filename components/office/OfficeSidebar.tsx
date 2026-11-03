import Link from "next/link";

/** A navigation item. With `href` it is a real link; without it, a button (Step 0 showcase). */
export type OfficeNavItem = { key: string; label: string; href?: string };

export function OfficeSidebar({
  nav,
  activeKey,
  user,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  user: { name: string; roleLabel: string; avatarColor: string };
}) {
  return (
    <aside className="side">
      <div className="logo">ניהול טכנאים</div>
      <nav className="nav" aria-label="ניווט ראשי">
        {nav.map((item) => {
          const on = item.key === activeKey;
          return item.href ? (
            <Link
              key={item.key}
              href={item.href}
              className={on ? "on" : undefined}
              aria-current={on ? "page" : undefined}
            >
              {item.label}
            </Link>
          ) : (
            <button
              key={item.key}
              type="button"
              className={on ? "on" : undefined}
              aria-current={on ? "page" : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="me">
        <span className="av" style={{ background: user.avatarColor }} aria-hidden="true">
          {user.name.slice(0, 1)}
        </span>
        <span>
          {user.name}
          <small>הרשאה: {user.roleLabel}</small>
        </span>
      </div>
    </aside>
  );
}
