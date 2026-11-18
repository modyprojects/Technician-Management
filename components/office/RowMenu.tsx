"use client";

// D76 (owner, 2026-11-18): a row's actions sit in one ⋮ menu, on phone and desktop. The menu is a
// portal with a fixed position under its button, so a scrolling table never clips it and nothing
// overflows the row at 390 px. Keyboard: Enter/Space/ArrowDown on ⋮ opens it on the first item;
// ArrowUp/ArrowDown/Home/End move; Escape closes and returns focus to ⋮; Tab or a click outside
// closes it. Items keep the row buttons' accessible names ("השבתה · החשבון של …").

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem = {
  key: string;
  label: string;
  /** The accessible name, e.g. "עריכה · הפרטים של <name>". */
  name: string;
  danger?: boolean;
};

const MENU_WIDTH = 190;

export function RowMenu({
  id,
  name,
  items,
  onSelect,
  disabled = false,
}: {
  id: string;
  name: string;
  items: RowMenuItem[];
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const place = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top: r.bottom + 4, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  const focusItem = (step: number | "first" | "last") => {
    const list = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = step === "first" ? 0 : step === "last" ? list.length - 1 : (at + step + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="chip row-menu-btn"
        aria-label={`פעולות · ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`פעולות · ${name}`}
            className="row-menu"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                buttonRef.current?.focus();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                focusItem(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                focusItem(-1);
              } else if (e.key === "Home") {
                e.preventDefault();
                focusItem("first");
              } else if (e.key === "End") {
                e.preventDefault();
                focusItem("last");
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={item.danger ? "row-menu-item danger" : "row-menu-item"}
                aria-label={item.name}
                onClick={() => {
                  setOpen(false);
                  onSelect(item.key);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
