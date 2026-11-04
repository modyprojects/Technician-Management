// FICTITIOUS DATA ONLY: maps the demo's fixture records to the DTOs of the data-access layer
// (features/*/data/types). Used only by adapter.ts and aggregations.ts. Allowed only under
// app/dev (G-05). Every DTO is marked isTest: true (D47).
import type { CalendarVisit, CalendarVisitDetail } from "@/features/calendar/data/types";
import type { CallStatus, CallSummary, CallDetail as CallDetailDto } from "@/features/calls/data/types";
import type { Customer } from "@/features/customers/data/types";
import type { LaneVisit, TechnicianLane } from "@/features/dashboards/data/types";
import type { Product as ProductDto, TechnicianRef } from "@/features/reference/data/types";
import type {
  MediaItem as MediaDto,
  Pickup,
  TechDayVisit,
  VisitDetail,
  VisitHistoryItem,
  VisitRecord,
} from "@/features/visits/data/types";
import { customerIdOf } from "./customers";
import { toMin } from "./dates";
import { lastVisit, type CallVisit } from "./queries";
import { PLACES, prod, tech, TECHS, userByName } from "./reference";
import { callStatus, isClosedVisit } from "./status";
import type { Call, TechId, Visit } from "./types";

/** D47: every demo record is test data. */
const TEST = true as const;

export const techRef = (id: TechId): TechnicianRef => {
  const t = tech(id);
  return { id: t.id, name: t.name, color: t.color, phone: t.phone };
};

export const productDto = (sku: string): ProductDto => {
  const p = prod(sku);
  return { sku: p.sku, name: p.name, brand: p.brand, supplier: p.sup, isTest: TEST };
};

export const customerDto = (c: Call): Customer => ({
  name: c.customer,
  number: c.customerNo,
  phone: c.phone,
  phone2: c.phone2,
  address: { city: c.city, street: c.street, building: c.building, floor: c.floor, apt: c.apt },
  arrivalNotes: c.arrival,
  isTest: TEST,
});

const pickupOf = (v: Visit): Pickup | null =>
  v.collect
    ? { item: v.collect, place: v.collectFrom, placeAddress: PLACES.find((p) => p.name === v.collectFrom)?.addr ?? null }
    : null;

const mediaOf = (c: Call, v: Visit): MediaDto[] =>
  v.media.map((m, i) => ({ id: `${c.req}-${v.n}-${i + 1}`, kind: m.t, when: m.when, isTest: TEST }));

/** The source of the call's first invitation. */
const callSource = (c: Call) => c.visits[0]?.source ?? "simulator";

export function visitRecord(c: Call, v: Visit): VisitRecord {
  return {
    req: c.req,
    n: v.n,
    task: v.task,
    technician: techRef(v.tech),
    date: v.date,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    departAt: v.departAt,
    arriveAt: v.arriveAt,
    endAt: v.endAt,
    followupReason: v.reason,
    summary: v.summary,
    transcript: v.transcript,
    recordingSeconds: v.rec,
    media: mediaOf(c, v),
    parts: [...v.parts],
    nextNote: v.nextNote,
    signerName: v.signer,
    signedText: v.signedText,
    pickup: pickupOf(v),
    isTest: TEST,
  };
}

const representative = (c: Call) => ({ name: c.rep, phone: userByName(c.rep)?.phone ?? null });

/** Reason of the visit that set the call to "המשך טיפול" (its latest closed visit). */
export function followupReasonOf(c: Call, status: CallStatus = callStatus(c)): string | null {
  if (status !== "followup") return null;
  const closed = c.visits.filter(isClosedVisit);
  return closed[closed.length - 1]?.reason ?? null;
}

export function callSummary(c: Call): CallSummary {
  const v = lastVisit(c);
  const status = callStatus(c);
  return {
    req: c.req,
    source: callSource(c),
    customer: { name: c.customer, number: c.customerNo, phone: c.phone, city: c.city, isTest: TEST },
    product: productDto(c.sku),
    status,
    followupReason: followupReasonOf(c, status),
    visitCount: c.visits.length,
    latestVisit: {
      n: v.n,
      date: v.date,
      start: v.start,
      end: v.end,
      status: v.status,
      source: v.source,
      technician: techRef(v.tech),
    },
    representative: c.rep,
    isTest: TEST,
  };
}

export function callDetail(c: Call): CallDetailDto {
  return {
    req: c.req,
    source: callSource(c),
    type: c.type,
    warranty: c.warranty,
    status: callStatus(c),
    customer: { ...customerDto(c), id: customerIdOf(c.customerNo) },
    product: productDto(c.sku),
    problem: c.desc,
    techNote: c.techNote,
    representative: representative(c),
    visits: c.visits.map((v) => visitRecord(c, v)),
    isTest: TEST,
  };
}

export function visitDetail(c: Call, v: Visit): VisitDetail {
  return {
    ...visitRecord(c, v),
    call: {
      req: c.req,
      type: c.type,
      warranty: c.warranty,
      problem: c.desc,
      techNote: c.techNote,
      representative: representative(c),
      isTest: TEST,
    },
    customer: customerDto(c),
    product: productDto(c.sku),
    editable: v.status === "new" || v.status === "go" || v.status === "work",
  };
}

/** A previous closed visit as a technician may see it (D36: no signer, signature, field times or audio). */
export function historyItem(c: Call, v: Visit): VisitHistoryItem {
  const t = tech(v.tech);
  const p = prod(c.sku);
  return {
    req: c.req,
    n: v.n,
    relation: "call",
    date: v.date,
    start: v.start,
    technician: { id: t.id, name: t.name, color: t.color },
    status: v.status,
    summary: v.summary,
    transcript: v.transcript,
    followupReason: v.reason,
    nextNote: v.nextNote,
    parts: [...v.parts],
    media: mediaOf(c, v),
    mediaCount: v.media.length,
    recordingSeconds: v.rec,
    customerName: c.customer,
    product: { sku: p.sku, name: p.name },
    isTest: TEST,
  };
}

export function techDayVisit({ c, v }: CallVisit): TechDayVisit {
  return {
    req: c.req,
    n: v.n,
    task: v.task,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    customerName: c.customer,
    address: `${c.street}, ${c.city}`,
    city: c.city,
    productName: prod(c.sku).name,
    isFollowUp: v.n > 1,
    pickup: pickupOf(v),
    isTest: TEST,
  };
}

export function laneVisit({ c, v }: CallVisit): LaneVisit {
  return {
    req: c.req,
    n: v.n,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    customerName: c.customer,
    city: c.city,
    isTest: TEST,
  };
}

/** "עכשיו בשטח": every technician's visits on `date` (cancelled excluded), by start time. */
export function technicianLanes(visitsOnDate: readonly CallVisit[]): TechnicianLane[] {
  return TECHS.map((t) => {
    const vs = visitsOnDate
      .filter((x) => x.v.tech === t.id && x.v.status !== "cancel")
      .sort((a, b) => toMin(a.v.start) - toMin(b.v.start));
    const cur = vs.find((x) => x.v.status === "work") ?? vs.find((x) => x.v.status === "go");
    const nxt = vs.find((x) => x.v.status === "new");
    return {
      technician: techRef(t.id),
      current: cur ? laneVisit(cur) : null,
      next: nxt ? laneVisit(nxt) : null,
      visits: vs.map(laneVisit),
      completed: vs.filter((x) => isClosedVisit(x.v)).length,
      total: vs.length,
    };
  });
}

/** A visit block on the office and technician calendars. */
export function calendarVisit({ c, v }: CallVisit): CalendarVisit {
  const t = tech(v.tech);
  return {
    req: c.req,
    n: v.n,
    date: v.date,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    technician: { id: t.id, name: t.name, color: t.color },
    customerName: c.customer,
    city: c.city,
    productName: prod(c.sku).name,
    isFollowUp: v.n > 1,
    isTest: TEST,
  };
}

/** The office calendar's visit drawer (demo drawerHtml()). */
export function calendarVisitDetail(c: Call, v: Visit): CalendarVisitDetail {
  const p = prod(c.sku);
  return {
    req: c.req,
    n: v.n,
    date: v.date,
    start: v.start,
    end: v.end,
    status: v.status,
    source: v.source,
    technician: techRef(v.tech),
    customer: { name: c.customer, phone: c.phone, address: `${c.street}, ${c.city}`, isTest: TEST },
    product: { sku: p.sku, name: p.name, isTest: TEST },
    representative: c.rep,
    problem: c.desc,
    departAt: v.departAt,
    arriveAt: v.arriveAt,
    endAt: v.endAt,
    signerName: v.signer,
    followupReason: v.reason,
    isTest: TEST,
  };
}
