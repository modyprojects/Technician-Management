"use client";

// D73 (owner, 2026-11-18): the office header on phone (600 px and below) only. The MODY logo on the
// left; a ☰ button on the right opens a drawer from the right with the role's navigation items, the
// signed-in user and "יציאה". No tabs and no "יציאה" button in the top bar. Desktop is unchanged
// (the sidebar). Escape, the ✕ button, a backdrop tap or a link closes the drawer; focus returns to ☰.

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import type { OfficeNavItem } from "./OfficeSidebar";

export function OfficePhoneBar({
  nav,
  activeKey,
  activeIsCurrent = true,
  user,
  signOut,
}: {
  nav: readonly OfficeNavItem[];
  activeKey: string;
  activeIsCurrent?: boolean;
  user: { name: string; roleLabel: string; avatarColor: string };
  signOut?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="ophone">
      <button
        ref={buttonRef}
        type="button"
        className="ophone-menu"
        aria-label="תפריט"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <BrandLogo className="ophone-logo" />
      {open && (
        <div
          className="ophone-bg"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          <div ref={panelRef} className="ophone-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="ophone-head">
              <span id={titleId} className="ophone-who">
                {user.name}
                <small>הרשאה: {user.roleLabel}</small>
              </span>
              <button
                type="button"
                className="xbtn"
                aria-label="סגירה"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <nav className="ophone-nav" aria-label="ניווט ראשי">
              {nav.map((item) => {
                const on = item.key === activeKey;
                const current = on && activeIsCurrent ? "page" : undefined;
                return item.href ? (
                  <Link key={item.key} href={item.href} className={on ? "on" : undefined} aria-current={current} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ) : null;
              })}
            </nav>
            {signOut && <div className="ophone-out">{signOut}</div>}
          </div>
        </div>
      )}
    </header>
  );
}
