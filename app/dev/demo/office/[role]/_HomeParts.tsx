import type { ReactNode } from "react";
import { ALL, callsListHref } from "@/features/calls/data/search-params";
import type { CallStatus } from "@/features/calls/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { OfficeRole } from "@/features/reference/data/types";
import { dayName, ddmm } from "../../_data/dates";
import { workQueueScreensOffered } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

// Shared parts of the office home screens (manager "לוח בקרה", customer service "בית").

/** Call-card and calls-list links of a role. Every list link is a real calls-list URL (OF-04). */
export function homeLinks(role: OfficeRole) {
  return {
    call: (req: string): string => demoHref.call(role, req),
    calls: (): string => demoHref.calls(role),
    /** The calls list filtered by one service-call status (?status=…). */
    callsWith: (status: CallStatus): string => callsListHref(demoHref.calls(role), { q: "", status, tech: ALL, page: 1 }),
    /**
     * "חזרו מהשטח" (OF-16): every follow-up that still needs a new visit; null where the screen is
     * not offered (the temporary #15 rule, workQueueScreensOffered; display only, G-04).
     */
    backFromField: workQueueScreensOffered(role) ? demoHref.backFromField(role) : null,
  };
}

/** "יום רביעי 21.10.2026". */
export const longDate = (date: IsoDate): string => `יום ${dayName(date)} ${ddmm(date)}.${date.slice(0, 4)}`;

/** The demo's page title row (.ptitle): heading, date line, actions on the other side. */
export function HomeTitle({ title, date, sub, actions }: { title: string; date: IsoDate; sub: string; actions?: ReactNode }) {
  return (
    <div className="ptitle">
      <div>
        <h1>{title}</h1>
        <div className="sub">
          {longDate(date)} · {sub}
        </div>
      </div>
      {actions && <div className="od-title-actions">{actions}</div>}
    </div>
  );
}
