// FICTITIOUS DATA ONLY (G-05): maps a demo call to the props of components/office/CallDetail.
// Server-side (uses the seeded calls through customerCalls()).
import type { CallAssignment, CallDetailData, CallDetailTech } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import {
  callStatus,
  customerCalls,
  dayAndDate,
  dayLabel,
  demoHref,
  isOpenVisit,
  lastVisit,
  prod,
  recLabel,
  ST,
  tech,
  TODAY,
  treatOf,
  warrantyText,
  type Call,
  type CallStatus,
  type OfficeRole,
  type TechId,
  type Visit,
} from "../../../../_data";

const techInfo = (id: TechId): CallDetailTech => {
  const t = tech(id);
  return { name: t.name, color: t.color, phone: t.phone };
};

/** "היום · 09:00–11:00" or "חמישי 22.10 · 09:00–10:30". */
export const visitWhen = (v: Visit): string => `${v.date === TODAY ? "היום" : dayAndDate(v.date)} · ${v.start}–${v.end}`;

/** Assignment card text when the call has no open visit, by service-call status (D38). */
const NOTHING_SCHEDULED: Record<CallStatus, string> = {
  open: "",
  awaiting: "אין ביקור מתוכנן · הביקור בוטל והקריאה ממתינה לשיבוץ",
  followup: "אין ביקור מתוכנן · ביקור ההמשך ייקבע בזימון ב-Outlook",
  resolved: "אין ביקור מתוכנן · הקריאה טופלה",
};

function assignment(c: Call, status: CallStatus): CallAssignment {
  const last = lastVisit(c);
  return {
    scheduled: c.visits.filter(isOpenVisit).map((v) => ({
      n: v.n,
      task: v.task,
      status: v.status,
      when: visitWhen(v),
      tech: techInfo(v.tech),
      collect: v.collect,
      collectFrom: v.collectFrom,
    })),
    lastTech: { tech: techInfo(last.tech), caption: `ביקור אחרון ${dayLabel(last.date)} · ${ST[last.status].label}` },
    emptyText: NOTHING_SCHEDULED[status],
  };
}

function timelineVisit(c: Call, v: Visit): TimelineVisit {
  const t = tech(v.tech);
  return {
    n: v.n,
    task: v.task,
    status: v.status,
    dateLabel: dayLabel(v.date),
    start: v.start,
    end: v.end,
    tech: { name: t.name, color: t.color },
    source: v.source,
    departAt: v.departAt,
    arriveAt: v.arriveAt,
    endAt: v.endAt,
    treatMin: treatOf(v),
    reason: v.reason,
    summary: v.summary,
    transcript: v.transcript,
    recLabel: v.rec ? recLabel(v.rec) : null,
    media: v.media.map((m) => ({ kind: m.t, when: m.when })),
    mediaIsTest: c.isTest,
    parts: v.parts,
    nextNote: v.nextNote,
    signer: v.signer,
    signedText: v.signedText,
    collect: v.collect,
    collectFrom: v.collectFrom,
  };
}

/** Props for the office call card. Every demo record is test data (D47). */
export function callDetailData(c: Call, role: OfficeRole): CallDetailData {
  const p = prod(c.sku);
  const status = callStatus(c);
  return {
    req: c.req,
    status,
    isTest: c.isTest,
    type: c.type,
    warranty: warrantyText(c),
    customer: {
      name: c.customer,
      number: c.customerNo,
      phone: c.phone,
      phone2: c.phone2,
      address: `${c.street}, ${c.city}`,
      building: c.building,
      floor: c.floor,
      apt: c.apt,
      arrival: c.arrival,
      rep: c.rep,
      isTest: c.isTest,
    },
    product: { sku: p.sku, name: p.name, brand: p.brand, supplier: p.sup, isTest: c.isTest },
    desc: c.desc,
    techNote: c.techNote,
    assignment: assignment(c, status),
    visits: c.visits.map((v) => timelineVisit(c, v)),
    customerCalls: customerCalls(c).map((x) => ({
      req: x.req,
      href: demoHref.call(role, x.req),
      product: prod(x.sku).name,
      when: `ביקור אחרון ${dayLabel(lastVisit(x).date)}`,
      status: callStatus(x),
    })),
  };
}
