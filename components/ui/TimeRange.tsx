/**
 * A visit time window, "09:00–10:30". In an RTL paragraph the dash and the two digit runs reorder
 * visually ("10:30–09:00"); an LTR isolate keeps the written order (start on the left). Use it for
 * every start–end pair shown as text; strings for title / aria attributes need no isolate.
 */
export function TimeRange({ start, end }: { start: string; end: string }) {
  return (
    <bdi dir="ltr" className="time-range">
      {start}–{end}
    </bdi>
  );
}
