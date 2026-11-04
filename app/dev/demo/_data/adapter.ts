// FICTITIOUS DATA ONLY: the UI demo's implementation of the data-access layer (DataAccess,
// features/data-access/types) over the seeded fixtures (D53, owner architecture rule
// 2026-11-03). Allowed only under app/dev (G-05). Server-only: it bundles every seeded call, so
// a client component that imports it fails the build; client components get DTOs as props.
// Screens import `demoDataAccess` from here and never the fixture modules (eslint.config.mjs).
// Inputs are validated and clamped as a server adapter would; every list is bounded (paged, or
// capped at a documented limit); every DTO is test data (D47). Static params of the demo build are
// not part of the layer: params.ts reads the fixtures for them.
import "server-only";
import { normalizeCallFilter } from "@/features/calls/data/validate";
import type { CallsPage, CallStatus } from "@/features/calls/data/types";
import { isIsoDate, isRecordKey, MAX_PAGE_LIMIT, pageOf, type IsoDate } from "@/features/data-access/common";
import type { DataAccess } from "@/features/data-access/types";
import { isTechnicianVisitFilter, type AnalyticsPeriod } from "@/features/dashboards/data/types";
import { isOfficeRole, type OfficeRole } from "@/features/reference/data/types";
import type { TechDay, VisitRef } from "@/features/visits/data/types";
import { visitRefError } from "@/features/visits/data/validate";
import { csQueue, managerAnalytics, officeOverview, technicianDetail } from "./aggregations";
import { daysBetween, TODAY } from "./dates";
import { callDetail, callSummary, historyItem, techDayVisit, visitDetail } from "./mappers";
import { NOTIFICATIONS } from "./notifications";
import { CALLS, customerCalls, findCall, findVisit, lastVisit, previousVisits, sortCalls, visitsForTechOnDate } from "./queries";
import { PERMISSION_STATUS, PERMISSIONS } from "./permissions";
import { FIXED_TEXT, ME, PLACES, prod, PRODUCTS, REASONS, TECH_IDS, TECHS } from "./reference";
import { callStatus, isOpenVisit } from "./status";
import type { Call, TechId } from "./types";

const TEST = true as const;

const isTechId = (id: unknown): id is TechId => typeof id === "string" && (TECH_IDS as readonly string[]).includes(id);

const digitsOf = (s: string): string => s.replace(/\D/g, "");

/**
 * The calls-list search (OF-04, OF-05, PR-07): request number, customer number, customer, phone,
 * SKU, product name and city, case-insensitive; a phone typed without dashes also matches.
 */
function matchesSearch(c: Call, query: string): boolean {
  const q = query.toUpperCase();
  if (!q) return true;
  const fields = [c.req, c.customerNo, c.customer, c.phone, c.sku, prod(c.sku).name, c.city];
  if (fields.some((x) => x.toUpperCase().includes(q))) return true;
  const digits = digitsOf(q);
  return /^[\d\s-]+$/.test(q) && digits.length >= 3 && digitsOf(c.phone).includes(digits);
}

/** Newest first, as the demo's calls list (computed once). */
const CALLS_NEWEST_FIRST: readonly Call[] = sortCalls(CALLS);

function assertDate(date: IsoDate): IsoDate {
  if (!isIsoDate(date)) throw new RangeError("Invalid date");
  return date;
}

function assertPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  if (!isIsoDate(period?.from) || !isIsoDate(period?.to) || period.from > period.to) throw new RangeError("Invalid period");
  if (daysBetween(period.from, period.to) > 366) throw new RangeError("Period longer than a year");
  return { from: period.from, to: period.to };
}

const validRef = (ref: VisitRef): boolean => visitRefError(ref) === null;

/** Settings lists (technicians, reasons, places) are short; the cap keeps them bounded. */
const settingsList = <T>(xs: readonly T[]): T[] => xs.slice(0, MAX_PAGE_LIMIT);

/** Products by SKU (the catalogue order of a database query). */
const PRODUCTS_BY_SKU = [...PRODUCTS].sort((a, b) => a.sku.localeCompare(b.sku));

/** Notifications newest first. */
const NOTIFICATIONS_NEWEST_FIRST = [...NOTIFICATIONS].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

export const demoDataAccess: DataAccess = {
  calls: {
    async list(filter): Promise<CallsPage> {
      const f = normalizeCallFilter(filter);
      const statusCounts: Record<CallStatus, number> = { open: 0, awaiting: 0, followup: 0, resolved: 0 };
      const matches: Call[] = [];
      for (const c of CALLS_NEWEST_FIRST) {
        const status = callStatus(c);
        statusCounts[status] += 1;
        const last = lastVisit(c);
        if (f.statuses.length && !f.statuses.includes(status)) continue;
        if (f.technicianId && last.tech !== f.technicianId) continue;
        if (f.from && last.date < f.from) continue;
        if (f.to && last.date > f.to) continue;
        if (!matchesSearch(c, f.q)) continue;
        matches.push(c);
      }
      const page = pageOf(matches, f.page, f.limit);
      return { ...page, items: page.items.map(callSummary), statusCounts, allCount: CALLS.length };
    },
    async get(req) {
      if (!isRecordKey(req)) return null;
      const c = findCall(req);
      return c ? callDetail(c) : null;
    },
    async customerHistory(req, page) {
      const c = isRecordKey(req) ? findCall(req) : undefined;
      const result = pageOf(c ? customerCalls(c) : [], page?.page, page?.limit);
      return { ...result, items: result.items.map(callSummary) };
    },
  },

  visits: {
    async techDay(techId, date): Promise<TechDay | null> {
      if (!isTechId(techId)) return null;
      const d = assertDate(date);
      const vs = visitsForTechOnDate(techId, d);
      const open = vs.filter((x) => isOpenVisit(x.v));
      const closed = vs.filter((x) => !isOpenVisit(x.v));
      const next = open.find((x) => x.v.status === "work") ?? open.find((x) => x.v.status === "go") ?? open[0];
      const groups = new Map<string, TechDay["pickups"][number]>();
      for (const x of open) {
        if (!x.v.collect) continue;
        const place = x.v.collectFrom || "לא צוין";
        const group = groups.get(place) ?? {
          place,
          placeAddress: PLACES.find((p) => p.name === place)?.addr ?? null,
          items: [],
        };
        group.items.push({ ref: { req: x.c.req, n: x.v.n }, item: x.v.collect, customerName: x.c.customer, start: x.v.start });
        groups.set(place, group);
      }
      const t = TECHS.find((x) => x.id === techId) as (typeof TECHS)[number];
      return {
        technician: { id: t.id, name: t.name, color: t.color, phone: t.phone },
        date: d,
        open: open.map(techDayVisit),
        closed: closed.map(techDayVisit),
        next: next ? techDayVisit(next) : null,
        pickups: [...groups.values()],
        stats: { open: open.length, completed: closed.length },
      };
    },
    async get(ref) {
      if (!validRef(ref)) return null;
      const found = findVisit(ref.req, ref.n);
      return found ? visitDetail(found.c, found.v) : null;
    },
    async history(ref) {
      if (!validRef(ref)) return [];
      const c = findCall(ref.req);
      return c ? previousVisits(c, ref.n).map((v) => historyItem(c, v)) : [];
    },
  },

  dashboards: {
    async officeOverview(date) {
      return officeOverview(assertDate(date));
    },
    async managerAnalytics(period) {
      return managerAnalytics(assertPeriod(period), TODAY);
    },
    async technicianDetail(techId, period, query) {
      if (!isTechId(techId)) return null;
      const filter = isTechnicianVisitFilter(query?.filter) ? query.filter : "all";
      return technicianDetail(techId, assertPeriod(period), { filter, page: query?.page, limit: query?.limit });
    },
    async csQueue(date) {
      return csQueue(assertDate(date));
    },
  },

  reference: {
    async technicians() {
      return settingsList(TECHS).map((t) => ({ id: t.id, name: t.name, color: t.color, phone: t.phone, email: t.email, active: true, isTest: TEST }));
    },
    async products(page) {
      const result = pageOf(PRODUCTS_BY_SKU, page?.page, page?.limit);
      return { ...result, items: result.items.map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, supplier: p.sup, isTest: TEST })) };
    },
    async reasons() {
      return settingsList(REASONS).map((r) => ({ name: r.name, active: r.on, isTest: TEST }));
    },
    async places() {
      return settingsList(PLACES).map((p) => ({ name: p.name, type: p.type, address: p.addr, phone: p.phone, hours: p.hours, active: p.on, isTest: TEST }));
    },
    async approvalText() {
      // The demo has one version of the "טופל" text (Settings editing is not part of the demo).
      return { versionId: "demo-approval-text-v1", text: FIXED_TEXT, isTest: TEST };
    },
    async permissions(role: OfficeRole) {
      if (!isOfficeRole(role)) throw new RangeError("Unknown office role");
      return { role, status: PERMISSION_STATUS, values: { ...PERMISSIONS[role] } };
    },
  },

  notifications: {
    // The demo's notifications belong to the demo technician (ME); other users have none.
    async list(userId, page) {
      const result = pageOf(userId === ME ? NOTIFICATIONS_NEWEST_FIRST : [], page?.page, page?.limit);
      return {
        ...result,
        items: result.items.map((x) => ({
          id: String(x.id),
          kind: x.kind,
          title: x.title,
          sub: x.sub,
          time: x.at,
          visit: x.req !== undefined && x.n !== undefined ? { req: x.req, n: x.n } : null,
          read: x.read,
          isTest: TEST,
        })),
      };
    },
    async unreadCount(userId) {
      return userId === ME ? NOTIFICATIONS.filter((x) => !x.read).length : 0;
    },
  },
};
