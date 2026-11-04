// Maps the layer's call DTOs (features/calls/data/types) to the props of
// components/office/CallDetail: labels, links and the demo's date formatting. No fixture data.
import type { CallAssignment, CallDetailData, CallDetailTech } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { CallDetail, CallStatus, CallSummary } from "@/features/calls/data/types";
import type { OfficeRole, TechnicianRef } from "@/features/reference/data/types";
import { isOpenVisitStatus, type VisitRecord } from "@/features/visits/data/types";
import { dayAndDate, dayLabel, recLabel, TODAY, toMin } from "../../../../_data/dates";
import { demoHref } from "../../../../_data/routes";

const techInfo = (t: TechnicianRef): CallDetailTech => ({ name: t.name, color: t.color, phone: t.phone });

/** "היום · 09:00–11:00" or "חמישי 22.10 · 09:00–10:30". */
export const visitWhen = (v: Pick<VisitRecord, "date" | "start" | "end">): string =>
  `${v.date === TODAY ? "היום" : dayAndDate(v.date)} · ${v.start}–${v.end}`;

/** Warranty text (TE-08): "לא צוין" when empty. */
const warrantyText = (w: string): string => w.trim() || "לא צוין";

/** Minutes from arrival to end, or null. */
const treatMinutes = (v: VisitRecord): number | null =>
  v.arriveAt && v.endAt ? toMin(v.endAt) - toMin(v.arriveAt) : null;

/** Assignment card text when the call has no open visit, by service-call status (D38). */
const NOTHING_SCHEDULED: Record<CallStatus, string> = {
  open: "",
  awaiting: "אין ביקור מתוכנן · הביקור בוטל והקריאה ממתינה לשיבוץ",
  followup: "אין ביקור מתוכנן · ביקור ההמשך ייקבע בזימון ב-Outlook",
  resolved: "אין ביקור מתוכנן · הקריאה טופלה",
};

function assignment(c: CallDetail): CallAssignment {
  const last = c.visits[c.visits.length - 1];
  return {
    scheduled: c.visits
      .filter((v) => isOpenVisitStatus(v.status))
      .map((v) => ({
        n: v.n,
        task: v.task,
        status: v.status,
        when: visitWhen(v),
        tech: techInfo(v.technician),
        collect: v.pickup?.item ?? "",
        collectFrom: v.pickup?.place ?? "",
      })),
    lastTech: last && {
      tech: techInfo(last.technician),
      caption: `ביקור אחרון ${dayLabel(last.date)} · ${VISIT_STATUSES[last.status].label}`,
    },
    emptyText: NOTHING_SCHEDULED[c.status],
  };
}

function timelineVisit(v: VisitRecord): TimelineVisit {
  return {
    n: v.n,
    task: v.task,
    status: v.status,
    dateLabel: dayLabel(v.date),
    start: v.start,
    end: v.end,
    tech: { name: v.technician.name, color: v.technician.color },
    source: v.source,
    departAt: v.departAt,
    arriveAt: v.arriveAt,
    endAt: v.endAt,
    treatMin: treatMinutes(v),
    reason: v.followupReason,
    summary: v.summary,
    transcript: v.transcript,
    recLabel: v.recordingSeconds ? recLabel(v.recordingSeconds) : null,
    media: v.media.map((m) => ({ kind: m.kind, when: m.when })),
    mediaIsTest: v.isTest || v.media.some((m) => m.isTest),
    parts: v.parts,
    nextNote: v.nextNote,
    signer: v.signerName,
    signedText: v.signedText,
    collect: v.pickup?.item ?? "",
    collectFrom: v.pickup?.place ?? "",
  };
}

/** Props for the office call card. */
export function callDetailData(c: CallDetail, customerCalls: readonly CallSummary[], role: OfficeRole): CallDetailData {
  return {
    req: c.req,
    status: c.status,
    isTest: c.isTest,
    type: c.type,
    warranty: warrantyText(c.warranty),
    customer: {
      name: c.customer.name,
      number: c.customer.number,
      phone: c.customer.phone,
      phone2: c.customer.phone2,
      address: `${c.customer.address.street}, ${c.customer.address.city}`,
      building: c.customer.address.building,
      floor: c.customer.address.floor,
      apt: c.customer.address.apt,
      arrival: c.customer.arrivalNotes,
      rep: c.representative.name,
      isTest: c.customer.isTest,
    },
    product: { ...c.product },
    desc: c.problem,
    techNote: c.techNote,
    assignment: assignment(c),
    visits: c.visits.map(timelineVisit),
    customerCalls: customerCalls.map((x) => ({
      req: x.req,
      href: demoHref.call(role, x.req),
      product: x.product.name,
      when: `ביקור אחרון ${dayLabel(x.latestVisit.date)}`,
      status: x.status,
    })),
  };
}
