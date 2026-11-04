"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

// A dashboard table row that opens the call card (the demo's tr.click data-act="openCard", L889).
// The request-number cell holds the real link (keyboard, middle click, new tab); this only makes
// a plain click anywhere else on the row follow it, like CallsTable. Clicks on links or controls,
// modified clicks and text selection are left to the browser.
export function DashboardRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();

  function open(e: MouseEvent<HTMLTableRowElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest("a, button, input, select, textarea")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  return (
    <tr className="click" onClick={open}>
      {children}
    </tr>
  );
}
