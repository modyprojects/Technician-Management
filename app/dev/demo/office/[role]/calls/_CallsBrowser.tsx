"use client";

// FICTITIOUS DATA ONLY (G-05): the calls list's client state for the UI demo (D53). Receives the
// demo's calls as prepared rows and filters them in the browser, as the demo's callsTable() does.
// Production searches and pages on the server (OF-04); this file is demo wiring only.
import { useMemo, useState } from "react";
import {
  ALL_TECHS,
  CallFilters,
  type CallStatusFilter,
  type CallStatusOption,
  type CallTechOption,
} from "@/components/office/CallFilters";
import { CallsTable, type CallsTableRow } from "@/components/office/CallsTable";

/** A table row plus the fields the demo filters on. */
export type DemoCallRow = CallsTableRow & { techId: string; phone: string };

/** The demo's 40-row cap ("מציג 40 מתוך …"). */
const MAX_ROWS = 40;

const digitsOf = (s: string): string => s.replace(/\D/g, "");

/**
 * The demo's search (request number, customer, phone, SKU, city) plus customer number (OF-05) and
 * product name. Case-insensitive, so "kt-2041" finds "KT-2041" (PR-07); a phone typed without
 * dashes also matches.
 */
function matchesSearch(r: DemoCallRow, query: string): boolean {
  const q = query.trim().toUpperCase();
  if (!q) return true;
  if ([r.req, r.customerNo, r.customer, r.phone, r.sku, r.product, r.city].some((x) => x.toUpperCase().includes(q))) {
    return true;
  }
  const digits = digitsOf(q);
  return /^[\d\s-]+$/.test(q) && digits.length >= 3 && digitsOf(r.phone).includes(digits);
}

export function CallsBrowser({
  rows,
  statusOptions,
  techOptions,
}: {
  /** Every call, newest first. */
  rows: readonly DemoCallRow[];
  statusOptions: readonly CallStatusOption[];
  techOptions: readonly CallTechOption[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CallStatusFilter>("all");
  const [tech, setTech] = useState<string>(ALL_TECHS);

  const matches = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === "all" || r.status === status) &&
          (tech === ALL_TECHS || r.techId === tech) &&
          matchesSearch(r, query),
      ),
    [rows, status, tech, query],
  );

  return (
    <>
      <CallFilters
        query={query}
        onQueryChange={setQuery}
        tech={tech}
        techOptions={techOptions}
        onTechChange={setTech}
        status={status}
        statusOptions={statusOptions}
        onStatusChange={setStatus}
      />
      <CallsTable rows={matches.slice(0, MAX_ROWS)} total={matches.length} />
    </>
  );
}
