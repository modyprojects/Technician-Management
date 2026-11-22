"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

// The desktop technician filter of "יומן טכנאים" (owner review 22.11, batch 2): ONE button,
// "טכנאים ▾", showing the selection ("כל הטכנאים", the name when exactly one, else "N טכנאים"),
// that opens a list with "כולם" and a checkbox per technician (multi-select; default: all). Each
// change navigates to the calendar address with `?techs=` (built from `baseHref`, which the server
// built without it); the server reads and checks the selection again. Nothing is edited (D94 (e)).
// Keyboard: the button opens and closes the list, Tab moves between the checkboxes, Space toggles,
// Escape closes and returns focus to the button; a click outside closes it. The list is rendered
// only while open. The phone keeps its "בחר טכנאי" dropdown (D97).

export type TechFilterOption = { id: string; name: string; color: string };

/** `baseHref` with `techs` set to `ids` (all: the parameter is dropped). */
function hrefOf(baseHref: string, ids: readonly string[], all: boolean): string {
  const [path = "", query = ""] = baseHref.split("?");
  const q = new URLSearchParams(query);
  q.delete("techs");
  if (!all) q.set("techs", ids.join(","));
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function TechFilter({
  options,
  chosen,
  label,
  baseHref,
}: {
  /** Every technician shown, by name. */
  options: readonly TechFilterOption[];
  /** The chosen ids; null = all. */
  chosen: readonly string[] | null;
  /** The button's text for the selection (features/office-calendar/data/tech-filter.ts techsLabelOf). */
  label: string;
  /** The calendar address without `techs`. */
  baseHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>(chosen ?? options.map((o) => o.id));
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const chosenKey = chosen === null ? "*" : chosen.join(",");

  // A new address (back / forward, another link) brings a new selection from the server.
  const [synced, setSynced] = useState(chosenKey);
  if (synced !== chosenKey) {
    setSynced(chosenKey);
    setSelected(chosen ?? options.map((o) => o.id));
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = selected.length === options.length;
  const apply = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const ordered = options.filter((o) => ids.includes(o.id)).map((o) => o.id);
    setSelected(ordered);
    router.push(hrefOf(baseHref, ordered, ordered.length === options.length), { scroll: false });
  };

  return (
    <div className="otc-filter" ref={wrap} data-tech-filter="">
      <button
        ref={button}
        type="button"
        className="btn otc-filter-btn"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sub" style={{ fontWeight: 700 }}>
          טכנאים:
        </span>{" "}
        <span data-tech-filter-label="">{label}</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={listId} className="otc-pop" role="group" aria-label="בחירת טכנאים">
          <label className="otc-opt otc-opt-all">
            <input
              type="checkbox"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = !all;
              }}
              onChange={() => apply(options.map((o) => o.id))}
            />
            כולם
          </label>
          <ul className="otc-opts">
            {options.map((o) => {
              const on = selected.includes(o.id);
              const last = on && selected.length === 1;
              return (
                <li key={o.id}>
                  <label className="otc-opt" title={last ? "יש לבחור לפחות טכנאי אחד" : undefined}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={last}
                      value={o.id}
                      onChange={() => apply(on ? selected.filter((id) => id !== o.id) : [...selected, o.id])}
                    />
                    <span className="dot" style={{ background: o.color }} aria-hidden="true" />
                    <span className="otc-opt-name">{o.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
