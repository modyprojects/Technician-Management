import type { CallStatus } from "@/components/ui/CallStatusPill";

// Calls-list search and filters (docs/demo.html offCalls(), L816-822): a search box and a
// technician select on one row, status chips with counts below. Controlled and presentational:
// the parent owns the values and does the filtering (production: on the server, OF-04).
// The status chips use the service-call status (OF-17, D38), not the last visit's status.
// Render it inside a client component (it takes change handlers).

/** "all" or a service-call status. */
export type CallStatusFilter = "all" | CallStatus;

export type CallStatusOption = { key: CallStatusFilter; label: string; count: number };

export type CallTechOption = { id: string; name: string };

export const ALL_TECHS = "all";

export function CallFilters({
  query,
  onQueryChange,
  searchPlaceholder = "חיפוש לפי שם, טלפון, מספר פנייה, מספר לקוח או מק״ט",
  tech,
  techOptions,
  onTechChange,
  status,
  statusOptions,
  onStatusChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchPlaceholder?: string;
  /** Selected technician id, or ALL_TECHS. */
  tech: string;
  techOptions: readonly CallTechOption[];
  onTechChange: (tech: string) => void;
  status: CallStatusFilter;
  statusOptions: readonly CallStatusOption[];
  onStatusChange: (status: CallStatusFilter) => void;
}) {
  return (
    <>
      <div role="search" aria-label="חיפוש וסינון קריאות" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="חיפוש קריאות"
          enterKeyHint="search"
          autoComplete="off"
          style={{ flex: 1, minWidth: 220, padding: "10px 14px" }}
        />
        <select value={tech} onChange={(e) => onTechChange(e.target.value)} aria-label="סינון לפי טכנאי">
          <option value={ALL_TECHS}>כל הטכנאים</option>
          {techOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div role="group" aria-label="סינון לפי סטטוס קריאה" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {statusOptions.map((o) => {
          const on = o.key === status;
          return (
            <button
              key={o.key}
              type="button"
              className={on ? "chip on" : "chip"}
              aria-pressed={on}
              onClick={() => onStatusChange(o.key)}
            >
              {o.label}{" "}
              <span style={{ opacity: 0.6 }} className="num">
                {o.count}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
