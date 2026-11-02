export function Kpi({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail?: string;
  color?: string;
}) {
  return (
    <div className="card kpi">
      <div className="l">{label}</div>
      <div className="v num" style={color ? { color } : undefined}>
        {value}
      </div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}
