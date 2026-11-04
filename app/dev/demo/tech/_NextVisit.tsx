"use client";

// The home screen's next-visit card with its live status: "יוצא · Waze" runs the depart command
// (TE-02) through VisitStatusProvider; the schedule list's pill for the same visit follows.
import { NextVisitCard } from "@/components/tech/NextVisitCard";
import type { TechDayVisit } from "@/features/visits/data/types";
import { useVisitStatus } from "./_VisitStatus";

export function NextVisit({ visit, detailsHref }: { visit: TechDayVisit; detailsHref: string }) {
  const live = useVisitStatus({ req: visit.req, n: visit.n }, visit.status);
  return (
    <NextVisitCard
      visit={visit}
      status={live.status}
      detailsHref={detailsHref}
      onDepart={() => void live.depart()}
      error={live.error}
    />
  );
}
