// The Outlook template parser (docs/outlook-template.md; IN-01: by Hebrew labels, not by line
// order). Pure. A line "<label>: <value>" sets the field of that label; other lines are ignored.
// Every required label needs a non-empty value; every value must fit its database column
// (./text.ts). Problems are listed in template order with their field (S-05). An unknown SKU is
// never a problem (D19); an unknown call type, pickup place or technician is found by the database,
// which knows the Settings lists (private.ingest_calendar_event).
import type { TemplateFieldKey } from "@/features/settings/data/types";
import { effectiveTemplate, normalizeLabelText, type InvitationTemplate } from "./template";
import { isAsciiId, isPhone, isRequestNumber, isSafeText, sanitizeForReport } from "./text";
import type { IngestionProblem, InvalidRule, ParsedInvitationFields, ParsedWarranty } from "./types";

/** Longest body the parser reads (a template body is about 1 KB). */
export const MAX_BODY_LENGTH = 20_000;

/** Values that mean "no value" (the demo treats "—" as empty). */
const EMPTY_VALUES = new Set(["—", "–", "-"]);

/** Column rules per field: [check, rule when it fails]. */
type FieldRule = (value: string) => InvalidRule | null;

const safe =
  (max: number, multiLine = false): FieldRule =>
  (value) =>
    isSafeText(value, max, multiLine) ? null : [...value].length > max ? "length" : "format";
const asciiId =
  (max: number): FieldRule =>
  (value) =>
    isAsciiId(value, max) ? null : value.length > max ? "length" : "format";

/** The database column each field fills, and its rule (Migrations 2 and 3, TEMPORARY OQ-6, OQ-8). */
const FIELD_RULES: Readonly<Record<TemplateFieldKey, FieldRule>> = {
  req: (value) => (isRequestNumber(value) ? null : "format"),
  task: asciiId(40),
  rep: safe(60),
  customerNo: asciiId(40),
  customer: safe(120),
  phone: (value) => (isPhone(value) ? null : "format"),
  phone2: (value) => (isPhone(value) ? null : "format"),
  city: safe(60),
  street: safe(120),
  building: safe(20),
  floor: safe(20),
  apt: safe(20),
  arrival: safe(1000, true),
  type: safe(60),
  product: safe(120),
  sku: asciiId(40),
  desc: safe(1000, true),
  warranty: (value) => (parseWarranty(value) ? null : "warranty_format"),
  collect: safe(120),
  collectFrom: safe(60),
  techNote: safe(1000, true),
};

/**
 * Warranty (D17 optional, D42): "כן", "לא" or "כן · עד MM/YYYY" (spaces around the dot are free;
 * TEMPORARY, Migration 3 OQ-7: month precision, stored as the first day). Anything else: null.
 */
export function parseWarranty(value: string): ParsedWarranty | null {
  const raw = value.normalize("NFC").trim();
  if (!isSafeText(raw, 60)) return null;
  if (raw === "כן") return { status: "yes", until: null, raw };
  if (raw === "לא") return { status: "no", until: null, raw };
  const match = /^כן\s*\u00b7\s*עד\s+(0[1-9]|1[0-2])\/(20[0-9]{2})$/u.exec(raw);
  if (!match) return null;
  return { status: "yes", until: `${match[2]}-${match[1]}-01`, raw };
}

/** D19, PR-07: the SKU as matched (trimmed, upper case; ASCII only, so the case rule cannot vary). */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** The value of each label found in the body, or null; a label repeated with another value is a duplicate. */
type Reading = { value: string | null; duplicate: boolean; present: boolean };

function readLabels(body: string, template: InvitationTemplate): Map<TemplateFieldKey, Reading> {
  // Longest label first, so "טלפון נוסף" is never read as "טלפון" (the colon rule also keeps them apart).
  const fields = [...template.fields].sort((a, b) => b.label.length - a.label.length);
  const readings = new Map<TemplateFieldKey, Reading>(
    template.fields.map((f) => [f.key, { value: null, duplicate: false, present: false }]),
  );
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/^[ \t]+/, "");
    // Same length as `line`: only single code units are replaced.
    const matchable = normalizeLabelText(line);
    for (const field of fields) {
      const label = normalizeLabelText(field.label);
      if (!matchable.startsWith(label)) continue;
      const rest = matchable.slice(label.length);
      const colon = /^[ \t]*:/.exec(rest);
      if (!colon) continue;
      const value = line.slice(label.length + colon[0].length).normalize("NFC").trim();
      const reading = readings.get(field.key)!;
      const next = value === "" || EMPTY_VALUES.has(value) ? null : value;
      if (reading.present && next !== null && reading.value !== null && reading.value !== next) reading.duplicate = true;
      reading.present = true;
      if (reading.value === null) reading.value = next;
      break;
    }
  }
  return readings;
}

export type ParseResult =
  | { ok: true; fields: ParsedInvitationFields }
  | {
      ok: false;
      problems: IngestionProblem[];
      /** Values read to recognise the invitation (valid request number and customer name only). */
      recognised: { requestNumber: string | null; customerName: string | null };
    };

/** Parses an invitation body with the template's labels. */
export function parseInvitationBody(body: string, template?: InvitationTemplate): ParseResult {
  const effective = effectiveTemplate(template);
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      problems: [{ kind: "invalid", field: "body", rule: "length", value: null }],
      recognised: { requestNumber: null, customerName: null },
    };
  }
  const readings = readLabels(body, effective);
  const problems: IngestionProblem[] = [];
  const values = new Map<TemplateFieldKey, string | null>();
  for (const field of effective.fields) {
    const reading = readings.get(field.key)!;
    if (reading.duplicate) {
      problems.push({ kind: "invalid", field: field.key, rule: "duplicate_label", value: sanitizeForReport(reading.value ?? "") });
      continue;
    }
    if (reading.value === null) {
      if (field.required) problems.push({ kind: "missing", field: field.key });
      values.set(field.key, null);
      continue;
    }
    const rule = FIELD_RULES[field.key](reading.value);
    if (rule) {
      problems.push({ kind: "invalid", field: field.key, rule, value: sanitizeForReport(reading.value) });
      continue;
    }
    values.set(field.key, reading.value);
  }

  const get = (key: TemplateFieldKey): string | null => values.get(key) ?? null;
  if (problems.length > 0) {
    const req = get("req");
    const customer = get("customer");
    return { ok: false, problems, recognised: { requestNumber: req, customerName: customer } };
  }
  const need = (key: TemplateFieldKey): string => {
    const value = get(key);
    if (value === null) throw new Error(`parser: required field ${key} has no value`);
    return value;
  };
  const sku = need("sku");
  const warranty = get("warranty");
  return {
    ok: true,
    fields: {
      requestNumber: need("req"),
      taskNumber: need("task"),
      handlingRepName: need("rep"),
      customerNumber: need("customerNo"),
      customerName: need("customer"),
      phone: need("phone"),
      phoneAlt: get("phone2"),
      city: need("city"),
      street: need("street"),
      building: get("building"),
      floor: get("floor"),
      apartment: get("apt"),
      arrivalNotes: get("arrival"),
      callType: need("type"),
      productName: need("product"),
      sku,
      skuNormalized: normalizeSku(sku),
      faultDescription: need("desc"),
      warranty: warranty === null ? null : parseWarranty(warranty),
      pickupItem: get("collect"),
      pickupLocation: get("collectFrom"),
      techNotes: get("techNote"),
    },
  };
}
