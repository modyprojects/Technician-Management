import { BellIcon } from "@/components/ui/Icons";

// Technician home header (demo techHome() head, TE-01): date, greeting, avatar, bell, counters.
export function TechHomeHeader({
  dateLine,
  greeting,
  initial,
  avatarColor,
  unread,
  visitsToday,
  completed,
}: {
  dateLine: string;
  greeting: string;
  initial: string;
  avatarColor: string;
  unread: number;
  visitsToday: number;
  completed: number;
}) {
  return (
    <>
      <div className="sub" style={{ color: "var(--on-dark2)" }}>
        {dateLine}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 2,
        }}
      >
        <h1 style={{ fontSize: 22 }}>{greeting}</h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: avatarColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            {initial}
          </span>
          <button
            type="button"
            aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"}
            style={{
              position: "relative",
              border: 0,
              background: "var(--ink2)",
              color: "var(--on-dark)",
              width: 36,
              height: 36,
              borderRadius: "50%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <BellIcon />
            {unread > 0 && (
              <span
                className="num"
                style={{
                  position: "absolute",
                  top: -3,
                  left: -3,
                  background: "var(--danger)",
                  color: "var(--on-dark)",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 18,
                  height: 18,
                  padding: "0 4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {unread}
              </span>
            )}
          </button>
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div className="stat">
          <b className="num">{visitsToday}</b>
          <span>ביקורים היום</span>
        </div>
        <button type="button" className="stat">
          <b className="num">{completed}</b>
          <span>הושלמו ›</span>
        </button>
      </div>
    </>
  );
}
