export function Segmented({
  options,
  selected,
  label,
}: {
  options: readonly string[];
  selected: number;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option}
          type="button"
          className={i === selected ? "on" : undefined}
          aria-pressed={i === selected}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
