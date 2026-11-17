"use client";

// "מה לאסוף לפני יציאה" on the real technician home (TE-03, QA T-07), with "נאסף" kept ON THIS DEVICE
// for the day (TEMPORARY): Migrations 1–7 have no table for it (TE-03 asks for "per technician per
// day" on the server; a database object comes with a later migration). The card says so in one line,
// so a tick is never taken for a saved record (G-06). Stored in this browser's localStorage under one
// key per technician and date, holding only "request number/visit number" keys (no customer data);
// keys of other days are removed on every write. Storage that is unavailable (private mode, blocked)
// leaves every item unticked and reports the tick as not kept.
// The whole card is hidden when there is nothing to collect (PickupsCard renders nothing, QA T-07).
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { CommandResult } from "@/features/data-access/common";
import { visitRefKey, type PickupGroup, type VisitRef } from "@/features/visits/data/types";
import { PickupsCard } from "./PickupsCard";

const PREFIX = "tm.pickups.";

/** The visible note: where the ticks are kept. */
export const DEVICE_PICKUPS_NOTE = "הסימון נשמר במכשיר הזה בלבד, להיום.";

/** Fired on this page after every write (the browser's own "storage" event covers other tabs). */
const CHANGED = "tm-pickups-changed";

const keyOf = (technicianId: string, date: string): string => `${PREFIX}${technicianId}.${date}`;

function rawTicks(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function ticksOf(raw: string | null): ReadonlySet<string> {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x.length <= 80) : []);
  } catch {
    return new Set();
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function writeTicks(key: string, ticks: ReadonlySet<string>): boolean {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== key) window.localStorage.removeItem(k);
    }
    window.localStorage.setItem(key, JSON.stringify([...ticks]));
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch {
    return false;
  }
}

export function DevicePickups({
  groups,
  technicianId,
  date,
  placeActions,
}: {
  groups: PickupGroup[];
  technicianId: string;
  date: string;
  placeActions?: Readonly<Record<string, ReactNode>>;
}) {
  const key = keyOf(technicianId, date);
  // The server has no storage: it renders every item unticked, and the browser then reads the day's ticks.
  const raw = useSyncExternalStore(
    subscribe,
    () => rawTicks(key),
    () => null,
  );
  const ticks = useMemo(() => ticksOf(raw), [raw]);

  const withTicks = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        items: g.items.map((x) => ({ ...x, collected: ticks.has(visitRefKey(x.ref)) })),
      })),
    [groups, ticks],
  );

  async function onToggle(ref: VisitRef, collected: boolean): Promise<CommandResult> {
    const next = new Set(ticksOf(rawTicks(key)));
    if (collected) next.add(visitRefKey(ref));
    else next.delete(visitRefKey(ref));
    if (!writeTicks(key, next)) return { ok: false, simulated: false, error: "הסימון לא נשמר במכשיר." };
    return { ok: true, simulated: false };
  }

  return <PickupsCard groups={withTicks} placeActions={placeActions} onToggle={onToggle} note={DEVICE_PICKUPS_NOTE} />;
}
