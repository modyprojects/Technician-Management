// Maps the layer's call DTOs (features/calls/data/types) to the props of
// components/office/CallDetail: labels, links and the demo's date formatting. No fixture data.
import type { CallDetailData } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import type { CallDetail, CallSummary } from "@/features/calls/data/types";
import type { OfficeRole } from "@/features/reference/data/types";
import type { VisitRecord } from "@/features/visits/data/types";
import { dayLabel, recLabel, toMin } from "../../../../_data/dates";
import { demoHref } from "../../../../_data/routes";

/** Warranty text (TE-08): "לא צוין" when empty. */
const warrantyText = (w: string): string => w.trim() || "לא צוין";

/** Minutes from arrival to end, or null. */
const treatMinutes = (v: VisitRecord): number | null =>
  v.arriveAt && v.endAt ? toMin(v.endAt) - toMin(v.arriveAt) : null;

function timelineVisit(v: VisitRecord): TimelineVisit {
  return {
    n: v.n,
    task: v.task,
    status: v.status,
    dateLabel: dayLabel(v.date),
    start: v.start,
    end: v.end,
    tech: { name: v.technician.name, color: v.technician.color, phone: v.technician.phone },
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
