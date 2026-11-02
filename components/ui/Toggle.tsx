// Visual toggle (.tog). Step 0 shows its states only; it is wired to settings in later steps.
export function Toggle({
  on,
  label,
  disabled = false,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={on ? "tog on" : "tog"}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
    />
  );
}
