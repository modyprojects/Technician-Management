export type OfficeNavItem = { key: string; label: string };

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
        {nav.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === activeKey ? "on" : undefined}
            aria-current={item.key === activeKey ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}
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
