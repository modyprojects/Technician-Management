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
  PRODUCT_RETURN_WINDOW_DAYS,
  type ProductDetail,
  type ProductListItem,
  type ProductOption,
} from "@/features/products/data/types";
import { normalizeProductListQuery } from "@/features/products/data/validate";
import type { DataAccess } from "@/features/data-access/types";
import { isDashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { isIsoInstant, jerusalemDate } from "@/features/dashboards/data/time";
import {
  DEFAULT_SKU_SORT,
  DEFAULT_TREND_MONTHS,
  isSkuSort,
  isTechnicianVisitFilter,
  isTrendMonths,
  type AnalyticsPeriod,
} from "@/features/dashboards/data/types";
import {
  ACCOUNT_REQUEST_STATUSES,
  ACCOUNT_ROLE_VALUES,
  isAccountRequestStatus,
  cancelledAfterApprovalOf,
  creatorNoticesOf,
  isAccountRole,
  technicianProfileMissing,
  type AccountRef,
  type AccountRequest,
  type AccountRole,
  type CreationIntent,
  type CreatorNotice,
  type UserAccount,
} from "@/features/accounts/data/types";
import type { SessionQueries } from "@/features/auth/data/ports";
import { sessionUserOf } from "@/features/auth/data/session";
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
import {
  CORRECTABLE_VISIT_FIELDS,
  FOLLOWUP_CORRECTION_FIELDS,
  isClosedVisitStatus,
  TIME_CORRECTION_FIELDS,
  VISIT_CORRECTIONS_LIMIT,
  type ClosedVisitDetail,
  type CorrectableValues,
  type CorrectableVisitField,
  type CorrectionValue,
  type FieldTimeKey,
  type TechDay,
  type VisitCorrection,
  type VisitCorrectionHistory,
  type VisitDetail,
  type VisitRef,
} from "@/features/visits/data/types";
import { visitRefError } from "@/features/visits/data/validate";
import {
  OUTBOX_RECIPIENT_LABELS,
  type OutboxEmail,
  type OutboxRecipient,
  type OutboxRelease,
  type OutboxSummary,
} from "@/features/outbox/data/types";
import { isOutboxId } from "@/features/outbox/data/validate";
import {
  type ReviewField,
  type ReviewItemDetail,
  type ReviewItemSummary,
  type ReviewSource,
  type ReviewStatus,
  type ReviewValue,
} from "@/features/review/data/types";
import { isReviewItemId, normalizeReviewListQuery } from "@/features/review/data/validate";
import {
  DEVICE_SYNC_VISITS_LIMIT,
  QUEUED_OPERATION_STATES,
  VISIT_OPERATIONS_LIMIT,
  visitSyncState,
  type DeviceOperation,
  type DeviceSyncSnapshot,
  type DeviceSyncState,
  type QueuedOperationState,
  type VisitDeviceSync,
} from "@/features/sync/data/types";
import {
  csQueue,
  dashboardDetail,
  generalDashboard,
  officeOverview,
  productDashboard,
  technicianDashboard,
  technicianDetail,
} from "./aggregations";
import { officeDay, officeMonth, officeWeek, techMonth, techWeek, techWeekFigures } from "./calendar";
import { correctionsOf, VISIT_BASE_VERSION, visitValue, type DemoCorrection } from "./corrections";
import { callStartDates, CUSTOMERS, customerIdOf, customerProducts, findCustomer, type DemoCustomer } from "./customers";
import { daysBetween } from "./dates";
import { UNPARSED_INVITATIONS, type DemoUnparsedInvitation, type DemoUnparsedProblem } from "./intake";
import { calendarVisitDetail, callDetail, callSummary, historyItem, productDto, techDayVisit, techRef, visitDetail } from "./mappers";
import { CATALOGUE_BY_SKU, findCatalogueProduct, type DemoCatalogueProduct } from "./products";
import { NOTIFICATION_PREFERENCES, NOTIFICATIONS } from "./notifications";
import { findOutboxRow, OUTBOX_ROWS, type DemoOutboxRow } from "./outbox";
import { REVIEW_ITEMS, type DemoReviewField, type DemoReviewItem } from "./review";
import { DEVICE_QUEUES, type DemoDeviceOperation, type DemoDeviceQueue } from "./sync";
import {
  CALLS,
  customerCalls,
  findCall,
  findVisit,
  findVisitAsClosed,
  lastVisit,
  previousVisits,
  sortCalls,
  visitsForTechOnDate,
} from "./queries";
import { PERMISSION_STATUS, PERMISSIONS } from "./permissions";
import {
  ACCOUNT_EVENTS,
  ACCOUNT_REQUESTS,
  ACCOUNTS,
  accountById,
  CREATION_INTENTS,
  type DemoAccount,
  type DemoAccountEvent,
  type DemoAccountRequest,
  type DemoCreationIntent,
} from "./accounts";
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
  tech,
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
  TECH_VERSIONS,
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

/** The dashboard's `now`: an ISO instant with an offset from the server page (never the URL). */
function assertNow(now: string): string {
  if (!isIsoInstant(now)) throw new RangeError("Invalid instant");
  return now;
}

/** A Technicians-tab period: valid, at most a year, and never starting after `now`'s date (no future navigation). */
function assertDashboardPeriod(period: AnalyticsPeriod, now: string): AnalyticsPeriod {
  const p = assertPeriod(period);
  const asOf = jerusalemDate(now);
  if (asOf === null || p.from > asOf) throw new RangeError("Period starts in the future");
  return p;
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

/** An account as the port returns it (with its invitation alias, D34 d). */
const userAccount = (a: DemoAccount): UserAccount => ({ ...a, technicianMissing: technicianProfileMissing(a), isTest: TEST });

/** The acting account's role (CreatorNotice.actorRole); null when the account is unknown. */
const actorRoleOf = (id: string): AccountRole | null => accountById(id)?.role ?? null;

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
  cancelledAfterApproval: cancelledAfterApprovalOf(r),
  version: r.version,
  isTest: TEST,
});

/** The demo's Creator account: the viewer of the Creator's notices (the demo has no session). */
const DEMO_CREATOR_ID = ACCOUNTS.find((a) => a.role === "creator")?.id ?? null;

/** A pending request as a Creator notice (D34 a): who asked, about whom. */
const requestNotice = (r: DemoAccountRequest): CreatorNotice => ({
  id: r.id,
  kind: "pending-request",
  at: r.requestedAt,
  actor: accountRef(r.requestedBy),
  actorRole: actorRoleOf(r.requestedBy),
  target: { accountId: r.accountId, name: r.target.name, role: r.target.role },
  requestKind: r.kind,
  isTest: TEST,
});

/** An audited account event as a Creator notice (D34 b, f). The audit row holds no email, nor does this. */
function eventNotice(e: DemoAccountEvent): CreatorNotice {
  const target = accountById(e.targetAccountId);
  return {
    id: e.id,
    kind: e.kind,
    at: e.at,
    actor: accountRef(e.actorId),
    actorRole: actorRoleOf(e.actorId),
    target: { accountId: e.targetAccountId, name: target?.name ?? "", role: target?.role ?? "tech" },
    requestKind: null,
    isTest: TEST,
  };
}

/**
 * The Creator's notices, newest first (Step 2 plan §3.10), selected by creatorNoticesOf() as every
 * implementation does: pending requests, a Manager's deactivations, and Outlook-email changes not
 * made by the viewing Creator himself. The viewer is the demo's Creator account.
 */
const CREATOR_NOTICES_NEWEST_FIRST: readonly CreatorNotice[] = creatorNoticesOf(
  DEMO_CREATOR_ID ? { id: DEMO_CREATOR_ID, role: "creator" } : null,
  ACCOUNT_REQUESTS.map((r) => ({ status: r.status, notice: requestNotice(r) })),
  ACCOUNT_EVENTS.map(eventNotice),
);

const creationIntent = (x: DemoCreationIntent): CreationIntent => ({
  id: x.id,
  role: x.role,
  name: x.name,
  email: x.email,
  requestedBy: accountRef(x.requestedBy),
  authorizedAt: x.authorizedAt,
  version: x.version,
  isTest: TEST,
});

/** Open creation intents, newest first. */
const INTENTS_NEWEST_FIRST = [...CREATION_INTENTS].sort((a, b) => Date.parse(b.authorizedAt) - Date.parse(a.authorizedAt));

/**
 * The demo's session port (features/auth/data, Step 2 plan §3.7 b) for one viewpoint: the
 * fictional account of that role and name. Null (no access) when there is none or it is inactive:
 * fail closed, as the real session port. The demo's role comes from the URL (X-02), so this is not
 * part of `demoDataAccess`; production reads the user's own `profiles` row under the session.
 */
export function demoSession(viewpoint: { role: AccountRole; name: string }): SessionQueries {
  return {
    async current() {
      if (!isAccountRole(viewpoint?.role) || typeof viewpoint.name !== "string") return null;
      const a = ACCOUNTS.find((x) => x.role === viewpoint.role && x.name === viewpoint.name);
      // sessionUserOf: null (no access) for a missing or inactive account, as the real port.
      return sessionUserOf(a ? { ...a, isTest: TEST } : null);
    },
  };
}

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
    latestVisitDate: x.latestVisitDate,
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
      // "נפתחה" and "תחילת טיפול" of the first and latest call by opening time (D57 (9)).
      firstCall: callStartDates(p.calls[0] as Call),
      latestCall: callStartDates(p.calls[p.calls.length - 1] as Call),
      cameBack: p.returns.length > 0,
      returns: boundedOf(p.returns, CUSTOMER_PRODUCTS_LIMIT),
    }))
    // Products that came back first, then the latest opened call first.
    .sort(
      (a, b) =>
        Number(b.cameBack) - Number(a.cameBack) ||
        Date.parse(b.latestCall.openedAt) - Date.parse(a.latestCall.openedAt) ||
        a.product.sku.localeCompare(b.product.sku),
    );
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
    returnWindowDays: PRODUCT_RETURN_WINDOW_DAYS,
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
  // The creating invitation: the earliest opened call and its first visit; "נפתחה" and "תחילת טיפול"
  // of that call (D57 (9)).
  const first = x.calls[0];
  const firstVisit = first?.visits[0];
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    supplier: p.sup,
    brandId: x.brandId,
    supplierId: x.supplierId,
    firstSeen: first && firstVisit ? { ...callStartDates(first), n: firstVisit.n, source: firstVisit.source, isTest: TEST } : null,
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


// ---------------------------------------------------------------------------------------------
// "פריטים לבדיקה" (review.ts): both versions per field as stored (D44).

const sameValue = (a: ReviewValue | CorrectionValue, b: ReviewValue | CorrectionValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A field conflicts when both sides changed it since its base, to different values (D44). */
function reviewField(f: DemoReviewField): ReviewField {
  const conflict = !sameValue(f.base, f.current) && !sameValue(f.base, f.incoming) && !sameValue(f.current, f.incoming);
  return { key: f.key, label: f.label, base: f.base, current: f.current, incoming: f.incoming, conflict, choosable: f.choosable === true };
}

function reviewSource(s: DemoReviewItem["source"]): ReviewSource {
  if (s.kind === "invitation") return { kind: "invitation", source: s.source, subject: invitationText(s.subject) };
  const t = techRef(s.tech);
  return { kind: "device", technician: { id: t.id, name: t.name, color: t.color }, operationId: s.operationId, deviceSentAt: s.deviceSentAt };
}

const reviewStatusOf = (x: DemoReviewItem): ReviewStatus => (x.resolution ? "resolved" : "open");

function reviewSummary(x: DemoReviewItem): ReviewItemSummary {
  const c = findCall(x.req);
  const v = x.n === null ? undefined : c?.visits.find((visit) => visit.n === x.n);
  const fields = x.fields.map(reviewField);
  return {
    id: x.id,
    kind: x.kind,
    status: reviewStatusOf(x),
    source: reviewSource(x.source),
    call: { req: x.req, customerName: c?.customer ?? "", isTest: TEST },
    visit: v ? { n: v.n, status: v.status } : null,
    receivedAt: x.receivedAt,
    fieldCount: fields.length,
    conflictCount: fields.filter((f) => f.conflict).length,
    authority: x.authority,
    resolution: x.resolution
      ? { ...x.resolution, by: { ...x.resolution.by }, fieldChoices: x.resolution.fieldChoices ? { ...x.resolution.fieldChoices } : null }
      : null,
    isTest: TEST,
  };
}

function reviewDetail(x: DemoReviewItem): ReviewItemDetail {
  const summary = reviewSummary(x);
  // D39: an invitation never changes a closed visit; if the item's visit has closed since the item
  // was created, keeping the current value is the only decision left.
  const invitationOnClosedVisit = x.source.kind === "invitation" && summary.visit !== null && isClosedVisitStatus(summary.visit.status);
  return {
    ...summary,
    version: x.version,
    fields: x.fields.map(reviewField),
    appliedWithNotification: (x.applied ?? []).map((a) => ({ ...a })),
    decisions: x.resolution ? [] : invitationOnClosedVisit ? x.decisions.filter((d) => d === "keep-current") : [...x.decisions],
    // D14: a resolution that changes a server-closed or cancelled visit is audited with its reason.
    noteRequired: x.authority === "closed-visit",
    completionEmailKey: x.completionEmailKey ?? null,
  };
}

/** Newest first (server receipt time). */
const REVIEW_NEWEST_FIRST = [...REVIEW_ITEMS].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));

// ---------------------------------------------------------------------------------------------
// Audited corrections of closed visits (corrections.ts; CALLS already carries the current values).

const correctableValues = (v: Visit): Record<CorrectableVisitField, CorrectionValue> =>
  Object.fromEntries(CORRECTABLE_VISIT_FIELDS.map((f) => [f, visitValue(v, f)])) as Record<CorrectableVisitField, CorrectionValue>;

function visitCorrection(x: DemoCorrection, i: number): VisitCorrection {
  return {
    id: x.id,
    ref: { req: x.req, n: x.n },
    field: x.field,
    target: TIME_CORRECTION_FIELDS.includes(x.field) ? "time-report" : "report",
    before: x.before,
    after: x.after,
    by: { ...x.by },
    at: x.at,
    reason: x.reason,
    versionBefore: VISIT_BASE_VERSION + i,
    versionAfter: VISIT_BASE_VERSION + i + 1,
    isTest: TEST,
  };
}

// ---------------------------------------------------------------------------------------------
// Mock outbox (outbox.ts): the completion email as the outbox row holds it (EM-01 to EM-05, D09).

const OUTBOX_MANAGER = USERS.find((u) => u.role === "mgr");

/** D09: the Manager and the customer-service mailbox, fixed; d10 decides the Manager's scope and the rep. */
function outboxRecipients(c: Call): OutboxRecipient[] {
  const rep = USERS.find((u) => u.name === c.rep);
  return [
    ...(OUTBOX_MANAGER ? [{ role: "manager" as const, name: OUTBOX_MANAGER.name, email: OUTBOX_MANAGER.email, fixed: true, pending: "d10" as const }] : []),
    { role: "service-mailbox", name: OUTBOX_RECIPIENT_LABELS["service-mailbox"], email: COMPLETION_MAILBOX, fixed: true, pending: null },
    ...(rep ? [{ role: "handling-rep" as const, name: rep.name, email: rep.email, fixed: false, pending: "d10" as const }] : []),
  ];
}

/** The summary the email carries: the written summary, else the approved transcript (D12). */
const approvedSummary = (v: Visit): string => v.summary.trim() || v.transcript.trim();

/** EM-05: only after server acceptance and an approved summary; a voice-only closure waits (open #3, d06). */
const outboxRelease = (v: Visit): OutboxRelease =>
  approvedSummary(v) ? { state: "ready" } : { state: "held", reason: "awaiting-approved-summary", pending: pending("d06") };

function outboxSummary(r: DemoOutboxRow): OutboxSummary {
  const { c, v } = r;
  const outcome = v.status === "done" ? "done" : "cont";
  return {
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    event: "visit-completion",
    outcome,
    subject: `${outcome === "done" ? "✓ טופל" : "↻ המשך טיפול"} · פנייה ${c.req} · ${c.customer} · ${c.city}`,
    req: c.req,
    n: v.n,
    createdAt: r.createdAt,
    release: outboxRelease(v).state,
    delivery: "blocked-test-data",
    isTest: TEST,
  };
}

function outboxEmail(r: DemoOutboxRow): OutboxEmail {
  const { c, v } = r;
  const summary = outboxSummary(r);
  const p = prod(c.sku);
  return {
    ...summary,
    recipients: outboxRecipients(c),
    identifiers: { req: c.req, task: v.task, customerNumber: c.customerNo, visitNumber: v.n },
    banner: { outcome: summary.outcome, text: summary.outcome === "done" ? "הקריאה טופלה ונסגרה" : `המשך טיפול · ${v.reason ?? ""}` },
    followUp: summary.outcome === "cont" ? { nextVisitNumber: v.n + 1, reason: v.reason ?? "", nextNote: v.nextNote } : null,
    customer: { name: c.customer, phone: c.phone, address: `${c.street}, ${c.city}` },
    product: { name: p.name, sku: p.sku },
    technician: { name: tech(v.tech).name },
    summary: approvedSummary(v),
    recordingSeconds: v.rec,
    parts: [...v.parts],
    // D43: the approval text preserved at signing, never the current Settings text.
    signature: summary.outcome === "done" && v.signer && v.signedText ? { signerName: v.signer, signedText: v.signedText } : null,
    media: { count: v.media.length, attachment: pending("d11") },
    cardLink: { req: c.req },
    releaseDetail: outboxRelease(v),
    provider: pending("d12"),
  };
}

// ---------------------------------------------------------------------------------------------
// Device work queue (sync.ts): TE-23 states per visit.

const EMPTY_QUEUE: DemoDeviceQueue = { lastSyncAt: null, operations: [], confirmed: [] };

function deviceOperation(o: DemoDeviceOperation): DeviceOperation {
  return {
    opId: o.opId,
    ref: { req: o.req, n: o.n },
    kind: o.kind,
    media: o.media ? { ...o.media } : null,
    state: o.state,
    savedAt: o.savedAt,
    attempts: o.attempts,
    lastAttemptAt: o.lastAttemptAt,
    error: o.error,
    sizeBytes: o.sizeBytes,
    isTest: TEST,
  };
}

function visitDeviceSync(queue: DemoDeviceQueue, req: string, n: number): VisitDeviceSync | null {
  const ops = queue.operations.filter((o) => o.req === req && o.n === n).sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt));
  const confirmed = queue.confirmed.find((x) => x.req === req && x.n === n);
  if (!ops.length && !confirmed) return null;
  const operations = boundedOf(ops, VISIT_OPERATIONS_LIMIT);
  return {
    req,
    n,
    state: visitSyncState(ops),
    operations: { ...operations, items: operations.items.map(deviceOperation) },
    confirmedAt: confirmed?.at ?? null,
    isTest: TEST,
  };
}

/** Failed first, then syncing, pending, saved on device, and the sent ones last. */
const SYNC_ORDER: readonly DeviceSyncState[] = ["failed", "syncing", "pending", "saved-on-device", "sent"];

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
    // The technician's reads (get, history, doneVisit) show the values as closed, without office
    // corrections: TEMPORARY, owner question (queries.ts CALLS_AS_CLOSED).
    async get(ref) {
      if (!validRef(ref)) return null;
      const found = findVisitAsClosed(ref.req, ref.n);
      return found ? visitDetail(found.c, found.v) : null;
    },
    async history(ref) {
      if (!validRef(ref)) return [];
      const c = findVisitAsClosed(ref.req, ref.n)?.c;
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
      const found = findVisitAsClosed(ref.req, ref.n);
      if (!found || found.v.tech !== techId || !isClosedVisit(found.v)) return null;
      // No field times for the technician (TE-25 PENDING): left out of the DTO, not hidden by the screen.
      const detail: Omit<VisitDetail, FieldTimeKey> & Partial<Pick<VisitDetail, FieldTimeKey>> = visitDetail(found.c, found.v);
      delete detail.departAt;
      delete detail.arriveAt;
      delete detail.endAt;
      return { ...detail, editable: false };
    },
    async corrections(ref): Promise<VisitCorrectionHistory | null> {
      if (!validRef(ref)) return null;
      const found = findVisit(ref.req, ref.n);
      if (!found || !isClosedVisit(found.v)) return null;
      const list = correctionsOf(ref.req, ref.n);
      const current: CorrectableValues = correctableValues(found.v);
      // The original of a field is the "before" of its first correction; otherwise the current value.
      const original = { ...current };
      for (const x of [...list].reverse()) original[x.field] = x.before;
      const corrections = boundedOf(list.map(visitCorrection).reverse(), VISIT_CORRECTIONS_LIMIT);
      return {
        req: ref.req,
        n: ref.n,
        version: VISIT_BASE_VERSION + list.length,
        status: found.v.status === "done" ? "done" : "cont",
        original,
        current,
        correctable: CORRECTABLE_VISIT_FIELDS.filter((f) => found.v.status === "cont" || !FOLLOWUP_CORRECTION_FIELDS.includes(f)),
        corrections,
        isTest: TEST,
      };
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
    async generalDashboard(now, opts) {
      return generalDashboard(assertNow(now), isTrendMonths(opts?.months) ? opts.months : DEFAULT_TREND_MONTHS);
    },
    async technicianDashboard(techId, period, now) {
      if (!isTechId(techId)) return null;
      assertNow(now);
      return technicianDashboard(techId, assertDashboardPeriod(period, now), now);
    },
    async productDashboard(now, opts) {
      return productDashboard(assertNow(now), opts?.page, isSkuSort(opts?.sort) ? opts.sort : DEFAULT_SKU_SORT);
    },
    async dashboardDetail(query) {
      // The registry key, the group and the key's tab context are validated again by the formulas
      // (detailRecords): an unknown, pending or unavailable key or an unknown group gives null.
      if (!isDashboardMetricKey(query?.key)) return null;
      const now = assertNow(query.now);
      if (query.techId !== undefined && !isTechId(query.techId)) return null;
      const period = query.period === undefined ? undefined : assertDashboardPeriod(query.period, now);
      if (query.group !== undefined && (typeof query.group !== "string" || query.group.length > 64)) return null;
      return dashboardDetail({
        key: query.key,
        now,
        period,
        techId: query.techId,
        group: query.group,
        page: query.page,
        limit: query.limit,
      });
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
        TECHS.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          phone: t.phone,
          email: t.email,
          active: TECH_ACTIVE,
          device: TECH_DEVICE,
          version: TECH_VERSIONS[t.id],
          isTest: TEST,
        })),
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
    async openCreations(query) {
      // The demo has no session: every fictional intent. The loader that shows them (PR 2.3) keeps
      // the viewer's own before anything reaches a page (production: requested_by = the session).
      const page = pageOf(INTENTS_NEWEST_FIRST, query?.page, query?.limit);
      return { ...page, items: page.items.map(creationIntent) };
    },
    async creatorNotices(query) {
      // The demo Creator's view; only the Creator's loader calls it (production denies other callers).
      return pageOf(CREATOR_NOTICES_NEWEST_FIRST, query?.page, query?.limit);
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

  review: {
    async list(query) {
      const f = normalizeReviewListQuery(query);
      const counts: Record<ReviewStatus, number> = { open: 0, resolved: 0 };
      for (const x of REVIEW_ITEMS) counts[reviewStatusOf(x)] += 1;
      const page = pageOf(
        f.status ? REVIEW_NEWEST_FIRST.filter((x) => reviewStatusOf(x) === f.status) : REVIEW_NEWEST_FIRST,
        f.page,
        f.limit,
      );
      return { ...page, items: page.items.map(reviewSummary), counts };
    },
    async get(id) {
      if (!isReviewItemId(id)) return null;
      const x = REVIEW_ITEMS.find((item) => item.id === id);
      return x ? reviewDetail(x) : null;
    },
  },

  outbox: {
    async list(query) {
      const page = pageOf(OUTBOX_ROWS, query?.page, query?.limit);
      return { ...page, items: page.items.map(outboxSummary) };
    },
    async get(id) {
      if (!isOutboxId(id)) return null;
      const row = findOutboxRow(id);
      return row ? outboxEmail(row) : null;
    },
  },

  sync: {
    async device(techId): Promise<DeviceSyncSnapshot | null> {
      if (!isTechId(techId)) return null;
      const queue = DEVICE_QUEUES[techId] ?? EMPTY_QUEUE;
      const counts = Object.fromEntries(QUEUED_OPERATION_STATES.map((st) => [st, 0])) as Record<QueuedOperationState, number>;
      for (const o of queue.operations) counts[o.state] += 1;
      const keys = [...new Set([...queue.operations, ...queue.confirmed].map((x) => `${x.req}/${x.n}`))];
      const visits = keys
        .map((k) => {
          const [req = "", n = "0"] = k.split("/");
          return visitDeviceSync(queue, req, Number(n));
        })
        .filter((x): x is VisitDeviceSync => x !== null)
        .sort(
          (a, b) =>
            SYNC_ORDER.indexOf(a.state) - SYNC_ORDER.indexOf(b.state) || (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""),
        );
      return { technicianId: techId, lastSyncAt: queue.lastSyncAt, counts, visits: boundedOf(visits, DEVICE_SYNC_VISITS_LIMIT), isTest: TEST };
    },
    async visit(techId, ref) {
      if (!isTechId(techId) || !validRef(ref)) return null;
      return visitDeviceSync(DEVICE_QUEUES[techId] ?? EMPTY_QUEUE, ref.req, ref.n);
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
