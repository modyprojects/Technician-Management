// FICTITIOUS DATA ONLY: the UI demo's implementation of the data-access layer (DataAccess,
// features/data-access/types) over the seeded fixtures (D53, owner architecture rule
// 2026-11-03). Allowed only under app/dev (G-05). Server-only: it bundles every seeded call, so
// a client component that imports it fails the build; client components get DTOs as props.
// Screens import `demoDataAccess` from here and never the fixture modules (eslint.config.mjs).
// Inputs are validated and clamped as a server adapter would; every list is bounded (paged, or
// capped at a documented limit); every DTO is test data (D47). Static params of the demo build are
// not part of the layer: params.ts reads the fixtures for them.
import "server-only";
import { normalizeCalendarFilter, isYearMonth } from "@/features/calendar/data/validate";
import { UNPARSED_VALUE_MAX, type UnparsedInvitation, type UnparsedProblem, type YearMonth } from "@/features/calendar/data/types";
import { normalizeBackFromFieldQuery, normalizeCallFilter } from "@/features/calls/data/validate";
import { SUMMARY_EXCERPT_MAX, type BackFromFieldItem, type CallsPage, type CallStatus } from "@/features/calls/data/types";
import {
  CUSTOMER_CALLS_LIMIT,
  CUSTOMER_PRODUCTS_LIMIT,
  type CustomerDetail,
  type CustomerProduct,
  type CustomerSummary,
} from "@/features/customers/data/types";
import { isCustomerId, normalizeCustomerListQuery } from "@/features/customers/data/validate";
import { boundedOf, filterListValues, isIsoDate, isRecordKey, MAX_PAGE_LIMIT, pageOf, type IsoDate } from "@/features/data-access/common";
import {
  isNormalizedSku,
  normalizeSku,
  PRODUCT_CALLS_LIMIT,
  type ProductDetail,
  type ProductListItem,
  type ProductOption,
} from "@/features/products/data/types";
import { normalizeProductListQuery } from "@/features/products/data/validate";
import type { DataAccess } from "@/features/data-access/types";
import { isTechnicianVisitFilter, type AnalyticsPeriod } from "@/features/dashboards/data/types";
import {
  ACCOUNT_REQUEST_STATUSES,
  ACCOUNT_ROLE_VALUES,
  isAccountRequestStatus,
  isAccountRole,
  type AccountRef,
  type AccountRequest,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  isMatrixRole,
  isOfficeRole,
  MATRIX_ROLE_VALUES,
  PERMISSION_KEYS,
  type MatrixRole,
  type OfficeRole,
  type PermissionKey,
  type RolePermissions,
} from "@/features/reference/data/types";
import {
  isLockedTemplateField,
  PERMISSION_LABELS,
  pendingCreatorDecision,
  pendingMatrixDecision,
  TECH_NOTIFICATION_KEYS,
  type CompletionMailRule,
  type PermissionCell,
  type PendingSetting,
} from "@/features/settings/data/types";
import type { ClosedVisitDetail, FieldTimeKey, TechDay, VisitDetail, VisitRef } from "@/features/visits/data/types";
import { visitRefError } from "@/features/visits/data/validate";
import { csQueue, managerAnalytics, officeOverview, technicianDetail } from "./aggregations";
import { officeDay, officeMonth, officeWeek, techMonth, techWeek, techWeekFigures } from "./calendar";
import { CUSTOMERS, customerIdOf, customerProducts, findCustomer, openedOn, type DemoCustomer } from "./customers";
import { daysBetween, TODAY } from "./dates";
import { UNPARSED_INVITATIONS, type DemoUnparsedInvitation, type DemoUnparsedProblem } from "./intake";
import { calendarVisitDetail, callDetail, callSummary, historyItem, productDto, techDayVisit, techRef, visitDetail } from "./mappers";
import { CATALOGUE_BY_SKU, findCatalogueProduct, type DemoCatalogueProduct } from "./products";
import { NOTIFICATION_PREFERENCES, NOTIFICATIONS } from "./notifications";
import { CALLS, customerCalls, findCall, findVisit, lastVisit, previousVisits, sortCalls, visitsForTechOnDate } from "./queries";
import { PERMISSION_STATUS, PERMISSIONS } from "./permissions";
import { ACCOUNT_REQUESTS, ACCOUNTS, accountById, type DemoAccount, type DemoAccountRequest } from "./accounts";
import {
  BRANDS,
  CATALOGUE,
  FIXED_TEXT,
  ME,
  OFFICE_PHONE,
  PLACES,
  prod,
  REASONS,
  SUPPLIERS,
  TECH_IDS,
  TECHS,
  USERS,
  type ProductOptionRecord,
} from "./reference";
import {
  CALL_TYPE_SETTINGS,
  callTypeInUse,
  COMPLETION_MAILBOX,
  PLACE_IDS,
  placeInUse,
  REASON_IDS,
  reasonInUse,
  reasonUsesThisMonth,
  SUBJECT_PREFIX,
  TECH_ACTIVE,
  TECH_DEVICE,
  TECH_NOTIFICATIONS,
  TEMPLATE_LABELS,
} from "./settings";
import { callStatus, isClosedVisit, isOpenVisit } from "./status";
import type { Call, TechId, Visit } from "./types";

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

function assertMonth(month: YearMonth): YearMonth {
  if (!isYearMonth(month)) throw new RangeError("Invalid month");
  return month;
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
const PRODUCTS_BY_SKU = [...CATALOGUE].sort((a, b) => a.sku.localeCompare(b.sku));

/** Notifications newest first. */
const NOTIFICATIONS_NEWEST_FIRST = [...NOTIFICATIONS].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

/**
 * The Creator's capabilities: fixed (D33), never matrix values. Every key except one that waits for
 * an open decision (`usage`, d13), which stays off until the owner decides (deny by default).
 */
const CREATOR_PERMISSIONS: RolePermissions = {
  role: "creator",
  status: "fixed",
  values: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, pendingCreatorDecision(key) === null])) as Record<PermissionKey, boolean>,
};

function matrixCell(role: MatrixRole, key: PermissionKey): PermissionCell {
  return { value: PERMISSIONS[role][key], status: PERMISSION_STATUS, pending: pendingMatrixDecision(role, key) };
}

const pending = (decision: PendingSetting["decision"]): PendingSetting => ({ status: "pending", decision });

/** SE-08 to SE-10: fixed recipients (D09) and the items that wait for d10 / d11. */
const completionRule = (outcome: CompletionMailRule["outcome"]): CompletionMailRule => ({
  outcome,
  fixedRecipients: { manager: true, serviceMailbox: COMPLETION_MAILBOX },
  managerScope: pending("d10"),
  handlingRep: pending("d10"),
  attachMedia: pending("d11"),
});

const ROLE_ORDER = new Map(ACCOUNT_ROLE_VALUES.map((role, i) => [role, i]));

/** Accounts by role (creator, mgr, cs, tech), then by name (Hebrew collation), as the port documents. */
const ACCOUNTS_BY_ROLE = [...ACCOUNTS].sort(
  (a, b) => (ROLE_ORDER.get(a.role) ?? 0) - (ROLE_ORDER.get(b.role) ?? 0) || a.name.localeCompare(b.name, "he"),
);

/** Requests newest first. */
const REQUESTS_NEWEST_FIRST = [...ACCOUNT_REQUESTS].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));

function accountRef(id: string): AccountRef {
  const a = accountById(id);
  return { id, name: a?.name ?? "" };
}

const userAccount = (a: DemoAccount): UserAccount => ({ ...a, isTest: TEST });

const accountRequest = (r: DemoAccountRequest): AccountRequest => ({
  id: r.id,
  kind: r.kind,
  account: r.accountId ? accountRef(r.accountId) : null,
  target: { ...r.target },
  newRole: r.newRole,
  requestedBy: accountRef(r.requestedBy),
  requestedAt: r.requestedAt,
  status: r.status,
  reason: r.reason,
  decidedBy: r.decidedBy ? accountRef(r.decidedBy) : null,
  decidedAt: r.decidedAt,
  isTest: TEST,
});

const emptyStatusCounts = (): Record<CallStatus, number> => ({ open: 0, awaiting: 0, followup: 0, resolved: 0 });

/** The search of a free-text field list: case-insensitive; a phone typed without dashes also matches. */
function matchesText(fields: readonly string[], phone: string, query: string): boolean {
  const q = query.toUpperCase();
  if (!q) return true;
  if (fields.some((x) => x.toUpperCase().includes(q))) return true;
  const digits = digitsOf(q);
  return /^[\d\s-]+$/.test(q) && digits.length >= 3 && digitsOf(phone).includes(digits);
}

/** "לקוחות" search (OF-05): name, customer number, phone and city of the customer's latest call. */
const customerMatches = (x: DemoCustomer, q: string): boolean =>
  matchesText([x.latest.customer, x.number, x.latest.phone, x.latest.city], x.latest.phone, q);

function customerSummary(x: DemoCustomer): CustomerSummary {
  const c = x.latest;
  return {
    id: x.id,
    number: x.number,
    name: c.customer,
    phone: c.phone,
    city: c.city,
    callCount: x.calls.length,
    activeCallCount: x.calls.filter((call) => callStatus(call) !== "resolved").length,
    lastActivity: x.lastActivity,
    returnedProductCount: customerProducts(x).filter((p) => p.returns.length > 0).length,
    isTest: TEST,
  };
}

function customerDetail(x: DemoCustomer): CustomerDetail {
  const c = x.latest;
  const statusCounts = emptyStatusCounts();
  for (const call of x.calls) statusCounts[callStatus(call)] += 1;
  const products: CustomerProduct[] = customerProducts(x)
    .map((p) => ({
      product: productDto(p.sku),
      callCount: p.calls.length,
      firstDate: openedOn(p.calls[0] as Call),
      lastDate: openedOn(p.calls[p.calls.length - 1] as Call),
      cameBack: p.returns.length > 0,
      returns: boundedOf(p.returns, CUSTOMER_PRODUCTS_LIMIT),
    }))
    // Products that came back first, then the latest call first.
    .sort((a, b) => Number(b.cameBack) - Number(a.cameBack) || b.lastDate.localeCompare(a.lastDate) || a.product.sku.localeCompare(b.product.sku));
  const calls = boundedOf(x.calls, CUSTOMER_CALLS_LIMIT);
  return {
    id: x.id,
    number: x.number,
    name: c.customer,
    phone: c.phone,
    phone2: c.phone2,
    latestAddress: { city: c.city, street: c.street, building: c.building, floor: c.floor, apt: c.apt },
    statusCounts,
    calls: { ...calls, items: calls.items.map(callSummary) },
    products: boundedOf(products, CUSTOMER_PRODUCTS_LIMIT),
    isTest: TEST,
  };
}

/** "מוצרים" search (PR-07): SKU (normalized), name, brand and supplier. */
function productMatches(x: DemoCatalogueProduct, q: string): boolean {
  if (!q) return true;
  const sku = normalizeSku(q);
  const p = x.product;
  return p.sku.includes(sku) || [p.name, p.brand, p.sup].some((f) => f.toUpperCase().includes(q.toUpperCase()));
}

function productListItem(x: DemoCatalogueProduct): ProductListItem {
  const p = x.product;
  const first = x.calls[0];
  const firstVisit = first?.visits[0];
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    supplier: p.sup,
    brandId: x.brandId,
    supplierId: x.supplierId,
    firstSeen: first && firstVisit ? { req: first.req, n: firstVisit.n, date: firstVisit.date, source: firstVisit.source, isTest: TEST } : null,
    callCount: x.calls.length,
    version: x.version,
    isTest: TEST,
  };
}

const productOption = (o: ProductOptionRecord): ProductOption => ({ id: o.id, name: o.name, active: o.on, isTest: TEST });

const productOptions = (list: readonly ProductOptionRecord[]) => {
  const result = boundedOf([...list].sort((a, b) => a.name.localeCompare(b.name, "he")), MAX_PAGE_LIMIT);
  return { ...result, items: result.items.map(productOption) };
};

/** Untrusted invitation text, cut to UNPARSED_VALUE_MAX characters. */
const invitationText = (text: string): string => (text.length > UNPARSED_VALUE_MAX ? `${text.slice(0, UNPARSED_VALUE_MAX)}…` : text);

const TEMPLATE_ORDER = new Map(TEMPLATE_LABELS.map((l, i) => [l.key, i]));

const templateLabel = (field: (typeof TEMPLATE_LABELS)[number]["key"]): string => TEMPLATE_LABELS.find((l) => l.key === field)?.label ?? field;

function unparsedProblem(p: DemoUnparsedProblem): UnparsedProblem {
  switch (p.kind) {
    case "missing":
      return { kind: "missing", field: p.field, label: templateLabel(p.field) };
    case "unknown-place":
      return { kind: "unknown-place", field: "collectFrom", label: templateLabel("collectFrom"), value: invitationText(p.value) };
    default:
      return { kind: "invalid", field: p.field, label: templateLabel(p.field), value: invitationText(p.value), expected: p.expected };
  }
}

function unparsedInvitation(x: DemoUnparsedInvitation): UnparsedInvitation {
  const t = TECHS.find((tech) => tech.email === x.attendee);
  const problems = x.problems
    .map(unparsedProblem)
    .sort((a, b) => (TEMPLATE_ORDER.get(a.field) ?? 0) - (TEMPLATE_ORDER.get(b.field) ?? 0));
  return {
    id: x.id,
    receivedAt: x.receivedAt,
    source: x.source,
    subject: invitationText(x.subject),
    organizer: { email: x.organizer, name: USERS.find((u) => u.email === x.organizer)?.name ?? null },
    attendee: { email: x.attendee, technician: t ? { id: t.id, name: t.name, color: t.color } : null },
    event: { date: x.date, start: x.start, end: x.end },
    requestNumber: x.req,
    customerName: x.customer === null ? null : invitationText(x.customer),
    problems,
    // IN-04 / SE-12: the email to the rep waits for open decision #6 (d09); never shown as sent.
    repMail: pending("d09"),
    isTest: TEST,
  };
}

/** Unresolved unparsed invitations, newest first. */
const UNPARSED_NEWEST_FIRST = [...UNPARSED_INVITATIONS].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));

/** D23: Microsoft 365 is not connected (no live connection until the owner approves it). */
const OUTLOOK_CONNECTED = false;

const excerptOf = (text: string): string => {
  const t = text.trim();
  return t.length > SUMMARY_EXCERPT_MAX ? `${t.slice(0, SUMMARY_EXCERPT_MAX)}…` : t;
};

/**
 * "חזרו מהשטח" rows (features/calls/data/types BackFromFieldItem): calls in "המשך טיפול" (D38: no
 * open visit, latest closed visit "המשך טיפול") with that visit, oldest first.
 */
const BACK_FROM_FIELD: readonly { c: Call; v: Visit }[] = CALLS.filter((c) => callStatus(c) === "followup")
  .map((c) => {
    const closed = c.visits.filter(isClosedVisit);
    return { c, v: closed[closed.length - 1] as Visit };
  })
  .sort((a, b) => (a.v.date + (a.v.endAt ?? "")).localeCompare(b.v.date + (b.v.endAt ?? "")) || a.c.req.localeCompare(b.c.req));

function backFromFieldItem({ c, v }: { c: Call; v: Visit }, asOf: IsoDate): BackFromFieldItem {
  const p = prod(c.sku);
  return {
    req: c.req,
    n: v.n,
    task: v.task,
    date: v.date,
    endAt: v.endAt,
    source: v.source,
    reason: v.reason ?? "",
    nextNote: v.nextNote,
    summaryExcerpt: excerptOf(v.summary),
    technician: techRef(v.tech),
    customer: { id: customerIdOf(c.customerNo), name: c.customer, number: c.customerNo, isTest: TEST },
    city: c.city,
    product: { sku: p.sku, name: p.name, isTest: TEST },
    representative: c.rep,
    daysWaiting: Math.max(0, daysBetween(v.date, asOf)),
    cancelledLaterVisits: c.visits.filter((x) => x.n > v.n && x.status === "cancel").length,
    isTest: TEST,
  };
}

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
    async backFromField(query) {
      const f = normalizeBackFromFieldQuery(query);
      const rows = f.technicianId ? BACK_FROM_FIELD.filter((x) => x.v.tech === f.technicianId) : BACK_FROM_FIELD;
      const page = pageOf(rows, f.page, f.limit);
      return { ...page, items: page.items.map((x) => backFromFieldItem(x, f.asOf)), outlookConnected: OUTLOOK_CONNECTED };
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
        // "נאסף" is never stored in the fixtures (simulated commands save nothing): always false.
        group.items.push({ ref: { req: x.c.req, n: x.v.n }, item: x.v.collect, customerName: x.c.customer, start: x.v.start, collected: false });
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
    async doneVisits(techId, date, page) {
      if (!isTechId(techId)) return null;
      const closed = visitsForTechOnDate(techId, assertDate(date)).filter((x) => isClosedVisit(x.v));
      const result = pageOf(closed, page?.page, page?.limit);
      return { ...result, items: result.items.map(techDayVisit) };
    },
    async doneVisit(techId, ref): Promise<ClosedVisitDetail | null> {
      if (!isTechId(techId) || !validRef(ref)) return null;
      const found = findVisit(ref.req, ref.n);
      if (!found || found.v.tech !== techId || !isClosedVisit(found.v)) return null;
      // No field times for the technician (TE-25 PENDING): left out of the DTO, not hidden by the screen.
      const detail: Omit<VisitDetail, FieldTimeKey> & Partial<Pick<VisitDetail, FieldTimeKey>> = visitDetail(found.c, found.v);
      delete detail.departAt;
      delete detail.arriveAt;
      delete detail.endAt;
      return { ...detail, editable: false };
    },
  },

  calendar: {
    async officeDay(date, filter) {
      return officeDay(assertDate(date), normalizeCalendarFilter(filter));
    },
    async officeWeek(weekOf, filter) {
      return officeWeek(assertDate(weekOf), normalizeCalendarFilter(filter));
    },
    async officeMonth(month, filter) {
      return officeMonth(assertMonth(month), normalizeCalendarFilter(filter));
    },
    async visit(ref) {
      if (!validRef(ref)) return null;
      const found = findVisit(ref.req, ref.n);
      // Cancelled visits are never on a calendar, so they have no drawer either (the port: null when not visible).
      return found && found.v.status !== "cancel" ? calendarVisitDetail(found.c, found.v) : null;
    },
    async techWeek(techId, weekOf) {
      return isTechId(techId) ? techWeek(techId, assertDate(weekOf)) : null;
    },
    async techMonth(techId, month) {
      return isTechId(techId) ? techMonth(techId, assertMonth(month)) : null;
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
    async permissions(role: OfficeRole): Promise<RolePermissions> {
      if (!isOfficeRole(role)) throw new RangeError("Unknown office role");
      if (role === "creator") return { ...CREATOR_PERMISSIONS, values: { ...CREATOR_PERMISSIONS.values } };
      if (!isMatrixRole(role)) throw new RangeError("Unknown office role");
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
    async preferences() {
      // Nothing is ever saved in the demo (simulated commands): every user has the defaults.
      return { ...NOTIFICATION_PREFERENCES };
    },
  },

  settings: {
    async permissionMatrix() {
      return {
        rows: PERMISSION_KEYS.map((key) => ({
          key,
          label: PERMISSION_LABELS[key].label,
          hint: PERMISSION_LABELS[key].hint,
          cells: Object.fromEntries(MATRIX_ROLE_VALUES.map((role) => [role, matrixCell(role, key)])) as Record<MatrixRole, PermissionCell>,
          creator: { pending: pendingCreatorDecision(key) },
        })),
      };
    },
    async technicians() {
      return boundedOf(
        TECHS.map((t) => ({ id: t.id, name: t.name, color: t.color, phone: t.phone, email: t.email, active: TECH_ACTIVE, device: TECH_DEVICE, isTest: TEST })),
        MAX_PAGE_LIMIT,
      );
    },
    async places() {
      return boundedOf(
        PLACES.map((p, i) => ({
          id: PLACE_IDS[i] as string,
          name: p.name,
          type: p.type,
          address: p.addr,
          phone: p.phone,
          hours: p.hours,
          active: p.on,
          inUse: placeInUse(p.name),
          isTest: TEST,
        })),
        MAX_PAGE_LIMIT,
      );
    },
    async reasons() {
      return boundedOf(
        REASONS.map((r, i) => ({
          id: REASON_IDS[i] as string,
          order: i + 1,
          name: r.name,
          active: r.on,
          inUse: reasonInUse(r.name),
          // The seeded reasons are the initial values (D48), not user-added: deactivate only.
          userAdded: false,
          usedThisMonth: reasonUsesThisMonth(r.name),
          isTest: TEST,
        })),
        MAX_PAGE_LIMIT,
      );
    },
    async callTypes() {
      return boundedOf(
        CALL_TYPE_SETTINGS.map((t) => ({ ...t, inUse: callTypeInUse(t.name), isTest: TEST })),
        MAX_PAGE_LIMIT,
      );
    },
    async mail() {
      return {
        completion: [completionRule("done"), completionRule("cont")],
        technicianNotifications: TECH_NOTIFICATION_KEYS.map((key) => ({ key, on: TECH_NOTIFICATIONS[key] })),
        unparsedInvitationMail: pending("d09"),
      };
    },
    async template() {
      return {
        subjectPrefix: SUBJECT_PREFIX,
        syncMode: "event-driven",
        existingRequest: "add-visit",
        labels: boundedOf(
          TEMPLATE_LABELS.map((l) => {
            const locked = isLockedTemplateField(l.key);
            return { key: l.key, label: l.label, required: locked || l.required, locked };
          }),
          MAX_PAGE_LIMIT,
        ),
      };
    },
  },

  accounts: {
    async list(query) {
      // An unknown role never widens the list: a filter with no known role matches nothing.
      const roles = filterListValues(query?.roles, isAccountRole, ACCOUNT_ROLE_VALUES);
      const matches = roles ? ACCOUNTS_BY_ROLE.filter((a) => roles.includes(a.role)) : ACCOUNTS_BY_ROLE;
      const page = pageOf(matches, query?.page, query?.limit);
      return { ...page, items: page.items.map(userAccount) };
    },
    async requests(query) {
      const statuses = filterListValues(query?.statuses, isAccountRequestStatus, ACCOUNT_REQUEST_STATUSES);
      const matches = statuses ? REQUESTS_NEWEST_FIRST.filter((r) => statuses.includes(r.status)) : REQUESTS_NEWEST_FIRST;
      const page = pageOf(matches, query?.page, query?.limit);
      return { ...page, items: page.items.map(accountRequest) };
    },
  },

  customers: {
    async list(query) {
      const f = normalizeCustomerListQuery(query);
      const page = pageOf(
        CUSTOMERS.filter((x) => customerMatches(x, f.q)),
        f.page,
        f.limit,
      );
      return { ...page, items: page.items.map(customerSummary) };
    },
    async get(id) {
      if (!isCustomerId(id)) return null;
      const x = findCustomer(id);
      return x ? customerDetail(x) : null;
    },
  },

  products: {
    async list(query) {
      const f = normalizeProductListQuery(query);
      const page = pageOf(
        CATALOGUE_BY_SKU.filter((x) => productMatches(x, f.q)),
        f.page,
        f.limit,
      );
      return { ...page, items: page.items.map(productListItem) };
    },
    async get(sku): Promise<ProductDetail | null> {
      const key = normalizeSku(sku);
      if (!isNormalizedSku(key)) return null;
      const x = findCatalogueProduct(key);
      if (!x) return null;
      const calls = boundedOf(sortCalls(x.calls), PRODUCT_CALLS_LIMIT);
      return { ...productListItem(x), customerCount: x.customerCount, calls: { ...calls, items: calls.items.map(callSummary) } };
    },
    async brands() {
      return productOptions(BRANDS);
    },
    async suppliers() {
      return productOptions(SUPPLIERS);
    },
  },

  intake: {
    async unparsedInvitations(page) {
      const result = pageOf(UNPARSED_NEWEST_FIRST, page?.page, page?.limit);
      return { ...result, items: result.items.map(unparsedInvitation) };
    },
  },

  profile: {
    async technician(techId, date) {
      if (!isTechId(techId)) return null;
      return {
        technician: techRef(techId),
        week: techWeekFigures(techId, assertDate(date)),
        officePhone: OFFICE_PHONE,
        isTest: TEST,
      };
    },
  },
};
