export function Tabs({
  tabs,
  selected,
  label,
}: {
  tabs: readonly string[];
  selected: number;
  label: string;
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab}
          type="button"
          className={i === selected ? "on" : undefined}
          aria-pressed={i === selected}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
